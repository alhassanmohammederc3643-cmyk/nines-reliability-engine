import type {Task} from './core';
/** A timing plan, not a scheduler. Caller must persist and schedule these checkpoints. */
export function checkpoints(t:Task,now=new Date().toISOString()){
 const deadline=Date.parse(t.deadline),current=Date.parse(now);
 if(!Number.isFinite(deadline)||!Number.isFinite(current))throw Error('Invalid deadline');
 const lead=Math.max(0,deadline-current);
 const alertAt=deadline-Math.min(45*60000,Math.floor(lead/2));
 const verifyAt=deadline-Math.min(20*60000,Math.floor(lead/3));
 return {verifyAt:new Date(Math.max(current,verifyAt)).toISOString(),alertAt:new Date(Math.max(current,alertAt)).toISOString(),deadline:t.deadline};
}
