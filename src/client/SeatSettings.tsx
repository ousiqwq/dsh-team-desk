import {useEffect,useState} from 'react';
import {RiskConfirmation} from '@deepseek-ai/dsh-client-ui-primitives';
import type {Team,TeamPreset} from '../domain/types.ts';
import {seatSelections,permissionConsent,type SeatSettings} from '../domain/seat-settings.ts';
import type {Injected} from './contracts.ts';
import {Select} from './Select.tsx';
import {tr} from './locale.ts';

interface Choice {id:string;name:string}
const modeLabels:Record<string,string>={standard:'标准模式',ptc:'PTC 模式',minimal:'极简模式',cordis:'创造模式'};
const permissionLabels:Record<string,string>={'read-only':'仅可查看','workspace-write':'工作区内修改',auto:'自动审查','danger-full-access':'完全权限'};

export function SeatFields({value,onChange}:{value:SeatSettings|undefined;onChange:(settings:SeatSettings)=>void}){
 const [options,setOptions]=useState<{modes:Choice[];permissions:Choice[]}>(),[failure,setFailure]=useState('');
 useEffect(()=>{
  const controller=new AbortController();
  fetch('/api/team-desk.seat-options',{signal:controller.signal}).then(async response=>{
   if(response.status===404||response.ok&&!response.headers.get('content-type')?.includes('application/json')){
    if(!controller.signal.aborted)setFailure(tr('成员模式和权限将在 DSH 下次启动后可用'));return;
   }
   if(!response.ok)throw Error();const data=await response.json();
   if(!controller.signal.aborted)setOptions(data);
  }).catch(()=>{if(!controller.signal.aborted)setFailure(tr('无法读取 DSH 原生选项'));});
  return ()=>controller.abort();
 },[]);
 if(failure)return <p role="status" className="td-muted">{failure}</p>;
 return <div className="td-form-grid" data-seat-settings="">
  {(['mode','permission'] as const).map(field=>{
   const label=tr(field==='mode'?'DSH 对话模式':'DSH 权限'),selected=value?.[field]??'';
   const choices=(field==='mode'?options?.modes:options?.permissions)??[],labels=field==='mode'?modeLabels:permissionLabels;
   return <label key={field}>{label}<Select aria-label={label} value={selected} disabled={!options} onValueChange={id=>{
    const next={...value};if(id)next[field]=id;else delete next[field];onChange(next);
   }}><option value="">{tr('沿用会话设置')}</option>{selected&&!choices.some(p=>p.id===selected)&&<option value={selected} disabled>{labels[selected]?tr(labels[selected]!):selected}</option>}
   {choices.map(p=><option key={p.id} value={p.id}>{labels[p.id]?tr(labels[p.id]!):p.name}</option>)}</Select></label>;
  })}
 </div>;
}

interface ConsentPrompt {description:string;finish:(ok:boolean)=>void}
export function useSeatConfirmation(team:Team|undefined,presets:TeamPreset[],perform:Injected['perform']){
 const [prompt,setPrompt]=useState<ConsentPrompt>(),[checked,setChecked]=useState(false);
 useEffect(()=>()=>prompt?.finish(false),[prompt]);
 const apply:Injected['perform']=async data=>{
  if(!team||(data.action!=='team-configure'&&data.action!=='team-apply'))return perform(data);
  const edit=data.action==='team-configure',preset=edit?data.preset as TeamPreset:presets.find(p=>p.id===data.presetId);
  if(!preset)return perform(data);
  const seats=seatSelections(team,preset,data.bindings as Record<string,string>,edit),consent=permissionConsent(seats);
  if(!consent)return perform(data);
  const description=seats.filter(s=>['auto','danger-full-access'].includes(s.settings.permission??'')).map(s=>s.label+' · '+tr(permissionLabels[s.settings.permission!]!)).join('、');
  setChecked(false);
  const ok=await new Promise<boolean>(finish=>setPrompt({description,finish}));
  if(!ok)throw Error(tr('已取消应用'));
  return perform({...data,seatConsent:consent});
 };
 const finish=(ok:boolean)=>{prompt?.finish(ok);setPrompt(undefined);};
 const dialog=prompt&&<RiskConfirmation open title={tr('确认成员权限')} description={prompt.description+'。'+tr('自动审查由模型审核工具调用，完全权限可直接执行敏感操作。这两种权限均不使用沙箱。')} acknowledgeLabel={tr('我已了解风险，并愿意继续')} confirmLabel={tr('保存并应用')} cancelLabel={tr('取消')} closeLabel={tr('关闭')} acknowledged={checked} onAcknowledgedChange={setChecked} onConfirm={()=>finish(true)} onCancel={()=>finish(false)}/>;
 return {apply,dialog};
}
