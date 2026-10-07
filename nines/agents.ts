import type {FinalOrder} from './review';
import {normalizeOrder} from './binding';
export interface AgentModel{plan(input:{goal:string;deadline:string;budgetMinor:number;currency:string}):Promise<unknown>}
export type AgentDraft={kind:'spend'|'deadline';order:FinalOrder;connection:string;target:string;reason:string};
/** Models propose. They cannot decide reviews, access signers, submit payments or send alerts. */
export class BudgetDeadlineAgent{
 constructor(private model:AgentModel){}
 async propose(goal:string,deadline:string,budgetMinor:number,currency:string):Promise<AgentDraft>{
  if(typeof goal!=='string'||!goal.trim()||!Number.isSafeInteger(budgetMinor)||budgetMinor<=0||!(Date.parse(deadline)>Date.now())||!/^[A-Z]{3}$/.test(currency))throw Error('Explicit goal/deadline/budget required');
  const value=await this.model.plan({goal,deadline,budgetMinor,currency});if(!value||typeof value!=='object')throw Error('Invalid agent proposal');const v=value as AgentDraft;
  if(!['spend','deadline'].includes(v.kind)||typeof v.reason!=='string'||typeof v.connection!=='string'||typeof v.target!=='string'||!v.connection.trim()||!v.target.trim())throw Error('Invalid agent proposal');
  const order=normalizeOrder(v.order);if(order.amountMinor>budgetMinor||order.currency!==currency||Date.parse(order.deadline)>Date.parse(deadline))throw Error('Agent exceeded owner constraints');
  return {kind:v.kind,order,connection:v.connection,target:v.target,reason:v.reason.slice(0,500)};
 }
}
