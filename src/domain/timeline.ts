import {recordTeamAt} from './memberships.ts';
import type {ArchiveBundle,State,Team} from './types.ts';

export interface TimelineEntry {id:string;time:number;kind:string;source:string;summary:string;detail?:string}
export type TimelineScope={teamId?:string;sessionId?:string};
export type RetiredLedger=Pick<Team,'id'|'history'|'changes'|'controls'|'tasks'|'resourceIndex'>;

export function historicalTeamIds(s:State):Set<string>{
  return new Set([...s.teams.map(t=>t.id),...(s.retiredLedgers??[]).map(t=>t.id),...(s.memberships??[]).map(p=>p.teamId),
    ...s.messages.map(m=>m.teamId),...s.events.map(e=>e.teamId),...(s.hostOperations??[]).map(op=>op.teamId),
    ...(s.archives??[]).flatMap(ref=>[...ref.teamIds,...ref.sourceTeamIds??[]]),...(s.projects??[]).flatMap(p=>[...p.history.map(h=>h.teamId),...p.changes.map(c=>c.provenance?.teamId??c.teamId)])]
    .filter((id):id is string=>typeof id==='string'&&id.length>0));
}

export function timelineOrder(a:TimelineEntry,b:TimelineEntry){return b.time-a.time||(a.id<b.id?1:a.id>b.id?-1:0);}

export async function collaborationTimeline(s:State,scope:TimelineScope,load:(id:string)=>Promise<ArchiveBundle>){
  const rows=new Map<string,TimelineEntry>();
  const {teamId,sessionId}=scope;
  const periods=(s.memberships??[]).filter(p=>(!teamId||p.teamId===teamId)&&(!sessionId||p.sessionId===sessionId));
  const teams=new Set(teamId?[teamId]:periods.map(p=>p.teamId));
  const add=(id:string,time:number,kind:string,source:string,summary:string,detail?:string)=>{
    rows.set(id,{id,time,kind,source,summary,...(detail&&{detail})});
  };
  for(const p of periods){
    add(p.id+'/in',p.start??p.observed,p.start===undefined?'既有绑定':'加入团队',p.sessionId,p.teamTitle+' · '+p.label);
    if(p.end!==undefined)add(p.id+'/out',p.end,'解除绑定',p.sessionId,(p.lastTeamTitle??p.teamTitle)+' · '+(p.lastLabel??p.label));
  }
  function include(id:string,actors:string[]){
    return teams.has(id)&&(!sessionId||actors.includes(sessionId));
  }
  const projectOwners=new Set([...(s.projects??[]).map(p=>p.id),...(s.archives??[]).flatMap(a=>a.projectIds)]);
  function recordOwner(owner:string,row:Parameters<typeof recordTeamAt>[1]){
    return row.provenance?.teamId??row.teamId??(projectOwners.has(owner)?recordTeamAt(s,row):owner)??'';
  }
  function records(b:Partial<ArchiveBundle>){
    for(const m of b.messages??[])if(include(m.teamId,[m.sender,m.target])){
      add(m.id,m.time,m.system?'团队通知':m.kind??'request',m.sender,m.text,JSON.stringify({sender:m.sender,target:m.target,state:m.state,native:m.native,replyTo:m.replyTo,id:m.id,error:m.error,cancellation:m.cancellation},null,2));
      if(m.ack)add(m.id+'/ack',m.ack.time,'确认收到',m.target,m.ack.note||m.id);
      if(m.cancellation)add(m.id+'/cancel',m.cancellation.time,'撤回',m.sender,m.cancellation.reason);
    }
    for(const e of b.events??[])if(include(e.teamId,[e.sessionId??'',e.incident?.member??''])||(!e.sessionId&&!e.incident&&periods.some(p=>p.sessionId===p.anchor&&p.teamId===e.teamId&&e.time>=(p.start??p.observed)&&(e.time<(p.end??Infinity)||e.kind==='dissolve'&&e.time===p.end))))
      add(e.id,e.time,e.kind,e.sessionId??e.incident?.member??'Team Desk',e.text);
    for(const op of b.hostOperations??[])if(include(op.teamId,op.sessions))add(op.id,op.time,op.kind,'Team Desk',op.state,op.error??op.sessions.join('\n'));
    for(const group of b.tasks??[])for(const task of group.entries)for(const h of task.history)if(include(group.owner,[h.actor]))add('task/'+group.owner+'/'+task.key+'/'+h.revision,h.time,'任务 · '+h.action,h.actor,task.key,h.note);
    for(const group of b.controls??[])for(const c of group.entries)if(include(group.owner,[c.from,c.to]))add(c.id,c.time,'会话控制',c.from,c.reason,c.state);
    for(const group of b.changes??[])for(const c of group.entries)if(include(recordOwner(group.owner,c),[c.author]))add(c.id,c.time,'文件变更',c.author,c.resource,c.summary);
    for(const group of b.history??[])for(const h of group.entries)if(include(recordOwner(group.owner,h),[h.author]))add(h.id,h.time,'共享记录',h.author,h.key,h.reason);
  }
  records({events:s.events,messages:s.messages,hostOperations:s.hostOperations??[]});
  for(const t of [...s.teams,...s.retiredLedgers??[],...s.projects??[]]){
    records({changes:[{owner:t.id,entries:t.changes??[]}],history:[{owner:t.id,entries:t.history??[]}],
      ...('tasks' in t&&{tasks:[{owner:t.id,entries:t.tasks??[]}]}),...('controls' in t&&{controls:[{owner:t.id,entries:t.controls??[]}]})});
  }
  const projects=new Set((s.projects??[]).filter(p=>p.teamIds.some(id=>teams.has(id))).map(p=>p.id));
  for(const archive of s.archives??[]){
    const relevantProject=archive.sourceTeamIds?.some(id=>teams.has(id))||archive.projectIds.some(id=>projects.has(id))&&!archive.sourceTeamIds?.length;
    if(relevantProject||archive.teamIds.some(id=>teams.has(id))){
      try{records(await load(archive.id));}catch(error){throw Error('归档 '+archive.id+' · '+String(error));}
    }
  }
  return [...rows.values()].sort(timelineOrder);
}
