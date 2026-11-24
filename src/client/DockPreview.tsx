import {tr, messageText} from './locale.ts';
import {useEffect,useRef,useState} from 'react';
import {previewDock,type DockNode,type DockPreview} from '../domain/docking.ts';

/** Resolve drag-over and drop through the same bounded hysteresis, including fast release. */
export function useDockPreview(tree:DockNode|null,sessionId:string|undefined,displayedPane?:string){
 const [preview,setPreview]=useState<DockPreview>();
 const cache=useRef<{key:string;preview:DockPreview}|undefined>(undefined);
 const treeKey=JSON.stringify(tree);
 function clear(){cache.current=undefined;setPreview(undefined);}
 useEffect(clear,[treeKey,sessionId,displayedPane]);
 function resolve(clientX:number,clientY:number,rect:DOMRect){
  if(!sessionId||rect.width<=0||rect.height<=0)return;
  const key=[treeKey,sessionId,displayedPane,rect.x,rect.y,rect.width,rect.height].join('|');
  const previous=cache.current?.key===key?cache.current.preview:undefined;
  const next=previewDock(tree,sessionId,(clientX-rect.left)/rect.width*100,(clientY-rect.top)/rect.height*100,{width:rect.width,height:rect.height,fitLayout:true,...(displayedPane?{displayedPane}:{}),...(previous?{previous}:{})});
  if(previous&&previous.target===next.target&&previous.zone===next.zone&&previous.kind===next.kind)return previous;
  cache.current={key,preview:next};return next;
 }
 return {preview,resolve,show:setPreview,clear};
}

function label(plan:DockPreview){
 if(plan.kind==='replace')return tr("松开以替换此窗格");
 if(plan.kind==='keep')return tr("保持当前位置");
 if(plan.kind==='swap')return tr("松开以交换位置");
 if(plan.kind==='add')return tr("松开以显示会话");
 const direction={left:tr("左侧"),right:tr("右侧"),top:tr("上方"),bottom:tr("下方"),center:tr("此处"),replace:tr("此处")}[plan.zone];
 if(plan.kind==='edge')return tr("整体排布 · 放到{p0}", {p0: direction});
 return plan.kind==='pair'?`${['left','right'].includes(plan.zone)?tr("左右排列"):tr("上下排列")} · ${direction}`:tr("在此窗格{p0}添加", {p0: direction});
}

export function SnapPreview({plan,sessionId,showOthers}:{plan:DockPreview;sessionId:string;showOthers:boolean}){
 return <>{Object.entries(plan.panes).filter(([id])=>showOthers||id===sessionId).map(([id,r])=><div
  // Geometry identifies a slot. Reordering changes its highlight, never animates it across the screen.
  key={[r.x,r.y,r.width,r.height].join(':')} className="td-snap-preview" data-snap-session={id}
  data-snap-active={id===sessionId} data-snap-zone={plan.zone} data-snap-kind={plan.kind}
  style={{left:r.x+'%',top:r.y+'%',width:r.width+'%',height:r.height+'%'}}
 >{id===sessionId&&<span>{label(plan)}</span>}</div>)}</>;
}
