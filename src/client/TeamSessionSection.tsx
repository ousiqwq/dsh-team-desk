import type {} from '@deepseek-ai/dsh-client-ui-session-panel/client';
import type {PropsRuntime, InjectFace} from '@deepseek-ai/dsh-client-ui-slots';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {SessionTarget} from '@deepseek-ai/dsh-api-session-controller/client';
import type {Injected} from './contracts.ts';
import {tr} from './locale.ts';
import {paneTitle} from './presentation.ts';

type Props = PropsRuntime<'conversation.session.panel.section'> & InjectFace<Injected>;
export function TeamSessionSection(props:Props) {
  const team = props.useTeamDesk(s=>s.state.teams.find(t=>t.members.some(m=>m.sessionId===props.memberOwner(props.sessionId))));
  const hints=props.useTeamDesk(s=>s.titleHints);
  const sessions = props.useSessions(s=>s);
  if (!team) return null;
  const open = (root:string,target:SessionTarget) => {
    props.openMemberTarget(root,target);
    props.dismissOverlay();
  };
  const branch = (parent:SessionId, root:string, seen:Set<SessionId>):React.ReactNode => {
    if (seen.has(parent)) return null;
    seen.add(parent);
    return sessions.projectionsBySession[parent]?.values.subagentCatalog?.map(child=>{
      const mode=child.mode;
      const name=sessions.byId[child.id]?.title || ('label' in child && child.label) || ('name' in child && child.name) || child.id;
      return <li key={child.id}>{mode==='external' ? <span>{name}</span> :
        <><button type="button" onClick={()=>open(root,{parentSessionId:parent,childSessionId:child.id,mode})}>{name}</button>
        <ul>{branch(child.id,root,seen)}</ul></>}</li>;
    });
  };
  return <ul className="td-panel-members">{team.members.filter(m=>m.active!==false).map(member=>{
    const id=member.sessionId as SessionId;
    return <li key={id}><button type="button" onClick={()=>open(id,id)}>{paneTitle(sessions.byId[id]?.title,member.label,hints?.[id])}{team.hidden.includes(id)&&<small> · {tr('窗格已关闭')}</small>}</button>
      <ul>{branch(id,id,new Set())}</ul></li>;
  })}</ul>;
}
