import type {Task,Receipt} from './core';
import {receiptFromEmail} from './receipt';
/** Adapter boundary, deliberately not bound to a live Gmail token or search. */
export type ProviderMail={messageId:string;fromAddress:string;plainText:string;receivedAt:string;labels:string[];authResults:{spf:'pass'|'fail'|'none';dkim:'pass'|'fail'|'none';dmarc:'pass'|'fail'|'none'}};
export interface MailReader{getMessage(ownerId:string,messageId:string):Promise<ProviderMail|null>}
export function parseProviderReceipt(t:Task,m:ProviderMail,merchantAddresses:string[]):Receipt|null{
 if(t.ownerId===''||!m.messageId||!Number.isFinite(Date.parse(m.receivedAt))||!m.labels.includes('INBOX'))return null;
 const authenticated=m.authResults.dmarc==='pass'&&m.authResults.dkim==='pass';
 return receiptFromEmail({senderAddress:m.fromAddress,authenticatedSender:authenticated,messageId:m.messageId,plainText:m.plainText},t,merchantAddresses);
}
