/** Nines dry-run engine. No payment, mail, or notification provider is connected. */
import {createHash,randomUUID} from 'node:crypto';
export type State='PLANNED'|'AUTH_SCOPED'|'CHARGING'|'VERIFYING'|'VERIFIED'|'FAILED'|'SETTLEMENT_UNKNOWN';
export type Scope={merchantId:string;amountMinor:number;currency:string;expiresAt:string;instrument:'one_time_virtual_card'|'stripe_shared_payment_token';opaqueReference:string};
export type Policy={enabled:boolean;currency:string;maxAmountMinor:number;minLeadMinutes:number;merchantIds:string[];expiresAt?:string};
export type Receipt={source:'gmail';authenticatedSender:boolean;sender:string;messageId:string;merchantId:string;amountMinor:number;currency:string;orderId:string;pickupAt:string};
export type Notice={channel:'push'|'sms'|'in_chat';status:'queued'|'sent'|'failed'|'unavailable';at:string;error:string;minutesLeft:number;options:string[]};
export type Audit={at:string;from:State;to:State;reason:string;attempt:number;receiptMessageId?:string};
export type Task={id:string;ownerId:string;merchantId:string;amountMinor:number;currency:string;deadline:string;pickupAt:string;orderId:string;state:State;idempotencyKey:string;attempts:number;scope?:Scope;receipt?:Receipt;audit:Audit[];notices:Notice[]};
export type ChargeResult={kind:'accepted'|'declined'|'uncertain';code:string;merchantOrderId?:string};
const allowed:Record<State,State[]>={PLANNED:['AUTH_SCOPED','FAILED'],AUTH_SCOPED:['CHARGING','FAILED'],CHARGING:['CHARGING','VERIFYING','FAILED','SETTLEMENT_UNKNOWN'],VERIFYING:['VERIFIED','SETTLEMENT_UNKNOWN','FAILED'],VERIFIED:[],FAILED:[],SETTLEMENT_UNKNOWN:[]};
function time(s:string){const n=Date.parse(s);if(!Number.isFinite(n))throw Error('Invalid time');return n}
function assert(v:unknown,msg:string):asserts v{if(!v)throw Error(msg)}
function move(t:Task,to:State,reason:string,now:string,receiptMessageId?:string){assert(allowed[t.state].includes(to),`Invalid transition ${t.state} to ${to}`);const from=t.state;t.state=to;t.audit.push({at:now,from,to,reason,attempt:t.attempts,receiptMessageId})}
export function plan(input:Pick<Task,'ownerId'|'merchantId'|'amountMinor'|'currency'|'deadline'|'pickupAt'|'orderId'>,now=new Date().toISOString()):Task{
 assert(input.ownerId&&input.merchantId&&input.orderId,'Owner, merchant and order required');assert(Number.isSafeInteger(input.amountMinor)&&input.amountMinor>0,'Positive minor-unit amount required');assert(time(input.deadline)>time(now)&&time(input.pickupAt)>time(now),'Future deadline and pickup required');
 const id=randomUUID();return {...input,id,state:'PLANNED',idempotencyKey:createHash('sha256').update('nines:v1:'+id).digest('hex'),attempts:0,audit:[],notices:[]};
}
export function policyAllows(t:Task,p:Policy,now=new Date().toISOString()){return p.enabled&&(!p.expiresAt||time(p.expiresAt)>time(now))&&p.currency===t.currency&&p.merchantIds.includes(t.merchantId)&&t.amountMinor<=p.maxAmountMinor&&(time(t.deadline)-time(now))>=p.minLeadMinutes*60000}
export function authorize(t:Task,s:Scope,now=new Date().toISOString()){
 assert(t.state==='PLANNED','Not planned');assert(s.merchantId===t.merchantId&&s.amountMinor>=t.amountMinor&&s.currency===t.currency,'Payment scope does not cover task');assert(s.amountMinor>0&&time(s.expiresAt)>time(now)&&time(s.expiresAt)<=time(now)+2*3600000,'Scope must expire within two hours');assert(s.opaqueReference&&s.opaqueReference.length<300&&!/\b\d{13,19}\b/.test(s.opaqueReference),'Only opaque token references, never card details');
 t.scope={...s};move(t,'AUTH_SCOPED','Narrow payment scope attached, not charged',now);return t;
}
export function charge(t:Task,result:ChargeResult,now=new Date().toISOString()){
 assert(t.state==='AUTH_SCOPED'||t.state==='CHARGING','Not chargeable');assert(t.scope&&time(t.scope.expiresAt)>time(now),'Payment scope expired');assert(t.attempts<3,'Circuit breaker: maximum three charge attempts');
 if(t.state==='AUTH_SCOPED')move(t,'CHARGING','Attempting charge via external adapter',now);
 t.attempts++;
 if(result.kind==='accepted'){assert(result.merchantOrderId===t.orderId,'Merchant order ID mismatch');move(t,'VERIFYING','Charge accepted, settlement not yet verified',now)}
 else if(result.kind==='uncertain')move(t,'SETTLEMENT_UNKNOWN',result.code||'Charge outcome unknown',now);
 else if(t.attempts===3)move(t,'FAILED',result.code||'Card declined after three attempts',now);
 else move(t,'CHARGING',result.code||'Card declined; retry eligible only after backoff',now);
 return t;
}
export function retryDelayMs(attempts:number){assert(attempts>=1&&attempts<3,'Circuit breaker open');return 1000*2**attempts}
export function verify(t:Task,r:Receipt,now=new Date().toISOString()){
 assert(t.state==='VERIFYING','Not awaiting verification');assert(r.authenticatedSender,'Unauthenticated receipt sender');
 if(!r.messageId||r.source!=='gmail'||r.merchantId!==t.merchantId||r.amountMinor!==t.amountMinor||r.currency!==t.currency||r.orderId!==t.orderId||time(r.pickupAt)!==time(t.pickupAt)){
  move(t,'SETTLEMENT_UNKNOWN','Receipt fields do not match task',now);return t;
 }
 t.receipt={...r};move(t,'VERIFIED','Authenticated receipt matches merchant, amount, order and pickup',now,r.messageId);return t;
}
export function expireVerification(t:Task,now=new Date().toISOString()){if(t.state==='VERIFYING'&&time(now)>=time(t.deadline))move(t,'SETTLEMENT_UNKNOWN','No matching merchant confirmation by deadline',now);return t}
export function alert(t:Task,error:string,now=new Date().toISOString(),options=['Retry with a different approved card','Contact the merchant']){
 assert(t.state==='FAILED'||t.state==='SETTLEMENT_UNKNOWN','Only failures and uncertain settlements alert');const minutesLeft=Math.max(0,Math.floor((time(t.deadline)-time(now))/60000));
 for(const channel of ['push','sms','in_chat'] as const)t.notices.push({channel,status:'unavailable',at:now,error,minutesLeft,options:options.slice(0,2)});
 return t.notices.slice(-3); // Intent only. Do not claim delivery until an adapter confirms it.
}
export interface Store{load(ownerId:string,id:string):Promise<{value:Task;version:number}|null>;save(t:Task,expectedVersion:number):Promise<void>}
export interface ChargeAdapter{charge(t:Readonly<Task>,scope:Scope,idempotencyKey:string):Promise<ChargeResult>}
export interface AlertAdapter{send(ownerId:string,notice:Notice):Promise<{status:'sent'|'failed';reference?:string}>}
