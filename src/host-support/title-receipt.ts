import {createHash as tdDigest} from 'node:crypto';
import {existsSync as tdExists} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {join as tdJoin} from 'node:path';
import {homedir as tdHome} from 'node:os';
import {teamTitleMessage} from './session-title-input.ts';

// Receipts contain no message text. The filename binds the native source, destination,
// stable input ID and exact content. They survive plugin disable and ledger archival.
function receipt(target:string,sender:string,id:string,text:string){
 const hash=tdDigest('sha256').update(JSON.stringify([target,sender,id,text])).digest('hex');
 const directory=tdJoin(process.env.DSH_HOME??tdJoin(tdHome(),'.dsh'),'team-title-sources',hash.slice(0,2));
 return {directory,path:tdJoin(directory,hash.slice(2))};
}
export async function rememberTitleRequest(target:string,sender:string,id:string,text:string){
 const {directory,path}=receipt(target,sender,id,text);
 await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(path,'',{mode:0o600});
}
export function tdVerifiedTask(event:any,target:string){
 if(!target||event?.type!=='user/message'||event.data?.source?.kind!=='agent-message')return;
 const task=teamTitleMessage(event,target),data=event.data;
 if(task&&data.content.length===1&&tdExists(receipt(target,data.source.senderSessionId,data.id,data.content[0].text).path))return task;
}
