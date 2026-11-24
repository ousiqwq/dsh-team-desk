export interface Point{x:number;y:number}
export interface GraphMember{id:string;targets:string[];send:boolean;label:string}
export const NODE_WIDTH=208,NODE_HEIGHT=108;
export interface GraphEdge{source:string;target:string;reverse:boolean;forward:boolean;backward:boolean;path:string;points:Point[]}
/** Breadth layers retain stable member order; feedback edges do not create extra layers. */
export function arrangeGraph(members:GraphMember[],root:string):Record<string,Point>{
 const ids=new Set(members.map(m=>m.id)),depth=new Map<string,number>([[root,0]]),queue=[root];
 for(let i=0;i<queue.length;i++){const id=queue[i]!,related=members.filter(m=>m.id===id||m.targets.includes(id)).flatMap(m=>m.id===id?m.targets:[m.id]);for(const next of related)if(ids.has(next)&&!depth.has(next)){depth.set(next,depth.get(id)!+1);queue.push(next);}}
 const last=Math.max(0,...depth.values())+1;for(const m of members)if(!depth.has(m.id))depth.set(m.id,last);
 const layers=new Map<number,GraphMember[]>();for(const m of members){const d=depth.get(m.id)!;layers.set(d,[...layers.get(d)??[],m]);}
 const rows=Math.max(1,...[...layers.values()].map(x=>x.length)),positions:Record<string,Point>={};
 for(const [d,list]of layers)list.forEach((m,i)=>{positions[m.id]={x:64+d*340,y:64+((rows-list.length)/2+i)*180};});return positions;
}
type Box=Point&{w:number;h:number};
function crosses(a:Point,b:Point,box:Box):boolean{
 return a.x===b.x?a.x>box.x&&a.x<box.x+box.w&&Math.max(a.y,b.y)>box.y&&Math.min(a.y,b.y)<box.y+box.h:a.y>box.y&&a.y<box.y+box.h&&Math.max(a.x,b.x)>box.x&&Math.min(a.x,b.x)<box.x+box.w;
}
/** Rectilinear visibility grid: no curve can loop through a member card. */
export function routeGraph(a:Point,b:Point,positions:Point[]):Point[]{
 const boxes=positions.map(p=>({x:p.x-10,y:p.y-10,w:NODE_WIDTH+20,h:NODE_HEIGHT+20}));
 const xs=[...new Set([a.x,b.x,20,...boxes.flatMap(r=>[r.x-14,r.x+r.w+14])])].sort((a,b)=>a-b),ys=[...new Set([a.y,b.y,20,...boxes.flatMap(r=>[r.y-14,r.y+r.h+14])])].sort((a,b)=>a-b);
 const key=(x:number,y:number)=>`${x},${y}`,start=key(a.x,a.y),goal=key(b.x,b.y),open=[{p:a,cost:0}],cost=new Map([[start,0]]),prev=new Map<string,Point>();
 const inside=(p:Point)=>boxes.some(r=>p.x>r.x&&p.x<r.x+r.w&&p.y>r.y&&p.y<r.y+r.h);
 while(open.length){open.sort((u,v)=>(u.cost+Math.abs(u.p.x-b.x)+Math.abs(u.p.y-b.y))-(v.cost+Math.abs(v.p.x-b.x)+Math.abs(v.p.y-b.y)));const item=open.shift()!,p=item.p,k=key(p.x,p.y);if(item.cost!==cost.get(k))continue;if(k===goal){const path=[b];let q=b;while(key(q.x,q.y)!==start){q=prev.get(key(q.x,q.y))!;path.unshift(q);}return path.filter((p,i)=>!i||i===path.length-1||!((path[i-1]!.x===p.x&&path[i+1]!.x===p.x)||(path[i-1]!.y===p.y&&path[i+1]!.y===p.y)));}
  const x=xs.indexOf(p.x),y=ys.indexOf(p.y),neighbors=[xs[x-1]===undefined?null:{x:xs[x-1]!,y:p.y},xs[x+1]===undefined?null:{x:xs[x+1]!,y:p.y},ys[y-1]===undefined?null:{x:p.x,y:ys[y-1]!},ys[y+1]===undefined?null:{x:p.x,y:ys[y+1]!}];
  for(const n of neighbors){if(!n||inside(n)||boxes.some(r=>crosses(p,n,r)))continue;const before=prev.get(k),turn=before&&((before.x===p.x)!==(p.x===n.x))?20:0,c=item.cost+Math.abs(n.x-p.x)+Math.abs(n.y-p.y)+turn,nk=key(n.x,n.y);if(c<(cost.get(nk)??Infinity)){cost.set(nk,c);prev.set(nk,p);open.push({p:n,cost:c});}}
 }
 return [a,{x:a.x,y:20},{x:b.x,y:20},b];
}
export function graphEdges(members:GraphMember[],positions:Record<string,Point>):GraphEdge[]{
 const byId=new Map(members.map(m=>[m.id,m])),seen=new Set<string>(),edges:GraphEdge[]=[];
 for(const source of members)for(const targetId of source.targets){const target=byId.get(targetId);if(!target||targetId===source.id)continue;const key=[source.id,targetId].sort().join('\0');if(seen.has(key))continue;seen.add(key);
  const a=positions[source.id]!,b=positions[targetId]!,horizontal=Math.abs(a.x-b.x)>NODE_WIDTH/2,forward=horizontal?a.x<=b.x:a.y<=b.y;
  const start=horizontal?{x:a.x+(forward?NODE_WIDTH:0),y:a.y+NODE_HEIGHT/2}:{x:a.x+NODE_WIDTH/2,y:a.y+(forward?NODE_HEIGHT:0)};
  const end=horizontal?{x:b.x+(forward?0:NODE_WIDTH),y:b.y+NODE_HEIGHT/2}:{x:b.x+NODE_WIDTH/2,y:b.y+(forward?0:NODE_HEIGHT)};
  const offset=(p:Point,sign:number)=>horizontal?{x:p.x+sign*26,y:p.y}:{x:p.x,y:p.y+sign*26};
  const points=[start,...routeGraph(offset(start,forward?1:-1),offset(end,forward?-1:1),Object.values(positions)),end];
  edges.push({source:source.id,target:targetId,reverse:target.targets.includes(source.id),forward:source.send,backward:target.send&&target.targets.includes(source.id),points,path:points.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ')});
 }return edges;
}
