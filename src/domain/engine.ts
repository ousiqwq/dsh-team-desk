import {AsyncLocalStorage} from 'node:async_hooks';
import {historicalTeamIds,collaborationTimeline} from './timeline.ts';
import {reconcileMemberships,sameBinding} from './memberships.ts';
import {managementState,recordsPage} from './management-state.ts';
import {chatState} from './chat-state.ts';
import {incidentSettings,incidentSupervisor,validateIncidentSettings} from './incident-settings.ts';
import {recordRunIssue,recordDeliveryIssue,recordDeliveryRecovery} from './run-incidents.ts';
import type {RunIssue} from './types.ts';
import {transposeCross} from './dividers.ts';
import {seatSelections,permissionConsent} from './seat-settings.ts';
import {canonicalResource} from './resource-identity.ts';
import {syncDeliveryHint,validateSyncSummary,legacySyncReference,type SyncDetail} from './sync-summary.ts';
import {setBudget,budgetReason,reserveBudget,settleWake} from './budget.ts';
import {grantControl,validGrant} from './control.ts';
import {isDeepStrictEqual} from 'node:util';
import {eventOptions,resolvedVariables,checkValue} from './definitions.ts';
import {validateResources,configureResource,leaseAction,delegateLease,revokeDelegation,returnDelegation,beginOperation,finishOperation,resolveOperation} from './resources.ts';
import {taskAction} from './tasks.ts';
import {realpath,stat,type FileHandle} from 'node:fs/promises';
import {acquireWriter} from './process-lock.ts';
import {CoordinationError} from './errors.ts';
import {messagePage,validateQuery,WaitDependencies} from './mailbox.ts';
import {seedLedger,validateLedger,sequence,bucket,projectFor,updateValue,appendChange,notify,enqueueResourceDigest,RESOURCE_DIGEST_PREFIX} from './ledger.ts';
import {loadArchive,prepareArchive,commitArchive} from './archive.ts';
import type {MessageQuery,MessagePage,WaitResult,WaitReason,SharedOptions,SharedRevision,ChangeDetails,ChangeNotice,SharedProject} from './types.ts';
import {normalizeOptions,validatePolicy,routeAllowed,routeDenial,replyAllowed,policyBindings,priorityScore,jsonValue} from './coordination.ts';
import type {MessageOptions,SharedEntry,SeatRun,ReviewBlock} from './types.ts';
import {upgradeBuiltinDuties} from './preset-upgrade.ts';
import {defaultPresets,validatePreset,presetFromTeam,teamContext} from './preset-library.ts';
import type {TeamPreset,PendingConfiguration} from './types.ts';
import {dockIds,insertDock,pruneDock,resizeDock,tileDock,validDock,type DockZone} from './docking.ts';
import { randomUUID } from 'node:crypto';
import {renderInstructions, type WorkReviewInput} from '../presets/work-review.ts';
import type {Briefing} from './types.ts';
import { snapshotStore,type SnapshotStore, SnapshotCommitError, readJson, record, string, writeJson } from './storage.ts';
import type { ObservationOrigin, HostOperation, Layout, Member, Message, NativeHost, Operation, State, Team } from './types.ts';

const operations: Operation[] = ['send', 'read', 'wait'];
const layouts: Layout[] = ['columns', 'rows', 'grid', 'four-columns'];

function validateState(value: unknown): asserts value is State {
  if (!record(value) || ![6,7].includes(Number(value.version))) throw new Error('Unsupported Team Desk data version; data retained');
  if (!Number.isSafeInteger(value.revision) || !Array.isArray(value.teams) || !Array.isArray(value.messages)) throw new Error('Invalid Team Desk state');
  if(value.hostOperations!==undefined&&(!Array.isArray(value.hostOperations)||value.hostOperations.some(o=>!record(o)||typeof o.id!=='string'||typeof o.teamId!=='string'||!['prepared','uncertain','completed','resolved'].includes(String(o.state))||!Array.isArray(o.sessions))))throw Error('Invalid host operations');
  if(!Array.isArray(value.presets)||!Array.isArray(value.events))throw Error('Invalid preset library');
  for(const p of value.presets)validatePreset(p);
  if(new Set(value.presets.map(p=>p.id)).size!==value.presets.length)throw Error('Duplicate presets');
  const ids = new Set<string>();
  for (const team of value.teams) {
    if (!record(team) || !Array.isArray(team.members) || typeof team.paused !== 'boolean' || !layouts.includes(team.layout as Layout)) throw new Error('Invalid team');
    for (const key of ['id', 'anchor', 'title', 'cwd']) string(team[key], key);
    if (ids.has(String(team.id))) throw new Error('Duplicate team');
    ids.add(String(team.id));
    for (const key of ['order', 'hidden']) if (!Array.isArray(team[key]) || !team[key].every(x => typeof x === 'string')) throw new Error('Invalid layout members');
    if (!Array.isArray(team.sizes) || !team.sizes.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 10 && n <= 90)) throw new Error('Invalid panel sizes');
    for (const member of team.members) {
      if (!record(member) || typeof member.owned !== 'boolean' || typeof member.autoLink !== 'boolean' || !Array.isArray(member.targets) || !member.targets.every(x => typeof x === 'string') || !Array.isArray(member.operations) || !member.operations.every(x => operations.includes(x))) throw new Error('Invalid member scope');
      const sessionId = string(member.sessionId, 'sessionId'); string(member.label, 'label', 120);
      if (ids.has(sessionId)) throw new Error('Session belongs to multiple teams');
      ids.add(sessionId);
    }
    if (!team.members.some(m => m.sessionId === team.anchor && !m.owned)) throw new Error('Invalid team anchor');
    if(team.briefing!==undefined){
      const b=team.briefing;
      if(!record(b)||b.kind!=='work-review'||!['prepared','starting','started','uncertain'].includes(String(b.state))||!Array.isArray(b.instructions)||b.instructions.length!==2)throw new Error('Invalid briefing');
      for(const key of ['goal','criteria','worker','reviewer'])string(b[key],key,8000);
      if(b.worker===b.reviewer)throw new Error('Invalid briefing members');
      for(const i of b.instructions){if(!record(i)||typeof i.wakeup!=='boolean')throw new Error('Invalid briefing instruction');string(i.sessionId,'sessionId');string(i.text,'instructions',24000);}
    }
    const members = new Set(team.members.map(m => m.sessionId));
    if(team.coordination!==undefined)validatePolicy(team.coordination,members);
    if(team.budget!==undefined&&(!record(team.budget)||!['warn','pause'].includes(String(team.budget.mode))||![team.budget.startedAt,team.budget.usedDispatches,team.budget.usedWakeups].every(Number.isFinite)))throw Error('Invalid budget');
    if(team.tasks!==undefined&&(!Array.isArray(team.tasks)||team.tasks.length>200||team.tasks.some(x=>!x||typeof x.key!=='string'||!Number.isSafeInteger(x.revision)||!Array.isArray(x.history))))throw Error('Invalid task state');
    if(team.controlGrants!==undefined&&(!Array.isArray(team.controlGrants)||team.controlGrants.some(g=>!g||g.operation!=='interrupt'||g.source!=='user'||typeof g.from!=='string'||typeof g.to!=='string'||!Number.isFinite(g.expiresAt))))throw Error('Invalid control grant');
    if(team.controls!==undefined&&(!Array.isArray(team.controls)||team.controls.some(c=>!c||typeof c.id!=='string'||!['requested','accepted','idle','uncertain'].includes(c.state))))throw Error('Invalid control history');
    if(team.shared!==undefined&&(!Array.isArray(team.shared)||team.shared.some(x=>!record(x)||typeof x.key!=='string'||typeof x.scope!=='string'||!['value','decision'].includes(String(x.kind))||!Number.isSafeInteger(x.revision)||Number(x.revision)<1)))throw Error('Invalid shared state');
    if(team.changes!==undefined&&!Array.isArray(team.changes))throw Error('Invalid change journal');
    if(team.epoch!==undefined&&typeof team.epoch!=='string')throw Error('Invalid collaboration epoch');
    if(team.configuration!==undefined){if(!record(team.configuration))throw Error('Invalid configuration');validatePreset(team.configuration.preset);if(!record(team.configuration.bindings)||!Object.values(team.configuration.bindings).every(x=>typeof x==='string')||!Number.isSafeInteger(team.configuration.contextRevision)||Number(team.configuration.contextRevision)<1||typeof team.configuration.modified!=='boolean')throw Error('Invalid configuration');}
    if(team.pending!==undefined){if(!record(team.pending))throw Error('Invalid pending switch');validatePreset(team.pending.preset);if(!record(team.pending.bindings)||!Object.values(team.pending.bindings).every(x=>typeof x==='string')||typeof team.pending.applyLayout!=='boolean'||team.pending.modified!==undefined&&typeof team.pending.modified!=='boolean')throw Error('Invalid pending switch');}
    for(const m of team.members){validateIncidentSettings(m.incidents);if(m.active!==undefined&&typeof m.active!=='boolean'||m.prompt!==undefined&&(typeof m.prompt!=='string'||m.prompt.length>16000))throw Error('Invalid member context');}
    if(team.dock!==undefined&&!validDock(team.dock))throw new Error('Invalid dock layout');
    if(team.sidebarOrder!==undefined&&(!Array.isArray(team.sidebarOrder)||new Set(team.sidebarOrder).size!==team.sidebarOrder.length||team.sidebarOrder.some(id=>typeof id!=='string')))throw new Error('Invalid sidebar order');
    if(team.graph!==undefined&&(!record(team.graph)||Object.values(team.graph).some(p=>!record(p)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||Number(p.x)<0||Number(p.y)<0||Number(p.x)>5000||Number(p.y)>5000)))throw new Error('Invalid graph positions');
    if ([...(team.order as string[]), ...(team.hidden as string[]), ...team.members.flatMap(m => m.targets)].some(x => !members.has(x))) throw new Error('Unknown scope member');
  }
  for (const message of value.messages) {
    if (!record(message) || !['queued', 'dispatching', 'accepted', 'uncertain', 'cancelled'].includes(String(message.state)) || typeof message.time !== 'number') throw new Error('Invalid delivery');
    if(message.epoch!==undefined&&typeof message.epoch!=='string'||message.native!==undefined&&!['queued','admitted','discarded'].includes(String(message.native))||message.expiresAt!==undefined&&!Number.isFinite(message.expiresAt)||message.attempts!==undefined&&(!Number.isSafeInteger(message.attempts)||Number(message.attempts)<0))throw Error('Invalid message metadata');
    normalizeOptions(Object.fromEntries(['kind','priority','code','delivery','wakeup','replyTo','followUpTo','allowReply','ttlMs','taskId','evidence','payload','eventVersion','dependsOn'].filter(k=>message[k]!==undefined).map(k=>[k,message[k]])));
    if(message.routeReply!==undefined&&(message.routeReply!==true||message.kind!=='request'))throw Error('Invalid reply grant');
    if(message.syncSummary!==undefined){validateSyncSummary(message.syncSummary);if(!message.system||!String(message.syncKey).startsWith(RESOURCE_DIGEST_PREFIX)||message.syncSummary.scope.teamId!==message.teamId)throw Error('Invalid summary ownership');}
    for (const key of ['id', 'key', 'teamId', 'sender', 'target', 'text']) string(message[key], key, key === 'text' ? 16000 : 4096);
  }
}
export function parseState(value: unknown): State {
  if(record(value)&&value.version===1){value.version=2;value.presets=defaultPresets();value.events=[];}
  if(record(value)&&value.version===2)value.version=3;
  if(record(value)&&value.version===3)value.version=4;
  if(record(value)&&value.version===4)value.version=5;
  if(record(value)&&value.version===5)value.version=6;
  validateState(value);
  seedLedger(value);validateLedger(value);validateResources(value);
  // Older releases preserve unknown fields but can change membership/visibility.
  // Reconcile only presentation metadata; collaboration scopes remain strict.
  for(const t of value.teams){
    const members=new Set(t.members.map(m=>m.sessionId)),visible=t.order.filter(id=>!t.hidden.includes(id));
    if(t.dock!==undefined){t.dock=pruneDock(t.dock,new Set(visible));for(const id of visible)if(!dockIds(t.dock).includes(id))t.dock=insertDock(t.dock,id,undefined,'right');}
    if(t.sidebarOrder)t.sidebarOrder=[...t.sidebarOrder.filter(id=>members.has(id)),...t.members.map(m=>m.sessionId).filter(id=>!t.sidebarOrder!.includes(id))];
    if(t.graph)t.graph=Object.fromEntries(Object.entries(t.graph).filter(([id])=>members.has(id)));
  }
  return value;
}

/** Team-local scope and durable delivery. It never chooses tasks or roles. */
export class TeamEngine {
  private state: State = { version: 6, revision: 0, teams: [], messages: [], presets:defaultPresets(),events:[] };
  private chain: Promise<unknown> = Promise.resolve();
  private closed = false;
  private loaded = false;
  private closing: Promise<void> | undefined;
  private listeners = new Set<() => void>();
  private waits = new Set<() => void>();
  private lanes=new Map<string,Promise<void>>();
  private abort=new AbortController();
  private writer:FileHandle|undefined;
  private dependencies=new WaitDependencies();
  private lastIssue='';
  private starts=new Map<string,Promise<void>>();
  private retractions=new Map<string,Promise<void>>();
  constructor(private readonly file: string, private readonly host: NativeHost,private readonly store:SnapshotStore=snapshotStore) {}

  async load(): Promise<void> {
    if(this.writer)throw new Error('Engine already loaded');
    this.writer=await acquireWriter(this.file+'.lock');
    try {
    const stored = await this.store.read(this.file);
    const legacy = record(stored)&&Number(stored.version)<6;
    if (stored !== undefined){const original=structuredClone(stored);this.state=parseState(stored);
      if(!this.state.memberships&&await readJson(this.file+'.pre-memberships.json')===undefined)await writeJson(this.file+'.pre-memberships.json',original);
      if(record(original)&&Number(original.version)<6&&await readJson(this.file+'.pre-v6.json')===undefined)await writeJson(this.file+'.pre-v6.json',original);}
    await this.change(next => {
      upgradeBuiltinDuties(next);
      for(const op of next.hostOperations??[])if(op.state==='prepared'){op.state='uncertain';op.error='服务重启，核对原生会话后解除待处理状态；不会自动重建或重复发送';}
      for (const team of next.teams) {
        // Keep the saved activation state. Incomplete operations still require recovery.
        if(legacy||team.pending||team.start?.state==='starting'||team.start?.state==='uncertain'||next.hostOperations?.some(o=>o.teamId===team.id&&o.state==='uncertain')||next.messages.some(m=>m.teamId===team.id&&m.native!=='discarded'&&['dispatching','uncertain'].includes(m.state)))team.paused=true;
        team.epoch??=randomUUID();
        for(const [member,run] of Object.entries(team.runs??{}))if(run.epoch===team.epoch&&run.phase==='working'){
          run.phase='interrupted';run.error='HOST_RESTARTED';
          const issue:RunIssue={stage:'stopped',code:'HOST_RESTARTED'};
          if(run.trackedLive)run.openIssue={input:run.input,requests:[...run.requests],issue};
          recordRunIssue(next,team,member,run.input,run.requests,issue,run.trackedLive===true);
        }
        if(team.start?.state==='starting')team.start.state='uncertain';
        if(team.pending)team.pending.error='服务已重启，请重新应用待切换预设。';
        if(team.briefing?.state==='starting'){team.briefing.state='uncertain';team.briefing.error='启动过程被中断，请检查两个会话；不会自动重发指令。';}

      }
      for(const t of next.teams)for(const c of t.controls??[])if(c.state==='requested')c.state='uncertain';
      for(const r of next.resources??[])for(const op of r.operations){op.state='uncertain';op.error='进程重启，实例完成状态待核对';}
      for (const message of next.messages) {
        if(message.system && message.code==='team_run_status' && message.state==='queued')message.wakeup=false;
        if(message.native==='discarded'){message.state='cancelled';continue;}
        if (message.state === 'dispatching') message.state = 'uncertain';
        // Restoring configuration does not authorize replaying old model work.
        if(message.state==='queued'&&!message.system&&message.wakeup!==false){message.state='cancelled';message.error='服务重启，旧的待派发任务已保留记录但不会自动重发；请按当前任务重新确认。';recordDeliveryIssue(next,message,'HOST_RESTARTED',message.kind==='reply');}
      }
    });
    await this.finishArchiveIntents();
    this.loaded=true;
    }catch(error){await this.writer.close();this.writer=undefined;throw error;}
  }
  liveStatus() {
    return {revision:this.state.revision,statuses:Object.fromEntries(this.state.teams.flatMap(team=>
      team.members.map(member=>[member.sessionId,this.host.status(member.sessionId)])))};
  }
  private historyCache=new Map<string,{revision:number;rows:ReturnType<typeof collaborationTimeline>}>();
  collaborationHistory(scope:import('./timeline.ts').TimelineScope){
    const key=JSON.stringify(scope),hit=this.historyCache.get(key);
    if(hit?.revision===this.state.revision)return hit.rows;
    const rows=collaborationTimeline(this.state,scope,id=>this.archiveContent(id));
    this.historyCache.set(key,{revision:this.state.revision,rows});
    if(this.historyCache.size>4)this.historyCache.delete(this.historyCache.keys().next().value!);
    void rows.catch(()=>{if(this.historyCache.get(key)?.rows===rows)this.historyCache.delete(key);});
    return rows;
  }
  historicalTeams(){return historicalTeamIds(this.state);}
  membershipHistory(){return this.state.memberships??[];}
  private historicalBlocks=new Map<string,{input:string;epoch:string;failure:ReviewBlock}>();
  projectReviewBlock(id:string,run:SeatRun,failure:ReviewBlock){
    const current=this.membership(id)?.runs?.[id];
    if(current?.epoch===run.epoch&&current.input===run.input&&current.phase==='awaiting-reply'){
      this.historicalBlocks.set(id,{epoch:run.epoch,input:run.input,failure});
    }
  }
  syncHostMembers(){this.host.sync?.(this.state.teams);}
  private stateWithReviewBlocks():State{
    if(!this.historicalBlocks.size)return this.state;
    return this.overlayBlocks({...this.state,teams:this.state.teams.map(team=>({...team}))});
  }
  conversationState(){return chatState(this.stateWithReviewBlocks());}
  managementState(id:string,page:string){return managementState(this.stateWithReviewBlocks(),id,page);}
  recordsPage(id:string,before:string,incident:string){return recordsPage(this.state,id,before,50,incident);}
  snapshot():State {return this.overlayBlocks(structuredClone(this.state));}
  private overlayBlocks(state:State):State {
    for(const id of this.historicalBlocks.keys()){
      const team=state.teams.find(t=>t.runs?.[id]&&t.members.some(m=>m.sessionId===id));
      const run=this.seatRun(id);
      if(team?.runs&&run)team.runs={...team.runs,[id]:structuredClone(run)};
    }
    return state;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  membership(id: string): Team | undefined { return this.state.teams.find(t => t.members.some(m => m.sessionId === id)); }
  private emit(): void { for (const listener of this.listeners) { try{listener();}catch{ /* Committed state must not be reported as a failed mutation. */ } } }
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const job = this.chain.then(() => { if (this.closed) throw new CoordinationError('SERVICE_STOPPED','Team Desk is stopped',true); return task(); });
    this.chain = job.catch(() => {});
    return job;
  }
  private async change(edit: (next: State) => void): Promise<void> {
    const next = structuredClone(this.state); edit(next);
    for(const t of next.teams){const ids=new Set(t.members.map(m=>m.sessionId));if(t.coordination?.routes)t.coordination.routes=t.coordination.routes.filter(r=>ids.has(r.from)&&ids.has(r.to));if(t.dock!==undefined)t.dock=pruneDock(t.dock,new Set(t.members.filter(m=>!t.hidden.includes(m.sessionId)).map(m=>m.sessionId)));if(t.sidebarOrder)t.sidebarOrder=[...t.sidebarOrder.filter(id=>ids.has(id)),...t.members.map(m=>m.sessionId).filter(id=>!t.sidebarOrder!.includes(id))];if(t.graph)t.graph=Object.fromEntries(Object.entries(t.graph).filter(([id])=>ids.has(id)));}
    for(const t of next.teams){const before=this.state.teams.find(x=>x.id===t.id);if(before?.configuration&&t.configuration&&before.configuration.contextRevision===t.configuration.contextRevision&&JSON.stringify(before.members)!==JSON.stringify(t.members)){t.configuration.modified=true;t.configuration.contextRevision++;delete t.start;this.event(next,t.id,'configuration-edit','当前团队配置已修改');}}
    reconcileMemberships(this.state,next);
    this.markInvalid(next);
    next.revision++;
    const definitions=[...next.presets,...next.teams.flatMap(t=>[t.configuration?.preset,t.pending?.preset].filter((p):p is TeamPreset=>!!p))];
    if(next.version===6&&definitions.some(p=>p.members.some(m=>m.soul&&Object.keys(m.soul).length))){
      if(await readJson(this.file+'.pre-v7.json')===undefined)await writeJson(this.file+'.pre-v7.json',this.state);
      next.version=7;
    }
    parseState(next);
    try{if(!this.writer)throw new Error('Writer lock not held');await this.store.write(this.file,next);}catch(error){if(error instanceof SnapshotCommitError){this.state=next;this.emit();}throw error;}
    this.state=next;this.emit();
  }
  private team(id: string): Team {
    const result = this.state.teams.find(t => t.id === id);
    if (!result) throw new Error('Team not found'); return result;
  }
  private readonly archiving = new Set<string>();

  private archiveExpectation=new AsyncLocalStorage<{teamId:string;anchor:string;bindingId:string}>();
  archiveFromManagement<T>(teamId:string,anchor:string,bindingId:string,run:()=>Promise<T>){
    return this.archiveExpectation.run({teamId,anchor,bindingId},run);
  }
  private async finishArchiveIntents(only?:string){
    const pending=this.state.archiveIntents?.filter(intent=>only?intent.id===only:!intent.members.some(m=>this.archiving.has(m.id)));
    if(!pending?.length)return;
    const ready=pending.flatMap(intent=>{
      let members;
      try{members=intent.members.map(m=>({...m,current:this.host.archived?.(m.id)}));}
      catch(error){if(only)throw error;return [];}
      return members.some(m=>m.current===undefined)?[]:[{intent,members}];
    });
    if(!ready.length)return;
    await this.change(s=>{
      for(const {intent,members} of ready)for(const m of members)if(m.current!==m.archived){
        s.events.push({id:intent.id+'/'+m.id,time:intent.time,teamId:intent.teamId,sessionId:m.id,
          kind:m.current?'archive':'restore',text:m.current?'随主会话归档':'随主会话恢复'});
      }
      const done=new Set(ready.map(r=>r.intent.id));s.archiveIntents=s.archiveIntents!.filter(i=>!done.has(i.id));
    });
  }
  async withArchiveGroup<T>(id:string,run:(ids:string[])=>Promise<T>):Promise<T>{
    const expected=this.archiveExpectation.getStore();
    const {ids,intent}=await this.serial(async()=>{
      await this.finishArchiveIntents();
      const team=this.membership(id);
      if(expected&&(expected.anchor!==id||team?.id!==expected.teamId||team.members.find(m=>m.sessionId===id)?.bindingId!==expected.bindingId))throw Error('主会话的团队绑定已更改，请刷新后重试');
      if(team&&team.anchor!==id)throw Error('请通过主会话归档或恢复整个团队');
      if(team?.pending||this.state.hostOperations?.some(op=>(op.state==='prepared'||op.state==='uncertain')&&(op.teamId===team?.id||op.sessions.includes(id))))throw Error('请等待成员变更完成后再归档或恢复');
      const ids=team?team.members.map(m=>m.sessionId):[id];
      if(ids.some(member=>this.archiving.has(member)))throw Error('会话归档操作进行中');
      const intent=team&&this.host.archived?randomUUID():undefined;
      if(team&&intent){
        const members=ids.map(id=>{const archived=this.host.archived!(id);if(archived===undefined)throw Error('原生归档状态尚未就绪');return {id,archived};});
        await this.change(s=>(s.archiveIntents??=[]).push({id:intent,teamId:team.id,time:Date.now(),members}));
      }
      for(const member of ids)this.archiving.add(member);
      return {ids,intent};
    });
    try{return await run(ids);}
    finally{
      try{if(intent)await this.serial(()=>this.finishArchiveIntents(intent));}
      finally{for(const member of ids)this.archiving.delete(member);}
    }
  }

  private hostBusy(teamId:string):boolean{return (this.state.hostOperations??[]).some(o=>o.teamId===teamId&&['prepared','uncertain'].includes(o.state));}
  private async hostOperation<P extends {sessions:string[];created?:string[];addition?:{id:string;input:string}},T>(teamId:string,kind:string,prepare:()=>P|Promise<P>,effect:(plan:P)=>Promise<void>,commit:(plan:P)=>Promise<T>):Promise<T>{
    const id=randomUUID();
    const plan=await this.serial(async()=>{
      if(this.hostBusy(teamId))throw new CoordinationError('HOST_OPERATION_PENDING','此团队有未完成的宿主操作，请先核对',true);
      const team=this.team(teamId);
      if(this.archiving.has(team.anchor))throw Error('会话归档操作进行中');
      if(this.host.archived?.(team.anchor) && !['detach','dissolve'].includes(kind))throw Error('请先恢复团队再修改成员');
      const plan=await prepare();
      if(plan.sessions.some(id=>this.archiving.has(id)))throw Error('会话归档操作进行中');
      for(const session of plan.sessions)if(this.state.hostOperations?.some(o=>['prepared','uncertain'].includes(o.state)&&o.sessions.includes(session)))throw new CoordinationError('SESSION_RESERVED','会话已有待完成操作',true);
      const intent:HostOperation={id,teamId,kind,time:Date.now(),epoch:this.state.teams.find(t=>t.id===teamId)?.epoch,state:'prepared',sessions:plan.sessions,...(plan.addition&&{addition:plan.addition}),...(plan.created&&{created:plan.created})};
      await this.change(s=>(s.hostOperations??=[]).push(intent));return plan;
    });
    try{
      await effect(plan);
      return await this.serial(async()=>{
        const intent=this.state.hostOperations?.find(o=>o.id===id),team=this.state.teams.find(t=>t.id===teamId);
        if(intent?.state!=='prepared'||(intent.epoch&&team?.epoch!==intent.epoch))throw new CoordinationError('STALE_EPOCH','宿主操作所属团队批次已变化');
        if(['configure','add','detach','dissolve','prepare-legacy'].includes(kind)&&team?.members.some(m=>this.host.status(m.sessionId)==='running'))throw new CoordinationError('MEMBER_RUNNING','宿主操作期间成员开始运行，请核对后继续',true);
        const result=await commit(plan);
        await this.change(s=>{s.hostOperations!.find(o=>o.id===id)!.state='completed';});return result;
      });
    }catch(error){
      if(!this.closed)await this.serial(()=>this.change(s=>{const op=s.hostOperations?.find(o=>o.id===id);if(op){op.state='uncertain';op.error=String(error);}const t=s.teams.find(t=>t.id===teamId);if(t){t.paused=true;if(t.pending)t.pending.error='宿主操作待核对；请核对后取消待切换并重新选择绑定';if(t.start?.state==='starting'){t.start.state='uncertain';t.start.error=String(error);}}})).catch(()=>{});
      throw error;
    }
  }
  async resolveHostOperation(id:string,reason:string,teamId?:string):Promise<void>{
    string(reason,'核对依据',2000);const before=this.state.hostOperations?.find(o=>o.id===id);if(!before||before.state!=='uncertain'||(teamId!==undefined&&before.teamId!==teamId))throw new CoordinationError('OPERATION_STATE','只能核对已停止或失败的宿主操作');
    const erased=before.kind==='delete-member' ? (await Promise.all(before.sessions.map(async session=>await this.host.exists(session)?undefined:session))).filter((id):id is string=>!!id) : [];
    // Older configure and prepare intents reserved only newly allocated IDs. A legacy add
    // could reserve a pre-existing conversation, so an ambiguous one remains independent.
    const created=before.created??(['configure','prepare-legacy'].includes(before.kind)?before.sessions:[]);
    const recoverable:string[]=[];
    for(const session of created)if(await this.host.exists(session))recoverable.push(session);
    await this.serial(async()=>{const op=this.state.hostOperations?.find(o=>o.id===id);if(!op||op.state!=='uncertain'||(teamId!==undefined&&op.teamId!==teamId))throw new CoordinationError('OPERATION_STATE','操作状态已变化');
      await this.change(s=>{const current=s.hostOperations!.find(o=>o.id===id)!,team=s.teams.find(t=>t.id===op.teamId);if(team)for(const session of erased)this.removeBinding(team,session);if(team&&['add','configure','prepare-legacy'].includes(op.kind))for(const sessionId of recoverable)if(!s.teams.some(t=>t.members.some(m=>m.sessionId===sessionId))){if(team.members.length>=12)throw new CoordinationError('MEMBER_CAPACITY','请先移出未使用成员再恢复');team.members.push({sessionId,...(current.addition&&{addition:current.addition}),label:'已恢复会话',owned:true,active:false,targets:[],operations:[],autoLink:false});team.order.push(sessionId);team.hidden.push(sessionId);}current.state='resolved';current.error=reason;this.event(s,op.teamId,'host-reconciled',reason);});
    });
  }
  private editable(team:Team):void{if(this.hostBusy(team.id)||team.pending||team.members.some(m=>this.host.status(m.sessionId)==='running'))throw Error('请等待当前回合和待切换配置完成，再修改成员或协作范围');}
  async memberPrompt(teamId:string,id:string,prompt:string):Promise<void>{await this.serial(async()=>{const t=this.team(teamId);this.editable(t);if(!t.members.some(m=>m.sessionId===id)||typeof prompt!=='string'||prompt.length>16000)throw Error('无效的协作提示词');await this.change(s=>{s.teams.find(t=>t.id===teamId)!.members.find(m=>m.sessionId===id)!.prompt=prompt;});});}
  private authorize(caller: string, operation: Operation, target?: string): Team {
    const team = this.membership(caller), member = team?.members.find(m => m.sessionId === caller);
    if (!team || !member || member.active===false || !member.operations.includes(operation)) throw new CoordinationError('ROUTE_DENIED','Operation outside collaboration scope');
    if (target !== undefined && (!member.targets.includes(target) || !team.members.some(m => m.sessionId === target&&m.active!==false))) throw new CoordinationError('ROUTE_DENIED','Recipient outside collaboration scope');
    return team;
  }
  async create(anchor:string,cwd:string,title:string,autoLink=true,
    drop?:{sessionId:string;label:string;layout:Layout;zone:DockZone;target?:string}):Promise<Team>{
    string(anchor,'anchor');string(cwd,'cwd');string(title,'title',120);
    if(!await this.host.exists(anchor)||this.host.canBind&&!await this.host.canBind(anchor))throw Error('请选择原生主对话或独立会话');
    if(drop){
      string(drop.label,'member label',120);
      if(autoLink||!layouts.includes(drop.layout)||!['left','right','top','bottom','center'].includes(drop.zone)
        ||drop.target&&drop.target!==anchor||!await this.host.exists(drop.sessionId)||this.host.canBind&&!await this.host.canBind(drop.sessionId))throw Error('Invalid dock request');
    }
    return this.serial(async()=>{if(this.archiving.has(anchor)||this.host.archived?.(anchor))throw Error('请先恢复会话再创建团队');if(this.membership(anchor)||this.state.hostOperations?.some(o=>['prepared','uncertain'].includes(o.state)&&o.sessions.includes(anchor)))throw Error('Conversation already belongs to a team');
      const team:Team={epoch:randomUUID(),id:randomUUID(),anchor,title,cwd,paused:true,members:[{sessionId:anchor,label:'1',owned:false,targets:[],operations:[...operations],autoLink}],layout:'columns',order:[anchor],hidden:[],sizes:[50,50]};
      if(drop){
        const id=drop.sessionId;
        if(this.archiving.has(id)||this.host.archived?.(id)||this.membership(id)||this.state.hostOperations?.some(o=>['prepared','uncertain'].includes(o.state)&&o.sessions.includes(id)))throw Error('Conversation unavailable');
        team.layout=drop.layout;
        if(id!==anchor){
          this.editable(team);
          team.members.push({sessionId:id,label:drop.label,owned:false,targets:[],operations:[...operations],autoLink:false});team.order.push(id);
        }
        team.dock=insertDock({id:anchor},id,drop.target,drop.zone);
      }
      await this.change(s=>s.teams.push(team));return structuredClone(team);
    });
  }
  private additions=new Map<string,{input:string;promise:Promise<string>}>();
  async add(teamId:string,label:string,existing?:string,autoLink=true,replaceTarget?:string,requestId?:string):Promise<string>{
    if(!requestId)return this.addMember(teamId,label,existing,autoLink,replaceTarget);
    string(requestId,'requestId',160);
    const input=JSON.stringify([label,existing,autoLink,replaceTarget]),key=JSON.stringify([teamId,requestId]);
    const prior=this.state.memberships?.find(p=>p.teamId===teamId&&p.addition?.id===requestId);
    const running=this.additions.get(key);
    if(prior||running){
      if((prior?.addition?.input??running?.input)!==input)throw Error('添加成员请求的参数已更改');
      return prior?.sessionId??running!.promise;
    }
    const promise=this.addMember(teamId,label,existing,autoLink,replaceTarget,{id:requestId,input});
    this.additions.set(key,{input,promise});
    try{return await promise;}finally{this.additions.delete(key);}
  }
  private async addMember(teamId:string,label:string,existing:string|undefined,autoLink:boolean,replaceTarget?:string,addition?:{id:string;input:string}):Promise<string>{
    string(label,'label',120);
    if(existing&&(!await this.host.exists(existing)||this.host.canBind&&!await this.host.canBind(existing)))throw Error('Conversation unavailable');
    const replaceIn=(team:Team)=>{
      if(replaceTarget===undefined)return;
      if(!existing||autoLink)throw Error('Invalid dock request');
      const visible=team.order.filter(id=>!team.hidden.includes(id));
      if(visible.length<4||!visible.includes(replaceTarget))throw Error('Replacement pane changed');
      const tree=team.dock===undefined?tileDock(visible,team.layout):team.dock;
      return insertDock(tree,existing,replaceTarget,'replace');
    };
    return this.hostOperation(teamId,'add',()=>{
      const team=this.team(teamId);this.editable(team);if(team.members.length>=12)throw Error('A team can contain at most 12 conversations');
      if(existing&&(this.host.archived?.(existing)||this.membership(existing)))throw Error('Conversation unavailable');
      replaceIn(team);
      const id=existing??`session-${randomUUID()}`;return {sessions:[id],created:existing?[]:[id],...(addition&&{addition}),id,cwd:team.cwd,anchor:team.anchor};
    },async p=>{if(!existing)await this.host.create(p.id,p.cwd,p.anchor,label);},async p=>{
      if(existing&&(this.host.archived?.(existing)||this.membership(existing)))throw Error('Conversation unavailable');
      await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!,id=p.id;
        const replacement=replaceIn(t);
        const used=new Set(presetFromTeam(t).members.map(m=>m.key).concat(t.members.flatMap(m=>m.slot?[m.slot]:[])));
        let suffix=1;while(used.has('member-'+suffix))suffix++;
        const member:Member={sessionId:id,label,...(addition&&{addition}),...(t.configuration?{slot:'member-'+suffix}:{}),owned:!existing,targets:autoLink?t.members.map(m=>m.sessionId):[],operations:[...operations],autoLink};
        for(const peer of t.members)if(autoLink&&peer.autoLink)peer.targets.push(id);t.members.push(member);t.order.push(id);
        if(replacement&&replaceTarget){t.dock=replacement;t.hidden.push(replaceTarget);}else if(!autoLink)t.hidden.push(id);
      });return p.id;
    });
  }
  private event(state:State,teamId:string,kind:string,text:string):void{
    state.events.push({id:randomUUID(),teamId,kind,text,time:Date.now()});
  }
  context(id:string):string{const t=this.membership(id),base=teamContext(t,id);return base+(base&&t?'\n已加入项目（需明确 projectId 读取）：'+JSON.stringify((this.state.projects??[]).filter(p=>p.teamIds.includes(t.id)).map(({id,name,root})=>({id,name,root})))+'\n预设与接口文档可用 team_reference 读取。team_git directly coordinates Git among these independent Team Desk conversations: select an explicit project_id, inspect status, create an official worktree, commit selected paths, propose pinned commits, review, and integrate. Native Git commands remain available under normal session permissions. team_protocol 可试算路由、按声明解析变量、显式多目标发布；team_task 支持可选认领和接收确认交接；team_resource 查询已配置工具实例、占用和续期。任务认领是协作声明，不会取消其他会话。工具锁仅保护配置的调用入口，租约到期不等于远端操作已停止。发送返回 queued 是已持久化，不必重复发；team_wait options.requestId 等待对应回复；team_shared history/changes 按游标读取历史及差异。':'');}
  async savePreset(value:unknown,expected?:number):Promise<TeamPreset>{
    return this.serial(async()=>{validatePreset(value);const old=this.state.presets.find(p=>p.id===value.id);
      if(old&&old.revision!==expected)throw Error('预设已被其他页面修改，请重新打开后编辑');
      if(!old&&this.state.presets.length>=200)throw Error('预设库最多保存 200 项');
      const preset={...structuredClone(value),revision:old?old.revision+1:1,updatedAt:Date.now()};
      await this.change(s=>{s.presets=s.presets.filter(p=>p.id!==preset.id);s.presets.push(preset);this.event(s,'','preset-save','保存预设：'+preset.name+' v'+preset.revision);});return preset;
    });
  }
  async removePreset(id:string,revision:number):Promise<void>{await this.serial(async()=>{
    const p=this.state.presets.find(p=>p.id===id);if(!p||p.revision!==revision)throw Error('预设已变化，请刷新');
    await this.change(s=>{s.presets=s.presets.filter(p=>p.id!==id);this.event(s,'','preset-delete','移除库中预设：'+p.name+'；已应用的团队保留其配置');});
  });}
  private checkBindings(team:Team,preset:TeamPreset,bindings:Record<string,string>):void{
    if(this.archiving.has(team.anchor)||this.host.archived?.(team.anchor))throw Error('请先恢复团队再修改成员');
    const ids=Object.values(bindings).filter(Boolean);
    if(Object.keys(bindings).some(k=>!preset.members.some(m=>m.key===k))||new Set(ids).size!==ids.length||ids.some(id=>!team.members.some(m=>m.sessionId===id))||!ids.includes(team.anchor))throw Error('每个会话只能绑定一个成员，且须保留主会话');
    if(team.members.length+preset.members.filter(m=>!bindings[m.key]).length>12)throw Error('含保留会话在内最多 12 个成员，请复用已有会话或先移出未使用成员');
  }
  private async commitConfiguration(teamId:string,pending:PendingConfiguration,modified=pending.modified===true):Promise<void>{
    await this.hostOperation(teamId,'configure',async()=>{
      const team=this.team(teamId);
      if(!team.pending||team.pending.switchId!==pending.switchId||team.pending.error)throw new CoordinationError('SWITCH_SUPERSEDED','此次配置切换已取消或已被替换');
      if(this.drainingReplies(team))throw new CoordinationError('REPLIES_PENDING','等待当前批次的回复送达',true);
      const preset=structuredClone(pending.preset),bindings={...pending.bindings};this.checkBindings(team,preset,bindings);
      if(team.members.some(m=>this.host.status(m.sessionId)==='running'))throw Error('成员正在运行');
      const seats=seatSelections(team,preset,bindings,modified);
      if(seats.length){
        if(!this.host.validateSeats||!this.host.applySeat)throw Error('DSH seat settings unavailable');
        await this.host.validateSeats(seats);
      }
      const created:string[]=[];for(const m of preset.members)if(!bindings[m.key]){const id=`session-${randomUUID()}`;bindings[m.key]=id;created.push(id);}
      const soulRequests=preset.members.filter(slot=>slot.soul&&(!modified||team.configuration?.bindings[slot.key]!==bindings[slot.key]||JSON.stringify(team.configuration?.preset.members.find(m=>m.key===slot.key)?.soul)!==JSON.stringify(slot.soul))).map(slot=>({sessionId:bindings[slot.key]!,rules:slot.soul!}));
      const personaPlan=soulRequests.length?await this.host.preparePersonas?.(soulRequests):undefined;
      return {sessions:created,seats,preset,bindings,created,cwd:team.cwd,anchor:team.anchor,personaPlan};
    },async p=>{for(const slot of p.preset.members)if(p.created.includes(p.bindings[slot.key]!))await this.host.create(p.bindings[slot.key]!,p.cwd,p.anchor,slot.label,slot.native?.mode);
      for(const seat of p.seats)await this.host.applySeat!(p.bindings[seat.key]!,seat.settings);
      if(p.personaPlan!==undefined)await this.host.applyPersonas?.(p.personaPlan);},async p=>{
      const {preset,bindings,created}=p;
    await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!,nextIds=new Set(Object.values(bindings));
      for(const m of t.members){m.active=false;m.targets=[];m.operations=[];m.autoLink=false;delete m.prompt;delete m.incidents;}
      for(const slot of preset.members){const id=bindings[slot.key]!;let m=t.members.find(m=>m.sessionId===id);
        if(!m){m={sessionId:id,label:slot.label,owned:true,autoLink:false,targets:[],operations:[]};t.members.push(m);t.order.push(id);t.hidden.push(id);}
        Object.assign(m,{...(slot.incidents?{incidents:{...slot.incidents}}:{}),label:slot.label,slot:slot.key,prompt:slot.prompt,active:true,operations:[...slot.operations],targets:slot.targets.map(k=>bindings[k]!)});
      }
      t.hidden=[...new Set([...t.hidden,...t.members.filter(m=>!nextIds.has(m.sessionId)).map(m=>m.sessionId)])];
      t.epoch=randomUUID();
      for(const message of s.messages)if(message.teamId===teamId&&message.state==='queued'){message.state='cancelled';message.error='Configuration replaced';}
      const policy=policyBindings(preset.coordination,bindings);if(policy)t.coordination=policy;else delete t.coordination;
      t.configuration={...(pending.requestId?{requestId:pending.requestId}:{}),preset,bindings,modified,contextRevision:(t.configuration?.contextRevision??0)+1};
      (t.bindingHistory??={})[preset.id]={...bindings};delete t.pending;delete t.start;t.paused=false;
      if(pending.applyLayout){delete t.graph;t.layout=preset.layout;t.order=[...Object.values(bindings),...t.order.filter(id=>!nextIds.has(id))];t.hidden=t.members.filter(m=>!nextIds.has(m.sessionId)).map(m=>m.sessionId);delete t.dock;t.sizes=[50,50];}
      this.event(s,teamId,'configuration',`应用${modified?'当前自定义配置':'预设'}：${preset.name} v${preset.revision}；${created.length} 个新会话；团队配置已生效`);
    });
    });
  }
  private async checkSeats(team:Team,preset:TeamPreset,bindings:Record<string,string>,edit:boolean,consent:string){
    const seats=seatSelections(team,preset,bindings,edit);
    if(permissionConsent(seats)!==consent)throw Error('请确认所选成员的 DSH 权限');
    if(!seats.length)return;
    if(!this.host.validateSeats||!this.host.applySeat)throw Error('DSH seat settings unavailable');
    await this.host.validateSeats(seats);
  }
  async applyPreset(teamId:string,presetId:string,revision:number,bindings:Record<string,string>,applyLayout=false,requestId?:string,consent=''):Promise<{pending:boolean}>{
    const result=await this.serial(async()=>{const t=this.team(teamId);if(requestId){string(requestId,'请求标识',200);if(t.configuration?.requestId===requestId)return {done:true};if(t.pending?.requestId===requestId)return {queued:true};}
      if(this.hostBusy(teamId)||t.pending)throw new CoordinationError('HOST_OPERATION_PENDING','已有待完成配置',true);
      const preset=this.state.presets.find(p=>p.id===presetId);if(!preset||preset.revision!==revision)throw Error('预设已更新，请重新选择');
      this.checkBindings(t,preset,bindings);await this.checkSeats(t,preset,bindings,false,consent);const pending:PendingConfiguration={switchId:randomUUID(),...(requestId?{requestId}:{}),preset:structuredClone(preset),bindings:{...bindings},applyLayout};
      await this.change(s=>{const current=s.teams.find(x=>x.id===teamId)!;current.pending=pending;});
      return this.drainingReplies(t)||t.members.some(m=>this.host.status(m.sessionId)==='running')?{queued:true}:{pending};
    });
    if(result.pending)await this.commitConfiguration(teamId,result.pending);return {pending:!!result.queued};
  }
  async configure(teamId:string,preset:unknown,bindings:Record<string,string>,expected:number,consent=''):Promise<void>{
    const apply=await this.serial(async()=>{
      const t=this.team(teamId);validatePreset(preset);
      if((t.configuration?.contextRevision??0)!==expected)throw Error('团队配置已变化，请重新打开编辑');
      this.checkBindings(t,preset,bindings);
      if(this.hostBusy(teamId)||t.pending)throw new CoordinationError('HOST_OPERATION_PENDING','已有待完成配置',true);
      const base=presetFromTeam(t);
      const currentBindings=Object.fromEntries(t.members.filter(m=>m.active!==false).map((m,i)=>[base.members[i]!.key,m.sessionId]));
      const routingDefinition=(definition:TeamPreset)=>({...definition,updatedAt:0,members:definition.members.map(({incidents,label,prompt,...rest})=>rest)});
      const sameRouting=isDeepStrictEqual(currentBindings,bindings)&&isDeepStrictEqual(routingDefinition(base),routingDefinition(preset));
      const metadataChanged=!isDeepStrictEqual(base.members,preset.members);
      if(sameRouting&&t.configuration&&!t.paused&&!metadataChanged)return false;
      if(sameRouting&&metadataChanged){
        // Keep outstanding orders, delivery receipts, and the incident history in the same epoch.
        await this.change(s=>{
          const team=s.teams.find(x=>x.id===teamId)!;
          for(const seat of preset.members){
            const member=team.members.find(m=>m.sessionId===bindings[seat.key])!;
            member.slot=seat.key;member.label=seat.label;member.prompt=seat.prompt;
            if(seat.incidents)member.incidents={...seat.incidents};else delete member.incidents;
          }
          if(!team.configuration&&preset.members.some((seat,i)=>seat.label!==base.members[i]?.label||seat.prompt!==base.members[i]?.prompt))team.paused=false;
          team.configuration={...team.configuration,preset:structuredClone(preset),bindings:{...bindings},modified:true,contextRevision:expected+1};
          this.event(s,teamId,'configuration-edit','更新成员名称、说明或异常通知设置');
        });
        return false;
      }
      this.editable(t);await this.checkSeats(t,preset,bindings,true,consent);
      await this.change(s=>{const current=s.teams.find(x=>x.id===teamId)!;current.pending={switchId:randomUUID(),preset:structuredClone(preset),bindings:{...bindings},applyLayout:false,modified:true};});
      return true;
    });
    if(apply){const team=this.team(teamId);if(team.pending&&!this.drainingReplies(team))await this.commitConfiguration(teamId,team.pending);}
  }
  /** A display rename does not replace the live workflow or invalidate its message epoch. */
  async renamePresetDisplay(teamId:string,presetId:string,name:string,description:string,expected:number):Promise<void>{
    string(name,'预设名称',120);if(typeof description!=='string'||description.length>2000)throw Error('无效的预设说明');
    await this.serial(async()=>{const t=this.team(teamId);this.editable(t);if(!t.configuration||t.configuration.preset.id!==presetId||t.configuration.contextRevision!==expected)throw Error('团队配置已变化，请刷新后重命名');
      await this.change(s=>{const current=s.teams.find(t=>t.id===teamId)!;current.configuration!.preset.name=name;current.configuration!.preset.description=description;current.configuration!.contextRevision++;this.event(s,teamId,'preset-rename','更新预设显示名称');});
    });
  }
  private drainingReplies(team:Team):boolean {
    if(team.paused)return false;
    const outstanding=new Set(Object.values(team.runs??{}).filter(r=>r.epoch===team.epoch&&
      (r.phase==='working'||r.phase==='awaiting-reply'&&!r.openIssue||r.openIssue?.issue.stage==='retrying')).flatMap(r=>r.requests));
    return this.state.messages.some(m=>sameBinding(team,m)&&m.epoch===team.epoch&&!m.cancellation&&
      m.state!=='cancelled'&&m.native!=='discarded'&&(m.expiresAt??Infinity)>Date.now()&&
      (m.kind==='reply'&&m.native!=='admitted'||outstanding.has(m.id)&&m.native==='admitted'));
  }
  async flushPending():Promise<void>{
    const candidates=this.state.teams.filter(t=>t.pending&&!t.pending.error&&!this.hostBusy(t.id)&&!this.drainingReplies(t)&&!t.members.some(m=>this.host.status(m.sessionId)==='running'));
    await Promise.allSettled(candidates.map(async t=>{try{await this.commitConfiguration(t.id,t.pending!);}catch(error){if(error instanceof CoordinationError&&['HOST_OPERATION_PENDING','SWITCH_SUPERSEDED','REPLIES_PENDING'].includes(error.code))return;if(!this.closed)await this.serial(()=>this.change(s=>{const team=s.teams.find(x=>x.id===t.id);if(team?.pending&&team.pending.switchId===t.pending?.switchId)team.pending.error=String(error);}));}}));
  }
  async cancelPending(teamId:string):Promise<void>{await this.serial(async()=>{this.team(teamId);if(this.hostBusy(teamId))throw new CoordinationError('HOST_OPERATION_PENDING','宿主操作尚未核对');await this.change(s=>{delete s.teams.find(t=>t.id===teamId)!.pending;this.event(s,teamId,'switch-cancel','取消待切换配置');});});}
  startTeam(teamId:string):Promise<void>{
    // Compatibility for older clients: enabling never injects a synthetic user task.
    const team=this.team(teamId);if(!team.configuration)throw Error('请先应用团队配置');
    if(team.start?.state==='uncertain')return Promise.reject(Error('旧启动结果待核对，请先核对协作记录'));
    return this.pause(teamId,false);
  }
  async graphArrange(teamId:string):Promise<void>{await this.serial(async()=>{this.team(teamId);if(this.hostBusy(teamId))throw new CoordinationError('HOST_OPERATION_PENDING','宿主操作尚未核对');await this.change(s=>{delete s.teams.find(t=>t.id===teamId)!.graph;});});}
  async restoreDock(teamId:string,value:unknown,hidden:string[]):Promise<void>{await this.serial(async()=>{const t=this.team(teamId),ids=new Set(t.members.map(m=>m.sessionId));if(!validDock(value,ids)||hidden.some(id=>!ids.has(id))||new Set([...dockIds(value),...hidden]).size!==ids.size||dockIds(value).some(id=>hidden.includes(id)))throw Error('排布已变化，无法恢复');await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;t.dock=value;t.hidden=hidden;});});}
  /** Explicitly chosen prompt preset; role behaviour stays in editable text. */
  async prepareWorkReview(teamId:string,input:WorkReviewInput):Promise<Briefing>{
    return this.hostOperation(teamId,'prepare-legacy',()=>{
      const team=this.team(teamId);
      if(team.briefing)throw new Error('此团队已有预设，请查看已保存的指令；后续任务可直接发给工作会话。');
      for(const [key,max]of [['goal',4000],['criteria',4000],['workerPrompt',8000],['reviewerPrompt',8000]] as const)string(input[key],key,max);
      if(!team.members.some(m=>m.sessionId===input.worker))throw new Error('工作会话不在当前团队');
      if(input.reviewer&&(input.reviewer===input.worker||!team.members.some(m=>m.sessionId===input.reviewer)))throw new Error('请选择另一个团队成员监督查验');
      if(!input.reviewer&&team.members.length>=12)throw new Error('A team can contain at most 12 conversations');
      if([input.worker,input.reviewer].some(id=>id&&this.host.status(id)==='running'))throw new Error('请等待选中的会话完成当前回合');
      const reviewer=input.reviewer??`session-${randomUUID()}`;
      const briefing:Briefing={kind:'work-review',state:'prepared',goal:input.goal,criteria:input.criteria,worker:input.worker,reviewer,instructions:[
        {sessionId:reviewer,text:renderInstructions(input.reviewerPrompt,input.goal,input.criteria,input.worker),wakeup:false},
        {sessionId:input.worker,text:renderInstructions(input.workerPrompt,input.goal,input.criteria,reviewer),wakeup:true},
      ]};
      for(const i of briefing.instructions)string(i.text,'instructions',24000);
      return {sessions:input.reviewer?[]:[reviewer],created:input.reviewer?[]:[reviewer],reviewer,briefing,cwd:team.cwd,anchor:team.anchor};
    },async p=>{if(!input.reviewer)await this.host.create(p.reviewer,p.cwd,p.anchor,'监督查验');},async p=>{
      const {reviewer,briefing}=p;
      await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;
        if(!input.reviewer)t.members.push({sessionId:reviewer,label:'监督查验',owned:true,targets:[input.worker],operations:[...operations],autoLink:false});
        for(const [id,label,peer]of [[input.worker,'工作',reviewer],[reviewer,'监督查验',input.worker]]){const m=t.members.find(m=>m.sessionId===id)!;m.label=label!;m.targets=[peer!];m.operations=[...operations];m.autoLink=false;}
        t.order=[input.worker,reviewer,...t.order.filter(id=>id!==input.worker&&id!==reviewer)];
        t.hidden=t.hidden.filter(id=>id!==input.worker&&id!==reviewer);delete t.dock;t.layout='columns';t.sizes=[50,50];t.briefing=briefing;
      });
      return structuredClone(briefing);
    });
  }
  /** Durable one-shot delivery. Interrupted setup is never silently replayed. */
  startBriefing(teamId:string):Promise<Briefing>{
    const key='briefing:'+teamId,prior=this.starts.get(key);if(prior)return prior.then(()=>structuredClone(this.team(teamId).briefing!));
    const job=this.startBriefingOnce(teamId),done=job.then(()=>{this.starts.delete(key);},error=>{this.starts.delete(key);throw error;});this.starts.set(key,done);void done.catch(()=>{});return job;
  }
  private async startBriefingOnce(teamId:string):Promise<Briefing>{
    const current=this.team(teamId).briefing;if(current?.state==='uncertain')throw Error(current.error||'预设投递结果不确定，请核对');if(current?.state==='started')return structuredClone(current);
    await this.hostOperation(teamId,'start-legacy',async()=>{
      const team=this.team(teamId),b=team.briefing;if(!b)throw Error('请先准备预设');
      if(b.state!=='prepared')throw Error('预设投递结果不确定，请检查会话；不会自动重发');
      if(b.instructions.some(i=>!team.members.some(m=>m.sessionId===i.sessionId)))throw Error('预设成员已经移出团队');
      if(b.instructions.some(i=>this.host.status(i.sessionId)==='running'))throw Error('请等待选中的会话完成当前回合');
      await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;t.briefing!.state='starting';t.paused=false;});return {sessions:[],instructions:b.instructions};
    },async p=>{for(const i of p.instructions){if(this.closed)throw Error('Team Desk is stopped');await this.host.brief(i.sessionId,i.text,i.wakeup);}},async()=>{await this.change(s=>{s.teams.find(t=>t.id===teamId)!.briefing!.state='started';});}).catch(async error=>{if(this.closed)throw error;const b=this.team(teamId).briefing;if(b?.state!=='starting')throw error;await this.serial(()=>this.change(s=>{const b=s.teams.find(t=>t.id===teamId)!.briefing!;b.state='uncertain';b.error='预设投递结果不确定，请核对：'+String(error);}));});
    return structuredClone(this.team(teamId).briefing!);
  }
  async scope(teamId: string, id: string, targets: string[], allowed: Operation[]): Promise<void> {
    await this.serial(async () => {
      const team = this.team(teamId);this.editable(team);
      if (!team.members.some(m => m.sessionId === id) || targets.some(t => t === id || !team.members.some(m => m.sessionId === t)) || allowed.some(op => !operations.includes(op))) throw new Error('Invalid collaboration scope');
      await this.change(s => { const m = s.teams.find(t => t.id === teamId)!.members.find(m => m.sessionId === id)!; m.targets = [...new Set(targets)]; m.operations = [...new Set(allowed)]; m.autoLink = false; });
    });
  }
  async layout(teamId: string, layout?: Layout, order?: string[], hidden?: string[], sizes?: number[]): Promise<void> {
    await this.serial(async () => {
      const team = this.team(teamId);
      layout ??= team.layout; order ??= team.order; hidden ??= team.hidden; sizes ??= team.sizes;
      if (!layouts.includes(layout) || order.length !== team.members.length || new Set(order).size !== order.length || order.some(id => !team.members.some(m => m.sessionId === id))) throw new Error('Invalid layout');
      if(team.dock===undefined&&layout===team.layout&&isDeepStrictEqual(order,team.order)&&isDeepStrictEqual(hidden,team.hidden)&&isDeepStrictEqual(sizes,team.sizes))return;
      await this.change(s => { const t=s.teams.find(t => t.id === teamId)!;Object.assign(t, {layout, order, hidden, sizes});delete t.dock; });
    });
  }
  /** Atomic graph edits avoid overwriting another client's unrelated edges. */
  async connection(teamId:string,source:string,target:string,enabled:boolean):Promise<void>{
    await this.serial(async()=>{const t=this.team(teamId);this.editable(t);const m=t.members.find(m=>m.sessionId===source);if(!m||source===target||!t.members.some(m=>m.sessionId===target))throw new Error('Invalid connection');
      await this.change(s=>{const member=s.teams.find(t=>t.id===teamId)!.members.find(m=>m.sessionId===source)!;member.targets=enabled?[...new Set([...member.targets,target])]:member.targets.filter(x=>x!==target);member.autoLink=false;});});
  }
  async operation(teamId:string,id:string,op:Operation,enabled:boolean):Promise<void>{
    await this.serial(async()=>{this.editable(this.team(teamId));if(!operations.includes(op)||!this.team(teamId).members.some(m=>m.sessionId===id))throw new Error('Invalid operation');await this.change(s=>{const m=s.teams.find(t=>t.id===teamId)!.members.find(m=>m.sessionId===id)!;m.operations=enabled?[...new Set([...m.operations,op])]:m.operations.filter(x=>x!==op);m.autoLink=false;});});
  }
  async graphPosition(teamId:string,id:string,x:number,y:number):Promise<void>{
    await this.serial(async()=>{if(!this.team(teamId).members.some(m=>m.sessionId===id)||![x,y].every(n=>Number.isFinite(n)&&n>=0&&n<=5000))throw new Error('Invalid graph position');await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;(t.graph??={})[id]={x,y};});});
  }
  async reorder(teamId:string,source:string,target:string,after:boolean):Promise<void>{
    await this.serial(async()=>{const t=this.team(teamId);if(source===t.anchor||target===t.anchor||source===target||![source,target].every(id=>t.members.some(m=>m.sessionId===id)))throw new Error('Invalid member order');await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!,order=(t.sidebarOrder??t.members.map(m=>m.sessionId)).filter(id=>id!==source);order.splice(order.indexOf(target)+(after?1:0),0,source);t.sidebarOrder=order;});});
  }
  async dock(teamId:string,id:string,target:string|undefined,zone:DockZone|'hide',expected?:unknown):Promise<void>{
    await this.serial(async()=>{const t=this.team(teamId);if(!t.members.some(m=>m.sessionId===id)||!['left','right','top','bottom','center','replace','hide'].includes(zone)||(target&&!t.members.some(m=>m.sessionId===target)))throw new Error('Invalid dock request');
      const visible=t.order.filter(id=>!t.hidden.includes(id)),tree=t.dock===undefined?tileDock(visible,t.layout):t.dock;
      if(expected!==undefined&&!isDeepStrictEqual(expected,tree))throw Error('Divider layout changed');
      if(zone==='replace'&&visible.length<4)throw Error('Replacement pane changed');
      await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;if(zone==='hide'){t.hidden=[...new Set([...t.hidden,id])];t.dock=pruneDock(tree,new Set(visible.filter(x=>x!==id)));}else{t.dock=insertDock(tree,id,target,zone);t.hidden=t.hidden.filter(x=>x!==id);if(zone==='replace'&&id!==target&&target&&!t.hidden.includes(target))t.hidden.push(target);}});
    });
  }
  async dockResize(teamId:string,path:string,ratio:number,rotateAt?:unknown,expected?:unknown):Promise<void>{
    await this.serial(async()=>{
      const t=this.team(teamId),tree=t.dock===undefined?tileDock(t.order.filter(id=>!t.hidden.includes(id)),t.layout):t.dock;
      if(!/^[01]{0,24}$/.test(path)||!Number.isFinite(ratio)||(rotateAt!==undefined&&(typeof rotateAt!=='string'||!/^[01]{0,24}$/.test(rotateAt)||!path.startsWith(rotateAt))))throw Error('Invalid divider');
      if(expected!==undefined&&!isDeepStrictEqual(expected,tree))throw Error('Divider layout changed');
      if(tree){const base=typeof rotateAt==='string'?transposeCross(tree,rotateAt):tree;
        await this.change(s=>{s.teams.find(t=>t.id===teamId)!.dock=resizeDock(base,path,ratio);});}
    });
  }
  async pause(teamId: string, paused: boolean): Promise<void> {
    await this.serial(async () => {
      const t=this.team(teamId);if((t.pending||this.hostBusy(teamId))&&!paused)throw Error('待切换期间不能启用通信'); await this.change(s => { s.teams.find(t => t.id === teamId)!.paused = paused; this.event(s,teamId,'communication',paused?'暂停通信':'启用通信'); });
    });
  }
  async rename(teamId: string, title: string, sessionId?: string): Promise<void> {
    await this.serial(async () => {
      const team = this.team(teamId);if(sessionId)this.editable(team); string(title, 'name', 120);
      if (sessionId && !team.members.some(m => m.sessionId === sessionId)) throw new Error('Member not found');
      if((sessionId?team.members.find(m=>m.sessionId===sessionId)!.label:team.title)===title.trim())return;
      await this.change(s => { const t = s.teams.find(t => t.id === teamId)!;
        if (sessionId) t.members.find(m => m.sessionId === sessionId)!.label = title.trim();
        else if(t.title!==title.trim()){this.event(s,t.id,'team-rename',t.title+' → '+title.trim());t.title=title.trim();}
      });
    });
  }
  /** Release ownership and retain all native histories and the message archive. */
  async dissolve(teamId:string):Promise<void>{
    for(const op of this.state.hostOperations??[])if(op.teamId===teamId&&op.kind==='dissolve'&&op.state==='uncertain')await this.resolveHostOperation(op.id,'重试幂等的解除关系；保留原生历史');
    await this.serial(async()=>{
      const team=this.team(teamId);
      this.editable(team);
      if(this.archiving.has(team.anchor))throw Error('会话归档操作进行中');
      await this.change(s=>{
        const {id,history,changes,controls,tasks,resourceIndex}=team;
        (s.retiredLedgers??=[]).push({id,...(resourceIndex&&{resourceIndex}),...(history&&{history}),...(changes&&{changes}),...(controls&&{controls}),...(tasks&&{tasks})});
        s.teams=s.teams.filter(t=>t.id!==teamId);s.events.push({id:randomUUID(),time:Date.now(),teamId,sessionId:team.anchor,kind:'dissolve',text:'解除团队关系'});});
    });
    await this.flushRetractions();
  }
  reviewNotices(target:string){
    return new Map(this.state.messages.filter(m=>m.target===target && m.system && m.kind==='notice').map(m=>[m.id,m]));
  }
  currentInput(team:Team,message:Message){return message.epoch===team.epoch&&sameBinding(team,message);}
  memberInput(id:string){return this.state.messages.find(m=>m.id===id);}
  async setSeatRun(id:string,run:SeatRun,issue?:RunIssue,observed:RunIssue[]=[]){
    await this.serial(async()=>{
      const t=this.membership(id);
      if(!t||t.paused||t.epoch!==run.epoch||!t.members.some(m=>m.sessionId===id&&m.active!==false&&(!run.bindingId||run.bindingId===m.bindingId)))return;
      this.historicalBlocks.delete(id);
      await this.change(s=>{const team=s.teams.find(x=>x.id===t.id)!;const previous=team.runs?.[id];
        const current:SeatRun=structuredClone(run);
        if(previous?.epoch===run.epoch){
          if(previous.lastDelivery)current.lastDelivery=previous.lastDelivery;
          if(previous.openIssue && (previous.input===run.input || previous.openIssue.requests.some(key=>run.requests.includes(key))))current.openIssue=previous.openIssue;
        }
        (team.runs??={})[id]=current;
        this.refreshDelivery(s,team,id);
        for(const observation of observed){
          if(current.phase!=='delivered' && issue?.code===observation.code && issue.tool===observation.tool)continue;
          recordRunIssue(s,team,id,run.input,current.requests,observation,false);
        }
        if(issue && current.phase!=='delivered'){
          current.openIssue={input:run.input,requests:[...current.requests],issue};
          recordRunIssue(s,team,id,run.input,current.requests,issue);
        }
        if(!issue && current.phase==='completed' && current.openIssue)this.closeRunIssue(s,team,id,current);});
    });
  }
  private closeRunIssue(s:State,team:Team,id:string,run:SeatRun){
    const open=run.openIssue;
    if(!open)return;
    recordRunIssue(s,team,id,open.input,open.requests,{stage:'recovered',code:open.issue.code,detail:run.phase==='delivered'?'关联回复已进入请求者会话':'本轮已正常结束'});
    delete run.openIssue;
  }
  private refreshDelivery(s:State,team:Team,id:string,run=team.runs?.[id],record=true){
    if(!run||run.epoch!==team.epoch||!run.requests.length)return;
    const pending=new Set(run.requests);
    for(const m of s.messages){
      if(m.teamId!==team.id||m.epoch!==run.epoch||m.sender!==id||m.kind!=='reply'||m.native!=='admitted'||!m.replyTo||!pending.delete(m.replyTo))continue;
      run.lastDelivery={requestId:m.replyTo,replyId:m.id,recipient:m.target};
    }
    run.requests=[...pending];
    if(!pending.size){run.phase='delivered';delete run.error;delete run.reviewBlock;if(record)this.closeRunIssue(s,team,id,run);}
  }
  seatRun(id:string){
    const team=this.membership(id),run=team?.runs?.[id];
    if(!run||run.epoch!==team?.epoch)return undefined;
    const block=this.historicalBlocks.get(id);
    if(block?.epoch===run.epoch&&block.input===run.input&&run.phase==='awaiting-reply'){
      const display:SeatRun={...run,phase:'blocked',reviewBlock:block.failure};
      this.refreshDelivery(this.state,team!,id,display,false);
      return display;
    }
    return run;
  }
  reviewContext(caller:string){
    const team=this.membership(caller);
    if(!team||team.paused||!team.members.some(m=>m.sessionId===caller&&m.active!==false))return '';
    const requester=team.members.find(m=>m.sessionId===caller)!;
    if(!incidentSettings(requester,incidentSupervisor(team)).notifyOwn)return '';
    const pending=new Map<string,ReviewBlock>();
    for(const member of team.members){
      if(member.active===false)continue;
      const run=this.seatRun(member.sessionId);
      if(run?.phase==='blocked'&&run.reviewBlock)for(const id of run.requests)pending.set(id,run.reviewBlock);
    }
    if(!pending.size)return '';
    const rows=this.state.messages.filter(m=>pending.has(m.id)&&sameBinding(team,m)&&m.sender===caller&&m.teamId===team.id&&m.epoch===team.epoch&&!m.cancellation)
      .map(m=>({requestId:m.id,sequence:m.sequence,member:m.target,...pending.get(m.id)}));
    return rows.length?'\nTeam Desk status for your outgoing requests. These members ended their turn without returning a result after an execution or permission check failed. '+JSON.stringify(rows):'';
  }
  async memberIncidents(caller:string,member?:string,request?:string,before?:string){
    const team=this.membership(caller),seat=team?.members.find(m=>m.sessionId===caller && m.active!==false);
    if(!team || !seat)throw new CoordinationError('ROUTE_DENIED','Operation outside collaboration scope');
    if(!incidentSettings(seat,incidentSupervisor(team)).viewAll)this.authorize(caller,'read');
    const history=[...this.state.events];
    for(const ref of this.state.archives??[])if(ref.teamIds.includes(team.id)&&ref.events){
      history.push(...(await loadArchive(this.file,ref)).events??[]);
    }
    const current=this.membership(caller),active=current?.members.find(m=>m.sessionId===caller&&m.active!==false);
    if(!current||!active||current.id!==team.id||current.epoch!==team.epoch)throw new CoordinationError('ROUTE_DENIED','协作范围已变化');
    const {viewAll}=incidentSettings(active,incidentSupervisor(current));
    if(!viewAll)this.authorize(caller,'read');
    const visible=history.filter(e=>e.teamId===team.id && e.incident && e.incident.epoch===team.epoch
      && (e.incident.member===caller || viewAll)
      && (!member || e.incident.member===member) && (!request || e.incident.requests.includes(request))).sort((a,b)=>a.time-b.time);
    const end=before?visible.findIndex(e=>e.id===before):visible.length;
    if(end<0)throw new CoordinationError('INVALID_CURSOR','运行记录游标不属于本次查询');
    const slice=visible.slice(Math.max(0,end-30),end).reverse();
    return {events:slice.map(({id,time,text,incident})=>({id,time,text,...incident})),
      before:end>30?slice.at(-1)?.id:null};
  }
  roster(caller: string) {
    const team = this.membership(caller); if (!team||team.members.find(m=>m.sessionId===caller)?.active===false) throw new Error('Conversation has no active team');
    const scope = team.members.find(m => m.sessionId === caller)!;
    const replyable=new Map<string,string[]>();
    if(!team.paused&&!this.hostBusy(team.id)&&scope.operations.includes('send')){
      const used=new Set(this.state.messages.filter(m=>m.replyTo&&m.state!=='cancelled').map(m=>m.replyTo));
      for(const parent of this.state.messages){
        if(!sameBinding(team,parent)||parent.target!==caller||used.has(parent.id)||(!parent.allowReply&&!parent.routeReply))continue;
        if(replyAllowed(team,[parent],caller,parent.sender,{kind:'reply',replyTo:parent.id})){
          const ids=replyable.get(parent.sender)??[];ids.push(parent.id);replyable.set(parent.sender,ids);
        }
      }
    }
    return team.members.filter(m=>m.active!==false).map(m => ({replyableRequests:replyable.get(m.sessionId)??[],sessionId:m.sessionId, label:m.label, ...(m.slot ? {seat:m.slot} : {}), status:this.host.status(m.sessionId), assignment:this.seatRun(m.sessionId), canSend:!team.paused && !team.pending && scope.operations.includes('send') && scope.targets.includes(m.sessionId)}));
  }
  read(caller:string,after=0):Message[]{
    const team=this.authorize(caller,'read');return this.mail(team.id,caller,after);
  }
  private mail(teamId:string,caller:string,after:number):Message[]{
    if(!Number.isFinite(after)||after<0)throw Error('Invalid message cursor');
    return structuredClone(this.state.messages.filter(m=>m.teamId===teamId&&(m.sender===caller||m.target===caller)&&m.time>after).slice(0,100));
  }
  private canDeliver(message:Message):void {
    const team=this.team(message.teamId);
    if(message.cancellation||this.state.messages.find(m=>m.id===message.id)?.cancellation)throw Error('Message revoked');
    if(team.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');
    if(message.expiresAt!==undefined&&message.expiresAt<=Date.now())throw Error('Message expired');
    if(message.epoch!==team.epoch||!sameBinding(team,message))throw new CoordinationError('STALE_EPOCH','Collaboration configuration replaced');
    if(!team.members.some(m=>m.sessionId===message.target&&m.active!==false))throw new CoordinationError('RECIPIENT_UNAVAILABLE','Recipient outside collaboration scope');
    if(message.system)return;
    this.authorize(message.sender,'send');
    if(!routeAllowed(team,message.sender,message.target,message)&&!replyAllowed(team,this.state.messages.filter(m=>m.id!==message.id),message.sender,message.target,message))throw Error('Message outside collaboration scope');
  }
  private async checkMessageReference(team:Team,caller:string,target:string,options:MessageOptions):Promise<void> {
    const id=options.followUpTo??options.replyTo;
    if(!id)return;
    let parent=this.memberInput(id);
    if(!parent){
      const index=this.state.archivedKeys?.find(k=>k.id===id&&k.teamId===team.id&&k.epoch===team.epoch&&k.sender===target);
      const archive=index&&this.state.archives?.find(a=>a.id===index.archive&&a.teamIds.includes(team.id));
      if(archive)parent=(await loadArchive(this.file,archive)).messages.find(m=>m.id===id);
    }
    if(!parent||!sameBinding(team,parent)||parent.teamId!==team.id||parent.epoch!==team.epoch||parent.system||parent.sender!==target||parent.target!==caller||parent.state!=='accepted'||parent.cancellation||parent.native==='discarded'||!['request','reply'].includes(parent.kind??'request'))throw new CoordinationError('INVALID_REPLY_REFERENCE','Reference outside collaboration scope: copy the id of a received request or reply from this peer in the current team configuration.');
    // A new assignment always needs its own outbound request route. Only a real reply
    // may use the one-time reverse grant, checked by the ordinary routing code below.
    if(options.kind==='reply'&&parent.kind==='reply'&&!(team.members.find(m=>m.sessionId===target)?.targets.includes(caller)&&routeAllowed(team,caller,target,options))){
      throw new CoordinationError('INVALID_REPLY_REFERENCE','Reply reference outside collaboration scope: continuing a reply as a reply requires a bidirectional connection.');
    }
  }
  async routePreview(caller:string,target:string,raw:MessageOptions={}){
    const t=this.authorize(caller,'read');try{const options=eventOptions(t,raw);await this.checkMessageReference(t,caller,target,options);const allowed=!t.paused&&(!t.pending||options.kind==='reply'&&!this.hostBusy(t.id))&&(routeAllowed(t,caller,target,options)||replyAllowed(t,this.state.messages,caller,target,options));return {allowed,reason:t.paused?'paused':allowed?'allowed':'direction_or_conditions',options,epoch:t.epoch,...(!allowed&&!t.paused?{details:routeDenial(t,caller,target,options)}:{})};}catch(e){return {allowed:false,reason:String(e),epoch:t.epoch,details:undefined};}
  }
  async send(caller:string,target:string,text:string,key:string,raw:MessageOptions={}):Promise<Message>{return (await this.publish(caller,[target],text,key,raw))[0]!;}
  /** Freeze the recipient set and all receipts in one commit; transport lanes stay independent. */
  async publish(caller:string,targets:string[],text:string,key:string,raw:MessageOptions={}):Promise<Message[]>{
    const messages=await this.serial(async()=>{
      const team=this.authorize(caller,'send'),options=eventOptions(team,raw);string(text,'message',16000);string(key,'request key',200);
      if(!Array.isArray(targets)||!targets.length||targets.length>11||targets.some(x=>typeof x!=='string')||new Set(targets).size!==targets.length)throw Error('Invalid explicit recipient set');targets=[...targets].sort();
      let prior=this.state.messages.filter(m=>m.teamId===team.id&&(m.epoch===team.epoch||!m.epoch)&&m.sender===caller&&m.key===key);
      for(const id of new Set((this.state.archivedKeys??[]).filter(m=>m.teamId===team.id&&m.epoch===team.epoch&&m.sender===caller&&m.key===key).map(m=>m.archive))){const archive=this.state.archives?.find(a=>a.id===id);if(!archive)throw Error('Archive index unavailable');prior.push(...(await loadArchive(this.file,archive)).messages.filter(m=>m.key===key&&m.sender===caller&&m.teamId===team.id&&m.epoch===team.epoch));}
      prior=prior.filter(m=>sameBinding(team,m));
      if(prior.length){const fields=['kind','priority','code','delivery','wakeup','replyTo','followUpTo','allowReply','ttlMs','taskId','evidence','payload','eventVersion','dependsOn'];if(!isDeepStrictEqual(prior.map(m=>m.target).sort(),targets)||prior.some(m=>m.text!==text||(m.routeReply&&raw.allowReply===false)||!isDeepStrictEqual(normalizeOptions(Object.fromEntries(fields.filter(k=>(m as any)[k]!==undefined).map(k=>[k,k==='allowReply'&&m.routeReply?false:(m as any)[k]]))),options)))throw new CoordinationError('IDEMPOTENCY_CONFLICT','Request key already used for different content');return structuredClone(prior);}
      if(team.paused || (team.pending && (options.kind!=='reply'||this.hostBusy(team.id))))throw new CoordinationError('TEAM_PAUSED','Team dispatch is paused');
      for(const target of targets){
        if(!team.members.some(m=>m.sessionId===target&&m.active!==false)||caller===target)throw new CoordinationError('RECIPIENT_UNAVAILABLE','Recipient outside collaboration scope');
        await this.checkMessageReference(team,caller,target,options);
        if(!routeAllowed(team,caller,target,options)&&!replyAllowed(team,this.state.messages,caller,target,options)){const details=routeDenial(team,caller,target,options);throw new CoordinationError('ROUTE_DENIED','Message outside collaboration scope: '+(details?.hint??'No valid directed route or correlated reply grant.'),false,details?{...details}:{});}
        for(const id of options.dependsOn??[])if(!this.state.messages.some(m=>m.id===id&&sameBinding(team,m)&&m.epoch===team.epoch&&m.sender===caller&&m.target===target))throw new CoordinationError('CAUSAL_SCOPE','前置消息必须来自当前成员并发往同一接收方');
      }
      if(this.state.messages.filter(m=>!m.system&&m.teamId===team.id&&m.time>Date.now()-60000).length+targets.length>60)throw new CoordinationError('RATE_LIMIT','Team message rate limit reached',true);
      if(this.state.messages.length+targets.length>10000)throw new CoordinationError('QUEUE_FULL','Active message store is full; archive ended records before continuing',true);
      if(targets.some(target=>this.state.messages.filter(m=>m.target===target&&['queued','dispatching','uncertain'].includes(m.state)).length>=1000))throw new CoordinationError('RECIPIENT_BACKLOG','接收者积压已达 1000，请先恢复或处理待投递消息',true);
      const time=Math.max(Date.now(),(this.state.messages.at(-1)?.time??0)+1),result=targets.map((target,i):Message=>({...options,...(options.kind==='request'&&raw.allowReply===undefined&&team.coordination?.routes?.some(r=>r.from===caller&&r.to===target&&r.allowReply===true)?{allowReply:true,routeReply:true as const}:{}),publication:{key,targets},sequence:(this.state.sequence??0)+1+i,id:randomUUID(),key,teamId:team.id,...(team.epoch?{epoch:team.epoch}:{}),sender:caller,target,text,time:time+i,state:'queued',expiresAt:Date.now()+options.ttlMs}));
      await this.change(s=>s.messages.push(...result));return structuredClone(result);
    });for(const m of messages)if(m.state==='queued')this.schedule(m.target);return messages;
  }
  private causalStatus(m:Message):'ready'|'waiting'|'failed'{
    const deps=(m.dependsOn??[]).map(id=>this.state.messages.find(x=>x.id===id));
    if(deps.some(x=>!x||x.cancellation||x.state==='cancelled'||x.native==='discarded'||x.native!=='admitted'&&(x.expiresAt??Infinity)<=Date.now()))return 'failed';
    return deps.some(x=>x!.native!=='admitted')?'waiting':'ready';
  }
  /** Only snapshot updates use the global chain; each native recipient has its own lane. */
  private readonly openSyncBatches=new Set<string>();
  holdSyncBatch(actor:string,batch:string){
    const key=JSON.stringify([actor,batch]);this.openSyncBatches.add(key);
    return ()=>{this.openSyncBatches.delete(key);};
  }
  private pump(target:string):Promise<void>{
    const current=this.lanes.get(target);if(current)return current;
    const job=(async()=>{
      let batch=0;while(!this.closed){
        if(++batch%32===0)await new Promise<void>(resolve=>setImmediate(resolve));
        const next=await this.serial(async()=>{
          const candidates=this.state.messages.filter(m=>m.target===target&&m.state==='queued'&&!m.cancellation&&(m.retryAt??0)<=Date.now()&&!this.state.teams.find(t=>t.id===m.teamId)?.paused).sort((a,b)=>priorityScore(b)-priorityScore(a)||a.time-b.time);
          for(const m of candidates){
            // Passive file summaries wait in our durable queue while the recipient is idle.
            // Requests/replies and explicitly published notices keep their native delivery behavior.
            if(m.system&&m.syncKey?.startsWith(RESOURCE_DIGEST_PREFIX)&&(this.host.status(target)!=='running'||m.syncBatch&&this.openSyncBatches.has(m.syncBatch)))continue;
            const causal=this.causalStatus(m);if(causal==='waiting'&&(m.expiresAt??Infinity)>Date.now())continue;
            if(causal==='failed'){await this.change(s=>{const x=s.messages.find(x=>x.id===m.id)!;x.state='cancelled';x.error='CAUSAL_FAILED: 前置消息被撤回、丢弃或不可用';recordDeliveryIssue(s,x,'CAUSAL_FAILED');});continue;}
            try{this.canDeliver(m);}catch(error){await this.change(s=>{const x=s.messages.find(x=>x.id===m.id)!;x.state='cancelled';x.error=String(error);recordDeliveryIssue(s,x,'ROUTE_CHANGED');});continue;}
            const team=this.team(m.teamId),limit=budgetReason(team,m);if(limit&&team.budget?.mode==='pause'){await this.change(s=>{const t=s.teams.find(t=>t.id===team.id)!;t.paused=true;t.budget!.warning=limit;});return undefined;}
            const budget=team.budget;
            if(!m.system&&m.wakeup!==false&&budget?.mode==='pause'&&budget.id&&budget.wakeups!==undefined&&
              budget.usedWakeups+this.state.messages.filter(x=>x.wakeBudget===budget.id).length>=budget.wakeups)continue;
            await this.change(s=>{const t=s.teams.find(t=>t.id===team.id)!;if(limit&&t.budget)t.budget.warning=limit;const x=s.messages.find(x=>x.id===m.id)!;reserveBudget(t,x);x.state='dispatching';x.attempts=(x.attempts??0)+1;});return structuredClone(m);
          }
          return undefined;
        });
        if(!next)break;
        const timeout=AbortSignal.timeout(10000),signal=AbortSignal.any([this.abort.signal,timeout]);
        let state:'accepted'|'uncertain'='accepted',native:'queued'|'admitted'|undefined,error:string|undefined;
        try{
          native=(await Promise.race([this.host.deliver(next,signal,()=>{signal.throwIfAborted();this.canDeliver(next);}),new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Delivery interrupted; reconciliation required')),{once:true}))]))??'queued';
        }catch(e){state='uncertain';error=String(e);}
        if(this.closed)break;
        await this.serial(async()=>this.change(s=>{const x=s.messages.find(x=>x.id===next.id)!;if(x.native!=='admitted'&&x.native!=='discarded'){x.state=state;if(native){x.native=native;settleWake(s.teams.find(t=>t.id===x.teamId),x,true);}recordDeliveryRecovery(s,x);if(native==='admitted'&&x.kind==='reply'){const t=s.teams.find(t=>t.id===x.teamId);if(t)this.refreshDelivery(s,t,x.sender);}if(error){recordDeliveryIssue(s,x,'MESSAGE_UNCERTAIN');x.error=error;x.retryAt=Date.now()+Math.min(60000,1000*2**Math.min(x.attempts??1,6));}}}));
      }
    })().finally(()=>this.lanes.delete(target));
    this.lanes.set(target,job);return job;
  }
  /** Reconcile uncertain sends with native history before deciding whether a resend is safe. */
  async flushDeliveries():Promise<void>{
    if(this.closed)return;
    if(this.state.messages.some(m=>m.epoch&&m.native!=='admitted'&&m.native!=='discarded'&&!m.cancellation&&m.state!=='cancelled'&&(m.expiresAt??Infinity)<=Date.now()))await this.serial(()=>this.change(()=>{}));
    await this.flushRetractions();
    const pending=this.state.messages.filter(m=>m.epoch&&!m.cancellation&&(m.attempts??0)<5&&(m.retryAt??0)<=Date.now()&&(m.state==='uncertain'||m.state==='dispatching')&&!this.lanes.has(m.target)&&!this.state.teams.find(t=>t.id===m.teamId)?.paused);
    await Promise.allSettled(pending.map(async m=>{
      if(!this.host.probe)return;
      let timer:ReturnType<typeof setTimeout>|undefined;const result=await Promise.race([this.host.probe(m).catch(()=>'unknown' as const),new Promise<'unknown'>(r=>{timer=setTimeout(()=>r('unknown'),10000);})]).finally(()=>clearTimeout(timer));if(result==='unknown'){
        await this.serial(()=>this.change(s=>{
          const x=s.messages.find(x=>x.id===m.id);
          if(!x||x.cancellation||!['uncertain','dispatching'].includes(x.state)||x.native==='discarded')return;
          x.probeAttempts=(x.probeAttempts??0)+1;x.retryAt=Date.now()+Math.min(60000,1000*2**Math.min(x.probeAttempts+1,6));
        }));return;
      }
      await this.serial(async()=>this.change(s=>{const x=s.messages.find(x=>x.id===m.id);if(!x||x.cancellation||x.native==='discarded'||!['uncertain','dispatching'].includes(x.state))return;delete x.probeAttempts;settleWake(s.teams.find(t=>t.id===x.teamId),x,result!=='absent');if(result==='absent'){try{this.canDeliver(x);x.state='queued';delete x.error;}catch(e){x.state='cancelled';x.error=String(e);}}else{x.state='accepted';x.native=result;delete x.error;recordDeliveryRecovery(s,x);if(result==='admitted' && x.kind==='reply'){const t=s.teams.find(t=>t.id===x.teamId);if(t)this.refreshDelivery(s,t,x.sender);}}}));
    }));
    await Promise.allSettled([...new Set(this.state.messages.filter(m=>m.state==='queued').map(m=>m.target))].map(id=>this.pump(id)));
  }
  async reconcileMessage(teamId:string,id:string):Promise<void>{
    const message=this.state.messages.find(m=>m.teamId===teamId&&m.id===id);if(!message||message.state!=='uncertain'||!message.epoch||!this.host.probe)throw Error('此消息无法自动核对');
    if(message.cancellation){await this.settleCancellation(message);return;}
    const status=await this.host.probe(message);if(status==='unknown')throw Error('原生状态仍不确定，保留原记录，不重复投递');
    await this.serial(async()=>this.change(s=>{const m=s.messages.find(m=>m.id===id)!;if(m.state!=='uncertain'||m.cancellation||m.native==='discarded')return;delete m.probeAttempts;settleWake(s.teams.find(t=>t.id===teamId),m,status!=='absent');if(status==='absent'){m.state='queued';m.attempts=0;delete m.retryAt;}else{m.state='accepted';m.native=status;recordDeliveryRecovery(s,m);if(status==='admitted' && m.kind==='reply'){const t=s.teams.find(t=>t.id===m.teamId);if(t)this.refreshDelivery(s,t,m.sender);}}delete m.error;}));
    await this.pump(message.target);
  }
  async receipt(id:string,native:'admitted'|'discarded'):Promise<void>{
    if(this.closed||!this.state.messages.some(m=>m.id===id))return;
    await this.serial(async()=>this.change(s=>{const m=s.messages.find(m=>m.id===id)!;if(m.native==='discarded'||m.native==='admitted')return;settleWake(s.teams.find(t=>t.id===m.teamId),m,true);m.native=native;const scope=s.teams.find(t=>t.id===m.teamId);const current=scope&&sameBinding(scope,m)&&scope.epoch===m.epoch;if(current)recordDeliveryRecovery(s,m);if(native==='discarded'){m.state='cancelled';recordDeliveryIssue(s,m,'MESSAGE_DISCARDED',!!current);}if(native==='admitted'){m.state='accepted';const t=s.teams.find(x=>x.id===m.teamId);if(t&&current&&m.kind==='reply')this.refreshDelivery(s,t,m.sender);}}));
  }
  async acknowledge(caller:string,id:string,note=''):Promise<Message>{
    return this.serial(async()=>{const team=this.authorize(caller,'read'),message=this.state.messages.find(m=>m.id===id&&m.teamId===team.id&&m.target===caller);
      if(!message||!sameBinding(team,message)||message.epoch!==team.epoch||message.state!=='accepted')throw Error('Message cannot be acknowledged in this scope');
      if(typeof note!=='string'||note.length>2000)throw Error('Invalid acknowledgement');
      if(!message.ack)await this.change(s=>{s.messages.find(m=>m.id===id)!.ack={time:Date.now(),note};});
      return structuredClone(this.state.messages.find(m=>m.id===id)!);
    });
  }
  shared(caller:string,key?:string,options:SharedOptions={}):{values:SharedEntry[];defaults:Record<string,unknown>;changes:ChangeNotice[]}{
    const team=this.authorize(caller,'read'),ledger=bucket(this.state,team,options.projectId);return structuredClone({values:(ledger.shared??[]).filter(x=>(x.scope==='team'||x.scope===caller)&&(!key||x.key===key)).map(x=>key?x:{...x,value:JSON.stringify(x.value).length>800?{preview:JSON.stringify(x.value).slice(0,800),truncated:true}:x.value}),defaults:team.coordination?.defaults??{},changes:(ledger.changes??[]).slice(-100)});
  }
  /** Verified Git facts use non-waking native-sync notices; they never assign work. */
  async gitFact(fact:import('./git/types.ts').GitNotice):Promise<void>{
    await this.serial(async()=>{
      const t=this.state.teams.find(t=>t.id===fact.teamId);
      if(!t||t.epoch!==fact.epoch||!t.members.some(m=>m.sessionId===(fact.memberSessionId??fact.actor)&&m.active!==false)||!this.state.projects?.some(p=>p.id===fact.projectId&&p.teamIds.includes(t.id)))return;
      const id='git:'+fact.id;if(this.state.events.some(e=>e.id===id))return;
      await this.change(s=>{const team=s.teams.find(t=>t.id===fact.teamId)!;
        s.events.push({id,teamId:team.id,kind:'git-fact',text:JSON.stringify(fact),time:fact.time});
        notify(s,team,fact.actor,id,sequence(s),'Git '+fact.action+'：'+JSON.stringify(fact.payload)+'. Refresh the exact commit and baseline before modifying or integrating. This is a factual notice, not a task assignment.',fact.projectId);
      });
    });
  }
  /** Adapter-only native actor write. The verified root authorizes scope; the child remains the author. */
  async updateNativeShared(member:string,actor:string,key:string,value:unknown,expected:number,reason:string,kind:'value'|'decision',options:SharedOptions={}){
    return this.serial(async()=>{const team=this.authorize(member,'send');if(team.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');let result!:SharedRevision;
      await this.change(s=>{result=updateValue(s,s.teams.find(t=>t.id===team.id)!,actor,key,value,expected,reason,kind,false,options);this.event(s,team.id,'native-shared-update',JSON.stringify({memberSessionId:member,actorSessionId:actor,key,revision:result.revision}));});return structuredClone(result);
    });
  }
  async updateShared(caller:string,key:string,value:unknown,expected:number,reason:string,kind:'value'|'decision'='value',local=false,options:SharedOptions={}):Promise<SharedRevision>{
    return this.serial(async()=>{const team=this.authorize(caller,'send');if(team.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');let entry!:SharedRevision;await this.change(s=>{entry=updateValue(s,s.teams.find(t=>t.id===team.id)!,caller,key,value,expected,reason,kind,local,options);this.event(s,team.id,'shared-update',`${key} v${entry.revision}`);});return structuredClone(entry);});
  }
  variables(caller:string,projectId?:string){const t=this.authorize(caller,'read');return structuredClone(resolvedVariables(this.state,t,caller,projectId));}
  async updateBatch(caller:string,items:{key:string;value:unknown;expected:number;reason:string;kind?:'value'|'decision';local?:boolean}[],options:SharedOptions={}){
    return this.serial(async()=>{const t=this.authorize(caller,'send');if(t.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');if(!Array.isArray(items)||!items.length||items.length>20||new Set(items.map(i=>`${!!i.local}:${i.key}`)).size!==items.length)throw Error('Invalid atomic update batch');let result:SharedRevision[]=[];await this.change(s=>{result=items.map(i=>updateValue(s,s.teams.find(x=>x.id===t.id)!,caller,i.key,i.value,i.expected,i.reason,i.kind??'value',i.local===true,options));});return structuredClone(result);});
  }
  taskStatus(caller:string){return structuredClone(this.authorize(caller,'read').tasks??[]);}
  async taskRecord(caller:string,key:string){const t=this.authorize(caller,'read'),active=t.tasks?.find(x=>x.key===key);if(active)return structuredClone(active);const head=t.taskHeads?.find(x=>x.key===key),ref=this.state.archives?.find(x=>x.id===head?.archive);if(!ref)return null;return (await loadArchive(this.file,ref)).tasks?.find(g=>g.owner===t.id)?.entries.find(x=>x.key===key)??null;}

  async task(caller:string,key:string,action:string,expected:number,input:Parameters<typeof taskAction>[5]={}){
    return this.serial(async()=>{const t=this.authorize(caller,'send');if(t.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');const archived=await this.taskRecord(caller,key);let result!:ReturnType<typeof taskAction>;await this.change(s=>{const team=s.teams.find(x=>x.id===t.id)!;if(archived&&!team.tasks?.some(x=>x.key===key)){if((team.tasks?.length??0)>=200)throw new CoordinationError('TASK_CAPACITY','请归档已结束的任务',true);(team.tasks??=[]).push(archived);}result=taskAction(s.teams.find(x=>x.id===t.id)!,caller,key,action,expected,input);});return structuredClone(result);});
  }
  async configureBudget(teamId:string,input:unknown){await this.serial(()=>this.change(s=>{const t=s.teams.find(t=>t.id===teamId);if(!t)throw Error('Team not found');setBudget(t,input);}));}
  async userConstraint(teamId:string,key:string,value:unknown,expected:number,reason:string,options:SharedOptions={}){return this.serial(async()=>{this.team(teamId);let result!:SharedRevision;await this.change(s=>{const t=s.teams.find(t=>t.id===teamId)!;result=updateValue(s,t,t.anchor,key,value,expected,reason,'decision',false,options,true);});return structuredClone(result);});}
  async grantControl(teamId:string,from:string,to:string,expiresAt:number){return this.serial(async()=>{let result!:ReturnType<typeof grantControl>;await this.change(s=>{result=grantControl(s.teams.find(t=>t.id===teamId)??this.team(teamId),from,to,expiresAt);});return structuredClone(result);});}
  async revokeControl(teamId:string,grantId:string){await this.serial(()=>this.change(s=>{const t=s.teams.find(t=>t.id===teamId);if(!t)throw Error('Team not found');t.controlGrants=(t.controlGrants??[]).filter(g=>g.id!==grantId);}));}
  async interrupt(caller:string,target:string,grantId:string,key:string,reason:string){
    if(!this.host.interrupt)throw Error('Native interrupt unavailable');string(key,'request key',200);string(reason,'reason',2000);
    const record=await this.serial(async()=>{const t=this.authorize(caller,'send');const archived=t.controlKeys?.find(c=>c.from===caller&&c.key===key),ref=this.state.archives?.find(r=>r.id===archived?.archive);const prior=t.controls?.find(c=>c.from===caller&&c.key===key)??(ref?(await loadArchive(this.file,ref)).controls?.find(g=>g.owner===t.id)?.entries.find(c=>c.from===caller&&c.key===key):undefined);if(prior){if(prior.to!==target||prior.grantId!==grantId||prior.reason!==reason)throw new CoordinationError('IDEMPOTENCY_CONFLICT','控制请求键已被使用');return structuredClone(prior);}if((t.controls?.length??0)>=1000)throw new CoordinationError('CONTROL_CAPACITY','请归档已结束的控制记录',true);validGrant(t,caller,target,grantId);const item={id:randomUUID(),key,from:caller,to:target,grantId,reason,time:Date.now(),state:'requested' as const};await this.change(s=>{(s.teams.find(x=>x.id===t.id)!.controls??=[]).push(item);});return item;});
    if(record.state!=='requested')return record;
    // Consume once before the native call. A crash here is uncertain, never an automatic second interrupt.
    let mayRun=false;
    await this.serial(async()=>{const t=this.authorize(caller,'send');const item=t.controls?.find(x=>x.id===record.id);if(item?.state!=='requested')return;const g=validGrant(t,caller,target,grantId);await this.change(s=>{const tt=s.teams.find(x=>x.id===t.id)!;tt.controlGrants!.find(x=>x.id===g.id)!.used=record.id;tt.controls!.find(x=>x.id===record.id)!.state='uncertain';});mayRun=true;});
    if(!mayRun)return structuredClone(this.state.teams.flatMap(t=>t.controls??[]).find(c=>c.id===record.id)??record);
    let result:'accepted'|'idle'|'uncertain'='uncertain';try{const team=this.membership(caller),grant=team?.controlGrants?.find(g=>g.id===grantId);if(!team||team.paused||!grant||grant.expiresAt<=Date.now()||grant.epoch!==team.epoch)throw Error('Grant changed before control');this.host.interrupt(target);result='accepted';for(let i=0;i<40&&this.host.status(target)==='running';i++)await new Promise(r=>setTimeout(r,50));if(this.host.status(target)==='idle')result='idle';}catch{result='uncertain';}
    await this.serial(()=>this.change(s=>{const c=s.teams.flatMap(t=>t.controls??[]).find(c=>c.id===record.id);if(c)c.state=result;}));return {...record,state:result};
  }
  resourceBinding(tool:string){return this.state.resources?.some(r=>r.mode==='guarded'&&r.bindings.some(b=>b.tool===tool))??false;}
  resourceStatus(caller:string,actor=caller){this.authorize(caller,'read');return structuredClone((this.state.resources??[]).map(r=>({...r,leases:r.leases.map(l=>({...l,id:l.owner===actor?l.id:'held-by-peer'})),operations:r.operations.map(o=>({...o,...(o.leaseId?{leaseId:r.leases.some(l=>l.id===o.leaseId&&l.owner===actor)?o.leaseId:'held-by-peer'}:{})}))})));}
  async configureResource(raw:unknown,expected:number){return this.serial(async()=>{let result!:ReturnType<typeof configureResource>;await this.change(s=>{result=configureResource(s,raw,expected);});return structuredClone(result);});}
  async resourceLease(caller:string,id:string,action:string,input:Parameters<typeof leaseAction>[4]={},actor=caller){return this.serial(async()=>{const t=this.authorize(caller,'send');if(t.paused&&action!=='release')throw new CoordinationError('TEAM_PAUSED','Team communication is paused');let result!:ReturnType<typeof leaseAction>;await this.change(s=>{result=leaseAction(s,actor,id,action,input);});return structuredClone(result);});}
  async delegateResource(caller:string,actor:string,id:string,token:string,target:string,targetMember:string,ttlMs:number){return this.serial(async()=>{const t=this.authorize(caller,'send'),from=t.members.find(m=>m.sessionId===caller)!;if(t.paused)throw new CoordinationError('TEAM_PAUSED','Team communication is paused');if(!t.members.some(m=>m.sessionId===targetMember&&m.active!==false)||targetMember!==caller&&!from.targets.includes(targetMember))throw new CoordinationError('LEASE_DELEGATION_SCOPE','委派目标不在允许的团队方向中');let result!:ReturnType<typeof delegateLease>;await this.change(s=>{result=delegateLease(s,actor,id,token,{actor:target,member:targetMember,grantorMember:caller,teamId:t.id,epoch:t.epoch!},ttlMs);});return result;});}
  async revokeResource(caller:string,actor:string,id:string,token:string,delegationId:string){return this.serial(async()=>{this.authorize(caller,'read');let result!:ReturnType<typeof revokeDelegation>;await this.change(s=>{result=revokeDelegation(s,actor,id,token,delegationId);});return result;});}
  async returnResource(caller:string,actor:string,id:string,delegationId:string){return this.serial(async()=>{this.authorize(caller,'read');let result!:ReturnType<typeof returnDelegation>;await this.change(s=>{result=returnDelegation(s,actor,id,delegationId);});return result;});}
  async beginResource(owner:string,tool:string,callId:string,member=owner){return this.serial(async()=>{let result:ReturnType<typeof beginOperation>;const team=this.membership(member),active=team?.members.some(m=>m.sessionId===member&&m.active!==false);await this.change(s=>{result=beginOperation(s,owner,tool,callId,Date.now(),active?{member,teamId:team!.id,epoch:team!.epoch!}:undefined);});return structuredClone(result);});}
  async finishResource(id:string,operationId:string,success:boolean,detail=''){await this.serial(()=>this.change(s=>finishOperation(s,id,operationId,success,detail)));}
  async abandonResources(){await this.serial(()=>this.change(s=>{for(const r of s.resources??[])for(const op of r.operations){op.state='uncertain';op.error='插件停止时调用仍未结束，必须核对工具实例';}}));}
  async resolveResource(id:string,operationId:string,reason:string){await this.serial(()=>this.change(s=>resolveOperation(s,id,operationId,reason)));}
  observationOrigin(caller:string,resource:string):ObservationOrigin|undefined{
    const team=this.membership(caller);if(!team?.epoch||!team.members.some(m=>m.sessionId===caller&&m.active!==false))return undefined;
    const project=projectFor(this.state,team,resource);
    const working=resource===team.cwd?[]:this.host.workingOnFile?.(team,resource)??[];
    return {...(working.length?{workingMembers:working}:{}),id:randomUUID(),bindingId:team.members.find(m=>m.sessionId===caller)!.bindingId!,teamId:team.id,epoch:team.epoch,observedAt:Date.now(),...(project?{projectId:project.id}:{})};
  }
  private observationLedger(state:State,caller:string,origin:ObservationOrigin){
    const active=state.teams.find(t=>t.id===origin.teamId);
    if(active)return active;
    const retired=state.retiredLedgers?.find(t=>t.id===origin.teamId);
    const known=state.memberships?.some(p=>p.teamId===origin.teamId&&p.sessionId===caller&&
      (origin.bindingId?p.id===origin.bindingId:origin.observedAt>=(p.start??p.observed)&&origin.observedAt<=(p.end??Infinity)));
    if(retired&&known)return retired;
    throw new CoordinationError('OBSERVATION_SCOPE','找不到原始团队绑定，保留待恢复记录');
  }
  async observedChangeExists(caller:string,resource:string,version:string,origin?:ObservationOrigin):Promise<boolean>{
    const team=origin?this.state.teams.find(t=>t.id===origin.teamId)??this.state.retiredLedgers?.find(t=>t.id===origin.teamId):this.membership(caller);if(!team)return false;
    const matches=(c:ChangeNotice)=>c.author===caller&&c.resource===resource&&c.version===version&&c.origin==='native-file'&&(!origin||c.provenance?.teamId===origin.teamId&&c.provenance.epoch===origin.epoch&&(!origin.bindingId||origin.bindingId===c.provenance.bindingId)&&(origin.id?c.provenance?.id===origin.id:c.provenance?.observedAt===origin.observedAt));
    if([...(team.changes??[]),...(this.state.projects??[]).filter(p=>p.teamIds.includes(team.id)).flatMap(p=>p.changes)].some(matches))return true;
    const owners=new Set(origin?[origin.projectId??team.id]:[team.id,...(this.state.projects??[]).filter(p=>p.teamIds.includes(team.id)).map(p=>p.id)]);for(const ref of this.state.archives??[])if([...ref.teamIds,...ref.projectIds].some(id=>owners.has(id))&&(await loadArchive(this.file,ref)).changes.some(g=>owners.has(g.owner)&&g.entries.some(matches)))return true;
    return false;
  }
  async reportChange(caller:string,resource:string,version:string,summary:string,origin:'native-file'|'reported'='reported',details:ChangeDetails={},provenance?:ObservationOrigin):Promise<void>{
    string(resource,'resource',2000);const canonical=await canonicalResource(resource);if(canonical)details={...details,canonicalPath:canonical};
    await this.serial(async()=>{if(provenance&&origin!=='native-file')throw new CoordinationError('OBSERVATION_SCOPE','只有原生观察器能传入来源');const team=this.membership(caller);
      if(!provenance&&(!team||!team.members.some(m=>m.sessionId===caller&&m.active!==false)))throw new CoordinationError('OBSERVATION_SCOPE','修改来源不在当前活动团队中');if(origin==='reported')this.authorize(caller,'send');string(resource,'resource',2000);string(version,'version',300);string(summary,'summary',2000);
      const working=provenance?provenance.workingMembers:this.host.workingOnFile?.(team!,canonical??resource);
      await this.change(s=>appendChange(s,provenance?this.observationLedger(s,caller,provenance):s.teams.find(t=>t.id===team!.id)!,caller,resource,version,summary,origin,details,provenance,working));});
  }
  /** The native intent already durably records this exact tool invocation. Publish all of its file effects together. */
  async recordNativeBatch(items:readonly import('../adapter/sync-journal.ts').ObservedChange[]):Promise<void>{
    if(!items.length)return;
    const first=items[0]!,origin=first.origin;
    if(!origin?.id||items.some(x=>x.caller!==first.caller||!x.origin||x.origin.id!==origin.id||x.origin.teamId!==origin.teamId||x.origin.epoch!==origin.epoch||x.origin.actorSessionId!==origin.actorSessionId))throw Error('Inconsistent native batch identity');
    const prepared=await Promise.all(items.map(async x=>{
      const canonicalPath=await canonicalResource(x.resource);
      return {...x,details:{...x.details,...(canonicalPath?{canonicalPath}:{})}};
    }));
    await this.serial(async()=>{
      await this.change(s=>{
        const target=this.observationLedger(s,first.caller,origin);
        for(const x of prepared)appendChange(s,target,x.caller,x.resource,x.version,x.summary,'native-file',x.details,x.origin);
      });
    });
  }
  async wait(caller:string,after:number|undefined,timeout:number,signal?:AbortSignal):Promise<Message[]>{
    const teamId=this.authorize(caller,'wait').id;
    if(!Number.isFinite(timeout)||timeout<0||timeout>60000)throw Error('Wait must be between 0 and 60000 milliseconds');
    const sequence=this.state.sequence??0;
    const read=()=>{
      if(this.authorize(caller,'wait').id!==teamId)throw Error('Collaboration scope changed');
      if(after!==undefined)return this.mail(teamId,caller,after);
      return structuredClone(this.state.messages.filter(m=>m.teamId===teamId&&m.target===caller&&(m.sequence??0)>sequence&&!m.cancellation&&m.state!=='cancelled'&&m.native!=='discarded').slice(0,100));
    };
    if(read().length)return read();
    return new Promise((resolve,reject)=>{
      const finish=()=>{cleanup();try{resolve(read());}catch(e){reject(e);}},cancel=()=>{cleanup();reject(Error('Team wait cancelled'));};
      const unsubscribe=this.subscribe(()=>{try{if(read().length)finish();}catch(e){cleanup();reject(e);}}),timer=setTimeout(finish,timeout);
      const cleanup=()=>{clearTimeout(timer);unsubscribe();this.waits.delete(cancel);signal?.removeEventListener('abort',cancel);};
      this.waits.add(cancel);signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted||this.closed)cancel();
    });
  }
  private removeBinding(team:Team,id:string):void {
    team.members=team.members.filter(member=>member.sessionId!==id);
    team.order=team.order.filter(session=>session!==id);
    team.hidden=team.hidden.filter(session=>session!==id);
    for(const member of team.members)member.targets=member.targets.filter(target=>target!==id);
    const bindings=[...Object.values(team.bindingHistory??{})];
    if(team.configuration)bindings.push(team.configuration.bindings);
    for(const binding of bindings)for(const [slot,session] of Object.entries(binding))if(session===id)delete binding[slot];
    if(team.runs)delete team.runs[id];
    if(team.subscriptions)team.subscriptions=team.subscriptions.filter(sub=>sub.sessionId!==id);
    if(team.controlGrants)team.controlGrants=team.controlGrants.filter(grant=>grant.from!==id&&grant.to!==id);
    for(const task of team.tasks??[]){
      const released=task.owner===id;
      const cancelOffer=released||task.offer?.target===id||task.offer?.from===id;
      if(!released&&!cancelOffer)continue;
      if(released){delete task.owner;delete task.expiresAt;}
      delete task.offer;
      task.history.push({revision:++task.revision,time:Date.now(),actor:id,action:released?'release':'cancel-offer',note:'成员已解除绑定'});
      if(task.history.length>500)task.history.splice(0,task.history.length-500);
    }
    if(team.briefing?.state==='prepared'&&team.briefing.instructions.some(i=>i.sessionId===id)){
      team.briefing.state='uncertain';
      team.briefing.error='预设成员已经移出团队，请重新准备预设';
    }
  }

  async detach(teamId:string,id:string,bindingId?:string,fromManagement=false):Promise<void> {
    await this.serial(async()=>{
      const team=this.team(teamId);
      this.editable(team);
      if(this.archiving.has(team.anchor))throw Error('会话归档操作进行中');
      if(bindingId!==undefined?team.members.find(m=>m.sessionId===id)?.bindingId!==bindingId:fromManagement&&this.state.memberships?.some(p=>p.teamId===teamId&&p.sessionId===id&&p.end!==undefined))throw Error('成员绑定已更改，请刷新后重试');
      if(team.anchor===id)throw Error('此操作仅适用于团队成员');
      if(!team.members.some(member=>member.sessionId===id))throw Error('Member not found');
      await this.change(s=>this.removeBinding(s.teams.find(t=>t.id===teamId)!,id));
    });
    await this.flushRetractions();
  }
  async settle(target:string):Promise<void>{await this.pump(target);}
  async activateResourceDigests(target:string):Promise<void>{
    if(this.closed||this.host.status(target)!=='running'||!this.state.messages.some(m=>m.target===target&&m.state==='queued'&&m.system&&m.syncKey?.startsWith(RESOURCE_DIGEST_PREFIX)&&!m.cancellation))return;
    await this.serial(()=>this.change(s=>{for(const m of s.messages)if(m.target===target&&m.state==='queued'&&m.system&&m.syncKey?.startsWith(RESOURCE_DIGEST_PREFIX)&&!m.cancellation)m.retryAt=Date.now();}));
    await this.pump(target);
  }
  private schedule(target:string):void {
    if(this.closed)return;
    queueMicrotask(()=>{if(!this.closed)void this.pump(target).catch(e=>{this.lastIssue=String(e);});});
  }
  async query(caller:string,options:MessageQuery={}):Promise<MessagePage>{
    const t=this.authorize(caller,'read');validateQuery(options);const data=[...this.state.messages];
    if(options.includeArchive)for(const ref of this.state.archives??[])if(ref.teamIds.includes(t.id))data.push(...(await loadArchive(this.file,ref)).messages);
    return messagePage(data,t.id,caller,options);
  }
  async waitFor(caller:string,timeout:number,options:MessageQuery={},signal?:AbortSignal):Promise<WaitResult>{
    validateQuery(options);if(!Number.isFinite(timeout)||timeout<0||timeout>60000)throw new CoordinationError('INVALID_TIMEOUT','等待范围为 0–60000 毫秒');
    const team=this.authorize(caller,'wait'),teamId=team.id,epoch=team.epoch;
    const request=options.requestId?this.state.messages.find(m=>m.id===options.requestId&&m.teamId===teamId&&m.sender===caller&&(m.kind??'request')==='request'&&m.epoch===epoch&&sameBinding(team,m)):undefined;
    if(options.requestId&&!request)throw new CoordinationError('REQUEST_SCOPE','只能等待自己在当前协作批次中发布的请求');
    const q:MessageQuery={...(Object.keys(options).length===0?{cursor:this.state.sequence??0,direction:'incoming' as const}:{}),...options,...(epoch?{epoch}:{}),includeArchive:false};
    const failedReply=()=>request&&this.state.messages.findLast(m=>m.epoch===epoch&&m.teamId===teamId&&m.replyTo===request.id&&m.kind==='reply'&&m.target===caller&&(m.state==='cancelled'||m.native==='discarded'||m.cancellation));
    const page=()=>messagePage(request?this.state.messages.filter(m=>m.state==='accepted'&&!m.cancellation&&m.native!=='discarded'):this.state.messages,teamId,caller,q);
    const terminalIssue=()=>{
      if(!request)return;
      const run=this.seatRun(request.target);
      if(!run?.requests.includes(request.id)||run.openIssue?.issue.stage==='retrying')return;
      if(run.phase==='interrupted'||run.phase==='stopped'||run.openIssue?.issue.stage==='attention'&&run.phase==='awaiting-reply')
        return {...(run.openIssue?.issue??{stage:'stopped' as const,code:run.error??'TURN_STOPPED'}),member:request.target,requestId:request.id};
    };
    const blocker=()=>{
      const run=request&&this.seatRun(request.target);
      if(request&&run?.phase==='blocked'&&run.requests.includes(request.id)&&run.reviewBlock){
        return {...run.reviewBlock,requestId:request.id,member:request.target,...(request.sequence!==undefined?{sequence:request.sequence}:{})};
      }
    };
    const result=(reason:WaitReason):WaitResult=>{
      const block=reason==='blocked'?blocker():undefined;
      const failed=reason==='discarded'?failedReply():undefined;
      const issue=reason==='interrupted'?terminalIssue():failed&&request?{stage:'attention' as const,code:failed.deliveryIssue??'MESSAGE_DISCARDED',requestId:request.id,member:request.target}:undefined;
      return {...page(),reason,...(block?{block}:{}),...(issue?{issue}:{})};
    };
    const check=():WaitReason|undefined=>{
      if(signal?.aborted||this.closed)return 'cancelled';
      const current=this.membership(caller);if(!current||current.id!==teamId)return 'ended';
      if((current.pending&&!request)||current.epoch!==epoch||!current.members.some(m=>m.sessionId===caller&&m.active!==false&&m.operations.includes('wait')))return 'scope_changed';
      if(request&&!sameBinding(current,request))return 'scope_changed';
      if(page().messages.length)return 'matched';
      if(failedReply()&&!this.state.messages.some(m=>m.replyTo===request?.id&&m.kind==='reply'&&m.state!=='cancelled'&&m.native!=='discarded'&&!m.cancellation))return 'discarded';
      if(terminalIssue())return 'interrupted';
      if(current.paused)return 'paused';
      if(request){const m=this.state.messages.find(m=>m.id===request.id);if(!m)return 'expired';if(m.cancellation||m.native==='discarded'||m.state==='cancelled')return 'discarded';if((m.expiresAt??Infinity)<=Date.now())return 'expired';if(m.state==='uncertain'&&Math.max(m.attempts??0,m.probeAttempts??0)>=5)return 'unavailable';}
      if(blocker())return 'blocked';
      return undefined;
    };
    const early=check();if(early)return result(early);
    const release=request?this.dependencies.enter(caller,request.target):()=>{};if(!release)return result('cycle');
    return new Promise(resolve=>{
      let done=false;let timer:ReturnType<typeof setTimeout>|undefined;let unsubscribe=()=>{};
      const finish=(reason:WaitReason)=>{if(done)return;done=true;clearTimeout(timer);unsubscribe();release();this.waits.delete(cancel);signal?.removeEventListener('abort',cancel);resolve(result(reason));};
      const cancel=()=>finish('cancelled');this.waits.add(cancel);signal?.addEventListener('abort',cancel,{once:true});
      unsubscribe=this.subscribe(()=>{const reason=check();if(reason)finish(reason);});
      const ttl=request?.expiresAt===undefined?timeout:Math.max(0,request.expiresAt-Date.now());
      timer=setTimeout(()=>finish(check()??'timeout'),Math.min(timeout,ttl));
      const reason=check();if(reason)finish(reason); // subscribe before re-check: no lost wakeup
    });
  }
  health(caller?:string){
    const team=caller?this.authorize(caller,'read'):undefined,messages=this.state.messages.filter(m=>!team||m.teamId===team.id&&(m.sender===caller||m.target===caller)),pending=messages.filter(m=>['queued','dispatching','uncertain'].includes(m.state));
    return {writer:'exclusive',pausedTeams:(team?[team]:this.state.teams).filter(t=>t.paused).length,queued:pending.filter(m=>m.state==='queued').length,uncertain:pending.filter(m=>m.state==='uncertain').length,oldestWaitMs:pending.length?Math.max(0,Date.now()-Math.min(...pending.map(m=>m.time))):0,archiveCount:this.state.archives?.filter(a=>!team||a.teamIds.includes(team.id)||a.projectIds.some(id=>this.state.projects?.some(p=>p.id===id&&p.teamIds.includes(team.id)))).length??0,resourceUncertain:(this.state.resources??[]).flatMap(r=>r.operations).filter(o=>o.state==='uncertain'&&(!team||o.owner===caller)).length,recipients:[...new Set(pending.map(m=>m.target))].map(target=>({target,pending:pending.filter(m=>m.target===target).length,causalWaiting:pending.filter(m=>m.target===target&&this.causalStatus(m)==='waiting').length,status:this.host.status(target),paused:this.membership(target)?.paused??true})),hostPending:(this.state.hostOperations??[]).filter(o=>['prepared','uncertain'].includes(o.state)&&(!team||o.teamId===team.id)),lastIssue:caller?(this.lastIssue?'存在同步缺口，请用户在协作记录中核对':null):this.lastIssue||null};
  }
  async checkpoint(caller:string,options:{messageCursor?:number;changeCursor?:number;cursor?:number;epoch?:string;projectId?:string}={}){
    const t=this.authorize(caller,'read'),epoch=t.epoch,sequence=this.state.sequence??0,revision=this.state.revision;
    const shared=this.shared(caller,undefined,options);
    const [messages,changes]=await Promise.all([this.query(caller,{direction:'incoming',cursor:options.messageCursor??options.cursor??0,includeArchive:true}),this.changes(caller,options.changeCursor??0,options)]);
    if(this.membership(caller)?.id!==t.id||this.membership(caller)?.epoch!==epoch)throw new CoordinationError('STALE_EPOCH','检查点期间团队发生切换，请重新读取');
    return {shared,messages,changes,epoch,snapshot:{sequence,revision,throughSequence:this.state.sequence??0},resyncRequired:!!options.epoch&&options.epoch!==epoch,health:this.health(caller)};
  }
  syncFailure(error:unknown):void{this.lastIssue='SYNC_GAP: '+String(error);this.emit();}
  syncRecovered():void{if(this.lastIssue.startsWith('SYNC_GAP:')){this.lastIssue='';this.emit();}}
  async retention(days:number){if(!Number.isSafeInteger(days)||days<0||days>3650)throw new CoordinationError('INVALID_RETENTION','保留天数为 0–3650，0 停用自动归档');await this.serial(()=>this.change(s=>{s.retentionDays=days;}));}
  async maintain(){if(this.state.archiveIntents?.length)await this.serial(()=>this.finishArchiveIntents());const days=this.state.retentionDays??30;if(!days)return;const before=Date.now()-days*86400000;const ids=new Set([...this.state.teams.map(t=>t.id),...this.state.retiredLedgers?.map(t=>t.id)??[],...this.state.messages.map(m=>m.teamId),...this.state.events.map(e=>e.teamId),...(this.state.hostOperations??[]).map(o=>o.teamId)]);
    for(const id of ids)if(id)await this.archive(id,before);
    for(const project of this.state.projects??[])if(project.teamIds[0])await this.archive(project.teamIds[0],before,project.id);
  }
  async archive(teamId:string,before:number,projectId?:string):Promise<unknown>{
    if(!Number.isFinite(before)||before<0||before>Date.now())throw new CoordinationError('INVALID_CUTOFF','归档时间不能在未来');
    return this.serial(async()=>{if(!this.state.teams.some(t=>t.id===teamId)&&!(projectId&&this.state.projects?.some(p=>p.id===projectId&&p.teamIds.includes(teamId)))&&!historicalTeamIds(this.state).has(teamId))throw Error('Team not found');const prepared=await prepareArchive(this.file,this.state,teamId,before,projectId);if(!prepared)return {archived:0};await this.change(s=>commitArchive(s,prepared.ref,prepared.bundle));return prepared.ref;});
  }
  async archivedSyncIndex(archiveId:string,recipient:string,withFilenames=false){
    const team=this.authorize(recipient,'read');
    const ref=this.state.archives?.find(a=>a.id===archiveId&&a.teamIds.includes(team.id));
    if(!ref)throw new CoordinationError('MESSAGE_SCOPE','同步归档不属于当前收件会话');
    const bundle=await loadArchive(this.file,ref);
    return bundle.messages.filter(m=>m.teamId===team.id&&m.target===recipient).flatMap(m=>{
      const hint=syncDeliveryHint(m);if(!hint)return [];
      if(!withFilenames)delete hint.files;
      return [hint];
    });
  }
  async archiveContent(id:string){const ref=this.state.archives?.find(a=>a.id===id);if(!ref)throw Error('Archive not found');return loadArchive(this.file,ref);}
  private markInvalid(s:State):void{
    for(const m of s.messages){
      if(!m.epoch||m.native==='admitted'||m.native==='discarded'||m.cancellation||m.state==='cancelled')continue;
      const t=s.teams.find(t=>t.id===m.teamId);
      const valid=(m.expiresAt??Infinity)>Date.now()&&t&&t.epoch===m.epoch&&sameBinding(t,m)&&t.members.some(x=>x.sessionId===m.target&&x.active!==false)&&(m.system||routeAllowed(t,m.sender,m.target,m)||replyAllowed(t,s.messages.filter(x=>x.id!==m.id),m.sender,m.target,m));
      if(!valid){recordDeliveryIssue(s,m,(m.expiresAt??Infinity)<=Date.now()?'MESSAGE_EXPIRED':'ROUTE_CHANGED',this.loaded&&!this.closed);m.cancellation={reason:'协作范围、成员或批次已变化',time:Date.now(),status:m.state==='queued'?'absent':'pending'};if(m.state==='queued')m.state='cancelled';}
    }
  }
  private settleCancellation(message:Message):Promise<void>{
    const existing=this.retractions.get(message.id);if(existing)return existing;
    if(this.closed)return Promise.resolve();
    const job=this.resolveCancellation(message,false).finally(()=>this.retractions.delete(message.id));
    this.retractions.set(message.id,job);return job;
  }
  private async resolveCancellation(message:Message,shutdown:boolean):Promise<void>{
    let status:'removed'|'admitted'|'absent'|'unknown'='unknown';
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const timeout=new Promise<'unknown'>(resolve=>{timer=setTimeout(()=>resolve('unknown'),3000);timer.unref();});
      status=await Promise.race([(async()=>{if(await this.host.retract?.(message))return 'removed' as const;const probe=await this.host.probe?.(message);return probe==='admitted'?'admitted' as const:probe==='absent'?'absent' as const:'unknown' as const;})(),timeout]);
    }catch{status='unknown';}finally{clearTimeout(timer);}
    const commit=async()=>this.change(s=>{const m=s.messages.find(x=>x.id===message.id);if(!m?.cancellation)return;if(status!=='unknown')settleWake(s.teams.find(t=>t.id===m.teamId),m,status!=='absent');m.cancellation.status=m.native==='admitted'?'admitted':status;if(m.cancellation.status==='admitted'){m.state='accepted';m.native='admitted';}else if(status==='removed'||status==='absent'){m.state='cancelled';if(status==='removed')m.native='discarded';}else{m.state='uncertain';m.error='撤回结果待核对；不会重新派发';}});
    if(shutdown)await commit();else await this.serial(commit);
  }
  async cancelMessage(teamId:string,id:string,reason='用户撤回'):Promise<void>{
    string(reason,'撤回原因',2000);
    await this.serial(async()=>{const m=this.state.messages.find(m=>m.teamId===teamId&&m.id===id);if(!m||!m.epoch||m.native==='admitted')throw new CoordinationError('ALREADY_ADMITTED','消息不存在或已进入原生上下文，无法撤回');await this.change(s=>{const m=s.messages.find(m=>m.id===id)!;m.cancellation={reason,time:Date.now(),status:m.state==='queued'?'absent':'pending'};if(m.state==='queued')m.state='cancelled';});});
    await this.flushRetractions();
  }
  /** Explicit upgrade maintenance: retract only verified unread legacy file notices. */
  async compactResourceNotices(teamId:string){
    const team=this.team(teamId);this.editable(team);
    const candidates=this.state.messages.filter(m=>m.teamId===teamId&&m.epoch===team.epoch&&m.system&&m.syncKey?.startsWith('resource:')&&m.native!=='admitted'&&(!m.cancellation&&(m.state==='queued'||m.state==='accepted'&&m.native==='queued')||m.state==='cancelled'&&!m.syncReplacement&&m.cancellation?.reason==='插件停止，旧注入不自动恢复'&&['removed','absent'].includes(m.cancellation.status))).map(m=>structuredClone(m));
    const compacted:Message[]=[],eligible:Message[]=[],kept:string[]=[];
    for(const m of candidates){
      const status=m.state==='queued'||m.state==='cancelled'?'absent':await this.host.probe?.(m)??'unknown';
      if(status==='admitted'){await this.receipt(m.id,'admitted');kept.push(m.id);continue;}
      if(status!=='queued'&&status!=='absent'){kept.push(m.id);continue;}
      eligible.push(m);
    }
    // Persist the replacement first, so a crash cannot remove the last unread summary.
    if(eligible.length)await this.serial(()=>this.change(s=>{
      const current=s.teams.find(t=>t.id===teamId)!;if(current.epoch!==team.epoch)throw Error('Team configuration changed while compacting notices');
      const groups=new Map<string,{target:string;projectId?:string;rows:Message[]}>();
      for(const m of eligible){const projectId=s.projects?.find(p=>m.syncKey?.startsWith(`resource:${p.id}:`))?.id,key=JSON.stringify([m.sender,m.target,projectId,legacySyncReference(m.text).record??m.id]);let group=groups.get(key);if(!group){group={target:m.target,...(projectId?{projectId}:{}),rows:[]};groups.set(key,group);}group.rows.push(m);}
      for(const {target,projectId,rows} of groups.values()){
        if(!current.members.some(m=>m.sessionId===target&&m.active!==false&&m.operations.includes('read')))continue;
        const last=rows.at(-1)!;
        const ids=new Set(rows.map(m=>m.id)),originals=s.messages.filter(m=>ids.has(m.id));
        const replacement=originals.find(m=>m.syncReplacement)?.syncReplacement??enqueueResourceDigest(s,current,last.sender,target,Math.min(...rows.map(m=>m.syncFrom??m.sequence??0)),Math.max(...rows.map(m=>m.syncTo??m.sequence??0)),projectId,rows.flatMap(m=>{const ref=legacySyncReference(m.text);return ref.record?[ref.record]:[];}));
        for(const original of originals)original.syncReplacement=replacement;
      }
    }));
    for(const m of eligible){
      if(m.state==='cancelled'){compacted.push(m);continue;}
      try{await this.cancelMessage(teamId,m.id,'合并未读文件变更通知；完整变更记录保留');}catch(e){if(e instanceof CoordinationError&&e.code==='ALREADY_ADMITTED'){kept.push(m.id);continue;}throw e;}
      const fresh=this.state.messages.find(x=>x.id===m.id)!;
      if(fresh.cancellation?.status==='removed'||fresh.cancellation?.status==='absent')compacted.push(m);else kept.push(m.id);
    }
    return {compacted:compacted.map(m=>m.id),preserved:kept,originalMessagesAndChangeRecordsRetained:true};
  }
  async synchronization(caller:string,messageId:string,cursor=0,limit=25):Promise<SyncDetail>{
    const team=this.authorize(caller,'read');if(!Number.isSafeInteger(cursor)||cursor<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Invalid synchronization page');
    let message=this.state.messages.find(m=>m.id===messageId&&m.teamId===team.id&&m.target===caller&&m.system);
    const archives=new Map<string,Awaited<ReturnType<typeof loadArchive>>>();
    if(!message)for(const ref of this.state.archives??[]){if(!ref.teamIds.includes(team.id))continue;const data=await loadArchive(this.file,ref);archives.set(ref.id,data);message=data.messages.find(m=>m.id===messageId&&m.teamId===team.id&&m.target===caller&&m.system);if(message)break;}
    if(!message)throw new CoordinationError('MESSAGE_SCOPE','同步消息不属于当前收件会话');
    const legacy=legacySyncReference(message.text),summary=message.syncSummary,projectId=summary?.scope.projectId??legacy.projectId;
    const ledger=bucket(this.state,team,projectId);
    if(message.syncKey?.startsWith('value:')&&legacy.record&&legacy.key){let shared=ledger.history?.find(h=>h.id===legacy.record&&h.key===legacy.key&&h.revision===legacy.revision);if(!shared)for(const ref of this.state.archives??[]){if(projectId?!ref.projectIds.includes(projectId):!ref.teamIds.includes(team.id))continue;const data=archives.get(ref.id)??await loadArchive(this.file,ref);shared=data.history.find(b=>b.owner===(projectId??team.id))?.entries.find(h=>h.id===legacy.record&&h.key===legacy.key&&h.revision===legacy.revision);if(shared)break;}return{kind:'shared',messageId:message.id,sender:message.sender,target:message.target,time:message.time,text:message.text,...(shared?{shared:structuredClone(shared)}:{}),items:[],missing:shared?0:1,total:1,cursor:1,hasMore:false};}
    const ids=summary?.recordIds??(legacy.record?[legacy.record]:[]),wanted=ids.slice(cursor,cursor+limit),found=new Map((ledger.changes??[]).filter(c=>wanted.includes(c.id)).map(c=>[c.id,c]));
    for(const ref of this.state.archives??[]){if(found.size===wanted.length)break;if(projectId?!ref.projectIds.includes(projectId):!ref.teamIds.includes(team.id))continue;let data=archives.get(ref.id);if(!data){data=await loadArchive(this.file,ref);archives.set(ref.id,data);}for(const b of data.changes)if(b.owner===(projectId??team.id))for(const c of b.entries)if(wanted.includes(c.id))found.set(c.id,c);}
    const items=wanted.flatMap(id=>found.has(id)?[structuredClone(found.get(id)!)]:[]);
    return {kind:summary||legacy.record?'resources':message.syncKey?.startsWith(RESOURCE_DIGEST_PREFIX)?'legacy-summary':'other',messageId:message.id,sender:message.sender,target:message.target,time:message.time,text:message.text,...(summary?{summary:structuredClone(summary)}:{}),items,missing:wanted.length-items.length,total:ids.length,cursor:Math.min(ids.length,cursor+limit),hasMore:cursor+limit<ids.length};
  }
  async flushRetractions():Promise<void>{
    if(this.closed)return;
    await Promise.allSettled(this.state.messages.filter(m=>m.cancellation?.status==='pending'&&!this.lanes.has(m.target)).map(m=>this.settleCancellation(m)));
  }
  async projects(caller:string){const t=this.authorize(caller,'read');return structuredClone((this.state.projects??[]).filter(p=>p.teamIds.includes(t.id)).map(({id,name,root})=>({id,name,root})));}
  async registerProject(caller:string,name:string,root:string):Promise<SharedProject>{
    string(name,'project name',120);string(root,'project path',2000);const canonical=await realpath(root);if(!(await stat(canonical)).isDirectory())throw Error('项目路径必须是目录');
    return this.serial(async()=>{const t=this.authorize(caller,'send');let id=this.state.projects?.find(p=>p.root===canonical)?.id??randomUUID();await this.change(s=>{const p=s.projects?.find(p=>p.id===id);if(p){if(!p.teamIds.includes(t.id))p.teamIds.push(t.id);}else(s.projects??=[]).push({id,name,root:canonical,teamIds:[t.id],shared:[],history:[],changes:[]});});return structuredClone(this.state.projects!.find(p=>p.id===id)!);});
  }
  async subscribeResource(caller:string,resource:string,projectId?:string,enabled=true,expected?:{teamId:string;bindingId:string}):Promise<void>{
    string(resource,'resource',2000);await this.serial(async()=>{if(expected){const current=this.membership(caller);if(current?.id!==expected.teamId||!current.members.some(m=>m.sessionId===caller&&m.bindingId===expected.bindingId&&m.active!==false&&m.operations.includes('read')))return;}const t=this.authorize(caller,'read');if(projectId)bucket(this.state,t,projectId);if(!!t.subscriptions?.some(x=>x.sessionId===caller&&x.resource===resource&&x.projectId===projectId)===enabled)return;await this.change(s=>{const team=s.teams.find(x=>x.id===t.id)!;team.subscriptions=(team.subscriptions??[]).filter(x=>!(x.sessionId===caller&&x.resource===resource&&x.projectId===projectId));if(enabled)team.subscriptions.push({sessionId:caller,resource,...(projectId?{projectId}:{})});});});
  }
  async history(caller:string,key:string,options:SharedOptions={},after=0):Promise<{history:SharedRevision[];cursor:number;hasMore:boolean}>{
    if(!Number.isSafeInteger(after)||after<0)throw Error('Invalid cursor');const t=this.authorize(caller,'read'),ledger=bucket(this.state,t,options.projectId);let rows=[...(ledger.history??[])];
    for(const ref of this.state.archives??[])if((ref.maxSequence===undefined||ref.maxSequence>after)&&(options.projectId?ref.projectIds.includes(options.projectId):ref.teamIds.includes(t.id)))rows.push(...(await loadArchive(this.file,ref)).history.filter(x=>x.owner===(options.projectId??t.id)).flatMap(x=>x.entries));
    rows=rows.filter(h=>h.key===key&&(h.scope==='team'||h.scope===caller)&&h.sequence>after).sort((a,b)=>a.sequence-b.sequence);const page=rows.slice(0,100);return structuredClone({history:page,cursor:page.at(-1)?.sequence??after,hasMore:rows.length>100});
  }
  async changes(caller:string,after=0,options:SharedOptions={}):Promise<{changes:ChangeNotice[];cursor:number;hasMore:boolean}>{
    if(!Number.isSafeInteger(after)||after<0)throw Error('Invalid cursor');const t=this.authorize(caller,'read'),ledger=bucket(this.state,t,options.projectId);let rows=[...(ledger.changes??[])];
    for(const ref of this.state.archives??[])if((ref.maxSequence===undefined||ref.maxSequence>after)&&(options.projectId?ref.projectIds.includes(options.projectId):ref.teamIds.includes(t.id)))rows.push(...(await loadArchive(this.file,ref)).changes.filter(x=>x.owner===(options.projectId??t.id)).flatMap(x=>x.entries));
    rows=rows.filter(x=>(x.sequence??0)>after).sort((a,b)=>(a.sequence??0)-(b.sequence??0));const page=rows.slice(0,100);return structuredClone({changes:page,cursor:page.at(-1)?.sequence??after,hasMore:rows.length>100});
  }
  dispose(): Promise<void> {
    if(this.closing)return this.closing;
    this.closed = true;
    this.abort.abort();
    for (const cancel of this.waits) cancel();
    this.closing=Promise.allSettled([...this.lanes.values(),...this.retractions.values()]).then(()=>this.chain).then(async()=>{
      try{
        if(this.writer){await this.change(s=>{for(const op of s.hostOperations??[])if(op.state==='prepared'){op.state='uncertain';op.error='插件停止，核对原生结果后恢复';}for(const m of s.messages)if(m.epoch&&m.native!=='admitted'&&m.native!=='discarded'&&m.state!=='cancelled'&&!(m.system&&m.syncKey?.startsWith(RESOURCE_DIGEST_PREFIX)&&m.state==='queued')){m.cancellation={reason:'插件停止，旧注入不自动恢复',time:Date.now(),status:m.state==='queued'?'absent':'pending'};if(m.state==='queued')m.state='cancelled';}});
          for(const m of this.state.messages.filter(m=>m.cancellation?.status==='pending'))await this.resolveCancellation(m,true);}
        await this.host.stopOwned();
      }finally{this.listeners.clear();await this.writer?.close();this.writer=undefined;}
    });
    return this.closing;
  }
}
