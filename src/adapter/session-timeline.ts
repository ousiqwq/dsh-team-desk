import type {Context} from '@deepseek-ai/cordis';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-session-persistence';
import type {TeamEngine} from '../domain/engine.ts';
import type {MembershipPeriod} from '../domain/memberships.ts';
import {timelineOrder,type TimelineEntry} from '../domain/timeline.ts';

const limit=40;
class SourceError extends Error {}
async function readSource<T>(source:string,read:()=>Promise<T>){
  try{return await read();}catch(e){throw new SourceError(source+' · '+String(e));}
}
type Cursor={scope:string;native:Record<string,number>;boundary?:Pick<TimelineEntry,'id'|'time'>};
function summary(data:unknown):string{
  if(typeof data==='string')return data.slice(0,240);
  if(!data||typeof data!=='object')return '';
  const d=data as Record<string,unknown>;
  if(typeof d.text==='string')return d.text.slice(0,240);
  if(Array.isArray(d.content))return d.content.map(v=>typeof v?.text==='string'?v.text.slice(0,240):'').join(' ').trim().slice(0,240);
  return String(d.name??d.toolName??d.title??'')||summary(d.message??d.reason);
}

async function nativeRows(ctx:Context,id:string,periods:MembershipPeriod[]|undefined,before:number|undefined,boundary:Cursor['boundary'],signal:AbortSignal){
  const rows:(TimelineEntry&{seq:number})[]=[];
  if(before===0)return rows;
  const key=SessionId(id),live=ctx.sessions.get(key);
  if(before===undefined&&live)await ctx.sessions.flush(live);
  const stat=await ctx.sessionPersistence.stat(key);
  if(!stat)return rows;
  await using handle=await ctx.sessionPersistence.open(key,'read');
  const read=(offset:number,length:number)=>handle.read(offset,length,{signal});
  let end=before??stat.eventCount;
  if(end===undefined){
    // Some storage backends omit the count. Locate the tail without materializing the log.
    let lower=0,upper=1;
    while((await read(upper-1,1)).events.length){lower=upper;upper*=2;}
    while(lower+1<upper){const mid=Math.floor((lower+upper)/2);if((await read(mid-1,1)).events.length)lower=mid;else upper=mid;}
    end=lower;
  }
  const minimum=periods?Math.min(...periods.map(p=>p.start??p.observed)):0;
  while(end>0&&rows.length<=limit){
    const from=Math.max(0,end-64),page=await read(from,end-from);
    end=from;
    for(const event of [...page.events].reverse()){
      if(event.time<minimum)return rows;
      if(periods&&!periods.some(p=>event.time>=(p.start??p.observed)&&event.time<(p.end??Infinity)))continue;
      const key='native/'+id+'/'+String(event.seq).padStart(16,'0');
      if(boundary&&(event.time>boundary.time||event.time===boundary.time&&key>=boundary.id))continue;
      rows.push({id:key,source:id,seq:event.seq,time:event.time,kind:event.type,summary:summary(event.data)});
      if(rows.length>limit)return rows;
    }
  }
  return rows;
}

export function installSessionHistory(ctx:Context,engine:TeamEngine){
  // DSH's exact fetch routes accept only authenticated owner peers. Timelines never resolve an agent.
  ctx.connection.fetch.register({path:'/api/team-desk.timeline',methods:['GET'],requestBody:'buffered',fetch:async request=>{
    try{
      const q=new URL(request.url).searchParams,teamId=q.get('teamId'),sessionId=q.get('sessionId');
      if(Boolean(teamId)===Boolean(sessionId))throw Error('请选择一个团队或会话');
      const periods=engine.membershipHistory().filter(p=>teamId?p.teamId===teamId:p.sessionId===sessionId);
      if(!periods.length&&!(teamId&&engine.historicalTeams().has(teamId)))throw Error('没有此团队或会话的绑定记录');
      const identity=JSON.stringify([teamId,sessionId]),raw=q.get('before');
      const cursor:Cursor=raw?JSON.parse(Buffer.from(raw,'base64url').toString()):{scope:identity,native:{}};
      if(cursor.scope!==identity||!cursor.native||Object.values(cursor.native).some(n=>!Number.isSafeInteger(n)||n<0))throw Error('时间线游标无效');
      const ids=[...new Set(periods.map(p=>p.sessionId))];
      const detail=q.get('event'),source=q.get('source');
      if(detail!==null){
        if(!source||!ids.includes(source)||!/^\d+$/.test(detail))throw Error('无效的会话记录');
        await using h=await readSource(source,()=>ctx.sessionPersistence.open(SessionId(source),'read'));
        const e=(await readSource(source,()=>h.read(Number(detail),1,{signal:request.signal}))).events[0];
        if(!e||teamId&&!periods.some(p=>p.sessionId===source&&e.time>=(p.start??p.observed)&&e.time<(p.end??Infinity)))throw Error('会话记录不在此范围内');
        return Response.json({event:e});
      }
      const [collaboration,sources]=await Promise.all([
        readSource('协作记录',()=>engine.collaborationHistory(teamId?{teamId}:{sessionId:sessionId!})),
        Promise.all(ids.map(id=>readSource(id,()=>nativeRows(ctx,id,teamId?periods.filter(p=>p.sessionId===id):undefined,cursor.native[id],cursor.boundary,request.signal))))
      ]);
      const boundary=cursor.boundary;
      const records=boundary?collaboration.filter(r=>r.time<boundary.time||r.time===boundary.time&&r.id<boundary.id):collaboration;
      const merged=[...sources.flat(),...records.slice(0,limit+1)].sort(timelineOrder);
      const entries=merged.slice(0,limit);
      for(const row of entries){
        if('seq' in row)cursor.native[row.source]=Number(row.seq);

      }
      const last=entries.at(-1);if(last)cursor.boundary={id:last.id,time:last.time};
      for(let i=0;i<ids.length;i++)if(!sources[i]!.length)cursor.native[ids[i]!]=0;
      return Response.json({entries,next:merged.length>limit?Buffer.from(JSON.stringify(cursor)).toString('base64url'):null});
    }catch(e){return Response.json({error:String(e)},{status:e instanceof SourceError?503:400});}
  }});
}
