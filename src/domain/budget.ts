import {randomUUID} from 'node:crypto';
import type {Team,Message} from './types.ts';import {record} from './storage.ts';
export function setBudget(t:Team,input:unknown){
 if(input===null){delete t.budget;return;}
 if(!record(input)||Object.keys(input).some(k=>!['mode','dispatches','wakeups','durationMs'].includes(k))||!['warn','pause'].includes(String(input.mode)))throw Error('Invalid budget');
 for(const key of ['dispatches','wakeups','durationMs'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||Number(input[key])<1||Number(input[key])>(key==='durationMs'?86400000:10000)))throw Error('Invalid budget limit');
 t.budget={id:randomUUID(),mode:input.mode as 'warn'|'pause',...(input.dispatches?{dispatches:Number(input.dispatches)}:{}),...(input.wakeups?{wakeups:Number(input.wakeups)}:{}),...(input.durationMs?{durationMs:Number(input.durationMs)}:{}),startedAt:Date.now(),usedDispatches:0,usedWakeups:0};
}
export function budgetReason(t:Team,m:Message,now=Date.now()):string|undefined{
 const b=t.budget;if(!b||m.system)return;return b.dispatches!==undefined&&b.usedDispatches>=b.dispatches?'dispatches':m.wakeup!==false&&b.wakeups!==undefined&&b.usedWakeups>=b.wakeups?'wakeups':b.durationMs!==undefined&&now-b.startedAt>=b.durationMs?'duration':undefined;
}
export function reserveBudget(t:Team,m:Message){
 const b=t.budget;if(!b||m.system)return;
 b.usedDispatches++;
 if(m.wakeup!==false){b.id??=randomUUID();m.wakeBudget=b.id;}
}
export function settleWake(t:Team|undefined,m:Message,queued:boolean){
 if(!m.wakeBudget)return;
 if(queued&&t?.budget?.id===m.wakeBudget)t.budget.usedWakeups++;
 delete m.wakeBudget;
}
