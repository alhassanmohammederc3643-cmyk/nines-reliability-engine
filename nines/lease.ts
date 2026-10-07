/** Durable Nines worker preparation. No payment adapter is imported or called. */
import {randomUUID} from 'node:crypto';
export class LeaseLost extends Error{constructor(){super('Nines task lease lost; stop work and inspect task state.')}}
export type Lease={owner:string;taskId:string;leaseId:string;version:number;expiresAt:string};
export type TaskSnapshot={id:string;user_email:string;version:number;state:string;deadline:string;lease_id:string|null;lease_until:string|null;effect_started_at:string|null;reconciliation_required:boolean};
export interface LeaseStore{
 get(owner:string,id:string):Promise<TaskSnapshot|null>;
 claim(owner:string,id:string,version:number,leaseId:string,seconds:number):Promise<number>;
 renew(owner:string,id:string,version:number,leaseId:string,seconds:number):Promise<number>;
}
export async function claimPreparation(store:LeaseStore,owner:string,id:string,now:Date,seconds=60):Promise<Lease|null>{
 if(!Number.isInteger(seconds)||seconds<10||seconds>300)throw Error('Invalid lease duration');
 const task=await store.get(owner,id);
 if(!task||task.user_email!==owner||!['PLANNED','AUTH_SCOPED','VERIFYING'].includes(task.state)||task.effect_started_at||task.reconciliation_required||!(Date.parse(task.deadline)>now.getTime()))return null;
 const leaseId=randomUUID();
 if(await store.claim(owner,id,task.version,leaseId,seconds)!==1)return null;
 return {owner,taskId:id,leaseId,version:task.version+1,expiresAt:new Date(now.getTime()+seconds*1000).toISOString()};
}
export async function renewPreparation(store:LeaseStore,lease:Lease,now:Date,seconds=60):Promise<Lease>{
 if(!Number.isInteger(seconds)||seconds<10||seconds>300||!(Date.parse(lease.expiresAt)>now.getTime()))throw new LeaseLost();
 if(await store.renew(lease.owner,lease.taskId,lease.version,lease.leaseId,seconds)!==1)throw new LeaseLost();
 return {...lease,version:lease.version+1,expiresAt:new Date(now.getTime()+seconds*1000).toISOString()};
}
export async function assertCurrent(store:LeaseStore,lease:Lease,now:Date):Promise<TaskSnapshot>{
 const task=await store.get(lease.owner,lease.taskId);
 if(!task||task.user_email!==lease.owner||task.lease_id!==lease.leaseId||task.version!==lease.version||!['PLANNED','AUTH_SCOPED','VERIFYING'].includes(task.state)||!task.lease_until||!(Date.parse(task.lease_until)>now.getTime())||!(Date.parse(task.deadline)>now.getTime())||task.effect_started_at||task.reconciliation_required)throw new LeaseLost();
 return task;
}
// A lost lease after an outside request began is NEVER requeued here. Reconciliation is manual and separate.
