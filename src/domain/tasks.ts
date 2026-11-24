import {randomUUID} from 'node:crypto';
import type {TaskClaim,Team} from './types.ts';
import {CoordinationError} from './errors.ts';
import {string} from './storage.ts';
import {evidence} from './ledger.ts';
export function taskAction(t:Team,caller:string,key:string,action:string,expected:number,input:{ttlMs?:number;target?:string;offerId?:string;note?:string;evidence?:string[]},now=Date.now()):TaskClaim{
 if(!t.epoch)throw new CoordinationError('STALE_EPOCH','请重新载入团队');
 string(key,'task key',100);if(!Number.isSafeInteger(expected)||expected<0)throw Error('Invalid expected revision');
 const old=t.tasks?.find(x=>x.key===key);if((old?.revision??0)!==expected)throw new CoordinationError('REVISION_CONFLICT','任务归属已变化，请先重读');
 if(!old&&(t.tasks?.length??0)>=200)throw Error('Task limit reached');
 const task=old??{key,revision:0,history:[]},ttl=input.ttlMs??300000;if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>86400000)throw Error('Task TTL must be 1 second to 1 day');
 if(action==='claim'){if(task.epoch===t.epoch&&task.owner&&task.owner!==caller&&(task.expiresAt??0)>now)throw new CoordinationError('TASK_BUSY','任务由其他成员认领');task.epoch=t.epoch;task.owner=caller;task.expiresAt=now+ttl;delete task.offer;}
 else if(action==='accept'){const offer=task.offer,owner=t.members.find(m=>m.sessionId===task.owner);if(!offer||offer.epoch!==t.epoch||task.epoch!==t.epoch||offer.from!==task.owner||!owner||owner.active===false||!owner.operations.includes('send')||!owner.targets.includes(caller)||offer.target!==caller||offer.id!==input.offerId||(task.expiresAt??0)<=now)throw new CoordinationError('HANDOFF_STALE','交接已过期、批次或单向关系已变化');task.owner=caller;task.expiresAt=now+ttl;delete task.offer;}
 else{if(task.epoch!==t.epoch||task.owner!==caller||(task.expiresAt??0)<=now)throw new CoordinationError('TASK_OWNER','只有当前批次有效认领者可修改');
  if(action==='renew')task.expiresAt=now+ttl;
  else if(action==='release'){delete task.owner;delete task.expiresAt;delete task.offer;}
  else if(action==='offer'){if(input.target===caller||!t.members.some(m=>m.sessionId===input.target&&m.active!==false)||!t.members.find(m=>m.sessionId===caller)?.targets.includes(input.target!))throw Error('Handoff target outside directed scope');task.offer={id:randomUUID(),epoch:t.epoch,from:caller,target:input.target!,summary:string(input.note,'handoff summary',2000),evidence:evidence(input.evidence)};}
  else if(action==='cancel-offer')delete task.offer;else throw Error('Unknown task action');
 }
 task.revision++;task.history.push({revision:task.revision,time:now,actor:caller,action,note:(input.note??'').slice(0,2000)});if(task.history.length>500)task.history.splice(0,task.history.length-500);if(!old)(t.tasks??=[]).push(task);return task;
}
