import {nativeFailure} from './contracts.ts';
import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-tools';
import type {TeamEngine} from '../domain/engine.ts';
import {resolveNativeActor} from './lineage.ts';
/** Wrap the registry, so nested run_code and direct native/MCP calls share the guard. */
export function guardResources(ctx:Context,engine:TeamEngine):()=>Promise<void>{
 const pending=new Set<Promise<unknown>>();let closing=false;
 const off=ctx.on('tools/execute',async(exec,next)=>{
  if(!engine.resourceBinding(exec.name))return next();
  if(closing)throw Error('Team Desk resource guard is stopping');
  const job=(async()=>{
   const actor=ctx.agents?resolveNativeActor(ctx,engine,exec.agent):undefined;
   const started=await engine.beginResource(exec.agent?.id??'native:anonymous',exec.name,String(exec.callId),actor?.memberSessionId??exec.agent?.id??'native:anonymous').catch(error=>{throw nativeFailure(error);});if(!started)return next();
   try{const result=await next();if(!closing)await engine.finishResource(started.resourceId,started.operation.id,!result.isError&&!exec.signal.aborted,result.isError?'原生工具返回错误；请确认实例已停止或状态已核对':exec.signal.aborted?'调用已取消；远端完成情况待核对':'');return result;}
   catch(error){if(!closing)await engine.finishResource(started.resourceId,started.operation.id,false,String(error));throw error;}
  })();pending.add(job);try{return await job;}finally{pending.delete(job);}
 });
 return async()=>{closing=true;let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([Promise.allSettled([...pending]),new Promise<void>(r=>{timer=setTimeout(r,3000);})]);await engine.abandonResources();}finally{clearTimeout(timer);off();}};
}
