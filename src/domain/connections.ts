import * as nativeLlm from '@deepseek-ai/dsh-llm';
import type {AssistantStreamRecord} from '@deepseek-ai/dsh-llm';
import {resolve,relative,isAbsolute} from 'node:path';
import type {FileHandle} from 'node:fs/promises';
import {acquireWriter} from './process-lock.ts';
import {readJson,writeJson,record,string} from './storage.ts';
import {CoordinationError} from './errors.ts';

export interface ChildDefaults {provider?:string;model?:string;reasoningEffort?:string;agentPreset?:string;}
export interface TaskReference {bindingId?:string;key:string;teamId:string;member:string;taskId:string;taskKey?:string;taskRevision:number;projectId?:string;proposalId?:string;sourceSha?:string;targetSha?:string;evidence:string[];revision:number;active:boolean;history:{revision:number;actor:string;time:number;value:unknown}[];}
export interface ConnectionsState {version:1;revision:number;links:TaskReference[];defaults:{bindingId?:string;member:string;revision:number;options:ChildDefaults}[];}
export function childDefaults(value:unknown):ChildDefaults {
 if(!record(value)||Object.keys(value).some(k=>!['provider','model','reasoningEffort','agentPreset'].includes(k)))throw Error('Invalid child defaults');
 const result:ChildDefaults={};for(const k of ['provider','model','reasoningEffort','agentPreset'] as const)if(value[k]!==undefined&&value[k]!=='')result[k]=string(value[k],k,300);
 if(!!result.provider!==!!result.model||result.reasoningEffort&&!result.model)throw Error('Provider and model must be selected together');return result;
}
function validateConnections(value:unknown):asserts value is ConnectionsState {
 const integer=(v:unknown,min=0)=>Number.isSafeInteger(v)&&Number(v)>=min;
 if(!record(value)||value.version!==1||!integer(value.revision)||!Array.isArray(value.links)||!Array.isArray(value.defaults))throw Error('CONNECTIONS_VERSION: Unsupported collaboration references; original retained');
 if(value.links.length>5000||value.defaults.length>10000)throw Error('Invalid reference capacity');
 const defaults=new Set<string>(),links=new Set<string>();
 for(const item of value.defaults){if(!record(item)||typeof item.member!=='string'||!item.member||defaults.has(item.member)||!integer(item.revision,1))throw Error('Invalid defaults');defaults.add(item.member);childDefaults(item.options);}
 const validReference=(item:unknown)=>{if(!record(item)||![item.key,item.teamId,item.member,item.taskId].every(v=>typeof v==='string'&&v.length>0&&v.length<=200)||!integer(item.taskRevision)||typeof item.active!=='boolean'||!Array.isArray(item.evidence)||item.evidence.length>30||!item.evidence.every(v=>typeof v==='string'&&v.length>0&&v.length<=2000))throw Error('Invalid task reference');for(const key of ['taskKey','projectId','proposalId'] as const)if(item[key]!==undefined&&(typeof item[key]!=='string'||!item[key]||item[key].length>200))throw Error('Invalid task reference key');for(const key of ['sourceSha','targetSha'] as const)if(item[key]!==undefined&&(typeof item[key]!=='string'||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(item[key])))throw Error('Invalid pinned commit');};
 for(const item of value.links){validReference(item);if(!record(item)||!integer(item.revision,1)||!Array.isArray(item.history)||item.history.length!==item.revision||item.history.length>1000)throw Error('Invalid reference history');const key=JSON.stringify([item.teamId,item.key]);if(links.has(key))throw Error('Duplicate task reference');links.add(key);for(const [i,h] of item.history.entries()){if(!record(h)||h.revision!==i+1||typeof h.actor!=='string'||!h.actor||typeof h.time!=='number'||!Number.isFinite(h.time)||h.time<0)throw Error('Invalid reference history');validReference(h.value);if(!record(h.value)||h.value.key!==item.key||h.value.teamId!==item.teamId)throw Error('Invalid reference history identity');}}
}
export class ConnectionsStore {
 private state:ConnectionsState={version:1,revision:0,links:[],defaults:[]};private writer:FileHandle|undefined;private chain:Promise<unknown>=Promise.resolve();private closed=false;
 constructor(private file:string){}
 async load(){this.writer=await acquireWriter(this.file+'.lock');try{const value=await readJson(this.file);if(value!==undefined){validateConnections(value);this.state=value;}}catch(e){await this.writer.close();this.writer=undefined;throw e;}}
 snapshot(teamId?:string,members?:string[]){const s=structuredClone(this.state);if(teamId)s.links=s.links.filter(l=>l.teamId===teamId);if(members)s.defaults=s.defaults.filter(d=>members.includes(d.member));return s;}
 savedDefaults(member:string){return this.state.defaults.find(d=>d.member===member);}
 options(member:string){return structuredClone(this.state.defaults.find(d=>d.member===member)?.options??{});}
 private change<T>(fn:(s:ConnectionsState)=>T):Promise<T>{const p=this.chain.then(async()=>{if(this.closed||!this.writer)throw Error('Connections store unavailable');const next=structuredClone(this.state),result=fn(next);next.revision++;validateConnections(next);try{await writeJson(this.file,next);}catch(e){if((e as {committed?:boolean}).committed)this.state=next;throw e;}this.state=next;return structuredClone(result);});this.chain=p.catch(()=>{});return p;}
 defaults(member:string,expected:number,options:unknown,bindingId?:string){return this.change(s=>{const value=childDefaults(options),old=s.defaults.find(d=>d.member===member);if((old?.revision??0)!==expected)throw new CoordinationError('REVISION_CONFLICT','Child defaults changed; refresh before saving');const row={member,...(bindingId&&{bindingId}),revision:expected+1,options:value};s.defaults=s.defaults.filter(d=>d.member!==member);s.defaults.push(row);return row;});}
 link(actor:string,value:Omit<TaskReference,'revision'|'history'>,expected:number){return this.change(s=>{const old=s.links.find(l=>l.teamId===value.teamId&&l.key===value.key);if((old?.revision??0)!==expected)throw new CoordinationError('REVISION_CONFLICT','Task reference changed; refresh before saving');if(!old&&s.links.length>=5000||old&&old.history.length>=1000)throw Error('CONNECTIONS_LIMIT: Export references before adding more history');const row:TaskReference={...structuredClone(value),revision:expected+1,history:[...(old?.history??[]),{revision:expected+1,actor,time:Date.now(),value:structuredClone(value)}]};s.links=s.links.filter(l=>!(l.teamId===value.teamId&&l.key===value.key));s.links.push(row);return row;});}
 async dispose(){this.closed=true;await this.chain;await this.writer?.close();this.writer=undefined;}
}

export interface PlannedScope {member:string;taskId:string;path:string;cwd:string;}
/** Advisory path overlap in the SAME checkout; never grants write permission. */
export function scopeOverlaps(items:PlannedScope[]){
 const valid=items.filter(x=>isAbsolute(x.cwd)&&!isAbsolute(x.path)&&!x.path.split(/[\\/]/).includes('..')).map(x=>({...x,absolute:resolve(x.cwd,x.path)}));
 const overlaps:{left:PlannedScope;right:PlannedScope}[]=[];
 for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++){const a=valid[i]!,b=valid[j]!;if(a.member===b.member)continue;const ab=relative(a.absolute,b.absolute),ba=relative(b.absolute,a.absolute),child=(p:string)=>p===''||p!=='..'&&!p.startsWith('../')&&!p.startsWith('..\\')&&!isAbsolute(p);if(child(ab)||child(ba))overlaps.push({left:a,right:b});}
 return overlaps;
}

export interface UsageTotals {ttftMs:number;ttftSteps:number;decodeMs:number;decodeTokens:number;responses:number;reported:number;missingUsage:number;missingTotal:number;inputTokens:number;outputTokens:number;totalTokens:number;cacheReadTokens:number;cacheWriteTokens:number;reasoningTokens:number;steps:number;turns:number;llmMs:number;toolMs:number;}
export const emptyUsage=():UsageTotals=>({ttftMs:0,ttftSteps:0,decodeMs:0,decodeTokens:0,responses:0,reported:0,missingUsage:0,missingTotal:0,inputTokens:0,outputTokens:0,totalTokens:0,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0,steps:0,turns:0,llmMs:0,toolMs:0});
/** Fold only the actual Session suffix: fork-inherited parent calls never become new usage. */
export function ownUsage(events:readonly {seq:number;type:string;time:number;data:unknown}[],inherited:number):UsageTotals {
 const sum=emptyUsage(),seen=new Set<number>(),turns=new Set<number>(),calls=new Map<string,number>();let start:number|undefined,first:number|undefined;
 for(const e of events){if(e.seq<inherited||seen.has(e.seq)||!record(e.data))continue;seen.add(e.seq);const d=e.data;
  if(e.type==='step/start'){start=e.time;first=undefined;}
  if(e.type==='step/end'){sum.steps++;start=undefined;first=undefined;if(typeof d.turn==='number')turns.add(d.turn);}
  if(e.type==='tool/call'&&typeof d.callId==='string')calls.set(d.callId,e.time);
  if(e.type==='tool/result'&&record(d.message)){const id=record(d.message.source)?d.message.source.callId:d.message.toolCallId;if(typeof id==='string'&&calls.has(id)){sum.toolMs+=Math.max(0,e.time-calls.get(id)!);calls.delete(id);}}
  if(e.type==='turn/end')calls.clear();
  if(e.type!=='assistant/message'&&e.type!=='assistant/attempt')continue;sum.responses++;
  if(first===undefined&&Array.isArray(d.stream)&&typeof nativeLlm.assistantStreamFirstTokenTime==='function')first=nativeLlm.assistantStreamFirstTokenTime(d.stream as AssistantStreamRecord[]);
  if(e.type==='assistant/message'&&start!==undefined){sum.llmMs+=Math.max(0,e.time-start);if(first!==undefined){sum.ttftMs+=Math.max(0,first-start);sum.ttftSteps++;if(record(d.usage)&&typeof d.usage.outputTokens==='number'&&Number.isFinite(d.usage.outputTokens)&&d.usage.outputTokens>=0){sum.decodeMs+=Math.max(0,e.time-first);sum.decodeTokens+=d.usage.outputTokens;}}start=undefined;first=undefined;}
  const streamed=Array.isArray(d.stream)?d.stream.filter(record).filter(r=>r.type==='chunk'&&record(r.chunk)&&r.chunk.type==='usage').at(-1):undefined;
  const usage=d.usage??(record(streamed?.chunk)?streamed.chunk.usage:undefined);
  if(!record(usage)||!Number.isFinite(usage.inputTokens)||!Number.isFinite(usage.outputTokens)||Number(usage.inputTokens)<0||Number(usage.outputTokens)<0){sum.missingUsage++;continue;}sum.reported++;
  for(const key of ['inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','reasoningTokens'] as const){const n=usage[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0)sum[key]+=n;}
  const total=usage.totalTokens;if(typeof total==='number'&&Number.isFinite(total)&&total>=0)sum.totalTokens+=total;else sum.missingTotal++;
 }sum.turns=turns.size;return sum;
}
export function sumUsage(rows:UsageTotals[]){const sum=emptyUsage();for(const row of rows)for(const key of Object.keys(sum) as (keyof UsageTotals)[])sum[key]+=row[key];return sum;}
