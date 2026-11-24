import {digest,scopedPaths} from './repository.ts';
import {CoordinationError} from '../errors.ts';
import type {GitHost,GitScope,GitStatus} from './types.ts';

export interface GitHunk {id:string;heading:string;patch:string;}
export interface GitPartialFile {path:string;header:string;hunks:GitHunk[];unavailable?:string;}
export interface GitPartialPreview {head:string;branch:string;path:string;snapshot:string;paths:string[];files:GitPartialFile[];}
const flags=['--no-replace-objects','--no-optional-locks','-c','core.fsmonitor=false'];
const diffFlags=['--no-ext-diff','--no-textconv','--no-color','--no-renames','--full-index','--diff-algorithm=myers','--unified=3','--inter-hunk-context=0','--src-prefix=a/','--dst-prefix=b/'];
export async function partialPreview(host:GitHost,scope:GitScope,status:GitStatus,requested:string[]):Promise<GitPartialPreview>{
 const paths=scopedPaths(status.repository,requested).sort(),files:GitPartialFile[]=[];let size=0;
 if(!status.head)throw new CoordinationError('GIT_PARTIAL_UNAVAILABLE','Create an initial commit before selecting hunks');
 const run=async(args:string[])=>(await host.run(scope.actor,status.path,[...flags,...args],{env:{GIT_LITERAL_PATHSPECS:'1'},...(scope.signal?{signal:scope.signal}:{})})).stdout;
 for(const path of paths){
  const state=status.files.find(f=>f.path===path),file:GitPartialFile={path,header:'',hunks:[]};files.push(file);
  if(!state||state.status!==' M'){file.unavailable='Partial selection requires an unstaged modification to an existing regular text file.';continue;}
  const entry=await run(['ls-tree','-z',status.head,'--',path]);
  if(!/^100(?:644|755) blob /.test(entry)){file.unavailable='Use whole-file commits for symbolic links and submodules.';continue;}
  if((await run(['check-attr','filter','--',path])).trim().endsWith(': lfs')){file.unavailable='Use a whole-file commit for LFS content.';continue;}
  const patch=await run(['diff',...diffFlags,status.head,'--',path]);size+=Buffer.byteLength(patch);
  if(size>524288)throw new CoordinationError('GIT_PARTIAL_LIMIT','Selected diff exceeds 512 KiB; select fewer files or use native Git');
  const at=patch.search(/^@@ /m);
  if(at<0||/^old mode |^new mode |^Binary files |^GIT binary patch/m.test(patch)){file.unavailable='No selectable text hunks; use a whole-file commit for binary or mode changes.';continue;}
  file.header=patch.slice(0,at);
  for(const block of patch.slice(at).split(/(?=^@@ )/m)){if(!block)continue;file.hunks.push({id:digest(path+'\0'+block),heading:block.slice(0,block.indexOf('\n')),patch:block});}
 }
 const snapshot=digest(JSON.stringify({actor:scope.actor,team:scope.teamId,project:scope.projectId,head:status.head,branch:status.branch,path:status.path,files}));
 return {head:status.head,branch:status.branch,path:status.path,snapshot,paths,files};
}
/** Only server-generated hunks are accepted. Rebase line offsets after skipped hunks. */
export function selectedPatch(preview:GitPartialPreview,ids:unknown):{patch:string;paths:string[]}{
 if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string')||new Set(ids).size!==ids.length)throw new CoordinationError('GIT_ARGUMENT','Select unique hunk IDs from the current preview');
 const wanted=new Set(ids),paths:string[]=[];let patch='';
 for(const file of preview.files){let body='',delta=0;
  for(const h of file.hunks){if(!wanted.delete(h.id))continue;
   const m=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)\n/.exec(h.patch);if(!m)throw new CoordinationError('GIT_PARTIAL_INVALID','Invalid native diff hunk');
   const oldStart=Number(m[1]),oldCount=Number(m[2]??1),newCount=Number(m[4]??1),newStart=oldStart+delta+(oldCount===0?1:0)-(newCount===0?1:0);
   body+=`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${m[5]}\n`+h.patch.slice(m[0].length);delta+=newCount-oldCount;
  }
  if(body){paths.push(file.path);patch+=file.header+body;}
 }
 if(wanted.size||!paths.length)throw new CoordinationError('GIT_PARTIAL_STALE','Hunk selection is no longer available; reload the diff');
 return {patch,paths};
}

/** Native apply locks the real index, touches only selected hunks, and never writes working files. */
export async function synchronizePartialIndex(host:GitHost,scope:GitScope,path:string,sha:string,parent:string,patch:string,paths:string[]){
 const run=(args:string[],input?:string)=>host.run(scope.actor,path,args,{env:{GIT_LITERAL_PATHSPECS:'1'},...(input===undefined?{}:{input}),...(scope.signal?{signal:scope.signal}:{})});
 if((await run(['rev-parse','HEAD'])).stdout.trim()!==sha)throw new CoordinationError('GIT_PARTIAL_INDEX_PENDING','Commit exists but HEAD moved; inspect the real index before resolving');
 if(!(await run(['diff','--cached','--name-only','-z',sha,'--',...paths])).stdout)return;
 if((await run(['diff','--cached','--name-only','-z',parent,'--',...paths])).stdout)throw new CoordinationError('GIT_PARTIAL_INDEX_PENDING','Commit exists but selected index entries changed; preserve them and inspect before resolving');
 await run(['apply','--cached','--whitespace=nowarn','--check','-'],patch);
 await run(['apply','--cached','--whitespace=nowarn','-'],patch);
}
