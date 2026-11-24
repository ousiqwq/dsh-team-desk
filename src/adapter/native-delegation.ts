import type {Context} from '@deepseek-ai/cordis';
import type {Agent} from '@deepseek-ai/dsh-agent';
/** Read the caller's native view; never restore tools removed by its preset or restrictions. */
export function nativeDelegationTools(ctx:Pick<Context,'tools'>,agent:Agent|undefined):string[]{
 return agent&&typeof ctx.tools.resolve==='function'?['subagent','subagent_fork'].filter(name=>!!ctx.tools.get(name,agent)):[];
}
