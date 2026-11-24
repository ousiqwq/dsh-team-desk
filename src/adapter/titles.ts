import type {Context} from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-session-title';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import {teamTitleMessage} from '../host-support/session-title-input.ts';
import type {SessionEvent} from '@deepseek-ai/dsh-session';
type SessionTitleEventData=Extract<SessionEvent,{type:'session/title'}>['data'];
import {type Session,SessionId} from '@deepseek-ai/dsh-session';
import type {TeamEngine} from '../domain/engine.ts';

/** Explicit maintenance for pre-update members; existing and user-pinned titles stay untouched. */
export async function refreshMissingTeamTitles(ctx:Context,engine:TeamEngine,teamId:string){
 const team=engine.snapshot().teams.find(t=>t.id===teamId);if(!team)throw Error('Team not found');
 const titles=ctx.get('sessionTitle');if(!titles)throw Error('Native session title service unavailable');
 const rows=[];
 for(const member of team.members.filter(m=>m.active!==false)){
  const resolved=await ctx.sessionController.resolveAgent(SessionId(member.sessionId));if('error'in resolved)throw resolved.error;
  const {session}=resolved.agent,current=titles.get(session);
  if(current&&!(current.source?.kind==='fallback'&&current.title.startsWith('【')&&!current.title.includes('】'))){rows.push({sessionId:member.sessionId,status:'existing'});continue;}
  const generated=await titles.refresh(session);
  rows.push({sessionId:member.sessionId,status:generated?'generated':'no-task-input'});
 }
 return rows;
}

/** Expand only an authenticated team task's clipped native fallback for display. */
export function fallbackHeading(raw:string,request:string):string|undefined {
 if(!raw.startsWith('【')||raw.includes('】'))return;
 const match=/^【([^】\r\n]{1,240})】(?:\s|$)/u.exec(request.trim());
 if(!match||!request.trim().replace(/\s+/gu,' ').startsWith(raw))return;
 const heading=match[1]!.trim();
 return heading.replace(/^.{1,40}席位任务[：:]\s*/u,'')||heading;
}

/** A display title for relayed work before the native title service has human input. */
export function taskHeading(text:string):string|undefined {
 const first=text.trim().split(/\r?\n/,1)[0]?.trim();
 if(!first)return;
 const heading=/^【([^】]+)】/u.exec(first)?.[1]?.replace(/^.{1,40}席位任务[：:]\s*/u,'') ?? first;
 const chars=Array.from(heading.trim());
 return chars.length>64 ? chars.slice(0,63).join('')+'…' : heading.trim();
}

export function trackFallbackHeadings(ctx:Context,engine:TeamEngine){
 const hints=new Map<string,{raw:string;heading:string}>();
 const tasks=new Map<string,{raw:string;heading:string}>();
 function remember(id:string,text:string) {
  const heading=taskHeading(text);
  if(heading)tasks.set(id,{raw:'',heading});
 }
 for(const message of engine.snapshot().messages){
  const team=message.kind==='request'&&!message.system&&message.native==='admitted'&&engine.membership(message.target);
  if(team && team.id===message.teamId && (!message.epoch || message.epoch===team.epoch))remember(message.target,message.text);
 }
 function inspect(session:Session,title:SessionTitleEventData|undefined){
  hints.delete(session.id);
  if(title?.source.kind!=='fallback'||!title.title.startsWith('【')||title.title.includes('】')||!engine.membership(session.id))return;
  const seq=title.messageSeqs[0];
  const event=session.snapshotEvents().find(e=>e.seq===seq);
  const relay=teamTitleMessage(event);
  const heading=relay&&fallbackHeading(title.title,relay.text);
  if(heading)hints.set(session.id,{raw:title.title,heading});
 }
 const restore=(session:Session)=>{
  if(engine.membership(session.id))inspect(session,ctx.get('sessionTitle')?.get(session));
 };
 ctx.on('session/event',(session,e)=>{if(e.type==='session/title')inspect(session,e.data);
  if(e.type==='user/message'&&engine.membership(session.id)){
   const task=teamTitleMessage(e,session.id);if(task)remember(session.id,task.text);
  }});
 ctx.on('agent/created',({agent})=>{restore(agent.session);return undefined;});
 for(const agent of ctx.agents.list())restore(agent.session);
 return ()=>Object.fromEntries([...tasks,...hints]);
}
