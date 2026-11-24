import type {Member,Team} from './types.ts';

export interface IncidentSettings {
  viewAll: boolean;
  notifyAll: boolean;
  notifyOwn: boolean;
}

export function validateIncidentSettings(value:unknown):void {
  if(value===undefined)return;
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     Object.entries(value).some(([key,v])=>!['viewAll','notifyAll','notifyOwn'].includes(key)||typeof v!=='boolean')){
    throw Error('无效的异常记录与通知设置');
  }
}

export function incidentSupervisor(team:Team){
  const bindings=team.configuration?.bindings;
  return [bindings?.supervisor,bindings?.review,bindings?.lead,team.briefing?.reviewer,team.anchor]
    .find(id=>id && team.members.some(m=>m.sessionId===id && m.active!==false));
}

export function incidentSettings(member:Member, supervisor:string|undefined):IncidentSettings {
  const defaultAll=member.sessionId===supervisor;
  return {viewAll:member.incidents?.viewAll??defaultAll,notifyAll:member.incidents?.notifyAll??defaultAll,
    notifyOwn:member.incidents?.notifyOwn??true};
}
