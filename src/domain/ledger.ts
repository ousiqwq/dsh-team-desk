import {identifyResource} from './resource-identity.ts';
import {checkValue} from './definitions.ts';
import {randomUUID,createHash} from 'node:crypto';
import {isAbsolute,relative} from 'node:path';
import type {State,Team,SharedProject,SharedRevision,SharedEntry,SharedOptions,ChangeDetails,ChangeNotice,Message,ObservationOrigin} from './types.ts';
import {jsonValue} from './coordination.ts';
import {CoordinationError} from './errors.ts';
import {extendSyncSummary,formatSyncSummary,type SyncReason} from './sync-summary.ts';
export type Ledger={shared?:SharedEntry[];history?:SharedRevision[];changes?:ChangeNotice[]};
export function sequence(s:State):number{return s.sequence=(s.sequence??0)+1;}
export function seedLedger(s:State):void{
  s.sequence??=0;s.projects??=[];s.archives??=[];s.archivedKeys??=[];
  const assign=(x:{sequence?:number})=>{if(x.sequence===undefined)x.sequence=sequence(s);else s.sequence=Math.max(s.sequence!,x.sequence);};
  for(const m of s.messages)assign(m);
  for(const bucket of [...s.teams,...s.projects]){
    bucket.history??=[];bucket.changes??=[];
    for(const x of bucket.shared??[])if(!bucket.history.some(h=>h.key===x.key&&h.scope===x.scope&&h.revision===x.revision))bucket.history.push({...structuredClone(x),id:randomUUID(),sequence:sequence(s),previousRevision:Math.max(0,x.revision-1),evidence:[],source:'migration',baseline:true});
    for(const h of bucket.history)assign(h);for(const c of bucket.changes)assign(c);
  }
}
export function validateLedger(s:State):void{
  if(!Number.isSafeInteger(s.sequence)||s.sequence!<0||!Array.isArray(s.projects)||!Array.isArray(s.archives)||!Array.isArray(s.archivedKeys))throw Error('Invalid coordination ledger');
  if(new Set(s.projects.map(p=>p.id)).size!==s.projects.length)throw Error('Duplicate project');
  for(const p of s.projects)if(!p||typeof p.id!=='string'||typeof p.root!=='string'||typeof p.name!=='string'||!Array.isArray(p.teamIds)||!p.teamIds.every(t=>typeof t==='string')||!Array.isArray(p.shared))throw Error('Invalid shared project');
  for(const bucket of [...s.teams,...s.projects]){
    if(!Array.isArray(bucket.history)||!Array.isArray(bucket.changes))throw Error('Invalid change history');
    for(const h of bucket.history)if(!h||typeof h.id!=='string'||typeof h.key!=='string'||typeof h.scope!=='string'||!Number.isSafeInteger(h.revision)||h.revision<1||!Number.isSafeInteger(h.sequence)||!Array.isArray(h.evidence)||!['member','user','migration'].includes(h.source))throw Error('Invalid decision revision');
    for(const c of bucket.changes)if(!c||typeof c.id!=='string'||typeof c.resource!=='string'||typeof c.version!=='string'||!Number.isSafeInteger(c.sequence))throw Error('Invalid change record');
  }
  for(const t of s.teams)if(t.subscriptions!==undefined&&(!Array.isArray(t.subscriptions)||t.subscriptions.some(x=>!x||typeof x.resource!=='string'||typeof x.sessionId!=='string')))throw Error('Invalid subscriptions');
  for(const a of s.archives)if(!a||!/^[-a-f0-9]{36}$/.test(a.id)||!Array.isArray(a.teamIds)||!Array.isArray(a.projectIds)||!/^\w{64}$/.test(a.sha256))throw Error('Invalid archive reference');
}
export function evidence(input:string[]|undefined):string[]{if(input!==undefined&&(!Array.isArray(input)||input.length>20||input.some(x=>typeof x!=='string'||x.length>2000)))throw new CoordinationError('INVALID_EVIDENCE','证据为最多 20 个路径或记录引用');return input??[];}
export function bucket(s:State,t:Team,projectId?:string):Ledger{
  if(projectId!==undefined&&(typeof projectId!=='string'||!projectId||projectId.length>200))throw new CoordinationError('PROJECT_SCOPE','无效的项目 ID');
  if(!projectId)return t;
  const p=s.projects?.find(p=>p.id===projectId&&p.teamIds.includes(t.id));
  if(!p)throw new CoordinationError('PROJECT_SCOPE','该团队尚未加入此项目');return p;
}
export function projectFor(s:State,t:Team,resource:string):SharedProject|undefined{
  if(!isAbsolute(resource))return undefined;
  return s.projects?.filter(p=>p.teamIds.includes(t.id)&&isWithin(p.root,resource)).sort((a,b)=>b.root.length-a.root.length)[0];
}
export function isWithin(root:string,path:string):boolean{const r=relative(root,path);return r===''||(!r.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&r!=='..'&&!isAbsolute(r));}
export const RESOURCE_DIGEST_PREFIX='resource-digest:';
/** Keep a durable, bounded notification while retaining every individual change in the ledger. */
export function enqueueResourceDigest(s:State,t:Team,author:string,target:string,from:number,to:number,projectId?:string,recordIds:string[]=[],batch?:string,reasons?:SyncReason[]):string{
  const syncKey=RESOURCE_DIGEST_PREFIX+(projectId??t.id),now=Date.now();
  const prior=batch?s.messages.find(m=>m.syncBatch===batch&&m.sender===author&&m.system&&m.teamId===t.id&&m.epoch===t.epoch&&m.target===target&&m.state==='queued'&&!m.cancellation&&m.syncKey===syncKey):undefined;
  const first=Math.min(prior?.syncFrom??from,from),last=Math.max(prior?.syncTo??to,to);
  const rows=(projectId?s.projects?.find(p=>p.id===projectId)?.changes:t.changes)??[],wanted=new Set(recordIds),changes=rows.filter(c=>wanted.has(c.id));
  const syncSummary=extendSyncSummary(prior?.syncSummary,changes,s,t,projectId,!!prior&&!prior.syncSummary||recordIds.length!==changes.length||!recordIds.length);
  if(reasons?.length)for(const id of recordIds)(syncSummary.receivedBecause??={})[id]=reasons;
  const text=formatSyncSummary(syncSummary);
  if(prior){prior.text=text;prior.syncSummary=syncSummary;prior.sender=author;prior.syncFrom=first;prior.syncTo=last;prior.expiresAt=now+86400000;prior.retryAt=Math.min(now+1000,prior.time+5000);return prior.id;}
  if(s.messages.length>=10000)throw new CoordinationError('QUEUE_FULL','活动消息已满，请归档已结束记录后继续',true);
  const id=randomUUID(),time=Math.max(now,(s.messages.at(-1)?.time??0)+1);
  s.messages.push({id,key:id,teamId:t.id,...(t.epoch?{epoch:t.epoch}:{}),sender:author,target,text,time,sequence:sequence(s),state:'queued',system:true,kind:'notice',priority:'normal',delivery:'next-step',wakeup:false,expiresAt:now+86400000,retryAt:now+1000,syncKey,syncFrom:first,syncTo:last,...(batch?{syncBatch:batch}:{}),syncSummary});
  return id;
}
export function notify(s:State,t:Team,author:string,syncKey:string,seq:number,text:string,projectId?:string,resource?:string,includeAuthor=false,changeId?:string,change?:ChangeNotice,workingMembers:readonly string[]=[]):void{
  const teams=projectId?s.teams.filter(x=>s.projects?.find(p=>p.id===projectId)?.teamIds.includes(x.id)):[t];
  const path=change?.canonicalPath??change?.resource;
  const ordinaryFile=!projectId&&path&&isAbsolute(path)&&isWithin(t.cwd,path)
    &&!relative(t.cwd,path).split(/[\\/]/).some(part=>['_seats','.tmp','tmp','.cache','.git'].includes(part));
  for(const team of teams)for(const member of team.members.filter(m=>m.active!==false&&(includeAuthor||m.sessionId!==author)&&m.operations.includes('read'))){
    if(change?.provenance&&member.boundSince!==undefined&&member.boundSince>change.provenance.observedAt)continue;
    const reasons:SyncReason[]=[];
    if(resource){
      const subscribed=team.subscriptions?.some(x=>x.sessionId===member.sessionId&&(!x.projectId||x.projectId===projectId)&&(x.resource==='*'||x.resource===resource||x.resource===change?.resource||x.resource===change?.canonicalPath||x.resource===change?.previousResource));
      const childToOwner=includeAuthor&&member.sessionId===author&&team.id===t.id;
      const assigned=ordinaryFile&&team.id===t.id&&workingMembers.includes(member.sessionId);
      if(subscribed)reasons.push('subscription');
      if(assigned)reasons.push('working');
      if(childToOwner)reasons.push('owner');
      if(!reasons.length)continue;
    }
    if(syncKey.startsWith(RESOURCE_DIGEST_PREFIX)){enqueueResourceDigest(s,team,author,member.sessionId,seq,seq,projectId,changeId?[changeId]:[],change?.provenance?.id?JSON.stringify([change.provenance.actorSessionId??author,change.provenance.batchId??change.provenance.id]):undefined,reasons);continue;}
    const prior=s.messages.find(m=>m.teamId===team.id&&m.epoch===team.epoch&&m.target===member.sessionId&&m.state==='queued'&&!m.cancellation&&m.syncKey===syncKey);
    if(prior){prior.text=text;prior.syncTo=seq;prior.sender=author;continue;}
    if(s.messages.length>=10000)throw new CoordinationError('QUEUE_FULL','活动消息已满，请归档已结束记录后继续',true);
    const id=randomUUID(),time=Math.max(Date.now(),(s.messages.at(-1)?.time??0)+1);
    s.messages.push({id,key:id,teamId:team.id,...(team.epoch?{epoch:team.epoch}:{}),sender:author,target:member.sessionId,text,time,sequence:sequence(s),state:'queued',system:true,kind:'notice',priority:'normal',delivery:'next-step',wakeup:false,expiresAt:Date.now()+86400000,retryAt:Date.now()+100,syncKey,syncFrom:seq,syncTo:seq});
  }
}
export function updateValue(s:State,t:Team,caller:string,key:string,value:unknown,expected:number,reason:string,kind:'value'|'decision',local:boolean,options:SharedOptions={},trustedUser=false):SharedRevision{
  if(!/^[-a-zA-Z0-9_.]{1,100}$/.test(key)||['__proto__','constructor','prototype'].includes(key))throw new CoordinationError('INVALID_KEY','无效的共享键');
  if(!['value','decision'].includes(kind)||!Number.isSafeInteger(expected)||expected<0)throw new CoordinationError('INVALID_REVISION','无效的类型或版本');
  jsonValue(value);if(t.coordination?.variables?.[key])checkValue(t.coordination.variables[key]!.schema,value,key);if(typeof reason!=='string'||!reason.trim()||reason.length>2000)throw new CoordinationError('INVALID_REASON','请提供不超过 2000 字符的修改原因');
  const ledger=bucket(s,t,options.projectId),scope=local?caller:'team',old=ledger.shared?.find(x=>x.key===key&&x.scope===scope);
  if((old?.revision??0)!==expected)throw new CoordinationError('REVISION_CONFLICT','先读取当前值、修改原因与历史，再决定是否继续',false,{key,currentRevision:old?.revision??0});
  if(!old&&(ledger.shared?.length??0)>=200)throw new CoordinationError('LEDGER_FULL','共享键数量达到上限');
  if(local&&ledger.shared?.some(x=>x.key===key&&x.scope==='team'&&x.protected))throw new CoordinationError('USER_CONSTRAINT','用户共享约束不能用同名局部值覆盖；请另记建议或争议');
  if(old?.protected&&!trustedUser)throw new CoordinationError('USER_CONSTRAINT','用户约束只能由用户更新；可另记争议或建议，不覆盖原约束');
  const predecessor=ledger.history?.find(x=>x.key===key&&x.scope===scope&&x.revision===expected);
  const item:SharedRevision={teamId:t.id,key,scope,kind,value:structuredClone(value),revision:expected+1,author:caller,reason,time:Date.now(),id:randomUUID(),sequence:sequence(s),previousRevision:expected,...(predecessor?{supersedes:predecessor.id}:{}),evidence:structuredClone(evidence(options.evidence)),source:trustedUser?'user':'member',...(trustedUser?{protected:true}:{})};
  ledger.shared=(ledger.shared??[]).filter(x=>x.key!==key||x.scope!==scope);ledger.shared.push({...item});(ledger.history??=[]).push(item);
  if(!local)notify(s,t,caller,`value:${options.projectId??t.id}:${key}:${item.id}`,item.sequence,`共享数据更新：${JSON.stringify({key,revision:item.revision,previousRevision:expected,projectId:options.projectId,record:item.id})}。按需用 team_shared read/history 查看值、理由和证据；这不是新的派工。`,options.projectId);
  return item;
}
export function appendChange(s:State,t:Team|import("./timeline.ts").RetiredLedger,caller:string,resource:string,version:string,summary:string,origin:'native-file'|'reported',details:ChangeDetails={},provenance?:ObservationOrigin,workingMembers=provenance?.workingMembers):ChangeNotice{
  if(!details||typeof details!=='object'||Array.isArray(details)||Object.keys(details).some(k=>!['canonicalPath','previousResource','resourceId','beforeVersion','beforeHash','afterHash','diff','truncated','projectId','evidence','operation'].includes(k)))throw new CoordinationError('INVALID_CHANGE','无效的修改记录字段');
  for(const [k,max]of [['canonicalPath',2000],['previousResource',2000],['resourceId',2000],['beforeVersion',300],['beforeHash',64],['afterHash',64],['diff',12000],['projectId',200]] as const)if(details[k]!==undefined&&(typeof details[k]!=='string'||details[k]!.length>max))throw new CoordinationError('INVALID_CHANGE','修改字段过长或类型不符');
  if(details.truncated!==undefined&&typeof details.truncated!=='boolean'||details.operation!==undefined&&!['create','update','delete','observe','rename'].includes(details.operation))throw new CoordinationError('INVALID_CHANGE','无效的修改类型');
  const active='members' in t?t:undefined;
  if(!active&&!provenance)throw new CoordinationError('OBSERVATION_SCOPE','缺少原始绑定');
  const project=provenance?(provenance.projectId?s.projects?.find(p=>p.id===provenance.projectId):undefined):details.projectId?bucket(s,active!,details.projectId):projectFor(s,active!,details.canonicalPath??resource);
  if(provenance?.projectId&&!project)throw new CoordinationError('OBSERVATION_SCOPE','原始项目不存在，保留待恢复记录');
  const projectId=details.projectId??(project&&'id'in project?project.id as string:undefined),ledger=project??t;
  const latest=ledger.changes?.findLast(x=>x.resource===resource&&(!provenance||x.author===caller&&x.provenance?.teamId===provenance.teamId&&x.provenance.epoch===provenance.epoch&&x.provenance.id===provenance.id&&x.provenance.observedAt===provenance.observedAt&&x.version===version));
  const old=latest?.version===version&&latest.author===caller&&latest.origin===origin&&latest.operation===details.operation&&(!provenance||latest.provenance?.id===provenance.id&&latest.provenance?.observedAt===provenance.observedAt)?latest:undefined;
  if(old)return old;
  const indexed=ledger as Team;const identity=identifyResource(indexed.resourceIndex??=[],resource,version,details);
  const x:ChangeNotice={teamId:provenance?.teamId??t.id,identity:{id:identity.id,generation:identity.generation},...details,...(projectId?{projectId}:{}),...(provenance?{provenance}:{}),evidence:evidence(details.evidence),id:randomUUID(),sequence:sequence(s),author:caller,resource,version,summary,time:provenance?.observedAt??Date.now(),origin};
  (ledger.changes??=[]).push(x);
  if(active&&(!provenance||(active.epoch===provenance.epoch&&active.members.some(m=>m.sessionId===caller&&m.active!==false&&(provenance.bindingId?m.bindingId===provenance.bindingId:provenance.observedAt>=(m.boundSince??0))))))notify(s,active,caller,origin==='native-file'?RESOURCE_DIGEST_PREFIX+(projectId??t.id):`resource:${projectId??t.id}:${x.id}`,x.sequence!,`资源变化（成员报告，尚未核实）：${JSON.stringify({resource,version,beforeVersion:details.beforeVersion,projectId,record:x.id})}。team_shared changes 可读差异、来源与依据；相关写入前重读资源。`,projectId,details.resourceId??resource,!!provenance?.actorSessionId&&provenance.actorSessionId!==caller,x.id,x,workingMembers);
  return x;
}
/** Bounded context diff; full original output remains in the native tool/history. */
export function textChange(before:string|null,after:string):Pick<ChangeDetails,'diff'|'truncated'|'beforeHash'|'afterHash'>{
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  let diff:string,truncated=false;
  if(before===null){diff='前内容未知／新建：\n+'+after.slice(0,6000).replace(/\n/g,'\n+');truncated=after.length>6000;}
  else if(before===after)diff='内容未变化';
  else if(before.length+after.length>524288){diff='内容较大；请按前后 SHA-256 与原生工具记录核对。';truncated=true;}
  else{
    const a=before.split('\n'),b=after.split('\n');let start=0,endA=a.length,endB=b.length;
    while(start<endA&&start<endB&&a[start]===b[start])start++;
    while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
    diff=`@@ 旧 ${start+1}–${endA} / 新 ${start+1}–${endB} @@\n`+a.slice(start,Math.min(endA,start+80)).map(x=>'-'+x).join('\n')+'\n'+b.slice(start,Math.min(endB,start+80)).map(x=>'+'+x).join('\n');
    truncated=endA-start>80||endB-start>80||diff.length>12000;diff=diff.slice(0,12000);
  }
  return {...(before===null?{}:{beforeHash:hash(before)}),afterHash:hash(after),diff,truncated};
}
