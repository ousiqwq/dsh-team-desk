import {useDraft} from './use-draft.ts';
import {draftGuard} from './draft-guard.ts';
import {Select} from './Select.tsx';
import {Help,SectionTitle} from './ui.tsx';
import {Input} from '@deepseek-ai/dsh-client-ui-primitives';
import {tr, messageText} from './locale.ts';
import {PolicyEditor} from './Coordination.tsx';
import {newId} from './id.ts';
import {useId,useMemo,useState,type ReactNode} from 'react';
import {Button,Switch,SegmentedTabs,IconChevronLeftOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import type {TeamPreset,Team,Member} from '../domain/types.ts';
import {arrangeGraph,graphEdges,NODE_WIDTH,NODE_HEIGHT} from '../domain/graph-layout.ts';
import {validatePreset,blankPreset} from '../domain/preset-library.ts';
import {Graph} from './Graph.tsx';
import {layoutNames} from './presentation.ts';
import type {Injected} from './contracts.ts';

export function MiniGraph({preset}:{preset:TeamPreset}){
 const marker=useId().replace(/:/g,''),model=preset.members.map(m=>({id:m.key,label:m.label,targets:m.targets,send:m.operations.includes('send')}));
 const {positions,edges,width,height}=useMemo(()=>{const positions=arrangeGraph(model,preset.entry);return {positions,edges:graphEdges(model,positions),width:Math.max(...Object.values(positions).map(p=>p.x+NODE_WIDTH))+60,height:Math.max(...Object.values(positions).map(p=>p.y+NODE_HEIGHT))+60};},[JSON.stringify(model),preset.entry]);
 return <svg className="td-mini-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={preset.name+'：'+preset.members.map(m=>m.label).join('、')}><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8Z" fill="currentColor"/></marker></defs>{edges.map(e=><path key={e.source+'-'+e.target} d={e.path} className="td-mini-edge" markerEnd={`url(#${marker})`} markerStart={e.reverse?`url(#${marker})`:undefined}/>)}{preset.members.map(m=>{const p=positions[m.key]!;return <g key={m.key}><rect x={p.x} y={p.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="14"/><text x={p.x+NODE_WIDTH/2} y={p.y+50} textAnchor="middle">{m.label.length>12?m.label.slice(0,11)+'…':m.label}</text><text className="td-mini-caption" x={p.x+NODE_WIDTH/2} y={p.y+78} textAnchor="middle">{m.key===preset.entry?tr("主成员"):m.prompt?tr("含协作提示词"):tr("无分工提示词")}</text></g>;})}</svg>;
}
export function PresetCards({presets,selected,onSelect,editable=false,actions}:{presets:TeamPreset[];selected?:string;onSelect:(p:TeamPreset)=>void;editable?:boolean;actions?:(p:TeamPreset)=>ReactNode}){
 return <div className="td-preset-cards">{presets.map(p=><article key={p.id} className="td-preset-card" data-selected={selected===p.id}><button type="button" className="td-preset-select" onClick={()=>onSelect(p)}><div className="td-row"><strong>{p.name}</strong><span className="td-badge">{tr("v{p0} ·{p1} 人", {p0: p.revision, p1: p.members.length})}</span></div><MiniGraph preset={p}/><p>{p.description||tr("自定义协作配置")}</p><span className="td-muted">{editable?tr("编辑预设"):tr("选择此预设")}</span></button>{actions&&<div className="td-preset-actions">{actions(p)}</div>}</article>)}</div>;
}
export function PresetEditor({value,onSave,onCancel,saveLabel=tr("保存预设")}:{value:TeamPreset;onSave:(p:TeamPreset)=>Promise<unknown>;onCancel:()=>void;saveLabel?:string}){
 const [draft,setDraft]=useState(()=>structuredClone(value)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[positions,setPositions]=useState<Record<string,{x:number;y:number}>>({}),[page,setPage]=useState('members'),[selected,setSelected]=useState(value.entry);const editorId=useId();
 useDraft(JSON.stringify(draft)!==JSON.stringify(value),()=>setDraft(structuredClone(value)));
 const change=(update:Partial<TeamPreset>)=>setDraft(p=>({...p,...update}));
 function addMember(point?:{x:number;y:number}){
  if(draft.members.length>=12)return;
  const key='member-'+newId().slice(0,8);
  if(point)setPositions(previous=>({...previous,[key]:point}));
  change({members:[...draft.members,{key,label:tr("成员 ")+(draft.members.length+1),prompt:'',targets:[],operations:['send','read','wait']}]});
  setSelected(key);
 }
 function removeMember(key:string){
  if(draft.members.length===1)return;
  const members=draft.members.filter(m=>m.key!==key).map(m=>({...m,targets:m.targets.filter(target=>target!==key)}));
  const entry=draft.entry===key?members[0]!.key:draft.entry;
  change({members,entry});
  if(selected===key)setSelected(entry);
 }
 const team:Team={id:draft.id,title:draft.name,anchor:draft.entry,configuration:{preset:draft,bindings:Object.fromEntries(draft.members.map(m=>[m.key,m.key])),contextRevision:0,modified:false},cwd:'',paused:false,layout:draft.layout,order:draft.members.map(m=>m.key),hidden:[],sizes:[50,50],graph:positions,members:draft.members.map(m=>({...(m.incidents?{incidents:m.incidents}:{}),...(m.native?{native:m.native}:{}),...(m.soul?{soul:m.soul}:{}),sessionId:m.key,label:m.label,slot:m.key,prompt:m.prompt,owned:false,targets:m.targets,operations:m.operations,autoLink:false}))};
 const perform:Injected['perform']=async data=>{if(data.action==='graph-position'){setPositions(p=>({...p,[String(data.sessionId)]:{x:Number(data.x),y:Number(data.y)}}));return;}if(data.action==='graph-arrange'){setPositions({});return;}
  setDraft(p=>({...p,members:p.members.map(m=>{if(data.action==='connection'&&m.key===data.source)return {...m,targets:data.enabled?[...new Set([...m.targets,String(data.target)])]:m.targets.filter(k=>k!==data.target)};
   if(m.key!==data.sessionId)return m;if(data.action==='member-incidents')return {...m,incidents:{...m.incidents,[String(data.setting)]:Boolean(data.enabled)}};if(data.action==='rename')return {...m,label:String(data.title)};if(data.action==='member-native'){const next={...m};const native=data.native as NonNullable<Member['native']>;if(Object.keys(native).length)next.native=native;else delete next.native;return next;}if(data.action==='member-soul')return {...m,soul:data.soul as NonNullable<Member['soul']>};if(data.action==='member-prompt')return {...m,prompt:String(data.prompt)};if(data.action==='operation')return {...m,operations:data.enabled?[...new Set([...m.operations,data.operation as Member['operations'][number]])]:m.operations.filter(op=>op!==data.operation)};return m;})}));
 };
 return <div className="td-template-editor" data-preset-editor="">
  <div className="td-template-heading"><div className="td-template-breadcrumb"><Button size="sm" aria-label={tr("返回")} onClick={()=>draftGuard.request(onCancel)}><IconChevronLeftOutlineRegular size={16}/><span>{tr("返回")}</span></Button><span className="td-heading-divider" aria-hidden="true"/><h3>{saveLabel===tr("保存并应用")?tr("编辑当前配置"):tr("编辑团队预设")}</h3></div><Button variant="primary" disabled={busy} onClick={()=>{setError('');setBusy(true);Promise.resolve().then(()=>{const cleaned={...draft,...(draft.coordination?{coordination:{...draft.coordination,routes:draft.coordination.routes?.filter(r=>draft.members.some(m=>m.key===r.from&&m.targets.includes(r.to)))}}:{})};validatePreset(cleaned);return onSave(cleaned);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{busy?tr("正在保存…"):saveLabel}</Button></div>
  {error&&<p role="alert" className="td-error">{messageText(error)}</p>}
  <div className="td-template-basics"><label>{tr("预设名称")}<Input aria-label={tr("预设名称")} value={draft.name} maxLength={120} onChange={e=>change({name:e.target.value})}/></label><label>{tr("主成员")}<Select aria-label={tr("主成员")} value={draft.entry} onValueChange={entry=>change({entry})}>{draft.members.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</Select></label><label>{tr("初始排布")}<Select aria-label={tr("初始排布")} value={draft.layout} onValueChange={layout=>change({layout:layout as TeamPreset['layout']})}>{Object.entries(layoutNames).filter(([id])=>id!=='four-columns'||draft.members.length>=4).map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label></div>
  <details className="td-template-description"><summary>{tr("简介")}</summary><textarea aria-label={tr("简介")} rows={2} maxLength={2000} value={draft.description} onChange={e=>change({description:e.target.value})}/></details>
  <SegmentedTabs className="td-editor-sections" size="sm" label={tr("预设编辑页面")} value={page} onChange={setPage} items={[{value:'members',label:tr("成员与关系"),id:editorId+'-members-tab',panelId:editorId+'-members'},{value:'rules',label:tr("规则与变量"),id:editorId+'-rules-tab',panelId:editorId+'-rules'}]}/>
  <div className="td-template-graph-page" role="tabpanel" id={editorId+'-members'} aria-labelledby={editorId+'-members-tab'} hidden={page!=='members'}>
   <Graph key={draft.id} team={team} title={id=>draft.members.find(m=>m.key===id)?.label??id}
    perform={perform} template selection={selected} onSelection={setSelected}
    memberActions={{add:addMember,remove:removeMember,makeEntry:entry=>change({entry})}}/>
  </div>
  <div className="td-template-rules-page" role="tabpanel" id={editorId+'-rules'} aria-labelledby={editorId+'-rules-tab'} hidden={page!=='rules'}><PolicyEditor preset={draft} onChange={setDraft} expanded/></div>
 </div>;
}
export function PresetLibrary({presets,perform}:{presets:TeamPreset[];perform:Injected['perform']}){
 const [editing,setEditing]=useState<TeamPreset>(),[error,setError]=useState(''),[search,setSearch]=useState('');
 const fresh=()=>({...blankPreset(),id:newId(),revision:1,name:tr("新的团队预设"),updatedAt:Date.now()});
 if(editing)return <PresetEditor key={editing.id} value={editing} onCancel={()=>setEditing(undefined)} onSave={async preset=>{await perform({action:'library-save',preset,expected:presets.some(p=>p.id===preset.id)?editing.revision:undefined});setEditing(undefined);}}/>;
 return <div data-team-library=""><div className="td-settings-heading"><div><SectionTitle title={tr("团队预设库")} hint={tr("管理可复用的成员、连接和协作提示词。在左侧“当前会话”中切换并应用预设。")}/></div><Button variant="primary" onClick={()=>setEditing(fresh())}>{tr("新建预设")}</Button></div>
  {error&&<p role="alert">{messageText(error)}</p>}<div className="td-row"><Input aria-label={tr("搜索团队预设")} placeholder={tr("搜索预设")} value={search} onChange={e=>setSearch(e.target.value)}/><label className="td-import">{tr("导入预设")}<input type="file" accept=".json,application/json" onChange={async e=>{try{const file=e.target.files?.[0];if(!file)return;if(file.size>300000)throw Error(tr("预设文件过大"));const p=JSON.parse(await file.text());validatePreset(p);setEditing({...p,id:newId(),revision:1});}catch(err){setError(String(err));}e.target.value='';}}/></label></div>
  <PresetCards presets={presets.filter(p=>(p.name+' '+p.description).toLowerCase().includes(search.toLowerCase()))} onSelect={setEditing} editable actions={p=><><Button size="sm" onClick={()=>setEditing({...structuredClone(p),id:newId(),revision:1,name:p.name+tr(" 副本")})}>{tr("复制")}</Button><Button size="sm" onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(p,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=p.name.replace(/[^\p{L}\p{N}_-]/gu,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>{tr("导出")}</Button><Button size="sm" onClick={()=>{if(window.confirm(tr("从预设库删除「")+p.name+tr("」？正在使用它的团队保留当前配置。")))void perform({action:'library-delete',presetId:p.id,revision:p.revision}).catch(e=>setError(String(e)));}}>{tr("删除")}</Button></>}/>

 </div>;
}
