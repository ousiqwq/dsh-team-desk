import {HarnessError} from '@deepseek-ai/dsh-llm';
import type {ToolDefinition} from '@deepseek-ai/dsh-tools';
import {errorResult} from '../domain/errors.ts';
/** Keep DSH's native isError and machine error code, with a lossless JSON error envelope. */
export function nativeFailure(error:unknown):HarnessError{
  const result=errorResult(error);return new HarnessError(JSON.stringify(result),result.code,{cause:error});
}
export function toolContract(tool:ToolDefinition):ToolDefinition{
  return {...tool,async execute(args,exec){try{return await tool.execute(args,exec);}catch(error){throw nativeFailure(error);}}};
}
