import {CoordinationError} from './errors.ts';
import {validateDefinitions} from './definitions.ts';
import type {CoordinationPolicy,MessageOptions,Message,Team} from './types.ts';
function record(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}

const kinds=['notice','request','reply','event'], priorities=['normal','high','critical'];
export function eventCode(value:unknown):value is string {
  return typeof value==='string' && /^[a-z][a-z0-9_.-]{0,79}$/.test(value) && !value.startsWith('system.');
}
export function jsonValue(value:unknown):void {
  const text=JSON.stringify(value);
  if(text===undefined||text.length>12000)throw Error('共享值必须是最多 12000 字符的 JSON');
  const check=(v:unknown,depth:number):void=>{if(depth>12)throw Error('共享值嵌套过深');if(typeof v==='number'&&!Number.isFinite(v))throw Error('无效的数值');if(v&&typeof v==='object'){for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))throw Error('保留的字段名');check(x,depth+1);}}};check(value,0);
}
export function validatePolicy(value:unknown,ids:Set<string>):asserts value is CoordinationPolicy {
  if(!record(value)||Object.keys(value).some(k=>!['routes','eventCodes','defaults','events','variables'].includes(k)))throw Error('无效或不支持的通信策略字段');
  if(value.eventCodes!==undefined&&(!Array.isArray(value.eventCodes)||value.eventCodes.length>100||!value.eventCodes.every(eventCode)))throw Error('无效的事件代码');
  if(value.defaults!==undefined){if(!record(value.defaults)||Object.keys(value.defaults).length>100)throw Error('无效的默认变量');jsonValue(value.defaults);}
  validateDefinitions(value as CoordinationPolicy);
  if(value.routes!==undefined){
    if(!Array.isArray(value.routes)||value.routes.length>144)throw Error('无效的路由规则');
    const seen=new Set<string>();
    for(const r of value.routes){
      if(!record(r)||Object.keys(r).some(k=>!['from','to','kinds','codes','priorities','allowReply'].includes(k))||typeof r.from!=='string'||typeof r.to!=='string'||!ids.has(r.from)||!ids.has(r.to)||r.from===r.to||seen.has(r.from+'\0'+r.to))throw Error('路由端点必须唯一且属于当前成员');
      seen.add(r.from+'\0'+r.to);
      for(const [key,allowed]of [['kinds',kinds],['priorities',priorities]] as const)if(r[key]!==undefined&&(!Array.isArray(r[key])||!r[key].every((x:unknown)=>typeof x==='string'&&allowed.includes(x))))throw Error('无效的路由条件');
      if(r.codes!==undefined&&(!Array.isArray(r.codes)||!r.codes.every(eventCode)))throw Error('无效的路由事件');
      if(r.allowReply!==undefined&&typeof r.allowReply!=='boolean')throw Error('无效的回复权限');
    }
  }
}
export function normalizeOptions(raw:MessageOptions={}):Required<Pick<MessageOptions,'kind'|'priority'|'delivery'|'wakeup'|'allowReply'|'ttlMs'>>&MessageOptions {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['kind','priority','code','delivery','wakeup','replyTo','followUpTo','allowReply','ttlMs','taskId','evidence','payload','eventVersion','dependsOn'].includes(k)))throw Error('无效的消息选项');
  const {replyTo,followUpTo,...rest}=raw;
  const kind=raw.kind??(replyTo!==undefined&&followUpTo===undefined?'reply':'request'),priority=raw.priority??'normal';
  if(!kinds.includes(kind)||!priorities.includes(priority))throw Error('无效的消息类型或优先级');
  if(raw.code!==undefined&&!eventCode(raw.code)){
    const reserved=String(raw.code).startsWith('system.');
    throw new CoordinationError('INVALID_EVENT_CODE',reserved?'options.code 使用了保留前缀 system.*':'options.code 须以小写英文字母开头，只能使用小写字母、数字、点、下划线和连字符，最长 80 字符。任务标识可放在 taskId。',false,{field:'options.code',value:String(raw.code).slice(0,80)});
  }
  for(const id of [replyTo,followUpTo]){
    if(id!==undefined&&(typeof id!=='string'||!id.trim()||id.length>200))throw new CoordinationError('INVALID_REPLY_REFERENCE','Supply the incoming message ID as a nonempty string of at most 200 characters.');
  }
  if(followUpTo!==undefined&&kind!=='request')throw new CoordinationError('INVALID_REPLY_REFERENCE','options.followUpTo belongs to a new request. To return a result use reply_to with kind=reply.');
  if(replyTo!==undefined&&followUpTo!==undefined&&replyTo!==followUpTo)throw new CoordinationError('INVALID_REPLY_REFERENCE','The two references identify different messages. Supply the same incoming message ID.');
  if(kind==='reply'&&replyTo===undefined)throw new CoordinationError('INVALID_REPLY_REFERENCE','A reply needs reply_to (or options.replyTo) set to the incoming message ID.');
  if(replyTo!==undefined&&kind!=='request'&&kind!=='reply')throw new CoordinationError('INVALID_REPLY_REFERENCE','Only requests and replies accept an incoming message reference. Omit it for notices and events.');
  const parent=replyTo??followUpTo;
  if(raw.taskId!==undefined&&(typeof raw.taskId!=='string'||raw.taskId.length>200))throw Error('无效的任务关联');
  if(raw.evidence!==undefined&&(!Array.isArray(raw.evidence)||raw.evidence.length>20||!raw.evidence.every(x=>typeof x==='string'&&x.length<=2000)))throw Error('无效的证据引用');
  if(raw.payload!==undefined)jsonValue(raw.payload);
  if(raw.eventVersion!==undefined&&(!Number.isSafeInteger(raw.eventVersion)||raw.eventVersion<1))throw Error('Invalid event version');
  if(raw.dependsOn!==undefined&&(!Array.isArray(raw.dependsOn)||raw.dependsOn.length>8||new Set(raw.dependsOn).size!==raw.dependsOn.length||raw.dependsOn.some(id=>typeof id!=='string'||!id||id.length>200)))throw Error('Invalid causal dependencies');
  const informational=kind==='notice'||kind==='event';
  const result={...rest,...(parent===undefined?{}:kind==='reply'?{replyTo:parent}:{followUpTo:parent}),kind,priority,delivery:raw.delivery??(informational||kind==='reply'||priority!=='normal'?'next-step':'next-turn'),wakeup:raw.wakeup??!informational,allowReply:raw.allowReply??false,ttlMs:raw.ttlMs??86400000};
  if(!['next-turn','next-step'].includes(result.delivery)||typeof result.wakeup!=='boolean'||typeof result.allowReply!=='boolean'||!Number.isSafeInteger(result.ttlMs)||result.ttlMs<1000||result.ttlMs>604800000||result.allowReply&&kind!=='request')throw Error('无效的投递选项');
  return result;
}
export interface RouteDenial { reason:string; field:string; hint:string; }
/** Explain the same directed-route decision used by publication, without granting permissions. */
export function routeDenial(team:Team,sender:string,target:string,options:MessageOptions):RouteDenial|undefined {
  const member=team.members.find(m=>m.sessionId===sender);
  if(!member||member.active===false||!member.operations.includes('send'))return {reason:'send_disabled',field:'sender',hint:'Sending is disabled for this member. Ask the user to review its collaboration scope.'};
  if(sender===target||!team.members.some(m=>m.sessionId===target&&m.active!==false))return {reason:'recipient_unavailable',field:'target',hint:'Choose a different active team member from team_members.'};
  if(!member.targets.includes(target))return {reason:'direction_not_allowed',field:'target',hint:'There is no permitted outgoing connection to this recipient. Priority does not grant a connection. A valid reply-only grant can permit one correlated reply.'};
  const policy=team.coordination,rule=policy?.routes?.find(r=>r.from===sender&&r.to===target);
  if(options.code&&policy?.eventCodes?.length&&!policy.eventCodes.includes(options.code))return {reason:'event_code_not_allowed',field:'options.code',hint:'The event code is outside the declared team event codes. Inspect team_protocol definitions.'};
  if(options.allowReply&&rule?.allowReply!==true)return {reason:'reply_grant_not_allowed',field:'options.allowReply',hint:'allowReply=true requests an extra one-time reverse reply grant and requires explicit route permission. Omit allowReply or set false for an ordinary request; a bidirectional connection already allows replies. Do not broaden permissions.'};
  if(rule?.kinds&&!rule.kinds.includes(options.kind??'request'))return {reason:'message_kind_not_allowed',field:'options.kind',hint:'This message kind is not allowed on the directed route. Inspect team_protocol definitions or preview the intended message.'};
  if(rule?.codes&&(!options.code||!rule.codes.includes(options.code)))return {reason:'route_code_not_allowed',field:'options.code',hint:'This route requires one of its configured event codes. An empty allowed set permits none.'};
  if(rule?.priorities&&!rule.priorities.includes(options.priority??'normal'))return {reason:'priority_not_allowed',field:'options.priority',hint:'The chosen priority is not allowed on this route. Critical does not bypass conditions.'};
}
export function routeAllowed(team:Team,sender:string,target:string,options:MessageOptions):boolean {
  return routeDenial(team,sender,target,options)===undefined;
}
export function replyAllowed(team:Team,messages:Message[],sender:string,target:string,options:MessageOptions,now=Date.now()):boolean {
  if(options.kind!=='reply'||!options.replyTo)return false;
  const parent=messages.find(m=>m.id===options.replyTo);
  return !!parent && parent.teamId===team.id && parent.epoch===team.epoch && parent.sender===target && parent.target===sender && parent.kind==='request' && (parent.allowReply===true||parent.routeReply===true) && routeAllowed(team,parent.sender,parent.target,{...parent,allowReply:true}) && parent.state==='accepted' && !parent.cancellation && parent.native!=='discarded' && now<(parent.expiresAt??0) && !messages.some(m=>m.replyTo===parent.id&&m.state!=='cancelled');
}
export function policyBindings(policy:CoordinationPolicy|undefined,bindings:Record<string,string>):CoordinationPolicy|undefined {
  if(!policy)return undefined;
  return {...structuredClone(policy),...(policy.routes?{routes:policy.routes.filter(r=>bindings[r.from]&&bindings[r.to]).map(r=>({...r,from:bindings[r.from]!,to:bindings[r.to]!}))}:{})};
}
export function priorityScore(m:Message,now=Date.now()):number {
  // Waiting ages normal messages so an endless urgent stream cannot starve them.
  return (m.priority==='critical'?2:m.priority==='high'?1:0)+Math.floor(Math.max(0,now-m.time)/30000);
}
