import type {SessionListState} from '@deepseek-ai/dsh-api-session-controller/client';
import type {Team} from '../domain/types.ts';
import {teamSessionTitle,type TitleHint} from '../domain/session-title.ts';
type PresentedSummary=SessionListState['byId'][keyof SessionListState['byId']]&{presentationTitle?:string;managedChildren?:PresentedSummary[]};

/** Workspace presentation and draft reservation never change native blankness. */
export class TeamSessionCatalog {
  private members=new Set<string>();
  private labels=new Map<string,string>();
  private hints:Record<string,TitleHint>={};
  private groups:string[][]=[];
  private branches=new Map<string,string>();
  private membership='';
  private previous:SessionListState|undefined;
  private projected:SessionListState|undefined;
  private nativePrevious:SessionListState|undefined;
  private nativeProjected:SessionListState|undefined;

  setTeams(teams:readonly Team[],hints:Record<string,TitleHint>={}):boolean {
    const members=new Set(teams.flatMap(team=>team.members.map(member=>member.sessionId)));
    const labels=new Map(teams.flatMap(team=>team.members.map(member=>[member.sessionId,member.label] as const)));
    const groups=teams.filter(team=>team.anchor).map(team=>{
      const active=new Set(team.members.map(member=>member.sessionId));
      const order=new Set([...(team.sidebarOrder??[]),...active]);
      return [team.anchor,...[...order].filter(id=>id!==team.anchor && active.has(id))];
    });
    const membership=JSON.stringify([groups,[...labels].sort(([a],[b])=>a.localeCompare(b)),hints]);
    if(membership===this.membership)return false;
    this.groups=groups;
    this.branches=new Map(groups.flatMap(([parent,...children])=>parent?[[parent,'root'] as const,...children.map((id,index)=>[id,index===children.length-1?'last':'member'] as const)]:[]));
    this.hints=hints;this.members=members;this.labels=labels;this.membership=membership;this.previous=undefined;this.nativePrevious=undefined;
    return true;
  }

  snapshot(source:SessionListState):SessionListState {
    if(source===this.previous)return this.projected!;
    let byId=source.byId;
    const decorate=(row:PresentedSummary,id:string):PresentedSummary=>{
      const label=this.labels.get(id),children=row.managedChildren?.map(child=>decorate(child,child.id));
      const changedChildren=children?.some((child,i)=>child!==row.managedChildren?.[i]);
      if(!label&&!changedChildren)return row;
      return {...row,...(label?{blank:false,tdBranch:this.branches.get(id),presentationTitle:teamSessionTitle(row.title,label,this.hints[id])}:{}),...(changedChildren?{managedChildren:children!}:{})};
    };
    for(const id of source.ids){
      const row=source.byId[id];if(!row)continue;
      const next=decorate(row,id);if(next===row)continue;
      if(byId===source.byId)byId={...source.byId};
      // The native sidebar keeps title for renaming; only its label reads this optional field.
      byId[id]=next;
    }
    this.previous=source;
    return this.projected=byId===source.byId?source:{...source,byId};
  }

  ordered<T extends {id:string;tdBranch?:string}>(rows:T[],expanded:Readonly<Record<string,boolean>>={}):T[] {
    const byId=new Map(rows.map(row=>[row.id,row]));
    const leaves=new Set<string>();
    const grouped=new Map<string,T[]>(),nested=new Set<string>();
    for(const [anchor,...children] of this.groups){
      if(!anchor||!byId.has(anchor))continue;
      const members=children.flatMap(id=>byId.has(id)?[byId.get(id)!]:[]);
      if(!members.length)leaves.add(anchor);
      for(const member of members)nested.add(member.id);
      grouped.set(anchor,expanded[anchor]===false?[]:members.map((row,i)=>{
        if(!row.tdBranch)return row;
        const tdBranch=i===members.length-1?'last':'member';
        return row.tdBranch===tdBranch?row:{...row,tdBranch};
      }));
    }
    return rows.flatMap(row=>{
      if(nested.has(row.id))return [];
      if(row.tdBranch==="root"&&leaves.has(row.id))return [{...row,tdBranch:"solo"}];
      if(grouped.has(row.id))return [row,...grouped.get(row.id)!];
      // A filtered or archived anchor must not visually attach its seats to the preceding team.
      if(row.tdBranch==='member'||row.tdBranch==='last'){
        const standalone={...row};delete standalone.tdBranch;return [standalone];
      }
      return [row];
    });
  }

  archivedWorkspaces<T extends {sessionIds:readonly string[]}>(workspaces:readonly T[],archived:ReadonlySet<string>):readonly T[]{
    if(!archived.size)return workspaces;
    const parentOf=new Map<string,string>();
    for(const [parent,...members] of this.groups)if(parent&&archived.has(parent)){
      for(const member of members)if(archived.has(member))parentOf.set(member,parent);
    }
    if(!parentOf.size)return workspaces;
    const homes=new Map<string,T>();
    for(const workspace of workspaces)for(const id of workspace.sessionIds)homes.set(id,workspace);
    return workspaces.map(workspace=>{
      const remove=workspace.sessionIds.filter(id=>parentOf.has(id)&&homes.get(parentOf.get(id)!)!==workspace);
      const add=[...parentOf].filter(([id,parent])=>homes.get(parent)===workspace&&!workspace.sessionIds.includes(id)).map(([id])=>id);
      return remove.length||add.length?{...workspace,sessionIds:[...workspace.sessionIds.filter(id=>!remove.includes(id)),...add]}:workspace;
    });
  }

  boundChild(id:string):boolean {return this.branches.get(id)==='member'||this.branches.get(id)==='last';}

  reserved(id:string):boolean {return this.members.has(id);}

  /** Decorate native displayTitle, preserving raw title, blankness, projections and rename sources. */
  nativeSnapshot(source:SessionListState):SessionListState {
    if(source===this.nativePrevious)return this.nativeProjected!;
    let byId=source.byId;
    for(const id of source.ids){
      const row=source.byId[id],label=this.labels.get(id);
      if(!row||!label)continue;
      const displayTitle=teamSessionTitle(row.title,label,this.hints[id]);
      if(row.displayTitle===displayTitle)continue;
      if(byId===source.byId)byId={...source.byId};
      byId[id]={...row,displayTitle};
    }
    this.nativePrevious=source;
    return this.nativeProjected=byId===source.byId?source:{...source,byId};
  }
}

/** Reserve drafts at the workspace reuse boundary; project blank=false only for sidebar rows. */
export function reserveTeamDrafts(source:Pick<{getSnapshot():SessionListState},'getSnapshot'>,catalog:TeamSessionCatalog,events:EventTarget,expansion:()=>Readonly<Record<string,boolean>>=()=>({})):()=>void {
  const descriptor=Object.getOwnPropertyDescriptor(source,'getSnapshot'),original=source.getSnapshot;
  let active=true;
  const getSnapshot=()=>{const snapshot=original.call(source);return active?catalog.nativeSnapshot(snapshot):snapshot;};
  source.getSnapshot=getSnapshot;
  const reuse=(event:Event)=>{const id=(event as CustomEvent<{sessionId?:unknown}>).detail?.sessionId;if(typeof id==='string'&&catalog.reserved(id))event.preventDefault();};
  const project=(event:Event)=>{const detail=(event as CustomEvent<{list:SessionListState;result:SessionListState}>).detail;if(detail?.result)detail.result=catalog.snapshot(detail.result);};
  const ordered=(event:Event)=>{const detail=(event as CustomEvent<{rows:{id:string}[]}>).detail;detail.rows=catalog.ordered(detail.rows,expansion());};
  const archive=(event:Event)=>{if(catalog.boundChild((event as CustomEvent<string>).detail))event.preventDefault();};
  const workspaces=(event:Event)=>{
    const info=(event as CustomEvent<{workspaces:readonly {sessionIds:readonly string[]}[];archived:Set<string>}>).detail;
    info.workspaces=catalog.archivedWorkspaces(info.workspaces,info.archived);
  };
  events.addEventListener('dsh:archived-team-workspaces',workspaces);
  events.addEventListener('dsh:team-member-archive',archive);
  events.addEventListener('dsh:sidebar-seat-order',ordered);
  events.addEventListener('dsh:session-reuse-candidate',reuse);events.addEventListener('dsh:session-catalog-project',project);
  return()=>{
    events.removeEventListener('dsh:archived-team-workspaces',workspaces);
    events.removeEventListener('dsh:team-member-archive',archive);
    active=false;events.removeEventListener('dsh:sidebar-seat-order',ordered);
    events.removeEventListener('dsh:session-reuse-candidate',reuse);events.removeEventListener('dsh:session-catalog-project',project);
    if(source.getSnapshot!==getSnapshot)return;
    if(descriptor)Object.defineProperty(source,'getSnapshot',descriptor);
    else delete (source as Partial<typeof source>).getSnapshot;
  };
}
