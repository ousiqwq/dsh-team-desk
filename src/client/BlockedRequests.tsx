import {incidentSettings,incidentSupervisor} from '../domain/incident-settings.ts';
import type {Message,Team} from '../domain/types.ts';
import {tr} from './locale.ts';
import {useEffect,useMemo,useRef} from 'react';
import type {OverlayProps} from './contracts.ts';

type Inputs={team:Team;messages:Message[];sender?:string};
function blockedRows({team,messages,sender}:Inputs){
  const requester=sender && team.members.find(m=>m.sessionId===sender);
  if(sender && (!requester || !incidentSettings(requester,incidentSupervisor(team)).notifyOwn))return [];
  const outstanding=new Map<string,{member:string;reason:string}>();
  for(const member of team.members){
    const run=team.runs?.[member.sessionId];
    if(member.active===false||run?.epoch!==team.epoch||run?.phase!=='blocked'||!run.reviewBlock)continue;
    const labels = {
      review_context_overflow:'自动审核上下文超限，{p0} 未执行', auto_review_denied:'自动审核拒绝执行 {p0}',
      auto_review_failed:'自动审核失败，{p0} 未执行',approval_rejected:'用户拒绝执行 {p0}',
      shell_sandbox_denied:'终端沙箱限制了 {p0} 的操作',
      file_sandbox_denied:'会话文件权限限制了 {p0}',
      approval_cancelled:'{p0} 的审批已取消',approval_unavailable:'{p0} 的审批渠道不可用',
    } as const;
    const reason=tr(labels[run.reviewBlock.reason],{p0:run.reviewBlock.tool});
    for(const id of run.requests)outstanding.set(id,{member:member.label,reason});
  }
  if(!outstanding.size)return [];
  return messages.flatMap(m=>{
    const issue=outstanding.get(m.id);
    return issue && m.teamId===team.id && m.epoch===team.epoch && !m.cancellation && (!sender||sender===m.sender)
      ? [{id:m.id,heading:tr('派单受阻')+' · '+issue.member+' · #'+(m.sequence??m.id),reason:issue.reason,text:m.text}]
      : [];
  });
}

export function BlockedRequests(inputs:Inputs){
  const rows=blockedRows(inputs);
  return rows.length?<div className="td-blocked-requests" role="status">{rows.map(row=>
    <div key={row.id}><strong>{row.heading}</strong> · {row.reason}<span title={row.text}>{row.text.trim().split('\n',1)[0]}</span></div>
  )}</div>:null;
}

/** A poll, a pane focus change, or opening the editor must not redisplay the same block. */
export function BlockedRequestNotice(props:OverlayProps){
  const team=props.useTeamDesk(s=>s.state.teams.find(t=>t.id===s.activeTeam));
  const sender=props.useTeamDesk(s=>s.activeSession);
  const messages=props.useTeamDesk(s=>s.state.messages);
  const rows=useMemo(()=>team&&!team.paused?blockedRows({team,sender,messages}):[],[team,sender,messages]);
  const seen=useRef(new Map<string,Set<string>>());
  useEffect(()=>{
    props.feedback.focusMember(sender);
    if(!team||team.paused||!sender)return;
    const scope=team.id+'/'+sender,previous=seen.current.get(scope);
    const keys=rows.map(row=>row.id+'/'+row.reason),fresh=rows.filter((_,i)=>!previous?.has(keys[i]!));
    if(keys.length)seen.current.set(scope,new Set(keys));else seen.current.delete(scope);
    if(fresh.length===1)props.feedback.notify(fresh[0]!.heading+' · '+fresh[0]!.reason,sender);
    else if(fresh.length)props.feedback.notify(tr('有 {p0} 条派单受阻',{p0:fresh.length}),sender);
  },[team,sender,rows,props.feedback]);
  return null;
}
