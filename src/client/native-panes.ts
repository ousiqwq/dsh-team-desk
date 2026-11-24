import type {SessionTarget,SessionListState} from '@deepseek-ai/dsh-api-session-controller/client';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {SubagentAddress} from '@deepseek-ai/dsh-subagent/client';

export const targetId=(target:SessionTarget):string=>typeof target==='string'?target:target.childSessionId;
export function nativeAddress(value:unknown):value is SubagentAddress {
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 return ['parentSessionId','childSessionId'].every(k=>typeof row[k]==='string'&&!!row[k]&&String(row[k]).length<=300)&&['continuable','one-shot','unknown'].includes(String(row.mode));
}
/** Display targets are local navigation state. They never become outer team members. */
export class NativePanes {
 private readonly key='dsh.team-desk.native-panes.v1';
 private targets:Record<string,SubagentAddress>;
 constructor(private readonly storage?:Pick<Storage,'getItem'|'setItem'>,private readonly tab?:Pick<Storage,'getItem'|'setItem'>){
  this.targets=this.read(tab)??this.read(storage)??Object.create(null);
  this.write(tab,this.targets);
 }
 private read(store:typeof this.storage):Record<string,SubagentAddress>|undefined {
  try {
   const raw=store?.getItem(this.key);if(!raw)return;
   const rows=Object.entries(JSON.parse(raw)).filter(([root,target])=>root.length<=300&&nativeAddress(target)).slice(-100);
   return Object.assign(Object.create(null),Object.fromEntries(rows));
  } catch {return undefined;}
 }
 private write(store:typeof this.storage,targets:Record<string,SubagentAddress>){try{store?.setItem(this.key,JSON.stringify(targets));}catch{}}
 snapshot(){return {...this.targets};}
 target(root:string):SessionTarget{return this.targets[root]??root as SessionId;}
 owner(id:string){return Object.keys(this.targets).find(root=>root===id||targetId(this.targets[root]!)===id);}
 select(root:string,target:SubagentAddress|undefined){
  const shared=this.read(this.storage)??Object.create(null);
  if(target){this.targets[root]=target;shared[root]=target;}else{delete this.targets[root];delete shared[root];}
  this.write(this.tab,this.targets);this.write(this.storage,shared);return this.snapshot();
 }
}

/** Resolve a native catalog edge without guessing a child id's parent or execution mode. */
export function catalogAddress(state:SessionListState,root:string,id:string):SubagentAddress|undefined {
 const pending=[root],seen=new Set<string>();while(pending.length&&seen.size<2048){const parent=pending.shift()!;if(seen.has(parent))continue;seen.add(parent);
  for(const entry of state.projectionsBySession[parent as SessionId]?.values.subagentCatalog??[]){if(entry.mode==='external')continue;const address={parentSessionId:parent as SessionId,childSessionId:entry.id,mode:entry.mode};if(entry.id===id)return address;pending.push(entry.id);}
 }
 return undefined;
}

export function missingNativeTarget(error:unknown):boolean {
 if(!error||typeof error!=='object')return false;
 const row=error as {code?:string;rpcError?:{code?:string}};
 return [row.code,row.rpcError?.code].some(code=>['subagent/not-found','session/not-found'].includes(code??''));
}

/** Native menus can outlive pane focus; route by verified lineage, not by the last clicked pane. */
export function nativeOwner(state:SessionListState,roots:string[],target:SessionTarget):string|undefined {
 const id=typeof target==='string'?target:target.parentSessionId;
 return roots.find(root=>root===id||!!catalogAddress(state,root,id));
}
