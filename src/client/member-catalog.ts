import type {SnapshotStore} from '@deepseek-ai/dsh-client-store';
import type {ViewData} from './contracts.ts';

/** Only contribute group ownership. DSH owns the indicator, statuses, tree and navigation. */
export function installMemberCatalog(store:SnapshotStore<ViewData>){
 let previous:ViewData['state']['teams']|undefined;
 let owners=new Map<string,string>();
 const notify=()=>window.dispatchEvent(new Event('dsh:subagent-owners-changed'));
 const update=()=>{
  const teams=store.getSnapshot().state.teams;
  if(previous===teams)return;
  previous=teams;
  const next=new Map<string,string>();
  for(const team of teams){
   const members=team.members.filter(m=>m.active!==false).map(({sessionId,label})=>({sessionId,label}));
   const serialized=JSON.stringify(members);
   for(const member of members)next.set(member.sessionId,serialized);
  }
  if(next.size===owners.size&&[...next].every(([id,value])=>owners.get(id)===value))return;
  owners=next;notify();
 };
 const read=(event:Event)=>{
  const detail=(event as CustomEvent<{sessionId:string;owners:string}>).detail;
  detail.owners=owners.get(detail.sessionId)??'';
 };
 window.addEventListener('dsh:subagent-owners',read);
 const stop=store.subscribe(update);update();
 return ()=>{stop();window.removeEventListener('dsh:subagent-owners',read);notify();};
}
