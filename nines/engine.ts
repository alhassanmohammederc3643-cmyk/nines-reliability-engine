import {createHash,randomUUID} from 'node:crypto';
import {normalizeOrder,boundHash,requireText} from './binding';
import type {FinalOrder} from './review';
import type {DB,Principal,SessionVerifier,TaskRow,HostConfig,SimScope,PaymentResult,SimulationPaymentAdapter,ReceiptSource,Mail} from './engine-types';
const defaultConfig:HostConfig={mode:'SIMULATED',realCharges:false,realSends:false,policiesEnabled:false,verificationReserveSeconds:600};
/** Authenticated host boundary. No public HTTP routes are shipped by this module. */
export class NinesEngine{
 constructor(private db:DB,private sessions:SessionVerifier,private config:HostConfig=defaultConfig){
  if(config.mode!=='SIMULATED'||config.realCharges!==false||config.realSends!==false||config.policiesEnabled!==false||!Number.isInteger(config.verificationReserveSeconds)||config.verificationReserveSeconds<60)throw Error('Only disabled-policy simulation is supported');
 }
 private async principal(session:string):Promise<Principal>{const p=await this.sessions.resolve(session);if(!p||!p.owner?.trim()||!p.sessionId||!(Date.parse(p.authenticatedAt)<=Date.now()))throw Error('Authenticated owner session required');return p}
 async get(session:string,id:string){const p=await this.principal(session);return this.load(p.owner,id)}
 private async load(owner:string,id:string,db=this.db,lock=false){const r=await db.query<TaskRow>(`select * from nines.tasks where owner=$1 and id=$2${lock?' for update':''}`,[owner,id]);return r.rows[0]??null}
 private async audit(db:DB,t:TaskRow,event:string,details:unknown={}){await db.query('insert into nines.audit(owner,task_id,event,details) values($1,$2,$3,$4)',[t.owner,t.id,event,JSON.stringify(details)])}
 async intake(session:string,requestKey:string,input:FinalOrder,connection:string,target:string){
  const p=await this.principal(session),order=normalizeOrder(input);requireText(requestKey,'request key');requireText(connection,'connection');requireText(target,'target');
  return this.db.transaction(async db=>{
   const id=randomUUID(),key=createHash('sha256').update('nines:v2:'+p.owner+':'+id).digest('hex');
   const deadline=new Date(order.deadline),verifyBy=new Date(Math.min(Date.parse(order.pickupAt),deadline.getTime()-this.config.verificationReserveSeconds*1000));
   if(verifyBy.getTime()<=Date.now())throw Error('Insufficient deadline recovery time');
   await db.query('insert into nines.tasks(id,owner,request_key,final_order,connection_id,target_version,idempotency_key,verify_by,alert_at) values($1,$2,$3,$4,$5,$6,$7,$8,$8) on conflict(owner,request_key) do nothing',[id,p.owner,requestKey,JSON.stringify(order),connection,target,key,verifyBy]);
   const r=await db.query<TaskRow>('select * from nines.tasks where owner=$1 and request_key=$2 for update',[p.owner,requestKey]);const t=r.rows[0];
   if(!t||boundHash(p.owner,t.final_order,t.connection_id,t.target_version)!==boundHash(p.owner,order,connection,target))throw Error('Request key reused with changed final order');
   if(t.id===id)await this.audit(db,t,'PLANNED',{mode:'SIMULATED'});return t;
  });
 }
 async propose(session:string,id:string){const p=await this.principal(session);return this.db.transaction(async db=>{
  const t=await this.load(p.owner,id,db,true);if(!t||t.state!=='PLANNED')throw Error('Task not reviewable');normalizeOrder(t.final_order);
  const r={id:randomUUID(),hash:boundHash(p.owner,t.final_order,t.connection_id,t.target_version),expiresAt:new Date(Math.min(Date.now()+30*60000,Date.parse(t.final_order.pickupAt))).toISOString(),order:t.final_order,connection:t.connection_id,target:t.target_version};
  await db.query('insert into nines.reviews(id,owner,task_id,final_order,connection_id,target_version,proposal_hash,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[r.id,p.owner,id,JSON.stringify(r.order),r.connection,r.target,r.hash,r.expiresAt]);await this.audit(db,t,'REVIEW_PREPARED',{review:r.id,hash:r.hash});return r;
 })}
 async decide(session:string,id:string,review:string,hash:string,connection:string,target:string,decision:'approved'|'denied'){
  const p=await this.principal(session);if(!['approved','denied'].includes(decision))throw Error('Invalid decision');
  // Evidence originates only from resolved authenticated host session plus exact reviewed proposal.
  const r=await this.db.query<{changed:number}>('select nines.decide($1,$2,$3,$4,$5,$6,$7,$8) as changed',[p.owner,id,review,hash,connection,target,decision,`session:${p.sessionId}:proposal:${review}:${hash}`]);return r.rows[0].changed===1;
 }
 async authorizeSimulation(session:string,id:string){const p=await this.principal(session);return this.db.transaction(async db=>{
  const t=await this.load(p.owner,id,db,true);if(!t||t.state!=='PLANNED')return false;
  const r=await db.query('select id from nines.reviews where owner=$1 and task_id=$2 and status=\'approved\' and expires_at>clock_timestamp() and final_order=$3::jsonb and connection_id=$4 and target_version=$5 and proposal_hash=$6 and evidence_ref is not null and consumed_at is null',[p.owner,id,JSON.stringify(t.final_order),t.connection_id,t.target_version,boundHash(p.owner,t.final_order,t.connection_id,t.target_version)]);if(!r.rows.length)return false;
  await db.query("update nines.tasks set state='AUTH_SCOPED',version=version+1 where owner=$1 and id=$2",[p.owner,id]);await this.audit(db,t,'AUTH_SCOPED',{mode:'SIMULATED'});return true;
 })}
 async run(session:string,id:string,payment:SimulationPaymentAdapter){
  const p=await this.principal(session);if(payment.mode!=='SIMULATED')throw Error('Live payment adapters prohibited');
  let t=await this.load(p.owner,id);if(!t||t.state!=='AUTH_SCOPED')return false;const lease=randomUUID();
  const claimed=await this.db.query<{changed:number}>('select nines.claim($1,$2,$3,$4,60) as changed',[p.owner,id,t.version,lease]);if(claimed.rows[0].changed!==1)return false;
  t=(await this.load(p.owner,id))!;
  const r=await this.db.query<{id:string;proposal_hash:string}>('select id,proposal_hash from nines.reviews where owner=$1 and task_id=$2 and status=\'approved\' and consumed_at is null order by decided_at desc limit 1',[p.owner,id]);if(!r.rows[0])return false;
  const scope:SimScope={mode:'SIMULATED',merchantId:t.final_order.merchantId,amountMinor:t.final_order.amountMinor,currency:t.final_order.currency,expiresAt:new Date(Math.min(Date.now()+2*3600000,Date.parse(t.final_order.deadline))).toISOString(),reference:'sim_'+randomUUID().replaceAll('-','')};
  const begin=await this.db.query<{changed:number}>('select nines.begin_simulated_effect($1,$2,$3,$4,$5,$6,$7,$8,$9) as changed',[p.owner,id,t.version,lease,r.rows[0].id,r.rows[0].proposal_hash,t.connection_id,t.target_version,JSON.stringify(scope)]);if(begin.rows[0].changed!==1)return false;
  t=(await this.load(p.owner,id))!;
  let result:PaymentResult;try{result=await payment.charge(t,t.idempotency_key)}catch{await this.unknown(p.owner,id,'Adapter threw after durable effect marker');return true}
  await this.recordResult(p.owner,id,result);return true;
 }
 private async recordResult(owner:string,id:string,result:PaymentResult){return this.db.transaction(async db=>{
  const t=await this.load(owner,id,db,true);if(!t||!['CHARGING','SETTLEMENT_UNKNOWN'].includes(t.state)||!t.effect_started_at)return false;
  if(result.mode!=='SIMULATED'||typeof result.code!=='string'||!result.code||typeof result.retrySafe!=='boolean'||result.merchantOrderId!==t.final_order.orderId||!result.providerReference||!['accepted','declined','uncertain'].includes(result.kind))throw Error('Invalid provider result');
  const state=result.kind==='accepted'?'VERIFYING':result.kind==='declined'?(result.retrySafe&&t.attempts<3?'CHARGING':'FAILED'):'SETTLEMENT_UNKNOWN';
  await db.query('update nines.tasks set state=$3,provider_result=$4,reconciliation_required=$5,version=version+1,updated_at=clock_timestamp() where owner=$1 and id=$2',[owner,id,state,JSON.stringify(result),result.kind==='uncertain']);
  await db.query('update nines.tasks set next_retry_at=$3 where owner=$1 and id=$2',[owner,id,state==='CHARGING'?new Date(Date.now()+1000*2**t.attempts):null]);
  await this.audit(db,t,state,{code:result.code,providerReference:result.providerReference});if(result.kind==='declined'||state==='SETTLEMENT_UNKNOWN')await db.query('select nines.enqueue_alert($1,$2,$3)',[owner,id,result.code]);return true;
 })}
 private async unknown(owner:string,id:string,error:string){return this.db.transaction(async db=>{
  const t=await this.load(owner,id,db,true);if(!t||!['CHARGING','VERIFYING'].includes(t.state))return false;
  await db.query("update nines.tasks set state='SETTLEMENT_UNKNOWN',reconciliation_required=true,version=version+1 where owner=$1 and id=$2",[owner,id]);await this.audit(db,t,'SETTLEMENT_UNKNOWN',{error});await db.query('select nines.enqueue_alert($1,$2,$3)',[owner,id,error]);return true;
 })}
 async retryDeclined(session:string,id:string,payment:SimulationPaymentAdapter){
  const p=await this.principal(session);if(payment.mode!=='SIMULATED')throw Error('Live adapters prohibited');
  const t=await this.db.transaction(async db=>{
   const current=await this.load(p.owner,id,db,true);if(!current||current.state!=='CHARGING'||current.reconciliation_required||current.provider_result?.kind!=='declined'||!current.provider_result.retrySafe||current.attempts>=3||!current.next_retry_at||new Date(current.next_retry_at).getTime()>Date.now()||!current.scope||Date.parse(current.scope.expiresAt)<=Date.now()||Date.parse(current.final_order.deadline)<=Date.now())return null;
   if(current.scope.merchantId!==current.final_order.merchantId||current.scope.currency!==current.final_order.currency||current.scope.amountMinor!==current.final_order.amountMinor)return null;
   const reviews=await db.query('select id from nines.reviews where owner=$1 and task_id=$2 and status=\'approved\' and consumed_at is not null and expires_at>clock_timestamp() and final_order=$3::jsonb and connection_id=$4 and target_version=$5 and proposal_hash=$6',[p.owner,id,JSON.stringify(current.final_order),current.connection_id,current.target_version,boundHash(p.owner,current.final_order,current.connection_id,current.target_version)]);if(!reviews.rows.length)return null;
   await db.query('update nines.tasks set attempts=attempts+1,next_retry_at=null,reconciliation_required=true,version=version+1 where owner=$1 and id=$2',[p.owner,id]);await this.audit(db,current,'SIMULATED_RETRY_STARTED',{idempotencyKey:current.idempotency_key});return this.load(p.owner,id,db);
  });if(!t)return false;
  try{await this.recordResult(p.owner,id,await payment.charge(t,t.idempotency_key))}catch{await this.unknown(p.owner,id,'Retry outcome ambiguous; reconcile only')}return true;
 }
 async reconcile(session:string,id:string,payment:SimulationPaymentAdapter){const p=await this.principal(session);if(payment.mode!=='SIMULATED')throw Error('Live adapters prohibited');const t=await this.load(p.owner,id);if(!t||!['CHARGING','SETTLEMENT_UNKNOWN'].includes(t.state)||!t.effect_started_at)return false;const result=await payment.lookup(p.owner,t.idempotency_key);return result?this.recordResult(p.owner,id,result):false}
 async recoverCrashed(session:string){const p=await this.principal(session);const rows=await this.db.query<{id:string}>("select id from nines.tasks where owner=$1 and state='CHARGING' and reconciliation_required and lease_until<=clock_timestamp()",[p.owner]);for(const t of rows.rows)await this.unknown(p.owner,t.id,'Worker lease expired after possible effect; reconcile, never requeue');return rows.rows.length}
 async checkDeadlines(session:string){const p=await this.principal(session);await this.db.transaction(async db=>{const expired=await db.query<TaskRow>("select * from nines.tasks where owner=$1 and state in ('PLANNED','AUTH_SCOPED') and effect_started_at is null and (final_order->>'deadline')::timestamptz<=clock_timestamp() for update",[p.owner]);for(const t of expired.rows){await db.query("update nines.tasks set state='FAILED',version=version+1 where owner=$1 and id=$2",[p.owner,t.id]);await this.audit(db,t,'FAILED',{error:'Deadline passed before any effect'});await db.query('select nines.enqueue_alert($1,$2,$3)',[p.owner,t.id,'Deadline passed before any effect']);}});const r=await this.db.query<{id:string}>("select id from nines.tasks where owner=$1 and state='VERIFYING' and verify_by<=clock_timestamp()",[p.owner]);for(const t of r.rows)await this.unknown(p.owner,t.id,'No matching confirmation within recovery window');return r.rows.length}
 async tick(session:string,payment:SimulationPaymentAdapter){const p=await this.principal(session);await this.recoverCrashed(session);await this.checkDeadlines(session);const retry=await this.db.query<{id:string}>("select id from nines.tasks where owner=$1 and state='CHARGING' and not reconciliation_required and next_retry_at<=clock_timestamp()",[p.owner]);for(const t of retry.rows)await this.retryDeclined(session,t.id,payment);const r=await this.db.query<{id:string}>("select id from nines.tasks where owner=$1 and state='AUTH_SCOPED' order by (final_order->>'deadline')::timestamptz limit 20",[p.owner]);let ran=0;for(const t of r.rows)if(await this.run(session,t.id,payment))ran++;return ran}
 async watchReceipts(session:string,source:ReceiptSource,connection:string,providerAccount:string,merchantSenders:Record<string,string[]>){
  const p=await this.principal(session);if(source.mode!=='OFFLINE')throw Error('Live receipt access not enabled');
  const c=await this.db.query<{cursor:string|null}>('select cursor from nines.watch_cursors where owner=$1 and connection_id=$2',[p.owner,connection]);const batch=await source.list(p.owner,connection,c.rows[0]?.cursor??null);let matched=0;
  for(const mail of batch.messages){if(mail.owner!==p.owner||mail.connectionId!==connection||mail.providerAccount!==providerAccount)continue;
   const tasks=await this.db.query<TaskRow>("select * from nines.tasks where owner=$1 and connection_id=$2 and state in ('VERIFYING','SETTLEMENT_UNKNOWN')",[p.owner,connection]);
   for(const t of tasks.rows)if(await this.acceptReceipt(p.owner,t,mail,merchantSenders[t.final_order.merchantId]??[])){matched++;break;}
  }
  await this.db.query('insert into nines.watch_cursors(owner,connection_id,cursor) values($1,$2,$3) on conflict(owner,connection_id) do update set cursor=excluded.cursor',[p.owner,connection,batch.cursor]);return matched;
 }
 private async acceptReceipt(owner:string,original:TaskRow,mail:Mail,senders:string[]){
  const from=mail.from.toLowerCase(),domain=from.split('@')[1];
  if(!mail.auth.trustedGateway||!mail.auth.dmarc||!mail.auth.dkim||mail.auth.alignedDomain.toLowerCase()!==domain||!senders.map(s=>s.toLowerCase()).includes(from)||!mail.messageId||!Number.isFinite(Date.parse(mail.receivedAt)))return false;
  // Only the explicitly documented structured fixture format is supported. No model/body instructions are executed.
  let evidence:Record<string,unknown>;try{evidence=JSON.parse(mail.body)}catch{return false}
  const o=original.final_order;
  if(evidence.kind!=='merchant_receipt'||evidence.merchantId!==o.merchantId||evidence.orderId!==o.orderId||evidence.amountMinor!==o.amountMinor||evidence.currency!==o.currency||evidence.pickupAt!==o.pickupAt)return false;
  return this.db.transaction(async db=>{
   const t=await this.load(owner,original.id,db,true);if(!t||!['VERIFYING','SETTLEMENT_UNKNOWN'].includes(t.state)||t.provider_result?.kind!=='accepted'||Date.parse(mail.receivedAt)<new Date(t.effect_started_at!).getTime()||Date.parse(mail.receivedAt)>Date.now()+60000)return false;
   const r=await db.query('insert into nines.receipts(owner,task_id,message_id,source,provider_account,fields,auth_evidence) values($1,$2,$3,\'offline_provider_fixture\',$4,$5,$6) on conflict do nothing returning message_id',[owner,t.id,mail.messageId,mail.providerAccount,JSON.stringify(evidence),JSON.stringify(mail.auth)]);if(!r.rows.length)return false;
   await db.query("update nines.tasks set state='VERIFIED',receipt_id=$3,reconciliation_required=false,version=version+1 where owner=$1 and id=$2",[owner,t.id,mail.messageId]);await this.audit(db,t,'VERIFIED',{messageId:mail.messageId,source:'OFFLINE'});return true;
  });
 }
 async alerts(session:string,id:string){const p=await this.principal(session);const r=await this.db.query('select * from nines.outbox where owner=$1 and task_id=$2 order by id',[p.owner,id]);return r.rows}
 async history(session:string,id:string){const p=await this.principal(session);const r=await this.db.query('select event,details,at from nines.audit where owner=$1 and task_id=$2 order by id',[p.owner,id]);return r.rows}
}
