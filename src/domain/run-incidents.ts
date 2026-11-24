import {randomUUID} from 'node:crypto';
import {incidentSettings,incidentSupervisor} from './incident-settings.ts';
import {sequence} from './ledger.ts';
import type {Message, RunIssue, State, Team} from './types.ts';

const descriptions: Record<string,string> = {
  review_context_overflow:'自动审核上下文超限，工具未执行', auto_review_failed:'自动审核失败，工具未执行',
  auto_review_denied:'自动审核拒绝执行工具', approval_rejected:'用户拒绝执行工具',
  shell_sandbox_denied:'终端沙箱拒绝了命令请求的操作',
  file_sandbox_denied:'会话的文件权限拒绝了这次文件操作',
  approval_cancelled:'工具审批已取消', approval_unavailable:'工具审批渠道不可用',
  AUTH:'模型认证失败', INVALID_CREDENTIAL:'模型凭据无效', QUOTA:'模型额度不足',
  ACCOUNT_QUOTA:'账户额度不足', RATE_LIMIT:'上游限流', CONTEXT_WINDOW_EXCEEDED:'模型上下文超限',
  TRANSPORT:'模型连接中断', TIMEOUT:'模型请求超时', STREAM_CLOSED:'上游响应流中断',
  CONTENT_REFUSED:'模型提供方拒绝了请求', MALFORMED_RESPONSE:'模型提供方返回了无效响应',
  SERVER:'模型服务端错误', EMPTY_RESPONSE:'模型返回空响应', MAX_TOKENS:'达到输出长度上限',
  TURN_BLOCKED:'DSH 阻止了本轮运行', HOST_RESTARTED:'服务重启时本轮尚未结束',
  PI_AI_ERROR:'上游模型响应异常', RETRY_SUPERSEDED:'已有其他会话活动，已取消本次自动续跑', USER_STOP:'用户已停止', PARENT_STOP:'上级已停止', TOOL_PENDING:'工具执行结果尚未确认',
  RETRY_UNAVAILABLE:'无法提交续跑', MESSAGE_UNCERTAIN:'消息投递结果待核对',
  MESSAGE_DISCARDED:'收件箱消息被丢弃', MESSAGE_EXPIRED:'团队消息已过期',
  ROUTE_CHANGED:'投递范围或成员已变化', CAUSAL_FAILED:'消息的前置条件未满足',
};
const stages: Record<RunIssue['stage'],string> = {
  observed:'工具报错', retrying:'准备自动续跑', attention:'需要处理', stopped:'已停止', recovered:'已恢复',
};

/** Commit the event and its outgoing mailbox records in the same state transaction. */
export function recordRunIssue(state: State, team: Team, member: string, input: string,
  requests: string[], issue: RunIssue, notify = true) {
  const key = JSON.stringify([team.epoch, member, input, issue.stage, issue.code, issue.tool]);
  if (state.events.some(e => e.teamId === team.id && e.incidentKey === key)) return;
  const actor = team.members.find(m => m.sessionId === member);
  if (!actor) return;
  const ids = new Set(requests);
  const orders = state.messages.filter(m => ids.has(m.id) && m.teamId === team.id && m.epoch === team.epoch && !m.system);
  const refs = orders.map(m => '#' + (m.sequence ?? m.id));
  const label = issue.stage==='recovered' ? issue.code : descriptions[issue.code] ?? issue.code;
  const text = [actor.label, stages[issue.stage], label, issue.tool, issue.detail,
    refs.length ? '关联派单 ' + refs.join('、') : undefined].filter(Boolean).join(' · ');
  const eventId = randomUUID();
  state.events.push({id:eventId, teamId:team.id, kind:'run-incident', time:Date.now(), text,
    incidentKey:key, incident:{...issue, epoch:team.epoch!, member, input, requests:[...ids]}});
  if (!notify || team.paused || actor.active === false) return;
  const supervisor = incidentSupervisor(team);
  for (const recipient of team.members) {
    const target=recipient.sessionId;
    if(target===member || recipient.active===false)continue;
    const settings=incidentSettings(recipient,supervisor);
    const related=(settings.notifyAll?orders:orders.filter(m=>m.sender===target)).slice(0,50);
    if(!settings.notifyAll && !(settings.notifyOwn && related.length))continue;
    const id = randomUUID();
    const time = Math.max(Date.now(), (state.messages.at(-1)?.time ?? 0) + 1);
    const body = [actor.label, stages[issue.stage], label, issue.tool, issue.detail,
      related.length ? '关联派单 ' + related.map(m => '#' + (m.sequence ?? m.id)).join('、') : undefined].filter(Boolean).join(' · ');
    const recipientRun = team.runs?.[target];
    const suspended = recipientRun?.epoch===team.epoch && ['stopped','interrupted','blocked'].includes(recipientRun?.phase??'');
    state.messages.push({id,key:id,teamId:team.id,epoch:team.epoch!,sender:member,target,
      sequence:sequence(state), time,state:'queued',system:true,kind:'notice',code:'team_run_status',
      syncKey:'run-status:'+eventId, delivery:'next-step',wakeup:issue.stage==='attention' && related.length>0 && !suspended,
      text:body, payload:{eventId,stage:issue.stage,reason:issue.code,requests:related.map(m=>m.id)}});
  }
}

export function recordDeliveryIssue(state:State, msg:Message, code:string, notify=true) {
  if (msg.system || !['request','reply'].includes(msg.kind??'request')) return;
  const team=state.teams.find(t=>t.id===msg.teamId && t.epoch===msg.epoch);
  if (!team) return;
  msg.deliveryIssue=code;
  const request = msg.replyTo ?? msg.id;
  recordRunIssue(state,team,msg.kind==='reply'?msg.sender:msg.target,msg.id,[request],{stage:'attention',code},notify);
}

/** A native admission receipt proves transport only, including after a reconciliation. */
export function recordDeliveryRecovery(state:State,msg:Message) {
  if(!msg.deliveryIssue || msg.system || msg.native!=='admitted')return;
  const team=state.teams.find(t=>t.id===msg.teamId && t.epoch===msg.epoch);
  if(team)recordRunIssue(state,team,msg.kind==='reply'?msg.sender:msg.target,msg.id,[msg.replyTo??msg.id],
    {stage:'recovered',code:msg.deliveryIssue,detail:'已核对原生收件记录，消息已送达'});
  delete msg.deliveryIssue;
}
