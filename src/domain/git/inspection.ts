import {createHash} from 'node:crypto';
import {fullObject} from './repository.ts';
import {CoordinationError} from '../errors.ts';
import type {GitHost,GitProposal,GitRepository,GitScope} from './types.ts';

// Read-only Git: no filters, replacement refs, hooks, lazy fetch or index refresh.
const flags=['--no-replace-objects','--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false'];
export async function compareProposal(host:GitHost,scope:GitScope,repo:GitRepository,path:string,proposal:GitProposal){
 const run=(args:string[])=>host.run(scope.actor,path,[...flags,...args],{...(scope.signal?{signal:scope.signal}:{})});
 for(const sha of [proposal.targetSha,proposal.sourceSha]){
  const resolved=(await run(['rev-parse','--verify','--end-of-options',fullObject(sha)+'^{commit}'])).stdout.trim();
  if(resolved!==sha)throw new CoordinationError('GIT_COMPARE_OBJECT','Expected commit object is unavailable');
 }
 const patch=(await run(['diff','--no-ext-diff','--no-textconv','--no-color','--no-renames','--submodule=short','--src-prefix=a/','--dst-prefix=b/',proposal.targetSha,proposal.sourceSha,'--',repo.prefix||'.'])).stdout;
 if(Buffer.byteLength(patch)>2*1024*1024)throw new CoordinationError('GIT_COMPARE_LIMIT','Comparison exceeds the 2 MiB display limit; compare these exact SHAs in native Git');
 return {proposalId:proposal.id,revision:proposal.revision,sourceSha:proposal.sourceSha,targetSha:proposal.targetSha,path,projectPrefix:repo.prefix,patch};
}
export function lfsPointer(text:string):{oid:string;size:number}|undefined{
 if(Buffer.byteLength(text)>1024||!text.startsWith('version https://git-lfs.github.com/spec/v1\n'))return;
 const oid=/^oid sha256:([a-f0-9]{64})$/m.exec(text)?.[1],size=/^size (0|[1-9][0-9]*)$/m.exec(text)?.[1];
 if(!oid||size===undefined||!Number.isSafeInteger(Number(size)))return;
 return {oid,size:Number(size)};
}
export interface LfsFile {path:string;oid:string;size:number;state:'pointer'|'materialized'|'modified'|'missing'|'unsafe'|'unchecked';}
export async function inspectLfs(host:GitHost,scope:GitScope,repo:GitRepository,path:string){
 const run=(args:string[],input?:string)=>host.run(scope.actor,path,[...flags,...args],{...(input===undefined?{}:{input}),...(scope.signal?{signal:scope.signal}:{})});
 const entries=(await run(['ls-files','--stage','-z','--',repo.prefix||'.'])).stdout.split('\0').filter(Boolean).map(row=>{const at=row.indexOf('\t'),[mode,oid,stage]=row.slice(0,at).split(' ');return {mode,oid:oid!,stage,path:row.slice(at+1)};}).filter(e=>e.stage==='0'&&e.mode?.startsWith('100'));
 const scanned=entries.slice(0,1000),ids=[...new Set(scanned.map(e=>fullObject(e.oid)))];
 const sizes=new Map<string,number>();if(ids.length)for(const row of (await run(['cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)'],ids.join('\n')+'\n')).stdout.trim().split('\n')){const [oid,type,size]=row.split(' ');if(type==='blob')sizes.set(oid!,Number(size));}
 const pointers=new Map<string,ReturnType<typeof lfsPointer>>(),files:LfsFile[]=[];let budget=64*1024*1024,omitted=entries.length-scanned.length;
 for(const entry of scanned){
  if(!sizes.has(entry.oid)||sizes.get(entry.oid)!>1024)continue;
  if(!pointers.has(entry.oid))pointers.set(entry.oid,lfsPointer((await run(['cat-file','blob',entry.oid])).stdout));
  const pointer=pointers.get(entry.oid);if(!pointer)continue;if(files.length>=100){omitted++;continue;}
  let state:LfsFile['state']='unchecked';
  if(host.readWorkingFile&&budget>0){
   const limit=Math.min(8*1024*1024,budget),result=await host.readWorkingFile(scope.actor,path,entry.path,limit,scope.signal);
   if(result.kind==='bytes'){budget-=result.bytes.byteLength;const bytes=result.bytes;
    const localPointer=lfsPointer(Buffer.from(bytes).toString('utf8'));state=localPointer?(localPointer.oid===pointer.oid&&localPointer.size===pointer.size?'pointer':'modified'):bytes.byteLength===pointer.size&&createHash('sha256').update(bytes).digest('hex')===pointer.oid?'materialized':'modified';
   }else state=result.kind;
  }
  files.push({...pointer,path:entry.path,state});
 }
 return {basis:'index' as const,path,files,scanned:scanned.length,omitted,complete:omitted===0,readLimitBytes:8*1024*1024};
}
