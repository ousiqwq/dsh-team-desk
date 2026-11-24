import {randomUUID} from 'node:crypto';
import type {SessionRequestId} from '@deepseek-ai/dsh-api-session-controller/types';
import type {Context} from '@deepseek-ai/cordis';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {TeamEngine} from '../domain/engine.ts';
import type {SeatRun,RunIssue} from '../domain/types.ts';
import {ReviewFailures,historicalReviewBlock} from './review-failures.ts';
import {deliveryPrefix} from './delivery.ts';

export function interruptedStream(code:string,message:string){
  return ['STREAM_CLOSED','TRANSPORT','TIMEOUT','SERVER','EMPTY_RESPONSE'].includes(code)
    ||code==='PI_AI_ERROR'&&/upstream response stream was interrupted|stream ended before message_stop/i.test(message);
}

/** Only a live failure observed by this instance can schedule a continuation. Never wake historical work on load. */
export function trackMemberRuns(ctx:Context,engine:TeamEngine){
  type Watch={run:SeatRun;reviews:ReviewFailures;turnInput?:'work'|'status'|undefined;tools:Set<string>;timer?:ReturnType<typeof setTimeout>;};
  const watches=new Map<string,Watch>();
  const clear=(w:Watch)=>{clearTimeout(w.timer);delete w.timer;};
  const save=(id:string,w:Watch,issue?:RunIssue,observed?:RunIssue[])=>{void engine.setSeatRun(id,structuredClone(w.run),issue,observed).catch(e=>engine.syncFailure(e));};
  // A confined shell can return a normal tool result with a structured sandbox denial.
  const stopShell=ctx.on('tools/post-execute',(exec,result,next)=>{
    if(exec.agent && exec.name==='bash' && !result.isError)watches.get(exec.agent.id)?.reviews.observeShell(exec.callId,result.value);
    return next();
  });
  const stop=ctx.on('session/event',(session,event)=>{
    const id=session.id,team=engine.membership(id);
    let w=watches.get(id);
    if(!team?.epoch||team.paused||!team.members.some(m=>m.sessionId===id&&m.active!==false)){
      if(w){clear(w);watches.delete(id);}
      return;
    }
    const binding=team.members.find(m=>m.sessionId===id)?.bindingId;
    if(w&&(w.run.epoch!==team.epoch||w.run.bindingId!==binding)){clear(w);watches.delete(id);w=undefined;}
    if(event.type==='user/message'){
      const input=event.data,source=input.source.kind;
      const msg=input.id.startsWith(deliveryPrefix)?engine.memberInput(input.id.slice(deliveryPrefix.length)):undefined;
      if(msg&&!engine.currentInput(team,msg))return;
      if(msg?.system&&msg.code==='team_run_status'){
        if(w&&w.turnInput!=='work')w.turnInput='status';
        return;
      }
      if(source==='retry'&&w){w.turnInput='work';clear(w);w.run.phase='working';delete w.run.error;delete w.run.reviewBlock;save(id,w);return;}
      if(source!=='user'&&(!msg||msg.system||!['request','reply'].includes(msg.kind??'request')))return;
      const old=w;
      if(old)clear(old);
      const saved=engine.seatRun(id);
      const known=saved?.phase==='delivered'?[]:saved?.requests??[];
      const requests=[...new Set([...known,...(old&&old.run.input!==saved?.input?old.run.requests:[])])];
      if(msg&&(msg.kind??'request')==='request'&&!requests.includes(msg.id))requests.push(msg.id);
      w={turnInput:'work',run:{...(binding&&{bindingId:binding}),trackedLive:true,input:input.id,epoch:team.epoch,attempts:0,phase:'working',requests},reviews:old?.reviews??new ReviewFailures(),tools:old?.tools??new Set()};
      watches.set(id,w);save(id,w);return;
    }
    if(!w)return;
    w.reviews.observe(event);
    if(event.type==='turn/start'){w.turnInput=undefined;clear(w);return;}
    if(w.turnInput==='status')return;
    if(event.type==='tool/call'){w.tools.add(event.data.callId);return;}
    if(event.type==='tool/result'){w.tools.delete(event.data.message.toolCallId);return;}
    if(event.type!=='turn/end')return;
    clear(w);
    const reason=event.data.reason;
    w.run.phase=reason.kind==='error'?'interrupted':reason.kind==='completed'?(w.run.requests.length?'awaiting-reply':'completed'):'stopped';
    delete w.run.error;
    delete w.run.reviewBlock;
    const failure=w.reviews.latest();
    if(reason.kind==='completed'&&w.run.requests.length&&failure){
      w.run.phase='blocked';
      w.run.reviewBlock=failure;
    }
    let issue:RunIssue|undefined;
    let canRetry=false;
    if(w.run.phase==='blocked'&&failure){
      issue={stage:'attention',code:failure.reason,tool:failure.tool};
    }else if(reason.kind==='error'){
      const code=/^[A-Z][A-Z_0-9]{0,63}$/.test(reason.error.code)?reason.error.code:'MODEL_ERROR';
      w.run.error=code;
      const transient=interruptedStream(code,reason.error.message);
      if(!transient)w.run.phase='blocked';
      canRetry=transient && !w.tools.size && w.run.attempts<2;
      const detail=w.tools.size?'有工具尚未返回结果，需核对执行状态':transient&&!canRetry?'已达到两次自动续跑上限':undefined;
      issue={stage:canRetry?'retrying':'attention',code,...(detail?{detail}:{})};
    }else if(reason.kind!=='completed'){
      const cancelled=reason.kind==='aborted';
      const code=cancelled?({user:'USER_STOP',parent:'PARENT_STOP',hook:'HOOK_STOP',disposed:'SESSION_CLOSED',legacy:'SESSION_STOPPED'}[reason.reason?.kind]??'SESSION_STOPPED'):
        reason.kind==='max-tokens'?'MAX_TOKENS':reason.kind==='blocked'?'TURN_BLOCKED':reason.kind.toUpperCase().replaceAll('-','_');
      w.run.error=code;
      issue={stage:cancelled?'stopped':'attention',code};
    }else if(w.run.requests.length){
      const tool=w.reviews.toolError();
      if(tool)issue={stage:'attention',tool:tool[0],code:tool[1],detail:'本轮结束时仍有工具报错，尚未回传'};
    }
    save(id,w,issue,w.reviews.observed());
    if(!canRetry)return;
    const watch=w,attempt=w.run.attempts;
    watch.timer=setTimeout(()=>{
      const agent=ctx.agents.get(SessionId(id)),current=engine.membership(id),run=engine.seatRun(id);
      if(watches.get(id)!==watch||watch.run.phase!=='interrupted'||run?.phase!=='interrupted'||run.input!==watch.run.input||!current||current.epoch!==watch.run.epoch||watch.run.bindingId!==current.members.find(m=>m.sessionId===id)?.bindingId||current.paused||!current.members.some(m=>m.sessionId===id&&m.active!==false))return;
      if(!agent||agent.status!=='idle'||[...agent.inbox.nextStep,...agent.inbox.nextTurn].some(input=>!input.id.startsWith(deliveryPrefix)||!engine.memberInput(input.id.slice(deliveryPrefix.length))?.system)){
        save(id,watch,{stage:'stopped',code:'RETRY_SUPERSEDED'});
        return;
      }
      const retry=createUserMessage({source:{kind:'retry',rpcId:randomUUID() as SessionRequestId},content:[{type:'text',text:'Resume the interrupted turn from the last confirmed result. Use the existing request and its original reply address. Check uncertain effects before repeating any action.'}]});
      watch.run.attempts++;save(id,watch);
      try{agent.send(retry,'next-turn',true);}catch(e){save(id,watch,{stage:'attention',code:'RETRY_UNAVAILABLE'});engine.syncFailure(e);}
    },attempt?6000:2000);
    watch.timer.unref();
  });
  return ()=>{stop();stopShell();for(const w of watches.values())clear(w);watches.clear();};
}

/** Older versions saved only "awaiting-reply". Rebuild its display from a read-only native cut. */
export async function recoverReviewStatus(ctx:Context,engine:TeamEngine){
  const query=ctx.get('sessionQuery');
  if(!query)return;
  for(const team of engine.snapshot().teams){
    if(team.paused)continue;
    for(const [id,run] of Object.entries(team.runs??{})){
      if(run.phase!=='awaiting-reply'||run.epoch!==team.epoch||!run.requests.length)continue;
      try{
        using cut=await query.observeSession(SessionId(id),{});
        const failure=historicalReviewBlock(cut.events,run.input);
        if(failure)engine.projectReviewBlock(id,run,failure);
      }catch(error){console.warn('[team-desk] Could not read prior member review status:',id,error instanceof Error?error.name:'unknown');}
    }
  }
}
