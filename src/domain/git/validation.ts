import {isAbsolute} from 'node:path';
import {record} from '../storage.ts';
import type {GitState} from './types.ts';
const text=(x:unknown,max=4096):x is string=>typeof x==='string'&&x.length>0&&x.length<=max&&!x.includes('\0');
const strings=(x:unknown)=>Array.isArray(x)&&x.every(v=>text(v));
const oid=(x:unknown)=>typeof x==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(x);
const integer=(x:unknown,min=0)=>Number.isSafeInteger(x)&&Number(x)>=min;
const unique=(rows:unknown[],key:string)=>rows.every(record)&&new Set(rows.map(r=>(r as Record<string,unknown>)[key])).size===rows.length;
/** Reject corruption or a future writer before changing any Git collaboration data. */
export function validateGitState(value:unknown):asserts value is GitState {
 const bad=()=>{throw Error('GIT_STATE_VERSION: Unsupported or invalid Git collaboration state; data retained');};
 if(!record(value)||value.version!==2||!integer(value.revision)||!['repositories','checkouts','proposals','operations'].every(k=>Array.isArray(value[k])))return bad();
 const {repositories,checkouts,proposals,operations}=value as unknown as GitState;
 if(![repositories,proposals,operations].every(rows=>unique(rows,'id')))return bad();
 for(const r of repositories)if(!record(r)||!text(r.id)||!strings(r.teamIds)||!text(r.projectId)||![r.projectRoot,r.root,r.commonDir].every(p=>text(p)&&isAbsolute(p))||typeof r.prefix!=='string'||typeof r.defaultTarget!=='string'||typeof r.requireReview!=='boolean')return bad();
 const ids=new Set(repositories.map(r=>r.id));
 for(const c of checkouts)if(!record(c)||!ids.has(c.repositoryId)||!text(c.sessionId)||!text(c.path)||!isAbsolute(c.path)||typeof c.branch!=='string'||c.baseline!==''&&!oid(c.baseline))return bad();
 for(const p of proposals){
  if(!record(p)||!ids.has(p.repositoryId)||!text(p.id)||!integer(p.revision,1)||![p.teamId,p.actor,p.targetRef,p.summary].every(v=>text(v))||![p.sourceSha,p.targetSha].every(oid)||typeof p.sourceRef!=='string'||!strings(p.evidence)||!Array.isArray(p.reviews)||!Number.isFinite(p.createdAt)||p.integratedSha!==undefined&&!oid(p.integratedSha))return bad();
  for(const r of p.reviews)if(!record(r)||r.protocol!==undefined&&r.protocol!==2||![r.id,r.actor,r.note].every(v=>text(v))||![r.sourceSha,r.targetSha].every(oid)||!['comment','passed','changes_requested'].includes(r.outcome)||!strings(r.evidence)||!Number.isFinite(r.time))return bad();
 }
 for(const o of operations)if(!record(o)||!ids.has(o.repositoryId)||![o.id,o.key,o.fingerprint,o.actor,o.teamId].every(v=>text(v))||!['init','worktree','commit','commit-hunks','integrate'].includes(o.action)||!['prepared','completed','uncertain','failed','resolved'].includes(o.state)||!text(o.path)||!isAbsolute(o.path)||o.expectedHead!==''&&!oid(o.expectedHead)||!record(o.request)||!Number.isFinite(o.time)||o.resolution!==undefined&&(!record(o.resolution)||!text(o.resolution.actor)||!text(o.resolution.reason)||!oid(o.resolution.head)||!Number.isFinite(o.resolution.time)))return bad();
 if(value.archives!==undefined){if(!Array.isArray(value.archives))return bad();for(const a of value.archives)if(!record(a)||!text(a.id)||!oid(a.sha256)||!text(a.teamId)||!text(a.projectId)||!Number.isFinite(a.time)||!Array.isArray(a.operations)||a.operations.some(o=>!record(o)||![o.id,o.key,o.actor,o.teamId,o.fingerprint].every(v=>text(v))))return bad();}
 if(value.notices!==undefined){if(!Array.isArray(value.notices))return bad();for(const n of value.notices)if(!record(n)||![n.id,n.teamId,n.projectId,n.actor,n.action].every(v=>text(v))||!ids.has(n.repositoryId as string)||!Number.isFinite(n.time)||n.deliveredAt!==undefined&&!Number.isFinite(n.deliveredAt))return bad();}
}
