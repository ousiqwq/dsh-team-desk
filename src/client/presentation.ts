import {tr, messageText} from './locale.ts';
import type {Layout, Team} from '../domain/types.ts';
import {teamSessionTitle} from '../domain/session-title.ts';
export const layoutNames:Record<Layout,string>={get columns(){return tr("左右并排");},get rows(){return tr("上下排列");},get grid(){return tr("四格");}, get 'four-columns'(){return tr("四列");}};
/** Layout adapts to its container without overwriting the saved desktop preference. */
export function displayLayout(layout:Layout,count:number,width:number,height:number):{columns:number;rows:number;single:boolean}{
  if(count<=1 || width<640 || height<300)return {columns:1,rows:1,single:true};
  let columns=layout==='rows'?1:layout==='four-columns'?Math.min(4,count):layout==='grid'?Math.min(2,count):count;
  const capacity=Math.max(1,Math.floor(width/340));
  columns=Math.min(columns,capacity);
  if(layout==='four-columns'&&count===4&&columns===3)columns=2;
  if(layout!=='rows'&&columns===1)return {columns:1,rows:1,single:true};
  const rows=Math.ceil(count/columns);
  if(height/rows<240)return {columns:1,rows:1,single:true};
  return {columns,rows,single:false};
}
export function visibleMembers(team:Team){return team.order.filter(id=>!team.hidden.includes(id)&&team.members.some(m=>m.sessionId===id));}
export function moveMember(order:string[],source:string,target:string):string[]{
  const to=order.indexOf(target);if(to<0||!order.includes(source)||source===target)return order;
  const next=order.filter(id=>id!==source);next.splice(to,0,source);return next;
}
export function activeMember(team:Team,requested:string){const visible=visibleMembers(team);return visible.includes(requested)?requested:visible[0]??'';}

export function paneTitle(title:string|undefined,role:string|undefined,hint?:import('../domain/session-title.ts').TitleHint){
 return teamSessionTitle(title,role,hint)||tr('新会话');
}
