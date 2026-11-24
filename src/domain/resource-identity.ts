import {realpath} from 'node:fs/promises';
import {dirname,basename,join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ChangeDetails,ResourceIdentity} from './types.ts';
export async function canonicalResource(path:string):Promise<string|undefined>{
 if(!isAbsolute(path))return undefined;
 try{return await realpath(path);}catch{try{return join(await realpath(dirname(path)),basename(path));}catch{return path;}}
}
/** Identity is scoped to one explicit ledger. Content hashes never imply identity. */
export function identifyResource(index:ResourceIdentity[],resource:string,version:string,details:ChangeDetails):ResourceIdentity{
 const canonical=details.canonicalPath??resource,aliases=[resource,canonical,...(details.previousResource?[details.previousResource]:[])];
 const source=details.operation==='rename'&&details.previousResource;
 const original=source?index.find(x=>x.aliases.includes(source)&&!x.retiredPaths?.includes(source)):undefined;
 if(original){
  for(const other of index)if(other!==original&&other.aliases.some(path=>path===canonical||path===resource)){
   other.retiredPaths=[...new Set([...(other.retiredPaths??[]),canonical,resource])];
  }
 }
 let found=original??index.find(x=>x.aliases.some(p=>aliases.includes(p)&&!x.retiredPaths?.includes(p))||(details.resourceId&&x.nativeIds.includes(details.resourceId)&&!x.retiredPaths?.includes(canonical)));
 if(!found){found={id:'resource-'+randomUUID(),generation:1,aliases:[],nativeIds:[],exists:true,version};index.push(found);}
 else if(!found.exists&&details.operation!=='delete')found.generation++;
 if(details.operation==='rename'&&details.previousResource){found.retiredPaths=[...new Set([...(found.retiredPaths??[]),details.previousResource])];found.aliases=found.aliases.filter(p=>p!==details.previousResource);}
 if(details.operation==='rename'&&found.retiredPaths)found.retiredPaths=found.retiredPaths.filter(p=>p!==canonical&&p!==resource);
 found.aliases=[...new Set([...found.aliases,...aliases])];if(details.resourceId&&!found.nativeIds.includes(details.resourceId))found.nativeIds.push(details.resourceId);
 found.exists=details.operation!=='delete';found.version=version;return found;
}
