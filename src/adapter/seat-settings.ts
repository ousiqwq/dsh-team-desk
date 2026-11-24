import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-permission-presets';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {SeatSelection,SeatSettings} from '../domain/seat-settings.ts';

export function seatHost(ctx:Context){
 const agentFor=async(id:string)=>{
  const result=await ctx.sessionController.resolveAgent(SessionId(id));
  if('error' in result)throw result.error;
  return result.agent;
 };
 const registry=()=>ctx.get('agentPresets');
 const permissions=()=>ctx.get('permissionPresets');
 return {
  async validateSeats(seats:SeatSelection[]){
   for(const {sessionId,label,settings:{mode,permission}} of seats){
    if(permission&&!permissions()?.names.includes(permission))throw Error(label+' · 权限不可用 · '+permission);
    if(!mode)continue;
    const entry=await registry()?.resolve(mode);
    if(!entry||entry.broken)throw Error(label+' · 模式不可用 · '+mode);
    if(!sessionId)continue;
    const agent=await agentFor(sessionId);
    const boundary=ctx.agents.turnBoundaryOf(agent.session);
    if(registry()!.presetForSession(agent.session)!==mode&&(boundary.openTurnStartSeq!==null||boundary.lastTurn>0))
     throw Error(label+' · 会话已开始，DSH 已锁定对话模式');
   }
  },
  async applySeat(id:string,{mode,permission}:SeatSettings){
   const agent=await agentFor(id);
   const modes=registry(),access=permissions();
   if(mode&&modes?.presetForSession(agent.session)!==mode){
    if(!modes)throw Error('DSH Agent preset service unavailable');
    await modes.select(agent,mode);
   }
   if(permission){
    if(!access)throw Error('DSH permission service unavailable');
    if(access.current(agent.session)!==permission)access.set(agent.session,permission);
   }
  }
 };
}
