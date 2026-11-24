import type {Context} from '@deepseek-ai/cordis';
import {SessionId,pluginRecordOf} from '@deepseek-ai/dsh-session';
import type{SessionEvent}from'@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-session-persistence';
import {record} from '../domain/storage.ts';
import type {IntentRecovery,ObservedChange,SyncIntent} from './sync-journal.ts';

export const mutationRecord='plugin:team-desk/native-mutation' as const;
export const intentRecord='plugin:team-desk/native-intent' as const;
export const batchRecord='plugin:team-desk/native-mutation-batch' as const;
declare module '@deepseek-ai/dsh-session/types' {interface PluginRecordMap {
 'plugin:team-desk/native-intent':{callId:string;originId:string};
 'plugin:team-desk/native-mutation':{callId:string;item:ObservedChange};
 'plugin:team-desk/native-mutation-batch':{callId:string;originId:string;count:number;complete:boolean};
}}
/** Only facts inside this exact invocation's start/completion markers form a recoverable batch. */
export class NativeEvidence {
 private legacyCalls=0;private legacyWindow=false;private legacyRefusals=0;private legacyFacts=false;
 private started=false;private closed=false;private refused=false;private end:{count:number;complete:boolean}|undefined;private items:ObservedChange[]=[];
 constructor(private readonly intent:SyncIntent){}
 consume(event:SessionEvent){
  const plugin=pluginRecordOf(event),data=plugin?.data;
  const refusedCodes=['FS_NOT_OBSERVED','FS_STALE_VERSION','PATCH_SYNTAX','PATCH_SYMLINK_SOURCE','UNKNOWN_TOOL'];
  if(event.type==='tool/call'&&event.data.callId===this.intent.callId){this.legacyCalls++;const age=this.intent.origin.observedAt-event.time;this.legacyWindow=event.data.name===this.intent.tool&&age>=0&&age<=10000;}
  if(event.type==='tool/result'&&event.data.message.toolCallId===this.intent.callId&&event.data.message.isError&&refusedCodes.includes(event.data.error?.code??'')&&event.time>=this.intent.origin.observedAt)this.legacyRefusals++;
  if(plugin?.type===mutationRecord&&record(data)&&record(data.item)&&record(data.item.origin)&&data.item.origin.id===this.intent.origin.id)this.legacyFacts=true;
  if(plugin?.type===intentRecord&&record(data)&&data.callId===this.intent.callId){if(data.originId===this.intent.origin.id)this.started=true;else if(this.started)this.closed=true;return;}
  if(!this.started||this.closed)return;
  if(plugin?.type===mutationRecord&&record(data)&&data.callId===this.intent.callId&&record(data.item)){
   const item=data.item as unknown as ObservedChange,origin=item.origin;
   if(item.caller===this.intent.caller&&origin?.id===this.intent.origin.id&&origin?.teamId===this.intent.origin.teamId&&origin.epoch===this.intent.origin.epoch&&origin.actorSessionId===this.intent.origin.actorSessionId&&typeof item.resource==='string'&&typeof item.version==='string')this.items.push(item);
  }
  if(plugin?.type===batchRecord&&record(data)&&data.callId===this.intent.callId&&data.originId===this.intent.origin.id&&Number.isSafeInteger(data.count)&&typeof data.complete==='boolean')this.end={count:Number(data.count),complete:data.complete};
  if(event.type==='tool/result'&&event.data.message.toolCallId===this.intent.callId&&event.data.message.isError&&refusedCodes.includes(event.data.error?.code??''))this.refused=true;
 }
 result():IntentRecovery {
  const complete=!!this.end?.complete&&this.end.count===this.items.length;
  if(this.items.length)return {kind:'changed',items:this.items,complete};
  if(!this.started&&this.legacyCalls===1&&this.legacyWindow&&this.legacyRefusals===1&&!this.legacyFacts)return {kind:'unchanged',evidence:this.intent.evidence};
  return this.started&&(this.refused||complete)?{kind:'unchanged',evidence:this.intent.evidence}:{kind:'unknown'};
 }
}
/** Read the exact actor's native log. Missing evidence remains unknown. */
export function recoverNativeIntent(ctx:Context){
 async function batch(intents:SyncIntent[]):Promise<IntentRecovery[]>{
  const checks=intents.map(intent=>new NativeEvidence(intent));
  const calls=new Map<string,Set<NativeEvidence>>(),origins=new Map<string,NativeEvidence>();
  intents.forEach((intent,i)=>{
   if(!intent.callId||!intent.origin.id)return;
   const set=calls.get(intent.callId)??new Set();set.add(checks[i]!);calls.set(intent.callId,set);
   origins.set(intent.origin.id,checks[i]!);
  });
  if(calls.size){
   const first=intents[0]!;
   await ctx.sessionPersistence.flush();
   await using handle=await ctx.sessionPersistence.open(SessionId(first.origin.actorSessionId??first.caller),'read');
   for(let offset=0;;){
    const {events}=await handle.read(offset,512);if(!events.length)break;
    for(const event of events){
     const plugin=pluginRecordOf(event),data=plugin?.data;
     const id=event.type==='tool/call'?event.data.callId:event.type==='tool/result'?event.data.message.toolCallId:record(data)&&typeof data.callId==='string'?data.callId:undefined;
     const interested=id?calls.get(id):undefined;
     for(const check of interested??[])check.consume(event);
     if(plugin?.type===mutationRecord&&record(data)&&record(data.item)&&record(data.item.origin)&&typeof data.item.origin.id==='string'){
      const sameOrigin=origins.get(data.item.origin.id);
      if(sameOrigin&&!interested?.has(sameOrigin))sameOrigin.consume(event);
     }
    }
    offset+=events.length;
   }
  }
  return checks.map(check=>check.result());
 }
 return Object.assign(async(intent:SyncIntent)=>(await batch([intent]))[0]!,{batch});
}
