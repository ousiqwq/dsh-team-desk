import {DockDividers} from './DockDividers.tsx';
import {observeHistoryRows} from './history-paint.ts';
import {Notice} from './ui.tsx';
import type {TeamFeedback} from './feedback.ts';
import {tr, messageText} from './locale.ts';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ReactNode,type CSSProperties} from 'react';
import {Button,Menu,IconCloseOutlineRegular,IconUsersOutlineRegular,type MenuEntry} from '@deepseek-ai/dsh-client-ui-primitives';
import type {SessionReference,SessionTarget} from '@deepseek-ai/dsh-api-session-controller/client';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {PanelProps,PaneProps} from './contracts.ts';
import {dockRects,tileDock,fitDock,pruneDock,type DockNode,type Rect} from '../domain/docking.ts';
import {targetId,missingNativeTarget} from './native-panes.ts';
import {visibleMembers,activeMember,paneTitle} from './presentation.ts';
import {dragStore,beginDrag,endDrag,consumeDrag,dockDropEffect} from './drag.ts';
import {useDockPreview,SnapPreview} from './DockPreview.tsx';
import {DockMeasurement}from'./dock-measurement.ts';
import {trackSharedHeader}from'./header-layout.ts';
import {PanePanelButton} from './PanePanelButton.tsx';
function EmbeddedPane(props:PaneProps){
 const headerMount=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
   const mount=headerMount.current;
   if(!mount)return;
   const ready=()=>{
     if(!mount.querySelector('header[data-window-drag]'))return false;
     mount.dispatchEvent(new Event('dsh:team-header-mounted',{bubbles:true}));
     return true;
   };
   if(ready())return;
   // Only watch the header slot while its native factory is loading.
   const observer=new MutationObserver(()=>{if(ready())observer.disconnect();});
   observer.observe(mount,{childList:true,subtree:true});
   return ()=>observer.disconnect();
 },[props.headerActive,props.hasSharedHeader]);
 const session=props.useSession(s=>s);
 const hasContent=props.useConversation(s=>s.activeTargets.size>0);
 const knownBlank=props.useSessions(s=>s.byId[props.sessionId]?.blank===true);
 const blank=!hasContent&&(session.blank||session.awaitingFirstTurn)&&!session.running&&!session.promptAttempted;
 const hero=blank&&(session.openState==='open'||knownBlank);
 const phase=hero?'hero':blank&&session.openState==='loading'?'settling':'active';
 return <div className="td-embedded-conversation">
  {props.headerActive&&props.hasSharedHeader&&<div style={{display:'contents'}} ref={headerMount}>{props.renderFactorySlot('conversation.shared-header',{})}</div>}
  {props.renderFactorySlot('conversation.content',{variant:'embedded',phase,hero,onWorkspaceSelected:props.openWorkspace})}
 </div>;
}
export function Pane(props:PaneProps){
 return props.legacyFrame?props.renderFactorySlot('conversation.frame',{sharedHeader:true,headerTarget:props.headerTarget,headerActive:props.headerActive}):<EmbeddedPane {...props}/>;
}
function BoundPane({target,retain,focused,retainFocused,children,onUnavailable,feedback,teamId,memberId,title}:{feedback:TeamFeedback;teamId:string;memberId:string;title:string;focused:boolean;retainFocused:PanelProps['retainFocused'];onUnavailable?:()=>void;target:SessionTarget;retain:(target:SessionTarget)=>Promise<SessionReference>;children:(ref:SessionReference)=>ReactNode}){
  const unavailable=useRef(onUnavailable);unavailable.current=onUnavailable;
  const [ref,setRef]=useState<SessionReference>(),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let retained:SessionReference|undefined,live=true,fellBack=false,unsubscribe=()=>{};setError('');setRef(undefined);
    const failed=(error:unknown)=>{if(!live)return;if(typeof target!=='string'&&missingNativeTarget(error)){fellBack=true;unavailable.current?.();}else setError(String(error));};
    void (async()=>{
      const acquired=await retain(target);
      if(!live){acquired.release();return;}
      retained=acquired;
      const binding=await acquired.ready;if(!live)return;
      const changed=()=>{if(!live||fellBack)return;const snapshot=binding.session.getSnapshot();if(typeof target!=='string'&&(snapshot.removed||missingNativeTarget(snapshot.openError))){fellBack=true;unavailable.current?.();}else setRef(acquired);};
      unsubscribe=binding.session.subscribe(changed);changed();
    })().catch(failed);
    return()=>{live=false;unsubscribe();retained?.release();};
  },[JSON.stringify(target),retain,retry]);

  const targetKey=JSON.stringify(target);
  useEffect(()=>{
    if(!focused||!ref||targetId(target)!==ref.sessionId)return;
    const viewed=retainFocused(target);
    // Releasing a pending reference on navigation may cancel its native ready promise.
    void viewed.ready.catch(()=>{});
    return ()=>viewed.release();
  },[focused,ref,targetKey,retainFocused]);
  useEffect(()=>{
    if(!error)return;
    return feedback.register({teamId,key:'retry/'+memberId,text:title+' · '+messageText(error),label:tr('重新载入会话'),apply:()=>setRetry(x=>x+1)});
  },[feedback,teamId,memberId,title,error]);
  if(error)return null;
  return ref?children(ref):<div className="td-empty" role="status">{tr("正在加载会话…")}</div>;
}

const percent=(r:Rect):CSSProperties=>({left:r.x+'%',top:r.y+'%',width:r.width+'%',height:r.height+'%'});
export function Panel(props:PanelProps){
 const team=props.useTeamDesk(s=>s.state.teams.find(t=>t.id===s.activeTeam));
 const feedback=props.feedback;
 const nativePanel=props.useTeamDesk(s=>s.nativePanel);
 const editorActions=useSyncExternalStore(feedback.subscribe,feedback.editorActions);
 const activeSession=props.useTeamDesk(s=>s.activeSession),maximized=props.useTeamDesk(s=>s.maximized),nativeTargets=props.useTeamDesk(s=>s.nativeTargets);
 const frame=props.useTeamDesk(s=>s.frame),showFocusIndicator=props.useTeamDesk(s=>s.showFocusIndicator);
 const motion=props.useTeamDesk(s=>s.preferences.motion),snapPreview=props.useTeamDesk(s=>s.preferences.snapPreview),showOtherPreviews=props.useTeamDesk(s=>s.preferences.showOtherPreviews);
 const hints=props.useTeamDesk(s=>s.titleHints);
 const catalog=props.useSessions(x=>x),drag=useSyncExternalStore(dragStore.subscribe,dragStore.getSnapshot);
 const [header,setHeader]=useState<HTMLDivElement|null>(null),[headerHeight,setHeaderHeight]=useState(76),[,invalidateGeometry]=useState(0),[menu,setMenu]=useState<{id:string;x:number;y:number}>();
 const measurement=useRef(new DockMeasurement()),geometrySource=useRef<DockNode|null>(null);
 const surface=useRef<HTMLDivElement>(null),[temporary,setTemporary]=useState<DockNode>(),[collapse,setCollapse]=useState(''),[undo,setUndo]=useState<{teamId:string;tree:DockNode;hidden:string[];after:string;closed:string}>();
 useEffect(()=>{if(surface.current)return observeHistoryRows(surface.current);},[]);
 useEffect(()=>{const node=surface.current;if(!node)return;let settled:ReturnType<typeof setTimeout>|undefined;const o=new ResizeObserver(e=>{const r=e[0]?.contentRect;if(!r)return;if(r.width!==measurement.current.width||r.height!==measurement.current.height){if(node.dataset.viewportResizing===undefined)node.dataset.viewportResizing='';clearTimeout(settled);settled=setTimeout(()=>delete node.dataset.viewportResizing,250);}if(measurement.current.update(geometrySource.current,r.width,r.height))invalidateGeometry(n=>n+1);});o.observe(node);return()=>{o.disconnect();clearTimeout(settled);delete node.dataset.viewportResizing;};},[]);
 useEffect(()=>{setTemporary(undefined);setMenu(undefined);setUndo(undefined);setCollapse('');},[team?.id]);
 const visible=team?visibleMembers(team):[],active=team?activeMember(team,activeSession):'',storedTree=(team?.dock===undefined?tileDock(visible,team?.layout):team.dock)??null,tree=temporary??fitDock(storedTree,measurement.current.width,measurement.current.height),geometry=dockRects(tree??null);geometrySource.current=temporary??storedTree;
 const max=visible.includes(maximized)?maximized:'',one=max;
 useEffect(()=>{if(active&&active!==activeSession)props.focusSession(active);},[active,activeSession]);
 useLayoutEffect(()=>{if(!header||!surface.current)return;return trackSharedHeader(header,surface.current,active,height=>setHeaderHeight(old=>old===height?old:height));},[header,active,visible.join(','),JSON.stringify(nativeTargets)]);
 const title=(id:string)=>{const target=targetId(nativeTargets?.[id]??id as SessionId) as SessionId;return paneTitle(catalog.byId[target]?.title,team?.members.find(m=>m.sessionId===id)?.label,hints?.[target]);};
 const layoutKey=JSON.stringify([storedTree,team?.hidden]);
 const undoTitle=undo?title(undo.closed):'';
 useEffect(()=>{
   if(!undo||undo.teamId!==team?.id)return;
   if(layoutKey!==undo.after){setUndo(undefined);return;}
   return feedback.register({teamId:undo.teamId,key:'undo-collapse',text:tr('已收起窗格')+' · '+undoTitle,label:tr('撤销'),
     apply:async()=>{await props.perform({action:'dock-restore',teamId:undo.teamId,dock:undo.tree,hidden:undo.hidden});setUndo(undefined);},
     dismiss:()=>setUndo(undefined)});
 },[feedback,undo,undoTitle,layoutKey,team?.id,props.perform]);
 const collapseTitle=collapse?title(collapse):'';
 useEffect(()=>{if(team&&!frame)feedback.notify(tr('当前宿主缺少原生会话接口。'));},[feedback,team?.id,frame]);
 const needsEditorButton=team&&(!visible.length||!frame||catalog.byId[targetId(nativeTargets?.[active]??active as SessionId) as SessionId]?.blank||editorActions.some(a=>a.teamId===team.id&&a.key==='retry/'+active));
 async function run(p:Promise<unknown>){try{await p;}catch(e){feedback.notify(messageText(e));}}
 const snap=useDockPreview(storedTree,drag?.sessionId,one);
 function plan(e:React.DragEvent){return surface.current?snap.resolve(e.clientX,e.clientY,surface.current.getBoundingClientRect()):undefined;}
 const items:MenuEntry[]=[{id:'single',label:tr("单独查看此会话")},{id:'max',label:max?tr("还原排布"):tr("最大化此窗格")},{id:'hide',label:tr("关闭此窗格")},{id:'settings',label:tr("编辑此团队")}];
 return <div className="td-root" data-team-desk="" data-focus-indicator={showFocusIndicator||undefined} data-reduced-motion={motion==='reduced'||undefined}>
  <div className="td-shared-header" ref={setHeader} style={{height:visible.length?headerHeight:needsEditorButton?40:0}} data-team-shared-header="">
   {needsEditorButton&&<Button size="sm" className="td-header-action td-shared-editor" data-team-header-action={active} aria-label={tr('编辑团队')} title={tr('编辑团队')} onClick={()=>props.showSettings(active||team.anchor)}><IconUsersOutlineRegular size={16}/></Button>}
  </div>
  <div className="td-dock-surface" ref={surface} data-multiple-panes={!one&&Object.keys(geometry.panes).filter(id=>visible.includes(id)).length>1||undefined} data-resizing={!!temporary||undefined} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))snap.clear();}} onDragOver={e=>{if(!drag)return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=dockDropEffect(drag);snap.show(plan(e));}} onDrop={e=>{if(!drag)return;e.preventDefault();e.stopPropagation();const id=drag.sessionId,p=plan(e);consumeDrag();snap.clear();if(p)void run(props.dockSession(id,p.target,p.zone,team?.anchor));}}>
   {!visible.length&&<div className="td-empty"><p>{tr("从左侧拖入会话，开始排布窗口")}</p><span className="td-muted">{tr("关闭窗格不会退出团队或停止任务。")}</span></div>}
   {frame&&visible.map(id=>{const r=one?{x:0,y:0,width:100,height:100}:geometry.panes[id];if(!r)return null;return <section key={id} className="td-dock-pane" style={percent(r)} data-team-session={id} data-collapse={collapse===id||undefined} data-active={id===active} data-conversation-autofocus={id===active} hidden={!!one&&one!==id} aria-label={title(id)} onFocusCapture={e=>{if(id!==active&&!(e.target as Element).closest('.td-pane-handle button'))props.focusSession(id);}} onPointerDownCapture={e=>{if(!(e.target as Element).closest('.td-pane-handle'))props.focusSession(id);}}>
    <div className="td-pane-handle" draggable onClick={()=>props.focusSession(id)} onDragStart={e=>{e.dataTransfer.effectAllowed='copyMove';e.dataTransfer.setData('text/plain',id);beginDrag({sessionId:id,title:title(id),source:'pane'});}} onDragEnd={endDrag} onDoubleClick={e=>{if(!(e.target as Element).closest('button'))props.maximize(id);}} onContextMenu={e=>{e.preventDefault();setMenu({id,x:e.clientX,y:e.clientY});}}>
      <span className="td-ellipsis" title={title(id)}>{title(id)}</span>
      <div className="td-pane-actions">
        {nativeTargets?.[id]&&<Button size="sm" onClick={()=>props.nativeHome(id)}>{tr("返回主会话")}</Button>}
        {nativePanel&&visible.length>1&&<PanePanelButton panel={nativePanel} id={targetId(nativeTargets?.[id]??id as SessionId) as SessionId} focus={()=>props.focusSession(id)}/>}
        <Button size="sm" className="td-pane-icon" aria-label={tr("关闭窗格 ")+title(id)} title={tr("仅移除当前窗格")} onClick={e=>{e.stopPropagation();if(team)void run(props.perform({action:'dock',teamId:team.id,sessionId:id,zone:'hide'}));}}><IconCloseOutlineRegular size={14}/></Button>
      </div>
    </div>
    <div className="td-native"><BoundPane feedback={feedback} teamId={team!.id} memberId={id} title={title(id)} key={targetId(nativeTargets?.[id]??id as SessionId)} target={nativeTargets?.[id]??id as SessionId} onUnavailable={()=>{props.nativeHome(id);feedback.notify(tr("子会话已不可用，已返回所属主会话。"));}} retain={props.retain} focused={id===active&&(!one||one===id)} retainFocused={props.retainFocused}>{ref=><props.SessionProvider session={ref}>{props.renderSlot('team-desk.pane',{headerTarget:header,headerActive:id===active})}</props.SessionProvider>}</BoundPane></div>
   </section>;})}
   {!one&&tree&&storedTree&&team&&<DockDividers key={team.id} tree={tree} stored={storedTree} width={measurement.current.width} height={measurement.current.height}
    preview={p=>{setTemporary(p?.tree);setCollapse(p?.collapse??'');}}
    commit={async(h,ratio,expected,close)=>{if(close){await run(props.perform({action:'dock',teamId:team.id,sessionId:close,zone:'hide',expected}).then(()=>setUndo({teamId:team.id,tree:expected,hidden:[...team.hidden],closed:close,after:JSON.stringify([pruneDock(expected,new Set(visible.filter(id=>id!==close))),[...team.hidden,close]])})));}
     else await run(props.perform({action:'dock-resize',teamId:team.id,path:h.path,ratio,expected,...(h.rotateAt!==undefined?{rotateAt:h.rotateAt}:{})}));}}/>}
   {collapseTitle&&<Notice key={collapse} text={tr('松开以收起「{p0}」· 拖回或 Esc 取消',{p0:collapseTitle})}/>}
   {drag&&<div className="td-dock-drop" data-team-drop-surface=""/>}
   {drag&&snap.preview&&snapPreview&&<SnapPreview plan={snap.preview} sessionId={drag.sessionId} showOthers={showOtherPreviews}/>}

  </div>
  {menu&&<Menu open anchor={<span/>} items={items} portal {...{anchorPoint:{x:menu.x,y:menu.y},contextual:true,getAnchorRect:()=>new DOMRect(menu.x,menu.y,1,1)}} onClose={()=>setMenu(undefined)} onSelect={key=>{const id=menu.id;setMenu(undefined);if(key==='single')props.returnToChat(id);if(key==='max')props.maximize(id);if(key==='settings')props.showSettings(id);if(key==='hide'&&team)void run(props.perform({action:'dock',teamId:team.id,sessionId:id,zone:'hide'}));}}/>}
 </div>;
}
