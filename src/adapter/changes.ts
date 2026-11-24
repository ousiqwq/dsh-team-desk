import {CoordinationError} from '../domain/errors.ts';
import type {Context} from '@deepseek-ai/cordis';
import type {ToolExecution} from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-fs';
import type {TeamEngine} from '../domain/engine.ts';
import type {ObservationOrigin} from '../domain/types.ts';
import type {GitEngine} from '../domain/git/engine.ts';
import type {SyncJournal} from './sync-journal.ts';
import {resolveNativeActor} from './lineage.ts';
import {nativeMutations,mutationDetails,mutationTools} from './native-mutations.ts';
import {appendPluginRecord} from '@deepseek-ai/dsh-session';
import {mutationRecord,intentRecord,batchRecord} from './native-recovery.ts';

/** Preserve every native file effect and its original actor, even for a partial patch. */
export function observeChanges(ctx:Context,engine:TeamEngine,journal:SyncJournal,git?:GitEngine):()=>Promise<void>{
 // The host's model step identifies a batch, including nested calls in a PTC program.
 const steps=new Map<string,{id:string;turn:number;step:number;calls:Set<string>;release:()=>void}>();
 const stopStep=ctx.on('session/event',(session,event)=>{
  const current=steps.get(session.id);
  if(event.type==='tool/call'){
   if(!mutationTools.has(event.data.name)&&event.data.name!=='run_code')return;
   if(current?.turn===event.data.turn&&current.step===event.data.step){current.calls.add(event.data.callId);return;}
   const actor=resolveNativeActor(ctx,engine,ctx.agents.get(session.id));
   if(!actor)return;
   current?.release();
   const id='step/'+event.seq+'/'+event.data.turn+'/'+event.data.step;
   steps.set(session.id,{id,turn:event.data.turn,step:event.data.step,calls:new Set([event.data.callId]),release:engine.holdSyncBatch(session.id,id)});
  }else if(current&&(event.type==='step/end'||event.type==='turn/end'||event.type==='step/start')){
   current.release();steps.delete(session.id);
  }
 });
 const attempts=new Map<symbol,{id:string;origin:ObservationOrigin;member:string;actor:string}>();
 type Observation={resource:string;resourceId:string;version:string;beforeVersion?:string};
 const reads=new Map<symbol,{member:string;teamId:string;bindingId:string;resources:Set<string>}>();
 const versions=new Map<string,string>(),observed=new Map<symbol,Map<string,Observation>>(),jobs=new Set<Promise<unknown>>();
 const queue=(job:Promise<unknown>)=>{jobs.add(job);void job.catch(e=>engine.syncFailure(e)).finally(()=>jobs.delete(job));};
 const stopBefore=ctx.on('tools/execute',async(exec,next)=>{
  const actor=resolveNativeActor(ctx,engine,exec.agent);
  if(actor&&mutationTools.has(exec.name)){
   const team=engine.membership(actor.memberSessionId),base=team&&engine.observationOrigin(actor.memberSessionId,team.cwd);
   if(base){const child=exec.agent&&actor.actorSessionId!==actor.memberSessionId
      ?ctx.get('sessionProjections')?.snapshot(exec.agent.session,['subagent']).values.subagent:undefined;
    const step=steps.get(actor.actorSessionId);
    const batchId=step?.calls.has(exec.rootCallId)?step.id:undefined;
    const origin={...base,...actor,...(batchId?{batchId}:{}),...(child?.label?{actorLabel:child.label}:{})};try{const id=await journal.begin(actor.memberSessionId,origin,String(exec.callId),exec.name);attempts.set(exec.token,{id,origin,member:actor.memberSessionId,actor:actor.actorSessionId});if(exec.agent){appendPluginRecord(exec.agent.session,intentRecord,{callId:String(exec.callId),originId:origin.id!});await ctx.sessionPersistence.flush();}}catch(e){const failed=attempts.get(exec.token);if(failed){journal.releaseAttempt(failed.id);attempts.delete(exec.token);}engine.syncFailure(e);throw new CoordinationError('SYNC_PERSIST_FAILED','Native mutation was not started because its durable intent could not be written',true);}}
  }
  return next();
 });
 const stopObserved=ctx.on('fs/observed',(target,observation,opaque)=>{
  const exec=opaque as ToolExecution|undefined;if(!exec?.agent)return;
  const actor=resolveNativeActor(ctx,engine,exec.agent);if(!actor&&!attempts.has(exec.token))return;
  const resourceId=String(target.targetKey),version=observation.kind==='present'?String(observation.version):'absent',beforeVersion=versions.get(resourceId);
  versions.delete(resourceId);versions.set(resourceId,version);if(versions.size>2048)versions.delete(versions.keys().next().value!);
  if(attempts.has(exec.token)){
   const paths=observed.get(exec.token)??new Map<string,Observation>(),prior=paths.get(target.displayPath),before=prior?prior.beforeVersion:beforeVersion;
   paths.set(target.displayPath,{resource:target.displayPath,resourceId,version,...(before?{beforeVersion:before}:{})});observed.set(exec.token,paths);
  }else if(actor&&observation.kind==='present'&&['read','read_image'].includes(exec.name)&&engine.membership(actor.memberSessionId)?.members.find(m=>m.sessionId===actor.memberSessionId)?.operations.includes('read')){
   let read=reads.get(exec.token);
   if(!read){const team=engine.membership(actor.memberSessionId),bindingId=team?.members.find(m=>m.sessionId===actor.memberSessionId)?.bindingId;
    if(!team||!bindingId)return;read={member:actor.memberSessionId,teamId:team.id,bindingId,resources:new Set()};reads.set(exec.token,read);}
   read.resources.add(resourceId);
  }
 });
 const stopResult=ctx.on('tools/post-execute',async(exec,result,next)=>{
  const read=reads.get(exec.token);
  if(read){
   reads.delete(exec.token);
   if(!result.isError&&!exec.signal.aborted){
    const subscriptions=Promise.all([...read.resources].map(id=>engine.subscribeResource(read.member,id,undefined,true,read)));
    queue(subscriptions);await subscriptions.catch(()=>{});
   }
  }
  const attempt=attempts.get(exec.token),paths=observed.get(exec.token);observed.delete(exec.token);
  if(attempt){
   const changes=nativeMutations(result.value),known=new Map(changes.map(c=>[c.path,c]));
   // Absent observations during patch preflight are not successful deletions.
   const rows=[...(paths?.values()??[])].filter(o=>known.has(o.resource));
   const job=(async()=>{
    const items=rows.map(row=>{
     const change=known.get(row.resource),current=engine.observationOrigin(attempt.member,row.resource);
     const sameEpoch=current?.teamId===attempt.origin.teamId&&current.epoch===attempt.origin.epoch&&current.bindingId===attempt.origin.bindingId;
     const checkout=sameEpoch&&(git?.observation(attempt.actor,current.teamId,row.resource)??git?.observation(attempt.member,current.teamId,row.resource));
     const origin={...attempt.origin,...(sameEpoch&&current.workingMembers?{workingMembers:current.workingMembers}:{}),...(checkout||(sameEpoch&&current.projectId?{projectId:current.projectId}:{}))};
     const item={origin,caller:attempt.member,resource:row.resource,version:row.version,summary:'原生 '+exec.name+' 已修改资源',details:{resourceId:row.resourceId,...(row.beforeVersion?{beforeVersion:row.beforeVersion}:{}),...(change?mutationDetails(change):{}),evidence:['dsh://'+attempt.actor+'/call/'+String(exec.callId)]}};
     return item;
    });
    const value=result.value as {operations?:{status?:string}[]}|undefined;
    const complete=rows.length>0&&changes.every(c=>rows.some(r=>r.resource===c.path))&&!value?.operations?.some(o=>o.status==='unknown');
    if(exec.agent){for(const item of items)appendPluginRecord(exec.agent.session,mutationRecord,{callId:String(exec.callId),item});appendPluginRecord(exec.agent.session,batchRecord,{callId:String(exec.callId),originId:attempt.origin.id!,count:items.length,complete});await ctx.sessionPersistence.flush();}
    await engine.recordNativeBatch(items);
    if(complete)await journal.end(attempt.id);
   })();queue(job);await job.catch(()=>{});journal.releaseAttempt(attempt.id);attempts.delete(exec.token);
  }
  return next();
 });
 return async()=>{stopStep();for(const step of steps.values())step.release();steps.clear();stopBefore();stopObserved();stopResult();await Promise.allSettled([...jobs]);versions.clear();observed.clear();reads.clear();};
}
