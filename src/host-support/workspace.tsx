import {mt,installManagedLocale} from './locale.ts';
import {project as projectOwners} from './projection.ts';
import type {Projection} from './projection.ts';
import type {ISessions,SessionListState} from '@deepseek-ai/dsh-api-session-controller/client';
import type {Context} from '@deepseek-ai/cordis';
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store';
import {IconUsersOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {PropsRenderSlots} from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import {useEffect,useState,useSyncExternalStore,type ReactNode,type KeyboardEvent} from 'react';
type RowSlots='sidebar.workspaces.session.menu.item'|'sidebar.workspaces.session.row.action'|'sidebar.session.row.leading'|'sidebar.session.row.hover';
/** Sidebar decoration has its own projection, separate from native session control state. */
export function project(list:SessionListState,state:Projection):SessionListState {
 const value=projectOwners(list,state),detail={list:value,result:value};
 window.dispatchEvent(new CustomEvent('dsh:session-catalog-project',{detail}));return detail.result;
}
export function reusableDraft(sessionId:string):boolean {
 return window.dispatchEvent(new CustomEvent('dsh:session-reuse-candidate',{cancelable:true,detail:{sessionId}}));
}
interface NativeNode {id:SessionId;title:string;blank:boolean;running:boolean;runningSubagentCount:number;completed:boolean;pinned:boolean;archived:boolean;updatedAt:number;managedChildren?:NativeNode[];managedAvailable?:boolean;}
interface NativeRowProps {node:NativeNode;currentId:string|undefined;now:number;onOpen:(id:SessionId)=>void;onRenameRequest:(id:SessionId,title:string)=>void;renderSlot:PropsRenderSlots<RowSlots>['renderSlot'];t:(key:never,values?:never)=>string;onReveal?:(()=>void)|undefined;}
const selection=createSnapshotStore('');
const branches=createSnapshotStore<Record<string,boolean>>({});
export const useBranches=()=>useSyncExternalStore(branches.subscribe,branches.getSnapshot);
export function rowKeys(node:NativeNode,expanded:Record<string,boolean>):string[]{return ['session:'+node.id,...((expanded[node.id]??true)?(node.managedChildren??[]).flatMap(child=>rowKeys(child,expanded)):[])];}
let projection:Projection={owners:[],error:''},revealing='';
const KEY='dsh.managed-session.expansion.v1';
function saveBranch(id:string,open:boolean){const next={...branches.getSnapshot(),[id]:open};branches.set(next);try{localStorage.setItem(KEY,JSON.stringify(Object.fromEntries(Object.entries(next).slice(-1000))));}catch{}}
export function useBranch(node:NativeNode,currentId:string|undefined){
  const active=useSyncExternalStore(selection.subscribe,selection.getSnapshot)||currentId;
  const expanded=useSyncExternalStore(branches.subscribe,branches.getSnapshot);
  const children=node.managedChildren??[],hasChildren=children.length>0,open=expanded[node.id]??true;
  const ids=children.map(c=>c.id).join('\n');
  useEffect(()=>{if(active&&children.some(c=>c.id===active))saveBranch(node.id,true);},[active,node.id,ids]);
  return {hasChildren,open,selected:node.id===active,groupId:'dsh-managed-'+node.id,toggle:()=>saveBranch(node.id,!open),
    onKeyDown:(e:KeyboardEvent)=>{if(!hasChildren||e.target!==e.currentTarget||!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();saveBranch(node.id,e.key==='ArrowRight');},
  };
}
export function BranchToggle({branch,title,icon,className,indicator}:{branch:ReturnType<typeof useBranch>;title:string;icon:ReactNode;className:string;indicator?:ReactNode}){
  if(!branch.hasChildren)return indicator??null;
  return <span className="dsh-managed-leading">
    <button className={className+' dsh-managed-chevron'} type="button" title={mt('team')}
      aria-label={(branch.open?mt('collapse'):mt('expand'))+' '+title} aria-expanded={branch.open} aria-controls={branch.groupId}
      onKeyDown={branch.onKeyDown} onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
      onClick={e=>{e.stopPropagation();branch.toggle();}}>
      <span className="dsh-managed-group-icon" aria-hidden="true"><IconUsersOutlineRegular size={16}/></span>
      <span className="dsh-managed-arrow" aria-hidden="true">{icon}</span>
    </button>
    <span className="dsh-managed-indicator">{indicator}</span>
  </span>;
}
function Unavailable({node}:{node:NativeNode}){
  const [error,setError]=useState('');
  return <div className="dsh-managed-unavailable"><span>{mt('unavailable')}</span> · <a href={'/api/managed-sessions.export?sessionId='+encodeURIComponent(node.id)} download>{mt('export')}</a> <button type="button" onClick={()=>{if(window.confirm(mt('confirm')))void fetch('/api/managed-sessions.release',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:node.id})}).then(async r=>{if(!r.ok)throw new Error((await r.json()).error);}).catch(e=>setError(String(e)));}}>{mt('release')}</button>{error&&<p role="alert">{error}</p>}</div>;
}
export function Children({row,branch,NativeRow}:{row:NativeRowProps;branch:ReturnType<typeof useBranch>;NativeRow:(props:NativeRowProps)=>ReactNode}){
  const children=row.node.managedChildren??[];
  if(!children.length)return row.node.managedAvailable===false?<Unavailable node={row.node}/>:null;
  if(!branch.open)return null;
  return <div id={branch.groupId} data-managed-parent={row.node.id} role="group" className="dsh-managed-children">
    {children.map(node=><div key={node.id} data-managed-child={node.id}><NativeRow {...row} node={node} {...(revealing===node.id?{onReveal:()=>{revealing='';}}:{onReveal:undefined})}/></div>)}
  </div>;
}
export function interceptOpen(id:string){
  const event=new CustomEvent('dsh:session-open',{detail:{sessionId:id},cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;
}
export function reveal(id:string):string{
  const parent=projection.owners.find(o=>o.sessionId===id)?.parent;if(!parent)return id;
  revealing=id;saveBranch(parent,true);return parent;
}
interface RowDrag{start:()=>void;end:()=>void;active:boolean;marker:'before'|'after'|null;hover:(half:'before'|'after')=>void;drop:(half:'before'|'after')=>void;}
const rowDragging=createSnapshotStore<{id:string;parent:string;over:string;half:'before'|'after'}|null>(null);let consumed=false;
export function isExternalDrop(){return consumed;}
export function useRowDrag(node:NativeNode,native:RowDrag|undefined):RowDrag|undefined{
 const current=useSyncExternalStore(rowDragging.subscribe,rowDragging.getSnapshot),owner=projection.owners.find(o=>o.sessionId===node.id);
 if(!owner&&!native)return undefined;
 const compatible=!!owner&&current?.parent===owner.parent&&current.id!==node.id;
 return {
  start:()=>{consumed=false;if(!owner)native?.start();rowDragging.set({id:node.id,parent:owner?.parent??'',over:'',half:'before'});window.dispatchEvent(new CustomEvent('dsh:session-drag',{detail:{sessionId:node.id,title:node.title,source:'sidebar'}}));},
  end:()=>{if(!owner)native?.end();rowDragging.set(null);window.dispatchEvent(new Event('dsh:session-drag-end'));consumed=false;},
  active:owner?compatible:native?.active??false,marker:owner?(compatible&&current?.over===node.id?current.half:null):native?.marker??null,
  hover:half=>{if(owner&&compatible)rowDragging.set({...current!,over:node.id,half});else if(!owner)native?.hover(half);},
  drop:half=>{if(owner&&compatible){consumed=true;window.dispatchEvent(new CustomEvent('dsh:managed-reorder',{detail:{parent:owner.parent,source:current!.id,target:node.id,after:half==='after'}}));rowDragging.set(null);}else if(!owner)native?.drop(half);},
 };
}
/** Host-owned tree helpers stay available when any owning plugin is absent. */
export function install(ctx:Context){
  ctx.effect(()=>installManagedLocale(ctx),'managed sessions: locale');
  const source=createSnapshotStore<Projection>({owners:[],error:''});const abort=new AbortController();
  const refresh=async()=>{try{const r=await fetch('/api/managed-sessions.state',{signal:abort.signal,cache:'no-store'});if(!r.ok)throw new Error(mt('service'));const data=await r.json();if(data.protocol!==1||!Array.isArray(data.owners))throw new Error(mt('protocol'));if(!abort.signal.aborted){projection={owners:data.owners,error:''};source.set(projection);}}catch(e){if(!abort.signal.aborted)source.set({...source.getSnapshot(),error:String(e)});}};
  ctx.effect(()=>{
    try{const saved=JSON.parse(localStorage.getItem(KEY)??'{}');if(saved&&typeof saved==='object')branches.set(Object.fromEntries(Object.entries(saved).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>);}catch{}
    let paneFocus='';const sync=()=>{const panel=ctx.layout.panelInfo.getSnapshot().activePanelId;selection.set(panel==='team-desk'?paneFocus:panel?'':Object.values(((ctx.sessions as unknown as ISessions).list.getSnapshot() as SessionListState).byId).find(s=>(s.retainedBy.mainView??0)>0)?.id??'');};
    const focus=(e:Event)=>{paneFocus=(e as CustomEvent<{sessionId:string}>).detail.sessionId;sync();};
    const offSessions=(ctx.sessions as unknown as ISessions).list.subscribe(sync),offPanel=ctx.layout.panelInfo.subscribe(sync);window.addEventListener('dsh:managed-focus',focus);sync();
    const style=document.createElement('style');style.dataset.dshManagedTree='';style.textContent=`
.dsh-managed-leading{position:relative;display:inline-flex;width:16px;height:20px;flex:none}
.dsh-managed-chevron{padding:0;border:0;background:none;cursor:pointer;font:inherit}
.dsh-managed-chevron:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:var(--dsw-radius-xs)}
.dsh-managed-group-icon,.dsh-managed-arrow{display:inline-flex;align-items:center;justify-content:center}
.dsh-managed-arrow{display:none}
[data-managed-branch]:is(:hover,:focus-visible,:has(:focus-visible)) .dsh-managed-group-icon{display:none}
[data-managed-branch]:is(:hover,:focus-visible,:has(:focus-visible)) .dsh-managed-arrow{display:inline-flex}
.dsh-managed-indicator{position:absolute;right:-4px;bottom:-1px;display:inline-flex;align-items:center;justify-content:center;transform:scale(.6);transform-origin:bottom right;pointer-events:none}
.dsh-managed-indicator:empty{display:none}
.dsh-managed-children{padding-left:18px}
.dsh-managed-unavailable{font-size:12px;padding:4px 8px;color:var(--dsw-alias-label-secondary)}
`;document.head.appendChild(style);
    const refreshNow=(e:Event)=>{const waits=(e as CustomEvent<{waits:Promise<unknown>[]}>).detail?.waits;if(Array.isArray(waits))waits.push(refresh());};window.addEventListener('dsh:managed-refresh',refreshNow);
    const markConsumed=()=>{consumed=true;};window.addEventListener('dsh:managed-drag-consumed',markConsumed);
    void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{abort.abort();clearInterval(timer);window.removeEventListener('dsh:managed-drag-consumed',markConsumed);offSessions();offPanel();window.removeEventListener('dsh:managed-refresh',refreshNow);window.removeEventListener('dsh:managed-focus',focus);style.remove();};
  });
  return {source};
}
