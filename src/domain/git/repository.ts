import {createHash} from 'node:crypto';
import {isAbsolute,relative,resolve} from 'node:path';
import type {GitHost,GitScope,GitRepository,GitStatus} from './types.ts';
import {CoordinationError} from '../errors.ts';

export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export function requireGit(value:unknown,label:string,max=4096):string{if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))throw new CoordinationError('GIT_ARGUMENT','Invalid '+label);return value;}
export function fullObject(value:string):string{if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))throw new CoordinationError('GIT_ARGUMENT','A full Git object id is required');return value;}
export function parseStatus(output:string):GitStatus['files']{
 const fields=output.split('\0'),rows:GitStatus['files']=[];
 for(let i=0;i<fields.length;i++){const entry=fields[i];if(!entry)continue;const status=entry.slice(0,2),path=entry.slice(3);if(!path)continue;const from=/[RC]/.test(status)?fields[++i]:undefined;rows.push({status,path,...(from?{from}:{})});}
 return rows;
}
export function scopedPaths(repo:GitRepository,paths:unknown):string[]{
 if(!Array.isArray(paths)||!paths.length||paths.length>200)throw new CoordinationError('GIT_ARGUMENT','Select 1–200 explicit project paths');
 const project=resolve(repo.root,repo.prefix),out:string[]=[];
 for(const raw of paths){const path=requireGit(raw,'path'),absolute=resolve(repo.root,path),rel=relative(project,absolute),gitRel=relative(repo.root,absolute);
  if(!gitRel||isAbsolute(path)||rel==='..'||rel.startsWith('../')||isAbsolute(rel)||gitRel.split(/[\\/]/).includes('.git'))throw new CoordinationError('GIT_PROJECT_SCOPE','Path is outside the selected project');
  out.push(gitRel);
 }
 return [...new Set(out)];
}
export async function repositoryRoot(host:GitHost,scope:GitScope):Promise<string|undefined>{
 const result=await host.run(scope.actor,scope.projectRoot,['rev-parse','--show-toplevel'],{allow:[0,128],env:{LC_ALL:'C'},...(scope.signal?{signal:scope.signal}:{})});
 if(result.exitCode===0)return result.stdout.replace(/\r?\n$/,'');
 if(result.exitCode===128&&/^fatal: not a git repository \(or any (?:of the parent directories|parent up to mount point)/.test(result.stderr))return undefined;
 throw new CoordinationError('GIT_DISCOVERY_FAILED',result.stderr.trim()||'Could not inspect the repository');
}
export async function discover(host:GitHost,scope:GitScope):Promise<GitRepository>{
 const run=async(args:string[])=>(await host.run(scope.actor,scope.projectRoot,args)).stdout.replace(/\r?\n$/,'');
 const root=await repositoryRoot(host,scope);
 if(root===undefined)throw new CoordinationError('GIT_NOT_REPOSITORY','Project directory has no Git repository');
 const commonDir=await run(['rev-parse','--path-format=absolute','--git-common-dir']),prefix=await run(['rev-parse','--show-prefix']);
 const branch=await host.run(scope.actor,root,['symbolic-ref','--quiet','HEAD'],{allow:[0,1]});
 return {id:'repo-'+digest(commonDir+'\0'+scope.projectId).slice(0,24),teamIds:[scope.teamId],projectId:scope.projectId,projectRoot:scope.projectRoot,root,commonDir,prefix,defaultTarget:branch.stdout.trim(),requireReview:false};
}
