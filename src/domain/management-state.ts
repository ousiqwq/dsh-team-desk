import type {State, Team} from './types.ts';

import {recordTeamAt,type ProjectRecord} from './memberships.ts';

export async function archivedProjectRows(state:State,id:string,load:(key:string)=>Promise<import('./types.ts').ArchiveBundle>){
 const projects=new Set(state.projects?.filter(p=>p.teamIds.includes(id)).map(p=>p.id));
 const records=[];
 for(const ref of state.archives??[]){
   if(!ref.projectIds.some(p=>projects.has(p)))continue;
   const data=await load(ref.id);
   for(const projectId of ref.projectIds.filter(p=>projects.has(p))){
     const revisions=data.history.filter(g=>g.owner===projectId).flatMap(g=>g.entries);
     const changes=data.changes.filter(g=>g.owner===projectId).flatMap(g=>g.entries);
     const history=revisions.filter(row=>recordTeamAt(state,row)===id),files=changes.filter(row=>recordTeamAt(state,row)===id);
     const unattributed=[...revisions,...changes].filter(row=>!recordTeamAt(state,row)).length;
     if(history.length||files.length||unattributed)records.push({projectId,history,changes:files,unattributed});
   }
 }
 return records;
}

export function teamExport(state:State,id:string):State&{unattributed:number} {
 let unattributed=0;
 const teams=state.teams.filter(t=>t.id===id);
 const projects=(state.projects??[]).filter(p=>p.teamIds.includes(id)).map(project=>{
   function belongs(row:ProjectRecord){
     const owner=recordTeamAt(state,row);if(owner===undefined)unattributed++;return owner===id;
   }
   return {...project,teamIds:[id],shared:project.shared.filter(belongs),history:project.history.filter(belongs),
     changes:project.changes.filter(belongs),...(project.teamIds.length>1&&{resourceIndex:[]})};
 });
 return {...state,unattributed,archiveIntents:[],retiredLedgers:[],memberships:state.memberships?.filter(p=>p.teamId===id)??[],teams,projects,resources:[],presets:[],
   hostOperations:state.hostOperations?.filter(o=>o.teamId===id)??[],
   messages:state.messages.filter(m=>m.teamId===id),events:state.events.filter(e=>e.teamId===id),
   archives:state.archives?.filter(a=>a.teamIds.length===1&&a.teamIds[0]===id)??[],
   archivedKeys:state.archivedKeys?.filter(k=>k.teamId===id)??[]};
}

/** Read the fields consumed by this page without cloning unrelated ledgers. */
export function managementState(state:State,id:string,page:string):State {
 const team=state.teams.find(t=>t.id===id),sync=page==='sync',records=page==='records';
 const blocked=new Set(Object.values(team?.runs??{}).filter(r=>r.phase==='blocked'&&r.epoch===team?.epoch).flatMap(r=>r.requests));
 const teams=state.teams.map(({history,changes,resourceIndex,shared,tasks,controls,taskHeads,controlKeys,...t}):Team=>({
   ...t,...(t.id===id&&sync&&{shared:shared??[],changes:(changes??[]).slice(-100),controls:controls??[]}),
   ...(t.id===id&&(sync||page==='native')&&{tasks:tasks??[]})
 }));
 const projects=(state.projects??[]).filter(p=>p.teamIds.includes(id)).map(({history,changes,shared,resourceIndex,...p})=>({
    ...p,history:[],changes:sync?changes.slice(-100):[],shared:sync?shared:[]
 }));
 return {version:state.version,revision:state.revision,teams,projects,presets:state.presets,...(page==='manage.sessions'&&{memberships:state.memberships??[]}),
    messages:state.messages.filter(m=>m.teamId===id&&blocked.has(m.id)),events:[],
    resources:page==='manage.resources'?state.resources??[]:page==='native'?(state.resources??[]).map(r=>({...r,history:[],operations:[]})):[],archives:records?state.archives?.filter(a=>a.teamIds.includes(id)||a.projectIds.some(projectId=>projects.some(p=>p.id===projectId)))??[]:[],
    hostOperations:records?state.hostOperations?.filter(o=>o.teamId===id&&['uncertain','prepared'].includes(o.state))??[]:[],
    ...(state.retentionDays!==undefined&&{retentionDays:state.retentionDays})};
}
export function recordsPage(state:State,id:string,before:string,limit=50,incidentQuery=''){
 const all=state.messages.filter(m=>m.teamId===id);
 const end=before?Math.max(0,all.findIndex(m=>m.id===before)):all.length;
 const start=Math.max(0,end-limit),messages=all.slice(start,end);
 const events=state.events.filter(e=>e.teamId===id);
 const pending=all.filter(m=>['queued','dispatching','uncertain'].includes(m.state));
 return {messages,next:start>0?messages[0]!.id:null,incidents:events.filter(e=>e.incident&&[e.text,e.incident.code,e.incident.member,e.incident.input,...e.incident.requests].join(' ').toLowerCase().includes(incidentQuery.trim().toLowerCase())).slice(-100),events:events.filter(e=>!e.incident).slice(-100),
   queued:pending.filter(m=>m.state==='queued').length,uncertain:pending.filter(m=>m.state==='uncertain').length,
   oldest:pending.length?pending.reduce((time,m)=>Math.min(time,m.time),Infinity):null};
}
