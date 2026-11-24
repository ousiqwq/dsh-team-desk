import {recordTeamAt} from './memberships.ts';
import {join,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {writeJson} from './storage.ts';
import type {State,ArchiveRef,ArchiveBundle,Message} from './types.ts';
import {CoordinationError} from './errors.ts';
export function archivePath(stateFile:string,id:string):string{if(!/^[-a-f0-9]{36}$/.test(id))throw Error('Invalid archive ID');return join(dirname(stateFile),'archives',id+'.json');}
export async function loadArchive(stateFile:string,ref:ArchiveRef):Promise<ArchiveBundle>{
  const bytes=await readFile(archivePath(stateFile,ref.id));if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw new CoordinationError('ARCHIVE_CORRUPT','归档校验失败，保留当前状态');
  const data=JSON.parse(bytes.toString());if(data.version!==1||!Array.isArray(data.messages)||!Array.isArray(data.history)||!Array.isArray(data.changes))throw new CoordinationError('ARCHIVE_CORRUPT','归档结构无效');return data;
}
export function archivable(m:Message,now:number,cutoff:number):boolean{
  return m.time<cutoff&&m.cancellation?.status!=='pending'&&m.cancellation?.status!=='unknown'
    &&(m.state==='cancelled'||m.native==='discarded'||(m.native==='admitted'&&(m.expiresAt??m.time+86400000)<now));
}
/** Archive is durable before the caller commits its manifest; a crash leaves an inert orphan, never missing data. */
export async function prepareArchive(file:string,s:State,teamId:string,cutoff:number,projectId?:string):Promise<{ref:ArchiveRef;bundle:ArchiveBundle}|undefined>{
  const live=s.teams.find(t=>t.id===teamId);
  const team=live??s.retiredLedgers?.find(t=>t.id===teamId)??{id:teamId};
  const t=projectId?s.projects?.find(p=>p.id===projectId&&p.teamIds.includes(teamId)):team;if(!t)throw Error('Project outside team scope');const owner=projectId??teamId;
  const needed=new Set(s.messages.filter(m=>!archivable(m,Date.now(),cutoff)).flatMap(m=>m.dependsOn??[]));
  // Keep the request number and task label visible while a seat still owes a response.
  for(const run of Object.values(live?.runs??{})){
    if(run.epoch===live?.epoch&&run.phase!=='delivered')for(const id of run.requests)needed.add(id);
  }
  // A still-live request must retain evidence that its one-time reply has been consumed.
  const liveGrants=new Set(s.messages.filter(m=>(m.allowReply||m.routeReply)&&(m.expiresAt??0)>Date.now()).map(m=>m.id));
  for(const m of s.messages)if(m.replyTo&&liveGrants.has(m.replyTo)&&m.state!=='cancelled')needed.add(m.id);
  const messages=projectId?[]:s.messages.filter(m=>m.teamId===teamId&&!needed.has(m.id)&&archivable(m,Date.now(),cutoff));
  const history=(t.history??[]).filter(h=>h.time<cutoff&&!('shared' in t&&t.shared?.some(v=>v.key===h.key&&v.scope===h.scope&&v.revision===h.revision)));
  const changes=(t.changes??[]).filter(c=>c.time<cutoff);
  const tasks=projectId?[]:(team.tasks??[]).filter(x=>(!x.owner||(x.expiresAt??0)<=Date.now()||x.epoch!==live?.epoch)&&(x.history.at(-1)?.time??0)<cutoff);
  const controls=projectId?[]:(team.controls??[]).filter(c=>['accepted','idle'].includes(c.state)&&c.time<cutoff);
  const events=projectId?[]:s.events.filter(e=>e.teamId===teamId&&e.time<cutoff);
  const hostOperations=projectId?[]:(s.hostOperations??[]).filter(o=>o.teamId===teamId&&['completed','resolved'].includes(o.state)&&o.time<cutoff);
  if(!messages.length&&!history.length&&!changes.length&&!tasks.length&&!controls.length&&!events.length&&!hostOperations.length)return undefined;
  const bundle:ArchiveBundle={version:1,messages,tasks:[{owner,entries:tasks}],controls:[{owner,entries:controls}],events,hostOperations,history:[{owner,entries:history}],changes:[{owner,entries:changes}]},id=randomUUID();
  await writeJson(archivePath(file,id),bundle);const bytes=await readFile(archivePath(file,id));
  return {bundle,ref:{id,time:Date.now(),sha256:createHash('sha256').update(bytes).digest('hex'),tasks:tasks.length,controls:controls.length,events:events.length,minSequence:Math.min(...[...messages,...history,...changes].map(x=>x.sequence??0),s.sequence??0),maxSequence:Math.max(0,...[...messages,...history,...changes].map(x=>x.sequence??0)),messages:messages.length,history:history.length,changes:changes.length,teamIds:projectId?[]:[teamId],projectIds:projectId?[projectId]:[],...(projectId&&{sourceTeamIds:[...new Set([...history.map(h=>recordTeamAt(s,h)),...changes.map(c=>recordTeamAt(s,c))].filter((id):id is string=>!!id))]})}};
}
export function commitArchive(s:State,ref:ArchiveRef,bundle:ArchiveBundle):void{
  for(const group of bundle.tasks??[]){const team=s.teams.find(t=>t.id===group.owner);if(!team)continue;for(const task of group.entries){team.taskHeads=(team.taskHeads??[]).filter(h=>h.key!==task.key);team.taskHeads.push({key:task.key,revision:task.revision,archive:ref.id});}const keys=new Set(group.entries.map(t=>t.key));team.tasks=(team.tasks??[]).filter(t=>!keys.has(t.key));}
  for(const group of bundle.controls??[]){const team=s.teams.find(t=>t.id===group.owner);if(!team)continue;for(const c of group.entries)(team.controlKeys??=[]).push({key:c.key,from:c.from,archive:ref.id});const ids=new Set(group.entries.map(c=>c.id));team.controls=(team.controls??[]).filter(c=>!ids.has(c.id));}
  for(const retired of s.retiredLedgers??[]){
    const tasks=bundle.tasks?.find(g=>g.owner===retired.id),controls=bundle.controls?.find(g=>g.owner===retired.id);
    if(tasks){const keys=new Set(tasks.entries.map(x=>x.key));retired.tasks=retired.tasks?.filter(x=>!keys.has(x.key))??[];}
    if(controls){const ids=new Set(controls.entries.map(x=>x.id));retired.controls=retired.controls?.filter(x=>!ids.has(x.id))??[];}
  }
  const events=new Set(bundle.events?.map(e=>e.id)),ops=new Set(bundle.hostOperations?.map(o=>o.id));s.events=s.events.filter(e=>!events.has(e.id));s.hostOperations=(s.hostOperations??[]).filter(o=>!ops.has(o.id));
  (s.archives??=[]).push(ref);const mids=new Set(bundle.messages.map(m=>m.id));
  for(const m of bundle.messages)(s.archivedKeys??=[]).push({id:m.id,key:m.key,teamId:m.teamId,sender:m.sender,...(m.epoch?{epoch:m.epoch}:{}),archive:ref.id});
  s.messages=s.messages.filter(m=>!mids.has(m.id));
  for(const group of bundle.history){const t=[...s.teams,...(s.retiredLedgers??[]),...(s.projects??[])].find(t=>t.id===group.owner);if(t){const ids=new Set(group.entries.map(h=>h.id));t.history=t.history?.filter(x=>!ids.has(x.id))??[];}}
  for(const group of bundle.changes){const t=[...s.teams,...(s.retiredLedgers??[]),...(s.projects??[])].find(t=>t.id===group.owner);if(t){const ids=new Set(group.entries.map(h=>h.id));t.changes=t.changes?.filter(x=>!ids.has(x.id))??[];}}
}
