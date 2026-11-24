import {PartialCommit} from './GitPartial.tsx';
import {Select} from './Select.tsx';
import {ProposalComparison,LfsInspection,WorktreeRetention} from './GitInspection.tsx';
import type {OverlayProps} from './contracts.ts';
import {Help,SectionTitle} from './ui.tsx';
import {Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {useEffect,useRef,useState,useId} from 'react';
import {Button,Switch,SegmentedTabs} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Team,State} from '../domain/types.ts';
import type {GitState,GitStatus} from '../domain/git/types.ts';
import {tr,messageText,localeId} from './locale.ts';
import {newId} from './id.ts';

interface Props {visible:boolean;nativeConfigForm:OverlayProps["nativeConfigForm"];team:Team;state:State;perform:(p:Record<string,unknown>)=>Promise<unknown>;openDiff:(id:string)=>Promise<void>;}
export function ProjectGit({visible,team,state,perform,openDiff,nativeConfigForm}:Props){
 const projects=(state.projects??[]).filter(p=>p.teamIds.includes(team.id));
 const [projectId,setProject]=useState(projects[0]?.id??''),[actor,setActor]=useState(team.anchor),[status,setStatus]=useState<GitStatus>(),[records,setRecords]=useState<GitState>(),[worktreeAvailable,setAvailable]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<unknown>(),[selected,setSelected]=useState<string[]>([]),[message,setMessage]=useState(''),[branch,setBranch]=useState(''),[target,setTarget]=useState(''),[summary,setSummary]=useState(''),[joint,setJoint]=useState(false),[projectName,setProjectName]=useState(''),[projectPath,setProjectPath]=useState(''),[notes,setNotes]=useState<Record<string,string>>({}),[resolutions,setResolutions]=useState<Record<string,string>>({}),[commits,setCommits]=useState<Record<string,string>>({}),[strategies,setStrategies]=useState<Record<string,string>>({});
 const [commitMode,setCommitMode]=useState('files'),commitId=useId();
 const [emptyProject,setEmptyProject]=useState('');
 const scopeKey=JSON.stringify([actor,projectId]);
 const generation=useRef(0),abort=useRef<AbortController|undefined>(undefined);
 useEffect(()=>{if(projectId&&!projects.some(p=>p.id===projectId))setProject('');},[projectId,projects.map(p=>p.id).join(',')]);
 async function api(action:string,options:Record<string,unknown>,signal?:AbortSignal){const response=await fetch('/api/team-desk.git-action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:actor,projectId,action,options}),...(signal?{signal}:{})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error??tr('Git 操作失败')),{code:value.code});return value;}
 async function refresh(signal?:AbortSignal){
  const version=++generation.current;setEmptyProject('');
  const metadata=await fetch('/api/team-desk.git?teamId='+encodeURIComponent(team.id),signal?{signal}:{}).then(r=>r.json());
  if(version!==generation.current)return;
  if(metadata.error)throw Error(metadata.error);setRecords(metadata.state);setAvailable(metadata.worktreeAvailable);
  if(!projectId){setStatus(undefined);return;}
  let info:GitStatus;
  try{info=await api('status',{},signal) as GitStatus;}catch(error){
   if(version!==generation.current)return;
   setStatus(undefined);
   if((error as {code?:string}).code==='GIT_NOT_REPOSITORY'){setError('');setEmptyProject(scopeKey);return;}
   throw error;
  }
  if(version!==generation.current)return;
  setError('');
  setStatus(info);setSelected(old=>old.filter(path=>info.files.some(f=>f.path===path)));setTarget(old=>info.targets.some(t=>t.ref===old&&t.ref!==info.branch)?old:info.targets.find(t=>t.ref===info.repository.defaultTarget&&t.ref!==info.branch)?.ref||info.targets.find(t=>t.ref!==info.branch)?.ref||'');
  const latest=await fetch('/api/team-desk.git?teamId='+encodeURIComponent(team.id),signal?{signal}:{}).then(r=>r.json());if(version===generation.current)setRecords(latest.state);
 }
 useEffect(()=>{if(!visible)return;abort.current?.abort();const controller=new AbortController();abort.current=controller;setStatus(undefined);setError('');setResult(undefined);void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));});return()=>{controller.abort();generation.current++;};},[visible,actor,projectId,team.id]);
 useEffect(()=>{if(!visible)return;const timer=setInterval(()=>{if(!document.hidden&&!busy)void refresh().catch(e=>setError(e instanceof Error?e.message:String(e)));},5000);return()=>clearInterval(timer);},[visible,actor,projectId,team.id,busy]);
 async function run(action:string,options:Record<string,unknown>){setBusy(true);setError('');try{const value=await api(action,options);setResult(value);await refresh();return value;}catch(e){setError(e instanceof Error?e.message:String(e));return undefined;}finally{setBusy(false);}}
 const proposals=(records?.proposals??[]).filter(p=>p.repositoryId===status?.repository.id),operations=(records?.operations??[]).filter(o=>o.repositoryId===status?.repository.id&&o.state==='uncertain');
 return <div className="td-project-git" data-team-git=""><div className="td-row"><h3>{tr('项目与 Git')}</h3><Button size="sm" variant="outline" disabled={busy} onClick={()=>{setError('');void refresh().catch(e=>setError(e instanceof Error?e.message:String(e)));}}>{tr('刷新 Git 状态')}</Button></div>
  <Help text={tr('团队会话可以直接使用原生 Git 命令。这里关联项目、任务分支、提交和查验；共享目录仍可继续使用。')}/>
  <div className="td-preset-pair"><label>{tr('项目')}<Select aria-label={tr('Git 项目')} disabled={busy} value={projectId} onValueChange={e=>setProject(e)}><option value="">{tr('选择项目')}</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</Select></label><label>{tr('执行会话')}<Select aria-label={tr('Git 执行会话')} disabled={busy} value={actor} onValueChange={e=>setActor(e)}>{team.members.filter(m=>m.active!==false).map(m=><option key={m.sessionId} value={m.sessionId}>{m.label}</option>)}</Select></label></div>
  <WorktreeRetention form={nativeConfigForm('worktree')}/>
  <details className="td-card"><summary>{tr('关联已有项目目录')}</summary><form onSubmit={e=>{e.preventDefault();setBusy(true);void perform({action:'project-register',sessionId:actor,name:projectName,root:projectPath}).then(value=>{setProject((value as {id:string}).id);setProjectName('');setProjectPath('');}).catch(e=>setError(e instanceof Error?e.message:String(e))).finally(()=>setBusy(false));}}><label>{tr('项目名称')}<Input required value={projectName} onChange={e=>setProjectName(e.target.value)}/></label><label>{tr('项目目录')}<Input required value={projectPath} placeholder={tr('选择工作区内的具体项目目录')} onChange={e=>setProjectPath(e.target.value)}/></label><Button disabled={busy} type="submit">{tr('关联项目')}</Button></form></details>
  {error&&<p role="alert" className="td-error">{messageText(error)}</p>}{projectId&&emptyProject===scopeKey&&<Button disabled={busy} onClick={()=>void run('init',{key:newId()})}>{tr('初始化此项目 Git 仓库')}</Button>}
  {projectId&&<LfsInspection key={actor+projectId} load={api}/>}
  {status&&<>
   <article className="td-card"><div className="td-row"><strong>{status.branch.replace('refs/heads/','')||tr('分离 HEAD')}</strong><code title={status.head}>{status.head.slice(0,12)}</code><Button size="sm" onClick={()=>void openDiff(actor).catch(e=>setError(e instanceof Error?e.message:String(e)))}>{tr('查看原生差异')}</Button></div><p className="td-muted td-wrap">{status.path}</p>
    {status.busy.length>0&&<p role="status">{tr('Git 有未完成操作')}：{status.busy.join(', ')}</p>}
    <details><summary>{tr('创建任务工作树')}</summary><Help text={tr('从当前已提交版本创建分支，并将此执行会话切换到新目录；未提交内容保留在原目录。')}/>{!worktreeAvailable&&<p role="status">{tr('请在 DSH 插件页面启用官方“变更请求与工作树”。')}</p>}<form className="td-inline-form" onSubmit={e=>{e.preventDefault();void run('worktree',{key:newId(),expectedHead:status.head,...(branch.trim()?{name:branch.trim()}:{})});}}><label>{tr('任务分支名')}<Input value={branch} disabled={busy} placeholder={tr('留空自动生成')} onChange={e=>setBranch(e.target.value)}/></label><Button type="submit" disabled={busy||!worktreeAvailable||!status.head}>{tr('创建并进入')}</Button></form></details>
   </article>
   <article className="td-card"><div className="td-row"><h3>{tr('阶段提交')}</h3><SegmentedTabs size="sm" label={tr('提交方式')} value={commitMode} onChange={setCommitMode} items={[{value:'files',label:tr('整文件'),id:commitId+'-files-tab',panelId:commitId+'-panel'},{value:'hunks',label:tr('差异块'),id:commitId+'-hunks-tab',panelId:commitId+'-panel'}]}/></div>{status.files.length===0?<p className="td-muted">{tr('当前项目没有未提交修改')}</p>:<form role="tabpanel" id={commitId+'-panel'} aria-labelledby={commitId+'-'+commitMode+'-tab'} onSubmit={e=>{e.preventDefault();if(commitMode!=='files')return;void run('commit',{key:newId(),expectedHead:status.head,paths:selected,message,shared:joint}).then(r=>{if(r){setMessage('');setSelected([]);}});}}>
    <div className="td-git-files">{status.files.map(file=><label key={file.path} className="td-git-file"><input type="checkbox" disabled={busy} checked={selected.includes(file.path)} onChange={e=>setSelected(old=>e.target.checked?[...old,file.path]:old.filter(p=>p!==file.path))}/><code>{file.status}</code><span>{file.path}</span></label>)}</div>
    <label>{tr('提交说明')}<Input required disabled={busy} value={message} onChange={e=>setMessage(e.target.value)}/></label>{status.sharedWith.length>0&&<div className="td-preference"><span>{tr('明确作为共享目录的共同提交')}</span><Switch label={tr('明确作为共享目录的共同提交')} checked={joint} disabled={busy} onChange={setJoint}/></div>}
    {commitMode==='files'?<Button type="submit" disabled={busy||!selected.length||!message.trim()}>{tr('提交所选文件')}</Button>:<PartialCommit key={actor+projectId} paths={selected} head={status.head} message={message} shared={joint} busy={busy} load={api} commit={run} onComplete={()=>{setMessage('');setSelected([]);}}/>}
   </form>}</article>
   <article className="td-card"><h3>{tr('提交成果提案')}</h3><form onSubmit={e=>{e.preventDefault();const ref=status.targets.find(t=>t.ref===target);if(ref)void run('propose',{sourceSha:status.head,targetRef:ref.ref,expectedTarget:ref.sha,summary}).then(r=>{if(r)setSummary('');});}}><div className="td-preset-pair"><label>{tr('目标分支')}<Select disabled={busy} value={target} onValueChange={e=>setTarget(e)} aria-label={tr('目标分支')}>{status.targets.filter(t=>t.ref!==status.branch).map(t=><option key={t.ref} value={t.ref}>{t.ref.replace('refs/heads/','')} · {t.sha.slice(0,8)}</option>)}</Select></label><label>{tr('成果说明')}<Input value={summary} required disabled={busy} onChange={e=>setSummary(e.target.value)}/></label></div><Button disabled={busy||!target||target===status.branch||!summary.trim()} type="submit">{tr('建立精确提交提案')}</Button></form>
    <div className="td-preference"><span>{tr('整合前需要其他成员查验')}</span><Switch label={tr('整合前需要其他成员查验')} checked={status.repository.requireReview} disabled={busy} onChange={value=>void run('configure',{expected:records?.revision,requireReview:value})}/></div>
   </article>
   <details className="td-card"><summary>{tr('Git 记录与归档')}</summary><Help text={tr('归档已完成的操作和已整合提案，保留重试键与原始依据。待核对操作继续保留在当前记录。')}/><Button disabled={busy} size="sm" onClick={()=>void run('archive',{before:Date.now()})}>{tr('归档已结束记录')}</Button>{(records?.archives??[]).filter(a=>a.projectId===projectId).map(a=><p key={a.id}><a href={'/api/team-desk.git-archive?id='+encodeURIComponent(a.id)} download>{new Date(a.time).toLocaleString(localeId())} · {a.operations.length} {tr('操作')} · {a.proposalCount} {tr('提案')}</a></p>)}</details>
   {proposals.map(p=><article className="td-card" key={p.id} data-git-proposal={p.id}><div className="td-row"><strong>{p.summary}</strong><span className="td-badge">{p.integratedSha?tr('已整合'):tr('待整合')}</span></div><p><code title={p.sourceSha}>{p.sourceSha.slice(0,12)}</code> → {p.targetRef.replace('refs/heads/','')} · <code title={p.targetSha}>{p.targetSha.slice(0,12)}</code></p><p className="td-muted">{new Date(p.createdAt).toLocaleString(localeId())}</p>
    <ProposalComparison key={actor+projectId+p.id+p.revision} proposal={p} load={api}/>
    {p.reviews.map(r=><p key={r.id}><span className="td-badge">{r.protocol!==2&&!p.integratedSha?tr('历史查验，需重新确认'):r.outcome==='passed'?tr('查验通过'):r.outcome==='changes_requested'?tr('需要修改'):tr('查验说明')}</span> <span title={r.actor}>{team.members.find(m=>m.sessionId===(r.memberSessionId??r.actor))?.label??r.actor}</span> · {r.note}</p>)}
    {!p.integratedSha&&<><label>{tr('查验记录')}<textarea rows={2} value={notes[p.id]??''} disabled={busy} onChange={e=>setNotes({...notes,[p.id]:e.target.value})}/></label><div className="td-row">{(['comment','passed','changes_requested'] as const).map(outcome=><Button key={outcome} size="sm" disabled={busy||!notes[p.id]?.trim()} onClick={()=>void run('review',{proposalId:p.id,expected:p.revision,sourceSha:p.sourceSha,targetSha:p.targetSha,outcome,note:notes[p.id]})}>{outcome==='passed'?tr('记录通过'):outcome==='changes_requested'?tr('要求修改'):tr('记录说明')}</Button>)}</div><div className="td-row"><Select aria-label={tr('整合方式')} disabled={busy} value={strategies[p.id]??'ff-only'} onValueChange={e=>setStrategies({...strategies,[p.id]:e})}><option value="ff-only">{tr('仅快进')}</option><option value="merge">{tr('合并提交')}</option><option value="cherry-pick">{tr('拣选提交')}</option></Select><Button size="sm" disabled={busy||status.branch!==p.targetRef} onClick={()=>void run('integrate',{key:newId(),proposalId:p.id,expected:p.revision,strategy:strategies[p.id]??'ff-only',...(strategies[p.id]==='cherry-pick'?{commits:(commits[p.id]??'').split(/\s+/).filter(Boolean)}:{})})}>{tr('整合到当前分支')}</Button></div>{strategies[p.id]==='cherry-pick'&&<label>{tr('按顺序填写完整提交 SHA，每行一项')}<textarea value={commits[p.id]??''} onChange={e=>setCommits({...commits,[p.id]:e.target.value})}/></label>}</>}
   </article>)}
   {operations.map(o=><article className="td-card" key={o.id}><strong>{tr('Git 结果待核对')}</strong><p>{o.action} · {o.error}</p><Button size="sm" disabled={busy} onClick={()=>void run('reconcile',{operationId:o.id})}>{tr('按真实 Git 状态核对')}</Button>{status.path===o.path&&<details><summary>{tr('手动处理后的核对记录')}</summary><Help text={tr('先用原生 Git 解决或中止操作；此处只记录核对依据，不执行回滚，也不视为提案通过。')}/><label>{tr('核对依据')}<textarea value={resolutions[o.id]??''} onChange={e=>setResolutions({...resolutions,[o.id]:e.target.value})}/></label><Button disabled={busy||!resolutions[o.id]?.trim()} onClick={()=>void run('resolve',{operationId:o.id,expectedHead:status.head,reason:resolutions[o.id]})}>{tr('记录已人工处理')}</Button></details>}</article>)}
  </>}
  {result!==undefined&&<details className="td-card"><summary>{tr('最近操作结果')}</summary><pre className="td-wrap">{JSON.stringify(result,null,2)}</pre></details>}
 </div>;
}
