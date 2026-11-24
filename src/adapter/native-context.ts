import type{NativeConnections} from './connections.ts';
import type{Context}from'@deepseek-ai/cordis';
import{defineTool}from'@deepseek-ai/dsh-tools';
import type{Agent}from'@deepseek-ai/dsh-agent';
import type{TeamEngine}from'../domain/engine.ts';
import{CoordinationError}from'../domain/errors.ts';
import{record,string}from'../domain/storage.ts';
import{resolveNativeActor}from'./lineage.ts';
import type{GitEngine}from'../domain/git/engine.ts';
import{gitAction}from'./git-actions.ts';
import{toolContract}from'./contracts.ts';

/** Global conditional tools remain subject to each native child's preset masks. */
export function nativeContext(ctx:Context,engine:TeamEngine,reference:(section?:string)=>Promise<string>,git?:GitEngine,bridge?:NativeConnections,scopedTool=toolContract){
 if(!ctx.get('subagents')||typeof ctx.tools.resolve!=='function')return()=>{};
 const child=(agent:Agent|undefined)=>{const a=resolveNativeActor(ctx,engine,agent);return a&&a.actorSessionId!==a.memberSessionId?a:undefined;};
 const requireChild=(agent:Agent|undefined)=>{const a=child(agent);if(!a)throw new CoordinationError('NATIVE_CHILD_SCOPE','This entry is only available to an active native descendant');return a;};
 const output={schema:{type:'string' as const},render:(_args:object,value:string)=>[{type:'text' as const,text:value}]};
 const when=({agent}:{agent:Agent})=>!!child(agent),stops:(()=>void)[]=[];
 if(git)stops.push(ctx.tools.register(scopedTool(defineTool({name:'team_git',description:'Git for YOUR actual native session under the verified outer member project scope. action status,state,init,worktree,commit,propose,review,integrate,reconcile. project_id is explicit, options JSON follows team_reference. Worktree changes YOUR cwd only. Preserve exact SHA baselines; outer members, not sibling children, determine independent review.',parameters:{action:{type:'string',required:true},project_id:{type:'string',required:true},options:{type:'string'}},output,async execute(args,exec){const a=requireChild(exec.agent);return JSON.stringify(await gitAction(git,engine,a.memberSessionId,a.actorSessionId,args.project_id,args.action,args.options?JSON.parse(args.options):{},exec.signal));}})),{when}));
 stops.push(ctx.tools.register(scopedTool(defineTool({name:'team_shared',description:'Shared project context of your verified outer Team Desk member. Does not expose parent private messages, local values or persona. action read, projects, changes, history, set. set writes a TEAM-level value with expected CAS revision and records YOUR actual native identity; no parent-local inheritance. Other cross-root communication goes through your native parent using native send_message.',parameters:{action:{type:'string',required:true},key:{type:'string'},value:{type:'string'},expected:{type:'number'},reason:{type:'string'},kind:{type:'string'},options:{type:'string'}},output,async execute(args,exec){
  const a=requireChild(exec.agent),options=args.options?JSON.parse(args.options):{};if(!record(options))throw Error('Invalid options');const scope=options.projectId===undefined?{}:{projectId:string(options.projectId,'projectId')};
  let value:unknown;
  if(args.action==='read')value={...engine.shared(a.memberSessionId,args.key,scope),values:engine.shared(a.memberSessionId,args.key,scope).values.filter(v=>v.scope==='team')};
  else if(args.action==='projects')value=await engine.projects(a.memberSessionId);
  else if(args.action==='changes')value=await engine.changes(a.memberSessionId,Number(options.cursor??0),scope);
  else if(args.action==='history'){const rows=await engine.history(a.memberSessionId,string(args.key,'key'),scope,Number(options.cursor??0));value={...rows,history:rows.history.filter(r=>r.scope==='team')};}
  else if(args.action==='set')value=await engine.updateNativeShared(a.memberSessionId,a.actorSessionId,string(args.key,'key'),JSON.parse(string(args.value,'value',12000)),Number(args.expected),string(args.reason,'reason',2000),args.kind==='decision'?'decision':'value',scope);
  else throw new CoordinationError('NATIVE_CHILD_SCOPE','Use the documented shared context actions; parent private state is not available');
  return JSON.stringify(Array.isArray(value)?value:{...(value as Record<string,unknown>),memberSessionId:a.memberSessionId,actorSessionId:a.actorSessionId});
 }})),{when}));
 stops.push(ctx.tools.register(scopedTool(defineTool({name:'team_reference',description:'Read the installed Team Desk architecture and preset/API contracts. Native inner-tree collaboration uses native tools; outer member addresses are separate.',parameters:{section:{type:'string'}},output,async execute(args,exec){requireChild(exec.agent);return reference(args.section);}})),{when}));
 stops.push(ctx.tools.register(scopedTool(defineTool({name:'team_resource',description:'Manage YOUR own lease for a configured shared tool instance. Parent leases are never inherited. action status, acquire, renew, release, delegate, revoke-delegation, return-delegation; options JSON mode,ttlMs,token,target,delegationId. No force release; unknown running effects need user reconciliation.',parameters:{action:{type:'string',required:true},resource:{type:'string'},options:{type:'string'}},output,async execute(args,exec){const a=requireChild(exec.agent);return JSON.stringify(args.action==='status'?engine.resourceStatus(a.memberSessionId,a.actorSessionId):await (bridge?bridge.lease(a.memberSessionId,a.actorSessionId,args.action,string(args.resource,'resource'),args.options?JSON.parse(args.options):{}):engine.resourceLease(a.memberSessionId,string(args.resource,'resource'),args.action,args.options?JSON.parse(args.options):{},a.actorSessionId)));}})),{when}));
 const contexts=new Map<Agent,()=>void>();
 const sync=()=>{for(const agent of ctx.agents.list()){const a=child(agent);if(a&&!contexts.has(agent))contexts.set(agent,agent.ctx.systemPrompt.context({name:'team-desk:native-context',order:126,required:true,interpolate:false,text:()=>{const live=child(agent);return live?'Team Desk native context: '+JSON.stringify({...live,projects:engine.snapshot().projects?.filter(p=>p.teamIds.includes(engine.membership(live.memberSessionId)!.id)).map(({id,name,root})=>({id,name,root}))})+'. Only team-level shared values may be read; no parent private message/persona inheritance. Tools remain subject to your native preset. Use native send_message for your parent and siblings.'+(bridge?.delegationContext(live.actorSessionId,live.memberSessionId)??''):'';}}));else if(!a){contexts.get(agent)?.();contexts.delete(agent);}}};
 stops.push(engine.subscribe(sync));stops.push(ctx.on('agent/created',()=>{sync();return undefined;}));stops.push(ctx.on('agent/disposed',({agent})=>{contexts.get(agent)?.();contexts.delete(agent);}));sync();
 return()=>{for(const stop of stops.reverse())stop();for(const stop of contexts.values())stop();contexts.clear();};
}
