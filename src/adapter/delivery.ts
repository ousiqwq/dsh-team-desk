import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {Session} from '@deepseek-ai/dsh-session';
import {freezeMessage,MessageId} from '@deepseek-ai/dsh-llm';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {Message} from '../domain/types.ts';

export const deliveryPrefix='team-desk:';
export function deliveryText(message:Message){
  const metadata={id:message.id,sender:message.sender,target:message.target,kind:message.kind??'request',priority:message.priority??'normal',code:message.code,replyTo:message.replyTo,followUpTo:message.followUpTo,allowReply:message.allowReply,...(!message.system&&message.kind==='request'?{replyAddress:{target:message.sender,reply_to:message.id}}:{}),taskId:message.taskId,evidence:message.evidence,payload:message.payload,eventVersion:message.eventVersion,dependsOn:message.dependsOn,publication:message.publication};
  return `[Team Desk ${message.system?(message.code==='team_run_status'?'运行通知':'同步通知'):'成员消息'} ${JSON.stringify(metadata)}]\n${message.text}`;
}

/** Stable native IDs let an interrupted sender reconcile without duplicating a turn. */
export function nativeDelivery(ctx:Context,attest?:(target:string,sender:string,id:string,text:string)=>Promise<void>){
  const histories=new WeakMap<Session,{ids:Set<string>;loading?:Promise<void>}>();
  ctx.on('session/event',(session,event)=>{if(event.type==='user/message'&&event.data.id.startsWith(deliveryPrefix))histories.get(session)?.ids.add(event.data.id);});
  async function inspect(agent:Agent,id:string):Promise<'admitted'|'queued'|'absent'>{
    let state=histories.get(agent.session);
    if(!state){state={ids:new Set()};histories.set(agent.session,state);}
    const cached=state;
    cached.loading??=(async()=>{
      await ctx.sessionPersistence.flush();
      await using handle=await ctx.sessionPersistence.open(agent.id,'read');
      for(let offset=0;;){const {events}=await handle.read(offset,512);if(!events.length)break;for(const e of events)if(e.type==='user/message'&&e.data.id.startsWith(deliveryPrefix))cached.ids.add(e.data.id);offset+=events.length;}
    })().catch(e=>{delete cached.loading;throw e;});
    await cached.loading;
    if(cached.ids.has(id))return 'admitted';
    return [...agent.inbox.nextStep,...agent.inbox.nextTurn].some(m=>m.id===id)?'queued':'absent';
  }
  async function resolve(message:Message){const result=await ctx.sessionController.resolveAgent(SessionId(message.target));if('error'in result)throw result.error;return result.agent;}
  return {
    async retract(message:Message):Promise<boolean>{
      if(!message.epoch)return false;const agent=await resolve(message);const removed=agent.inbox.remove(MessageId(deliveryPrefix+message.id));await ctx.sessionPersistence.flush();return removed;
    },
    async probe(message:Message):Promise<'queued'|'admitted'|'absent'|'unknown'>{
      if(!message.epoch)return 'unknown'; // Legacy sends used random native IDs.
      try{const agent=await resolve(message),status=await inspect(agent,deliveryPrefix+message.id);return status==='absent'&&agent.status==='running'?'unknown':status;}catch{return 'unknown';}
    },
    async deliver(message:Message,signal?:AbortSignal,authorize?:()=>void):Promise<'queued'|'admitted'>{
      signal?.throwIfAborted();const agent=await resolve(message),id=deliveryPrefix+message.id;
      const status=await inspect(agent,id);if(status!=='absent')return status;
      signal?.throwIfAborted();authorize?.();
      if(ctx.agents.get(agent.id)!==agent)throw Error('Recipient was disposed');
      const text=deliveryText(message);
      if(attest&&!message.system&&(message.kind??'request')==='request'){
        try{await attest(message.target,message.sender,id,text);}catch(e){ctx.logger.warn('Team title receipt unavailable: '+String(e));}
        signal?.throwIfAborted();authorize?.();
        if(ctx.agents.get(agent.id)!==agent)throw Error('Recipient was disposed');
      }
      agent.send(freezeMessage({id:MessageId(id),role:'user' as const,content:[{type:'text',text}],source:{kind:'agent-message',form:'relay' as const,senderSessionId:SessionId(message.sender)}}),message.delivery??'next-turn',message.wakeup??true);
      await ctx.sessionPersistence.flush();
      return (await inspect(agent,id))==='admitted'?'admitted':'queued';
    },
  };
}
