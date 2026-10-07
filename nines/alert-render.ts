import type {Task,Notice} from './core';
/** Text only. Return to main/owner for approval and delivery, never auto-send via an unrelated channel. */
export function alertText(t:Task,n:Notice):string{
 if(!['FAILED','SETTLEMENT_UNKNOWN'].includes(t.state))throw Error('No failure to alert');
 if(n.options.length!==2||!n.error)throw Error('Error and two recovery options required');
 const status=t.state==='SETTLEMENT_UNKNOWN'?'Payment or order status is unknown':'Task failed';
 return `${status} for ${t.merchantId} (order ${t.orderId}). Error: ${n.error}. ${n.minutesLeft} minute${n.minutesLeft===1?'':'s'} left before ${t.deadline}. Options: 1) ${n.options[0]}; 2) ${n.options[1]}. Do not retry a possibly charged order until the merchant confirms its status.`;
}
