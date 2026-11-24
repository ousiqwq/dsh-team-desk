import {tr, messageText} from './locale.ts';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {INSPECTOR_DEFAULT,INSPECTOR_KEY,inspectorBounds,inspectorWidth,readInspectorWidth,writeInspectorWidth} from './graph-view.ts';

const changed='team-desk:inspector-width';
export function GraphInspector({width,children}:{width:number;children:ReactNode}){
 const [preferred,setPreferred]=useState(()=>readInspectorWidth({getItem:key=>localStorage.getItem(key)})),[draft,setDraft]=useState<number>();
 const drag=useRef<{pointer:number;x:number;width:number;value:number}|undefined>(undefined);
 const bounds=inspectorBounds(width),value=inspectorWidth(draft??preferred,width);
 function save(next:number){setPreferred(next);writeInspectorWidth({setItem:(key,v)=>localStorage.setItem(key,v)},next);window.dispatchEvent(new CustomEvent(changed,{detail:next}));}
 function cancel(){drag.current=undefined;setDraft(undefined);}
 useEffect(()=>{const update=(e:Event)=>{if(drag.current)return;if(e instanceof CustomEvent)setPreferred(e.detail);else if((e as StorageEvent).key===INSPECTOR_KEY||(e as StorageEvent).key===null)setPreferred(readInspectorWidth({getItem:key=>localStorage.getItem(key)}));};window.addEventListener(changed,update);window.addEventListener('storage',update);return()=>{window.removeEventListener(changed,update);window.removeEventListener('storage',update);};},[]);
 useEffect(()=>{if(bounds.stacked)cancel();},[bounds.stacked]);
 return <><div className="td-inspector-divider" role="separator" tabIndex={0} aria-label={tr("调整编辑栏宽度")} aria-orientation="vertical" aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={Math.round(value)} title={tr("拖动调整宽度；双击恢复默认")} hidden={bounds.stacked}
  onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();e.currentTarget.focus({preventScroll:true});drag.current={pointer:e.pointerId,x:e.clientX,width:value,value};setDraft(value);e.currentTarget.setPointerCapture(e.pointerId);}}
  onPointerMove={e=>{const d=drag.current;if(d?.pointer!==e.pointerId)return;d.value=inspectorWidth(d.width+d.x-e.clientX,width);setDraft(d.value);}}
  onPointerUp={e=>{if(drag.current?.pointer!==e.pointerId)return;const next=drag.current.value;cancel();save(next);e.currentTarget.releasePointerCapture(e.pointerId);}}
  onLostPointerCapture={cancel} onPointerCancel={cancel} onDoubleClick={()=>save(INSPECTOR_DEFAULT)}
  onKeyDown={e=>{if(e.key==='Escape'&&drag.current){e.preventDefault();e.stopPropagation();cancel();return;}const next=e.key==='ArrowLeft'?value+16:e.key==='ArrowRight'?value-16:e.key==='Home'?bounds.min:e.key==='End'?bounds.max:undefined;if(next!==undefined){e.preventDefault();save(inspectorWidth(next,width));}}}/>
  <aside className="td-graph-inspector" style={bounds.stacked?undefined:{flexBasis:value}}>{children}</aside></>;
}
