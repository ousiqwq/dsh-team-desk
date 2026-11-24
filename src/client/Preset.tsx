import {Select} from './Select.tsx';
import {Help,SectionTitle} from './ui.tsx';
import {tr, messageText} from './locale.ts';
import {useEffect,useState} from 'react';
import {Button} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Team} from '../domain/types.ts';
import type {PanelProps} from './contracts.ts';
import {WORKER_PROMPT,REVIEWER_PROMPT} from '../presets/work-review.ts';

export function Preset({team,perform}:{team:Team;perform:PanelProps['perform']}){
  const key='dsh.team-desk.preset-draft.'+team.id;
  const [draft]=useState<Record<string,string>>(()=>{try{const saved=JSON.parse(sessionStorage.getItem(key)??'{}');return saved&&typeof saved==='object'?Object.fromEntries(Object.entries(saved).filter(([,v])=>typeof v==='string'&&v.length<=8000)) as Record<string,string>:{};}catch{return {};}});
  const [goal,setGoal]=useState(draft.goal??''),[criteria,setCriteria]=useState(draft.criteria??'');
  const [worker,setWorker]=useState(team.members.some(m=>m.sessionId===draft.worker)?draft.worker!:team.anchor),[reviewer,setReviewer]=useState(draft.reviewer!==undefined&&(draft.reviewer===''||team.members.some(m=>m.sessionId===draft.reviewer))?draft.reviewer:team.members.find(m=>m.sessionId!==team.anchor)?.sessionId??'');
  const [workerPrompt,setWorkerPrompt]=useState(draft.workerPrompt??WORKER_PROMPT),[reviewerPrompt,setReviewerPrompt]=useState(draft.reviewerPrompt??REVIEWER_PROMPT);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function act(data:Record<string,unknown>){setBusy(true);setError('');try{await perform({teamId:team.id,...data});}catch(e){setError(String(e));}finally{setBusy(false);}}
  const b=team.briefing;
  useEffect(()=>{try{if(b)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify({goal,criteria,worker,reviewer,workerPrompt,reviewerPrompt}));}catch{}},[key,b,goal,criteria,worker,reviewer,workerPrompt,reviewerPrompt]);
  useEffect(()=>{if(!team.members.some(m=>m.sessionId===worker))setWorker(team.anchor);if(reviewer&&!team.members.some(m=>m.sessionId===reviewer))setReviewer('');},[team.members,team.anchor,worker,reviewer]);
  return <section className="td-preset td-scope" aria-label={tr("工作与监督预设")}>
    <SectionTitle title={tr("基础预设：工作＋监督查验")} hint={tr("主窗口默认负责工作，另一个窗口独立查验。分工由可编辑提示词约定；不替换人格。准备后可检查完整指令，再开始运行。")}/>
    {error&&<p role="alert">{messageText(error)}</p>}
    {b?<>
      <p role="status">{tr("预设状态：{p0}", {p0: {prepared:tr("已准备，尚未发送指令"),starting:tr("正在发送指令"),started:tr("已发送，验收结果请看对话"),uncertain:tr("投递结果不确定，请检查会话")}[b.state]})}</p>
      <p>{tr("目标：{p0}", {p0: b.goal})}</p><p style={{whiteSpace:'pre-wrap'}}>{tr("验收条件：{p0}", {p0: b.criteria})}</p>
      {b.instructions.map(i=><details key={i.sessionId}><summary>{i.sessionId===b.worker?tr("工作指令"):tr("监督查验指令")}</summary><pre>{i.text}</pre></details>)}
      {b.error&&<p role="alert">{messageText(b.error)}</p>}
      {b.state==='prepared'&&<Button variant="primary" disabled={busy} onClick={()=>void act({action:'preset-start'})}>{tr("发送指令并开始")}</Button>}
      {b.state==='started'&&<Help text={tr("工作会话先执行；提交后自动唤醒监督查验。可以直接给任意成员补充要求。预设只应用一次，后续任务可继续在工作会话下达。")}/>}
    </>:<form onSubmit={e=>{e.preventDefault();void act({action:'preset-prepare',goal,criteria,worker,...(reviewer?{reviewer}:{}),workerPrompt,reviewerPrompt});}}>
      <div className="td-preset-pair"><label>{tr("工作会话")}<Select aria-label={tr("预设工作会话")} value={worker} onValueChange={e=>{setWorker(e);if(reviewer===e)setReviewer('');}}>{team.members.map(m=><option key={m.sessionId} value={m.sessionId}>{m.label}{m.sessionId===team.anchor?tr("（主窗口）"):''}</option>)}</Select></label>
      <label>{tr("监督查验会话")}<Select aria-label={tr("预设监督会话")} value={reviewer} onValueChange={e=>setReviewer(e)}><option value="">{tr("新建原生会话")}</option>{team.members.filter(m=>m.sessionId!==worker).map(m=><option key={m.sessionId} value={m.sessionId}>{m.label}</option>)}</Select></label></div>
      <label>{tr("任务目标")}<textarea aria-label={tr("预设任务目标")} required value={goal} onChange={e=>setGoal(e.target.value)} maxLength={4000} rows={2}/></label>
      <label>{tr("验收条件")}<textarea aria-label={tr("预设验收条件")} required value={criteria} onChange={e=>setCriteria(e.target.value)} maxLength={4000} rows={3} placeholder={tr("写明产物、可执行检查和通过条件")}/></label>
      <details><summary>{tr("编辑提示词")}</summary><p>{tr("可使用{p0}、{p1} 和{p2}（对方会话地址）。", {p0: '{{goal}}', p1: '{{criteria}}', p2: '{{peer}}'})}</p>
        <label>{tr("工作提示词")}<textarea aria-label={tr("工作提示词")} required value={workerPrompt} onChange={e=>setWorkerPrompt(e.target.value)} rows={7} maxLength={8000}/></label>
        <label>{tr("监督提示词")}<textarea aria-label={tr("监督提示词")} required value={reviewerPrompt} onChange={e=>setReviewerPrompt(e.target.value)} rows={7} maxLength={8000}/></label>
      </details>
      <Button type="submit" variant="primary" disabled={busy||!goal.trim()||!criteria.trim()}>{tr("准备预设")}</Button>
    </form>}
  </section>;
}
