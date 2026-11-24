import {join} from 'node:path';
import {readJson,writeJson,record} from '../storage.ts';
import {digest} from './repository.ts';
import type {GitArchive,GitArchiveRef} from './types.ts';
export async function saveGitArchive(file:string,value:GitArchive):Promise<GitArchiveRef>{
 const id=crypto.randomUUID(),sha256=digest(JSON.stringify(value));await writeJson(join(file+'.archives',id+'.json'),value);
 return {id,sha256,teamId:value.teamId,projectId:value.projectId,time:value.time,operations:value.operations.map(({id,key,actor,teamId,fingerprint})=>({id,key,actor,teamId,fingerprint})),proposalCount:value.proposals.length};
}
export async function loadGitArchive(file:string,ref:GitArchiveRef):Promise<GitArchive>{
 if(!/^[a-f0-9-]{36}$/.test(ref.id))throw Error('GIT_ARCHIVE_INVALID');
 const value=await readJson(join(file+'.archives',ref.id+'.json'));
 if(!record(value)||value.version!==1||value.teamId!==ref.teamId||value.projectId!==ref.projectId||!['operations','proposals','notices'].every(k=>Array.isArray(value[k]))||digest(JSON.stringify(value))!==ref.sha256)throw Error('GIT_ARCHIVE_INTEGRITY: Git archive is missing or has changed');
 return value as unknown as GitArchive;
}
