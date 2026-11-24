import {useEffect,useRef,useState} from 'react';
import {Button,Input} from '@deepseek-ai/dsh-client-ui-primitives';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {TimelineEntry,TimelineScope} from '../domain/timeline.ts';
import type {OverlayProps} from './contracts.ts';
import {confirmDetach} from './member-actions.ts';
import {paneTitle} from './presentation.ts';
import {tr,localeId} from './locale.ts';
import {Select} from './Select.tsx';

type Row=TimelineEntry&{seq?:number};
function Timeline({scope,name,back,title}:{scope:TimelineScope;name:string;back:()=>void;title:(id:string)=>string}){
 const [rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<string|null>(null),[busy,loading]=useState(true),[error,setError]=useState('');
 const [details,setDetails]=useState<Record<string,string>>({});
 const [detailErrors,setDetailErrors]=useState<Record<string,string>>({});
 const [failedPage,setFailedPage]=useState<string|null>(null);
 const reading=useRef(new Set<string>());
 const abort=useRef<AbortController|null>(null);
 const params=new URLSearchParams(scope).toString();
 async function fetchJson(query:string,signal:AbortSignal){
   const response=await fetch('/api/team-desk.timeline?'+params+query,{signal});
   const result=await response.json();if(!response.ok)throw Error(result.error);return result;
 }
 async function page(before:string|null,controller:AbortController){
   loading(true);setError('');
   try{
     const value=await fetchJson(before?'&before='+encodeURIComponent(before):'',controller.signal);
     if(!controller.signal.aborted){setRows(r=>before?[...r,...value.entries]:value.entries);setCursor(value.next);}
   }catch(e){if(!controller.signal.aborted){setFailedPage(before);setError(String(e));}}
   finally{if(!controller.signal.aborted)loading(false);}
 }
 useEffect(()=>{const c=new AbortController();abort.current=c;void page(null,c);return()=>c.abort();},[params]);
 async function expand(row:Row){
   const c=abort.current;
   if(!c||row.seq===undefined||details[row.id]!==undefined||reading.current.has(row.id))return;
   reading.current.add(row.id);
   setDetailErrors(p=>({...p,[row.id]:''}));
   try{const data=await fetchJson('&source='+encodeURIComponent(row.source)+'&event='+row.seq,c.signal);
     if(!c.signal.aborted)setDetails(p=>({...p,[row.id]:JSON.stringify(data.event.data,null,2)}));
   }catch(e){if(!c.signal.aborted)setDetailErrors(p=>({...p,[row.id]:String(e)}));}finally{reading.current.delete(row.id);}
 }
 return <section><div className="td-row"><Button size="sm" onClick={back}>{tr('返回')}</Button><strong>{name} · {tr('时间线')}</strong><Button size="sm" disabled={busy} onClick={()=>{if(abort.current)void page(null,abort.current);}}>{tr('刷新')}</Button></div>
 {error&&<p role="alert">{error}</p>}
 {rows.map(row=><details key={row.id} className="td-timeline-entry" onToggle={e=>{if(e.currentTarget.open)void expand(row);}}>
   <summary><time>{new Date(row.time).toLocaleString(localeId())}</time> <strong>{row.kind}</strong> · {title(row.source)} {row.summary.slice(0,96)}</summary>
   <p>{row.summary}</p>{detailErrors[row.id]&&<p role="alert">{detailErrors[row.id]} <Button size="sm" onClick={()=>void expand(row)}>{tr('重新加载')}</Button></p>}{(details[row.id]||row.detail)&&<pre>{details[row.id]??row.detail}</pre>}
 </details>)}
 {busy&&<p role="status">{tr('加载中…')}</p>}
 {!busy&&!error&&!rows.length&&<p>{tr('暂无记录')}</p>}
 {!busy&&(cursor||error)&&<Button size="sm" onClick={()=>{if(abort.current)void page(error?failedPage:cursor,abort.current);}}>{tr(error?'重新加载':'更早记录')}</Button>}
 </section>;
}

export function SessionManagement(props:OverlayProps & {editTeam(id:string):void}){
 const view=props.useTeamDesk(s=>s),catalog=props.useSessions(s=>s);
 const periods=view.state.memberships??[],teams=view.state.teams;
 const [filter,setFilter]=useState('current'),[query,setQuery]=useState(''),[chosen,setChosen]=useState<{scope:TimelineScope;name:string}|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const archived=new Set(view.archivedIds??[]);
 const title=(id:string)=>catalog.byId[id as SessionId]?.title||catalog.byId[id as SessionId]?.displayTitle||id;
 const matches=(label:string)=>label.toLowerCase().includes(query.trim().toLowerCase());
 async function run(f:()=>Promise<unknown>){setBusy(true);setError('');try{await f();}catch(e){setError(String(e));}finally{setBusy(false);}}
 const history=(scope:TimelineScope,name:string,label='时间线')=><Button size="sm" onClick={()=>setChosen({scope,name})}>{tr(label)}</Button>;
 const memberRow=(id:string,label:string,teamId?:string,active=true,bindingId?:string)=><div className="td-row td-managed-session" key={id}>
   <span className="td-ellipsis" title={title(id)}>{paneTitle(catalog.byId[id as SessionId]?.title,label,view.titleHints?.[id])}{!active&&<small> · {tr('保留会话 · 未参与')}</small>}</span>
   <div className="td-row">{history({sessionId:id},title(id))}{!archived.has(id)&&<Button size="sm" onClick={()=>{props.closeSettings();props.returnToChat(id);}}>{tr('打开会话')}</Button>}
   {teamId&&<Button size="sm" disabled={busy} onClick={()=>{if(confirmDetach(label))void run(()=>props.perform({action:'detach',teamId,sessionId:id,bindingId}));}}>{tr('解除绑定')}</Button>}</div>
 </div>;
 if(view.loadedPage!==JSON.stringify([view.settingsTeam,'manage.sessions']))return <p role="status">{tr('加载中…')}</p>;
 if(chosen)return <Timeline key={JSON.stringify(chosen.scope)} scope={chosen.scope} name={chosen.name} back={()=>setChosen(null)} title={title}/>;
 const visible=teams.filter(t=>(filter==='current'||filter==='archived')&&archived.has(t.anchor)===(filter==='archived')&&matches([t.title,...t.members.flatMap(m=>[m.label,title(m.sessionId)])].join(' ')));
 const closed=periods.filter(p=>p.end!==undefined&&matches([p.teamTitle,p.lastTeamTitle,p.label,p.lastLabel,title(p.sessionId),teams.find(t=>t.members.some(m=>m.sessionId===p.sessionId))?.title,p.teamId].join(' '))).sort((a,b)=>b.end!-a.end!);
 const legacy=(view.legacyTeamIds??[]).filter(matches);
 return <section><div className="td-row"><Input placeholder={tr('搜索会话或团队')} aria-label={tr('搜索会话或团队')} value={query} onChange={e=>setQuery(e.target.value)}/>
 <Select aria-label={tr('会话范围')} value={filter} onValueChange={setFilter}>{[['current','当前团队'],['archived','已归档团队'],['past','历史关系']].map(([id,label])=><option key={id} value={id}>{tr(label!)}</option>)}</Select></div>
 {error&&<p role="alert">{error}</p>}
 {visible.map(t=><article key={t.id} className="td-card"><div className="td-row"><strong>{t.title}</strong><div className="td-row">{history({teamId:t.id},t.title)}
 <Button size="sm" disabled={busy} onClick={()=>void run(()=>props.perform({action:'archive-group',teamId:t.id,sessionId:t.anchor,bindingId:t.members.find(m=>m.sessionId===t.anchor)!.bindingId,restore:archived.has(t.anchor)}))}>{tr(archived.has(t.anchor)?'恢复团队':'归档团队')}</Button>
 <Button size="sm" onClick={()=>props.editTeam(t.id)}>{tr('编辑此团队')}</Button></div></div>
 {periods.some(p=>p.teamId===t.id&&p.start===undefined)&&<small>{tr('旧版未记录加入时间，可在该会话的时间线查看更早的原生记录。')}</small>}
 {memberRow(t.anchor,t.members.find(m=>m.sessionId===t.anchor)!.label)}
 <ul className="td-managed-tree">{(t.sidebarOrder??t.order).filter(id=>id!==t.anchor).map(id=><li key={id}>{memberRow(id,t.members.find(m=>m.sessionId===id)!.label,t.id,t.members.find(m=>m.sessionId===id)!.active!==false,t.members.find(m=>m.sessionId===id)!.bindingId)}</li>)}</ul></article>)}
 {filter==='past'&&<>{closed.map(p=><article key={p.id} className="td-managed-session"><strong>{p.lastTeamTitle??p.teamTitle}</strong> · {paneTitle(catalog.byId[p.sessionId as SessionId]?.title,p.lastLabel??p.label,view.titleHints?.[p.sessionId])}
 <div className="td-row"><time>{p.start===undefined?tr('既有绑定'):new Date(p.start).toLocaleString(localeId())} – {new Date(p.end!).toLocaleString(localeId())}</time>
 <div>{history({teamId:p.teamId},p.lastTeamTitle??p.teamTitle,'团队时间线')} {history({sessionId:p.sessionId},title(p.sessionId),'会话时间线')} {catalog.byId[p.sessionId as SessionId]&&!archived.has(p.sessionId)&&<Button size="sm" onClick={()=>{props.closeSettings();props.returnToChat(p.sessionId);}}>{tr('打开会话')}</Button>}</div></div></article>)}{legacy.map(id=><div className="td-row" key={id}><span>{tr('历史团队')} · {id}</span>{history({teamId:id},id)}</div>)}</>}
 {!(visible.length||(filter==='past'&&(closed.length||legacy.length)))&&<p>{tr('暂无记录')}</p>}
 </section>;
}
