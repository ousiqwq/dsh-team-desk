import {isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {record} from '../domain/storage.ts';
import {textChange} from '../domain/ledger.ts';
import type {ChangeDetails} from '../domain/types.ts';

export const mutationTools=new Set(['write','edit','apply_patch','str_replace_editor']);
export interface NativeMutation {path:string;before:string|null;after:string|null;operation:NonNullable<ChangeDetails['operation']>;previousResource?:string;}
/** Canonical provider results include the completed part of a failed patch. */
export function nativeMutations(value:unknown):NativeMutation[]{
  if(!record(value))return [];
  if(value.phase==='commit'&&Array.isArray(value.operations))return value.operations.flatMap(op=>{
    if(!record(op)||!['completed','failed'].includes(String(op.status))||!Array.isArray(op.changes))return [];
    return op.changes.flatMap(change=>{
      if(!record(change)||typeof change.path!=='string'||!isAbsolute(change.path)||!(change.before===null||typeof change.before==='string')||!(change.after===null||typeof change.after==='string'))return [];
      const previous=op.kind==='move'&&change.after!==null&&typeof op.path==='string'&&isAbsolute(op.path)?op.path:undefined;
      return [{path:change.path,before:change.before,after:change.after,operation:change.after===null?'delete' as const:previous?'rename' as const:op.kind==='add'?'create' as const:'update' as const,...(previous?{previousResource:previous}:{})}];
    });
  });
  if(typeof value.path==='string'&&isAbsolute(value.path)&&(value.before===null||typeof value.before==='string')&&(value.after===null||typeof value.after==='string'))return [{path:value.path,before:value.before,after:value.after,operation:value.after===null?'delete':value.operation==='create'?'create':'update'}];
  return [];
}
export function mutationDetails(change:NativeMutation):ChangeDetails {
  const details=textChange(change.before,change.after??'');
  if(change.after===null)delete details.afterHash;
  return {...details,operation:change.operation,...(change.previousResource?{previousResource:change.previousResource}:{})};
}
export function mutationVersion(change:NativeMutation):string{return change.after===null?'absent':'sha256:'+createHash('sha256').update(change.after).digest('hex');}
