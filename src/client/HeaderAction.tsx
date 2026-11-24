import {tr} from './locale.ts';
import {Button,Tooltip,IconUsersOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {PropsRuntime,InjectFace} from '@deepseek-ai/dsh-client-ui-slots';
import type {Injected} from './contracts.ts';

/** The native utilities slot is session-scoped, including the active shared header. */
export function HeaderAction(props:PropsRuntime<'conversation.session.header.utilities'> & InjectFace<Injected>){
 const team=props.useTeamDesk(data=>data.state.teams.find(t=>t.members.some(m=>m.sessionId===props.memberOwner(props.sessionId))));
 const label=team?tr("编辑团队"):tr("创建团队");
 return <Tooltip label={label} side="bottom" delayMs={500} portal>
  <Button size="sm" className="td-header-action" aria-label={label} aria-haspopup="dialog"
   data-team-header-action={props.sessionId} onClick={()=>props.showSettings(props.memberOwner(props.sessionId))}>
   <IconUsersOutlineRegular size={16}/>
  </Button>
 </Tooltip>;
}

export function HomeAction(props:PropsRuntime<'conversation.session.header.home.utilities'> & InjectFace<Injected>){return <HeaderAction {...props}/>;}
