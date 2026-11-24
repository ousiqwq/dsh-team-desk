import type {SessionListState,SessionSummary} from '@deepseek-ai/dsh-api-session-controller/client';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
export interface Owner {sessionId:string;parent:string;label:string;provider:string;available:boolean;position?:number;}
export interface Projection {owners:Owner[];error:string;}
interface ManagedSummary extends SessionSummary {managedChildren?:ManagedSummary[];managedAvailable?:boolean;presentationTitle?:string;}
/** Host-side projection preserves native summaries and their row decorations. */
export function project(list:SessionListState,state:Projection):SessionListState {
  const hidden=new Set(state.owners.filter(x=>list.byId[x.parent as SessionId]).map(x=>x.sessionId));
  const byId:Record<string,ManagedSummary>={...list.byId};
  for(const owner of [...state.owners].sort((a,b)=>(a.position??999)-(b.position??999))){const child=byId[owner.sessionId];if(child)byId[owner.sessionId]={...child,blank:false,presentationTitle:child.title||owner.label,managedAvailable:owner.available};}
  for(const id of hidden)delete byId[id];
  for(const owner of [...state.owners].sort((a,b)=>(a.position??999)-(b.position??999))){
    const parent=byId[owner.parent],child=list.byId[owner.sessionId as SessionId];if(!parent||!child)continue;
    byId[owner.parent]={...parent,blank:false,presentationTitle:parent.title||'团队',managedChildren:[...(parent.managedChildren??[]),{...child,blank:false,presentationTitle:child.title||owner.label,managedAvailable:owner.available}]};
  }
  return {...list,byId,ids:list.ids.filter(id=>!hidden.has(id))};
}
