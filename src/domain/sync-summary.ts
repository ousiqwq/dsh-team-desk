import type{ChangeNotice,State,Team,SharedRevision,Message}from'./types.ts';
export type SyncOperation='create'|'update'|'delete'|'rename'|'observe';
export interface SyncPreview {id:string;sequence:number;resource:string;operation:SyncOperation;version:string;beforeVersion?:string;author:string;label:string;actorSessionId?:string;time:number;origin:ChangeNotice['origin'];}
export type SyncReason='subscription'|'working'|'owner';
export interface SyncSummary {
 receivedBecause?:Record<string,SyncReason[]>;
 version:1;scope:{teamId:string;projectId?:string;name:string;root:string};recordIds:string[];
 operations:Record<SyncOperation,number>;authors:{id:string;label:string}[];preview:SyncPreview[];incomplete:boolean;
}
/** Recipient-specific metadata for grouping without reading the original bodies or file diffs. */
export interface SyncDeliveryHint {
 batchScope?:string; scopeLabel?:string; ledgerScope?:string; files?:{id:string;resource:string;operation:SyncOperation}[];
 id:string; sender:string; target:string; scope:string; actor:string; route:string; author:string; recordIds:string[];
}
export function syncDeliveryHint(message:Message):SyncDeliveryHint|undefined {
 const summary=message.syncSummary;
 if(!message.system||message.kind!=='notice'||!message.syncKey?.startsWith('resource-digest:')||!summary||summary.incomplete)return;
 const author=summary.authors[0];
 if(summary.authors.length!==1||author?.id!==message.sender||!summary.preview.length||!summary.recordIds.length)return;
 const actor=summary.preview[0]!.actorSessionId??message.sender;
 if(summary.preview.some(change=>(change.actorSessionId??message.sender)!==actor))return;
 return {id:message.id,sender:message.sender,target:message.target,
  scope:JSON.stringify([message.teamId,message.epoch,message.syncKey,message.target]),actor,
  batchScope:JSON.stringify([message.teamId,message.epoch,message.target]),scopeLabel:summary.scope?.name,ledgerScope:JSON.stringify([message.teamId,summary.scope?.projectId]),
  files:summary.preview.map(({id,resource,operation})=>({id,resource:resource?.split(/[\\/]/).pop()??resource,operation})),
  // A tab opened before the server upgrade still consumes the per-source archive key.
  route:JSON.stringify([message.teamId,message.epoch,message.syncKey,message.sender,actor,message.target]),
  author:author.label,recordIds:summary.recordIds};
}
export interface SyncDetail {kind:'resources'|'shared'|'legacy-summary'|'other';messageId:string;sender:string;target:string;time:number;text:string;summary?:SyncSummary;shared?:SharedRevision;items:ChangeNotice[];missing:number;total:number;cursor:number;hasMore:boolean;}
const labels:Record<SyncOperation,string>={create:'新增',update:'修改',delete:'删除',rename:'重命名',observe:'变更'};
export function legacySyncReference(text:string):{record?:string;projectId?:string;resource?:string;version?:string;key?:string;revision?:number}{
 const start=text.indexOf('{'),end=text.lastIndexOf('}');if(start<0||end<start)return{};
 try{const v=JSON.parse(text.slice(start,end+1));if(!v||typeof v!=='object'||Array.isArray(v))return{};return{...Object.fromEntries(['record','projectId','resource','version','key'].filter(k=>typeof v[k]==='string').map(k=>[k,v[k]])),...(Number.isSafeInteger(v.revision)?{revision:v.revision}:{})};}catch{return{};}
}
export function extendSyncSummary(prior:SyncSummary|undefined,changes:ChangeNotice[],s:State,t:Team,projectId?:string,incomplete=false):SyncSummary{
 const project=projectId?s.projects?.find(p=>p.id===projectId):undefined;
 const next:SyncSummary=prior?structuredClone(prior):{version:1,scope:{teamId:t.id,...(projectId?{projectId}:{}),name:project?.name??t.title,root:project?.root??t.cwd},recordIds:[],operations:{create:0,update:0,delete:0,rename:0,observe:0},authors:[],preview:[],incomplete};
 next.incomplete||=incomplete;const seen=new Set(next.recordIds),authors=new Set(next.authors.map(a=>a.id));
 for(const c of changes){if(seen.has(c.id))continue;seen.add(c.id);next.recordIds.push(c.id);const operation=c.operation??'observe';next.operations[operation]++;
  const seat=s.teams.flatMap(team=>team.members).find(m=>m.sessionId===c.author)?.label??c.author;
  const child=c.provenance?.actorSessionId;
  const label=child&&child!==c.author?seat+' › '+(c.provenance?.actorLabel||child):seat;
  if(!authors.has(c.author)){authors.add(c.author);next.authors.push({id:c.author,label});}
  next.preview.push({id:c.id,sequence:c.sequence??0,resource:c.resource,operation,version:c.version,...(c.beforeVersion?{beforeVersion:c.beforeVersion}:{}),author:c.author,label,...(c.provenance?.actorSessionId?{actorSessionId:c.provenance.actorSessionId}:{}),time:c.time,origin:c.origin});
 }
 next.preview=next.preview.sort((a,b)=>a.sequence-b.sequence).slice(-8);return next;
}
/** Human-readable model input and UI use the same immutable recipient-specific snapshot. */
export function formatSyncSummary(v:SyncSummary):string{
 const counts=Object.entries(v.operations).filter(([,n])=>n).map(([op,n])=>labels[op as SyncOperation]+' '+n).join(' · ');
 const scope=JSON.stringify(v.scope.name.length>120?v.scope.name.slice(0,117)+'…':v.scope.name),people=v.authors.map(a=>JSON.stringify(a.label)).join('、');
 const lines=[`团队文件同步：${v.recordIds.length} 条${v.incomplete?'已知':''}变更（${counts}）。`,`范围：${scope}；参与成员：${people||'来源未记录'}。`];
 if(v.scope.projectId)lines.push('项目 ID：'+JSON.stringify(v.scope.projectId));
 for(const p of v.preview){const path=p.resource.startsWith(v.scope.root.replace(/\/$/,'')+'/')?p.resource.slice(v.scope.root.replace(/\/$/,'').length+1):p.resource;const display=path.length>650?path.slice(0,200)+'…'+path.slice(-400):path;lines.push(`[${labels[p.operation]}] ${JSON.stringify(display)} — ${JSON.stringify(p.label)}；${p.beforeVersion?JSON.stringify(p.beforeVersion):'前版本未记录'} → ${JSON.stringify(p.version)}`);}
 if(v.recordIds.length>v.preview.length)lines.push(`以上列出最近 ${v.preview.length} 条，另有 ${v.recordIds.length-v.preview.length} 条变更保存在完整记录中。`);
 if(v.incomplete)lines.push('本摘要还合并了旧版通知；旧版缺失的文件明细不能据序号猜测恢复。');
 lines.push('可按需用 team_shared changes 查看对应范围的来源、差异和完整记录；相关写入前重新读取文件。这是静默信息同步，不是新的派工，无需逐条回执。');
 return lines.join('\n');
}
export function validateSyncSummary(v:unknown):asserts v is SyncSummary{
 const x=v as SyncSummary;if(!x||x.version!==1||!x.scope||typeof x.scope.teamId!=='string'||typeof x.scope.name!=='string'||typeof x.scope.root!=='string'||x.scope.projectId!==undefined&&typeof x.scope.projectId!=='string'||!Array.isArray(x.recordIds)||x.recordIds.some(id=>typeof id!=='string')||new Set(x.recordIds).size!==x.recordIds.length||!x.operations||!Object.keys(labels).every(k=>Number.isSafeInteger(x.operations[k as SyncOperation])&&x.operations[k as SyncOperation]>=0)||Object.values(x.operations).reduce((n,v)=>n+v,0)!==x.recordIds.length||!Array.isArray(x.authors)||x.authors.some(a=>!a||typeof a.id!=='string'||typeof a.label!=='string')||!Array.isArray(x.preview)||x.preview.length>8||x.preview.some(p=>!p||!x.recordIds.includes(p.id)||typeof p.resource!=='string'||typeof p.version!=='string'||typeof p.label!=='string'||typeof p.author!=='string'||!Object.hasOwn(labels,p.operation)||!Number.isSafeInteger(p.sequence)||!Number.isFinite(p.time))||typeof x.incomplete!=='boolean')throw Error('Invalid synchronization summary');
 if(x.receivedBecause!==undefined){
  const ids=new Set(x.recordIds);
  if(!x.receivedBecause||typeof x.receivedBecause!=='object'||Array.isArray(x.receivedBecause)||
   Object.entries(x.receivedBecause).some(([id,why])=>!ids.has(id)||!Array.isArray(why)||!why.length||why.some(r=>!['subscription','working','owner'].includes(r))))throw Error('Invalid synchronization receipt reasons');
 }
}
