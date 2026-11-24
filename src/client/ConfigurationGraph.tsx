import {useState,type ReactNode} from 'react';
import {Button} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Member,Team,SoulRules} from '../domain/types.ts';
import type {Injected} from './contracts.ts';
import {presetFromTeam} from '../domain/preset-library.ts';
import {Graph} from './Graph.tsx';
import {useDraft} from './use-draft.ts';
import {tr,messageText} from './locale.ts';
interface Draft {members:Member[];baseline:string;revision:number;}
const editableMembers=(team:Team):Member[]=>team.members.map(m=>{const slot=team.configuration?.preset.members.find(s=>s.key===m.slot),soul=slot?.soul;return {...m,...(slot?.native?{native:{...slot.native}}:{}),...(soul?{soul:structuredClone(soul)}:{})};});
/** Name, prompt, routes and operations commit together; graph geometry stays a view preference. */
export function ConfigurationGraph({team,perform,title,header,editing,notify}:{notify:(text:string)=>void;team:Team;perform:Injected['perform'];title:(id:string)=>string;header:(actions:ReactNode)=>ReactNode;editing:boolean}){
 const [draft,setDraft]=useState<Draft>(),[busy,setBusy]=useState(false);
 const dirty=!!draft&&JSON.stringify(draft.members)!==draft.baseline;
 useDraft(dirty,()=>setDraft(undefined));
 const edit:Injected['perform']=async data=>{
  if(!['rename','member-prompt','member-soul','member-native','member-incidents','connection','operation'].includes(String(data.action)))return perform(data);
  setDraft(old=>{const members=editableMembers(team),current=old??{members:structuredClone(members),baseline:JSON.stringify(members),revision:team.configuration?.contextRevision??0};
   return {...current,members:current.members.map(m=>{
    if(data.action==='connection'&&m.sessionId===data.source)return {...m,targets:data.enabled?[...new Set([...m.targets,String(data.target)])]:m.targets.filter(id=>id!==data.target)};
    if(m.sessionId!==data.sessionId)return m;
    if(data.action==='rename')return {...m,label:String(data.title)};
    if(data.action==='member-incidents')return {...m,incidents:{...m.incidents,[String(data.setting)]:Boolean(data.enabled)}};
    if(data.action==='member-prompt')return {...m,prompt:String(data.prompt)};
    if(data.action==='member-native'){const next={...m};const native=data.native as NonNullable<Member['native']>;if(Object.keys(native).length)next.native=native;else delete next.native;return next;}
    if(data.action==='member-soul')return {...m,soul:data.soul as SoulRules};
    if(data.action==='operation')return {...m,operations:data.enabled?[...new Set([...m.operations,data.operation as Member['operations'][number]])]:m.operations.filter(op=>op!==data.operation)};
    return m;
   })};
  });
 };
 const save=async()=>{if(!draft||!dirty||busy)return;setBusy(true);try{
  const staged={...team,members:draft.members},preset=presetFromTeam(staged);
  const bindings=Object.fromEntries(staged.members.filter(m=>m.active!==false).map((m,i)=>[preset.members[i]!.key,m.sessionId]));
  preset.members=preset.members.map(slot=>{const member=staged.members.find(m=>m.sessionId===bindings[slot.key]);const next={...slot};if(member?.native)next.native={...member.native};else delete next.native;if(member?.soul)next.soul=member.soul;return next;});
  await perform({action:'team-configure',teamId:team.id,preset,bindings,expected:draft.revision});setDraft(undefined);notify(tr('当前配置已保存'));
 }catch(e){notify(messageText(e));}finally{setBusy(false);}};
 return <>{header(<span data-current-config-save=""><Button variant="primary" disabled={!dirty||busy} onClick={()=>void save()}>{busy?tr('正在保存…'):tr('保存并应用')}</Button></span>)}
  <div className="td-live-graph" hidden={editing}>{team.start?.error&&<p role="alert">{messageText(team.start.error)}</p>}<Graph team={{...team,members:dirty?draft!.members:editableMembers(team)}} perform={edit} title={title} draftMode/></div></>;
}
