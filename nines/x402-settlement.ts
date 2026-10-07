import {createPublicClient,http,parseAbiItem} from 'viem';
import {base} from 'viem/chains';
import type {SettlementVerifier} from './x402-real';
/** Read-only chain proof; response headers alone never establish settlement. */
export class BaseUSDCSettlement implements SettlementVerifier{
 private client;
 constructor(rpcUrl:string){const u=new URL(rpcUrl);if(u.protocol!=='https:')throw Error('HTTPS RPC required');this.client=createPublicClient({chain:base,transport:http(rpcUrl,{retryCount:0,timeout:15000})})}
 async verify(i:Parameters<SettlementVerifier['verify']>[0]){
  if(i.network!=='eip155:8453'||!/^0x[0-9a-fA-F]{64}$/.test(i.transaction))return false;
  const receipt=await this.client.getTransactionReceipt({hash:i.transaction as `0x${string}`});if(receipt.status!=='success')return false;
  const logs=await this.client.getLogs({address:i.asset as `0x${string}`,event:parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),fromBlock:receipt.blockNumber,toBlock:receipt.blockNumber});
  return logs.some(l=>l.transactionHash===receipt.transactionHash&&l.args.from?.toLowerCase()===i.from.toLowerCase()&&l.args.to?.toLowerCase()===i.to.toLowerCase()&&l.args.value===BigInt(i.amountAtomic));
 }
}
