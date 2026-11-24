import type {Message,MessageQuery,MessagePage} from './types.ts';
import {CoordinationError} from './errors.ts';
const fields=['cursor','requestId','direction','sender','code','epoch','limit','includeArchive'];
export function validateQuery(q:MessageQuery):void{
  if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!fields.includes(k)))throw new CoordinationError('INVALID_QUERY','无效的查询选项');
  if(q.cursor!==undefined&&(!Number.isSafeInteger(q.cursor)||q.cursor<0)||q.limit!==undefined&&(!Number.isSafeInteger(q.limit)||q.limit<1||q.limit>100))throw new CoordinationError('INVALID_QUERY','游标必须非负，单页为 1–100 条');
  for(const k of ['requestId','sender','code','epoch'] as const)if(q[k]!==undefined&&(typeof q[k]!=='string'||!q[k]||q[k]!.length>200))throw new CoordinationError('INVALID_QUERY','无效的过滤条件');
  if(q.direction!==undefined&&!['incoming','outgoing','both'].includes(q.direction)||q.includeArchive!==undefined&&typeof q.includeArchive!=='boolean')throw new CoordinationError('INVALID_QUERY','无效的方向或归档选项');
}
export function messagePage(messages:Message[],teamId:string,caller:string,q:MessageQuery):MessagePage{
  validateQuery(q);const limit=q.limit??100;
  const found=messages.filter(m=>m.teamId===teamId&&(m.sender===caller||m.target===caller)&&(m.sequence??0)>(q.cursor??0)
    &&(!q.requestId||(m.kind==='reply'&&m.replyTo===q.requestId&&m.target===caller))
    &&(!q.direction||q.direction==='both'||(q.direction==='incoming'?m.target===caller:m.sender===caller))
    &&(!q.sender||m.sender===q.sender)&&(!q.code||m.code===q.code)&&(!q.epoch||m.epoch===q.epoch)).sort((a,b)=>(a.sequence??0)-(b.sequence??0));
  const page=found.slice(0,limit);return structuredClone({messages:page,cursor:page.at(-1)?.sequence??q.cursor??0,hasMore:found.length>limit});
}
/** Wait dependencies are transient, not a second task scheduler. */
export class WaitDependencies {
  private edges=new Map<string,Map<string,number>>();
  enter(from:string,to:string):(()=>void)|undefined{
    const visits=new Set<string>();const reaches=(id:string):boolean=>id===from||(!visits.has(id)&&(visits.add(id),[...(this.edges.get(id)?.keys()??[])].some(reaches)));
    if(reaches(to))return undefined;
    const edges=this.edges.get(from)??new Map<string,number>();edges.set(to,(edges.get(to)??0)+1);this.edges.set(from,edges);
    return ()=>{const n=edges.get(to)??0;if(n<=1)edges.delete(to);else edges.set(to,n-1);if(!edges.size)this.edges.delete(from);};
  }
}
