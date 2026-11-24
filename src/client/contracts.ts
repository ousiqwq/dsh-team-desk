import type {WorkspaceSelectedHandler} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {TeamFeedback} from './feedback.ts';
import type {ReactNode} from 'react';
import type {ConfigForm} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {Preferences} from '../domain/preferences.ts';
import type {DockZone} from '../domain/docking.ts';
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime, InjectFace } from '@deepseek-ai/dsh-client-ui-slots';
import type { SessionReference,SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store';
import type { State, Team } from '../domain/types.ts';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
export interface ViewData { loadedPage?:string;legacyTeamIds?:string[];archivedIds?:string[]; managementPage?:string; nativePanel?:import('@deepseek-ai/dsh-client-ui-session-panel/client').SessionPanelToggleInjected|undefined; snapshotView?:'chat'|'manage'; titleHints?:Record<string,import('../domain/session-title.ts').TitleHint>; showFocusIndicator:boolean;  syncPending?:{id:string;resource?:string;origin?:{teamId:string}}[]; health?:{recipients?:{target:string;pending:number;causalWaiting:number;status:string;paused:boolean}[];queued:number;uncertain:number;oldestWaitMs:number;lastIssue:string|null;archiveCount:number}; nativeTargets?:Record<string,Exclude<SessionTarget,string>>; state:State; statuses:Record<string,string>; error:string; ready:boolean; activeTeam:string; activeSession:string; maximized:string; settingsTeam:string; settingsSession:string; frame:boolean; dialog:boolean; preferences:Preferences; }
export type LayoutChange=Partial<Pick<Team,'layout'|'order'|'hidden'|'sizes'>>;
export interface Injected {
  feedback:TeamFeedback;
  hasSettingsFactory():boolean;
  nativeConfigForm(namespace:string):ConfigForm<Record<string,unknown>>|undefined;
  hooks:{teamDesk:SnapshotStore<ViewData>};
  setFocusIndicator(value:boolean):void;
  perform(data:Record<string,unknown>):Promise<unknown>;
  updateLayout(teamId:string,change:LayoutChange):Promise<void>;
  open(id:string):void;
  showSettings(id?:string):void;
  createTeam(id:string):Promise<void>;
  chooseSettingsTeam(id:string):void;
  closeSettings():void;
  dockSession(id:string,target?:string,zone?:DockZone,anchor?:string):Promise<void>;
  focusSession(id:string):void;
  maximize(id:string):void;
  returnToChat(id:string):void;
  selectManagementPage(page:string):void;
  openGitDiff(id:string):Promise<void>;
  retain(target:SessionTarget):Promise<SessionReference>;
  retainFocused(target:SessionTarget):SessionReference;
  nativeHome(root:string):void;
  memberOwner(id:string):string;
  openMemberTarget(root:string,target:SessionTarget):void;
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap { 'sidebar.session.row.team-branch':{kind:'list';scope:'root';inline:true;owner:{sessionId:string;expanded:boolean;leaf?:boolean;title:string}}; 'conversation.session.header.home.utilities':{kind:'list';scope:'session'}; 'team-desk.pane':{kind:'single';scope:'session';owner:{headerTarget:HTMLElement|null;headerActive:boolean}}; }
  interface SlotFactoryMap {
    'conversation.shared-header':{scope:'session-maybe';props:Record<string,never>};
    'settings.dialog':{scope:'root';props:{title:string;dialogId:string;rows:{id:string;label:ReactNode}[];activeId:string;onSelect:(id:string)=>void;onClose:()=>void;content:ReactNode}};
    'conversation.frame':{scope:'session-maybe';props:{sharedHeader?:boolean;headerTarget?:HTMLElement|null;headerActive?:boolean};children:{'conversation.header':{kind:'single';scope:'session-maybe'}}};
  }
}
export type PanelProps=PropsRuntime<'main'> & PropsRenderSlots<'team-desk.pane'> & InjectFace<Injected>;
export type EntryProps=PropsRuntime<'sidebar.workspaces.session.menu.item'> & InjectFace<Injected>;
export type PaneProps=PropsRuntime<'team-desk.pane'> & PropsRenderFactories & {legacyFrame:boolean;hasSharedHeader:boolean;openWorkspace:WorkspaceSelectedHandler;headerTarget:HTMLElement|null;headerActive:boolean};

export type OverlayProps=PropsRuntime<'shell.overlay'> & PropsRenderFactories & InjectFace<Injected>;
