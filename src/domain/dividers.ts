import {dockRects,type Divider,type DockNode,type Rect} from './docking.ts';

type Split=Extract<DockNode,{axis:string}>;
type Cross=Split & {first:Split;second:Split};
function aligned(node:DockNode):node is Cross{
 return 'axis' in node && 'axis' in node.first && 'axis' in node.second &&
  node.first.axis!==node.axis && node.second.axis===node.first.axis &&
  Math.abs(node.first.ratio-node.second.ratio)<1e-7;
}
function atPath(node:DockNode,path:string):DockNode{
 for(const digit of path){if('id' in node)break;node=digit==='0'?node.first:node.second;}
 return node;
}
/** Transpose an aligned cross without changing any pane's rectangle or session. */
export function transposeCross(node:DockNode,path:string):DockNode{
 if(path){
  if('id' in node)throw Error('Divider layout changed');
  const side=path[0]==='0'?'first':'second';
  return {...node,[side]:transposeCross(node[side],path.slice(1))};
 }
 if(!aligned(node))throw Error('Divider layout changed');
 const band=(side:'first'|'second'):Split=>({axis:node.axis,ratio:node.ratio,first:node.first[side],second:node.second[side]});
 return {axis:node.first.axis,ratio:node.first.ratio,first:band('first'),second:band('second')};
}
export interface DockHandle extends Divider{
 key:string; hit:Rect; scope:'whole'|'local'|'linked';rotateAt?:string;
}
function slice(rect:Rect,axis:'x'|'y',from:number,to:number):Rect{
 // Along the divider: vertical handles occupy part of its height and vice versa.
 return axis==='x'?{...rect,y:rect.y+rect.height*from,height:rect.height*(to-from)}:
  {...rect,x:rect.x+rect.width*from,width:rect.width*(to-from)};
}
export function dockHandles(tree:DockNode|null,stored:DockNode|null=tree):DockHandle[]{
 if(!tree||!stored)return [];
 const dividers=dockRects(tree).dividers,claimed=new Set<string>(),handles:DockHandle[]=[];
 for(const d of dividers){
  if(claimed.has(d.path))continue;
  const n=atPath(tree,d.path);
  if(!aligned(n)||!aligned(atPath(stored,d.path))){
   handles.push({...d,key:d.path+'-whole',scope:'whole',hit:d.rect});continue;
  }
  claimed.add(d.path+'0');claimed.add(d.path+'1');
  for(const axis of [n.axis,n.first.axis]){
   const ratio=axis===n.axis?n.ratio:n.first.ratio;
   const crossRatio=(axis===n.axis?n.first.ratio:n.ratio)/100;
   for(const side of [0,1] as const){
    const from=side?crossRatio:0,to=side?1:crossRatio,mid=(from+to)/2;
    for(const scope of ['local','linked'] as const){
     const local=scope==='local',rotate=local?axis===n.axis:axis!==n.axis;
     const innerFirst=side===1,firstHalf=local===innerFirst;
     handles.push({axis,ratio,scope,key:[d.path,axis,side,scope].join('/'),
      path:d.path+(local?String(side):''),...(rotate?{rotateAt:d.path}:{}),
      rect:local?slice(d.rect,axis,from,to):d.rect,
      hit:slice(d.rect,axis,firstHalf?from:mid,firstHalf?mid:to)});
    }
   }
  }
 }
 return handles;
}
