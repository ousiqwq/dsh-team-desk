import {useEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent} from 'react';
import {resizeIntent,type DockNode,type Rect} from '../domain/docking.ts';
import {dockHandles,transposeCross,type DockHandle} from '../domain/dividers.ts';
import {tr} from './locale.ts';

type Preview={tree:DockNode;ratio:number;collapse?:string};
interface Props{
 tree:DockNode;stored:DockNode;width:number;height:number;
 preview:(value?:Preview)=>void;
 commit:(handle:DockHandle,ratio:number,expected:DockNode,collapse?:string)=>Promise<void>;
}
function position(h:DockHandle,r:Rect,ratio:number):CSSProperties{
 return h.axis==='x'?{left:(h.rect.x+h.rect.width*ratio/100)+'%',top:r.y+'%',height:r.height+'%'}:
  {top:(h.rect.y+h.rect.height*ratio/100)+'%',left:r.x+'%',width:r.width+'%'};
}
export function DockDividers({tree,stored,width,height,preview,commit}:Props){
 const plans=useMemo(()=>dockHandles(tree,stored),[tree,stored]);
 const [hover,setHover]=useState('');
 const gesture=useRef<{handle:DockHandle;handles:DockHandle[];base:DockNode;expected:DockNode;last?:Preview;pointer:number}|undefined>(undefined);
 const active=gesture.current,handles=active?.handles??plans;
 const highlighted=active?.handle??handles.find(h=>h.key===hover);
 function cancel(){if(gesture.current){gesture.current=undefined;preview();setHover('');}}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')cancel();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[preview]);
 function move(e:PointerEvent){
  const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;
  const bounds=e.currentTarget.parentElement!.getBoundingClientRect(),h=g.handle;
  const point=h.axis==='x'?(e.clientX-bounds.left)/bounds.width:(e.clientY-bounds.top)/bounds.height;
  const ratio=(100*point-(h.axis==='x'?h.rect.x:h.rect.y))/(h.axis==='x'?h.rect.width:h.rect.height)*100;
  g.last=resizeIntent(g.base,h.path,ratio,bounds.width,bounds.height);preview(g.last);
 }
 return <>{handles.map(h=>{
  const title=tr(h.axis==='x'?'调整列宽':'调整行高')+(h.scope==='whole'?'':' · '+tr(h.scope==='local'?'相邻窗格':'整条分隔线'));
  return <div key={h.key} role="separator" title={title} aria-label={title} aria-valuenow={active?.handle.key===h.key?active.last?.ratio??h.ratio:h.ratio} aria-orientation={h.axis==='x'?'vertical':'horizontal'} tabIndex={0}
   className={'td-dock-divider td-dock-divider-'+h.axis} data-scope={h.scope} style={position(h,h.hit,h.ratio)}
   onPointerEnter={()=>setHover(h.key)} onPointerLeave={()=>setHover('')} onFocus={()=>setHover(h.key)} onBlur={()=>setHover('')}
   onPointerDown={e=>{if(e.button!==0||gesture.current)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current={handle:h,handles:plans,base:h.rotateAt===undefined?tree:transposeCross(tree,h.rotateAt),expected:stored,pointer:e.pointerId};setHover(h.key);}}
   onPointerMove={move} onPointerCancel={cancel} onLostPointerCapture={cancel}
   onPointerUp={e=>{const g=gesture.current;if(!g||g.pointer!==e.pointerId)return;gesture.current=undefined;setHover('');if(g.last)void commit(g.handle,g.last.ratio,g.expected,g.last.collapse).finally(()=>preview());else preview();}}
   onKeyDown={e=>{const keys=h.axis==='x'?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];if(!keys.includes(e.key))return;e.preventDefault();
    const base=h.rotateAt===undefined?tree:transposeCross(tree,h.rotateAt);
    const intent=resizeIntent(base,h.path,h.ratio+(e.key===keys[0]?-3:3),width,height);void commit(h,intent.ratio,stored);}}/>;
 })}{highlighted&&<div aria-hidden="true" className={'td-divider-highlight td-dock-divider-'+highlighted.axis} style={position(highlighted,highlighted.rect,active?.last?.ratio??highlighted.ratio)}/>}</>;
}
