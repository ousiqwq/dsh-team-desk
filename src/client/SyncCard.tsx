import {type CSSProperties, useEffect, useMemo, useState} from 'react';
import {Button, CodeBlock, DisclosureRow, IconChevronRightOutlineRegular, useClipboardCopy} from '@deepseek-ai/dsh-client-ui-primitives';
import type {ChangeNotice, Message} from '../domain/types.ts';
import {legacySyncReference, type SyncDetail, type SyncDeliveryHint, type SyncReason} from '../domain/sync-summary.ts';
import {deliveryTotals, type DeliveryGroup} from './sync-delivery-group.ts';
import {fileEntries, fileReceipt, type FileEntry, type FileReceipt} from './sync-record-list.ts';
import {legacySyncDiff, syncChangeLanguage, syncFileName, type SyncMessageSource} from './sync-message.ts';
import {tr, localeId} from './locale.ts';

const operationLabel = (op: ChangeNotice['operation']) => tr(({create:'新增', update:'修改', delete:'删除', rename:'重命名', observe:'变更'} as const)[op ?? 'observe']);
const reasonLabel = (r: SyncReason) => tr(({subscription:'已读或订阅', working:'正在处理此资源', owner:'子代理所属成员'} as const)[r]);
const pageSize = 8;
type Labels = Readonly<Record<string,string>>;

function Code({code, lang = 'text'}: {code:string; lang?:string}) {
 const preview=lang==='diff' ? legacySyncDiff(code) : undefined;
 const block=<CodeBlock className="td-sync-code" code={preview?.code??code} lang={lang}
  copyLabel={tr('复制')} copiedLabel={tr('已复制')}/>;
 if(!preview)return block;
 const lineRange=[
  preview.before ? tr('旧第 {p0} 行',{p0:preview.before}) : tr('旧版无对应行'),
  preview.after ? tr('新第 {p0} 行',{p0:preview.after}) : tr('新版无对应行'),
 ].join(' → ');
 // Native CodeBlock copies the original pre text, including the normalized hunk.
 return <div className="td-sync-code-range" style={{'--td-sync-line-range':JSON.stringify(lineRange)} as CSSProperties}>{block}</div>;
}
function OriginalMessage({message}: {message: SyncMessageSource}) {
 const {copied, onCopy} = useClipboardCopy(message.raw);
 return <section className="td-sync-box td-sync-source" data-team-sync={message.id}>
  <div className="td-sync-banner"><strong>{tr('来源与原始消息')}</strong><Button size="sm" onClick={onCopy}>{copied ? tr('已复制') : tr('复制')}</Button></div>
  <div className="td-sync-raw" role="region" aria-label={tr('来源与原始消息')} tabIndex={0}>
   <dl><dt>{tr('发送会话')}</dt><dd>{message.sender}</dd><dt>{tr('接收会话')}</dt><dd>{message.target}</dd><dt>{tr('消息 ID')}</dt><dd>{message.id}</dd></dl>
   <pre>{message.raw}</pre>
  </div>
 </section>;
}

function SyncHeading({title, time, count, from, to, file, sourceCount, children}: {
 title:string; time:number; count:number|undefined; from:string; to:string; file?:string|undefined; sourceCount?:number; children:React.JSX.Element;
}) {
 const [open, setOpen] = useState(false);
 const date = new Date(time);
 return <DisclosureRow className="td-sync-disclosure" rowClassName="td-sync-header-row" chevronClassName="td-sync-chevron"
  title={title} open={open} onToggle={()=>setOpen(!open)} expandable expandOnRowClick previewChevron={false} keepContentWhenOpen
  icon={<svg data-td-sync-icon aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
   <rect x="1.7" y="2.1" width="5.7" height="4.6" rx="1.25"/><rect x="12.6" y="13.3" width="5.7" height="4.6" rx="1.25"/>
   <path d="M9.5 4.4h3.9a2 2 0 0 1 2 2v3.3m-2-2 2 2 2-2M10.5 15.6H6.6a2 2 0 0 1-2-2v-3.3m2 2-2-2-2 2"/>
  </svg>}
  collapsedContent={<span className="td-sync-caption">
   {count!==undefined && <span className="td-sync-count">{tr('{p0} 条变更',{p0:count})}</span>}
   <span className="td-sync-route" title={from+' → '+to}>{!open && sourceCount && sourceCount>3 ? tr('{p0} 个来源',{p0:sourceCount}) : from} → {to}</span>
   {file && <span className="td-sync-file-preview" title={file}>{syncFileName(file)}</span>}
   <time className="td-sync-clock" dateTime={date.toISOString()} title={date.toLocaleString(localeId())}>{date.toLocaleTimeString(localeId(),{hour:'2-digit',minute:'2-digit'})}</time>
  </span>}>
  {open && children}
 </DisclosureRow>;
}

/** Each expanded panel owns its requests. Siblings on the same receipt page share one read. */
function makeReader() {
 let abort = new AbortController();
 const pages = new Map<string, Promise<SyncDetail>>();
 return {
  read(message:SyncMessageSource, cursor:number, listOnly=false) {
   if (abort.signal.aborted) abort = new AbortController();
   const {signal} = abort;
   const key = JSON.stringify([message.target,message.id,cursor,listOnly]);
   let page = pages.get(key);
   if (!page) {
    const params = new URLSearchParams({sessionId:message.target,messageId:message.id,cursor:String(cursor),limit:String(pageSize)});
    if(listOnly)params.set('view','files');
    page = fetch('/api/team-desk.sync-summary?'+params,{signal,cache:'no-store'}).then(async response=>{
     const value = await response.json();
     if (!response.ok) throw Error(value.error ?? tr('同步详情暂时不可用'));
     if (value.messageId!==message.id || value.target!==message.target || value.sender!==message.sender) throw Error(tr('同步记录与当前消息不一致'));
     return value as SyncDetail;
    }).catch(error=>{if (!signal.aborted) pages.delete(key); throw error;});
    pages.set(key,page);
   }
   return page;
  },
  close(){abort.abort();pages.clear();}
 };
}
type Reader = ReturnType<typeof makeReader>;
function usePage(reader: Reader, message: SyncMessageSource, cursor:number, needed:boolean,listOnly=false) {
 const [detail,setDetail] = useState<SyncDetail>(), [error,setError] = useState(''), [attempt,setAttempt] = useState(0);
 const {id,target,sender} = message;
 useEffect(()=>{
  if (!needed) return;
  let current=true;
  reader.read(message,cursor,listOnly).then(page=>{if(current)setDetail(page);},e=>{if(current)setError(String(e));});
  return ()=>{current=false;};
 },[reader,id,target,sender,cursor,needed,attempt,listOnly]);
 return {detail,error,retry:()=>{setError('');setAttempt(n=>n+1);}};
}
function ReadStatus({page}: {page:ReturnType<typeof usePage>}) {
 if (page.detail) return null;
 return page.error ? <div role="alert" className="td-sync-note">{tr('同步详情暂时不可用')} <Button size="sm" title={page.error} onClick={page.retry}>{tr('重试')}</Button></div>
  : <div role="status" className="td-sync-note">{tr('正在读取同步详情…')}</div>;
}
function ChangeBody({change:c,name,reasons}: {change:ChangeNotice; name:string; reasons:SyncReason[]|undefined}) {
 return <section className="td-sync-box td-sync-change-scroll" role="region" aria-label={tr('文件与协作同步')} tabIndex={0}>
  <dl className="td-sync-meta"><dt>{tr('操作')}</dt><dd>{operationLabel(c.operation)}</dd><dt>{tr('完整路径')}</dt><dd>{c.resource}</dd>
   {c.previousResource&&<><dt>{tr('原路径')}</dt><dd>{c.previousResource}</dd></>}
   <dt>{tr('前版本')}</dt><dd>{c.beforeVersion??tr('未记录')}</dd><dt>{tr('记录版本')}</dt><dd>{c.version}</dd>
   <dt>{tr('来源')}</dt><dd>{name} · {c.origin==='native-file'?tr('原生工具观察'):tr('成员报告，尚未核实')}
    {c.evidence?.length ? <ul className="td-sync-evidence">{[...new Set(c.evidence)].map(e=><li key={e}>{e}</li>)}</ul> : null}
   </dd>
   {reasons?.length ? <><dt>{tr('接收原因')}</dt><dd>{reasons.map(reasonLabel).join(' / ')}</dd></> : null}
   {c.provenance?.actorSessionId&&<><dt>{tr('实际执行会话')}</dt><dd>{c.provenance.actorSessionId}</dd></>}
   {c.afterHash&&<><dt>SHA-256</dt><dd>{c.afterHash}</dd></>}<dt>{tr('记录 ID')}</dt><dd>{c.id}</dd></dl>
  {c.diff&&<><Code code={c.diff} lang={syncChangeLanguage(c.diff)}/>{c.truncated&&<div className="td-sync-meta">{tr('此处为差异摘要，完整内容请查原生记录。')}</div>}</>}
 </section>;
}
function FileRow({entry, reader, single, labels, scope}: {entry:FileEntry; reader:Reader; single:boolean; labels:Labels;scope?:string|undefined}) {
 const [open,setOpen]=useState(false);
 const {receipt,id,index}=entry, {message}=receipt;
 const preview=receipt.summary?.preview.find(c=>c.id===id);
 const heading=preview??receipt.hint?.files?.find(c=>c.id===id);
 const cursor=Math.floor(index/pageSize)*pageSize;
 const page=usePage(reader,message,cursor,single||open);
 const list=usePage(reader,message,cursor,!heading&&!single&&!open,true);
 const listed=heading??list.detail?.items.find(c=>c.id===id);
 const summary=page.detail?.summary??receipt.summary, change=page.detail?.items.find(c=>c.id===id);
 const resource=change?.resource??listed?.resource;
 const source=preview?.label??receipt.hint?.author??summary?.authors.find(a=>a.id===(change?.author??message.sender))?.label??labels[message.sender]??message.sender;
 const operation=operationLabel(change?.operation??listed?.operation);
 const body=<div className="td-sync-details">
  {change ? <ChangeBody change={change} name={source} reasons={summary?.receivedBecause?.[id]}/>
   : page.detail ? <p className="td-sync-note">{tr('{p0} 条原始变更记录暂不可读取，未用当前状态替代。',{p0:1})} {resource??id}</p>
   : <ReadStatus page={page}/>}
  {entry.originals.map(m=><OriginalMessage key={m.id} message={m}/>)}
 </div>;
 return <div data-sync-record={id}>
  {single ? body : <DisclosureRow title={operation} icon={<IconChevronRightOutlineRegular/>} previewChevron={false}
   className="td-sync-disclosure" chevronClassName="td-sync-chevron" expandable expandOnRowClick keepContentWhenOpen open={open} onToggle={()=>setOpen(!open)}
   collapsedContent={<span className="td-sync-filename" title={[source,resource??id].join(' · ')}>{scope && <>{scope} · </>}{resource ? syncFileName(resource) : id}</span>}>
   {open && body}
  </DisclosureRow>}
 </div>;
}
function Files({receipts, reader, labels}: {receipts:readonly FileReceipt[];reader:Reader;labels:Labels}) {
 const entries=useMemo(()=>fileEntries(receipts),[receipts]);
 const [limit,setLimit]=useState(pageSize);
 const single=entries.length===1;
 const scopes=new Set(receipts.map(r=>r.hint?.ledgerScope??(r.summary?JSON.stringify([r.summary.scope.teamId,r.summary.scope.projectId]):r.hint?.scope)));
 return <div className={single?'td-sync-single':'td-sync-branches'}>
  {receipts.some(r=>r.summary?.incomplete) && <p className="td-sync-note">{tr('包含旧版摘要，未记录的文件明细无法据序号恢复。')}</p>}
  {entries.slice(0,limit).map(entry=><FileRow key={entry.id} entry={entry} reader={reader} single={single} labels={labels} scope={scopes.size>1?(entry.receipt.hint?.scopeLabel??entry.receipt.summary?.scope.name):undefined}/>)}
  {entries.length>limit&&<Button size="sm" onClick={()=>setLimit(n=>n+pageSize)}>{tr('显示更多变更')} ({entries.length-limit})</Button>}
 </div>;
}
function OtherReceipt({receipt,reader,labels}: {receipt:FileReceipt;reader:Reader;labels:Labels}) {
 const {message}=receipt, page=usePage(reader,message,0,true), detail=page.detail;
 const legacy=legacySyncReference(message.body);
 if (detail?.summary?.recordIds.length) return <Files receipts={[{...receipt,summary:detail.summary}]} reader={reader} labels={labels}/>;
 return <div className="td-sync-single td-sync-details"><ReadStatus page={page}/>
  {detail?.shared && <div className="td-sync-box td-sync-change-scroll"><div className="td-sync-meta"><strong>{detail.shared.key} · v{detail.shared.revision}</strong><p>{detail.shared.reason}</p></div><Code code={JSON.stringify(detail.shared.value,null,2)} lang="json"/></div>}
  {detail?.items.map(c=><ChangeBody key={c.id} change={c} name={labels[c.author]??c.author} reasons={detail.summary?.receivedBecause?.[c.id]}/>)}
  {legacy.resource && !detail?.items.length && <p className="td-sync-note">{legacy.resource} · {legacy.version??tr('未记录')}</p>}
  {detail?.kind==='legacy-summary' && <p className="td-sync-note">{tr('旧版摘要只保存了序号范围，无法准确还原完整文件清单。')}</p>}
  {detail?.summary?.incomplete && <p className="td-sync-note">{tr('包含旧版摘要，未记录的文件明细无法据序号恢复。')}</p>}
  {!!detail?.missing && <p className="td-sync-note">{tr('{p0} 条原始变更记录暂不可读取，未用当前状态替代。',{p0:detail.missing})}</p>}
  <OriginalMessage message={message}/>
 </div>;
}
function Contents({receipts,labels}: {receipts:readonly FileReceipt[];labels:Labels}) {
 const [reader]=useState(makeReader);
 useEffect(()=>()=>reader.close(),[reader]);
 const first=receipts[0]!;
 return receipts.length>1||first.summary?.recordIds.length||first.hint?.recordIds.length
  ? <Files receipts={receipts} reader={reader} labels={labels}/>
  : <OtherReceipt receipt={first} reader={reader} labels={labels}/>;
}
export function SyncCard(props: {message:SyncMessageSource;labels:Labels;stored:Message|undefined;hint?:SyncDeliveryHint|undefined;time:number;phase:'context'|'turn-trigger'}) {
 const {message,labels,time,phase}=props,receipt=fileReceipt(props),{summary,hint}=receipt;
 const legacy=legacySyncReference(message.body), count=summary?.recordIds.length||hint?.recordIds.length||(legacy.record&&!legacy.key?1:undefined);
 const authors=summary?.authors.map(a=>a.label).join('、')||hint?.author||labels[message.sender]||message.sender;
 const path=count===1 ? summary?.preview[0]?.resource??hint?.files?.[0]?.resource??legacy.resource : undefined;
 return <div className="td-sync" data-sync-phase={phase} data-sync-target={message.target}>
  <SyncHeading title={legacy.key?tr('共享约定同步'):tr('团队同步')} time={time} count={count} from={authors} to={labels[message.target]??message.target} file={path??legacy.key}>
   <Contents receipts={[receipt]} labels={labels}/>
  </SyncHeading>
 </div>;
}
export function SyncDeliveryCard({group,labels}: {group:DeliveryGroup;labels:Labels}) {
 const first=group[0]!;
 const {count,sources}=useMemo(()=>deliveryTotals(group),[group]);
 const receipts=useMemo(()=>group.map(fileReceipt),[group]);
 const authors=sources.map(s=>sources.length===1?s.name:s.name+' ×'+s.count).join(' · ');
 return <div className="td-sync" data-td-sync-delivery={first.message.id}>
  <SyncHeading title={tr('团队同步')} time={first.time} count={count} sourceCount={sources.length} from={authors} to={labels[first.message.target]??first.message.target}>
   <Contents receipts={receipts} labels={labels}/>
  </SyncHeading>
 </div>;
}
