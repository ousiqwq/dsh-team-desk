import type {SessionEvent} from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-tool-executor-ptc/types';
import {record} from '../domain/storage.ts';
import type {ReviewBlock,RunIssue} from '../domain/types.ts';

/** Use the gate's structured error identity. Tool output alone cannot declare a reviewer failure. */
export class ReviewFailures {
  private seen=new Map<string,RunIssue>();
  private toolsWithErrors=new Map<string,[string,string]>();
  private calls=new Map<string,{tool:string;args:unknown}>();
  private failures=new Map<string,ReviewBlock>();

  private shellErrors=new Map<string,string>();

  observeShell(callId:string, value:unknown){
    if(!record(value) || value.kind!=='foreground')return;
    if(record(value.sandbox) && value.sandbox.denied===true){
      this.shellErrors.set(callId,'shell_sandbox_denied');
    }else if(typeof value.exitCode==='number' && Number.isSafeInteger(value.exitCode) && value.exitCode!==0){
      this.shellErrors.set(callId,'SHELL_EXIT_'+value.exitCode);
    }
  }

  observe(event:SessionEvent){
    if(event.type==='turn/start'){this.shellErrors.clear();this.calls.clear();this.failures.clear();this.toolsWithErrors.clear();this.seen.clear();return;}
    if(event.type==='tool/call'){this.calls.set(event.data.callId,{tool:event.data.name,args:event.data.arguments});return;}
    if(event.type!=='tool/result'&&event.type!=='tool/ptc-dispatch')return;
    const result=event.type==='tool/result'?event.data.message:event.data;
    const direct=event.type==='tool/result'?event.data.message.toolCallId:undefined;
    const call=direct?this.calls.get(direct):undefined;
    const tool=event.type==='tool/ptc-dispatch'?event.data.name:call?.tool;
    let args=event.type==='tool/ptc-dispatch'?event.data.arguments:call?.args;
    if(typeof args==='string'){try{args=JSON.parse(args);}catch{/* Keep legacy arguments as recorded. */}}
    const operation=record(args)?args.path??args.file_path??args.command??args:args;
    const key=JSON.stringify([tool,record(args)?args.cwd??args.workdir:null,operation]);
    if(direct)this.calls.delete(direct);
    if(!tool)return;
    const error=event.data.error;
    const callId=event.type==='tool/ptc-dispatch'?event.data.subCallId:direct!;
    const shellError=tool==='bash'?this.shellErrors.get(callId):undefined;
    this.shellErrors.delete(callId);
    if(result.isError){
      const code=error?.code;
      this.toolsWithErrors.set(key,[tool,typeof code==='string' && /^[A-Z][A-Z_0-9]{0,63}$/.test(code)?code:'TOOL_ERROR']);
    }else if(shellError)this.toolsWithErrors.set(key,[tool,shellError]);
    else this.toolsWithErrors.delete(key);
    if(result.isError&&error?.code==='AUTO_REVIEW_FAILED'&&error.name==='AutoReviewFailedError'){
      const overflow=result.content.some(block=>block.type==='text'&&block.text.includes('reviewer ended with error CONTEXT_WINDOW_EXCEEDED'));
      this.failures.delete(key);
      this.failures.set(key,{tool,reason:overflow?'review_context_overflow':'auto_review_failed'});
    }else if(result.isError&&error?.code==='AUTO_REVIEW_DENIED'&&error.name==='AutoReviewDeniedError'){
      this.failures.delete(key);
      this.failures.set(key,{tool,reason:'auto_review_denied'});
    }else if(result.isError && error?.name==='FsError' && error.code==='FS_SANDBOX_DENIED'){
      this.failures.delete(key);
      this.failures.set(key,{tool,reason:'file_sandbox_denied'});
    }else if(shellError==='shell_sandbox_denied'){
      this.failures.delete(key);
      this.failures.set(key,{tool,reason:'shell_sandbox_denied'});
    }else if(result.isError && error?.name==='ApprovalError'){
      const reason = ({APPROVAL_REJECTED:'approval_rejected',APPROVAL_CANCELLED:'approval_cancelled',APPROVAL_UNAVAILABLE:'approval_unavailable'} as const)[error.code as 'APPROVAL_REJECTED'|'APPROVAL_CANCELLED'|'APPROVAL_UNAVAILABLE'];
      if(reason){this.failures.delete(key);this.failures.set(key,{tool,reason});}
    }else if(!result.isError){
      this.failures.delete(key);
    }
    if(result.isError||shellError){
      const code=this.failures.get(key)?.reason??this.toolsWithErrors.get(key)?.[1]??'TOOL_ERROR';
      this.seen.set(JSON.stringify([tool,code]),{stage:'observed',tool,code});
    }
  }

  observed(){return [...this.seen.values()];}
  toolError(){return [...this.toolsWithErrors.values()].findLast(([tool])=>tool!=='run_code')??[...this.toolsWithErrors.values()].at(-1);}
  latest(){return [...this.failures.values()].at(-1);}
}

/** Reconstruct only the last finished turn associated with this exact saved input. */
export function historicalReviewBlock(events:readonly SessionEvent[],input:string){
  const end=events.findLastIndex(event=>event.type==='turn/end'||event.type==='turn/start');
  const last=events[end];
  if(last?.type!=='turn/end'||last.data.reason.kind!=='completed')return;
  let start=end;
  while(start>0&&events[start]?.type!=='turn/start')start--;
  const turn=events.slice(start,end);
  if(!turn.some(event=>event.type==='user/message'&&event.data.id===input))return;
  const failures=new ReviewFailures();
  for(const event of turn)failures.observe(event);
  return failures.latest();
}
