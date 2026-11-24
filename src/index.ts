import {SessionId} from '@deepseek-ai/dsh-session';
import {installSessionHistory} from './adapter/session-timeline.ts';
import type {} from './adapter/member-lifecycle.ts';
import {isDeepStrictEqual} from 'node:util';
import {archivedProjectRows,teamExport} from './domain/management-state.ts';
import {chatDelta} from './domain/chat-state.ts';
import {CoordinationError} from './domain/errors.ts';
import {trackMemberRuns,recoverReviewStatus} from './adapter/member-recovery.ts';
import {teamRouting} from './domain/preset-library.ts';
import {internalMail} from './adapter/internal-mail.ts';
import {toolContract} from './adapter/contracts.ts';
import {refreshMissingTeamTitles,trackFallbackHeadings} from './adapter/titles.ts';
import {ConnectionsStore} from './domain/connections.ts';
import {NativeConnections} from './adapter/connections.ts';
import {connectionTools} from './adapter/connection-tools.ts';
import {guardResources} from './adapter/resources.ts';
import {SyncJournal} from './adapter/sync-journal.ts';
import {observeChanges} from './adapter/changes.ts';
import {recoverNativeIntent} from './adapter/native-recovery.ts';
import {GitEngine} from './domain/git/engine.ts';
import {nativeContext} from './adapter/native-context.ts';
import {nativeGitHost} from './adapter/git-host.ts';
import {gitAction,gitScope} from './adapter/git-actions.ts';
import {errorResult} from './domain/errors.ts';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {MessageQuery,SharedOptions,ChangeDetails} from './domain/types.ts';
import type {} from '@deepseek-ai/dsh-fs';
import {deliveryPrefix} from './adapter/delivery.ts';
import type {MessageOptions} from './domain/types.ts';
import type {} from '@deepseek-ai/dsh-system-prompt';
import {PreferencesStore} from './domain/preferences.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type {} from '@deepseek-ai/dsh-scope';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { TeamEngine } from './domain/engine.ts';
import { nativeHost } from './adapter/harness.ts';
import { record, string } from './domain/storage.ts';
import type { Layout, Operation } from './domain/types.ts';

export const name = 'team-desk';
export const inject = ['connection', 'agents', 'sessions', 'sessionController', 'tools', 'systemPrompt', 'sessionPersistence'];

function installTools(agent:Agent, engine:TeamEngine,mail:ReturnType<typeof internalMail>,git?:GitEngine,bridge?:NativeConnections):()=>void {
  const teamTool=(definition:Parameters<typeof toolContract>[0])=>mail.bind(toolContract(definition),agent);
  const dispose:(()=>void)[]=[];
  dispose.push(agent.ctx.systemPrompt.section({
    name:'team-desk:member-routing',
    order:agent.ctx.systemPrompt.getSectionOrder('TOOL_SUBAGENT')+1,
    text:({scope})=>scope===agent ? teamRouting(engine.membership(agent.id),agent.id) : '',
    interpolate:false,
  }));
  dispose.push(agent.ctx.systemPrompt.context({name:'team-desk:collaboration',order:126,required:true,interpolate:false,text:({scope})=>scope===agent ? engine.context(agent.id)+(bridge?.delegationContext(agent.id)??'')+engine.reviewContext(agent.id) : ''}));
  const caller=(id:string|undefined)=>{ if(id!==agent.id)throw new Error('Team tool caller mismatch'); return id; };
  const output={schema:{type:'string' as const},render:(_args:object,value:string)=>[{type:'text' as const,text:value}]};
  if(git)dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_git',description:'Use Git directly between Team Desk conversations. Native git commands remain available. First register the actual project with team_shared project_register, then pass its project_id. action: status, compare, lfs, partial, state, history, init, worktree, commit, commit-hunks, propose, review, integrate, reconcile. options is JSON. Mutations need a stable key and expectedHead; commit needs explicit paths/message; partial takes paths and returns a pinned diff snapshot and selectable hunk IDs; commit-hunks needs the same paths, snapshot, selected hunks, key, expectedHead, message. It preserves unselected working changes and unrelated index entries; no arbitrary patch input. Stale previews must be refreshed. Binary, new/deleted files, LFS and modes use whole-file/native Git. shared checkout needs shared:true. init only initializes the explicit project; it stages no files and makes no commit. For the first commit use expectedHead empty string. worktree uses the official native service and changes YOUR cwd. Proposals pin sourceSha/targetRef/expectedTarget. compare reads the saved targetSha to sourceSha with proposalId/expected, ignoring current HEAD; lfs inspects index pointers and local content without downloading. Reviews pin proposalId/expected/sourceSha/targetSha/outcome/note. Integration needs key/proposalId/expected/strategy(ff-only,merge,cherry-pick). Uncertain operations must be reconciled, never blindly repeated. Use team_reference for full contracts.',parameters:{action:{type:'string',required:true},project_id:{type:'string',required:true},options:{type:'string'}},output,async execute(args,exec){const id=caller(exec.agent?.id);return JSON.stringify(await gitAction(git,engine,id,id,args.project_id,args.action,args.options?JSON.parse(args.options):{},exec.signal));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_members',description:'Find existing team members, role labels, addresses and availability. assignment.phase distinguishes interruption, blocked review, pending reply and verified delivery. If blocked, reviewBlock identifies the tool and cause; requests lists outstanding request IDs. assignment.lastDelivery links the recipient and the last admitted reply to its original request. Set incidents=true to read recent run errors and recovery records, optionally filtered by member or request_id. Team-wide incident history follows the viewing permission configured for your seat. Other seats can query their own records if permitted to read. Pass the returned before cursor to read an older page. canSend describes an ordinary outbound connection. replyableRequests lists incoming request IDs with a one-time reply grant. Native list_agents lists a separate roster of subagents.',parameters:{incidents:{type:'boolean'},member:{type:'string'},request_id:{type:'string'},before:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id);return JSON.stringify(args.incidents?await engine.memberIncidents(id,args.member,args.request_id,args.before):engine.roster(id));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_send_message',description:'Return a result: set reply_to to the incoming message id (defaults to kind=reply). Assign more work after a peer responds: use options.kind=request and reply_to set to that incoming id. This creates a separate trackable request linked by followUpTo and requires permission to send requests. For a fresh assignment omit the reference. On a one-way route the grant permits one reply to the incoming request. Returns after durable publication (queued), without waiting for the target. Query by ID or wait for a correlated reply; do not resend just because delivery is pending. Send within directed and conditional team routes. notice/event default to silent next-step; request/reply to next-turn with wakeup. High/critical requests use next-step without cancelling tools. accepted means native queue only. Use the SAME request_key and options on retry. options is JSON: kind, priority(normal/high/critical), code, delivery(next-turn/next-step), wakeup, replyTo (alias of reply_to), followUpTo, allowReply, ttlMs, taskId, evidence, payload, eventVersion, dependsOn. Use taskId for a task label; code is an optional protocol event code (lowercase ASCII letters, digits, dot, dash, underscore; starts with a letter). Omit allowReply for ordinary requests, especially on bidirectional routes. allowReply=true requires an explicit route grant; it is not needed to receive replies over an existing reverse connection. On a route configured for one reply, a request automatically permits one correlated reply during its TTL. Set allowReply=false to opt out.',parameters:{target:{type:'string',required:true,description:'Exact sessionId from team_members or the received message sender, not a role label.'},message:{type:'string',required:true},request_key:{type:'string',required:true,description:'Stable unique key for this message (including replies); reuse it only to retry this exact message.'},reply_to:{type:'string',description:'ID of the incoming message from this target. With kind=request it links a new assignment; otherwise it addresses a reply. Omit for an unrelated request.'},options:{type:'string',description:'Optional JSON delivery metadata; omit for normal next-turn request.'}},output,
    async execute(args,exec){const opts:MessageOptions=args.options?JSON.parse(args.options):{};
      if(args.reply_to!==undefined){if(!record(opts)||opts.replyTo!==undefined&&opts.replyTo!==args.reply_to)throw new CoordinationError('INVALID_REPLY_REFERENCE','reply_to and options.replyTo must identify the same incoming message.');opts.replyTo=args.reply_to;}
      return JSON.stringify(await engine.send(caller(exec.agent?.id),args.target,args.message,args.request_key,opts));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_read_messages',description:'Read the next chronological page of at most 100 messages in the current team. Pass the last time as after to continue without skipping. Does not expose other members\' private chats.',parameters:{after:{type:'number'},options:{type:'string',description:'JSON: cursor, requestId, direction(incoming/outgoing/both), sender, code, epoch, limit(1-100), includeArchive. With options returns messages/cursor/hasMore; without options keeps the legacy array.'}},output,
    async execute(args,exec){return JSON.stringify(args.options?await engine.query(caller(exec.agent?.id),JSON.parse(args.options) as MessageQuery):engine.read(caller(exec.agent?.id),args.after??0));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_wait',description:'Optional single bounded wait for a specific reply, not a progress polling loop. Member request/reply messages already wake the recipient through the native inbox; preserve pending work and continue when a reply arrives. Does not wake other members or assign work.',parameters:{after:{type:'number'},timeout_ms:{type:'number',required:true,description:'One bounded wait in milliseconds, from 0 through 60000.'},options:{type:'string',description:'JSON query options; requestId waits for that reply or its blocked, interrupted or discarded outcome. Without options or after, wait for new incoming messages. An explicit after reads from that timestamp.'}},output,
    async execute(args,exec){return JSON.stringify(args.options?await engine.waitFor(caller(exec.agent?.id),args.timeout_ms,JSON.parse(args.options) as MessageQuery,exec.signal):await engine.wait(caller(exec.agent?.id),args.after,args.timeout_ms,exec.signal));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_ack_message',description:'Acknowledge that you processed a received message. This is your statement, not proof of task completion.',parameters:{id:{type:'string',required:true},note:{type:'string'}},output,
    async execute(args,exec){return JSON.stringify(await engine.acknowledge(caller(exec.agent?.id),args.id,args.note??''));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_shared',description:'Versioned shared data, decision history and resource changes. actions: read, set, batch, variables, history, changes, projects, project_register, subscribe, checkpoint, report_change. batch value is a JSON array of {key,value,expected,reason,kind?,local?}; commits all or none. variables returns effective value and protected user provenance. set uses expected revision (0 creates), reason and optional kind(decision/value), local. options JSON: projectId, evidence, cursor; report_change also beforeVersion,diff,operation. history requires key. project_register uses key as project name and resource as an existing directory; registering the same root explicitly joins its shared project. subscribe uses resource (exact native resourceId or *), options.projectId optional. checkpoint returns independent message/change cursors, snapshot sequence, scoped health and resyncRequired. options: cursor (legacy message cursor), messageCursor, changeCursor, epoch, projectId. Advance each returned cursor separately; continue while hasMore. No wakeup. Use team_reference for full API and preset examples.',parameters:{action:{type:'string',required:true},key:{type:'string'},value:{type:'string'},expected:{type:'number'},reason:{type:'string'},kind:{type:'string'},local:{type:'boolean'},resource:{type:'string'},version:{type:'string'},options:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id),options=args.options?JSON.parse(args.options):{};if(!record(options))throw Error('Invalid options');
      if(args.action==='batch')return JSON.stringify(await engine.updateBatch(id,JSON.parse(string(args.value,'batch',50000)),options as SharedOptions));
      if(args.action==='variables')return JSON.stringify(engine.variables(id,options.projectId as string|undefined));
      if(args.action==='read')return JSON.stringify(engine.shared(id,args.key,options as SharedOptions));
      if(args.action==='set')return JSON.stringify(await engine.updateShared(id,string(args.key,'key'),JSON.parse(string(args.value,'value',12000)),Number(args.expected),string(args.reason,'reason',2000),args.kind===undefined?'value':args.kind as 'value'|'decision',args.local===true,options as SharedOptions));
      if(args.action==='history')return JSON.stringify(await engine.history(id,string(args.key,'key'),options as SharedOptions,Number(options.cursor??0)));
      if(args.action==='changes')return JSON.stringify(await engine.changes(id,Number(options.cursor??0),options as SharedOptions));
      if(args.action==='projects')return JSON.stringify(await engine.projects(id));
      if(args.action==='project_register'){const p=await engine.registerProject(id,string(args.key,'project name'),string(args.resource,'directory'));return JSON.stringify({id:p.id,name:p.name,root:p.root});}
      if(args.action==='subscribe'){await engine.subscribeResource(id,string(args.resource,'resource'),options.projectId===undefined?undefined:string(options.projectId,'projectId'),options.enabled!==false);return JSON.stringify({subscribed:options.enabled!==false});}
      if(args.action==='checkpoint')return JSON.stringify(await engine.checkpoint(id,options));
      if(args.action==='report_change'){await engine.reportChange(id,string(args.resource,'resource',2000),string(args.version,'version',300),string(args.reason,'reason',2000),'reported',options as ChangeDetails);return JSON.stringify({recorded:true,origin:'reported'});}throw Error('Unknown shared action');}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_protocol',description:'Inspect declared events and resolved variable sources, preview directed routes, or atomically publish to an explicit recipient set. No implicit forwarding or interrupt. action: definitions, variables, preview, publish. options JSON accepts normal message metadata plus payload, eventVersion and dependsOn (IDs of earlier messages to the same recipient). targets is a JSON array. A failed recipient retries independently with the same request_key.',parameters:{action:{type:'string',required:true},target:{type:'string'},targets:{type:'string'},message:{type:'string'},request_key:{type:'string'},options:{type:'string'},project_id:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id),options=args.options?JSON.parse(args.options):{};if(args.action==='definitions')return JSON.stringify(engine.membership(id)?.coordination??{});if(args.action==='variables')return JSON.stringify(engine.variables(id,args.project_id));if(args.action==='preview')return JSON.stringify(await engine.routePreview(id,string(args.target,'target'),options));if(args.action==='publish')return JSON.stringify(await engine.publish(id,JSON.parse(string(args.targets,'targets')),string(args.message,'message',16000),string(args.request_key,'request key'),options));throw Error('Unknown protocol action');}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_task',description:'Optional advisory task ownership with compare-and-set revisions. action: list, get, claim, renew, release, offer, accept, cancel-offer. options JSON: ttlMs, target, offerId, note, evidence. The current owner retains ownership until the named recipient accepts. Use get with key to recover an archived task and its latest revision before reclaiming. This does not cancel native work or send a task automatically: communicate over an allowed team route.',parameters:{action:{type:'string',required:true},key:{type:'string'},expected:{type:'number'},options:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id);return JSON.stringify(args.action==='list'?engine.taskStatus(id):args.action==='get'?await engine.taskRecord(id,string(args.key,'key')):await engine.task(id,string(args.key,'key'),args.action,Number(args.expected),args.options?JSON.parse(args.options):{}));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_resource',description:'Coordinate configured stateful tool instances. action: status, acquire, renew, release, delegate, revoke-delegation, return-delegation. delegate options target,token,ttlMs; revoke options token,delegationId. No implicit inheritance. options JSON: mode(read/write), ttlMs(1000–3600000), token returned by acquire. Guarded bindings protect exact tool names in native direct and run_code calls; advisory mode is a promise only. A failed or interrupted operation remains uncertain until the user verifies it; expiry never proves an external operation stopped. RESOURCE_BUSY means no call ran. Read new state before writing.',parameters:{action:{type:'string',required:true},resource:{type:'string'},options:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id);return JSON.stringify(args.action==='status'?engine.resourceStatus(id):await (bridge?bridge.lease(id,id,args.action,string(args.resource,'resource'),args.options?JSON.parse(args.options):{}):engine.resourceLease(id,string(args.resource,'resource'),args.action,args.options?JSON.parse(args.options):{})));}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_control',description:'Request one native interrupt only under an explicit, unexpired, one-use user grant for this sender and target. Critical priority or a supervisor label grants no permission. accepted means native cancel was requested, idle means native status confirmed idle; neither proves an external process stopped. Same request_key is idempotent. action: grants or interrupt.',parameters:{action:{type:'string',required:true},target:{type:'string'},grant_id:{type:'string'},request_key:{type:'string'},reason:{type:'string'}},output,
    async execute(args,exec){const id=caller(exec.agent?.id);if(args.action==='grants')return JSON.stringify((engine.membership(id)?.controlGrants??[]).filter(g=>g.from===id));if(args.action==='interrupt')return JSON.stringify(await engine.interrupt(id,string(args.target,'target'),string(args.grant_id,'grant'),string(args.request_key,'request key'),string(args.reason,'reason',2000)));throw Error('Unknown control action');}}))));
  dispose.push(agent.ctx.tools.register(teamTool(defineTool({name:'team_reference',description:'Read the installed Team Desk architecture, API contracts, configuration and preset authoring guide. Call without section for the table of contents; section is a numbered chapter from the index, or all. This is documentation, not a command to create sessions.',parameters:{section:{type:'string'}},output,
    async execute(args,exec){caller(exec.agent?.id);return readReference(args.section);}}))));
  return ()=>{for(const fn of dispose.reverse())fn();};
}

export async function apply(ctx:Context):Promise<void>{
  const preferences=new PreferencesStore(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'team-desk','preferences.v1.json'));await preferences.load();
  const host=nativeHost(ctx);
  const engine=new TeamEngine(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'team-desk','state.v1.json'),host);
  try {await engine.load();} catch(error){await host.stopOwned();throw error;}
  installSessionHistory(ctx,engine);
  const releaseLifecycle=ctx.reflect.provide('teamDeskLifecycle',{withGroup:engine.withArchiveGroup.bind(engine)});
  ctx.effect(()=>()=>releaseLifecycle());
  let git:GitEngine|undefined,gitError='';
  const candidate=new GitEngine(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'team-desk','git.v1.json'),nativeGitHost(ctx),fact=>engine.gitFact(fact));
  try{await candidate.load();git=candidate;}catch(e){gitError=String(e);}
  const connections=new ConnectionsStore(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'team-desk','connections.v1.json'));
  let connectionsError='';try{await connections.load();}catch(e){connectionsError=String(e);}
  const bridge=new NativeConnections(ctx,engine,connections,git);
  const mail=internalMail(ctx,engine);
  const scopedTool=(tool:Parameters<typeof toolContract>[0])=>mail.bind(toolContract(tool));
  const stopConnectionTools=connectionsError?()=>{}:connectionTools(ctx,engine,bridge,scopedTool);
  const releaseMail=ctx.reflect.provide('teamDeskMail',mail.service);
  ctx.effect(()=>()=>releaseMail());
  const installed=new Map<Agent,()=>void>();
  const sync=()=>{
    engine.syncHostMembers();
    for(const agent of ctx.agents.list()){
      const member=engine.membership(agent.id)?.members.find(m=>m.sessionId===agent.id);
      if(member&&member.active!==false) {if(!installed.has(agent))installed.set(agent,installTools(agent,engine,mail,git,bridge));}
      else {installed.get(agent)?.();installed.delete(agent);}
    }
  };
  const unsubscribe=engine.subscribe(sync);
  const stopDigestStep=ctx.on('agent/pre-step',async({agent},next)=>{await engine.activateResourceDigests(agent.id);return next();});
  const journal=new SyncJournal(join(process.env.DSH_HOME??join(homedir(),'.dsh'),'team-desk','sync-pending'),engine,recoverNativeIntent(ctx));await journal.replay();
  let lastReplay=Date.now(),lastMaintenance=Date.now();
  let flushing=false;
  const pendingTimer=setInterval(()=>{if(flushing)return;flushing=true;if(Date.now()-lastReplay>30000){lastReplay=Date.now();void journal.replay().catch(e=>engine.syncFailure(e));}if(Date.now()-lastMaintenance>3600000){lastMaintenance=Date.now();void engine.maintain().catch(e=>engine.syncFailure(e));}void git?.flushNotices().catch(e=>engine.syncFailure(e));void engine.flushPending().then(()=>engine.flushDeliveries()).catch(e=>console.error('[team-desk] background coordination:',String(e))).finally(()=>{flushing=false;});},1000);
  ctx.effect(()=>()=>clearInterval(pendingTimer));
  ctx.on('agent/created',()=>{sync();return undefined;});
  ctx.on('agent/disposed',({agent})=>{installed.get(agent)?.();installed.delete(agent);});
  ctx.on('session/event',(_session,event)=>{if(event.type==='user/message'&&event.data.id.startsWith(deliveryPrefix))void engine.receipt(event.data.id.slice(deliveryPrefix.length),'admitted').catch(e=>console.error('[team-desk] receipt:',String(e)));});
  ctx.on('agent/inbox/discarded',({message})=>{if(message.id.startsWith(deliveryPrefix))void engine.receipt(message.id.slice(deliveryPrefix.length),'discarded').catch(e=>console.error('[team-desk] discard:',String(e)));});
  const stopRuns=trackMemberRuns(ctx,engine);
  await recoverReviewStatus(ctx,engine);
  const stopChanges=observeChanges(ctx,engine,journal,git);
  const stopResources=guardResources(ctx,engine);
  const stopNativeContext=nativeContext(ctx,engine,readReference,git,bridge,scopedTool);
  sync();
  ctx.effect(()=>async()=>{clearInterval(pendingTimer);stopRuns();stopDigestStep();stopConnectionTools();bridge.close();stopNativeContext();await stopResources();await stopChanges();await journal.drain();unsubscribe();for(const dispose of installed.values())dispose();installed.clear();await connections.dispose();await git?.dispose();await engine.dispose();},'team-desk: ownership, waits and scoped tools');
  ctx.connection.fetch.register({path:'/api/team-desk.native-state',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{const teamId=string(new URL(request.url).searchParams.get('teamId'),'teamId');return Response.json({...await bridge.view(teamId,request.signal),error:connectionsError});}catch(e){return Response.json(errorResult(e),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.seat-options',methods:['GET'],requestBody:'buffered',fetch:async()=>Response.json({
    modes:(await ctx.get('agentPresets')?.list()??[]).filter(p=>!p.broken).map(p=>({id:p.id,name:p.name??p.id})),
    permissions:ctx.get('permissionPresets')?.catalog().options.map(p=>({id:p.value,name:p.name}))??[],
  })});
  ctx.connection.fetch.register({path:'/api/team-desk.native-options',methods:['GET'],requestBody:'buffered',fetch:async()=>{try{return Response.json({catalog:await ctx.sessionController.modelCatalog(),presets:await ctx.get('agentPresets')?.list()??[]});}catch(e){return Response.json(errorResult(e),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.native-action',methods:['POST'],requestBody:'streaming',fetch:async request=>{try{if(connectionsError)throw Error(connectionsError);const text=await request.text();if(text.length>50000)throw Error('Request too large');const p=JSON.parse(text);if(!record(p)||!record(p.options??{}))throw Error('Invalid request');const caller=string(p.sessionId,'sessionId'),actor=typeof p.actorSessionId==='string'?p.actorSessionId:caller;const actorMember=await bridge.target(caller,actor);const options=record(p.options)?p.options:{};
   if(p.action==='session-option')return Response.json(await bridge.select(caller,actor,options));
   if(p.action==='lease')return Response.json(await bridge.lease(actorMember,actor,string(options.action,'lease action'),string(options.resource,'resource'),options));
   return Response.json(await bridge.action(actorMember,actor,string(p.action,'action'),options));
  }catch(e){return Response.json(errorResult(e),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.git',methods:['GET'],requestBody:'buffered',fetch:async request=>{const id=new URL(request.url).searchParams.get('teamId');return Response.json({state:git?.snapshot(id??undefined),error:gitError,worktreeAvailable:!!ctx.get('worktrees')});}});
  ctx.connection.fetch.register({path:'/api/team-desk.git-archive',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{if(!git)throw Error('Git collaboration is unavailable');const value=await git.exportArchive(string(new URL(request.url).searchParams.get('id'),'archive id'));return new Response(JSON.stringify(value,null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename=git-archive.json'}});}catch(e){return Response.json(errorResult(e),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.git-action',methods:['POST'],requestBody:'streaming',fetch:async request=>{
    try{if(!git)throw Error(gitError||'Git collaboration is unavailable');const raw=await request.text();if(raw.length>100000)throw Error('Request too large');const p=JSON.parse(raw);if(!record(p)||!record(p.options??{}))throw Error('Invalid Git request');const member=string(p.sessionId,'sessionId'),project=string(p.projectId,'projectId'),action=string(p.action,'action'),options=record(p.options)?p.options:{};
      if(action==='archive'){const scope=gitScope(engine,member,member,project,true);return Response.json(await git.archive(scope,Number(options.before)));}
      if(action==='resolve'){const scope=gitScope(engine,member,member,project,true);return Response.json(await git.resolve(scope,{operationId:string(options.operationId,'operationId'),expectedHead:options.expectedHead===''?'':string(options.expectedHead,'expectedHead'),reason:string(options.reason,'reason',2000)}));}
      if(action==='configure'){const scope=gitScope(engine,member,member,project,true);return Response.json(await git.configure(scope,Number(options.expected),options.requireReview===true));}
      return Response.json(await gitAction(git,engine,member,member,project,action,options,request.signal));
    }catch(e){return Response.json(errorResult(e),{status:400});}
  }});
  const titleHints=trackFallbackHeadings(ctx,engine);
  const instanceId=randomUUID();
  const chatViews=new Map<string,ReturnType<TeamEngine['conversationState']>>();
  ctx.connection.fetch.register({path:'/api/team-desk.state',methods:['GET'],requestBody:'buffered',fetch:async request=>{
    const q=new URL(request.url).searchParams,known=q.get('known'),chat=q.get('view')==='chat';
    const teamId=q.get('teamId'),page=q.get('page')??'graph',scoped=!chat&&teamId!==null;
    const wantsJournal=!chat&&(!scoped||page==='records'||page==='manage.preferences');
    const syncPending=wantsJournal?(await journal.inspect()).filter(row=>!scoped||page==='manage.preferences'||row.origin?.teamId===teamId):[];
    const {revision,statuses}=engine.liveStatus();
    const snapshotTag=instanceId+'/'+(chat?'chat/':scoped?JSON.stringify([teamId,page])+'/':'')+revision;
    const globalHealth=!chat&&(!scoped||page==='records'||page==='manage.preferences')?engine.health():undefined;
    const health=globalHealth&&scoped&&page==='records'?{
      recipients:globalHealth.recipients.filter(r=>engine.membership(r.target)?.id===teamId),
      lastIssue:syncPending.length?'本团队有待核对的同步记录':null
    }:globalHealth;
    const metadata={...(page==='manage.sessions'&&{legacyTeamIds:[...engine.historicalTeams()].filter(id=>!engine.membershipHistory().some(p=>p.teamId===id))}),archivedIds:ctx.get('workspaceRegistry')?.archivedSessionIds??[],titleHints:titleHints(),snapshotTag,revision,statuses,syncPending,preferences:preferences.snapshot(),hostProtocol:1,...(chat?{view:'chat'}:{view:'manage',health})};
    if(known===snapshotTag)return Response.json({...metadata,unchanged:true});
    if(chat){
      let current=chatViews.get(snapshotTag);
      const previous=known?chatViews.get(known):undefined;
      if(!current){
        current=engine.conversationState();chatViews.set(snapshotTag,current);
        if(chatViews.size>3)chatViews.delete(chatViews.keys().next().value!);
      }
      if(previous)return Response.json({...metadata,baseTag:known,delta:chatDelta(previous,current,isDeepStrictEqual)});
      return Response.json({...current,...metadata});
    }
    return Response.json({...(scoped?engine.managementState(teamId,page):engine.snapshot()),...metadata});
  }});
  ctx.connection.fetch.register({path:'/api/team-desk.records',methods:['GET'],requestBody:'buffered',fetch:async request=>{
    const q=new URL(request.url).searchParams;return Response.json(engine.recordsPage(q.get('teamId')??'',q.get('before')??'',q.get('incident')??''));
  }});
  ctx.connection.fetch.register({path:'/api/team-desk.sync-summary',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{const q=new URL(request.url).searchParams;const detail=await engine.synchronization(string(q.get('sessionId'),'sessionId'),string(q.get('messageId'),'messageId'),Number(q.get('cursor')??0),Number(q.get('limit')??25));
    return Response.json(q.get('view')==='files'?{messageId:detail.messageId,sender:detail.sender,target:detail.target,items:detail.items.map(({id,resource,operation})=>({id,resource,operation}))}:detail);}catch(error){return Response.json(errorResult(error),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.sync-record',methods:['GET'],requestBody:'buffered',fetch:async request=>{try{return new Response(await journal.exportRecord(string(new URL(request.url).searchParams.get('id'),'id')),{headers:{'content-type':'application/json','content-disposition':'attachment; filename=sync-record.json'}});}catch(error){return Response.json(errorResult(error),{status:400});}}});
  ctx.connection.fetch.register({path:'/api/team-desk.reference',methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(await readReference('all'),{headers:{'content-type':'text/markdown; charset=utf-8','content-disposition':'attachment; filename=team-desk-guide.md'}})});
  ctx.connection.fetch.register({path:'/api/team-desk.archive',methods:['GET'],requestBody:'buffered',fetch:async request=>{
    try{
      const q=new URL(request.url).searchParams;
      const id=string(q.get('id'),'archive id');
      if(q.get('view')==='sync-index')return Response.json(await engine.archivedSyncIndex(id,string(q.get('sessionId'),'sessionId'),q.get('files')==='names'));
      return Response.json(await engine.archiveContent(id));
    }catch(error){return Response.json(errorResult(error),{status:400});}
  }});
  ctx.connection.fetch.register({path:'/api/team-desk.export',methods:['GET'],requestBody:'buffered',fetch:async(request)=>{const id=new URL(request.url).searchParams.get('teamId');
    const all=engine.snapshot();
    if(id!==null&&!all.teams.some(t=>t.id===id))return Response.json({error:'Team not found'},{status:404});
    const snapshot=id?teamExport(all,id):all;
    const gitState=git?.snapshot(id??undefined);
    if(id&&gitState){gitState.checkouts=gitState.checkouts.filter(c=>c.teamId?c.teamId===id:gitState.repositories.some(r=>r.id===c.repositoryId&&r.teamIds.length===1&&r.teamIds[0]===id));gitState.repositories=gitState.repositories.map(r=>({...r,teamIds:[id]}));}
    const refs=id?(await bridge.view(id,request.signal)).records:connections.snapshot();return new Response(JSON.stringify({...snapshot,...(id&&{projectArchives:await archivedProjectRows(all,id,key=>engine.archiveContent(key))}),git:gitState,connections:refs,...(connectionsError?{connectionsError}:{})},null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename="team-desk.json"'}});}});
  ctx.connection.fetch.register({path:'/api/team-desk.action',methods:['POST'],requestBody:'streaming',fetch:async(request)=>{
    try {
      const raw=await request.text();if(raw.length>300000)throw new Error('Request too large');
      const data:unknown=JSON.parse(raw);if(!record(data))throw new Error('Invalid request');
      const action=string(data.action,'action');let result:unknown={ok:true};
      const id=()=>string(data.teamId,'teamId');
      const bindings=()=>{if(!record(data.bindings)||!Object.values(data.bindings).every(x=>typeof x==='string'))throw Error('Invalid member bindings');return data.bindings as Record<string,string>;};
      switch(action){
        case 'retention':await engine.retention(Number(data.days));break;
        case 'host-operation-resolve':await engine.resolveHostOperation(string(data.operationId,'operationId'),string(data.reason,'reason',2000),data.teamId===undefined?undefined:id());break;
        case 'budget':await engine.configureBudget(id(),data.budget);break;
        case 'control-grant':result=await engine.grantControl(id(),string(data.from,'from'),string(data.to,'to'),Number(data.expiresAt));break;
        case 'control-revoke':await engine.revokeControl(id(),string(data.grantId,'grantId'));break;
        case 'user-constraint':result=await engine.userConstraint(id(),string(data.key,'key'),data.value,Number(data.expected),string(data.reason,'reason',2000));break;
        case 'resource-configure':result=await engine.configureResource(data.resource,Number(data.expected));break;
        case 'resource-resolve':await engine.resolveResource(string(data.resourceId,'resourceId'),string(data.operationId,'operationId'),string(data.reason,'reason',2000));break;
        case 'route-preview':result=await engine.routePreview(string(data.sessionId,'sessionId'),string(data.target,'target'),(data.options??{}) as MessageOptions);break;
        case 'message-cancel':await engine.cancelMessage(id(),string(data.messageId,'messageId'));break;
        case 'sync-reconcile':await journal.replay(data.teamId===undefined?undefined:id());break;
        case 'archive':result=await engine.archive(id(),Number(data.before),data.projectId===undefined?undefined:string(data.projectId,'projectId'));break;
        case 'shared-history':result=await engine.history(string(data.sessionId,'sessionId'),string(data.key,'key'),data.projectId?{projectId:string(data.projectId,'projectId')}:{},Number(data.cursor??0));break;
        case 'resource-changes':result=await engine.changes(string(data.sessionId,'sessionId'),Number(data.cursor??0),data.projectId?{projectId:string(data.projectId,'projectId')}:{});break;
        case 'project-register':result=await engine.registerProject(string(data.sessionId,'sessionId'),string(data.name,'project name'),string(data.root,'root'));break;
        case 'message-query':result=await engine.query(string(data.sessionId,'sessionId'),(data.options??{}) as MessageQuery);break;
        case 'message-reconcile':await engine.reconcileMessage(id(),string(data.messageId,'messageId'));break;
        case 'library-save':result=await engine.savePreset(data.preset,data.expected===undefined?undefined:Number(data.expected));break;
        case 'library-delete':await engine.removePreset(string(data.presetId,'presetId'),Number(data.revision));break;
        case 'team-apply':result=await engine.applyPreset(id(),string(data.presetId,'presetId'),Number(data.revision),bindings(),data.applyLayout===true,data.requestId===undefined?undefined:string(data.requestId,'requestId',200),String(data.seatConsent??''));break;
        case 'team-configure':await engine.configure(id(),data.preset,bindings(),Number(data.expected),String(data.seatConsent??''));break;
        case 'refresh-missing-titles':result=await refreshMissingTeamTitles(ctx,engine,id());break;
        case 'compact-resource-notices':result=await engine.compactResourceNotices(id());break;
        case 'preset-display-name':await engine.renamePresetDisplay(id(),string(data.presetId,'presetId'),string(data.name,'name',120),typeof data.description==='string'?data.description:'',Number(data.expected));break;
        case 'team-start':await engine.startTeam(id());break;
        case 'switch-cancel':await engine.cancelPending(id());break;
        case 'member-prompt':if(typeof data.prompt!=='string')throw Error('Invalid prompt');await engine.memberPrompt(id(),string(data.sessionId,'sessionId'),data.prompt);break;
        case 'graph-arrange':await engine.graphArrange(id());break;
        case 'dock-restore':if(!Array.isArray(data.hidden)||!data.hidden.every(x=>typeof x==='string'))throw Error('Invalid hidden panes');await engine.restoreDock(id(),data.dock,data.hidden);break;
        case 'preferences':await preferences.update(data.change);break;
        case 'create':{
          const sessionId=string(data.sessionId,'sessionId');
          const nativeId=sessionId as Agent['id'];
          const header=ctx.sessions.get(nativeId)?.header??(await ctx.sessionPersistence.stat(nativeId))?.header;
          const cwd=string(header?.cwd,'working directory');
          let drop:Parameters<TeamEngine['create']>[4];
          if(data.drop!==undefined){
            if(!record(data.drop))throw Error('Invalid dock request');
            const item=data.drop,source=string(item.sessionId,'sessionId') as Agent['id'];
            const sourceHeader=ctx.sessions.get(source)?.header??(await ctx.sessionPersistence.stat(source))?.header;
            if(sourceHeader?.cwd!==cwd)throw Error('只能拖入同一工作目录中的会话。');
            drop={sessionId:source,label:string(item.label,'label',120),layout:item.layout as import('./domain/types.ts').Layout,zone:item.zone as import('./domain/docking.ts').DockZone,...(item.target!==undefined&&{target:string(item.target,'target')})};
          }
          result=await engine.create(sessionId,cwd,string(data.title,'title',120),data.autoLink!==false,drop);break;
        }
        case 'add':result={sessionId:await engine.add(id(),string(data.label,'label',120),data.existing===undefined?undefined:string(data.existing,'existing'),data.autoLink!==false,data.replaceTarget===undefined?undefined:string(data.replaceTarget,'target'),data.requestId===undefined?undefined:string(data.requestId,'requestId',160))};break;
        case 'connection':if(typeof data.enabled!=='boolean')throw new Error('Invalid flag');await engine.connection(id(),string(data.source,'source'),string(data.target,'target'),data.enabled);break;
        case 'operation':if(typeof data.enabled!=='boolean')throw new Error('Invalid flag');await engine.operation(id(),string(data.sessionId,'sessionId'),data.operation as Operation,data.enabled);break;
        case 'graph-position':await engine.graphPosition(id(),string(data.sessionId,'sessionId'),Number(data.x),Number(data.y));break;
        case 'reorder':await engine.reorder(id(),string(data.source,'source'),string(data.target,'target'),data.after===true);break;
        case 'dock':await engine.dock(id(),string(data.sessionId,'sessionId'),data.target===undefined?undefined:string(data.target,'target'),data.zone as import('./domain/docking.ts').DockZone|'hide',data.expected);break;
        case 'dock-resize':await engine.dockResize(id(),typeof data.path==='string'?data.path:'!',Number(data.ratio),data.rotateAt,data.expected);break;
        case 'pause':if(typeof data.paused!=='boolean')throw new Error('Invalid paused state');await engine.pause(id(),data.paused);break;
        case 'scope':if(!Array.isArray(data.targets)||!data.targets.every(x=>typeof x==='string')||!Array.isArray(data.operations)||!data.operations.every(x=>['send','read','wait'].includes(x)))throw new Error('Invalid scope');await engine.scope(id(),string(data.sessionId,'sessionId'),data.targets,data.operations as Operation[]);break;
        case 'layout':if(!Array.isArray(data.order)||!data.order.every(x=>typeof x==='string')||!Array.isArray(data.hidden)||!data.hidden.every(x=>typeof x==='string')||!Array.isArray(data.sizes)||!data.sizes.every(x=>typeof x==='number'))throw new Error('Invalid layout');await engine.layout(id(),data.layout as Layout,data.order,data.hidden,data.sizes);break;
        case 'view':{
          for(const key of ['order','hidden'] as const)if(data[key]!==undefined&&(!Array.isArray(data[key])||!data[key].every(x=>typeof x==='string')))throw new Error('Invalid view');
          if(data.sizes!==undefined&&(!Array.isArray(data.sizes)||!data.sizes.every(x=>typeof x==='number')))throw new Error('Invalid sizes');
          if(data.layout!==undefined&&!['columns','rows','grid','four-columns'].includes(String(data.layout)))throw new Error('Invalid view');
          await engine.layout(id(),data.layout as Layout|undefined,data.order as string[]|undefined,data.hidden as string[]|undefined,data.sizes as number[]|undefined);break;
        }
        case 'preset-prepare':result=await engine.prepareWorkReview(id(),{goal:string(data.goal,'goal',4000),criteria:string(data.criteria,'criteria',4000),worker:string(data.worker,'worker'),...(data.reviewer?{reviewer:string(data.reviewer,'reviewer')}:{}),workerPrompt:string(data.workerPrompt,'workerPrompt',8000),reviewerPrompt:string(data.reviewerPrompt,'reviewerPrompt',8000)});break;
        case 'preset-start':result=await engine.startBriefing(id());break;
        case 'archive-group':{
          const anchor=string(data.sessionId,'sessionId'),registry=ctx.get('workspaceRegistry');
          if(!registry||typeof (registry as unknown as {withArchiveGroup?:unknown}).withArchiveGroup!=='function')throw Error('团队归档服务尚未就绪');
          await engine.archiveFromManagement(id(),anchor,string(data.bindingId,'bindingId'),()=>data.restore===true?
            registry.unarchiveSession(SessionId(anchor)):registry.archiveSession(SessionId(anchor)));break;
        }
        case 'detach':await engine.detach(id(),string(data.sessionId,'sessionId'),data.bindingId===undefined?undefined:string(data.bindingId,'bindingId'),true);break;
        case 'rename':await engine.rename(id(),string(data.title,'title',120),data.sessionId===undefined?undefined:string(data.sessionId,'sessionId'));break;
        case 'dissolve':await engine.dissolve(id());break;
        default:throw new Error('Unknown action');
      }
      await engine.flushRetractions();
      return Response.json(result);
    }catch(error){return Response.json(errorResult(error),{status:400});}
  }});
}

export async function readReference(section='index'):Promise<string>{
  const text=await readFile(new URL('../docs/DEVELOPER-GUIDE.zh-CN.md',import.meta.url),'utf8');
  if(section==='all')return text;
  if(section==='index')return text.split('\n').filter(line=>/^#{1,2} /.test(line)).join('\n')+'\n用 section=章节数字读取详细契约，或 section=all 读取全文。';
  if(!/^[1-9]\d?$/.test(section))throw Error('Unknown documentation chapter');
  const lines=text.split('\n'),start=lines.findIndex(line=>line.startsWith('## '+section+'. '));if(start<0)throw Error('Chapter unavailable');let end=start+1;while(end<lines.length&&!lines[end]!.startsWith('## '))end++;return lines.slice(start,end).join('\n');
}
