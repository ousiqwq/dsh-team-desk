import type {IncidentSettings} from './incident-settings.ts';
import type {DockNode} from './docking.ts';
export type Layout = 'columns' | 'rows' | 'grid' | 'four-columns';
export type Operation = 'send' | 'read' | 'wait';
export type SoulRule={mode:"follow"|"none"}|{mode:"persona";personaId:string}|{mode:"parent"};
import type {SeatSelection,SeatSettings} from './seat-settings.ts';
export interface SoulRules {persona?:SoulRule;children?:SoulRule;}
export interface Member {
  addition?:{id:string;input:string};
  bindingId?:string;boundSince?:number;
  incidents?:Partial<IncidentSettings>;
  native?:SeatSettings;
  soul?:SoulRules;
  sessionId: string;
  label: string;
  owned: boolean;
  targets: string[];
  operations: Operation[];
  autoLink: boolean;
  active?: boolean;
  slot?: string;
  prompt?: string;
}
export interface PresetMember { incidents?:Partial<IncidentSettings>; native?:SeatSettings; soul?:SoulRules; key:string; label:string; prompt:string; targets:string[]; operations:Operation[]; }
export interface TeamPreset { coordination?: CoordinationPolicy; id:string; revision:number; name:string; description:string; members:PresetMember[]; entry:string; layout:Layout; updatedAt:number; }
export interface Configuration { requestId?:string; preset:TeamPreset; bindings:Record<string,string>; contextRevision:number; modified:boolean; }
export interface PendingConfiguration { switchId?:string; requestId?:string; preset:TeamPreset; bindings:Record<string,string>; applyLayout:boolean; modified?:boolean; error?:string; }
export interface RunIssue {stage:'retrying'|'attention'|'stopped'|'recovered'|'observed'; code:string; tool?:string; detail?:string;}
export interface TeamEvent { sessionId?:string; incidentKey?:string; incident?:(RunIssue & {epoch:string;member:string;input:string;requests:string[]}); id:string; teamId:string; time:number; kind:string; text:string; }
export interface Briefing {
  kind: 'work-review';
  state: 'prepared' | 'starting' | 'started' | 'uncertain';
  goal: string;
  criteria: string;
  worker: string;
  reviewer: string;
  instructions: {sessionId:string;text:string;wakeup:boolean}[];
  error?: string;
}
export interface ReviewBlock {tool:string;reason:'review_context_overflow'|'auto_review_failed'|'auto_review_denied'|'approval_rejected'|'approval_cancelled'|'approval_unavailable'|'file_sandbox_denied'|'shell_sandbox_denied';}
export interface SeatRun {
  bindingId?:string;
  trackedLive?:true;
  openIssue?:{input:string;requests:string[];issue:RunIssue};
  reviewBlock?:ReviewBlock;
  epoch:string; input:string; requests:string[]; attempts:number;
  lastDelivery?:{requestId:string;replyId:string;recipient:string};
  phase:'working'|'awaiting-reply'|'blocked'|'interrupted'|'delivered'|'completed'|'stopped';
  error?:string;
}
export interface Team {
  runs?:Record<string,SeatRun>;
  epoch?: string;
  coordination?: CoordinationPolicy;
  budget?:{id?:string;mode:'warn'|'pause';dispatches?:number;wakeups?:number;durationMs?:number;startedAt:number;usedDispatches:number;usedWakeups:number;warning?:string};
  tasks?:TaskClaim[];
  taskHeads?:{key:string;revision:number;archive:string}[];
  controlKeys?:{key:string;from:string;archive:string}[];
  controlGrants?:ControlGrant[];
  controls?:ControlRecord[];
  shared?: SharedEntry[];
  history?: SharedRevision[];
  subscriptions?: ResourceSubscription[];
  changes?: ChangeNotice[];
  resourceIndex?:ResourceIdentity[];
  id: string;
  anchor: string;
  title: string;
  cwd: string;
  paused: boolean;
  members: Member[];
  layout: Layout;
  order: string[];
  hidden: string[];
  sizes: number[];
  briefing?: Briefing;
  dock?: DockNode|null;
  sidebarOrder?: string[];
  graph?: Record<string,{x:number;y:number}>;
  configuration?:Configuration;
  pending?:PendingConfiguration;
  bindingHistory?:Record<string,Record<string,string>>;
  start?:{revision:number;state:'starting'|'started'|'uncertain';error?:string};
}
export type Delivery = 'queued' | 'dispatching' | 'accepted' | 'uncertain' | 'cancelled';
export interface Message extends MessageOptions {
  senderBinding?:string;targetBinding?:string;
  deliveryIssue?:string;
  routeReply?:true;
  syncSummary?:import('./sync-summary.ts').SyncSummary;
  sequence?: number;
  cancellation?: {reason:string;time:number;status:'pending'|'removed'|'admitted'|'absent'|'unknown'};
  publication?:{key:string;targets:string[]};
  syncKey?: string;
  syncBatch?: string;
  syncReplacement?: string;
  syncFrom?: number;
  syncTo?: number;
  epoch?: string;
  native?: 'queued' | 'admitted' | 'discarded';
  ack?: {time:number;note:string};
  expiresAt?: number;
  attempts?: number;
  retryAt?: number;
  probeAttempts?: number;
  wakeBudget?: string;
  system?: boolean;
  id: string;
  key: string;
  teamId: string;
  sender: string;
  target: string;
  text: string;
  time: number;
  state: Delivery;
  error?: string;
}
export interface State {
  archiveIntents?:{id:string;teamId:string;time:number;members:{id:string;archived:boolean}[]}[];
  retiredLedgers?:import("./timeline.ts").RetiredLedger[];
  memberships?:import("./memberships.ts").MembershipPeriod[];
  version: 6 | 7;
  hostOperations?: HostOperation[];
  retentionDays?: number;
  resources?: ToolResource[];
  sequence?: number;
  projects?: SharedProject[];
  archives?: ArchiveRef[];
  archivedKeys?: ArchivedKey[];
  revision: number;
  teams: Team[];
  messages: Message[];
  presets:TeamPreset[];
  events:TeamEvent[];
}
export interface NativeHost {
  canBind?(id:string):Promise<boolean>;
  archived?(id:string):boolean|undefined;
  workingOnFile?(team:Team,path:string):string[];
  validateSeats?(seats:SeatSelection[]):Promise<void>;
  applySeat?(id:string,settings:SeatSettings):Promise<void>;
  preparePersonas?(requests:{sessionId:string;rules:SoulRules}[]):Promise<unknown>;
  applyPersonas?(plan:unknown):Promise<void>;
  sync?(teams: Team[]): void;
  create(id: string, cwd: string, parent: string, label: string, mode?:string): Promise<void>;
  exists(id: string): Promise<boolean>;
  owns?(id: string): boolean;
  release?(id: string): Promise<void>;
  deliver(message: Message, signal?: AbortSignal, authorize?:()=>void): Promise<void | 'queued' | 'admitted'>;
  retract?(message:Message):Promise<boolean>;
  probe?(message:Message):Promise<'queued'|'admitted'|'absent'|'unknown'>;
  brief(id:string, text:string, wakeup:boolean):Promise<void>;
  status(id: string): string;
  interrupt?(id:string):void;
  stopOwned(): Promise<void>;
}

export type Priority = 'normal' | 'high' | 'critical';
export type MessageKind = 'notice' | 'request' | 'reply' | 'event';
export interface MessageOptions {
  kind?: MessageKind; priority?: Priority; code?: string;
  delivery?: 'next-turn'|'next-step'; wakeup?: boolean;
  replyTo?: string; followUpTo?: string; allowReply?: boolean; ttlMs?: number;
  taskId?: string; evidence?: string[]; payload?:unknown; eventVersion?:number; dependsOn?:string[];
}
/** Rules restrict an existing directed edge. No reverse edge is implied. */
export interface RouteRule { from:string; to:string; kinds?:MessageKind[]; codes?:string[]; priorities?:Priority[]; allowReply?:boolean; }
export interface CoordinationPolicy { routes?:RouteRule[]; eventCodes?:string[]; defaults?:Record<string,unknown>; events?:EventDefinition[]; variables?:Record<string,VariableDefinition>; }
export interface SharedEntry { teamId?:string; protected?:boolean;source?:'member'|'user'|'migration'; key:string; scope:string; kind:'value'|'decision'; value:unknown; revision:number; author:string; reason:string; time:number; }
export interface ChangeNotice { teamId?:string; id:string; author:string; resource:string; version:string; summary:string; time:number; origin:'native-file'|'reported'; }

export interface SharedRevision extends SharedEntry {
  id:string; sequence:number; previousRevision:number; supersedes?:string;
  evidence:string[]; source:'member'|'user'|'migration'; baseline?:boolean;
}
export interface ResourceSubscription {sessionId:string;resource:string;projectId?:string;}
export interface SharedProject {
  id:string; name:string; root:string; teamIds:string[];
  shared:SharedEntry[]; history:SharedRevision[]; changes:ChangeNotice[]; resourceIndex?:ResourceIdentity[];
}
export interface ResourceIdentity {id:string;generation:number;aliases:string[];retiredPaths?:string[];nativeIds:string[];exists:boolean;version:string;}
export interface ChangeDetails {
  canonicalPath?:string;previousResource?:string;
  resourceId?:string; beforeVersion?:string; beforeHash?:string; afterHash?:string;
  diff?:string; truncated?:boolean; projectId?:string; evidence?:string[];
  operation?:'create'|'update'|'delete'|'observe'|'rename';
}
export interface ChangeNotice extends ChangeDetails {sequence?:number;identity?:{id:string;generation:number};provenance?:ObservationOrigin;}
export interface SharedOptions {projectId?:string;evidence?:string[];}
export interface MessageQuery {cursor?:number;requestId?:string;direction?:'incoming'|'outgoing'|'both';sender?:string;code?:string;epoch?:string;limit?:number;includeArchive?:boolean;}
export interface MessagePage {messages:Message[];cursor:number;hasMore:boolean;}
export type WaitReason='matched'|'timeout'|'cancelled'|'paused'|'ended'|'scope_changed'|'expired'|'discarded'|'unavailable'|'cycle'|'blocked'|'interrupted';
export interface WaitResult extends MessagePage {issue?:RunIssue & {member:string;requestId:string};reason:WaitReason;block?:ReviewBlock & {requestId:string;member:string;sequence?:number};}
export interface ArchivedKey {id:string;key:string;teamId:string;sender:string;epoch?:string;archive:string;}
export interface ArchiveRef {sourceTeamIds?:string[];id:string;time:number;sha256:string;messages:number;history:number;changes:number;teamIds:string[];projectIds:string[];minSequence?:number;maxSequence?:number;tasks?:number;controls?:number;events?:number;}
export interface ArchiveBundle {version:1;tasks?:{owner:string;entries:TaskClaim[]}[];controls?:{owner:string;entries:ControlRecord[]}[];events?:TeamEvent[];hostOperations?:HostOperation[];messages:Message[];history:{owner:string;entries:SharedRevision[]}[];changes:{owner:string;entries:ChangeNotice[]}[];}

export interface DataSchema {type:'object'|'array'|'string'|'number'|'integer'|'boolean'|'null'; description?:string; enum?:unknown[]; properties?:Record<string,DataSchema>; required?:string[]; additionalProperties?:boolean; items?:DataSchema; minimum?:number; maximum?:number; minLength?:number; maxLength?:number; minItems?:number; maxItems?:number;}
export interface EventDefinition {code:string;version:number;label:string;description:string;schema?:DataSchema;defaults?:Pick<MessageOptions,'priority'|'delivery'|'wakeup'|'ttlMs'>;}
export interface VariableDefinition {schema:DataSchema;default?:unknown;description?:string;}
export type AccessMode='read'|'write';
export interface ToolBinding {tool:string;mode:AccessMode;}
export interface LeaseDelegation {grantorMember:string;id:string;target:string;member:string;teamId:string;epoch:string;expiresAt:number;revokedAt?:number;}
export interface ToolLease {id:string;owner:string;mode:AccessMode;generation:number;expiresAt:number;delegation?:LeaseDelegation;}
export interface ResourceOperation {leaseId?:string;delegationId?:string;id:string;owner:string;callId:string;tool:string;mode:AccessMode;generation:number;startedAt:number;state:'running'|'uncertain';error?:string;}
export interface ToolResource {id:string;label:string;instance:string;mode:'advisory'|'guarded';bindings:ToolBinding[];maxReaders:number;revision:number;generation:number;leases:ToolLease[];operations:ResourceOperation[];history:{time:number;kind:string;owner:string;note:string}[];}
export interface TaskClaim {key:string;revision:number;epoch?:string;owner?:string;expiresAt?:number;offer?:{id:string;epoch?:string;from?:string;target:string;summary:string;evidence:string[]};history:{revision:number;time:number;actor:string;action:string;note:string}[];}

/** Captured before a native mutation completes; never inferred from later membership. */
export interface ObservationOrigin {bindingId?:string;workingMembers?:string[];batchId?:string;actorLabel?:string;git?:{repositoryId:string;checkoutRoot:string;branch:string};id?:string;teamId:string;epoch:string;projectId?:string;observedAt:number;memberSessionId?:string;actorSessionId?:string;rootSessionId?:string;}
export interface HostOperation {addition?:{id:string;input:string};id:string;teamId:string;epoch?:string|undefined;kind:string;time:number;state:'prepared'|'uncertain'|'completed'|'resolved';sessions:string[];created?:string[];error?:string;}

export interface ControlGrant {id:string;from:string;to:string;operation:'interrupt';expiresAt:number;epoch:string;source:'user';used?:string;}
export interface ControlRecord {id:string;key:string;from:string;to:string;grantId:string;time:number;state:'requested'|'accepted'|'idle'|'uncertain';reason:string;}
