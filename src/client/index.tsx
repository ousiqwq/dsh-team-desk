import {IconSettingsOutlineRegular,IconCompareSplitOutlineRegular,IconNewChatOutlineRegular,IconFullscreenOutlineRegular,IconCloseOutlineRegular,IconLinkOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import {confirmDetach} from './member-actions.ts';
import {applyChatDelta} from '../domain/chat-state.ts';
import {draftGuard} from './draft-guard.ts';
import {tr, messageText, NS, installLocale} from './locale.ts';
import type {SessionListState} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client';
import type { Context } from '@deepseek-ai/cordis';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import {MenuItemButton,IconUsersOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type { Injected, ViewData, EntryProps, LayoutChange, OverlayProps } from './contracts.ts';
import type {Team} from '../domain/types.ts';
import {Notice} from './ui.tsx';
import {useSyncExternalStore} from 'react';
import {TeamFeedback} from './feedback.ts';
import {BlockedRequestNotice} from './BlockedRequests.tsx';
import * as attachmentDrop from '../host-support/attachment-drop.ts';
import {workspaceView} from './workspace-view.ts';
import type {SessionPanelToggleInjected} from '@deepseek-ai/dsh-client-ui-session-panel/client';
import {TeamSessionSection} from './TeamSessionSection.tsx';
import { Panel, Pane } from './Panel.tsx';
import {TeamDialog} from './Settings.tsx';
import {DropReceiver} from './DropReceiver.tsx';
import {TrashTarget} from './TrashTarget.tsx';
import {installMemberCatalog} from './member-catalog.ts';
import {HeaderAction,HomeAction} from './HeaderAction.tsx';
import {NativePanes,nativeAddress,targetId,catalogAddress,nativeOwner} from './native-panes.ts';
import {visibleMembers} from './presentation.ts';
import {DisplayPreferences} from './display-preferences.ts';
import {ViewMemory} from './view-memory.ts';
import {sidebarTeamTarget,retainPaneSession,settingsSessionTarget} from './session-navigation.ts';
import {TeamSessionCatalog,reserveTeamDrafts} from './session-catalog.ts';
import {beginDrag,dockDropEffect,endDrag,dragStore} from './drag.ts';
import {installSidebarSessionDrop} from './sidebar-session-drop.ts';
import {defaults} from '../domain/preference-values.ts';
import {editorCss} from './editor-style.ts';
import { css } from './style.ts';
import {syncCss} from './sync-style.ts';
import {installSyncRenderers} from './sync-renderers.tsx';
export const inject=['slots','locale','sessions','layout','uiSession','uiWorkspace','uiConversation'];
export function apply(ctx:Context){
  ctx.effect(()=>installLocale(ctx),'team-desk: locale');
  const display=new DisplayPreferences({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)});
  const state=createSnapshotStore<ViewData>({showFocusIndicator:display.showFocusIndicator,state:{version:6,revision:0,teams:[],messages:[],presets:[],events:[]},statuses:{},ready:false,error:'',activeTeam:'',activeSession:'',maximized:'',settingsTeam:'',settingsSession:'',frame:false,dialog:false,preferences:{...defaults}});
  ctx.effect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(draftGuard.dirty){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',leave);return()=>window.removeEventListener('beforeunload',leave);});
  const slots=ctx.slots,layout=ctx.layout,sessions=ctx.sessions,workspace=ctx.uiWorkspace;
  const memory=new ViewMemory(
    {getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},
    {getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value)},
  );
  const nativePanes=new NativePanes({getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value)});let bypassNative=false;setTimeout(()=>set({nativeTargets:nativePanes.snapshot()}),0);
  const feedback=new TeamFeedback();
  const hostView=workspaceView(window,localStorage);
  let navigation=0,restorePending=true;
  let recoveryNavigation:AbortSignal|undefined;
  const teamPanelAvailable=()=>slots.entries('main').some(entry=>entry.options.key==='team-desk');
  let disposed=false,chain:Promise<unknown>=Promise.resolve();const abort=new AbortController();
  let uiStops:(()=>void)[]=[];
  const removeUI=()=>{for(const stop of uiStops.reverse())stop();uiStops=[];};
  const set=(change:Partial<ViewData>)=>{if(disposed)return;const prior=state.getSnapshot();state.set({...prior,...change});if(change.error&&change.error!==prior.error)feedback.notify(messageText(change.error));if((change.dialog!==undefined&&change.dialog!==prior.dialog)||(prior.dialog&&((change.managementPage!==undefined&&change.managementPage!==prior.managementPage)||(change.settingsTeam!==undefined&&change.settingsTeam!==prior.settingsTeam))))queueMicrotask(()=>{if(!disposed)void refresh();});};
  ctx.effect(()=>{
    const catalog=new TeamSessionCatalog(),release=reserveTeamDrafts(sessions.list,catalog,window,()=>hostView.get().expansion);
    let prevTeams:Team[]|undefined,prevHints:ViewData['titleHints'];
    const update=()=>{const {state:data,titleHints}=state.getSnapshot();if(data.teams===prevTeams&&titleHints===prevHints)return;
      prevTeams=data.teams;prevHints=titleHints;if(catalog.setTeams(data.teams,titleHints))void sessions.refresh().catch(error=>{if(!disposed)set({error:String(error)});});};
    const off=state.subscribe(update);update();
    return()=>{off();release();};
  },'team-desk: reserve member drafts');
  let snapshotTag='',lastMetadata='',requested=0,applied=0;
  const refresh=async()=>{
    const request=++requested,view=state.getSnapshot().dialog?'manage':'chat';
    const scope=()=>{const s=state.getSnapshot();return s.dialog?JSON.stringify([s.settingsTeam,s.managementPage??'graph']):'';};
    const requestedScope=scope(),query=new URLSearchParams({view,known:snapshotTag});
    if(requestedScope){const [id,page]=JSON.parse(requestedScope);query.set('teamId',id);query.set('page',page);}
    try{const response=await fetch('/api/team-desk.state?'+query,{signal:abort.signal,cache:'no-store'});
      if(disposed||request<applied||requestedScope!==scope())return;
      if(response.status===404){
        applied=request;snapshotTag='';lastMetadata='';
        const prior=state.getSnapshot(),anchor=prior.state.teams.find(t=>t.id===prior.activeTeam)?.anchor;
        if(layout.panelInfo.getSnapshot().activePanelId==='team-desk'){
          restorePending=!!memory.current;
          bypassNative=true;
          try{
            if(anchor&&sessions.list.getSnapshot().byId[anchor as SessionId])workspace.openSession(anchor as SessionId);
            else layout.selectPanel(null);
          }finally{bypassNative=false;}
          if(restorePending)recoveryNavigation=layout.beginNavigation();
        }
        removeUI();set({ready:false,activeTeam:'',activeSession:'',maximized:'',state:{...prior.state,teams:[],messages:[]},error:''});return;
      }
      if(!response.ok)throw new Error(tr("团队服务暂时不可用"));const data=await response.json();if(!state.getSnapshot().ready)await sessions.refresh();if(disposed||request<applied)return;
      if(requestedScope!==scope())return;
      if(data.unchanged&&data.snapshotTag!==snapshotTag||data.delta&&data.baseTag!==snapshotTag)return;
      applied=request;
      mountUI();
      const prior=state.getSnapshot();
      const meta={loadedPage:requestedScope,legacyTeamIds:data.legacyTeamIds??[],archivedIds:data.archivedIds??[],snapshotView:data.view,titleHints:data.titleHints??{},syncPending:data.syncPending??[],health:data.health,statuses:data.statuses,frame:slots.snapshot('factory:conversation.frame').length>0||slots.snapshot('factory:conversation.content').length>0,preferences:data.preferences??defaults};
      const signature=JSON.stringify(meta);
      if(!data.unchanged||signature!==lastMetadata||state.getSnapshot().error)set({...meta,...(data.unchanged?{}:{state:data.delta?applyChatDelta(state.getSnapshot().state,data.delta):data}),ready:true,error:''});
      const view=state.getSnapshot(),currentTeam=view.state.teams.find(team=>team.id===view.activeTeam);
      if(view.activeTeam&&(!currentTeam||view.archivedIds?.includes(currentTeam.anchor))){
        const id=[view.activeSession,prior.state.teams.find(t=>t.id===view.activeTeam)?.anchor].find(id=>id&&!view.archivedIds?.includes(id)&&sessions.list.getSnapshot().byId[id as SessionId]);
        const wasOpen=layout.panelInfo.getSnapshot().activePanelId==='team-desk';
        restorePending=false;
        if(!currentTeam)memory.forget(view.activeTeam);else memory.leave();
        set({activeTeam:'',activeSession:'',maximized:''});
        if(wasOpen){
          bypassNative=true;
          try{
            layout.selectPanel(null);
            if(id&&!view.archivedIds?.includes(id)&&sessions.list.getSnapshot().byId[id as SessionId])workspace.openSession(id as SessionId);
          }finally{bypassNative=false;}
        }
      }else if(currentTeam&&view.activeSession&&!currentTeam.members.some(member=>member.sessionId===view.activeSession)){
        const sessionId=currentTeam.order.find(id=>!currentTeam.hidden.includes(id))??currentTeam.anchor;
        set({activeSession:sessionId,maximized:''});
        if(layout.panelInfo.getSnapshot().activePanelId==='team-desk')window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId}}));
      }
      lastMetadata=signature;snapshotTag=data.snapshotTag??'';
      if(restorePending){
        const saved=memory.current,panel=layout.panelInfo.getSnapshot().activePanelId;
        const team=saved&&state.getSnapshot().state.teams.find(t=>t.id===saved.teamId);
        if(team&&!view.archivedIds?.includes(team.anchor)&&!recoveryNavigation?.aborted&&(panel===null||panel==='team-desk')){
          if(!teamPanelAvailable())return;
          restorePending=false;recoveryNavigation=undefined;activateTeam(team,saved!.sessionId);
        }else{restorePending=false;recoveryNavigation=undefined;memory.leave();}
      }
    }
    catch(error){if(!disposed&&request>=applied&&requestedScope===scope())set({error:String(error)});}
  };
  const mutate=async(data:Record<string,unknown>)=>{
    const response=await fetch('/api/team-desk.action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal:abort.signal});const result=await response.json();if(!response.ok)throw new Error(result.error??tr("操作失败"));
    const waits:Promise<unknown>[]=[];window.dispatchEvent(new CustomEvent('dsh:managed-refresh',{detail:{waits}}));await Promise.allSettled(waits);
    if(['create','add','preset-prepare','team-apply','team-configure','detach','dissolve'].includes(String(data.action)))await sessions.refresh();await refresh();return result;
  };
  function serial<T>(run:()=>Promise<T>){const p=chain.then(run);chain=p.catch(()=>{});return p;}
  const perform=(data:Record<string,unknown>)=>serial(()=>mutate(data));
  const updateLayout=(teamId:string,change:LayoutChange)=>serial(async()=>{
    const t=state.getSnapshot().state.teams.find(t=>t.id===teamId);if(!t)throw new Error(tr("团队不存在"));
    await mutate({action:'view',teamId,...change});
  });
  const owner=(id:string)=>nativePanes.owner(id)??id;
  const belongs=(id:string)=>state.getSnapshot().state.teams.find(t=>t.members.some(m=>m.sessionId===id));
  const focusSession=(id:string)=>{const t=belongs(id),current=state.getSnapshot();if(!t||(current.activeTeam===t.id&&current.activeSession===id))return;set({activeTeam:t.id,activeSession:id,maximized:state.getSnapshot().maximized?id:''});window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId:id}}));};
  const showSettings=(id?:string)=>draftGuard.request(()=>{const main=Object.values((sessions.list.getSnapshot() as SessionListState).byId).find(s=>(s.retainedBy.mainView??0)>0)?.id;const current=owner(settingsSessionTarget(id,layout.panelInfo.getSnapshot().activePanelId,state.getSnapshot().activeSession,main));const t=belongs(current);set({settingsTeam:t?.id??'',settingsSession:current,managementPage:'graph',dialog:true});});
  const createTeam=(id:string):Promise<void>=>{
    const request=++navigation;restorePending=false;
    return serial(async()=>{
      await refresh();if(disposed)return;
      const item=sessions.list.getSnapshot().byId[id as SessionId];if(!item)throw Error(tr('会话已不可用，请刷新后重试。'));
      let team=belongs(id);
      if(!team){team=await mutate({action:'create',sessionId:id,title:item.title?.slice(0,120)||tr('协作团队'),autoLink:false}) as Team;await mutate({action:'view',teamId:team.id,layout:state.getSnapshot().preferences.defaultLayout});}
      if(!disposed&&request===navigation)set({settingsTeam:team.id,settingsSession:id,dialog:true});
    }).catch(error=>{if(!disposed&&request===navigation)set({error:String(error)});});
  };
  function activateTeam(t:Team,requested:string){
    const view=memory.forTeam(t,requested);
    set({activeTeam:t.id,activeSession:view.sessionId,maximized:view.maximized,error:''});
    if(t.hidden.includes(requested))feedback.notify(tr("此窗格已关闭；已恢复保存的排布，从左侧拖入可重新显示。"));
    layout.selectPanel('team-desk' as MainPanelId);window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId:view.sessionId}}));saveView();
  }
  const open=async(id:string)=>{const request=++navigation;restorePending=false;try{
    await chain;await refresh();if(disposed||request!==navigation)return;const t=belongs(id);if(!t){showSettings(id);return;}activateTeam(t,id);
  }catch(e){if(request===navigation)set({error:String(e)});}};
  const dockSession:Injected['dockSession']=(id,target,zone='right',anchor)=>{const request=++navigation;restorePending=false;return serial(async()=>{
    await refresh();const catalog=(sessions.list.getSnapshot() as SessionListState).byId,item=catalog[id as SessionId],base=anchor||state.getSnapshot().activeSession||id;
    let t=belongs(base);const source=belongs(id);
    if(!item||!catalog[base as SessionId])throw new Error(tr("会话已不可用，请刷新后重试。"));
    // Validate before creating a team: a rejected drop must not mutate the workspace.
    if(source&&source.id!==t?.id)throw new Error(tr("此会话属于另一个团队，请先在原团队中移出。"));
    if(!source&&item.cwd!==(t?.cwd??catalog[base as SessionId]!.cwd))throw new Error(tr("只能拖入同一工作目录中的会话。"));
    const creating=!t;
    if(!t)t=await mutate({action:'create',sessionId:base,title:(catalog[base as SessionId]?.title||tr("协作团队")).slice(0,120),autoLink:false,
      drop:{sessionId:id,label:(item.title||tr("成员")).slice(0,120),layout:state.getSnapshot().preferences.defaultLayout,zone,...(target&&{target})}}) as Team;
    if(source&&source.id!==t.id)throw new Error(tr("此会话属于另一个团队，请先在原团队中移出。"));
    const attach=!t.members.some(m=>m.sessionId===id),replaceOnAdd=attach&&zone==='replace';
    if(replaceOnAdd&&!target)throw new Error(tr("Replacement pane changed"));
    if(attach)await mutate({action:'add',teamId:t.id,label:(item.title||tr("成员")).slice(0,120),existing:id,autoLink:false,...(replaceOnAdd?{replaceTarget:target}:{})});
    if(!creating&&!replaceOnAdd)await mutate({action:'dock',teamId:t.id,sessionId:id,...(target?{target}:{}),zone});
    if(request===navigation){set({activeTeam:t.id,activeSession:id,maximized:'',error:''});layout.selectPanel('team-desk' as MainPanelId);focusSession(id);}
  });};
  async function openMember(root:string,target:import('@deepseek-ai/dsh-api-session-controller/client').SessionTarget){
    const team=belongs(root);if(!team)throw Error(tr('团队不存在'));
    const shown=visibleMembers(team);
    if(!shown.includes(root)){
      const active=state.getSnapshot().activeSession,at=shown.includes(active)?active:shown[shown.length-1];
      const request=navigation+1;
      await dockSession(root,at,shown.length>=4?'replace':'right',team.anchor);
      if(disposed||request!==navigation)return false;
    }else{++navigation;restorePending=false;activateTeam(team,root);}
    set({nativeTargets:nativePanes.select(root,typeof target==='string'?undefined:target)});
    return true;
  }
  const injected:Injected={selectManagementPage:managementPage=>set({managementPage}),feedback,hasSettingsFactory:()=>slots.snapshot('factory:settings.dialog').length>0,setFocusIndicator:value=>{display.setFocusIndicator(value);set({showFocusIndicator:value});},nativeConfigForm:namespace=>ctx.get('configForms')?.get<Record<string,unknown>>(namespace),hooks:{teamDesk:state},perform,updateLayout,open:id=>{void open(id);},showSettings,createTeam,chooseSettingsTeam:id=>draftGuard.request(()=>set({settingsTeam:id,settingsSession:''})),closeSettings:()=>draftGuard.request(()=>set({dialog:false})),dockSession,focusSession,maximize:id=>set({maximized:state.getSnapshot().maximized===id?'':id,activeSession:id}),returnToChat:id=>{++navigation;restorePending=false;const team=belongs(id);if(team)memory.preferSingle(team.id);else memory.leave();bypassNative=true;try{workspace.openSession(id as SessionId);}finally{bypassNative=false;}},retain:target=>retainPaneSession(sessions,target),retainFocused:target=>sessions.retain(target,{source:'mainView'}),nativeHome:root=>set({nativeTargets:nativePanes.select(root,undefined)}),memberOwner:owner,openMemberTarget:(root,target)=>{void openMember(root,target).catch(e=>feedback.notify(messageText(String(e))));},
  openGitDiff:async id=>{
    const sidebar=ctx.get('sidebarRight');
    const forge=ctx.get('forgeChanges') as {open(target:{sessionId:SessionId;source:{kind:'local'}}):void}|undefined;
    if(!sidebar||!forge)throw Error(tr('请在 DSH 插件页面启用官方“变更请求与工作树”。'));
    if(!await openMember(id,id as SessionId))return;
    const generation=navigation;
    if(sidebar.mounted.getSnapshot()!==id)await new Promise<void>((resolve,reject)=>{
      const finish=(ok:boolean)=>{off();clearTimeout(timer);ok?resolve():reject(Error(tr('会话已不可用，请刷新后重试。')));};
      const check=()=>{if(disposed||navigation!==generation)finish(false);else if(sidebar.mounted.getSnapshot()===id)finish(true);};
      const off=sidebar.mounted.subscribe(check),timer=setTimeout(()=>finish(false),3500);check();
    });
    if(generation===navigation&&sidebar.mounted.getSnapshot()===id)forge.open({sessionId:id as SessionId,source:{kind:'local'}});
  }};
  ctx.effect(()=>{
    const sync=()=>{
      const view=state.getSnapshot(),seat=layout.panelInfo.getSnapshot().activePanelId==='team-desk'?view.activeSession:undefined;
      const parent=seat&&seat!==hostView.get().seat?belongs(seat)?.anchor:undefined;
      hostView.focus(seat||undefined,seat?targetId(nativePanes.target(seat)):undefined,parent!==seat?parent:undefined);
    };
    const stopState=state.subscribe(sync),stopPanel=layout.panelInfo.subscribe(sync);sync();
    return ()=>{stopState();stopPanel();hostView.dispose();};
  },'team-desk: native workspace selection');
  ctx.effect(()=>{
    const target=(raw:Event)=>{
      if(layout.panelInfo.getSnapshot().activePanelId!=='team-desk')return;
      const event=raw as CustomEvent<{owner:HTMLElement|null;event:DragEvent}>;
      if(!attachmentDrop.accepts(event.detail.event,event.detail.owner))event.preventDefault();
      else if(event.detail.event.type==='drop')attachmentDrop.focus(event.detail.owner);
    };
    const overlay=(raw:Event)=>{
      const detail=(raw as CustomEvent<{owner:HTMLElement|null;style?:ReturnType<typeof attachmentDrop.overlayStyle>}>).detail;
      if(layout.panelInfo.getSnapshot().activePanelId==='team-desk')detail.style=attachmentDrop.overlayStyle(detail.owner);
    };
    window.addEventListener('dsh:attachment-drop-target',target);window.addEventListener('dsh:attachment-drop-overlay',overlay);
    return ()=>{window.removeEventListener('dsh:attachment-drop-target',target);window.removeEventListener('dsh:attachment-drop-overlay',overlay);};
  },'team-desk: route files to the drop target');
  function Entry(props:EntryProps){
    const data=props.useTeamDesk(x=>x),t=data.state.teams.find(t=>t.members.some(m=>m.sessionId===props.sessionId));const [,close]=props.useMenuOpenState();
    const selected=props.usePanelInfo(x=>x.activePanelId)==='team-desk'&&data.activeTeam===t?.id;
    const act=(fn:()=>void)=>{close(false);fn();};
    return <>
      <MenuItemButton icon={<IconSettingsOutlineRegular/>} separatorBefore onSelect={()=>act(()=>props.showSettings(props.sessionId))}>{t?tr("编辑此团队"):tr("创建团队")}</MenuItemButton>
      {t&&<MenuItemButton icon={<IconCompareSplitOutlineRegular/>} onSelect={()=>act(()=>props.open(props.sessionId))}>{selected?tr("聚焦此窗格"):tr("并排查看团队")}</MenuItemButton>}
      {t&&t.anchor!==props.sessionId&&<MenuItemButton icon={<IconLinkOutlineRegular/>} onSelect={()=>act(()=>{
        if(confirmDetach(t.members.find(member=>member.sessionId===props.sessionId)!.label))
          void props.perform({action:'detach',teamId:t.id,sessionId:props.sessionId,bindingId:t.members.find(m=>m.sessionId===props.sessionId)?.bindingId}).catch(e=>set({error:String(e)}));
      })}>{tr('解除绑定')}</MenuItemButton>}
      {t&&selected&&<>
        <MenuItemButton icon={<IconNewChatOutlineRegular/>} onSelect={()=>act(()=>props.returnToChat(props.sessionId))}>{tr("单独查看此会话")}</MenuItemButton>
        <MenuItemButton icon={<IconFullscreenOutlineRegular/>} onSelect={()=>act(()=>props.maximize(props.sessionId))}>{data.maximized===props.sessionId?tr("还原分屏"):tr("最大化此窗格")}</MenuItemButton>
        <MenuItemButton icon={<IconCloseOutlineRegular/>} onSelect={()=>act(()=>{void props.perform({action:'dock',teamId:t.id,sessionId:props.sessionId,zone:'hide'}).catch(e=>set({error:String(e)}));})}>{tr("关闭此窗格")}</MenuItemButton>
      </>}
    </>;
  }
  ctx.effect(()=>{
    const resume=()=>{if(document.visibilityState==='visible')void refresh();};
    const timer=setInterval(()=>void refresh(),1500);void refresh();
    document.addEventListener('visibilitychange',resume);window.addEventListener('pageshow',resume);window.addEventListener('online',resume);
    return()=>{disposed=true;abort.abort();clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('pageshow',resume);window.removeEventListener('online',resume);removeUI();};
  });
  ctx.effect(()=>{
    const drag=(event:Event)=>beginDrag((event as CustomEvent).detail);
    const reorder=(event:Event)=>{const d=(event as CustomEvent).detail,t=belongs(d.parent);if(t)void perform({action:'reorder',teamId:t.id,source:d.source,target:d.target,after:d.after}).catch(e=>set({error:String(e)}));};
    const nativeDrag=(e:DragEvent)=>{
      delete document.documentElement.dataset.tdRejectRowDrop;
      const id=e.dataTransfer?.getData('application/x-dsh-session')||(e.target instanceof Element?e.target.closest<HTMLElement>('[data-row-key^="session:"]')?.dataset.rowKey?.slice(8):undefined);
      if(!id)return;
      const row=sessions.list.getSnapshot().byId[id as SessionId];
      if(row)beginDrag({sessionId:id,title:row.displayTitle,source:'sidebar'});
    };
    let marked:HTMLElement|undefined;
    const clearMark=()=>{if(marked)delete marked.dataset.tdReorder;marked=undefined;};
    const endSidebarDrag=()=>{clearMark();delete document.documentElement.dataset.tdRejectRowDrop;endDrag();};
    const reorderRow=(e:DragEvent)=>{
      const source=dragStore.getSnapshot(),row=e.target instanceof Element?e.target.closest<HTMLElement>('[data-row-key^="session:"]'):null;
      const target=row?.dataset.rowKey?.slice(8),team=source&&belongs(source.sessionId);
      if(!row||!source||source.source!=='sidebar'||!target){
        clearMark();return;
      }
      const targetTeam=belongs(target);
      const memberDrag=team&&source.sessionId!==team.anchor;
      if(!memberDrag&&(!targetTeam||target===targetTeam.anchor)){
        clearMark();delete document.documentElement.dataset.tdRejectRowDrop;return;
      }
      // Native DSH can commit its last hovered row at dragend, even on cancellation.
      // A member's order belongs to its team. Keep the native list out of the
      // entire row gesture, including invalid targets crossed on the way to a pane.
      e.stopPropagation();
      if(!memberDrag||targetTeam!==team||target===source.sessionId||target===team.anchor){
        clearMark();
        document.documentElement.dataset.tdRejectRowDrop='';
        if(e.dataTransfer)e.dataTransfer.dropEffect='none';
        return;
      }
      delete document.documentElement.dataset.tdRejectRowDrop;
      const box=row.getBoundingClientRect(),after=e.clientY>box.top+box.height/2;
      e.preventDefault();
      if(e.type==='drop'){
        endSidebarDrag();
        void perform({action:'reorder',teamId:team.id,source:source.sessionId,target,after}).catch(error=>set({error:String(error)}));
      }else{
        if(marked!==row)clearMark();
        marked=row;row.dataset.tdReorder=after?'after':'before';
        if(e.dataTransfer)e.dataTransfer.dropEffect=dockDropEffect(source);
      }
    };
    document.addEventListener('dragover',reorderRow,true);document.addEventListener('drop',reorderRow,true);
    document.addEventListener('dragstart',nativeDrag);document.addEventListener('dragend',endSidebarDrag);
    const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape')endDrag();};
    window.addEventListener('dsh:session-drag',drag);window.addEventListener('dsh:session-drag-end',endDrag);window.addEventListener('dsh:managed-reorder',reorder);window.addEventListener('keydown',cancel);
    return()=>{document.removeEventListener('dragstart',nativeDrag);document.removeEventListener('dragend',endSidebarDrag);document.removeEventListener('dragover',reorderRow,true);document.removeEventListener('drop',reorderRow,true);window.removeEventListener('dsh:session-drag',drag);window.removeEventListener('dsh:session-drag-end',endDrag);window.removeEventListener('dsh:managed-reorder',reorder);window.removeEventListener('keydown',cancel);endSidebarDrag();};
  });
  ctx.effect(()=>{
    const nativeOpen=(raw:Event)=>{const event=raw as CustomEvent<{target:unknown}>;if(event.defaultPrevented||bypassNative)return;
      if(layout.panelInfo.getSnapshot().activePanelId!=='team-desk'){
        const target=event.detail?.target;
        const parent=typeof target==='string'?belongs(target):undefined;
        const selection=ctx.uiSession.adapter.current.getSnapshot(),child=selection.key;
        if(parent&&child&&memory.hasSplit(parent.id)&&sessions.subagentAddress(child as SessionId)?.parentSessionId===target){
          event.preventDefault();restorePending=false;set({nativeTargets:nativePanes.select(target as string,undefined)});activateTeam(parent,target as string);return;
        }
        if(restorePending){restorePending=false;memory.leave();}
        return;
      }
      const d=state.getSnapshot(),t=d.state.teams.find(t=>t.id===d.activeTeam),target=event.detail?.target;if(!t||typeof target!=='string'&&!nativeAddress(target))return;
      const catalog=sessions.list.getSnapshot(),root=nativeOwner(catalog,visibleMembers(t),target as import('@deepseek-ai/dsh-api-session-controller/client').SessionTarget);if(!root)return;
      const address=typeof target==='string'?target===root?undefined:catalogAddress(catalog,root,target):target;
      event.preventDefault();set({activeSession:root,maximized:d.maximized?root:'',nativeTargets:nativePanes.select(root,address)});window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId:root}}));
    };
    window.addEventListener('dsh:native-session-open',nativeOpen);
    return()=>window.removeEventListener('dsh:native-session-open',nativeOpen);
  });
  ctx.effect(()=>{
    const intercept=(raw:Event)=>{const event=raw as CustomEvent<{sessionId:string}>;if(event.defaultPrevented)return;
      restorePending=false;const current=state.getSnapshot(),t=sidebarTeamTarget(current.state.teams,layout.panelInfo.getSnapshot().activePanelId,current.activeTeam,event.detail.sessionId,id=>memory.hasSplit(id));if(!t){++navigation;memory.leave();return;}
      event.preventDefault();void open(event.detail.sessionId);
    };
    // Native alpha rows expose their stable session key for pointer and keyboard navigation.
    const selectRow=(event:MouseEvent|KeyboardEvent)=>{
      if(!state.getSnapshot().ready||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!(event.target instanceof Element))return;
      const row=event.target.closest<HTMLElement>('[role="treeitem"][data-row-key^="session:"]');
      if(!row||event.target.closest('button,a,input,[contenteditable="true"]'))return;
      if(event instanceof KeyboardEvent&&event.target===row&&['ArrowLeft','ArrowRight'].includes(event.key)&&row.dataset.teamBranch==='root'){
        const id=row.dataset.rowKey!.slice(8),open=hostView.get().expansion[id]!==false;
        if(open!==(event.key==='ArrowRight'))hostView.toggle(id);
        else if(open){
          const tree=row.closest('[role="tree"]')??document;
          const child=Array.from(tree.querySelectorAll<HTMLElement>('[data-team-branch="member"],[data-team-branch="last"]'))
            .find(item=>belongs(item.dataset.rowKey?.slice(8)??'')?.anchor===id);
          child?.focus();
        }
        event.preventDefault();event.stopPropagation();return;
      }
      if(event instanceof KeyboardEvent&&event.target===row&&event.key==='ArrowLeft'&&['last','member'].includes(row.dataset.teamBranch??'')){
        const parent=belongs(row.dataset.rowKey!.slice(8))?.anchor;
        if(parent){document.querySelector<HTMLElement>('[data-row-key="session:'+CSS.escape(parent)+'"]')?.focus();event.preventDefault();event.stopPropagation();return;}
      }
      if(event instanceof KeyboardEvent&&(event.target!==row||!['Enter',' '].includes(event.key)))return;
      if(event instanceof MouseEvent&&event.button!==0)return;
      const id=row.dataset.rowKey!.slice('session:'.length),view=state.getSnapshot();
      const team=sidebarTeamTarget(view.state.teams,layout.panelInfo.getSnapshot().activePanelId,view.activeTeam,id,key=>memory.hasSplit(key));
      if(!team)return;
      event.preventDefault();event.stopPropagation();void open(id);
    };
    document.addEventListener('click',selectRow,true);document.addEventListener('keydown',selectRow,true);
    let previousPanel=layout.panelInfo.getSnapshot().activePanelId;
    const panelChanged=()=>{
      const panel=layout.panelInfo.getSnapshot().activePanelId,last=previousPanel;
      if(disposed||panel===last)return;
      previousPanel=panel;
      if(panel==='team-desk'){saveView();return;}
      // DSH returns to its native conversation if the registered main slot disappears.
      if(panel===null&&last==='team-desk'&&!teamPanelAvailable()&&memory.current){
        restorePending=true;recoveryNavigation=layout.beginNavigation();
      }else if(panel!==null||!restorePending){++navigation;restorePending=false;memory.leave();}
      const current=state.getSnapshot();
      if(current.activeTeam||current.activeSession||current.maximized)set({activeTeam:'',activeSession:'',maximized:''});
      window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId:''}}));
    };
    window.addEventListener('dsh:session-open',intercept);const off=layout.panelInfo.subscribe(panelChanged),offState=state.subscribe(saveView);
    return()=>{off();offState();document.removeEventListener('click',selectRow,true);document.removeEventListener('keydown',selectRow,true);window.removeEventListener('dsh:session-open',intercept);window.dispatchEvent(new CustomEvent('dsh:managed-focus',{detail:{sessionId:''}}));};
  });
  function saveView(){const d=state.getSnapshot();if(disposed||restorePending||!d.ready||layout.panelInfo.getSnapshot().activePanelId!=='team-desk'||!d.state.teams.some(t=>t.id===d.activeTeam))return;memory.remember({teamId:d.activeTeam,sessionId:d.activeSession,maximized:d.maximized});}
  function Notifications(props:OverlayProps){
    const notice=useSyncExternalStore(feedback.subscribe,feedback.currentNotice);
    return <><BlockedRequestNotice {...props}/>{notice&&<Notice key={notice.id} text={notice.text} onDone={()=>feedback.finish(notice.id)}/>}</>;
  }
  function mountUI(){
    if(uiStops.length||disposed)return;
    const style=document.createElement('style');style.dataset.dshTeamDesk='';style.textContent=css+editorCss+syncCss;document.head.appendChild(style);uiStops.push(()=>style.remove());
    uiStops.push(installSidebarSessionDrop(document,
      ()=>[null,'team-desk'].includes(layout.panelInfo.getSnapshot().activePanelId),
      ()=>ctx.get('sidebarRight')?.mounted.getSnapshot(),
      ()=>{
        const entry=slots.entriesOfSlot('shell.overlay').find(item=>item.options.id==='subagent.session-drop');
        return (entry?.inject?.() as {openAside?:(id:string,paneId?:string)=>void}|undefined)?.openAside;
      },
      ()=>tr('在右侧栏打开会话')));
    uiStops.push(installSyncRenderers(ctx,state),installMemberCatalog(state));
    uiStops.push(ctx.slots.inject('conversation.session.panel.section',()=>ctx.slots.register({name:'conversation.session.panel.section',id:'team-desk.members',order:195,locale:NS,label:()=>tr('成员与会话'),inject:()=>injected},TeamSessionSection)));
    uiStops.push(ctx.slots.inject('conversation.hero.frame',()=>ctx.slots.register({name:'conversation.hero.frame',id:'team-desk.home',order:100},({children,hero})=><>{children}{hero&&<button className="td-hero-team td-header-action" data-team-header-action="home" aria-label={tr('创建团队')} onClick={()=>showSettings()}><IconUsersOutlineRegular size={16}/></button>}</>)));
    uiStops.push(slots.inject('sidebar.session.row.team-branch',()=>slots.register({name:'sidebar.session.row.team-branch',id:'team-desk.branch'},({sessionId,expanded,title,leaf})=>leaf?<span className="td-tree-toggle" aria-label={title}><IconUsersOutlineRegular size={16}/></span>:<button type="button" className="td-tree-toggle" aria-label={tr(expanded?'收起团队':'展开团队')+' · '+title} aria-expanded={expanded}
      onKeyDown={e=>{
        if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
        e.preventDefault();e.stopPropagation();
        if(expanded!==(e.key==='ArrowRight'))hostView.toggle(sessionId);
      }} onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();hostView.toggle(sessionId);}}><IconUsersOutlineRegular size={16}/><span aria-hidden="true" className="td-branch-arrow"/></button>)));
    const panelEntry=()=>slots.entriesOfSlot('conversation.session.header.utilities').find(e=>e.options.id==='session-panel');
    const syncPanel=()=>set({nativePanel:panelEntry()?.inject?.() as unknown as SessionPanelToggleInjected|undefined});
    uiStops.push(slots.subscribe('conversation.session.header.utilities',syncPanel));syncPanel();
    uiStops.push(ctx.slots.inject('conversation.session.header.utilities',()=>ctx.slots.register({name:'conversation.session.header.utilities',locale:NS,id:'team-desk.edit',order:-20,inject:()=>injected},HeaderAction)));
    uiStops.push(ctx.slots.inject('conversation.session.header.home.utilities',()=>ctx.slots.register({name:'conversation.session.header.home.utilities',locale:NS,id:'team-desk.create',order:-20,inject:()=>injected},HomeAction)));
    uiStops.push(ctx.slots.inject('main',function*(){yield ctx.slots.register({name:'main',locale:NS,key:'team-desk',inject:()=>injected,children:{'team-desk.pane':{kind:'single',scope:'session'}}},Panel);yield ctx.slots.register({name:'team-desk.pane',locale:NS,inject:()=>({hasSharedHeader:slots.snapshot('factory:conversation.shared-header').length>0,legacyFrame:slots.snapshot('factory:conversation.frame').length>0,openWorkspace:workspace.openWorkspace.bind(workspace)})},Pane);}));
    uiStops.push(ctx.slots.inject('sidebar.workspaces.session.menu.item',()=>ctx.slots.register({name:'sidebar.workspaces.session.menu.item',locale:NS,id:'team-desk.open',order:250,inject:()=>injected},Entry)));
    uiStops.push(ctx.slots.inject('shell.overlay',function*(){yield ctx.slots.register({name:'shell.overlay',locale:NS,id:'team-desk.notice',inject:()=>injected},Notifications);yield ctx.slots.register({name:'shell.overlay',locale:NS,id:'team-desk.dialog',inject:()=>injected},TeamDialog);yield ctx.slots.register({name:'shell.overlay',locale:NS,id:'team-desk.drop',inject:()=>injected},DropReceiver);yield ctx.slots.register({name:'shell.overlay',locale:NS,id:'team-desk.trash',inject:()=>injected},TrashTarget);}));
  }
}
