import {useDraft} from './use-draft.ts';
import {draftGuard} from './draft-guard.ts';
import {Select} from './Select.tsx';
import {Help,SectionTitle} from './ui.tsx';
import {tr, messageText} from './locale.ts';
import {newId} from './id.ts';
import {useState,type ReactNode} from 'react';
import {Button,Switch} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Team,TeamPreset} from '../domain/types.ts';
import type {Injected} from './contracts.ts';
import {presetFromTeam} from '../domain/preset-library.ts';
import {PresetCards,MiniGraph,PresetEditor} from './PresetLibrary.tsx';
import {tileDock,mirrorDock,dockRects,dockIds} from '../domain/docking.ts';

function initialBindings(team:Team,preset:TeamPreset):Record<string,string>{
 const saved=team.bindingHistory?.[preset.id]??{},used=new Set<string>(),result:Record<string,string>={};
 for(const m of preset.members){const id=saved[m.key];if(id&&team.members.some(m=>m.sessionId===id)&&!used.has(id)){result[m.key]=id;used.add(id);}}
 if(!used.has(team.anchor)){const key=preset.entry;result[key]=team.anchor;}
 return result;
}
export function TeamSwitch({team,presets,perform,title,notify}:{notify:(text:string)=>void;team:Team;presets:TeamPreset[];perform:Injected['perform'];title:(id:string)=>string}){
 const [selected,setSelected]=useState<TeamPreset>(),[bindings,setBindings]=useState<Record<string,string>>({}),[applyLayout,setApplyLayout]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[requestId,setRequestId]=useState(()=>newId());
 useDraft(!!selected,()=>setSelected(undefined));
 const choose=(p:TeamPreset)=>draftGuard.request(()=>{setRequestId(newId());setSelected(structuredClone(p));setBindings(initialBindings(team,p));setError('');});
 return <div data-team-switch=""><SectionTitle title={tr("为当前会话切换团队预设")} hint={tr("应用后成员、角色、人设、权限及协作规则整体生效，后续通过正常对话分工，无需再次启动。")}/>
  {error&&<p className="td-error" role="alert">{messageText(error)}</p>}
  <PresetCards presets={presets} {...(selected?{selected:selected.id}:{})} onSelect={choose}/>
  {selected&&<section className="td-card" data-preset-binding=""><h3>{tr("{p0} · 会话绑定", {p0: selected.name})}</h3><div className="td-binding-grid">{selected.members.map(m=><label key={m.key}>{m.label}{m.key===selected.entry?tr(" · 主成员"):''}<Select aria-label={tr("绑定 ")+m.label} value={bindings[m.key]??''} onValueChange={e=>{setBindings(b=>({...b,[m.key]:e}));setRequestId(newId());}}><option value="">{tr("新建原生会话")}</option>{team.members.map(peer=><option key={peer.sessionId} value={peer.sessionId} disabled={Object.entries(bindings).some(([key,id])=>key!==m.key&&id===peer.sessionId)}>{peer.sessionId===team.anchor?tr("主会话 · "):''}{title(peer.sessionId)}{peer.active===false?tr(" · 保留会话"):''}</option>)}</Select></label>)}</div>
    <details><summary>{tr("查看本预设的协作提示词")}</summary>{selected.members.map(m=><div key={m.key}><h3>{m.label}</h3><pre>{m.prompt||tr("不注入分工提示词")}</pre></div>)}</details>
    <div className="td-preference"><div><strong>{tr("同时应用预设排布")}</strong><Help text={tr("关闭时保留现有排布；新成员从左侧拖入显示。")}/></div><Switch label={tr("同时应用预设排布")} checked={applyLayout} onChange={v=>{setApplyLayout(v);setRequestId(newId());}}/></div>
    <Button variant="primary" disabled={busy||!Object.values(bindings).includes(team.anchor)} onClick={()=>{setBusy(true);setError('');void perform({action:'team-apply',teamId:team.id,presetId:selected.id,revision:selected.revision,bindings,applyLayout,requestId}).then(result=>{notify((result as {pending:boolean}).pending?tr("已排队，等待当前回合结束后切换。"):tr("已应用，团队已就绪。可以直接发送任务。"));setSelected(undefined);}).catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{tr("应用到当前团队")}</Button>
  </section>}
 </div>;
}
export function CurrentConfiguration({team,perform,onEditing,actions,notify}:{notify:(text:string)=>void;actions?:ReactNode;team:Team;perform:Injected['perform'];onEditing:(editing:boolean)=>void}){
 const [editing,setEditing]=useState<TeamPreset>(),[editingRevision,setEditingRevision]=useState(0);
 const current=presetFromTeam(team);
 if(editing)return <PresetEditor value={editing} saveLabel={tr("保存并应用")} onCancel={()=>{setEditing(undefined);onEditing(false);}} onSave={async preset=>{const bindings=Object.fromEntries(team.members.filter(m=>m.active!==false).map((m,i)=>[m.slot??`member-${i+1}`,m.sessionId]).filter(([key])=>preset.members.some(m=>m.key===key)));await perform({action:'team-configure',teamId:team.id,preset,bindings,expected:editingRevision});setEditing(undefined);onEditing(false);notify(tr('当前配置已保存'));}}/>;
 return <div className="td-current-summary"><div className="td-row"><div><strong>{team.configuration?.preset.name??tr("自定义团队")}</strong><span className="td-badge">{team.configuration?`v${team.configuration.preset.revision}${team.configuration.modified?tr(" · 已自定义"):''}`:tr("尚未保存为预设")}</span></div><Button variant="outline" size="sm" onClick={()=>draftGuard.request(()=>{setEditing(current);setEditingRevision(team.configuration?.contextRevision??0);onEditing(true);})}>{tr("编辑当前配置")}</Button><Button size="sm" onClick={()=>{void perform({action:'library-save',preset:{...current,id:newId(),revision:1,name:current.name+tr(" 副本")}}).then(()=>notify(tr("已另存到全局团队预设库"))).catch(e=>notify(messageText(e)));}}>{tr("另存为预设")}</Button>{actions}</div></div>;
}
export function LayoutSettings({team,perform,title}:{team:Team;perform:Injected['perform'];title:(id:string)=>string}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),ids=team.order.filter(id=>!team.hidden.includes(id)),tree=team.dock===undefined?tileDock(ids,team.layout):team.dock;
 async function apply(dock:typeof tree){setBusy(true);setError('');try{await perform({action:'dock-restore',teamId:team.id,dock,hidden:team.hidden});}catch(e){setError(String(e));}finally{setBusy(false);}}
 const shapes:{name:string;tree:typeof tree}[]=ids.length===2?[{name:tr("左右并排"),tree:tileDock(ids,'columns')},{name:tr("上下并排"),tree:tileDock(ids,'rows')}]:ids.length===3?[
  {name:tr("左一右二"),tree:tileDock(ids,'columns')?{axis:'x',ratio:50,first:{id:ids[0]!},second:tileDock(ids.slice(1),'rows')!}:null},
  {name:tr("左二右一"),tree:{axis:'x',ratio:50,first:tileDock(ids.slice(0,2),'rows')!,second:{id:ids[2]!}}},
  {name:tr("上一下二"),tree:{axis:'y',ratio:50,first:{id:ids[0]!},second:tileDock(ids.slice(1),'columns')!}},
  {name:tr("上二下一"),tree:{axis:'y',ratio:50,first:tileDock(ids.slice(0,2),'columns')!,second:{id:ids[2]!}}}
 ]:ids.length>3?[{name:tr("均匀网格"),tree:tileDock(ids,'grid')},{name:tr("横向排列"),tree:tileDock(ids,'columns')},{name:tr("纵向排列"),tree:tileDock(ids,'rows')}]:[];
 return <div><h3>{tr("当前窗口排布 ·{p0} 个窗格", {p0: ids.length})}</h3><Help text={tr("拖到窗格中央交换位置，拖到整个对话区边缘改变整体排布。将分隔线拖到边缘可以收起一个窗格。")}/>{error&&<p role="alert">{messageText(error)}</p>}<div className="td-layout-options">{shapes.map(shape=><button key={shape.name} className="td-layout-option" disabled={busy} onClick={()=>void apply(shape.tree)}><span>{shape.name}</span><svg viewBox="0 0 100 100">{Object.values(dockRects(shape.tree??null).panes).map((r,i)=><rect key={i} x={r.x+2} y={r.y+2} width={r.width-4} height={r.height-4} rx="3"/>)}</svg></button>)}</div><div className="td-row"><Button disabled={busy||ids.length<2} onClick={()=>void apply(mirrorDock(tree??null,'x'))}>{tr("左右镜像")}</Button><Button disabled={busy||ids.length<2} onClick={()=>void apply(mirrorDock(tree??null,'y'))}>{tr("上下镜像")}</Button><Button disabled={busy||ids.length<2} onClick={()=>{const reset=(n:NonNullable<typeof tree>):NonNullable<typeof tree>=>'id'in n?n:{...n,ratio:50,first:reset(n.first),second:reset(n.second)};if(tree)void apply(reset(tree));}}>{tr("重置分隔比例")}</Button></div>
 <h3 className="td-spaced">{tr("已收起的窗格")}</h3>{!team.hidden.length&&<p className="td-muted">{tr("没有收起的窗格。")}</p>}{team.hidden.map(id=><div key={id} className="td-row"><span className="td-ellipsis">{title(id)}</span><Button size="sm" onClick={()=>void perform({action:'dock',teamId:team.id,sessionId:id,zone:'right'}).catch(e=>setError(String(e)))}>{tr("恢复显示")}</Button></div>)}</div>;
}
