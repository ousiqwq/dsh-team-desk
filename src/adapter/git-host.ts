import type {} from '@deepseek-ai/dsh-fs';
import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import type {} from '@deepseek-ai/dsh-subprocess';
import type {} from '@deepseek-ai/dsh-sandbox-policy';
import type {} from '@deepseek-ai/dsh-working-directory';
import type {} from '@deepseek-ai/dsh-experimental-worktree';
import type {} from '@deepseek-ai/dsh-sandbox';
import type {GitHost} from '../domain/git/types.ts';
import {CoordinationError} from '../domain/errors.ts';

const selectors=['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_CONFIG','GIT_CONFIG_PARAMETERS','GIT_CONFIG_COUNT','GIT_PREFIX','GIT_REPLACE_REF_BASE','GIT_ATTR_SOURCE','GIT_SHALLOW_FILE','GIT_GRAFT_FILE'];
/** Git execution shares the native process owner and the calling session's standing sandbox. */
export function nativeGitHost(ctx:Context):GitHost {
 const lifetime=new AbortController();
 const agent=async(id:string)=>{const found=ctx.agents.get(SessionId(id));if(found)return found;const r=await ctx.sessionController.resolveAgent(SessionId(id));if('error'in r)throw r.error;return r.agent;};
 return {
  async readWorkingFile(id,root,path,limit,signal){
   const a=await agent(id),fs=a.ctx.get('fs');if(!fs)return {kind:'unchecked'};
   const combined=AbortSignal.any([lifetime.signal,AbortSignal.timeout(30000),...(signal?[signal]:[])]);
   const info=await fs.lstat(path,{cwd:root},combined);if(!info)return {kind:'missing'};
   if(info.type!=='file')return {kind:'unsafe'};
   const parent=await fs.resolve(root,{signal:combined}),target=await fs.resolve(path,{cwd:root,signal:combined});
   if(!fs.contains(parent,target))return {kind:'unsafe'};
   if(info.size===undefined||info.size>limit)return {kind:'unchecked'};
   const bytes=await fs.readBytes(target,combined,limit),after=await fs.lstat(path,{cwd:root},combined);if(!after||JSON.stringify(after.version)!==JSON.stringify(info.version))return {kind:'unchecked'};return {kind:'bytes',bytes};
  },
  async removeTemporaryIndex(id,path){
   if(!/(?:^|[\\/])team-desk-index-[a-f0-9-]{36}$/.test(path))throw new CoordinationError('GIT_ARGUMENT','Invalid temporary index');
   const a=await agent(id),fs=a.ctx.get('fs');if(!fs)return;
   const signal=AbortSignal.timeout(30000),info=await fs.lstat(path,{},signal);if(!info||info.type!=='file')return;
   const target=await fs.resolve(path,{signal});await fs.deleteFile(target,{version:info.version},signal,ctx.get('sandboxPolicy')!.resolve({session:a.session}));
  },
  stop(){lifetime.abort(new Error('Git plugin stopped'));},
  async cwd(id){const a=await agent(id),wd=ctx.get('workingDirectory');if(!wd)throw new CoordinationError('GIT_UNAVAILABLE','Native working-directory service is unavailable');return wd.get(a.session);},
  async worktree(id,request,signal,sourcePath){const service=ctx.get('worktrees');if(!service)throw new CoordinationError('GIT_WORKTREE_UNAVAILABLE','Enable the official Change requests & worktrees bundle');const a=await agent(id),combined=AbortSignal.any([lifetime.signal,...(signal?[signal]:[])]);const directory=ctx.get('workingDirectory');if(!directory)throw new CoordinationError('GIT_UNAVAILABLE','Native working-directory service is unavailable');if(sourcePath&&directory.get(a.session)!==sourcePath)await directory.set(a,sourcePath,combined);return service.create(a,request,combined);},
  async run(id,cwd,args,options={}){
   const a=await agent(id),processes=ctx.get('subprocess'),policyService=ctx.get('sandboxPolicy'),sandbox=ctx.get('sandbox');
   if(!processes||!policyService||!sandbox)throw new CoordinationError('GIT_UNAVAILABLE','Native subprocess and sandbox services are required');
   const signal=AbortSignal.any([lifetime.signal,AbortSignal.timeout(300000),...(options.signal?[options.signal]:[])]),policy=policyService.resolve({session:a.session});
   const git=await processes.resolveExecutable('git',undefined,signal),argv=[git,...args];
   const confined=policy.mode==='danger-full-access'?argv:(await sandbox.confine(argv,{...policy,mode:policy.mode},signal)).argv;
   const child=processes.spawn({argv:confined,cwd,signal,graceMs:2000,env:{...Object.fromEntries(selectors.map(k=>[k,undefined])),GIT_TERMINAL_PROMPT:'0',GIT_NO_LAZY_FETCH:'1',GIT_LITERAL_PATHSPECS:'1',...options.env},stdio:{stdin:options.input===undefined?'ignore':{data:options.input},stdout:{maxBytes:8388608},stderr:{maxBytes:1048576}}});
   try{
    const outcome=await child.done;signal.throwIfAborted();
    const stdout=child.collected.stdout!.readFrom(0),stderr=child.collected.stderr!.readFrom(0);
    if(stdout.lossy||stderr.lossy)throw new CoordinationError('GIT_OUTPUT_LIMIT','Git output exceeded the bounded capture');
    if(outcome.exitCode===null||!(options.allow??[0]).includes(outcome.exitCode))throw new CoordinationError('GIT_FAILED',stderr.text.trim()||'Git command failed',false,{exitCode:outcome.exitCode});
    return {stdout:stdout.text,stderr:stderr.text,exitCode:outcome.exitCode};
   }finally{child.terminate();await child.waitForExit();}
  },
 };
}
