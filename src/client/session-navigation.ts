import type {ISessions,SessionTarget,SessionReference} from '@deepseek-ai/dsh-api-session-controller/client';
import type {Team} from '../domain/types.ts';

/** Outside the team panel, the native main selection is authoritative, including absence. */
export function settingsSessionTarget(requested:string|undefined,panel:string|null,teamSession:string,mainSession:string|undefined):string {
  if(requested!==undefined)return requested;
  return panel==='team-desk'?teamSession:mainSession??'';
}

/** Restore an explicitly opened split view; membership alone never opens a team. */
export function sidebarTeamTarget(teams:readonly Team[],panel:string|null,activeTeam:string,id:string,hasSavedSplit:(teamId:string)=>boolean=()=>false):Team|undefined {
  return teams.find(team=>((panel==='team-desk'&&team.id===activeTeam&&!team.hidden.includes(id))||hasSavedSplit(team.id))&&team.members.some(member=>member.sessionId===id&&member.active!==false));
}

/** A persisted pane can render before the native catalog finishes reconnecting. */
export async function retainPaneSession(sessions:Pick<ISessions,'retain'|'refresh'>,target:SessionTarget):Promise<SessionReference> {
  const options = {source: 'teamDesk', facets: {conversation: true}} as const;
  try{return sessions.retain(target,options);}
  catch(error){
    // Only repair the catalog race. Explicit child routes and other failures keep native semantics.
    if(typeof target!=='string'||!(error instanceof Error)||error.message!==`sessions.retain: unknown session ${target}`)throw error;
    await sessions.refresh();
    return sessions.retain(target,options);
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {interface SessionReferenceSourceMap {teamDesk:unknown;}}
