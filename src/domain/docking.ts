/** A compact split tree; leaves keep the original DSH session identity. */
export type DockNode={id:string}|{axis:'x'|'y';ratio:number;first:DockNode;second:DockNode};
export type DockZone='left'|'right'|'top'|'bottom'|'center'|'replace';
export interface Rect{x:number;y:number;width:number;height:number;}
export interface DockPreview{target?:string;zone:DockZone;kind:'pair'|'swap'|'keep'|'split'|'add'|'edge'|'replace';panes:Record<string,Rect>;}
export interface DockPreviewOptions{width?:number;height?:number;previous?:DockPreview;fitLayout?:boolean;displayedPane?:string;}
export interface Divider{path:string;axis:'x'|'y';rect:Rect;ratio:number;}
export function dockIds(node:DockNode|null|undefined):string[]{return !node?[]:'id'in node?[node.id]:[...dockIds(node.first),...dockIds(node.second)];}
export function pruneDock(node:DockNode|null|undefined,allowed:ReadonlySet<string>):DockNode|null{
 if(!node)return null;if('id'in node)return allowed.has(node.id)?node:null;
 const first=pruneDock(node.first,allowed),second=pruneDock(node.second,allowed);return first&&second?{...node,first,second}:first??second;
}
export function tileDock(ids:string[],layout='grid'):DockNode|null{
 if(!ids.length)return null;if(ids.length===1)return {id:ids[0]!};
 const vertical=layout==='rows',half=layout==='grid'?Math.ceil(ids.length/2):1;
 return {axis:vertical?'y':'x',ratio:layout==='grid'?50:100*half/ids.length,first:tileDock(ids.slice(0,half),layout==='grid'?'rows':layout)!,second:tileDock(ids.slice(half),layout==='grid'?'rows':layout)!};
}
export function insertDock(tree:DockNode|null,id:string,target:string|undefined,zone:DockZone):DockNode{
 if(target===id&&tree)return tree;
 if(zone==='replace'){
  if(!tree||!target||!dockIds(tree).includes(target)||dockIds(tree).includes(id))throw Error('Replacement pane changed');
  const replace=(n:DockNode):DockNode=>'id'in n?(n.id===target?{id}:n):{...n,first:replace(n.first),second:replace(n.second)};
  return replace(tree);
 }
 // Reordering a pair must retain the user's divider ratio when its axis stays the same.
 if(tree&&'axis'in tree&&'id'in tree.first&&'id'in tree.second&&dockIds(tree).includes(id)&&zone!=='center'&&tree.axis===(zone==='top'||zone==='bottom'?'y':'x')){
  const before=zone==='left'||zone==='top';return (tree.first.id===id)===before?tree:{...tree,first:tree.second,second:tree.first};
 }
 let next=pruneDock(tree,new Set(dockIds(tree).filter(x=>x!==id)));if(!next)return {id};
 if(zone==='center'&&target&&dockIds(tree).includes(id)){
  const swap=(n:DockNode):DockNode=>'id'in n?{id:n.id===id?target:n.id===target?id:n.id}:{...n,first:swap(n.first),second:swap(n.second)};
  return swap(tree!);
 }
 const split=(n:DockNode):DockNode=>{const axis=zone==='top'||zone==='bottom'?'y':'x',before=zone==='left'||zone==='top';return {axis,ratio:50,first:before?{id}:n,second:before?n:{id}};};
 if(!target||!dockIds(next).includes(target))return split(next);
 const visit=(n:DockNode):DockNode=>'id'in n?n.id===target?split(n):n:{...n,first:visit(n.first),second:visit(n.second)};
 return visit(next);
}
export function resizeDock(node:DockNode,path:string,ratio:number):DockNode{
 if('id'in node)return node;if(!path)return {...node,ratio:Math.max(15,Math.min(85,ratio))};
 const key=path[0]==='0'?'first':'second';return {...node,[key]:resizeDock(node[key],path.slice(1),ratio)};
}
export function dockRects(tree:DockNode|null,rect:Rect={x:0,y:0,width:100,height:100},path=''):{panes:Record<string,Rect>;dividers:Divider[]}{
 if(!tree)return {panes:{},dividers:[]};if('id'in tree)return {panes:{[tree.id]:rect},dividers:[]};
 const {axis,ratio}=tree,k=ratio/100,first={...rect},second={...rect};if(axis==='x'){first.width*=k;second.x+=first.width;second.width-=first.width;}else{first.height*=k;second.y+=first.height;second.height-=first.height;}
 const a=dockRects(tree.first,first,path+'0'),b=dockRects(tree.second,second,path+'1');return {panes:{...a.panes,...b.panes},dividers:[{path,axis,rect,ratio},...a.dividers,...b.dividers]};
}
export function validDock(value:unknown,members?:ReadonlySet<string>,seen=new Set<string>(),depth=0):value is DockNode|null{
 if(value===null)return true;if(depth>24||!value||typeof value!=='object')return false;const n=value as Record<string,unknown>;
 if(typeof n.id==='string'){if(!n.id||(members&&!members.has(n.id))||seen.has(n.id))return false;seen.add(n.id);return true;}
 return (n.axis==='x'||n.axis==='y')&&typeof n.ratio==='number'&&Number.isFinite(n.ratio)&&n.ratio>=5&&n.ratio<=95&&n.first!==null&&n.second!==null&&validDock(n.first,members,seen,depth+1)&&validDock(n.second,members,seen,depth+1);
}
/** Compute the same tree that a drop will commit, so previews cannot invent extra panes. */
export function previewDock(tree:DockNode|null,id:string,x:number,y:number,options:DockPreviewOptions={}):DockPreview{
 const width=Math.max(1,options.width??1000),height=Math.max(1,options.height??1000),dx=800/width,dy=800/height;
 const fit=(node:DockNode|null)=>options.fitLayout?fitDock(node,width,height):node;
 const geometry=dockRects(fit(tree)).panes,ids=Object.keys(geometry),moving=ids.includes(id);
 const px=Math.max(0,Math.min(100,x)),py=Math.max(0,Math.min(100,y)),previous=options.previous;
 const result=(target:string|undefined,zone:DockZone,kind:DockPreview['kind']):DockPreview=>({
  ...(target?{target}:{}),zone,kind,panes:dockRects(fit(insertDock(tree,id,target,zone))).panes
 });
 if(!moving&&ids.length>=4){
  const pointed=ids.find(key=>{const r=geometry[key]!;return px>=r.x&&px<=r.x+r.width&&py>=r.y&&py<=r.y+r.height;});
  const single=options.displayedPane&&ids.includes(options.displayedPane)?options.displayedPane:undefined;
  const plan=result(single??pointed,'replace','replace');
  return single?{...plan,panes:{[id]:{x:0,y:0,width:100,height:100}}}:plan;
 }
 if(!ids.length)return result(undefined,'right','add');
 if(ids.length===1&&moving)return result(id,'center','keep');
 // Two windows have only two layouts. The nearest normalized edge selects its half.
 if((ids.length===2&&moving)||(ids.length===1&&!moving)){
  const target=ids.find(other=>other!==id)!;
  const distances={left:px,right:100-px,top:py,bottom:100-py};
  let zone=(Object.keys(distances) as (keyof typeof distances)[]).reduce((a,b)=>distances[a]<=distances[b]?a:b);
  if(previous?.kind==='pair'&&previous.target===target&&previous.zone!=='center'&&previous.zone!=='replace'&&distances[previous.zone]<=distances[zone]+Math.min(dx,dy))zone=previous.zone;
  return result(target,zone,'pair');
 }
 // Only the outer 36 physical pixels restructure the whole group. Interior stays a swap.
 const edges={left:px*width/100,right:(100-px)*width/100,top:py*height/100,bottom:(100-py)*height/100};
 let edge=(Object.keys(edges) as (keyof typeof edges)[]).reduce((a,b)=>edges[a]<=edges[b]?a:b);
 if(previous?.kind==='edge'&&previous.zone!=='center'&&previous.zone!=='replace'&&edges[previous.zone]<=44)edge=previous.zone;
 if(edges[edge]<=36||(previous?.kind==='edge'&&edge===previous.zone&&edges[edge]<=44))return result(undefined,edge,'edge');
 // Hit-test the saved rectangles, never a DOM child or an animated preview.
 let target=ids.find(key=>{const r=geometry[key]!;return px>=r.x&&px<=r.x+r.width&&py>=r.y&&py<=r.y+r.height;})!;
 const old=previous?.target&&geometry[previous.target];
 if(old&&(previous.kind==='swap'||previous.kind==='keep'||previous.kind==='split')&&px>=old.x-dx&&px<=old.x+old.width+dx&&py>=old.y-dy&&py<=old.y+old.height+dy)target=previous.target!;
 // Moving three or more panes exchanges slots, preserving every split and ratio.
 if(moving)return result(target,'center',target===id?'keep':'swap');
 // A new pane splits only its target, along that target's longer physical side.
 const r=geometry[target]!,horizontal=r.width*width>=r.height*height;
 const position=horizontal?px-r.x:py-r.y,mid=(horizontal?r.width:r.height)/2,tolerance=horizontal?dx:dy;
 let zone:DockZone=horizontal?(position<mid?'left':'right'):(position<mid?'top':'bottom');
 if(previous?.kind==='split'&&previous.target===target&&Math.abs(position-mid)<=tolerance&&
   (horizontal?['left','right']:['top','bottom']).includes(previous.zone))zone=previous.zone;
 return result(target,zone,'split');
}

/** Pixel-aware presentation bounds; shrinking the browser never removes a leaf. */
export function fitDock(tree:DockNode|null,width:number,height:number):DockNode|null{
 if(!tree||'id'in tree)return tree;
 const min=(n:DockNode,axis:'x'|'y'):number=>'id'in n?(axis==='x'?280:190):n.axis===axis?min(n.first,axis)+min(n.second,axis):Math.max(min(n.first,axis),min(n.second,axis));
 const size=tree.axis==='x'?width:height,a=min(tree.first,tree.axis),b=min(tree.second,tree.axis),scale=Math.min(1,size/(a+b));
 const lower=Math.max(5,a*scale/Math.max(1,size)*100),upper=Math.min(95,100-b*scale/Math.max(1,size)*100),ratio=Math.max(lower,Math.min(upper,tree.ratio));
 return {...tree,ratio,first:fitDock(tree.first,tree.axis==='x'?width*ratio/100:width,tree.axis==='y'?height*ratio/100:height)!,second:fitDock(tree.second,tree.axis==='x'?width*(1-ratio/100):width,tree.axis==='y'?height*(1-ratio/100):height)!};
}
export function resizeIntent(tree:DockNode,path:string,rawRatio:number,width:number,height:number):{tree:DockNode;ratio:number;collapse?:string}{
 let node=tree;for(const part of path){if('id'in node)break;node=part==='0'?node.first:node.second;}
 const fitted=fitDock(resizeDock(tree,path,rawRatio),width,height)!;
 const ratio=dockRects(fitted).dividers.find(d=>d.path===path)?.ratio??50;
 if('axis'in node&&(rawRatio<=3||rawRatio>=97)){
  const candidates=dockIds(rawRatio<=3?node.first:node.second),rects=dockRects(tree).panes;
  // A single edge gesture closes one leaf, even when the resized branch contains several.
  candidates.sort((a,b)=>rects[a]!.width*rects[a]!.height-rects[b]!.width*rects[b]!.height);
  return {tree:fitted,ratio,collapse:candidates[0]!};
 }
 return {tree:fitted,ratio};
}
export function mirrorDock(tree:DockNode|null,axis:'x'|'y'):DockNode|null{
 if(!tree||'id'in tree)return tree;
 const first=mirrorDock(tree.first,axis)!,second=mirrorDock(tree.second,axis)!;
 return tree.axis===axis?{...tree,ratio:100-tree.ratio,first:second,second:first}:{...tree,first,second};
}
