import {createHash} from 'node:crypto';
import type {FinalOrder} from './review';
import {prepareReview} from './review';
const fields=['merchantId','orderId','itemSummary','amountMinor','currency','deliveryAddress','pickupAt','deadline','cancellationTerms','undoCostMinor'] as const;
export function normalizeOrder(input:FinalOrder,now=new Date()):FinalOrder{
 prepareReview('validation',input,'simulation','v1',now);
 for(const k of ['pickupAt','deadline'] as const)if(new Date(input[k]).toISOString()!==input[k])throw Error('Dates must use exact UTC ISO milliseconds');
 if(input.pickupAt>input.deadline)throw Error('Pickup must not follow deadline');
 return Object.fromEntries(fields.map(k=>[k,input[k]])) as FinalOrder;
}
export function boundHash(owner:string,order:FinalOrder,connection:string,target:string){
 const vals=[owner,connection,target,...fields.map(k=>String(order[k]))];
 return createHash('sha256').update(vals.map(v=>`${Buffer.byteLength(v,'utf8')}:${v}`).join('')).digest('hex');
}
export function requireText(s:string,label:string){if(typeof s!=='string'||!s.trim()||s.length>500)throw Error(`Invalid ${label}`);return s}
