import type {Receipt,Task} from './core';
/** Parse only an authenticated, merchant-bound Gmail message. Sender display names and email body claims alone are not authentication. */
export function receiptFromEmail(input:{senderAddress:string;authenticatedSender:boolean;messageId:string;plainText:string},task:Task,merchantAddresses:string[]):Receipt|null{
 if(!input.authenticatedSender||!merchantAddresses.map(x=>x.toLowerCase()).includes(input.senderAddress.toLowerCase()))return null;
 const body=input.plainText.slice(0,20000);
 const esc=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(!new RegExp(`(?:^|\\W)${esc(task.orderId)}(?:$|\\W)`,'m').test(body))return null;
 const amount=(task.amountMinor/100).toFixed(2),currency=task.currency;
 if(!new RegExp(`(?:^|\\W)${esc(currency)}\\s*${esc(amount)}(?:$|\\W)`,'i').test(body))return null;
 if(!body.toLowerCase().includes(task.merchantId.toLowerCase()))return null;
 if(!body.includes(task.pickupAt))return null; // Strict ISO match: ambiguity stays unresolved.
 return {source:'gmail',authenticatedSender:true,sender:input.senderAddress,messageId:input.messageId,merchantId:task.merchantId,amountMinor:task.amountMinor,currency:task.currency,orderId:task.orderId,pickupAt:task.pickupAt};
}
