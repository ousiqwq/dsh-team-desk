import {useEffect,useRef,useState} from 'react';
import {Button,CodeBlock,Tag} from '@deepseek-ai/dsh-client-ui-primitives';
import type {GitPartialPreview} from '../domain/git/partial.ts';
import {tr,messageText} from './locale.ts';
import {Help} from './ui.tsx';
import {newId} from './id.ts';

export function PartialCommit({paths,head,message,shared,busy,load,commit,onComplete}:{paths:string[];head:string;message:string;shared:boolean;busy:boolean;load:(action:string,options:Record<string,unknown>)=>Promise<unknown>;commit:(action:string,options:Record<string,unknown>)=>Promise<unknown>;onComplete:()=>void}){
 const [preview,setPreview]=useState<GitPartialPreview>(),[chosen,setChosen]=useState<string[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState('');const generation=useRef(0);
 useEffect(()=>{generation.current++;setPreview(undefined);setChosen([]);setError('');setLoading(false);return()=>{generation.current++;};},[JSON.stringify(paths),head]);
 async function reload(){const n=++generation.current;setLoading(true);setError('');setPreview(undefined);setChosen([]);try{const value=await load('partial',{paths}) as GitPartialPreview;if(n===generation.current)setPreview(value);}catch(e){if(n===generation.current)setError(e instanceof Error?e.message:String(e));}finally{if(n===generation.current)setLoading(false);}}
 const hunks=preview?.files.flatMap(f=>f.hunks)??[];
 return <div className="td-partial" data-git-partial=""><div className="td-row"><Button type="button" size="sm" variant="outline" disabled={busy||loading||!paths.length} onClick={()=>void reload()}>{loading?tr('正在读取差异…'):tr('读取所选文件差异')}</Button><Help text={tr('选择要提交的差异块。未选中的修改和其他文件的暂存内容保留；内容或分支改变后请重新读取差异。')}/>{preview&&<Tag>{tr('已选差异块')} {chosen.length}/{hunks.length}</Tag>}</div>
  {error&&<p role="alert" className="td-error">{messageText(error)}</p>}
  {preview&&<div className="td-hunk-list">{preview.files.map(file=><details key={file.path} open className="td-hunk-file"><summary><span>{file.path}</span><Tag>{file.hunks.length}</Tag></summary>{file.unavailable?<p className="td-muted">{messageText(file.unavailable)}</p>:file.hunks.map((h,i)=><div key={h.id} className="td-hunk"><label><input type="checkbox" aria-label={file.path+' · '+tr('差异块')+' '+(i+1)} checked={chosen.includes(h.id)} disabled={busy||loading} onChange={e=>setChosen(old=>e.target.checked?[...old,h.id]:old.filter(id=>id!==h.id))}/><code>{h.heading}</code></label><CodeBlock code={h.patch} lang="diff" diff copyLabel={tr('复制差异')} copiedLabel={tr('已复制')}/></div>)}</details>)}</div>}
  <Button type="button" variant="primary" disabled={busy||loading||!chosen.length||!message.trim()||!preview} onClick={async()=>{if(!preview)return;const value=await commit('commit-hunks',{key:newId(),expectedHead:preview.head,paths:preview.paths,snapshot:preview.snapshot,hunks:chosen,message,shared});if(value){setPreview(undefined);setChosen([]);onComplete();}}}>{tr('提交所选差异块')}</Button>
 </div>;
}
