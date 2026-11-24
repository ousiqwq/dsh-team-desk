import {SessionManagement} from './SessionManagement.tsx';
import {confirmDetach} from './member-actions.ts';
import {BlockedRequests} from './BlockedRequests.tsx';
import {useSeatConfirmation} from './SeatSettings.tsx';
import {useDraft} from './use-draft.ts';
import {ConfigurationGraph} from './ConfigurationGraph.tsx';
import {draftGuard} from './draft-guard.ts';
import {useSyncExternalStore} from 'react';
import {Select} from './Select.tsx';
import {Help,SectionTitle} from './ui.tsx';
import {Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {NativeOverview,NativeOptions,NativeSettings} from './Native.tsx';
import {tr, messageText} from './locale.ts';
import {CoordinationRecords} from './Maintenance.tsx';
import {Resources} from './Resources.tsx';
import {ProjectGit} from './Git.tsx';
import {SharedView,DeliveryStatus} from './Coordination.tsx';
import {newId} from './id.ts';
import {useEffect,useRef,useState} from 'react';
import {Button,Switch,Menu,Modal,IconChevronDownOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {OverlayProps} from './contracts.ts';
import type {Member,Team,Layout} from '../domain/types.ts';
import {PresetLibrary} from './PresetLibrary.tsx';import {CurrentConfiguration,TeamSwitch,LayoutSettings} from './TeamConfiguration.tsx';import {PersonaBinding} from './PersonaBinding.tsx';import {Graph} from './Graph.tsx';import {layoutNames} from './presentation.ts';
type TeamProps=OverlayProps & {close:()=>void};
function MemberRow({member,team,props,title,run,busy}:{member:Member;team:Team;props:TeamProps;title:string;run:(f:()=>Promise<unknown>)=>Promise<unknown>;busy:boolean}){
  const [name,setName]=useState(member.label);useEffect(()=>setName(member.label),[member.label]);
  useDraft(name!==member.label,()=>setName(member.label));
  return <article className="td-card" data-member-settings={member.sessionId}>
    <div className="td-row"><strong className="td-ellipsis" title={title}>{title}</strong><span className="td-badge">{member.active===false?tr("保留会话 · 未参与"):member.sessionId===team.anchor?tr("主会话"):member.owned?tr("成员会话"):tr("已有关联")}</span></div>
    <form className="td-inline-form" onSubmit={e=>{e.preventDefault();void run(()=>props.perform({action:'rename',teamId:team.id,sessionId:member.sessionId,title:name}));}}>
      <label>{tr("协作名称")}<Input value={name} onChange={e=>setName(e.target.value)} maxLength={120} required aria-label={tr("协作名称")}/></label><Button type="submit" size="sm" variant="outline" disabled={busy||!name.trim()||name===member.label}>{tr("保存名称")}</Button>
    </form>
    <PersonaBinding sessionId={member.sessionId}/>
    <div className="td-row td-row-end"><Button size="sm" onClick={()=>draftGuard.request(()=>{props.close();props.returnToChat(member.sessionId);})}>{tr("打开会话")}</Button>
      {member.sessionId!==team.anchor&&<Button size="sm" disabled={busy} onClick={()=>{if(confirmDetach(title))void run(()=>props.perform({action:'detach',teamId:team.id,sessionId:member.sessionId,bindingId:member.bindingId}));}}>{tr('解除绑定')}</Button>}
    </div>
  </article>;
}

function Management(props:OverlayProps & {page:string;editTeam(id:string):void}){
 const data=props.useTeamDesk(s=>s),prefs=data.preferences,[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(change:Record<string,unknown>){setBusy(true);setError('');try{await props.perform({action:'preferences',change});}catch(e){setError(String(e));}finally{setBusy(false);}}
 return <div data-team-management="">{props.page==='sessions'&&<SessionManagement {...props}/>}<section hidden={props.page!=='native'}>{props.page==='native'&&<NativeSettings nativeConfigForm={props.nativeConfigForm}/>}</section><section hidden={props.page!=='resources'}>{props.page==='resources'&&<Resources state={data.state} perform={props.perform}/>}</section><section hidden={props.page!=='library'}>{props.page==='library'&&<PresetLibrary presets={data.state.presets} perform={props.perform}/>}</section><section hidden={props.page!=='preferences'} data-display-preferences=""><div className="td-settings-heading"><SectionTitle title={tr("显示与交互")} hint={tr("这些偏好应用于所有团队。")}/></div>{error&&<p role="alert">{messageText(error)}</p>}
  <article className="td-card"><SectionTitle title={tr("窗口排布")} hint={tr("关闭窗格只改变排布。已保存的团队启用或暂停状态会保留；重启不会自动重发旧任务。")}/><div className="td-preset-pair"><label>{tr("新团队的默认排布")}<Select value={prefs.defaultLayout} disabled={busy} onValueChange={e=>void save({defaultLayout:e as Layout})} aria-label={tr("新团队的默认排布")}>{Object.entries(layoutNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>
  <label>{tr("窗口动画")}<Select value={prefs.motion} disabled={busy} onValueChange={e=>void save({motion:e})} aria-label={tr("窗口动画")}><option value="system">{tr("跟随系统")}</option><option value="reduced">{tr("减少动态效果")}</option></Select></label></div></article>
  <article className="td-card"><div className="td-preference"><div><strong>{tr("高亮当前窗格")}</strong><Help text={tr("在当前窗格顶部显示蓝色焦点条，默认关闭；设置保存在此浏览器。")}/></div><Switch label={tr("高亮当前窗格")} checked={data.showFocusIndicator} onChange={props.setFocusIndicator}/></div></article>
  <article className="td-card"><SectionTitle title={tr("吸附预览")}/><div className="td-preference"><div><strong>{tr("吸附预览")}</strong><Help text={tr("拖入会话时显示即将占用的区域。")}/></div><Switch label={tr("吸附预览")} checked={prefs.snapPreview} disabled={busy} onChange={v=>void save({snapPreview:v})}/></div>
  <div className="td-preference"><div><strong>{tr("显示其他窗格预览框")}</strong><Help text={tr("拖动时用边框标出其他窗格的位置；关闭后只高亮当前放置区域。")}/></div><Switch label={tr("显示其他窗格预览框")} checked={prefs.showOtherPreviews} disabled={busy||!prefs.snapPreview} onChange={v=>void save({showOtherPreviews:v})}/></div></article>
  {data.syncPending?.length||data.health?.lastIssue?<details className="td-card"><summary>{tr("运行与恢复")}</summary><p>{data.health?.lastIssue}</p>{data.syncPending?.map(o=><p key={o.id}>{o.origin?.teamId??tr("旧记录缺少来源")} · {o.resource} <a href={'/api/team-desk.sync-record?id='+o.id} download>{tr("下载原记录")}</a></p>)}<Button size="sm" onClick={()=>void props.perform({action:'sync-reconcile'}).catch(e=>setError(String(e)))}>{tr("核对未完成的同步记录")}</Button></details>:null}
  <div className="td-reference-link"><a className="td-download" href="/api/team-desk.reference" download>{tr("下载架构、接口与预设编写文档")}</a></div></section>
 </div>;
}
const sections=[{id:'graph',get label(){return tr("当前团队");}},{id:'native',get label(){return tr('任务与运行');}},{id:'native-options',get label(){return tr('模型与原生预设');}},{id:'members',get label(){return tr("成员与会话");}},{id:'preset',get label(){return tr("切换预设");}},{id:'layout',get label(){return tr("窗口排布");}},{id:'sync',get label(){return tr("通信与同步");}},{id:'git',get label(){return tr("项目与 Git");}},{id:'records',get label(){return tr("协作记录");}}];
export function TeamDialog(props:OverlayProps){
 const data=props.useTeamDesk(s=>s),catalog=props.useSessions(s=>s),[area,setArea]=useState('current'),[managementPage,setManagementPage]=useState('library'),[tab,setTab]=useState('graph'),[name,setName]=useState(''),[existing,setExisting]=useState(''),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editingCurrent,setEditingCurrent]=useState(false),[recordType,setRecordType]=useState('all'),[navOpen,setNavOpen]=useState(false);
 useEffect(()=>{if(data.dialog)props.selectManagementPage(area==='current'?tab:'manage.'+managementPage);},[data.dialog,area,tab,managementPage]);
 const editorActions=useSyncExternalStore(props.feedback.subscribe,props.feedback.editorActions);
 const pendingLeave=useSyncExternalStore(draftGuard.subscribe,draftGuard.getSnapshot);
 const [createRequest,setCreateRequest]=useState<{sessionId:string;isNew:boolean}|null>(null);
 const team=data.state.teams.find(t=>t.id===data.settingsTeam),anchor=team?.anchor||data.settingsSession,main=catalog.byId[anchor as SessionId],title=(id:string)=>catalog.byId[id as SessionId]?.title||team?.members.find(m=>m.sessionId===id)?.label||tr("新会话");
 const sessionTitle=main?.title?.trim(),heading=sessionTitle?tr("当前「{p0}」会话团队",{p0:sessionTitle}):main?tr("新会话 · 团队配置"):tr("当前团队");
 useEffect(()=>{setError('');setExisting('');setQuery('');setName('');setArea('current');setTab('graph');setEditingCurrent(false);setCreateRequest(null);},[data.settingsTeam,data.settingsSession,data.dialog]);
 async function run(fn:()=>Promise<unknown>){setBusy(true);setError('');try{return await fn();}catch(e){setError(String(e));return undefined;}finally{setBusy(false);}}
 const seatConfirmation=useSeatConfirmation(team,data.state.presets,props.perform);
 const p:TeamProps={...props,close:props.closeSettings};
 type Addition={key:string;id:string;label:string};
 const addRequest=useRef<Addition|null>(null);
 function nextAddition(teamId:string,key:string,label:string):Addition{
   const storageKey='dsh.team-desk.add.'+teamId;
   if(addRequest.current?.key===key)return addRequest.current;
   try{
     const old=JSON.parse(sessionStorage.getItem(storageKey)??'null');
     if(old?.key===key&&typeof old.id==='string'&&typeof old.label==='string')return addRequest.current=old;
   }catch{}
   const request={key,id:newId(),label};addRequest.current=request;
   try{sessionStorage.setItem(storageKey,JSON.stringify(request));}catch{}
   return request;
 }
 const candidates=Object.values(catalog.byId).filter(s=>!s.origin&&!data.archivedIds?.includes(s.id)&&!data.state.teams.some(t=>t.members.some(m=>m.sessionId===s.id))&&`${s.title??s.displayTitle}`.toLowerCase().includes(query.toLowerCase()));
 const child=(group:string,item:{id:string;label:string})=>({id:group+'.'+item.id,label:<span data-td-nav-child={group}>{item.label}</span>});
 const rows=[{id:'current',label:<span data-td-nav-group="current" data-active={area==='current'}>{tr("当前会话")}</span>},...(team?sections:[{id:'graph',label:tr("创建团队")}]).map(item=>child('current',item)),{id:'manage',label:<span data-td-nav-group="manage" data-active={area==='manage'}>{tr("管理")}</span>},...[{id:'sessions',label:tr('团队与会话')},{id:'library',label:tr("预设库")},{id:'preferences',label:tr("显示与交互")},{id:'resources',label:tr("共享工具实例")},{id:'native',label:tr('原生代理设置')}].map(item=>child('manage',item))];
 const select=(id:string)=>draftGuard.request(()=>{const [group,page]=id.split('.');if(group==='current'){setArea('current');if(page)setTab(page);}else if(group==='manage'){setArea('manage');if(page)setManagementPage(page);}});
 const content=<div className="td-settings td-team-editor" data-team-editor="">
  <div className="td-mobile-nav"><Menu open={navOpen} onClose={()=>setNavOpen(false)} selectedId={area==='current'?'current.'+tab:'manage.'+managementPage} onSelect={id=>{select(id);setNavOpen(false);}} items={rows.map(r=>({id:r.id,label:r.label}))} portal minWidthFromAnchor anchor={<Button variant="outline" aria-label={tr('切换设置页面')} aria-haspopup="menu" aria-expanded={navOpen} onClick={()=>setNavOpen(v=>!v)}><span>{area==='current'?tr('当前会话'):tr('管理')} · {rows.find(r=>r.id===(area==='current'?'current.'+tab:'manage.'+managementPage))?.label}</span><IconChevronDownOutlineRegular size={14}/></Button>}/></div>
  <section hidden={area!=='current'} data-team-current="">
  {error&&<p className="td-error" role="alert">{messageText(error)}</p>}
  {!team?<div className="td-create-team" data-team-create={main?.blank?'new':'current'}><h2>{heading}</h2><Help text={tr("将这个会话作为主会话，添加独立成员并配置协作关系。")}/><Button variant="primary" disabled={busy||!anchor||!main} onClick={()=>setCreateRequest({sessionId:anchor,isNew:main?.blank===true})}>{tr("创建团队")}</Button></div>:<>
   <div className="td-editor-heading"><div><h2 title={sessionTitle}>{heading}</h2><p className="td-muted">{tr("{p0} 个参与成员 ·{p1} 个原生会话 ·{p2}", {p0: team.members.filter(m=>m.active!==false).length, p1: team.members.length, p2: team.paused?tr("通信暂停"):tr("通信已启用")})}</p></div><Button variant="outline" size="sm" onClick={()=>draftGuard.request(()=>{props.closeSettings();props.open(team.anchor);})}>{tr("查看窗口")}</Button></div>

   {tab==='graph'&&<>
    <BlockedRequests team={team} messages={data.state.messages} sender={data.settingsSession||team.anchor}/>
    {editorActions.filter(a=>a.teamId===team.id).map(action=><div className="td-card td-row" role="status" key={action.key}>
     <span>{action.text}</span><Button size="sm" disabled={busy} onClick={()=>void run(async()=>action.apply())}>{action.label}</Button>
     {action.dismiss&&<Button size="sm" aria-label={tr('关闭提示')} onClick={action.dismiss}>×</Button>}
    </div>)}
   </>}
   {team.pending&&<div className="td-card" role="status"><strong>{tr("待切换：{p0}", {p0: team.pending.preset.name})}</strong><p>{team.pending.error||tr("等待正在运行的回合结束；新的团队派发已暂停。")}</p><Button size="sm" onClick={()=>void run(()=>props.perform({action:'switch-cancel',teamId:team.id}))}>{tr("取消待切换")}</Button></div>}
   <section className="td-current-overview" data-editing={editingCurrent} hidden={tab!=='graph'}>{area==='current'&&tab==='graph'&&<ConfigurationGraph notify={props.feedback.notify} key={team.id} team={team} title={title} perform={seatConfirmation.apply} editing={editingCurrent} header={actions=><CurrentConfiguration notify={props.feedback.notify} team={team} perform={seatConfirmation.apply} onEditing={setEditingCurrent} actions={actions}/>}/>}</section>
   {area==='current'&&tab==='members'&&<section>
    <div className="td-add-member td-card"><h3>{tr("添加成员")}</h3><form onSubmit={e=>{e.preventDefault();const key=JSON.stringify([team.id,name.trim(),existing]);
      const request=nextAddition(team.id,key,name.trim()||tr("成员 ")+(team.members.length+1));
      void run(()=>props.perform({action:'add',teamId:team.id,label:request.label,requestId:request.id,autoLink:false,...(existing?{existing}:{})})).then(result=>{if(result&&addRequest.current===request){addRequest.current=null;try{sessionStorage.removeItem('dsh.team-desk.add.'+team.id);}catch{}setName('');setExisting('');}});}}>
     <div className="td-preset-pair"><label>{tr("协作名称")}<Input value={name} aria-label={tr("新成员名称")} maxLength={120} onChange={e=>setName(e.target.value)} placeholder={tr("可选")}/></label><label>{tr("会话来源")}<Select aria-label={tr("添加会话来源")} value={existing} onValueChange={e=>setExisting(e)}><option value="">{tr("新建独立会话")}</option>{candidates.map(s=><option key={s.id} value={s.id}>{s.title||s.displayTitle} · {s.cwd}</option>)}</Select></label></div>
     <Button type="submit" variant="primary" disabled={busy||team.members.length>=12}>{tr("添加成员")}</Button><Help text={tr("添加后从左侧拖入显示；在关系图中连接通信。")}/>
    </form></div>
    <div className="td-member-grid">{(team.sidebarOrder??team.members.map(m=>m.sessionId)).map(id=>team.members.find(m=>m.sessionId===id)!).map(m=><MemberRow key={m.sessionId} member={m} team={team} props={p} title={title(m.sessionId)} run={run} busy={busy}/>)}</div>
   </section>}
   <section hidden={tab!=='preset'}>{area==='current'&&tab==='preset'&&<TeamSwitch notify={props.feedback.notify} key={team.id} team={team} presets={data.state.presets} perform={seatConfirmation.apply} title={title}/>}</section>
   <section hidden={tab!=='layout'}>{area==='current'&&tab==='layout'&&<LayoutSettings team={team} perform={seatConfirmation.apply} title={title}/>}</section>
   <section hidden={tab!=='sync'}>{area==='current'&&tab==='sync'&&<SharedView team={team} state={data.state} perform={seatConfirmation.apply}/>}</section>
   {area==='current'&&tab==='native'&&<NativeOverview team={team} state={data.state}/>}
   {area==='current'&&tab==='native-options'&&<NativeOptions team={team}/>}
   {tab==='git'&&<ProjectGit visible={area==='current'} team={team} state={data.state} perform={seatConfirmation.apply} openDiff={props.openGitDiff} nativeConfigForm={props.nativeConfigForm}/>}
   <section hidden={tab!=='records'}>{area==='current'&&tab==='records'&&<CoordinationRecords key={team.id} team={team} data={data} perform={seatConfirmation.apply} title={title}/>}<div className="td-card"><SectionTitle title={tr("解除团队关系")} hint={tr("会话历史、人设与通信存档保留。")}/><Button variant="outline" disabled={busy} onClick={()=>{if(window.confirm(tr("解除此团队并保留所有会话及历史？")))void run(()=>props.perform({action:'dissolve',teamId:team.id})).then(r=>{if(r)props.closeSettings();});}}>{tr("解除团队")}</Button></div></section>
  </>}
  </section><section className="td-management-page" hidden={area!=='manage'}>{area==="manage"&&<Management {...props} page={managementPage} editTeam={id=>{props.chooseSettingsTeam(id);setArea('current');setTab('graph');}}/>}</section>
 </div>;
 if(!data.dialog)return null;
 const activeId=area==='current'?'current.'+tab:'manage.'+managementPage;
 const pageContent=data.snapshotView==='chat'?<div role="status">{data.error||tr('加载中…')}</div>:content;
 return <>{seatConfirmation.dialog}{props.hasSettingsFactory()?props.renderFactorySlot('settings.dialog',{title:tr("团队协作"),dialogId:'team-desk-editor',rows,activeId,onSelect:select,onClose:props.closeSettings,content:pageContent}):
  <Modal open headless shortcutModal="team-desk-editor" className="td-editor-modal" title={tr("团队协作")} onClose={props.closeSettings}>
   <strong data-settings-region="navTitle">{tr("团队协作")}</strong>
   <nav data-settings-region="nav" aria-label={tr("团队协作")}><strong>{tr("团队协作")}</strong><div data-settings-region="navList">{rows.map(row=><Button key={row.id} size="sm" aria-current={row.id===activeId?'page':undefined} onClick={()=>select(row.id)}>{row.label}</Button>)}</div></nav>
   <div data-settings-region="options">{pageContent}</div><div data-settings-region="header"><Button size="sm" aria-label={tr('关闭')} onClick={props.closeSettings}>×</Button></div>
  </Modal>}
  <Modal open={pendingLeave!==null} title={tr("有未保存的修改")} closeLabel={tr("继续编辑")} shortcutModal="team-desk-unsaved" onClose={()=>draftGuard.cancel()} description={tr("修改尚未应用，是否放弃修改并离开？")} footer={<><Button variant="outline" data-modal-autofocus onClick={()=>draftGuard.cancel()}>{tr("继续编辑")}</Button><Button variant="primary" onClick={()=>draftGuard.discard()}>{tr("放弃修改并离开")}</Button></>}/>
  <Modal open={createRequest!==null} title={tr("确认创建团队")} closeLabel={tr("关闭")} shortcutModal="team-desk-create-confirm" onClose={()=>setCreateRequest(null)}
   description={createRequest?.isNew?tr("将把当前草稿建立为独立对话，并为它创建团队。草稿内容会保留，不会自动发送；创建后协作保持暂停。"):tr("将以当前对话为主会话创建团队，保留已有历史、草稿和人设设置。创建后协作保持暂停。")}
   footer={<><Button variant="outline" data-modal-autofocus onClick={()=>setCreateRequest(null)}>{tr("取消")}</Button><Button variant="primary" disabled={busy} onClick={()=>{const request=createRequest;setCreateRequest(null);if(!request||request.sessionId!==anchor||team)return;void run(()=>props.createTeam(request.sessionId));}}>{tr("确认创建")}</Button></>}/>
 </>;
}
