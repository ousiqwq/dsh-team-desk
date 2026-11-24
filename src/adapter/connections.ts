import {nativeDelegationTools} from './native-delegation.ts';
import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import {ReasoningEffortId} from '@deepseek-ai/dsh-llm';
import type {Agent} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-session-query';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-subagent';
import type {} from '@deepseek-ai/dsh-tool-subagent';
import type {} from '@deepseek-ai/dsh-timeline/src/records.ts';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-agent-preset-registry';
import type {} from '@deepseek-ai/dsh-agent-team';
import type {} from '@deepseek-ai/dsh-session-stats/types';
import type {TeamProjection,TeamTaskView} from '@deepseek-ai/dsh-agent-team/types';
import type {TeamEngine} from '../domain/engine.ts';
import type {GitEngine} from '../domain/git/engine.ts';
import {ConnectionsStore,ownUsage,sumUsage,scopeOverlaps,childDefaults,type TaskReference,type UsageTotals} from '../domain/connections.ts';
import {CoordinationError} from '../domain/errors.ts';
import {record,string} from '../domain/storage.ts';
import {resolveNativeActor} from './lineage.ts';

function childInBinding(member:{active?:boolean;boundSince?:number},createdAt?:number){
 return member.active!==false&&(member.boundSince===undefined||createdAt!==undefined&&createdAt>=member.boundSince);
}
export interface NativeSessionView {canOperate?:boolean;unavailableReason?:'inactive'|'historical'|'unknown';createdAt?:number;timeline?:{id:string;title:string;tasks:{id:string;title:string;status:string}[];reports:number};childPresets?:string[];childModelSelection?:boolean;childTools?:string[];id:string;member:string;parent?:string;name:string;mode:string;status:string;cwd:string;model?:{provider:string;model:string;reasoningEffort?:string};preset?:string|null;presetLocked?:boolean;ordinaryControls?:boolean;team?:TeamProjection;allowedModels?:unknown;usage?:UsageTotals;diagnostic?:string;}
/** Native projections remain authoritative; only explicit cross-domain references are stored. */
export class NativeConnections {
 private cache=new Map<string,{cursor:number;usage:UsageTotals}>();private closing=false;
 constructor(private ctx:Context,private engine:TeamEngine,readonly store:ConnectionsStore,private git?:GitEngine){}
 private team(id:string){const t=this.engine.snapshot().teams.find(t=>t.id===id);if(!t)throw new CoordinationError('TEAM_NOT_FOUND','Team not found');return t;}
 private matchesBinding(row:{bindingId?:string},member:import('../domain/types.ts').Member|undefined){
  return !!member&&member.active!==false&&(row.bindingId?row.bindingId===member.bindingId:member.boundSince===undefined);
 }
 defaultsFor(actor:string,root=actor){
  const member=this.engine.membership(root)?.members.find(m=>m.sessionId===root);
  const saved=this.store.savedDefaults(actor);
  return saved&&this.matchesBinding(saved,member)?saved.options:{};
 }
 async session(id:string,member:string,name:string,mode:string,parent?:string,signal?:AbortSignal):Promise<NativeSessionView>{
  if(this.closing)throw Error('Native bridge stopping');const live=this.ctx.agents.get(SessionId(id));
  const base:NativeSessionView={id,member,name,mode,status:live?.status??'inactive',cwd:'',...(parent?{parent}:{})};
  const query=this.ctx.get('sessionQuery');if(!query)return {...base,diagnostic:'Native session query unavailable'};
  try{
   using cut=await query.observeSession(SessionId(id),signal?{signal}:{});const values=cut.projections?.values;
   base.createdAt=cut.header.createdAt;
   const timeline=values?.timeline;
   const tree=timeline?.trees.find(t=>t.id===timeline.activeTreeId);
   if(tree&&timeline)base.timeline={id:tree.id,title:tree.title,tasks:tree.tasks.map(({id,title,status})=>({id,title,status})),reports:timeline.reports.length};
   base.cwd=values?.workingDirectory??cut.header.cwd??'';base.ordinaryControls=cut.header.origin!=='subagent';
   const model=live?.model?.current()??values?.modelSelection?.next??values?.modelSelection?.lastUsed;
   if(model)base.model={provider:model.provider,model:model.model,...(model.reasoningEffort?{reasoningEffort:String(model.reasoningEffort)}:{})};
   base.preset=values?.agentPreset??null;base.presetLocked=cut.events.some(e=>e.type==='turn/start');if(values?.agentTeam)base.team=values.agentTeam;
   const selection = this.ctx.get('subagentModelSelection');
   if (selection?.allowedRoutes) base.allowedModels = selection.allowedRoutes();
   if(live){base.childTools=nativeDelegationTools(this.ctx,live);const definition=live.ctx.tools.get('subagent',live),schema=definition?.parameters;const properties=record(schema)&&record(schema.properties)?schema.properties:{};base.childModelSelection=!!properties.provider&&!!properties.model;const preset=properties.agent_preset;base.childPresets=record(preset)&&Array.isArray(preset.enum)?preset.enum.filter((v):v is string=>typeof v==='string'):[];}
   const cached=this.cache.get(id);if(cached?.cursor===cut.cursor)base.usage=cached.usage;
   else {base.usage=ownUsage(cut.events,cut.inheritedEventCount);const native=values?.sessionStats;if(cut.inheritedEventCount===0&&native)for(const key of ['steps','turns','llmMs','toolMs','ttftMs','ttftSteps','decodeMs','decodeTokens'] as const)base.usage[key]=native[key];this.cache.delete(id);this.cache.set(id,{cursor:cut.cursor,usage:base.usage});if(this.cache.size>1024)this.cache.delete(this.cache.keys().next().value!);}
   return base;
  }catch(e){signal?.throwIfAborted();return {...base,status:'unavailable',diagnostic:String(e)};}
 }
 async view(teamId:string,signal?:AbortSignal){
  const team=this.team(teamId),rows:NativeSessionView[]=[],diagnostics:string[]=[];let truncated=false;
  for(const member of team.members){signal?.throwIfAborted();rows.push(await this.session(member.sessionId,member.sessionId,member.label,'root',undefined,signal));
   if(!this.ctx.get('subagents'))continue;
   try{const children=await this.ctx.get('subagents')!.listDescendants(SessionId(member.sessionId),signal);for(const child of children){if(rows.length>=2048){truncated=true;break;}if(child.kind==='diagnostic'){diagnostics.push(member.sessionId+': '+child.id+' '+child.reason);continue;}
     if(child.mode==='external'){rows.push({id:child.id,member:member.sessionId,parent:child.parentId,name:child.path??child.id,mode:'external',status:child.activity,cwd:'',diagnostic:'External execution has no local DSH Session; usage and continuation unavailable'});continue;}
     if(!team.members.some(m=>m.sessionId===child.id)&&!rows.some(r=>r.id===child.id))rows.push(await this.session(child.id,member.sessionId,child.label||child.path||child.id,child.mode,child.parentId,signal));
   }}catch(e){signal?.throwIfAborted();diagnostics.push(member.sessionId+': '+String(e));}
  }
  for(const row of rows){
    const member=team.members.find(m=>m.sessionId===row.member)!;
    row.canOperate=row.mode==='root'?member.active!==false:row.mode==='continuable'&&childInBinding(member,row.createdAt);
    if(!row.canOperate&&row.mode!=='external')row.unavailableReason=member.active===false?'inactive':row.mode!=='continuable'||row.createdAt===undefined?'unknown':'historical';
  }
  const records=this.store.snapshot(teamId,rows.map(r=>r.id));
  for(const d of records.defaults)if(!this.matchesBinding(d,team.members.find(m=>m.sessionId===rows.find(r=>r.id===d.member)?.member)))d.options={};
  const git=this.git?.snapshot(teamId),tasks=rows.filter(r=>r.mode==='root').flatMap(root=>(root.team?.tasks??[]).map(task=>({root:root.id,cwd:rows.find(r=>r.id===task.ownerId)?.cwd||root.cwd,task})));
  const scopes=tasks.filter(t=>t.task.status==='in_progress').flatMap(t=>t.task.writeScopes.map(path=>({member:t.root,taskId:t.task.id,path,cwd:t.cwd})));
  const links=records.links.map(link=>{const task=tasks.find(t=>t.root===link.member&&t.task.id===link.taskId),proposal=git?.proposals.find(p=>p.id===link.proposalId);return {...link,task:task?.task,taskChanged:!!task&&task.task.revision!==link.taskRevision,proposal,proposalChanged:!!link.proposalId&&(!proposal||proposal.sourceSha!==link.sourceSha||proposal.targetSha!==link.targetSha),memberActive:this.matchesBinding(link,team.members.find(m=>m.sessionId===link.member))};});
  return {teamId,paused:team.paused,sessions:rows,tasks,records:{...records,links},overlaps:scopeOverlaps(scopes),usage:{total:sumUsage(rows.flatMap(r=>r.usage?[r.usage]:[])),byMember:team.members.map(m=>({member:m.sessionId,...sumUsage(rows.filter(r=>r.member===m.sessionId&&r.usage).map(r=>r.usage!))})),complete:!truncated&&!diagnostics.length&&!rows.some(r=>r.diagnostic),unavailable:rows.filter(r=>r.diagnostic).length},diagnostics,truncated};
 }
 async target(caller:string,target:string):Promise<string>{
  const team=this.engine.membership(caller);if(!team?.members.some(m=>m.sessionId===caller&&m.active!==false))throw Error('Caller outside team');
  if(team.members.some(m=>m.sessionId===target&&m.active!==false))return target;
  if(this.ctx.get('subagents'))for(const member of team.members.filter(m=>m.active!==false)){const rows=await this.ctx.get('subagents')!.listDescendants(SessionId(member.sessionId));if(rows.some(r=>r.kind==='child'&&r.id===target&&r.mode==='continuable')){
    const key=SessionId(target),header=this.ctx.agents.get(key)?.session?.header??(await this.ctx.get('sessionPersistence')?.stat(key))?.header;
    const current=this.engine.membership(caller);
    if(current?.id===team.id&&current.epoch===team.epoch&&current.members.some(m=>m.sessionId===member.sessionId&&m.bindingId===member.bindingId&&m.active!==false)
      &&childInBinding(member,header?.createdAt))return member.sessionId;
   }}
  throw new CoordinationError('NATIVE_SCOPE','Target is not a continuable member of this team');
 }
 async lease(caller:string,actor:string,action:string,resource:string,options:Record<string,unknown>){
  if(action==='delegate'){const target=string(options.target,'target'),member=await this.target(caller,target);return this.engine.delegateResource(caller,actor,resource,string(options.token,'token'),target,member,Number(options.ttlMs??60000));}
  if(action==='revoke-delegation')return this.engine.revokeResource(caller,actor,resource,string(options.token,'token'),string(options.delegationId,'delegationId'));
  if(action==='return-delegation')return this.engine.returnResource(caller,actor,resource,string(options.delegationId,'delegationId'));
  return this.engine.resourceLease(caller,resource,action,options,actor);
 }
 async action(caller:string,actor:string,action:string,input:Record<string,unknown>){
  const team=this.engine.membership(caller);if(!team||!team.members.some(m=>m.sessionId===caller&&m.active!==false))throw Error('Caller outside active team');
  const member=team.members.find(m=>m.sessionId===caller)!;if(!member.operations.includes(action==='link-task'?'send':'read'))throw new CoordinationError('NATIVE_SCOPE','Required collaboration capability is disabled');
  if(action==='status'||action==='usage'||action==='tasks')return this.view(team.id);
  if(action==='defaults')return this.defaultsFor(actor,caller);
  if(action==='save-defaults'){
   const defaults=childDefaults(input.options),session=await this.session(actor,caller,actor,'continuable');
   if(defaults.model){if(!session.childModelSelection)throw Error('Native subagent tool does not allow model selection in this session');const allowed=Array.isArray(session.allowedModels)?session.allowedModels:session.model?[session.model]:[];if(!allowed.some(r=>record(r)&&r.provider===defaults.provider&&r.model===defaults.model))throw new CoordinationError('NATIVE_MODEL_SCOPE','Model is outside the session’s native child authorization');await this.ctx.get('llm')!.resolveCallConfig({provider:defaults.provider!,model:defaults.model,...(defaults.reasoningEffort?{reasoningEffort:ReasoningEffortId(defaults.reasoningEffort)}:{})});}
   if(defaults.agentPreset&&!session.childPresets?.includes(defaults.agentPreset))throw new CoordinationError('NATIVE_PRESET_SCOPE','Preset is outside the native subagent tool allowlist');
   return this.store.defaults(actor,Number(input.expected),defaults,member.bindingId);
  }
  if(action==='link-task'){
   const member=string(input.member??caller,'member');if(!team.members.some(m=>m.sessionId===member&&m.active!==false))throw Error('Native task root outside team');
   const root=await this.session(member,member,member,'root');if(root.diagnostic||root.team?.failure)throw Error(root.diagnostic??root.team?.failure);
   const task=root.team?.tasks.find(t=>t.id===input.taskId);if(!task)throw Error('Native task not found');if(task.revision!==input.taskRevision)throw new CoordinationError('REVISION_CONFLICT','Native task changed; refresh its revision');
   const link:Omit<TaskReference,'revision'|'history'>={bindingId:team.members.find(m=>m.sessionId===member)!.bindingId!,key:string(input.key,'key',200),teamId:team.id,member,taskId:task.id,taskRevision:task.revision,evidence:[],active:input.active!==false};
   if(input.taskKey!==undefined){const key=string(input.taskKey,'taskKey',200);if(!team.tasks?.some(t=>t.key===key)&&!team.taskHeads?.some(t=>t.key===key))throw Error('Outer task claim not found');link.taskKey=key;}
   if(input.projectId!==undefined){const project=string(input.projectId,'projectId');if(!this.engine.snapshot().projects?.some(p=>p.id===project&&p.teamIds.includes(team.id)))throw Error('Project outside team');link.projectId=project;}
   if(input.proposalId){const git=this.git?.snapshot(team.id),proposal=git?.proposals.find(p=>p.id===input.proposalId),repo=git?.repositories.find(r=>r.id===proposal?.repositoryId);if(!proposal||!repo||link.projectId&&repo.projectId!==link.projectId)throw Error('Git proposal outside task project');link.projectId=repo.projectId;link.proposalId=proposal.id;link.sourceSha=proposal.sourceSha;link.targetSha=proposal.targetSha;}
   if(input.evidence!==undefined){if(!Array.isArray(input.evidence)||input.evidence.length>30)throw Error('Invalid evidence');link.evidence=input.evidence.map(x=>string(x,'evidence',2000));}
   return this.store.link(actor,link,Number(input.expected));
  }
  throw Error('Unknown native collaboration action');
 }
 async select(caller:string,target:string,input:Record<string,unknown>){
  const member=await this.target(caller,target),view=await this.session(target,member,target,'root');
  if(view.diagnostic)throw Error(view.diagnostic);
  if(!view.ordinaryControls)throw new CoordinationError('NATIVE_SUBAGENT_OPTIONS','Native subagent routing owns this session; choose its model, reasoning and preset when creating the child.');
  if(input.action==='model')return this.ctx.sessionController.selectModel({sessionId:SessionId(target),provider:string(input.provider,'provider'),model:string(input.model,'model'),...(typeof input.reasoningEffort==='string'&&input.reasoningEffort?{reasoningEffort:input.reasoningEffort}:{})});
  if(input.action==='preset'){const result=await this.ctx.sessionController.resolveAgent(SessionId(target));if('error'in result)throw result.error;return this.ctx.get('agentPresets')!.select(result.agent,string(input.preset,'preset'));}
  throw Error('Unknown native option');
 }
 delegationContext(actor:string,root=actor){
  if(!this.engine.membership(root)?.members.some(m=>m.sessionId===root&&m.active!==false))return '';
  const tools=nativeDelegationTools(this.ctx,this.ctx.agents?.get(SessionId(actor)));
  if(!tools.length)return '';
  const options=this.defaultsFor(actor,root);
  return Object.keys(options).length?'\nUser-saved defaults for fresh native children of THIS actual Session: '+JSON.stringify(options)+'. The team_delegate tool applies these defaults through the native pipeline; explicit call options take priority. Existing native tools remain available, and native authorization and preset restrictions still apply.':'';
 }

 close(){this.closing=true;this.cache.clear();}
}
