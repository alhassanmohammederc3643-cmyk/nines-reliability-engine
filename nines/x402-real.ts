import {createHash,randomUUID} from 'node:crypto';
import {x402Client,x402HTTPClient} from '@x402/core/client';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import type {PaymentRequired,PaymentRequirements} from '@x402/core/types';
import type {ClientEvmSigner} from '@x402/evm';
export const BASE='eip155:8453';
export const USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export type Quote={id:string;owner:string;taskId:string;url:string;method:'GET';wallet:`0x${string}`;requirements:PaymentRequirements;amountAtomic:string;payTo:string;network:string;asset:string;expiresAt:string;undoTerms:string;hash:string};
export type ChargeApproval={quoteId:string;owner:string;hash:string;wallet:string;approvedAt:string;ownerEvidence:string};
export interface RealStore{
 saveQuote(q:Quote):Promise<void>;
 getQuote(owner:string,id:string):Promise<Quote|null>;
 claimApprovedEffect(q:Quote,a:ChargeApproval):Promise<boolean>;
 storeSignedPayload(owner:string,id:string,payload:unknown):Promise<void>;
 markSubmitted(owner:string,id:string):Promise<boolean>;
 recordOutcome(owner:string,id:string,result:{state:'VERIFYING'|'VERIFIED'|'SETTLEMENT_UNKNOWN';transaction?:string;error?:string}):Promise<void>;
}
export interface SettlementVerifier{verify(input:{network:string;asset:string;transaction:string;from:string;to:string;amountAtomic:string}):Promise<boolean>}
function qhash(q:Omit<Quote,'hash'>){return createHash('sha256').update(JSON.stringify([q.id,q.owner,q.taskId,q.url,q.method,q.wallet.toLowerCase(),q.amountAtomic,q.payTo.toLowerCase(),q.network,q.asset.toLowerCase(),q.expiresAt,q.undoTerms,[q.requirements.scheme,q.requirements.network,q.requirements.asset.toLowerCase(),q.requirements.amount,q.requirements.payTo.toLowerCase(),q.requirements.maxTimeoutSeconds,q.requirements.extra?.name,q.requirements.extra?.version,q.requirements.extra?.assetTransferMethod]])).digest('hex')}
function urlAllowed(url:string,origins:string[]){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||!origins.includes(u.origin))throw Error('Endpoint outside verified allowlist');return u}
/** Real protocol implementation, deliberately separate from the simulated engine.
 * prepare is unsigned. execute requires a fresh exact-charge approval and atomic durable effect claim.
 * No signer/key is acquired by this module. Caller supplies a secure signer only after owner approval. */
export class X402RealAdapter{
 constructor(private store:RealStore,private settlement:SettlementVerifier,private origins:string[],private transport:typeof fetch=fetch){}
 async prepare(owner:string,taskId:string,url:string,wallet:`0x${string}`):Promise<Quote>{
  urlAllowed(url,this.origins);if(!owner.trim()||!taskId||!/^0x[0-9a-fA-F]{40}$/.test(wallet))throw Error('Owner/task/wallet required');
  const response=await this.transport(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(response.status!==402)throw Error('Expected an unsigned 402 challenge');
  const h=response.headers.get('PAYMENT-REQUIRED');if(!h||h.length>100000)throw Error('Missing bounded payment challenge');
  const p=JSON.parse(Buffer.from(h,'base64').toString()) as PaymentRequired;
  if(p.x402Version!==2||p.resource?.url!==url||!Array.isArray(p.accepts))throw Error('Unsupported or changed resource');
  const r=p.accepts.find(r=>r.scheme==='exact'&&r.network===BASE&&r.asset.toLowerCase()===USDC.toLowerCase());
  if(!r||!/^\d+$/.test(r.amount)||BigInt(r.amount)<=0n||!/^0x[0-9a-fA-F]{40}$/.test(r.payTo)||!Number.isInteger(r.maxTimeoutSeconds)||r.maxTimeoutSeconds<1||r.maxTimeoutSeconds>7200)throw Error('No bounded exact native-USDC Base offer');
  if(r.extra?.assetTransferMethod&&r.extra.assetTransferMethod!=='eip3009')throw Error('Only EIP-3009 supported, no Permit2 approvals');
  if(r.extra?.name!=='USD Coin'||r.extra?.version!=='2')throw Error('Unverified token typed-data domain');
  const clean:PaymentRequirements={scheme:'exact',network:BASE,asset:USDC,amount:r.amount,payTo:r.payTo,maxTimeoutSeconds:Math.min(r.maxTimeoutSeconds,300),extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009'}};
  const q0:Omit<Quote,'hash'>={id:randomUUID(),owner,taskId,url,method:'GET',wallet,requirements:clean,amountAtomic:clean.amount,payTo:clean.payTo,network:BASE,asset:USDC,expiresAt:new Date(Date.now()+300000).toISOString(),undoTerms:'On-chain USDC transfer has no automatic refund. Merchant refund is separate.'};
  const q={...q0,hash:qhash(q0)};await this.store.saveQuote(q);return q;
 }
 async execute(owner:string,quoteId:string,approval:ChargeApproval,signer:ClientEvmSigner){
  const q=await this.store.getQuote(owner,quoteId);if(!q)throw Error('Quote unavailable');const {hash,...unsigned}=q;
  if(q.owner!==owner||hash!==qhash(unsigned)||approval.owner!==owner||approval.quoteId!==q.id||approval.hash!==hash||approval.wallet.toLowerCase()!==q.wallet.toLowerCase()||signer.address.toLowerCase()!==q.wallet.toLowerCase()||!approval.ownerEvidence.trim()||!(Date.parse(approval.approvedAt)<=Date.now())||Date.parse(q.expiresAt)<=Date.now()||Date.now()-Date.parse(approval.approvedAt)>300000)throw Error('Exact charge approval or signer invalid');
  urlAllowed(q.url,this.origins);
  // Claim and audit before signing: signature creation itself is wallet-bearing authority.
  if(!await this.store.claimApprovedEffect(q,approval))throw Error('Approval replay or task state changed');
  try{
   const client=new x402Client().register(BASE,new ExactEvmScheme(signer));const http=new x402HTTPClient(client);
   const payload=await http.createPaymentPayload({x402Version:2,resource:{url:q.url,description:'Owner-reviewed paid API request',mimeType:'application/json'},accepts:[q.requirements]});
   await this.store.storeSignedPayload(owner,q.id,payload);if(!await this.store.markSubmitted(owner,q.id))throw Error('Submission already attempted');
   const response=await this.transport(q.url,{method:'GET',redirect:'error',headers:http.encodePaymentSignatureHeader(payload),signal:AbortSignal.timeout(15000)});
   const settled=http.getPaymentSettleResponse(name=>response.headers.get(name));
   if(!response.ok||!settled.success||settled.network!==BASE||!settled.transaction||settled.payer?.toLowerCase()!==q.wallet.toLowerCase()){await this.store.recordOutcome(owner,q.id,{state:'SETTLEMENT_UNKNOWN',error:'Response or settlement evidence incomplete'});return {state:'SETTLEMENT_UNKNOWN' as const}}
   await this.store.recordOutcome(owner,q.id,{state:'VERIFYING',transaction:settled.transaction});
   const verified=await this.settlement.verify({network:BASE,asset:USDC,transaction:settled.transaction,from:q.wallet,to:q.payTo,amountAtomic:q.amountAtomic});
   const state=verified?'VERIFIED':'SETTLEMENT_UNKNOWN';await this.store.recordOutcome(owner,q.id,{state,transaction:settled.transaction});return {state,transaction:settled.transaction};
  }catch{await this.store.recordOutcome(owner,q.id,{state:'SETTLEMENT_UNKNOWN',error:'Signing/submission/verification interrupted; reconcile without creating a new authorization'});return {state:'SETTLEMENT_UNKNOWN' as const}}
 }
}
