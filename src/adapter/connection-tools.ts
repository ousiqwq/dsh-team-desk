import {nativeDelegationTools} from './native-delegation.ts';
import type {Context} from '@deepseek-ai/cordis';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {ToolCallId} from '@deepseek-ai/dsh-llm';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {toolContract} from './contracts.ts';
import {resolveNativeActor} from './lineage.ts';
import type {TeamEngine} from '../domain/engine.ts';
import type {NativeConnections} from './connections.ts';
import {record,string} from '../domain/storage.ts';
import {CoordinationError} from '../domain/errors.ts';

/** New conveniences call the public native pipeline; no shadowing of native tools or presets. */
export function connectionTools(ctx:Context,engine:TeamEngine,bridge:NativeConnections,scopedTool=toolContract){
 if(typeof ctx.tools.resolve!=='function')return()=>{};
 const identity=(agent:Agent|undefined)=>{const a=resolveNativeActor(ctx,engine,agent);if(!a)throw Error('Caller outside an active Team Desk session');return a;};
 const output={schema:{type:'string' as const},render:(_args:object,value:string)=>[{type:'text' as const,text:value}]};
 const options=(value:string|undefined)=>{const v=value?JSON.parse(value):{};if(!record(v))throw Error('Options must be an object');return v;};
 const when=({agent}:{agent:Agent})=>!!resolveNativeActor(ctx,engine,agent);
 const stops=[ctx.tools.register(scopedTool(defineTool({name:'team_native',description:'Read native tasks, actual execution state and deduplicated own-session usage, or explicitly link a native task to a pinned Git proposal. action status,tasks,usage,defaults,link-task. options JSON; link-task requires key,member,taskId,taskRevision,expected and optional projectId,proposalId,evidence. Task completion never implies independent acceptance. Native team_task_* remains authoritative for internal tasks.',parameters:{action:{type:'string',required:true},options:{type:'string'}},output,async execute(args,exec){const a=identity(exec.agent);if(args.action==='save-defaults')throw Error('Child defaults are user-managed');return JSON.stringify(await bridge.action(a.memberSessionId,a.actorSessionId,args.action,options(args.options)));}})),{when}),
 ctx.tools.register(toolContract(defineTool({name:'team_delegate',description:'Start a native child using this actual session’s optional saved child defaults. Without overrides native subagent inherits this conversation’s model. Explicit call options take priority; native model authorization, allowed presets, limits, approval and tool restrictions remain enforced. tool is subagent (fresh) or subagent_fork (completed history); name is unique and stable to avoid duplicate retries. Read team_reference for scope. Existing native tools remain available.',parameters:{tool:{type:'string'},name:{type:'string',required:true},description:{type:'string',required:true},prompt:{type:'string',required:true},options:{type:'string'}},output,async execute(args,exec){const a=identity(exec.agent),tool=args.tool??'subagent';if(!['subagent','subagent_fork'].includes(tool))throw Error('Unsupported native delegation tool');const defaults=bridge.defaultsFor(a.actorSessionId,a.memberSessionId),overrides=options(args.options);
  const schema = exec.agent?.ctx.tools.get(tool, exec.agent)?.parameters;
  const properties = record(schema) && record(schema.properties) ? schema.properties : {};
  if(Object.keys(overrides).some(k=>!['provider','model','reasoning_effort','agent_preset','cwd'].includes(k) || !Object.hasOwn(properties,k)))throw Error('Unsupported native delegation option');
  const nativeArgs:Record<string,unknown>={name:string(args.name,'name',120),description:string(args.description,'description',1000),prompt:string(args.prompt,'prompt',30000)};
  if(tool==='subagent'){if(properties.provider&&properties.model&&defaults.provider&&defaults.model){nativeArgs.provider=defaults.provider;nativeArgs.model=defaults.model;}if(properties.reasoning_effort&&defaults.reasoningEffort)nativeArgs.reasoning_effort=defaults.reasoningEffort;if(properties.agent_preset&&defaults.agentPreset)nativeArgs.agent_preset=defaults.agentPreset;}
  if(overrides.provider!==undefined||overrides.model!==undefined)delete nativeArgs.reasoning_effort;
  Object.assign(nativeArgs,overrides);
  const {ToolExecutionPipeline,executeToolBatch}=await import('@deepseek-ai/dsh-tools/pipeline');
  const result=await executeToolBatch({calls:[{type:'tool-call',id:ToolCallId('team-delegate-'+crypto.randomUUID()),name:tool,arguments:JSON.stringify(nativeArgs)}],agent:exec.agent!,signal:exec.signal,...(exec.toolSet?{toolSet:exec.toolSet}:{})},new ToolExecutionPipeline(ctx),()=>1);
  for(const context of result.additionalContexts)exec.deferContext(context);
  const row=result.results[0]?.result;if(!row)throw Error('Native delegation result unavailable');
  if(row.isError)throw new CoordinationError(row.error?.info?.code??'NATIVE_DELEGATION_FAILED',row.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));
  return JSON.stringify({nativeTool:tool,result:row.value,memberSessionId:a.memberSessionId,actorSessionId:a.actorSessionId});
 }})),{when:context=>when(context)&&nativeDelegationTools(ctx,context.agent).length>0})];
 return()=>{for(const stop of stops.reverse())stop();};
}
