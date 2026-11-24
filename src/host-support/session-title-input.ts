/** Admit only authentic Team Desk task relays; never rewrite their message source. */
export function teamTitleMessage(event:unknown,targetSession?:string):{seq:number;text:string}|undefined {
 if(!event||typeof event!=='object')return;
 const e=event as {type?:unknown;seq?:unknown;data?:{id?:unknown;source?:{kind?:unknown;form?:unknown;senderSessionId?:unknown};content?:unknown}};
 const data=e.data,source=data?.source;
 if(e.type!=='user/message'||!Number.isSafeInteger(e.seq)||Number(e.seq)<0||source?.kind!=='agent-message'||source.form!=='relay'||typeof data?.id!=='string'||!data.id.startsWith('team-desk:')||!Array.isArray(data.content))return;
 const text=data.content.filter(b=>b?.type==='text'&&typeof b.text==='string').map(b=>b.text).join('\n');
 const firstBreak=text.indexOf('\n'),header=text.slice(0,firstBreak),prefix='[Team Desk 成员消息 ';
 if(firstBreak<0||!header.startsWith(prefix)||!header.endsWith(']'))return;
 try {
  const metadata=JSON.parse(header.slice(prefix.length,-1));
  if(!metadata||typeof metadata!=='object'||metadata.kind!=='request'||typeof metadata.id!=='string'||!metadata.id||data.id!=='team-desk:'+metadata.id||typeof metadata.sender!=='string'||!metadata.sender||metadata.sender!==source.senderSessionId||typeof metadata.target!=='string'||!metadata.target||(targetSession!==undefined&&metadata.target!==targetSession))return;
  const body=text.slice(firstBreak+1).trim();if(!body)return;
  return {seq:Number(e.seq),text:body};
 }catch{return;}
}
