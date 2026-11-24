import {incidentSettings,incidentSupervisor,type IncidentSettings} from '../domain/incident-settings.ts';
import {SeatFields} from './SeatSettings.tsx';
import {Help,SectionTitle} from './ui.tsx';
import {Input,Menu} from '@deepseek-ai/dsh-client-ui-primitives';
import {tr, messageText} from './locale.ts';
import {RouteProbe} from './Maintenance.tsx';
import {useEffect,useRef,useState,useMemo,useId,type MouseEvent,type KeyboardEvent} from 'react';
import {Button,Switch,SegmentedTabs,IconTrashOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Team,Operation} from '../domain/types.ts';
import type {Injected} from './contracts.ts';
import {GraphInspector} from './GraphInspector.tsx';
import {fitCamera,zoomCamera,graphPoint,inspectorBounds,type Camera} from './graph-view.ts';
import {PersonaBinding,PresetPersona} from './PersonaBinding.tsx';
import {arrangeGraph,graphEdges,NODE_WIDTH as W,NODE_HEIGHT as H,type Point} from '../domain/graph-layout.ts';
interface MemberActions {add(point?:Point):void;remove(id:string):void;makeEntry(id:string):void;}
const incidentLabels:Record<keyof IncidentSettings,string>={
 viewAll:'查看全队异常记录',notifyAll:'接收全队异常通知',notifyOwn:'接收自己派单的异常通知',
};

export function Graph({team,perform,title,template=false,draftMode=false,selection,onSelection,memberActions}:{team:Team;perform:Injected['perform'];title:(id:string)=>string;template?:boolean;draftMode?:boolean;selection?:string;onSelection?:(id:string)=>void;memberActions?:MemberActions}){
 const marker=useId().replace(/:/g,''),[table,setTable]=useState(false),members=team.members.filter(m=>m.active!==false),model=members.map(m=>({id:m.sessionId,label:m.label,targets:m.targets,send:m.operations.includes('send')}));
 const automatic=useMemo(()=>arrangeGraph(model,team.anchor),[JSON.stringify(model),team.anchor]);
 const [localSelection,setSelected]=useState(team.anchor),[edge,setEdge]=useState<{source:string;target:string}>(),[wire,setWire]=useState<{id:string;point:Point}>(),[positions,setPositions]=useState<Record<string,Point>>({}),[camera,setCamera]=useState<Camera>({x:0,y:0,zoom:1}),[areaWidth,setAreaWidth]=useState(0),[panning,setPanning]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const viewport=useRef<HTMLDivElement>(null),workarea=useRef<HTMLDivElement>(null),moving=useRef<{id:string;point:Point;client:Point;zoom:number;last:Point}|undefined>(undefined),pan=useRef<{pointer:number;client:Point;camera:Camera;manual:boolean}|undefined>(undefined),manualCamera=useRef(false);
 const selected=selection&&members.some(m=>m.sessionId===selection)?selection:localSelection;
 const [inspectorPage,setInspectorPage]=useState('prompt'),inspectorId=useId();useEffect(()=>{setEdge(undefined);},[selection]);
 const zoom=camera.zoom;
 const stopPan=(cancel=false)=>{const d=pan.current;if(cancel&&d){setCamera(d.camera);manualCamera.current=d.manual;}pan.current=undefined;setPanning(false);};
 const fit=()=>{const v=viewport.current;if(v?.clientWidth&&v.clientHeight){manualCamera.current=false;setCamera(fitCamera({width:v.clientWidth,height:v.clientHeight},{width,height}));}};
 const changeZoom=(delta:number)=>{const v=viewport.current;if(!v)return;manualCamera.current=true;setCamera(c=>zoomCamera(c,c.zoom+delta,{x:v.clientWidth/2,y:v.clientHeight/2}));};
 const point=(id:string):Point=>positions[id]??team.graph?.[id]??automatic[id]??{x:64,y:64};
 const edges=useMemo(()=>graphEdges(model,Object.fromEntries(members.map(m=>[m.sessionId,point(m.sessionId)]))),[JSON.stringify(model),JSON.stringify(positions),JSON.stringify(team.graph)]);
 const width=Math.max(560,...members.map(m=>point(m.sessionId).x+W+90)),height=Math.max(330,...members.map(m=>point(m.sessionId).y+H+90));
 const m=team.members.find(m=>m.sessionId===selected),[name,setName]=useState(m?.label??''),[prompt,setPrompt]=useState(m?.prompt??'');useEffect(()=>{setName(m?.label??'');},[m?.label,m?.sessionId]);useEffect(()=>{setPrompt(m?.prompt??'');},[m?.prompt,m?.sessionId]);
 useEffect(()=>{if(!moving.current)setPositions({});},[JSON.stringify(team.graph)]);
 async function run(data:Record<string,unknown>){setBusy(true);setError('');try{await perform({teamId:team.id,...data});}catch(e){setError(String(e));}finally{setBusy(false);}}
 useEffect(()=>{if(!members.some(m=>m.sessionId===selected))setSelected(team.anchor);},[members.map(m=>m.sessionId).join(',')]);
 useEffect(()=>{const v=viewport.current;if(!v)return;const observer=new ResizeObserver(()=>{if(!manualCamera.current)fit();});observer.observe(v);return()=>observer.disconnect();},[width,height,table]);
 useEffect(()=>{const area=workarea.current;if(!area)return;const observer=new ResizeObserver(()=>setAreaWidth(area.clientWidth));observer.observe(area);return()=>observer.disconnect();},[]);
 const input=(id:string)=>{const p=point(id);return {x:p.x,y:p.y+H/2};},output=(id:string)=>{const p=point(id);return {x:p.x+W,y:p.y+H/2};};
 const curve=(a:Point,b:Point)=>{const c=Math.max(70,Math.abs(b.x-a.x)*.45);return `M${a.x},${a.y} C${a.x+c},${a.y} ${b.x-c},${b.y} ${b.x},${b.y}`;};
 const connect=(target:string)=>{if(!wire||wire.id===target)return;const source=wire.id;setWire(undefined);void run({action:'connection',source,target,enabled:true});};
 const [menu,setMenu]=useState<{point:Point;placement:Point|undefined;member:string|undefined;trigger:HTMLElement}>();
 function openMemberMenu(event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>){
  if(!memberActions||!(event.target instanceof Element))return;
  const keyboard='key' in event;
  if(keyboard&&event.key!=='ContextMenu'&&!(event.shiftKey&&event.key==='F10'))return;
  event.preventDefault();event.stopPropagation();
  const node=event.target.closest<HTMLElement>('[data-graph-node],[data-graph-row]');
  const trigger=node??event.currentTarget;
  const bounds=trigger.getBoundingClientRect();
  const point=keyboard?{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}:{x:event.clientX,y:event.clientY};
  const member=node?.dataset.graphNode??node?.dataset.graphRow;
  setEdge(undefined);setWire(undefined);
  if(member){setSelected(member);onSelection?.(member);}
  const view=viewport.current;
  let placement:Point|undefined;
  if(!member&&view&&view===event.currentTarget){
   const rect=view.getBoundingClientRect(),p=graphPoint({x:point.x-rect.left,y:point.y-rect.top},camera);
   placement={x:Math.max(10,Math.min(4800,p.x-W/2)),y:Math.max(10,Math.min(4800,p.y-H/2))};
  }
  setMenu({point,member,placement,trigger});
 }
 return <div className="td-graph" data-team-graph="" onKeyDown={e=>{if(e.key==='Escape'){if(pan.current||moving.current||wire){e.preventDefault();e.stopPropagation();stopPan(true);moving.current=undefined;setPositions({});}setWire(undefined);setEdge(undefined);}if((e.key==='Delete'||e.key==='Backspace')&&edge&&!(e.target as HTMLElement).closest('input,textarea,[contenteditable=true]')){e.preventDefault();void run({action:'connection',...edge,enabled:false});setEdge(undefined);}}}>
  <div className="td-graph-toolbar"><div><strong>{tr("协作关系")}</strong><Help label={tr("画布操作说明")} text={tr("可拖动空白处平移，选择连线后按 Delete 移除。没有连线的成员仍可独立工作。")+(memberActions?" "+tr("右击空白处添加成员，右击成员管理。键盘可用 Shift+F10。"):"")}/></div>{!template&&<Switch label={tr("团队通信")} checked={!team.paused} disabled={busy} onChange={v=>void run({action:'pause',paused:!v})}/>}{!template&&<span className="td-muted">{team.paused?tr("已暂停"):tr("已启用")}</span>}<Button size="sm" onClick={()=>{setPositions({});manualCamera.current=false;void run({action:'graph-arrange'}).then(fit);}}>{tr("整理布局")}</Button><Button size="sm" onClick={()=>setTable(v=>!v)}>{table?tr("关系图"):tr("关系表")}</Button><Button size="sm" onClick={()=>changeZoom(-.15)} aria-label={tr("缩小关系图")}>−</Button><span className="td-muted">{Math.round(zoom*100)}%</span><Button size="sm" onClick={()=>changeZoom(.15)} aria-label={tr("放大关系图")}>＋</Button><Button size="sm" onClick={fit}>{tr("适应")}</Button></div>
  {!template&&team.paused&&<p className="td-muted" data-team-paused="" role="status">{tr("团队通信已暂停，当前任务不会派发给其他成员。")}</p>}
  {error&&<p role="alert" className="td-error">{messageText(error)}</p>}
  <div className="td-graph-workarea" ref={workarea} data-stacked={inspectorBounds(areaWidth).stacked}><div className="td-graph-viewport" hidden={table} ref={viewport} tabIndex={0} aria-label={tr("协作关系画布")} onContextMenu={openMemberMenu} onKeyDown={openMemberMenu} data-panning={panning} data-camera-x={camera.x} data-camera-y={camera.y} data-camera-zoom={zoom} style={{backgroundPosition:`${camera.x}px ${camera.y}px`,backgroundSize:`${18*zoom}px ${18*zoom}px`}}
   onPointerDown={e=>{if(e.button!==0||!(e.target instanceof Element)||e.target.closest('button,input,[data-graph-node],path'))return;e.preventDefault();e.currentTarget.focus({preventScroll:true});pan.current={pointer:e.pointerId,client:{x:e.clientX,y:e.clientY},camera,manual:manualCamera.current};manualCamera.current=true;setPanning(true);e.currentTarget.setPointerCapture(e.pointerId);setEdge(undefined);}}
   onPointerMove={e=>{const d=pan.current;if(d?.pointer===e.pointerId)setCamera({...d.camera,x:d.camera.x+e.clientX-d.client.x,y:d.camera.y+e.clientY-d.client.y});}} onPointerUp={()=>stopPan()} onPointerCancel={()=>stopPan(true)} onLostPointerCapture={()=>stopPan(true)}>
   <div className="td-graph-plane" style={{width,height,transform:`translate(${camera.x}px,${camera.y}px) scale(${zoom})`}}>
    <svg className="td-graph-lines" width={width} height={height} aria-label={tr("成员通信连线")}><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8Z" fill="currentColor"/></marker></defs>
     {edges.map(line=><g key={line.source+'-'+line.target} data-graph-edge={line.source+'->'+line.target} data-enabled={line.forward||line.backward} data-selected={edge?.source===line.source&&edge.target===line.target} data-muted={!!selected&&selected!==line.source&&selected!==line.target}>
      <path className="td-edge-hit" d={line.path} role="button" tabIndex={0} aria-label={title(line.source)+(line.reverse?' ↔ ':' → ')+title(line.target)} onClick={()=>setEdge({source:line.source,target:line.target})} onKeyDown={e=>{if(e.key==='Enter')setEdge({source:line.source,target:line.target});}}/>
      <path className="td-edge-line" d={line.path} markerEnd={'url(#'+marker+')'} markerStart={line.reverse?'url(#'+marker+')':undefined}/>
     </g>)}
     {wire&&<path className="td-edge-draft" d={curve(output(wire.id),wire.point)}/>}
    </svg>
    {members.map(member=>{const id=member.sessionId,p=point(id);return <div key={id} className="td-graph-node" data-graph-node={id} tabIndex={0} data-selected={selected===id} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelected(id);onSelection?.(id);setEdge(undefined);}}} style={{left:p.x,top:p.y,width:W,height:H}} onPointerDown={e=>{if(e.button!==0||(e.target as HTMLElement).closest('button'))return;e.stopPropagation();setSelected(id);onSelection?.(id);setEdge(undefined);e.currentTarget.focus({preventScroll:true});manualCamera.current=true;moving.current={id,point:p,last:p,client:{x:e.clientX,y:e.clientY},zoom};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=moving.current;if(d?.id!==id)return;d.last={x:Math.max(10,Math.min(4800,d.point.x+(e.clientX-d.client.x)/d.zoom)),y:Math.max(10,Math.min(4800,d.point.y+(e.clientY-d.client.y)/d.zoom))};setPositions(old=>({...old,[id]:d.last}));}}
      onPointerUp={()=>{const d=moving.current;if(d?.id!==id)return;moving.current=undefined;if(d.last.x!==d.point.x||d.last.y!==d.point.y)void run({action:'graph-position',sessionId:id,...d.last});}} onPointerCancel={()=>{moving.current=undefined;setPositions({});}}>
      <div className="td-node-heading"><strong title={title(id)}>{member.label}</strong><span className="td-badge">{id===team.anchor?tr("主会话"):tr("成员")}</span></div><div className="td-node-title" title={title(id)}>{title(id)}</div><div className="td-node-meta">{tr("{p0} ·{p1} 个连接", {p0: member.operations.includes('send')?tr("可发送"):tr("不发送"), p1: member.targets.length})}</div>
      <button type="button" className="td-graph-port input" data-graph-input={id} aria-label={tr("接收连接 ")+member.label} onClick={()=>connect(id)}/>
      <button type="button" className="td-graph-port output" aria-label={tr("发送连接 ")+member.label} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.currentTarget.setPointerCapture(e.pointerId);setWire({id,point:output(id)});}}
       onPointerMove={e=>{if(wire?.id!==id||!viewport.current)return;const r=viewport.current.getBoundingClientRect();setWire({id,point:graphPoint({x:e.clientX-r.left,y:e.clientY-r.top},camera)});}}
       onPointerUp={e=>{const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-graph-input]')?.dataset.graphInput;if(target)connect(target);else setWire(undefined);}} onPointerCancel={()=>setWire(undefined)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setWire({id,point:output(id)});}}}/>
     </div>;})}
   </div>
  </div>
  {table&&<div className="td-relation-table" tabIndex={memberActions?0:undefined} onContextMenu={openMemberMenu} onKeyDown={openMemberMenu}><table><caption>{tr("行成员 → 列成员")}</caption><thead><tr><th>{tr("发送方")}</th>{members.map(m=><th key={m.sessionId}>{m.label}</th>)}</tr></thead><tbody>{members.map(a=><tr key={a.sessionId} data-graph-row={a.sessionId}><th data-graph-node={a.sessionId} tabIndex={memberActions?0:undefined}>{a.label}</th>{members.map(b=><td key={b.sessionId}>{a===b?'—':<Switch label={a.label+' → '+b.label} checked={a.targets.includes(b.sessionId)} disabled={busy} onChange={enabled=>void run({action:'connection',source:a.sessionId,target:b.sessionId,enabled})}/>}</td>)}</tr>)}</tbody></table></div>}
  <GraphInspector width={areaWidth}>
   {edge?<><SectionTitle title={tr("通信关系")} hint={tr("这条线允许源会话给目标发送消息；不是固定的任务执行顺序。")}/>{!template&&<RouteProbe key={edge.source+edge.target} team={team} from={edge.source} to={edge.target} perform={perform}/>}{[[edge.source,edge.target],[edge.target,edge.source]].map(([source,target])=><div className="td-operation" key={source}><span>{team.members.find(m=>m.sessionId===source)?.label} → {team.members.find(m=>m.sessionId===target)?.label}</span><Switch label={tr("允许 ")+source+' → '+target} checked={!!team.members.find(m=>m.sessionId===source)?.targets.includes(target!)} disabled={busy} onChange={enabled=>void run({action:'connection',source,target,enabled})}/></div>)}<Button variant="outline" disabled={busy} onClick={()=>{void run({action:'connection',...edge,enabled:false});setEdge(undefined);}}><IconTrashOutlineRegular size={16}/>{tr("移除连线")}</Button></>:m?<><h3>{m.label}</h3><form onSubmit={e=>{e.preventDefault();void run({action:'rename',sessionId:m.sessionId,title:name});}}><label>{tr("协作名称")}<Input value={name} required maxLength={120} onChange={e=>{setName(e.target.value);if(template||draftMode)void perform({action:'rename',sessionId:m.sessionId,title:e.target.value});}}/></label><Button type="submit" size="sm" disabled={busy||name===m.label} hidden={template||draftMode}>{tr("保存名称")}</Button></form><SegmentedTabs className="td-inspector-tabs" size="sm" label={tr("成员属性")} value={inspectorPage} onChange={setInspectorPage} items={[{value:'prompt',label:tr("提示词"),id:inspectorId+'-prompt-tab',panelId:inspectorId+'-prompt'},{value:'access',label:tr("人设与权限"),id:inspectorId+'-access-tab',panelId:inspectorId+'-access'}]}/><div role="tabpanel" id={inspectorId+'-prompt'} aria-labelledby={inspectorId+'-prompt-tab'} hidden={inspectorPage!=='prompt'} className="td-inspector-prompt"><form onSubmit={e=>{e.preventDefault();void run({action:'member-prompt',sessionId:m.sessionId,prompt});}}><label>{tr("协作提示词")}<textarea rows={10} aria-label={tr("协作提示词")} maxLength={16000} value={prompt} onChange={e=>{setPrompt(e.target.value);if(template||draftMode)void perform({action:'member-prompt',sessionId:m.sessionId,prompt:e.target.value});}} placeholder={tr("可留空，不额外规定分工")}/></label>{/session-[0-9a-f]{8}-[0-9a-f-]{27}/i.test(prompt)&&<p>{tr('提示词包含固定会话地址。更换成员后，请按当前团队名册选择接收方。')}</p>}<Button type="submit" size="sm" disabled={busy||prompt===(m.prompt??'')} hidden={template||draftMode}>{tr("保存提示词")}</Button></form></div><div role="tabpanel" id={inspectorId+'-access'} aria-labelledby={inspectorId+'-access-tab'} hidden={inspectorPage!=='access'}>{inspectorPage==='access'&&(template||draftMode)&&<SeatFields value={m.native} onChange={native=>void perform({action:'member-native',sessionId:m.sessionId,native})}/>} {template||draftMode?<PresetPersona value={m.soul} onChange={soul=>void perform({action:"member-soul",sessionId:m.sessionId,soul})}/>:<PersonaBinding sessionId={m.sessionId}/>}<SectionTitle title={tr("允许的操作")} hint={tr("职责由对话提示词决定。关闭发送操作会使已保留的连线暂时不可用。")}/>{(['send','read','wait'] as Operation[]).map(op=><div key={op} className="td-operation"><span>{{send:tr("发送消息"),read:tr("读取收发记录"),wait:tr("等待消息")}[op]}</span><Switch label={m.label+' '+op} checked={m.operations.includes(op)} disabled={busy} onChange={enabled=>void run({action:'operation',sessionId:m.sessionId,operation:op,enabled})}/></div>)}
      {(template||draftMode)&&<><SectionTitle title={tr('异常记录与通知')}/>
        {(['viewAll','notifyAll','notifyOwn'] as const).map(setting=><div className="td-operation" key={setting}>
          <span>{tr(incidentLabels[setting]!)}</span>
          <Switch label={tr(incidentLabels[setting]!)} checked={incidentSettings(m,incidentSupervisor(team))[setting]}
            disabled={busy} onChange={enabled=>void perform({action:'member-incidents',sessionId:m.sessionId,setting,enabled})}/>
        </div>)}</>}
      </div></>:<p>{tr("选择节点或连线以编辑。")}</p>}
  </GraphInspector></div>
  {menu&&memberActions&&<Menu open contextual portal compact autoFocus anchor={null} anchorPoint={menu.point}
   returnFocus={()=>menu.trigger.isConnected?menu.trigger:viewport.current}
   onClose={()=>setMenu(undefined)} items={[
    {id:'add',label:tr("添加成员"),disabled:members.length>=12},
    ...(menu.member?[
     {id:'entry',label:tr("设为主成员"),disabled:menu.member===team.anchor},
     {id:'remove',label:tr("移除成员"),disabled:members.length<=1,danger:true}
    ]:[])
   ]} onSelect={action=>{
    if(action==='add')memberActions.add(menu.placement);
    if(action==='entry'&&menu.member)memberActions.makeEntry(menu.member);
    if(action==='remove'&&menu.member)memberActions.remove(menu.member);
    setMenu(undefined);
   }}/>}
  {wire&&<p className="td-muted" role="status">{tr("选择接收端连接；Esc 取消。")}</p>}
 </div>;
}
