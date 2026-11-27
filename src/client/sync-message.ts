export interface SyncMessageSource {id:string;sender:string;target:string;body:string;raw:string;}
/** Display only authenticated-shape Team Desk system relays; ordinary/user text keeps the native renderer. */
export function syncMessageSource(content:unknown,source:unknown,sessionId:string):SyncMessageSource|undefined{
 if(!source||typeof source!=='object')return;const s=source as {kind?:unknown;form?:unknown;senderSessionId?:unknown};if(s.kind!=='agent-message'||s.form!=='relay'||!Array.isArray(content))return;
 const raw=content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n'),at=raw.indexOf('\n'),prefix='[Team Desk 同步通知 ';if(at<0||!raw.startsWith(prefix)||raw[at-1]!==']')return;
 try{const m=JSON.parse(raw.slice(prefix.length,at-1));if(m.kind!=='notice'||typeof m.id!=='string'||!m.id||m.sender!==s.senderSessionId||m.target!==sessionId||typeof m.sender!=='string')return;return{id:m.id,sender:m.sender,target:m.target,body:raw.slice(at+1),raw};}catch{return;}
}
export function displaySyncPath(resource:string,root=''):string{
 const base=root.replace(/[\\/]$/,'');return base&&resource.startsWith(base+'/')?resource.slice(base.length+1):base&&resource.toLowerCase().startsWith((base+'\\').toLowerCase())?resource.slice(base.length+1):resource;
}
export function syncFileName(resource:string):string{return resource.split(/[\\/]/).filter(Boolean).at(-1)??resource;}

export function syncChangeLanguage(content:string):'diff'|'text' {
 return /^(?:@@ |diff --git |[+-])/m.test(content) ? 'diff' : 'text';
}

function unifiedRange(start:number,end:number) {
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start-1)return;
 const count=end-start+1;
 if(count===0)return {range:`${start-1},0`,lines:undefined};
 if(count===1)return {range:String(start),lines:String(start)};
 return {range:`${start},${count}`,lines:`${start}–${end}`};
}

/** Read the ledger's original line ranges for display and preserve a native hunk for copying. */
export function legacySyncDiff(diff:string) {
 const match=/^@@ 旧 (\d+)–(\d+) \/ 新 (\d+)–(\d+) @@(?=\r?\n|$)/.exec(diff);
 if(!match)return;
 const before=unifiedRange(Number(match[1]),Number(match[2]));
 const after=unifiedRange(Number(match[3]),Number(match[4]));
 if(!before||!after)return;
 return {code:`@@ -${before.range} +${after.range} @@`+diff.slice(match[0].length),before:before.lines,after:after.lines};
}
