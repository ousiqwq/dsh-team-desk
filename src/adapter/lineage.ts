import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-subagent';
import type {TeamEngine} from '../domain/engine.ts';

export interface NativeActor {memberSessionId:string;actorSessionId:string;rootSessionId:string;}
/** Identity comes from the live native tree, never from cwd or model arguments. */
export function resolveNativeActor(ctx:Context,engine:TeamEngine,agent:Agent|undefined):NativeActor|undefined {
  if(!agent||ctx.agents.get(agent.id)!==agent)return undefined;
  const active=(id:string)=>engine.membership(id)?.members.some(m=>m.sessionId===id&&m.active!==false);
  if(active(agent.id))return {memberSessionId:agent.id,actorSessionId:agent.id,rootSessionId:agent.id};
  try{
    const root=ctx.get('subagents')?.rootOf(agent);
    const since=root&&engine.membership(root.id)?.members.find(m=>m.sessionId===root.id)?.boundSince;
    if(root&&ctx.agents.get(root.id)===root&&active(root.id)&&(!since||agent.session.header.createdAt>=since))return {memberSessionId:root.id,actorSessionId:agent.id,rootSessionId:root.id};
  }catch{/* An unavailable root is not permission to guess membership. */}
  return undefined;
}
