import {tr, messageText} from './locale.ts';
import {useEffect,useState,useSyncExternalStore} from 'react';
import {IconTrashOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {OverlayProps} from './contracts.ts';
import {dragStore,consumeDrag,dockDropEffect} from './drag.ts';
/** Render in the shell overlay so animated panes cannot clip or cover the drop target. */
export function TrashTarget(props:OverlayProps){
 const drag=useSyncExternalStore(dragStore.subscribe,dragStore.getSnapshot),data=props.useTeamDesk(s=>s),panel=props.usePanelInfo(s=>s.activePanelId),team=data.state.teams.find(t=>t.id===data.activeTeam),[rect,setRect]=useState<DOMRect>(),[over,setOver]=useState(false);
 const shown=panel==='team-desk'&&!!drag&&!!team?.members.some(m=>m.sessionId===drag.sessionId)&&!team.hidden.includes(drag.sessionId);
 useEffect(()=>{setOver(false);setRect(undefined);if(!shown)return;const el=document.querySelector<HTMLElement>('.td-dock-surface');if(!el)return;const measure=()=>setRect(el.getBoundingClientRect()),observer=new ResizeObserver(measure);measure();observer.observe(el);window.addEventListener('resize',measure);return()=>{observer.disconnect();window.removeEventListener('resize',measure);};},[shown,drag?.sessionId]);
 if(!shown||!rect||!drag||!team)return null;
 return <div className="td-trash" data-team-trash="" data-over={over||undefined} data-reduced-motion={data.preferences.motion==='reduced'||undefined} role="button" aria-label={tr("移除当前窗格")} style={{left:rect.left+rect.width/2,top:rect.bottom-116,width:Math.max(160,Math.min(340,rect.width-32))}}
  onDragEnter={e=>{e.preventDefault();e.stopPropagation();setOver(true);}}
  onDragOver={e=>{e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=dockDropEffect(drag);setOver(true);}}
  onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(false);}}
  onDrop={e=>{e.preventDefault();e.stopPropagation();const id=drag.sessionId;consumeDrag();setOver(false);void props.perform({action:'dock',teamId:team.id,sessionId:id,zone:'hide'}).catch(e=>props.feedback.notify(messageText(e)));}}>
  <IconTrashOutlineRegular size={30}/><div><strong>{over?tr("松开以移除窗格"):tr("移除窗格")}</strong><span>{tr("保留会话与正在运行的任务")}</span></div>
 </div>;
}
