import {createHash} from 'node:crypto';
import type {TaskRow,SimulationPaymentAdapter,PaymentResult,DB} from './engine-types';
/** Durable simulation ledger. No network/payment library, credential or card input. */
export class SimulatedPayment implements SimulationPaymentAdapter{
 readonly mode='SIMULATED' as const;
 constructor(private db:DB,private scenario:'success'|'decline'|'timeout'|'crash_after_accept'='success'){}
 async initialize(){await this.db.query(`create table if not exists nines.simulation_ledger(owner text not null,key text not null,result jsonb not null,primary key(owner,key))`)}
 async lookup(owner:string,key:string){const r=await this.db.query<{result:PaymentResult}>('select result from nines.simulation_ledger where owner=$1 and key=$2',[owner,key]);return r.rows[0]?.result??null}
 async charge(t:TaskRow,key:string){
  if(this.mode!=='SIMULATED'||key!==t.idempotency_key||t.scope?.mode!=='SIMULATED'||Date.parse(t.scope.expiresAt)<=Date.now())throw Error('Simulation scope invalid');
  const old=await this.lookup(t.owner,key);if(old)return old;
  const result:PaymentResult={mode:'SIMULATED',kind:this.scenario==='decline'?'declined':this.scenario==='timeout'?'uncertain':'accepted',code:this.scenario==='decline'?'CARD_DECLINED':this.scenario==='timeout'?'TIMEOUT':'ACCEPTED',merchantOrderId:t.final_order.orderId,providerReference:'sim_'+createHash('sha256').update(t.owner+':'+key).digest('hex').slice(0,32),retrySafe:this.scenario==='decline'};
  await this.db.query('insert into nines.simulation_ledger(owner,key,result) values($1,$2,$3) on conflict do nothing',[t.owner,key,JSON.stringify(result)]);
  if(this.scenario==='crash_after_accept')throw Error('Simulated process crash after provider acceptance');
  return (await this.lookup(t.owner,key))!;
 }
}
