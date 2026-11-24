import {isAbsolute,resolve} from 'node:path';
import {isWithin} from '../domain/ledger.ts';
import type {} from '@deepseek-ai/dsh-agent-team';
import type {} from '@deepseek-ai/dsh-working-directory';
import {seatHost} from './seat-settings.ts';
import {rememberTitleRequest} from '../host-support/title-receipt.ts';
import {nativeDelivery} from './delivery.ts';
import type { Context } from '@deepseek-ai/cordis';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-workspace';
import type { Message, NativeHost, Team } from '../domain/types.ts';

/** Read only the projection of loaded sessions. Resolving an offline agent would wake it. */
export function workingOnFile(ctx:Context,team:Team,file:string):string[]{
  const projections=ctx.get('sessionProjections');
  if(!isAbsolute(file)||!projections)return [];
  return team.members.filter(member=>{
    if(member.active===false||!member.operations.includes('read'))return false;
    const root=ctx.sessions.get(SessionId(member.sessionId));
    if(!root)return false;
    const board=projections.snapshot(root,['agentTeam']).values.agentTeam;
    return board?.tasks.some(task=>{
      if(task.status!=='in_progress'||!task.writeScopes.length)return false;
      const owner=task.ownerId?ctx.sessions.get(task.ownerId):root;
      if(!owner)return false;
      const cwd=projections.snapshot(owner,['workingDirectory']).values.workingDirectory??owner.header.cwd;
      return !!cwd&&isAbsolute(cwd)&&task.writeScopes.some(scope=>!isAbsolute(scope)&&!scope.split(/[\\/]/).includes('..')&&isWithin(resolve(cwd,scope),file));
    });
  }).map(member=>member.sessionId);
}
/** All DSH runtime calls stay here; every member uses native Web composition. */
export function nativeHost(ctx:Context):NativeHost {
  let closed=false;
  return {
    ...seatHost(ctx),
    workingOnFile:(team,file)=>workingOnFile(ctx,team,file),
    async preparePersonas(requests){const bridge=(ctx as unknown as {get(name:string):any}).get('privateSoulBridge');if(!bridge)return undefined;if(bridge.protocol!==1)throw Error('Soul Desk bridge version is incompatible');return {bridge,token:bridge.prepare(requests)};},
    async applyPersonas(value){const plan=value as {bridge:{apply(token:unknown):Promise<unknown>};token:unknown};if((ctx as unknown as {get(name:string):unknown}).get('privateSoulBridge')!==plan.bridge)throw Error('Soul Desk became unavailable while applying the preset');await plan.bridge.apply(plan.token);},
    archived:id=>ctx.get('workspaceRegistry')?.archivedSessionIds.includes(SessionId(id)),
    async canBind(id){
      const key=SessionId(id),header=ctx.sessions.get(key)?.header??(await ctx.sessionPersistence.stat(key))?.header;
      return !!header&&header.origin!=='subagent';
    },
    async exists(id){return ctx.sessions.get(SessionId(id))!==undefined || (await ctx.get('sessionPersistence')?.stat(SessionId(id)))!==undefined;},
    async create(id,cwd,parent,label,mode){
      if(closed)throw Error('Team Desk host is stopped');
      const registry=ctx.get('workspaceRegistry');
      const workspace=registry?.list().find(w=>w.sessionIds.includes(SessionId(parent)))??registry?.list().find(w=>w.path===cwd);
      if(!workspace)throw new Error('The anchor conversation must belong to a registered workspace');
      await ctx.sessionController.create({sessionId:SessionId(id),workspaceId:workspace.id,...(mode?{agentPreset:mode}:{})});
      if(closed)throw Error('Team Desk stopped while creating the conversation');
    },
    ...nativeDelivery(ctx,rememberTitleRequest),
    async brief(id,text,wakeup){
      const result=await ctx.sessionController.resolveAgent(SessionId(id));
      if('error' in result)throw result.error;
      if(closed)throw Error('Team Desk host is stopped');
      result.agent.send(createUserMessage({content:[{type:'text',text}],source:{kind:'user'}}),'next-turn',wakeup);
    },
    status(id){return ctx.agents.get(SessionId(id))?.status ?? 'offline';},
    interrupt(id){ctx.sessionController.cancel({sessionId:SessionId(id)});},
    stopOwned:async()=>{closed=true;},
  };
}
