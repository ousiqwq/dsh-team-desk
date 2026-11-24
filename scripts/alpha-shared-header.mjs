// The alpha.2 frame exposes the conversation body as a factory but keeps the
// header private to the main view. Give both views the same native header.
import {UnsupportedHostBuild, readHostFile, reportHostError} from './host-compatibility.mjs';
import { createHash } from 'node:crypto';
import { rename, stat, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lifecycleBundles,previousLifecycleBundles } from './alpha-archive.mjs';

const originalHash = '1cfde2ff0c0ab9e6be7f6194a39143466fa3ac29313d42886195f2818b63c8a1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const owner = 'const registerConversationRoot=()=>slots.register({name:`main.conversation`,children:{"conversation.header":{kind:`single`,scope:`session-maybe`}}},ConversationRoot);';
const shared = 'const registerConversationRoot=()=>{const header=slots.registerFactory({name:`conversation.shared-header`,scope:`session-maybe`,children:{"conversation.header":{kind:`single`,scope:`session-maybe`}}},p=>p.renderSlot(`conversation.header`,{}));try{const root=slots.register({name:`main.conversation`},ConversationRoot);return ()=>{root();header()}}catch(e){header();throw e}};';
const render = 'renderSlot(`conversation.header`,{}),renderFactorySlot(`conversation.content`';
const reuse = 'renderFactorySlot(`conversation.shared-header`,{}),renderFactorySlot(`conversation.content`';
const [root, mode='--check'] = process.argv.slice(2);
if (!root || !['--check','--apply','--restore'].includes(mode)) throw Error('Expected host directory and --check, --apply or --restore');
// The workspace keeps the raw title and archive filter. Team Desk projects only
// the visible rows and reserves its blank conversations at the draft-reuse boundary.
const project = 'const detail={list,result:list};window.dispatchEvent(new CustomEvent("dsh:session-catalog-project",{detail}));list=detail.result;';
const workspace = [
 ...['deriveGroups(list,workspaces,rowState,statuses,view)','deriveFlat(list,sessionIds,rowState,statuses)'].map(sig=>['function '+sig+'{','function '+sig+'{'+project]),
 ['return[...placeholders,...leading,...rest]}function sessionTitle','const detail={rows:[...placeholders,...leading,...rest]};window.dispatchEvent(new CustomEvent("dsh:sidebar-seat-order",{detail}));return detail.rows}function sessionTitle'],
 ['summary.blank&&summary.cwd===workspace.path','summary.blank&&window.dispatchEvent(new CustomEvent("dsh:session-reuse-candidate",{detail:{sessionId:id},cancelable:true}))&&summary.cwd===workspace.path'],
 ['title:sessionTitle(s),blank:s.blank,running:','title:sessionTitle(s),tdTitle:s.presentationTitle,tdBranch:s.tdBranch,blank:s.blank,running:'],
 ['function displayTitle(node,t){return node.blank?', 'function displayTitle(node,t){if(node.tdTitle)return node.tdTitle;return node.blank?'],
 ['"data-row-key":`session:${node.id}`,className:', '"data-row-key":`session:${node.id}`,"data-team-branch":node.tdBranch,className:'],
];
const bundles=[
 ['dsh-client-ui-conversation',originalHash,[[render,reuse],[owner,shared]]],
 ['dsh-client-ui-agent-preset','d9f9f770e70960a5138193f49111bcd4f5ee5497dac03006e46380dcbe117114',[]],
 ['dsh-client-ui-sidebar-right','97fd4affc2ec277026ae000effe72c198ed3f9c21e15a1a9cd2e7e127012fd1e',[
  ['info=>info.activePanelId===null','info=>info.activePanelId===null||info.activePanelId==="team-desk"'],
  ['show(layout.panelInfo.getSnapshot().activePanelId===null?selected?.sessionId:void 0)','show([null,"team-desk"].includes(layout.panelInfo.getSnapshot().activePanelId)?selected?.sessionId:void 0)'],
 ]],
 ['dsh-client-ui-attachment','90c70d9f314be820c3530a284b8d8ca20e65aa1174d8fafb94e549980b59b9e0',[]],
 ['dsh-client-ui-workspace','7060f7b0060eb861b7a19f1a03d56ef82ea35efc2bd9aa48c23967b890888ffa',workspace],
];
// Read the active seat once per workspace tree. Without the plugin the snapshot is
// undefined and the workspace keeps its original selection and row rendering.
const viewGetter='function teamView(){const detail={};window.dispatchEvent(new CustomEvent("dsh:team-view-read",{detail}));return detail.view}';
const viewSubscription='function subscribeTeamView(fn){window.addEventListener("dsh:team-view-change",fn);return ()=>window.removeEventListener("dsh:team-view-change",fn)}';
const leading='!row.archived&&!row.blank&&(showStatus?(0,react_jsx_runtime.jsx)(SessionStatusDots,{statuses}):renderSlot(`sidebar.session.row.leading`,{sessionId:node.id}))';
const oldSelection='panelActive?void 0:Object.values(list.byId).find(session=>(session.retainedBy.mainView??0)>0)?.id';
const additions={
 // A visible team root is a native conversation in its own right. Keep its
 // preset controller separate from the next-session choice in the main view,
 // even when both surfaces retain the same native binding during navigation.
 'dsh-client-ui-agent-preset':[
   ['function AgentPresetSeat({sessionId,useSessionRetainInfo,','function AgentPresetSeat({sessionId,useSessions,useSessionRetainInfo,'],
   ['const main=useSessionRetainInfo(info=>sessionId===void 0||(info?.retainedBy.mainView??0)>0);','const ordinary=useSessions(s=>sessionId===void 0||s.byId[sessionId]?.origin!=="subagent");const main=useSessionRetainInfo(info=>sessionId===void 0||((info?.retainedBy.teamDesk??0)>0?ordinary:(info?.retainedBy.mainView??0)>0));'],
   ['const seatFor=binding=>{const existing=seats.get(binding);','const seatFor=binding=>{const inPane=()=>(ctx.sessions.retainInfo(binding.sessionId).getSnapshot().retainedBy.teamDesk??0)>0;const teamPane=inPane();const key=teamPane?binding.session:binding;const existing=seats.get(key);'],
   ['return summary!==void 0&&(ctx.sessions.retainInfo(binding.sessionId).getSnapshot().retainedBy.mainView??0)>0?summary:void 0},staged);seats.set(binding,seat);','return summary!==void 0&&(teamPane?inPane()&&summary.origin!=="subagent":!inPane()&&(ctx.sessions.retainInfo(binding.sessionId).getSnapshot().retainedBy.mainView??0)>0)?summary:void 0},teamPane?{id:void 0,introduce:false}:staged);seats.set(key,seat);'],
   ['stop();seats.delete(binding);boundSeatDisposers.delete(dispose)','stop();seats.delete(key);boundSeatDisposers.delete(dispose)'],
 ],
 'dsh-client-ui-attachment':[
   ['function installDocumentDropEvents(canAcceptDrop,onAddFiles,dragDepth,setDragActive,readFileDrag){','function installDocumentDropEvents(canAcceptDrop,onAddFiles,dragDepth,setDragActive,readFileDrag,owner){'],
   ['return dataTransfer};const reset=', 'if(!window.dispatchEvent(new CustomEvent("dsh:attachment-drop-target",{detail:{event,owner:owner.current},cancelable:true}))){if(dragDepth.current)reset();return null}return dataTransfer};const reset='],
   ['const dragDepth=(0,react.useRef)(0);','const owner=(0,react.useRef)(null);const dragDepth=(0,react.useRef)(0);'],
   ['setDragActive,readFileDrag)},[canAcceptDrop','setDragActive,readFileDrag,owner)},[canAcceptDrop'],
   ['children:[dragActive&&(0,react_jsx_runtime.jsx)(DropOverlay,{disabled:', 'children:[(0,react_jsx_runtime.jsx)("span",{ref:owner,hidden:true}),dragActive&&(0,react_jsx_runtime.jsx)(DropOverlay,{owner:owner.current,disabled:'],
   ['function DropOverlay({disabled,labels}){return', 'function DropOverlay({disabled,labels,owner}){const detail={owner,style:undefined};window.dispatchEvent(new CustomEvent("dsh:attachment-drop-overlay",{detail}));return'],
   ['className:DropOverlay_module_css_default.mask,role:', 'className:DropOverlay_module_css_default.mask,style:detail.style,role:'],
 ],
 'dsh-client-ui-workspace':[
   ['openSession(target){this.replaceMain','openSession(target){if(!window.dispatchEvent(new CustomEvent("dsh:native-session-open",{detail:{target},cancelable:true})))return;this.replaceMain'],
   ['function SessionTree(',viewGetter+viewSubscription+'function SessionTree('],
   ['const panelActive=usePanelInfo(info=>info.activePanelId!==null);','const panelActive=usePanelInfo(info=>info.activePanelId!==null);const team=(0,react.useSyncExternalStore)(subscribeTeamView,teamView);',3],
   [oldSelection,'team?.seat??('+oldSelection+')',3],
   ['[list,workspaces,rowState,statuses,expandedGroups,ungroupedSessionIds]','[list,workspaces,rowState,statuses,expandedGroups,ungroupedSessionIds,team?.expansion]'],
   ['[list,sessionIds,rowState,statuses]','[list,sessionIds,rowState,statuses,team?.expansion]'],
   ['"sidebar.session.row.leading":{kind:`list`,scope:`root`,inline:true}', '"sidebar.session.row.team-branch":{kind:`list`,scope:`root`,inline:true},"sidebar.session.row.leading":{kind:`list`,scope:`root`,inline:true}'],
   [leading,'node.tdBranch==="root"?[(0,react_jsx_runtime.jsx)(react.Fragment,{children:renderSlot("sidebar.session.row.team-branch",{sessionId:node.id,expanded:teamView()?.expansion[node.id]!==false,title})},"branch"),(0,react_jsx_runtime.jsx)("span",{className:"td-root-status",children:'+leading+'},"status")]:'+leading],
 ],
 'dsh-client-ui-sidebar-right':[
   ['const sync=()=>{views.select(current.getSnapshot().key)};const unsubscribe=current.subscribe(sync);sync();return()=>{unsubscribe();views.dispose()}',
    'const sync=()=>{const detail={};window.dispatchEvent(new CustomEvent("dsh:team-view-read",{detail}));views.select(ctx.layout.panelInfo.getSnapshot().activePanelId==="team-desk"?detail.view?.session:current.getSnapshot().key)};const unsubscribe=current.subscribe(sync),offPanel=ctx.layout.panelInfo.subscribe(sync);window.addEventListener("dsh:team-view-change",sync);sync();return()=>{window.removeEventListener("dsh:team-view-change",sync);offPanel();unsubscribe();views.dispose()}'],
 ],
 'dsh-client-ui-conversation':[
   ['if(locked||editor===null)return;if((0,_deepseek_ai_dsh_client_ui_primitives.isMobileDevice)())return;focusDraftEditor','if(locked||editor===null||editor.getRootElement()?.closest(`[data-conversation-autofocus="false"]`))return;if((0,_deepseek_ai_dsh_client_ui_primitives.isMobileDevice)())return;focusDraftEditor'],
   ['busyPhaseSeen.current=false;if(locked||editor===null)return;', 'busyPhaseSeen.current=false;if(locked||editor===null||editor.getRootElement()?.closest(`[data-conversation-autofocus="false"]`))return;'],
 ],
};
// Team members are child rows. Counting them against the workspace's native
// five-session limit replaces them with unrelated rows on collapse, leaving
// neighbouring workspaces at the same height and cutting teams in half.
const treeLayout=[
 ['function watermarkRows(sessions,watermark){let count=0;const rows=sessions.filter(session=>{if(session.blank)return true;count+=1;return count<=watermark});return{rows,hiddenCount:sessions.length-rows.length}}',
  'function teamChild(row){return row.tdBranch==="member"||row.tdBranch==="last"}function watermarkRows(sessions,watermark){let count=0,hiddenCount=0;const rows=sessions.filter(session=>{if(session.blank)return true;if(!teamChild(session)){count++;if(count>watermark)hiddenCount++}return count<=watermark});return{rows,hiddenCount}}'],
 ['if(session.blank)continue;index+=1;if(index<=SESSION_WATERMARK_AUTO_MAX','if(session.blank)continue;if(!teamChild(session))index+=1;if(index<=SESSION_WATERMARK_AUTO_MAX'],
 // Keep AnimatedRows armed when the user pages a workspace containing a team.
 // Ordinary views retain their native reveal and reset behaviour.
 ['const dropWatermarks=drop=>','const dropWatermarks=(drop,animate=false)=>'],
 ['!drop(key))));setWatermarkMotionKey(key=>key+1)','!drop(key))));if(!animate)setWatermarkMotionKey(key=>key+1)'],
 ['if(sessionsExpanded){dropWatermarks(key=>key===group.key);return}', 'const teamRows=group.sessions.some(row=>row.tdBranch==="root");if(sessionsExpanded){dropWatermarks(key=>key===group.key,teamRows);return}'],
 ['watermark+SESSION_WATERMARK_BASE}));setWatermarkMotionKey(key=>key+1)', 'watermark+SESSION_WATERMARK_BASE}));if(!teamRows)setWatermarkMotionKey(key=>key+1)'],
];
function applyEdits(source,edits,name) {
 for(const [before,after,occurrences=1] of edits){
   if(source.split(before).length!==occurrences+1)throw Error('Unexpected '+name+' anchor: '+before.slice(0,80));
   source=source.split(before).join(after);
 }
 return source;
}
function undo(source,edits){
 for(const [before,after] of [...edits].reverse())source=source.split(after).join(before);
 return source;
}
// Describe the same projected rows to assistive technology. The native workspace
// supplies its directory depth; the flat browser starts at the top level.
const rowSemantics=[
 ['SessionNodeItem({node,currentId','SessionNodeItem({node,level=1,currentId'],
 ['SessionNodeItem,{node,currentId:current','SessionNodeItem,{node,level:depth+2,currentId:current'],
 ['"data-team-branch":node.tdBranch,className:', '"data-team-branch":node.tdBranch,"aria-level":node.tdBranch?level+(teamChild(node)?1:0):void 0,"aria-expanded":node.tdBranch==="root"?teamView()?.expansion[node.id]!==false:void 0,className:'],
 ['node.tdBranch==="root"?[','(node.tdBranch==="root"||node.tdBranch==="solo")?['],
 ['sessionId:node.id,expanded:teamView()', 'sessionId:node.id,leaf:node.tdBranch==="solo",expanded:teamView()'],
];
const readySelection=[
 ['views.select(ctx.layout.panelInfo.getSnapshot().activePanelId==="team-desk"?detail.view?.session:current.getSnapshot().key)',
  'const team=ctx.layout.panelInfo.getSnapshot().activePanelId==="team-desk",key=team?detail.view?.session:current.getSnapshot().key;views.select(!team||key!==void 0&&(ctx.sessions.list.getSnapshot().byId[key]||ctx.sessions.subagentAddress(key))?key:void 0)'],
 ['offPanel=ctx.layout.panelInfo.subscribe(sync);window.addEventListener','offPanel=ctx.layout.panelInfo.subscribe(sync),offCatalog=ctx.sessions.list.subscribe(sync);window.addEventListener'],
 ['offPanel();unsubscribe();views.dispose()', 'offCatalog();offPanel();unsubscribe();views.dispose()']
];
// Native workspace dragend can commit a previously hovered row even when
// the final target rejects the drop. Let a team boundary discard that marker.
const guardedRowDrop=[
 ['drag?.end(e.dataTransfer.dropEffect===`copy`)','drag?.end(e.dataTransfer.dropEffect===`copy`||document.documentElement.hasAttribute("data-td-reject-row-drop"))'],
];
const archiveUI=[
 ['function visibleSessionIds(list,archivedSessionIds,archivedFilter){','function visibleSessionIds(list,archivedSessionIds,archivedFilter){'+project],
 ['function groupByWorkspace(list,workspaces,archived,archivedFilter,ungroupedOrder){','function groupByWorkspace(list,workspaces,archived,archivedFilter,ungroupedOrder){if(archivedFilter!=="default"){const info={workspaces,archived};window.dispatchEvent(new CustomEvent("dsh:archived-team-workspaces",{detail:info}));workspaces=info.workspaces}'],
 ['const unarchiveSession=sessionId=>{uiWorkspace.unarchiveSession','const unarchiveSession=sessionId=>{if(!canArchiveTeamRow(sessionId))return;uiWorkspace.unarchiveSession'],
 ['function ArchiveSessionRowButton(', 'function canArchiveTeamRow(id){return window.dispatchEvent(new CustomEvent("dsh:team-member-archive",{detail:id,cancelable:true}))}function ArchiveSessionRowButton('],
 ['if(!useSessionAccess(sessionId,archived?`workspace/unarchiveSession`:`workspace/archiveSession`))return null','if(!useSessionAccess(sessionId,archived?`workspace/unarchiveSession`:`workspace/archiveSession`)||!canArchiveTeamRow(sessionId))return null'],
 ['const restoring=archived(target);if(!allowed(target,','const restoring=archived(target);if(!canArchiveTeamRow(target.sessionId)||!allowed(target,'],
 ['const canUnarchive=useSessionAccess(result.id,`workspace/unarchiveSession`)','const canUnarchive=useSessionAccess(result.id,`workspace/unarchiveSession`)&&canArchiveTeamRow(result.id)'],
 ['archiveSession:sessionId=>{uiWorkspace.archiveSession','archiveSession:sessionId=>{if(!canArchiveTeamRow(sessionId))return;uiWorkspace.archiveSession'],
];
async function adapt() {
  const updates=[];
  for (const [name,digest,changes] of bundles) {
    const pkg=join(root,'node_modules/@deepseek-ai',name);
    const file=join(pkg,'lib/client.js'),current=await readHostFile(file),extra=additions[name];
    const layoutEdits=name==='dsh-client-ui-workspace'?treeLayout:[];
    const latest=name==="dsh-client-ui-workspace"?rowSemantics:name==="dsh-client-ui-sidebar-right"?readySelection:[];
    const guard=name==='dsh-client-ui-workspace'?guardedRowDrop:[];
    const archive=name==='dsh-client-ui-workspace'?archiveUI:[];
    const prior=undo(undo(current,archive),guard);
    const original=[undo(undo(undo(undo(prior,latest),layoutEdits),extra),changes),prior,undo(prior,changes),undo(undo(undo(prior,layoutEdits),extra),changes)].find(bytes=>hash(bytes)===digest);
    if(original===undefined)throw new UnsupportedHostBuild('Unexpected '+name+' checksum');
    const previous=applyEdits(original,changes,name),base=applyEdits(previous,extra,name),layoutVersion=applyEdits(base,layoutEdits,name),rowVersion=applyEdits(layoutVersion,latest,name),guardVersion=applyEdits(rowVersion,guard,name),patched=applyEdits(guardVersion,archive,name);
    if(![original,previous,base,layoutVersion,rowVersion,guardVersion,patched].includes(current))throw Error('Unexpected partial '+name+' installation');
    const desired=mode==='--restore'?original:patched;
    updates.push({name,file,current,desired,status:current===original?'official':current===patched?'active':'legacy',permissions:(await stat(file)).mode});
  }
  for(const [name,digest,edits] of lifecycleBundles){
    const file=join(root,'node_modules/@deepseek-ai',name,'lib/index.js'),current=await readHostFile(file);
    const legacy=previousLifecycleBundles.find(bundle=>bundle[0]===name)[2];
    const original=[current,undo(current,edits),undo(current,legacy)].find(bytes=>hash(bytes)===digest);
    if(original===undefined)throw new UnsupportedHostBuild('Unexpected '+name+' checksum');
    const patched=applyEdits(original,edits,name);
    if(current!==original&&current!==patched&&current!==applyEdits(original,legacy,name))throw Error('Partial '+name+' installation');
    updates.push({name,file,current,desired:mode==='--restore'?original:patched,status:current===original?'official':current===patched?'active':'legacy',permissions:(await stat(file)).mode});
  }
  async function replace(update,contents){
   const temp=update.file+'.'+randomUUID()+'.tmp';
   try{await writeFile(temp,contents,{flag:'wx',mode:update.permissions});await rename(temp,update.file);}
   finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  }
  const applied=[];
  try{
   if(mode!=='--check')for(const update of updates)if(update.current!==update.desired){await replace(update,update.desired);applied.push(update);}
  }catch(error){for(const update of applied.reverse())await replace(update,update.current);throw error;}
  console.log(mode==='--check' ? updates.map(u=>u.name+' '+u.status).join('\n') : mode==='--apply'?'native UI adapters active':'official bundles restored');
}

await adapt().catch(reportHostError);
