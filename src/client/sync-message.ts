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
