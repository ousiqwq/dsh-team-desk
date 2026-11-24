import type {ChatConversationViewNode, ChatNode} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {Message} from '../domain/types.ts';
import {syncDeliveryHint,type SyncDeliveryHint} from '../domain/sync-summary.ts';
import {syncMessageSource, type SyncMessageSource} from './sync-message.ts';

export interface DeliveredNotice {
 key:string;
 message:SyncMessageSource;
 stored:Message|undefined;
 hint:SyncDeliveryHint;
 time:number;
}
export type DeliveryGroup = readonly DeliveredNotice[];

/** Count stable record IDs. Labels may be duplicated or renamed across receipts. */
export function deliveryTotals(group:DeliveryGroup){
 const changes=new Set<string>();
 const sources=new Map<string,{name:string;records:Set<string>}>();
 for(const {hint} of group){
  const sourceKey=JSON.stringify([hint.sender,hint.actor]);
  let source=sources.get(sourceKey);
  if(!source){source={name:hint.author||hint.sender,records:new Set()};sources.set(sourceKey,source);}
  for(const id of hint.recordIds){changes.add(id);source.records.add(id);}
 }
 return {count:changes.size,sources:[...sources.values()].map(s=>({name:s.name,count:s.records.size}))};
}

/** Called with the ordered keys of one recipient's native step. Only consecutive file
 * relays participate. Unrendered events can consume sequence numbers between visible neighbors. */
export function deliveryGroups(
 keys:readonly string[], read:(key:string)=>ChatConversationViewNode|undefined,
 recipient:string, messages:ReadonlyMap<string,Message>, archived?:(id:string)=>SyncDeliveryHint|undefined,
):Map<string,DeliveryGroup>{
 const result=new Map<string,DeliveryGroup>();
 let group:DeliveredNotice[]=[];
 let scope:string|undefined;
 for(const key of keys){
  const node=read(key);
  if(node?.visibility==='hidden')continue;
  if(node?.kind!=='context'){group=[];scope=undefined;continue;}
  const data=(node as ChatNode<'context'>).data;
  const message=syncMessageSource(data.content,data.source,recipient);
  const stored=message&&messages.get(message.id);
  const hint=stored?syncDeliveryHint(stored):message&&archived?.(message.id);
  if(!hint||typeof hint.scope!=='string'||typeof hint.actor!=='string'||!message||hint.id!==message.id||hint.sender!==message.sender||hint.target!==recipient){group=[];scope=undefined;continue;}
  const batchScope=hint.batchScope??hint.scope;
  if(scope!==batchScope){scope=batchScope;group=[];}
  group.push({key,message,stored,hint,time:data.time});
  if(group.length===2)result.set(group[0]!.key,group);
  if(group.length>=2)result.set(key,group);
 }
 return result;
}
