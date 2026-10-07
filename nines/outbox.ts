import type {Notice,Task} from './core';
/** Outbound alerts are intents only. A durable store and provider receipts are mandatory before enabling. */
export type OutboxItem={id:string;ownerId:string;taskId:string;channel:Notice['channel'];payload:Notice;status:'pending'|'confirmed'|'failed';providerReference?:string};
export function makeOutbox(t:Task,notices:Notice[]):OutboxItem[]{
 if(!['FAILED','SETTLEMENT_UNKNOWN'].includes(t.state))throw Error('No failure to alert');
 return notices.map(n=>({id:`${t.id}:${n.channel}:${n.at}`,ownerId:t.ownerId,taskId:t.id,channel:n.channel,payload:n,status:'pending'}));
}
export function confirmDelivery(i:OutboxItem,reference:string){if(!reference)throw Error('Provider receipt required');return {...i,status:'confirmed' as const,providerReference:reference}}
