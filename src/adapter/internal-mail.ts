import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
import {SessionId} from '@deepseek-ai/dsh-session';
import type {ToolDefinition, ToolExecution} from '@deepseek-ai/dsh-tools';
import {resolveNativeActor} from './lineage.ts';
import type {TeamEngine} from '../domain/engine.ts';
import {deliveryPrefix,deliveryText} from './delivery.ts';
import {record} from '../domain/storage.ts';

interface InternalMail {
  isInternal(execution: ToolExecution): boolean;
  reviewNotices(sessionId:string): ((id:string,sender:string,text:string)=>unknown[]|undefined)|undefined;
}

declare module '@deepseek-ai/cordis' {
  interface Context { teamDeskMail: InternalMail }
}

const localTools = new Set(['team_members', 'team_read_messages', 'team_wait', 'team_ack_message', 'team_reference']);
const actions = new Map<string, ReadonlySet<string>>([
  ['team_shared', new Set(['read', 'set', 'batch', 'variables', 'history', 'changes', 'projects', 'subscribe', 'checkpoint', 'report_change'])],
  ['team_task', new Set(['list', 'get', 'claim', 'renew', 'release', 'offer', 'accept', 'cancel-offer'])],
  ['team_protocol', new Set(['definitions', 'variables', 'preview'])],
  ['team_resource', new Set(['status', 'acquire', 'renew', 'release', 'delegate', 'revoke-delegation', 'return-delegation'])],
  ['team_native', new Set(['status', 'tasks', 'usage', 'defaults', 'link-task'])],
  // The tool validates and consumes a user-issued one-use grant inside the interrupt handler.
  ['team_control', new Set(['grants', 'interrupt'])],
  ['team_git', new Set(['state', 'history'])],
]);

/** Bind actual definitions, including conditional definitions shared by native descendants. */
export function internalMail(ctx: Context, engine: TeamEngine) {
  const owners = new WeakMap<ToolDefinition, Agent | 'scoped'>();

  function isInternal(exec: ToolExecution): boolean {
    const {agent, toolSet, name} = exec;
    if (!agent || !toolSet || exec.signal.aborted) return false;
    const definition = toolSet.view(agent).get(name);
    if (!definition) return false;
    const owner = owners.get(definition);
    if (owner !== agent && owner !== 'scoped') return false;
    const caller = owner === 'scoped' ? resolveNativeActor(ctx, engine, agent)?.memberSessionId : agent.id;
    if (!caller) return false;
    const team = engine.membership(caller);
    if (!team || team.paused || !team.members.some(m => m.sessionId === caller && m.active !== false)) return false;
    if (localTools.has(name)) return true;

    const args = exec.arguments;
    if (!record(args)) return false;
    if (typeof args.action === 'string' && actions.get(name)?.has(args.action)) return true;

    const peer = (target: unknown): boolean => {
      if (typeof target !== 'string' || !team.members.some(m => m.sessionId === target && m.active !== false)) return false;
      // Publication is a mailbox operation. TeamEngine checks the configured direction,
      // reply grants and idempotency again at delivery. Only the recipient executes work.
      return Boolean(ctx.sessions.get(SessionId(target)));
    };
    if (name === 'team_send_message') return peer(args.target);
    if (name !== 'team_protocol' || args.action !== 'publish' || typeof args.targets !== 'string') return false;
    const targets: unknown = JSON.parse(args.targets);
    return Array.isArray(targets) && targets.length > 0 && targets.length <= team.members.length && targets.every(peer);
  }

  const service: InternalMail = Object.freeze({
    reviewNotices(sessionId: string) {
      if (!engine.membership(sessionId)) return;
      let records: ReturnType<TeamEngine['reviewNotices']> | undefined;
      return (id: string, sender: string, text: string) => {
        if (!id.startsWith(deliveryPrefix)) return;
        records ??= engine.reviewNotices(sessionId);
        const m = records.get(id.slice(deliveryPrefix.length));
        if (!m?.epoch || m.target !== sessionId || m.sender !== sender || m.priority !== 'normal'
            || m.wakeup !== false || m.delivery !== 'next-step' || m.kind !== 'notice'
            || !m.system || deliveryText(m) !== text) return;

        const scope = [m.teamId, m.epoch, m.sender, m.target];
        const metadata = [m.replyTo, m.allowReply, m.taskId, m.evidence, m.eventVersion, m.dependsOn, m.publication];
        if (m.syncSummary?.version === 1 && !m.syncSummary.incomplete && m.syncSummary.recordIds.length > 0
            && m.syncKey?.startsWith('resource-digest:') && !m.code && m.payload === undefined
            && metadata.every(value => value === undefined)) {
          return ['file', ...scope, m.syncKey, m.syncBatch, m.syncFrom, m.syncTo, m.syncSummary.recordIds];
        }
        if (m.code === 'team_run_status' && record(m.payload) && m.payload.stage === 'recovered') {
          return ['receipt', ...scope, m.payload, ...metadata];
        }
      };
    },
    isInternal(exec: ToolExecution) {
      try { return isInternal(exec); } catch { return false; }
    },
  });
  return {
    service,
    bind(tool: ToolDefinition, agent?: Agent) {
      owners.set(tool, agent ?? 'scoped');
      return tool;
    },
  };
}
