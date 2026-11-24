import {SectionTitle} from './ui.tsx';
import {tr,messageText} from './locale.ts';
import {useEffect,useState} from 'react';
import {Button,Menu,IconChevronDownOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {SoulRule,SoulRules} from '../domain/types.ts';
interface SoulView {revision:number;enabled:boolean;selection:SoulRule;children:{selection:SoulRule};effective?:{personaId?:string|null;status:string;source:{scope:string}};personas:{id:string;name:string}[];}
function useSoul(sessionId?:string){
 const [view,setView]=useState<SoulView>(),[error,setError]=useState(''),[missing,setMissing]=useState(false);
 useEffect(()=>{const controller=new AbortController();let disposed=false;setView(undefined);setError('');setMissing(false);
  const load=async()=>{if(disposed||document.hidden)return;try{const res=await fetch('/private-soul/v2/state?compact=1'+(sessionId?'&sessionId='+encodeURIComponent(sessionId):''),{signal:controller.signal,cache:'no-store'});if(res.status===404){setMissing(true);return;}if(!res.ok)throw Error(tr('暂时无法读取人设绑定'));const next=await res.json();if(!Array.isArray(next.personas)||typeof next.revision!=='number')throw Error(tr('人设接口版本不兼容'));if(!disposed){setView(old=>!old||next.revision>=old.revision?next:old);setMissing(false);setError('');}}catch(e){if(!controller.signal.aborted)setError(String(e));}};
  const changed=()=>{void load();};changed();const timer=setInterval(changed,3000);window.addEventListener('private-soul-library-changed',changed);return()=>{disposed=true;controller.abort();clearInterval(timer);window.removeEventListener('private-soul-library-changed',changed);};
 },[sessionId]);return {view,setView,error,setError,missing};
}
function Choice({label,rule,view,children=false,template=false,busy,onChange}:{label:string;rule:SoulRule|undefined;view:SoulView;children?:boolean;template?:boolean;busy?:boolean;onChange:(rule:SoulRule)=>void}){
 const [open,setOpen]=useState(false),value=rule?.mode==='persona'?rule.personaId:rule?.mode??'follow';
 const rows=[{value:'follow',label:tr(template?'不指定，沿用灵魂规则':'跟随灵魂插件规则')},{value:'none',label:tr('不使用人设')},...(children?[{value:'parent',label:tr('复用派出者人设')}]:[]),...view.personas.map(p=>({value:p.id,label:p.name}))];
 return <div className="td-native-field"><label>{label}</label><Menu open={open} onClose={()=>setOpen(false)} selectedId={value} onSelect={id=>{onChange(['follow','none','parent'].includes(id)?{mode:id as 'follow'|'none'|'parent'}:{mode:'persona',personaId:id});setOpen(false);}} portal minWidthFromAnchor dense items={rows.map(row=>({id:row.value,label:row.label}))} anchor={<Button className="td-select-trigger" variant="outline" disabled={busy} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><span>{rows.find(r=>r.value===value)?.label??tr('人设已失效')}</span><IconChevronDownOutlineRegular size={12}/></Button>}/></div>;
}
export function PresetPersona({value,onChange}:{value:SoulRules|undefined;onChange:(value:SoulRules)=>void}){
 const {view,missing,error}=useSoul();if(missing)return null;if(!view)return error?<p role="alert">{messageText(error)}</p>:null;
 const change=(key:'persona'|'children',rule:SoulRule)=>{const next={...value};if(rule.mode==='follow')delete next[key];else next[key]=rule;onChange(next);};
 return <div className="td-preset-soul" data-preset-soul=""><SectionTitle title={tr('人设预设')} hint={tr('只保存人设引用，不包含人格文本或记忆。应用时优先采用明确选择；未指定则保留灵魂插件原规则。之后可逐会话修改，子代理规则只影响后续创建的子代理。')}/><Choice template label={tr('成员人设')} rule={value?.persona} view={view} onChange={r=>change('persona',r)}/><Choice template children label={tr('子代理人设')} rule={value?.children} view={view} onChange={r=>change('children',r)}/>{!view.enabled&&<small>{tr('私人灵魂尚未启用')}</small>}</div>;
}
export function PersonaBinding({sessionId}:{sessionId:string}){
 return <SessionPersonaBinding key={sessionId} sessionId={sessionId}/>;
}
function SessionPersonaBinding({sessionId}:{sessionId:string}){
 const {view,setView,error,setError,missing}=useSoul(sessionId),[busy,setBusy]=useState(false);if(missing)return null;
 async function save(target:string,rule:SoulRule){if(!view)return;setBusy(true);setError('');try{const response=await fetch('/private-soul/v2/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'rule-set',sessionId,expectedRevision:view.revision,data:{scope:'session',id:sessionId,target,rule}})});const result=await response.json();if(!response.ok)throw Error(result.error);setView(result.view);window.dispatchEvent(new Event('private-soul-library-changed'));}catch(e){setError(String(e));}finally{setBusy(false);}}
 const effective=view?.effective?.status==='missing'?tr('人设已失效'):view?.personas.find(p=>p.id===view.effective?.personaId)?.name??tr('不使用人设');
 return <div className="td-session-soul" data-session-soul=""><SectionTitle title={tr('本会话人设')} hint={tr('与灵魂插件使用同一份会话规则；修改在下一次请求生效，不改写已派出的子代理。')}/>{view&&<><Choice label={tr('成员人设')} rule={view.selection} view={view} busy={busy} onChange={r=>void save('persona',r)}/><Choice children label={tr('子代理人设')} rule={view.children?.selection} view={view} busy={busy} onChange={r=>void save('children',r)}/><small>{view.enabled?effective:tr('私人灵魂尚未启用')}</small></>}{error&&<p role="alert">{messageText(error)}</p>}</div>;
}
