import {messageText} from './locale.ts';
import {useEffect,useState,useSyncExternalStore} from 'react';
import type {OverlayProps} from './contracts.ts';
import {dragStore,consumeDrag,dockDropEffect} from './drag.ts';
import {tileDock} from '../domain/docking.ts';
import {visibleMembers} from './presentation.ts';
import {useDockPreview,SnapPreview} from './DockPreview.tsx';
export function DropReceiver(props:OverlayProps){
 const drag=useSyncExternalStore(dragStore.subscribe,dragStore.getSnapshot),panel=props.usePanelInfo(x=>x.activePanelId),catalog=props.useSessions(x=>x),data=props.useTeamDesk(x=>x),preferences=data.preferences,[rect,setRect]=useState<DOMRect>();
 const anchor=Object.values(catalog.byId).find(s=>(s.retainedBy.mainView??0)>0)?.id;
 useEffect(()=>{
  setRect(undefined);if(!drag||panel!==null||!anchor||anchor===drag.sessionId)return;
  let el=document.querySelector<HTMLElement>('[data-slot="main"]');while(el){const r=el.getBoundingClientRect();if(r.width>0&&r.height>0)break;el=el.parentElement;}if(!el)return;
  const target=el,measure=()=>setRect(target.getBoundingClientRect()),observer=new ResizeObserver(measure);measure();observer.observe(target);window.addEventListener('resize',measure);
  return()=>{observer.disconnect();window.removeEventListener('resize',measure);};
 },[drag,panel,anchor]);
 const team=data.state.teams.find(t=>t.members.some(m=>m.sessionId===anchor)),tree=team?(team.dock===undefined?tileDock(visibleMembers(team),team.layout):team.dock):anchor?{id:anchor}:null;
 const snap=useDockPreview(tree,drag?.sessionId,anchor);
 if(!drag||panel!==null||!anchor||anchor===drag.sessionId||!rect)return null;
 const plan=(e:React.DragEvent)=>snap.resolve(e.clientX,e.clientY,e.currentTarget.getBoundingClientRect());
 return <div className="td-global-drop" data-reduced-motion={preferences.motion==='reduced'||undefined} style={{left:rect.left,top:rect.top,width:rect.width,height:rect.height}}
  onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))snap.clear();}}
  onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=dockDropEffect(drag);snap.show(plan(e));}}
  onDrop={e=>{e.preventDefault();e.stopPropagation();const id=drag.sessionId,p=plan(e);consumeDrag();snap.clear();if(p)void props.dockSession(id,p.target,p.zone,anchor).catch(e=>props.feedback.notify(messageText(e)));}}
 >{preferences.snapPreview&&snap.preview&&<SnapPreview plan={snap.preview} sessionId={drag.sessionId} showOthers={preferences.showOtherPreviews}/>}</div>;
}
