import {createHash,timingSafeEqual} from 'node:crypto';
import type {DB,Principal,SessionVerifier} from './engine-types';
import type {Quote,ChargeApproval} from './x402-real';
/** Requires a human-presence proof (for example WebAuthn user verification), not merely signed-in chat/API access.
 * Host MUST implement and verify this proof before real charging is enabled. */
export interface HumanPresenceVerifier{verify(input:{owner:string;sessionId:string;quoteHash:string;proof:unknown}):Promise<{verified:boolean;evidenceRef:string}>}
export interface QuoteReader{getQuote(owner:string,id:string):Promise<Quote|null>}
export type ConsentContext={session:string;origin:string;csrfToken:string;expectedCsrfToken:string};
export type ConsentInput={quoteId:string;quoteHash:string;wallet:string;amountAtomic:string;recipient:string;network:string;asset:string;resource:string;refundTerms:string;confirmExactCharge:true;humanProof:unknown};
function eq(a:string,b:string){if(typeof a!=='string'||typeof b!=='string')return false;const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&aa.length>0&&timingSafeEqual(aa,bb)}
export class ChargeConsentHost{
 constructor(private db:DB,private sessions:SessionVerifier,private presence:HumanPresenceVerifier,private quotes:QuoteReader,private allowedOrigin:string){}
 private async principal(c:ConsentContext):Promise<Principal>{
  if(c.origin!==this.allowedOrigin||!eq(c.csrfToken,c.expectedCsrfToken))throw Error('Origin/CSRF mismatch');const p=await this.sessions.resolve(c.session);if(!p||!p.owner||!p.sessionId)throw Error('Sign in first');return p;
 }
 async capture(c:ConsentContext,input:ConsentInput):Promise<ChargeApproval>{
  const p=await this.principal(c),q=await this.quotes.getQuote(p.owner,input.quoteId);
  if(!q||!Number.isFinite(Date.parse(q.expiresAt))||Date.parse(q.expiresAt)<=Date.now()||input.confirmExactCharge!==true||input.quoteHash!==q.hash||input.wallet.toLowerCase()!==q.wallet.toLowerCase()||input.recipient.toLowerCase()!==q.payTo.toLowerCase()||input.amountAtomic!==q.amountAtomic||input.network!==q.network||input.asset.toLowerCase()!==q.asset.toLowerCase()||input.resource!==q.url||input.refundTerms!==q.undoTerms)throw Error('Displayed final charge changed or incomplete');
  const proof=await this.presence.verify({owner:p.owner,sessionId:p.sessionId,quoteHash:q.hash,proof:input.humanProof});if(!proof.verified||!proof.evidenceRef)throw Error('Verified human presence required');
  const again=await this.principal(c);if(again.owner!==p.owner||again.sessionId!==p.sessionId||Date.parse(q.expiresAt)<=Date.now())throw Error('Session/quote changed during human verification');
  const at=new Date().toISOString(),evidence=createHash('sha256').update(JSON.stringify({owner:p.owner,session:p.sessionId,quote:q.id,hash:q.hash,proof:proof.evidenceRef,at})).digest('hex');
  const approval:ChargeApproval={quoteId:q.id,owner:p.owner,hash:q.hash,wallet:q.wallet,approvedAt:at,ownerEvidence:`human-charge-consent:${evidence}`};
  await this.db.query('insert into nines.charge_consents(owner,quote_id,quote_hash,approval,displayed_charge,presence_evidence) values($1,$2,$3,$4,$5,$6)',[p.owner,q.id,q.hash,JSON.stringify(approval),JSON.stringify({what:q.url,amountAtomic:q.amountAtomic,network:q.network,asset:q.asset,recipient:q.payTo,wallet:q.wallet,refundTerms:q.undoTerms}),proof.evidenceRef]);return approval;
 }
 async read(c:ConsentContext,quoteId:string){const p=await this.principal(c);return (await this.db.query<{approval:ChargeApproval}>('select approval from nines.charge_consents where owner=$1 and quote_id=$2 and consumed_at is null',[p.owner,quoteId])).rows[0]?.approval??null}
}
