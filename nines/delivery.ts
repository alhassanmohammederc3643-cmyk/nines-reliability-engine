import type {DB,SessionVerifier} from './engine-types';
export class DisabledDeliveryLedger{
 constructor(private db:DB,private sessions:SessionVerifier){}
 async intents(session:string){const p=await this.sessions.resolve(session);if(!p)throw Error('Authentication required');return (await this.db.query('select id,channel,status,payload,provider_reference from nines.outbox where owner=$1',[p.owner])).rows}
 async send():Promise<never>{throw Error('Real sends disabled; a reviewed communication grant and provider integration are required')}
}
