import type {TeamEngine} from '../domain/engine.ts';
import type {GitEngine} from '../domain/git/engine.ts';
import type {GitScope} from '../domain/git/types.ts';
import {CoordinationError} from '../domain/errors.ts';
import {record,string} from '../domain/storage.ts';

export function gitScope(engine:TeamEngine,memberId:string,actorId:string,projectId:string,write=false):GitScope {
 const team=engine.membership(memberId),member=team?.members.find(m=>m.sessionId===memberId&&m.active!==false);
 if(!team||!member||!member.operations.includes(write?'send':'read'))throw new CoordinationError('GIT_SCOPE','Conversation lacks the required collaboration capability');
 const project=engine.snapshot().projects?.find(p=>p.id===projectId&&p.teamIds.includes(team.id));
 if(!project)throw new CoordinationError('PROJECT_SCOPE','Register or join the project before using Git');
 return {actor:actorId,memberSessionId:memberId,teamId:team.id,projectId:project.id,projectRoot:project.root,...(team.epoch?{epoch:team.epoch}:{})};
}
/** One adapter for UI and scoped model tools; never accept caller identity from model JSON. */
export async function gitAction(git:GitEngine,engine:TeamEngine,memberId:string,actorId:string,projectId:string,action:string,input:unknown,signal?:AbortSignal){
 if(!record(input))throw new CoordinationError('GIT_ARGUMENT','Git options must be a JSON object');
 const scope=gitScope(engine,memberId,actorId,projectId,!['status','state','history','compare','lfs','partial'].includes(action));
 if(signal)scope.signal=signal;
 const text=(key:string)=>string(input[key],key,8000),head=()=>input.expectedHead===''?'':text('expectedHead'),evidence=()=>input.evidence as string[]|undefined;
 switch(action){
  case 'init':return git.initialize(scope,{key:text('key'),...(input.branch===undefined?{}:{branch:text('branch')})});
  case 'status':return git.status(scope);
  case 'compare':return git.compare(scope,text('proposalId'),Number(input.expected));
  case 'lfs':return git.lfs(scope);
  case 'history':return git.history(scope,text('archiveId'));
  case 'state':return git.snapshot(scope.teamId);
  case 'worktree':return git.worktree(scope,{key:text('key'),expectedHead:head(),...(input.name===undefined?{}:{name:text('name')}),...(input.from===undefined?{}:{from:text('from')})});
  case 'partial':return git.partial(scope,input.paths as string[]);
  case 'commit-hunks':return git.commitHunks(scope,{key:text('key'),expectedHead:head(),paths:input.paths as string[],snapshot:text('snapshot'),hunks:input.hunks as string[],message:text('message'),shared:input.shared===true});
  case 'commit':return git.commit(scope,{key:text('key'),expectedHead:head(),paths:input.paths as string[],message:text('message'),shared:input.shared===true});
  case 'propose':return git.propose(scope,{sourceSha:text('sourceSha'),targetRef:text('targetRef'),expectedTarget:text('expectedTarget'),summary:text('summary'),...(evidence()?{evidence:evidence()!}:{})});
  case 'review':return git.review(scope,{proposalId:text('proposalId'),expected:Number(input.expected),sourceSha:text('sourceSha'),targetSha:text('targetSha'),outcome:text('outcome') as 'comment'|'passed'|'changes_requested',note:text('note'),...(evidence()?{evidence:evidence()!}:{})});
  case 'integrate':return git.integrate(scope,{key:text('key'),proposalId:text('proposalId'),expected:Number(input.expected),strategy:text('strategy') as 'ff-only'|'merge'|'cherry-pick',requireReview:input.requireReview===true,...(input.commits===undefined?{}:{commits:input.commits as string[]})});
  case 'reconcile':return git.reconcile(scope,text('operationId'));
  default:throw new CoordinationError('GIT_ARGUMENT','Unknown Git collaboration action');
 }
}
