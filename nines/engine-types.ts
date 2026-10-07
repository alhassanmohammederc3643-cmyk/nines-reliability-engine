import type {FinalOrder} from './review';
export type Principal={owner:string;sessionId:string;authenticatedAt:string};
/** The host must supply this verifier from its actual signed-member session middleware.
 * Request JSON, chat content and owner headers must never create a Principal. */
export interface SessionVerifier{resolve(session:string):Promise<Principal|null>}
export interface DB{query<T=Record<string,unknown>>(sql:string,params?:unknown[]):Promise<{rows:T[]}>;transaction<T>(fn:(tx:DB)=>Promise<T>):Promise<T>}
export type TaskRow={id:string;owner:string;request_key:string;final_order:FinalOrder;connection_id:string;target_version:string;state:string;version:number;idempotency_key:string;attempts:number;next_retry_at:Date|null;lease_id:string|null;lease_until:Date|null;effect_started_at:Date|null;reconciliation_required:boolean;scope:SimScope|null;provider_result:PaymentResult|null;receipt_id:string|null;verify_by:Date|null;alert_at:Date|null};
export type SimScope={mode:'SIMULATED';merchantId:string;amountMinor:number;currency:string;expiresAt:string;reference:string};
export type PaymentResult={mode:'SIMULATED';kind:'accepted'|'declined'|'uncertain';code:string;merchantOrderId:string;providerReference:string;retrySafe:boolean};
export interface SimulationPaymentAdapter{readonly mode:'SIMULATED';charge(task:TaskRow,key:string):Promise<PaymentResult>;lookup(owner:string,key:string):Promise<PaymentResult|null>}
export type Mail={owner:string;connectionId:string;providerAccount:string;messageId:string;from:string;receivedAt:string;body:string;auth:{trustedGateway:boolean;dkim:boolean;dmarc:boolean;alignedDomain:string}};
export interface ReceiptSource{readonly mode:'OFFLINE';list(owner:string,connection:string,cursor:string|null):Promise<{messages:Mail[];cursor:string}>}
export type HostConfig={mode:'SIMULATED';realCharges:false;realSends:false;policiesEnabled:false;verificationReserveSeconds:number};
