import {randomUUID} from 'node:crypto';import type {Team,ControlGrant} from './types.ts';import {CoordinationError} from './errors.ts';
export function grantControl(team:Team,from:string,to:string,expiresAt:number):ControlGrant{
 if(from===to||![from,to].every(id=>team.members.some(m=>m.sessionId===id&&m.active!==false))||!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+86400000)throw Error('Control grant requires distinct active members and expiry within one day');
 if((team.controlGrants?.length??0)>=200)throw Error('请先撤销已失效授权，最多保留 200 项');
 const grant:ControlGrant={id:randomUUID(),from,to,operation:'interrupt',expiresAt,epoch:team.epoch!,source:'user'};(team.controlGrants??=[]).push(grant);return grant;
}
export function validGrant(team:Team,caller:string,target:string,id:string):ControlGrant{
 const grant=team.controlGrants?.find(g=>g.id===id&&g.from===caller&&g.to===target&&g.epoch===team.epoch&&g.expiresAt>Date.now()&&!g.used&&g.source==='user');
 if(!grant||team.paused||![caller,target].every(id=>team.members.some(m=>m.sessionId===id&&m.active!==false)))throw new CoordinationError('CONTROL_DENIED','没有当前批次、目标与操作的有效用户授权');return grant;
}
