import type {DB} from './engine-types';
import type {RealStore,Quote,ChargeApproval} from './x402-real';
/** Persists one-use exact charge review. Requires authenticated host to construct approval from original reviewed consent. */
export class PostgresX402Store implements RealStore{
 constructor(private db:DB){}
 async saveQuote(q:Quote){await this.db.query('insert into nines.x402_quotes(id,owner,task_id,quote,hash) values($1,$2,$3,$4,$5)',[q.id,q.owner,q.taskId,JSON.stringify(q),q.hash])}
 async getQuote(owner:string,id:string){return (await this.db.query<{quote:Quote}>('select quote from nines.x402_quotes where owner=$1 and id=$2',[owner,id])).rows[0]?.quote??null}
 async claimApprovedEffect(q:Quote,a:ChargeApproval){return this.db.transaction(async db=>{
  const consent=await db.query<{approval:ChargeApproval}>('select approval from nines.charge_consents where owner=$1 and quote_id=$2 and quote_hash=$3 and consumed_at is null for update',[q.owner,q.id,q.hash]);
  if(!consent.rows[0]||JSON.stringify(consent.rows[0].approval)!==JSON.stringify(a)){
   // PostgreSQL jsonb reorders object keys; compare the exact reviewed fields, not insertion order.
   const stored=consent.rows[0]?.approval;if(!stored||stored.quoteId!==a.quoteId||stored.owner!==a.owner||stored.hash!==a.hash||stored.wallet!==a.wallet||stored.approvedAt!==a.approvedAt||stored.ownerEvidence!==a.ownerEvidence)return false;
  }
  const r=await db.query("update nines.x402_quotes set state='CHARGING',approval=$5 where owner=$1 and id=$2 and hash=$3 and quote=$4::jsonb and state='PLANNED' and (quote->>'expiresAt')::timestamptz>clock_timestamp() returning id",[q.owner,q.id,q.hash,JSON.stringify(q),JSON.stringify(a)]);
  if(r.rows.length!==1)return false;await db.query('update nines.charge_consents set consumed_at=clock_timestamp() where owner=$1 and quote_id=$2',[q.owner,q.id]);return true;
 })}

 async storeSignedPayload(owner:string,id:string,payload:unknown){const r=await this.db.query("update nines.x402_quotes set signed_payload=$3 where owner=$1 and id=$2 and state='CHARGING' and signed_payload is null returning id",[owner,id,JSON.stringify(payload)]);if(r.rows.length!==1)throw Error('Signed payload replay')}
 async markSubmitted(owner:string,id:string){const r=await this.db.query("update nines.x402_quotes set submitted_at=clock_timestamp() where owner=$1 and id=$2 and state='CHARGING' and signed_payload is not null and submitted_at is null returning id",[owner,id]);return r.rows.length===1}
 async recordOutcome(owner:string,id:string,result:Parameters<RealStore['recordOutcome']>[2]){if(!['VERIFYING','VERIFIED','SETTLEMENT_UNKNOWN'].includes(result.state))throw Error('Invalid state');await this.db.query("update nines.x402_quotes set state=$3,outcome=$4 where owner=$1 and id=$2 and state in ('CHARGING','VERIFYING')",[owner,id,result.state,JSON.stringify(result)])}
}
