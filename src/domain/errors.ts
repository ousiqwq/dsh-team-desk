export class CoordinationError extends Error {
  constructor(readonly code:string,message:string,readonly retryable=false,readonly details:Record<string,unknown>={}){super(`${code}: ${message}`);this.name='CoordinationError';}
}
export function errorResult(error:unknown){
  if(error instanceof CoordinationError)return {error:error.message,code:error.code,retryable:error.retryable,details:error.details};
  const message=error instanceof Error?error.message:String(error),io=error as {code?:string;committed?:boolean};
  if(io?.committed)return {error:message,code:'STORAGE_UNCERTAIN',retryable:false,details:{committed:true,recovery:'query_before_retry'}};
  if(['ENOSPC','EACCES','EROFS','EIO','EMFILE'].includes(io?.code??''))return {error:message,code:'STORAGE_UNAVAILABLE',retryable:true,details:{committed:false}};
  return {error:message,code:'INVALID_ARGUMENT',retryable:false,details:{}};
}
