import type {AgentModel} from './agents';
/** Optional real model connector. The caller supplies its own already-approved model account/key.
 * No paid model invocation is made by merely importing or constructing this adapter. */
export class OpenAICompatiblePlanner implements AgentModel{
 constructor(private endpoint:string,private model:string,private apiKey:string,private transport:typeof fetch=fetch){const u=new URL(endpoint);if(u.protocol!=='https:')throw Error('HTTPS model endpoint required')}
 async plan(input:Parameters<AgentModel['plan']>[0]){
  const response=await this.transport(this.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','Authorization':`Bearer ${this.apiKey}`},body:JSON.stringify({model:this.model,response_format:{type:'json_object'},messages:[{role:'system',content:'Propose one JSON object only. You cannot approve, pay, sign, send, or claim completion. Return kind (spend or deadline), reason, connection, target, order. order has exactly merchantId, orderId, itemSummary, amountMinor, currency, deliveryAddress, pickupAt, deadline, cancellationTerms, undoCostMinor. Use UTC ISO milliseconds. Never invent merchant availability, quotes, connections, cancellation terms or fees. If the input lacks those facts, return an error object instead of an order.'},{role:'user',content:JSON.stringify(input)}]})});
  if(!response.ok)throw Error('Model request failed');const result=await response.json() as {choices?:{message?:{content?:string}}[]};const text=result.choices?.[0]?.message?.content;if(!text||text.length>30000)throw Error('Missing bounded model proposal');return JSON.parse(text);
 }
}
