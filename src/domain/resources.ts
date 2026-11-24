import {randomUUID} from 'node:crypto';
import type {State,ToolResource,AccessMode,ToolLease,ResourceOperation} from './types.ts';
import {CoordinationError} from './errors.ts';
import {record,string} from './storage.ts';
function error(code:string,message:string):never{throw new CoordinationError(code,message,code==='RESOURCE_BUSY');};
export function validateResources(s:State):void{
 s.resources??=[];if(!Array.isArray(s.resources)||s.resources.length>100)throw Error('Invalid resource registry');
 const ids=new Set<string>(),instances=new Set<string>(),bindings=new Set<string>();
 for(const r of s.resources){if(!record(r)||typeof r.id!=='string'||!r.id||ids.has(r.id)||typeof r.instance!=='string'||!r.instance||instances.has(r.instance)||typeof r.label!=='string'||!['advisory','guarded'].includes(r.mode)||!Number.isInteger(r.maxReaders)||r.maxReaders<1||r.maxReaders>32||!Number.isSafeInteger(r.revision)||r.revision<1||!Number.isSafeInteger(r.generation)||!Array.isArray(r.bindings)||!Array.isArray(r.operations)||!Array.isArray(r.leases)||!Array.isArray(r.history))throw Error('Invalid resource');ids.add(r.id);instances.add(r.instance);
  if(r.bindings.length>100||r.leases.length>32||r.operations.length>32)throw Error('Resource capacity invalid');
  for(const b of r.bindings){if(!b||typeof b.tool!=='string'||!/^[-\w.:]+$/.test(b.tool)||(b.tool.startsWith('team_')||b.tool==='run_code')||!['read','write'].includes(b.mode)||bindings.has(b.tool))throw Error('Tool bindings must be unique exact names');bindings.add(b.tool);}
  for(const x of r.leases)if(!x||typeof x.id!=='string'||typeof x.owner!=='string'||!['read','write'].includes(x.mode)||!Number.isFinite(x.expiresAt)||!Number.isSafeInteger(x.generation))throw Error('Invalid resource lease');
  for(const x of r.leases)if(x.delegation){const d=x.delegation;if(!record(d)||![d.id,d.target,d.member,d.grantorMember,d.teamId,d.epoch].every(v=>typeof v==='string'&&v.length>0)||!Number.isFinite(d.expiresAt)||d.expiresAt>x.expiresAt||d.revokedAt!==undefined&&!Number.isFinite(d.revokedAt))throw Error('Invalid lease delegation');}
  for(const x of r.operations)if(!x||typeof x.id!=='string'||typeof x.owner!=='string'||typeof x.callId!=='string'||!['running','uncertain'].includes(x.state)||!['read','write'].includes(x.mode)||!Number.isSafeInteger(x.generation))throw Error('Invalid resource operation');
 }
}
export function resource(s:State,id:string):ToolResource{const r=s.resources?.find(r=>r.id===id);if(!r)return error('RESOURCE_UNKNOWN','工具实例未配置');return r;}
function log(r:ToolResource,kind:string,owner:string,note:string){r.history.push({time:Date.now(),kind,owner,note});if(r.history.length>500)r.history.splice(0,r.history.length-500);r.revision++;}
function expire(r:ToolResource,now:number){r.leases=r.leases.filter(l=>l.expiresAt>now||r.operations.some(o=>o.owner===l.owner||o.leaseId===l.id));}
function modeCheck(mode:AccessMode){if(!['read','write'].includes(mode))error('RESOURCE_MODE','必须选择 read 或 write');}
function ttlCheck(ttl:number){if(!Number.isSafeInteger(ttl)||ttl<1000||ttl>3600000)error('RESOURCE_TTL','租约期限为 1 秒到 1 小时');}
export function configureResource(s:State,raw:unknown,expected:number):ToolResource{
 if(!record(raw)||Object.keys(raw).some(k=>!['id','label','instance','mode','bindings','maxReaders'].includes(k)))error('RESOURCE_CONFIG','无效的实例配置');
 const id=string(raw.id,'resource id',120),prior=s.resources?.find(r=>r.id===id);
 if((prior?.revision??0)!==expected)error('REVISION_CONFLICT','工具实例已变化，请刷新');
 if(prior){expire(prior,Date.now());if(prior.leases.length||prior.operations.length)error('RESOURCE_BUSY','仍有占用或待核对操作，不能改写保护配置');}
 const r:ToolResource={id,label:string(raw.label,'label',120),instance:string(raw.instance,'instance',500),mode:raw.mode as ToolResource['mode'],bindings:structuredClone(raw.bindings) as ToolResource['bindings'],maxReaders:Number(raw.maxReaders??1),revision:(prior?.revision??0)+1,generation:prior?.generation??0,leases:[],operations:[],history:prior?.history??[]};
 s.resources=(s.resources??[]).filter(x=>x.id!==id);s.resources.push(r);validateResources(s);log(r,'configure','user','配置工具实例');return r;
}
export function leaseAction(s:State,owner:string,id:string,action:string,input:{mode?:AccessMode;ttlMs?:number;token?:string},now=Date.now()):ToolLease|{released:true}{
 const r=resource(s,id);expire(r,now);
 if(action==='acquire'){
  const mode=input.mode??'write',ttl=input.ttlMs??60000;modeCheck(mode);ttlCheck(ttl);
  const own=r.leases.find(l=>l.owner===owner);if(own){if(own.expiresAt<=now)error('LEASE_STALE','租约已过期，活动操作须先核对');if(own.mode!==mode)error('RESOURCE_MODE','请先释放已有租约再更改模式');return own;}
  if(r.operations.some(o=>o.state==='uncertain')||r.operations.some(o=>mode==='write'||o.mode==='write')||r.leases.some(l=>mode==='write'||l.mode==='write')||r.leases.length>=r.maxReaders||r.operations.length>=r.maxReaders)error('RESOURCE_BUSY','实例忙或结果待核对，请在有意义的检查点重试');
  const lease:ToolLease={id:randomUUID(),owner,mode,generation:++r.generation,expiresAt:now+ttl};r.leases.push(lease);log(r,'acquire',owner,mode);return lease;
 }
 const own=r.leases.find(l=>l.id===input.token&&l.owner===owner);if(!own)error('LEASE_STALE','租约令牌无效或已过期');
 if(action==='renew'){const ttl=input.ttlMs??60000;ttlCheck(ttl);if(own.expiresAt<=now)error('LEASE_STALE','租约已经过期，仍在运行的操作不会因此放行');own.expiresAt=now+ttl;log(r,'renew',owner,own.mode);return own;}
 if(action==='release'){if(r.operations.some(o=>o.owner===owner||o.leaseId===own.id))error('RESOURCE_BUSY','操作未结束或待核对，不能释放');r.leases=r.leases.filter(l=>l.id!==own.id);log(r,'release',owner,own.mode);return {released:true};}
 return error('RESOURCE_ACTION','未知租约操作');
}
export function delegateLease(s:State,owner:string,id:string,token:string,target:{actor:string;member:string;grantorMember:string;teamId:string;epoch:string},ttlMs:number,now=Date.now()){
 const r=resource(s,id);expire(r,now);ttlCheck(ttlMs);const lease=r.leases.find(l=>l.owner===owner&&l.id===token);
 if(!lease||lease.expiresAt<=now)error('LEASE_STALE','委派需要当前有效的自有租约');
 if(target.actor===owner)error('LEASE_DELEGATION_SCOPE','不能向自己委派租约');
 if(r.operations.some(o=>o.owner===owner||o.leaseId===lease.id)||lease.delegation&&!lease.delegation.revokedAt&&lease.delegation.expiresAt>now)error('RESOURCE_BUSY','已有操作或委派尚未结束');
 lease.delegation={id:randomUUID(),target:target.actor,member:target.member,grantorMember:target.grantorMember,teamId:target.teamId,epoch:target.epoch,expiresAt:Math.min(now+ttlMs,lease.expiresAt)};
 log(r,'delegate',owner,target.actor);return structuredClone(lease.delegation);
}
export function revokeDelegation(s:State,owner:string,id:string,token:string,delegationId:string,now=Date.now()){
 const r=resource(s,id),lease=r.leases.find(l=>l.id===token&&l.owner===owner);
 if(!lease?.delegation||lease.delegation.id!==delegationId)error('LEASE_STALE','委派不存在或不属于此租约');
 lease.delegation.revokedAt??=now;log(r,'revoke-delegation',owner,lease.delegation.target);
 return {revoked:true,pending:r.operations.some(o=>o.leaseId===lease.id)};
}
export function returnDelegation(s:State,actor:string,id:string,delegationId:string,now=Date.now()){
 const r=resource(s,id),lease=r.leases.find(l=>l.delegation?.id===delegationId&&l.delegation.target===actor);
 if(!lease?.delegation)error('LEASE_STALE','此委派不属于实际执行者');
 lease.delegation.revokedAt??=now;log(r,'return-delegation',actor,lease.owner);
 return {returned:true,pending:r.operations.some(o=>o.leaseId===lease.id)};
}
export function beginOperation(s:State,owner:string,tool:string,callId:string,now=Date.now(),scope?:{member:string;teamId:string;epoch:string}):{resourceId:string;operation:ResourceOperation}|undefined{
 const r=s.resources?.find(r=>r.mode==='guarded'&&r.bindings.some(b=>b.tool===tool));if(!r)return undefined;expire(r,now);
 const mode=r.bindings.find(b=>b.tool===tool)!.mode;
 const delegated=r.leases.find(l=>l.delegation?.target===owner&&!l.delegation.revokedAt&&l.delegation.expiresAt>now&&l.expiresAt>now&&scope&&l.delegation.member===scope.member&&l.delegation.teamId===scope.teamId&&l.delegation.epoch===scope.epoch&&s.teams.some(t=>t.id===scope.teamId&&t.epoch===scope.epoch&&t.members.some(m=>m.sessionId===l.delegation!.grantorMember&&m.active!==false&&(m.sessionId===scope.member||m.targets.includes(scope.member)))));
 const own=r.leases.find(l=>l.owner===owner)??delegated;
 if(own&&(own.expiresAt<=now||mode==='write'&&own.mode!=='write'))error('LEASE_STALE','当前租约不允许此次写入或已过期');
 if(own?.owner===owner&&own.delegation&&!own.delegation.revokedAt&&own.delegation.expiresAt>now)error('RESOURCE_BUSY','租约已委派，撤回或等待委派到期后再调用');
 if(r.operations.some(o=>o.state==='uncertain'||mode==='write'||o.mode==='write')||r.operations.length>=r.maxReaders||r.leases.some(l=>l!==own&&(mode==='write'||l.mode==='write')))error('RESOURCE_BUSY','该工具实例正被占用；没有执行本次工具，请稍后重试');
 const operation:ResourceOperation={...(own?{leaseId:own.id}:{}),...(delegated===own&&delegated?.delegation?{delegationId:delegated.delegation.id}:{}),id:randomUUID(),owner,tool,callId,mode,generation:++r.generation,startedAt:now,state:'running'};r.operations.push(operation);log(r,'begin',owner,`${tool} · ${callId}`);return {resourceId:r.id,operation};
}
export function finishOperation(s:State,id:string,operationId:string,success:boolean,detail=''):void{
 const r=resource(s,id),op=r.operations.find(o=>o.id===operationId);if(!op)return;
 if(success)r.operations=r.operations.filter(o=>o.id!==operationId);else{op.state='uncertain';op.error=detail.slice(0,2000);}
 log(r,success?'complete':'uncertain',op.owner,op.tool+(detail?' · '+detail.slice(0,500):''));expire(r,Date.now());
}
export function resolveOperation(s:State,id:string,operationId:string,reason:string):void{
 string(reason,'核对依据',2000);const r=resource(s,id),op=r.operations.find(o=>o.id===operationId);if(!op||op.state!=='uncertain')error('RESOURCE_STATE','仅可核对未知结果的操作');
 r.operations=r.operations.filter(o=>o.id!==operationId);r.leases=r.leases.filter(l=>l.owner!==op.owner&&l.id!==op.leaseId);log(r,'user-resolved','user',`${op.tool} · ${reason}`);
}
