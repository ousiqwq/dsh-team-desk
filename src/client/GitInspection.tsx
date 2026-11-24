import {useCallback,useEffect,useState,useSyncExternalStore} from 'react';
import {Button,CodeBlock,Switch,Tag} from '@deepseek-ai/dsh-client-ui-primitives';
import type {ConfigForm,ConfigFormSnapshot} from '@deepseek-ai/dsh-client-ui-settings/client';
import type {GitProposal} from '../domain/git/types.ts';
import type {LfsFile} from '../domain/git/inspection.ts';
import {Help,SectionTitle} from './ui.tsx';
import {tr,messageText} from './locale.ts';
type Load=(action:string,options:Record<string,unknown>,signal?:AbortSignal)=>Promise<unknown>;
interface Comparison {sourceSha:string;targetSha:string;patch:string;}
export function ProposalComparison({proposal,load}:{proposal:GitProposal;load:Load}){
 const [value,setValue]=useState<Comparison>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 // The parent keys this by actor, project, proposal and revision: never show another comparison's result.
 return <div data-proposal-comparison=""><Button size="sm" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setValue(await load('compare',{proposalId:proposal.id,expected:proposal.revision}) as Comparison);}catch(e){setError(String(e));}finally{setBusy(false);}}}>{tr('比较准确提交')}</Button>{error&&<p role="alert">{messageText(error)}</p>}{value&&<details open><summary><code>{value.targetSha.slice(0,12)} → {value.sourceSha.slice(0,12)}</code></summary><div className="td-pinned-shas"><code>{value.targetSha}</code><code>{value.sourceSha}</code></div>{value.patch?<CodeBlock code={value.patch} lang="diff" diff copyLabel={tr('复制')} copiedLabel={tr('已复制')}/>:<p>{tr('这两个提交在当前项目范围内没有差异')}</p>}</details>}</div>;
}
export function LfsInspection({load}:{load:Load}){
 const [value,setValue]=useState<{files:LfsFile[];omitted:number;scanned:number}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const labels={pointer:'仅有 LFS 指针',materialized:'实体内容已核验',modified:'本地内容与指针不一致',missing:'本地文件缺失',unsafe:'链接或非普通文件',unchecked:'未核验实体内容'};
 return <article className="td-card" data-lfs-inspection=""><SectionTitle title="Git LFS" hint={tr('按当前索引读取 LFS 指针，校验本地实体的大小和 SHA-256；不下载资源，不执行清理或转换过滤器。超过读取上限时明确显示未核验。')} actions={<Button size="sm" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{setValue(await load('lfs',{}) as typeof value);}catch(e){setError(String(e));}finally{setBusy(false);}}}>{tr('检查 LFS 状态')}</Button>}/>{error&&<p role="alert">{messageText(error)}</p>}{value&&<>{!value.files.length&&<p>{tr('本次扫描未发现 LFS 指针')}</p>}{value.files.map(file=><div className="td-lfs-file" key={file.path}><strong>{file.path}</strong><Tag>{tr(labels[file.state])}</Tag><small>{file.size.toLocaleString()} bytes</small><code title={file.oid}>{file.oid.slice(0,16)}</code></div>)}{value.omitted>0&&<p role="status">{tr('扫描已达到上限，部分文件未检查')}</p>}</>}</article>;
}
const empty:ConfigFormSnapshot<Record<string,unknown>>={status:'unavailable',value:undefined,base:undefined,user:undefined,revision:undefined,writable:false};
export function WorktreeRetention({form}:{form:ConfigForm<Record<string,unknown>>|undefined}){
 const view=useSyncExternalStore(useCallback(f=>form?.subscribe(f)??(()=>{}),[form]),useCallback(()=>form?.getSnapshot()??empty,[form])),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>setError(''),[form]);
 return <article className="td-card" data-worktree-retention=""><SectionTitle title={tr('原生工作树归档留存')} hint={tr('与 DSH 的 worktree 设置同步，作用于整个当前配置档案。开启后，归档原生会话时保留其工作树；关闭后由 DSH 判断清理干净且未被引用的工作树。团队记录归档不删除工作树。')}/>{view.status!=='ready'?<p>{tr('此宿主未提供对应的原生设置')}</p>:<div className="td-preference"><span>{tr('归档会话时保留工作树')}</span><Switch label={tr('归档会话时保留工作树')} checked={view.value?.retainOnArchive===true} disabled={busy||!view.writable} onChange={async value=>{setBusy(true);setError('');try{if(!await form!.mutate([{op:'set',path:['retainOnArchive'],value}],view.revision))throw Error(tr('DSH 未接受本次设置，请检查其他编辑或原生配置覆盖后重新读取。'));}catch(e){setError(String(e));}finally{setBusy(false);}}}/></div>}{error&&<p role="alert">{messageText(error)}</p>}</article>;
}
