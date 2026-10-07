/** Exact review records for Nines; these functions do not grant permission or call a provider. */
import {createHash,randomUUID} from 'node:crypto';
export type FinalOrder={merchantId:string;orderId:string;itemSummary:string;amountMinor:number;currency:string;deliveryAddress:string;pickupAt:string;deadline:string;cancellationTerms:string;undoCostMinor:number};
export type Review={id:string;owner:string;connectionId:string|null;providerTargetVersion:string|null;order:FinalOrder;hash:string;expiresAt:string;status:'awaiting_review'|'approved'|'denied'|'expired'};
const orderFields=['merchantId','orderId','itemSummary','amountMinor','currency','deliveryAddress','pickupAt','deadline','cancellationTerms','undoCostMinor'] as const;
function canonicalOrder(order:FinalOrder){
 if(!order||typeof order!=='object'||Object.keys(order).length!==orderFields.length||Object.keys(order).some(k=>!orderFields.includes(k as typeof orderFields[number])))throw Error('Incomplete final order');
 return Object.fromEntries(orderFields.map(k=>[k,order[k]]));
}
function validOrder(order:FinalOrder,now:Date):boolean{
 try{canonicalOrder(order)}catch{return false}
 const text=['merchantId','orderId','itemSummary','deliveryAddress','cancellationTerms'] as const;
 const pickup=Date.parse(order.pickupAt),deadline=Date.parse(order.deadline),clock=now.getTime();
 return text.every(k=>typeof order[k]==='string'&&order[k].trim().length>0)&&typeof order.currency==='string'&&/^[A-Z]{3}$/.test(order.currency)&&Number.isSafeInteger(order.amountMinor)&&order.amountMinor>0&&Number.isSafeInteger(order.undoCostMinor)&&order.undoCostMinor>=0&&Number.isFinite(clock)&&Number.isFinite(pickup)&&Number.isFinite(deadline)&&pickup>clock&&deadline>clock;
}
export function reviewHash(owner:string,order:FinalOrder,connectionId:string|null,providerTargetVersion:string|null){
 return createHash('sha256').update(JSON.stringify({owner,order:canonicalOrder(order),connectionId,providerTargetVersion})).digest('hex');
}
export function prepareReview(owner:string,order:FinalOrder,connectionId:string|null,providerTargetVersion:string|null,now=new Date()):Review{
 if(typeof owner!=='string'||!owner.trim()||!validOrder(order,now))throw Error('Incomplete final order');
 return {id:randomUUID(),owner,connectionId,providerTargetVersion,order:{...order},hash:reviewHash(owner,order,connectionId,providerTargetVersion),expiresAt:new Date(now.getTime()+30*60000).toISOString(),status:'awaiting_review'};
}
/** Callers must inspect actual authenticated owner approval separately. This only validates a stored record. */
export function validateReview(r:Review,owner:string,hash:string,connectionId:string|null,providerTargetVersion:string|null,now=new Date()):boolean{
 try{return validOrder(r.order,now)&&r.owner===owner&&r.status==='awaiting_review'&&r.hash===hash&&r.hash===reviewHash(r.owner,r.order,r.connectionId,r.providerTargetVersion)&&r.connectionId===connectionId&&r.providerTargetVersion===providerTargetVersion&&Date.parse(r.expiresAt)>now.getTime()}catch{return false}
}
export interface ReviewStore{claim(owner:string,id:string,expectedHash:string,expiresAt:string,status:'approved'|'denied'):Promise<Review|null>}
/** A successful single-row owner/hash/expiry/status CAS is required. Never treat a plain POST as approval. */
export async function claimReviewed(store:ReviewStore,r:Review,owner:string,hash:string,connectionId:string|null,providerTargetVersion:string|null,now=new Date(),decision:'approved'|'denied'='denied'){
 if(!validateReview(r,owner,hash,connectionId,providerTargetVersion,now))return null;
 const claimed=await store.claim(owner,r.id,hash,r.expiresAt,decision);
 if(!claimed||claimed.id!==r.id||claimed.expiresAt!==r.expiresAt||claimed.status!==decision)return null;
 return validateReview({...claimed,status:'awaiting_review'},owner,hash,connectionId,providerTargetVersion,now)?claimed:null;
}
