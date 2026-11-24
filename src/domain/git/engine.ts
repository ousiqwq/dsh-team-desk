import {partialPreview,selectedPatch,synchronizePartialIndex} from './partial.ts';
import {compareProposal,inspectLfs} from './inspection.ts';
import {randomUUID} from 'node:crypto';
import {copyFile,type FileHandle} from 'node:fs/promises';
import {isAbsolute,relative,resolve,join} from 'node:path';
import {readJson,writeJson,record,string} from '../storage.ts';
import {acquireWriter} from '../process-lock.ts';
import {CoordinationError} from '../errors.ts';
import {loadGitArchive,saveGitArchive} from './archive.ts';
import {validateGitState} from './validation.ts';
import {digest,discover,repositoryRoot,fullObject,parseStatus,requireGit,scopedPaths} from './repository.ts';
import type {GitHost,GitNotice,GitOperation,GitProposal,GitRepository,GitScope,GitState,GitStatus} from './types.ts';

function failure(code:string,message:string,details:Record<string,unknown>={}):never{throw new CoordinationError(code,message,false,details);}
export class GitEngine {
 private state:GitState={version:2,revision:0,repositories:[],checkouts:[],proposals:[],operations:[]};
 private chain:Promise<unknown>=Promise.resolve();private lanes=new Map<string,Promise<unknown>>();private writer:FileHandle|undefined;private closing=false;
 constructor(private readonly file:string,private readonly host:GitHost,private readonly deliver?:(notice:GitNotice)=>Promise<void>){}
 async load(){
  this.writer=await acquireWriter(this.file+'.lock');
  try{
   const raw=await readJson(this.file);
   if(raw!==undefined){const legacy=record(raw)&&raw.version===1,candidate=legacy?{...raw,version:2}:raw;validateGitState(candidate);this.state=candidate;if(legacy){await copyFile(this.file,this.file+'.schema1-'+randomUUID()+'.backup.json');await this.change(()=>{});}}
   if(this.state.operations.some(o=>o.state==='prepared'))await this.change(s=>{for(const o of s.operations)if(o.state==='prepared'){o.state='uncertain';o.error='Host restarted; reconcile Git before retrying';}});
  }catch(e){await this.writer.close();this.writer=undefined;throw e;}
 }
 observation(actor:string,teamId:string,path:string){
  for(const checkout of this.state.checkouts.filter(c=>c.sessionId===actor)){
   const repo=this.state.repositories.find(r=>r.id===checkout.repositoryId&&r.teamIds.includes(teamId));if(!repo)continue;
   const rel=relative(resolve(checkout.path,repo.prefix),path);if(rel==='..'||rel.startsWith('../')||isAbsolute(rel))continue;
   return {projectId:repo.projectId,git:{repositoryId:repo.id,checkoutRoot:checkout.path,branch:checkout.branch}};
  }
  return undefined;
 }
 snapshot(teamId?:string):GitState{
  const state=structuredClone(this.state);if(!teamId)return state;
  state.repositories=state.repositories.filter(r=>r.teamIds.includes(teamId));const ids=new Set(state.repositories.map(r=>r.id));state.checkouts=state.checkouts.filter(c=>ids.has(c.repositoryId));state.proposals=state.proposals.filter(p=>p.teamId===teamId);state.operations=state.operations.filter(o=>o.teamId===teamId);state.archives=state.archives?.filter(a=>a.teamId===teamId)??[];state.notices=state.notices?.filter(n=>n.teamId===teamId)??[];return state;
 }
 private serial<T>(fn:()=>Promise<T>):Promise<T>{const p=this.chain.then(fn);this.chain=p.catch(()=>{});return p;}
 private async change(fn:(s:GitState)=>void){return this.serial(async()=>{if(this.closing)failure('GIT_CLOSED','Git collaboration is stopping');const next=structuredClone(this.state);fn(next);next.revision++;try{await writeJson(this.file,next);}catch(e){if((e as {committed?:boolean}).committed)this.state=next;throw e;}this.state=next;});}
 private exclusive<T>(key:string,fn:()=>Promise<T>):Promise<T>{const prior=this.lanes.get(key)??Promise.resolve(),p=prior.catch(()=>{}).then(fn);this.lanes.set(key,p);void p.finally(()=>{if(this.lanes.get(key)===p)this.lanes.delete(key);}).catch(()=>{});return p;}
 private async repo(scope:GitScope):Promise<GitRepository>{
  const found=await discover(this.host,scope),prior=this.state.repositories.find(r=>r.id===found.id);
  if(!prior||!prior.teamIds.includes(scope.teamId))await this.change(s=>{const r=s.repositories.find(r=>r.id===found.id);if(r){if(!r.teamIds.includes(scope.teamId))r.teamIds.push(scope.teamId);}else s.repositories.push(found);});
  return this.state.repositories.find(r=>r.id===found.id)!;
 }
 private run(scope:GitScope,path:string,args:string[],allow=[0]){return this.host.run(scope.actor,path,args,{allow,env:{GIT_LITERAL_PATHSPECS:'1'},...(scope.signal?{...(scope.signal?{signal:scope.signal}:{})}:{})});}
 private async text(scope:GitScope,path:string,args:string[],allow=[0]){return (await this.run(scope,path,args,allow)).stdout.replace(/\r?\n$/,'');}
 private async oid(scope:GitScope,path:string,ref='HEAD'){return fullObject(await this.text(scope,path,['rev-parse','--verify','--end-of-options',ref+'^{commit}']));}
 private async head(scope:GitScope,path:string){return this.text(scope,path,['rev-parse','--verify','--quiet','HEAD^{commit}'],[0,1,128]);}
 private async checkout(scope:GitScope,repo:GitRepository):Promise<string>{
  const cwd=await this.host.cwd(scope.actor),result=await this.run(scope,cwd,['rev-parse','--path-format=absolute','--git-common-dir'],[0,128]);
  if(result.exitCode===0&&result.stdout.trim()===repo.commonDir)return this.text(scope,cwd,['rev-parse','--show-toplevel']);
  return repo.root;
 }
 private notice(s:GitState,scope:GitScope,repositoryId:string,action:string,payload:unknown){
  const rows=s.notices??=[];s.notices=rows.filter(n=>!n.deliveredAt).concat(rows.filter(n=>n.deliveredAt).slice(-1000));
  s.notices.push({id:randomUUID(),teamId:scope.teamId,projectId:scope.projectId,...(scope.epoch?{epoch:scope.epoch}:{}),actor:scope.actor,memberSessionId:scope.memberSessionId??scope.actor,repositoryId,action,payload,time:Date.now()});
 }
 private noticeFlight:Promise<void>|undefined;
 flushNotices():Promise<void>{
  if(this.noticeFlight)return this.noticeFlight;if(!this.deliver||this.closing)return Promise.resolve();
  const job=(async()=>{for(const row of this.state.notices??[]){if(row.deliveredAt)continue;await this.deliver!(structuredClone(row));await this.change(s=>{const n=s.notices?.find(n=>n.id===row.id);if(n)n.deliveredAt=Date.now();});}})();
  this.noticeFlight=job;void job.finally(()=>{if(this.noticeFlight===job)this.noticeFlight=undefined;}).catch(()=>{});return job;
 }

 async compare(scope:GitScope,id:string,expected:number){
  const repo=await this.repo(scope),proposal=this.state.proposals.find(p=>p.id===id&&p.teamId===scope.teamId&&p.repositoryId===repo.id);
  if(!proposal||proposal.revision!==expected)failure('GIT_COMPARE_STALE','Proposal changed or is unavailable; refresh before comparing');
  const pinned=structuredClone(proposal),path=await this.checkout(scope,repo);
  return compareProposal(this.host,scope,repo,path,pinned);
 }
 async lfs(scope:GitScope){const repo=await this.repo(scope);return inspectLfs(this.host,scope,repo,await this.checkout(scope,repo));}
 async status(scope:GitScope):Promise<GitStatus>{
  const repository=await this.repo(scope),path=await this.checkout(scope,repository),head=await this.head(scope,path),branch=await this.text(scope,path,['symbolic-ref','--quiet','HEAD'],[0,1]);
  const files=parseStatus((await this.run(scope,path,['status','--porcelain=v1','-z','--untracked-files=all','--',repository.prefix||'.'])).stdout);
  const busy:string[]=[];for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD'])if((await this.run(scope,path,['rev-parse','--verify','--quiet',name],[0,1,128])).exitCode===0)busy.push(name);
  const previous=this.state.checkouts.find(c=>c.repositoryId===repository.id&&c.sessionId===scope.actor);
  if(!previous||previous.path!==path||previous.branch!==branch||previous.teamId!==scope.teamId)await this.change(s=>{s.checkouts=s.checkouts.filter(c=>!(c.repositoryId===repository.id&&c.sessionId===scope.actor));s.checkouts.push({teamId:scope.teamId,repositoryId:repository.id,sessionId:scope.actor,path,branch,baseline:previous?.baseline??head});});
  const targets=(await this.text(scope,path,['for-each-ref','--count=200','--format=%(refname)%09%(objectname)','refs/heads/'])).split('\n').filter(Boolean).map(row=>{const [ref,sha]=row.split('\t');return {ref:ref!,sha:sha!};});
  return {repository,path,head,branch,files,busy,sharedWith:this.state.checkouts.filter(c=>c.repositoryId===repository.id&&c.path===path&&c.sessionId!==scope.actor).map(c=>c.sessionId),targets};
 }
 private async checkHead(scope:GitScope,path:string,expected:string){if(expected)fullObject(expected);const current=await this.head(scope,path);if(current!==expected)failure('GIT_STALE_HEAD','Git HEAD changed; refresh the baseline',{currentHead:current,expectedHead:expected});}
 private async operate(scope:GitScope,repo:GitRepository,path:string,action:string,key:string,expectedHead:string,request:Record<string,unknown>,fn:(operation:GitOperation)=>Promise<unknown>):Promise<unknown>{
  requireGit(key,'operation key',200);const fingerprint=digest(JSON.stringify({actor:scope.actor,team:scope.teamId,project:scope.projectId,action,expectedHead,request}));
  return this.exclusive(repo.commonDir+'\0'+path,async()=>{
   let old=this.state.operations.find(o=>o.teamId===scope.teamId&&o.actor===scope.actor&&o.key===key);if(!old){const ref=this.state.archives?.find(a=>a.teamId===scope.teamId&&a.operations.some(o=>o.actor===scope.actor&&o.key===key));if(ref)old=(await loadGitArchive(this.file,ref)).operations.find(o=>o.actor===scope.actor&&o.key===key);}
   if(old){if(old.fingerprint!==fingerprint)failure('GIT_IDEMPOTENCY_CONFLICT','Operation key was reused with different arguments');if(old.state==='completed')return old.result;failure('GIT_OPERATION_PENDING','Reconcile the existing operation before continuing',{operationId:old.id,state:old.state});}
   const pending=this.state.operations.find(o=>o.path===path&&['prepared','uncertain'].includes(o.state));if(pending)failure('GIT_OPERATION_PENDING','Checkout has an operation awaiting verification',{operationId:pending.id});
   await this.checkHead(scope,path,expectedHead);
   const operation:GitOperation={id:randomUUID(),key,fingerprint,actor:scope.actor,teamId:scope.teamId,repositoryId:repo.id,action,path,expectedHead,request,time:Date.now(),state:'prepared'};
   await this.change(s=>{if(s.operations.length>=5000)failure('GIT_RECORD_LIMIT','Export and retain Git operation history before adding records');s.operations.push(operation);});
   try{const result=await fn(operation);await this.change(s=>{const o=s.operations.find(o=>o.id===operation.id)!;o.state='completed';o.result=result;this.notice(s,scope,repo.id,action,{operationId:o.id,result});});return result;}
   catch(e){await this.change(s=>{const o=s.operations.find(o=>o.id===operation.id)!;o.state=action==='commit-hunks'&&['GIT_PARTIAL_STALE','GIT_PARTIAL_UNAVAILABLE','GIT_ARGUMENT','GIT_PARTIAL_INVALID'].includes((e as {code?:string}).code??'')?'failed':'uncertain';o.error=String(e);}).catch(()=>{});throw e;}
  });
 }
 async initialize(scope:GitScope,input:{key:string;branch?:string}){
  if(await repositoryRoot(this.host,scope)!==undefined)return this.status(scope);
  const branch=input.branch??'main';await this.run(scope,scope.projectRoot,['check-ref-format','--branch',requireGit(branch,'branch',200)]);
  const commonDir=join(scope.projectRoot,'.git'),repo:GitRepository={id:'repo-'+digest(commonDir+'\0'+scope.projectId).slice(0,24),teamIds:[scope.teamId],projectId:scope.projectId,projectRoot:scope.projectRoot,root:scope.projectRoot,commonDir,prefix:'',defaultTarget:'refs/heads/'+branch,requireReview:false};
  if(!this.state.repositories.some(r=>r.id===repo.id))await this.change(s=>{s.repositories.push(repo);});
  await this.operate(scope,repo,scope.projectRoot,'init',input.key,'',{branch},async()=>{await this.run(scope,scope.projectRoot,['init','--initial-branch='+branch]);return {root:scope.projectRoot,branch};});
  return this.status(scope);
 }
 async worktree(scope:GitScope,input:{key:string;expectedHead:string;name?:string;from?:string}){
  const status=await this.status(scope);if(!status.head)failure('GIT_INITIAL_COMMIT','Create the initial project commit before creating a task worktree');const from=await this.oid(scope,status.path,input.from??input.expectedHead);
  return this.operate(scope,status.repository,status.path,'worktree',input.key,input.expectedHead,{name:input.name??'',from},async()=>{
   const created=await this.host.worktree(scope.actor,{...(input.name?{name:requireGit(input.name,'branch',200)}:{}),from},scope.signal,status.path);
   if(created.repositoryRoot!==status.path||created.baseCommit!==from)failure('GIT_STALE_HEAD','Native worktree did not use the pinned commit');
   await this.change(s=>{s.checkouts=s.checkouts.filter(c=>!(c.repositoryId===status.repository.id&&c.sessionId===scope.actor));s.checkouts.push({teamId:scope.teamId,repositoryId:status.repository.id,sessionId:scope.actor,path:created.path,branch:'refs/heads/'+created.branch,baseline:created.baseCommit});});
   return created;
  });
 }
 async commit(scope:GitScope,input:{key:string;expectedHead:string;paths:string[];message:string;shared?:boolean}){
  const status=await this.status(scope),paths=scopedPaths(status.repository,input.paths),message=string(input.message,'commit message',8000);
  if(status.busy.length)failure('GIT_CHECKOUT_BUSY','Resolve the existing Git operation first',{busy:status.busy});
  if(status.sharedWith.length&&!input.shared)failure('GIT_SHARED_CHECKOUT','Checkout is shared; explicitly select a joint commit or use a task worktree',{sessions:status.sharedWith});
  const staged=await this.text(scope,status.path,['diff','--cached','--name-only','-z','--',...paths]);if(staged)failure('GIT_INDEX_BUSY','Selected paths already contain staged changes; use native Git or choose another scope');
  return this.operate(scope,status.repository,status.path,'commit',input.key,input.expectedHead,{paths,message,shared:input.shared===true},async op=>{
   await this.checkHead(scope,status.path,input.expectedHead);
   if(await this.text(scope,status.path,['diff','--cached','--name-only','-z','--',...paths]))failure('GIT_INDEX_BUSY','Selected paths already contain staged changes; use native Git or choose another scope');
   const added=(await this.text(scope,status.path,['ls-files','--others','--exclude-standard','-z','--',...paths])).split('\0').filter(Boolean);
   if(added.length>200)failure('GIT_ARGUMENT','Select at most 200 new files per managed commit');
   if(added.length){scopedPaths(status.repository,added);await this.change(s=>{s.operations.find(o=>o.id===op.id)!.request.newFiles=added;});await this.run(scope,status.path,['add','--intent-to-add','--',...added]);}
   await this.run(scope,status.path,['commit','--only','-m',message+'\n\nTeam-Desk-Operation: '+op.id,'--',...paths]);
   const sha=await this.oid(scope,status.path),parent=await this.text(scope,status.path,['show','-s','--format=%P',sha]);
   if(parent!==input.expectedHead)failure('GIT_OPERATION_UNCERTAIN','Commit exists but the expected parent changed',{sha,parent});
   return {operationId:op.id,sha,parent,path:status.path,paths,shared:input.shared===true};
  });
 }
 async partial(scope:GitScope,paths:string[]){return partialPreview(this.host,scope,await this.status(scope),paths);}
 async commitHunks(scope:GitScope,input:{key:string;expectedHead:string;paths:string[];snapshot:string;hunks:string[];message:string;shared?:boolean}){
  const status=await this.status(scope),paths=scopedPaths(status.repository,input.paths).sort(),message=string(input.message,'commit message',8000);
  if(status.busy.length)failure('GIT_CHECKOUT_BUSY','Resolve the existing Git operation first');
  if(status.sharedWith.length&&!input.shared)failure('GIT_SHARED_CHECKOUT','Checkout is shared; explicitly select a joint commit or use a task worktree');
  requireGit(input.snapshot,'diff snapshot',64);if(!/^[a-f0-9]{64}$/.test(input.snapshot)||!Array.isArray(input.hunks)||!input.hunks.length||input.hunks.length>1000||input.hunks.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))||new Set(input.hunks).size!==input.hunks.length)failure('GIT_ARGUMENT','Select hunk IDs from a diff preview');
  return this.operate(scope,status.repository,status.path,'commit-hunks',input.key,input.expectedHead,{paths,message,snapshot:input.snapshot,hunks:input.hunks,shared:input.shared===true},async op=>{
   const current=await this.status(scope),preview=await partialPreview(this.host,scope,current,paths);
   if(preview.snapshot!==input.snapshot||preview.head!==input.expectedHead||preview.path!==status.path)failure('GIT_PARTIAL_STALE','Files, index or branch changed; reload the diff before committing');
   const selection=selectedPatch(preview,input.hunks),index=await this.text(scope,status.path,['rev-parse','--path-format=absolute','--git-path','team-desk-index-'+op.id]);
   const run=(args:string[],input?:string)=>this.host.run(scope.actor,status.path,args,{env:{GIT_INDEX_FILE:index,GIT_LITERAL_PATHSPECS:'1'},...(input===undefined?{}:{input}),...(scope.signal?{signal:scope.signal}:{})});
   try{
    await run(['read-tree',input.expectedHead]);await run(['apply','--cached','--whitespace=nowarn','--check','-'],selection.patch);await run(['apply','--cached','--whitespace=nowarn','-'],selection.patch);
    const tree=fullObject((await run(['write-tree'])).stdout.trim());
    await this.change(s=>{Object.assign(s.operations.find(o=>o.id===op.id)!.request,{partialPatch:selection.patch,partialPaths:selection.paths,partialTree:tree});});
    const checked=await partialPreview(this.host,scope,await this.status(scope),paths);if(checked.snapshot!==preview.snapshot)failure('GIT_PARTIAL_STALE','Files, index or branch changed; reload the diff before committing');
    await run(['commit','-m',message+'\n\nTeam-Desk-Operation: '+op.id]);
    const sha=await this.oid(scope,status.path),parent=await this.text(scope,status.path,['show','-s','--format=%P',sha]),actualTree=await this.text(scope,status.path,['show','-s','--format=%T',sha]);
    if(parent!==input.expectedHead||actualTree!==tree)failure('GIT_OPERATION_UNCERTAIN','Commit contents or parent changed during native hooks; inspect the actual commit',{sha,parent,tree:actualTree});
    await synchronizePartialIndex(this.host,scope,status.path,sha,parent,selection.patch,selection.paths);
    return {operationId:op.id,sha,parent,path:status.path,paths:selection.paths,hunks:input.hunks,partial:true,shared:input.shared===true};
   }finally{await this.host.removeTemporaryIndex?.(scope.actor,index).catch(()=>{});}
  });
 }
 async propose(scope:GitScope,input:{sourceSha:string;targetRef:string;expectedTarget:string;summary:string;evidence?:string[]}):Promise<GitProposal>{
  const status=await this.status(scope),sourceSha=fullObject(input.sourceSha),targetSha=fullObject(input.expectedTarget),targetRef=requireGit(input.targetRef,'target ref',300);
  if(!targetRef.startsWith('refs/heads/'))failure('GIT_ARGUMENT','Select a full local target branch ref');
  await this.run(scope,status.path,['check-ref-format',targetRef]);await this.oid(scope,status.path,sourceSha);
  if(await this.oid(scope,status.path,targetRef)!==targetSha)failure('GIT_STALE_HEAD','Target branch changed');
  const paths=(await this.text(scope,status.path,['diff','--no-renames','--name-only','-z',targetSha+'...'+sourceSha])).split('\0').filter(Boolean);if(paths.length)scopedPaths(status.repository,paths);
  if(sourceSha!==status.head)failure('GIT_STALE_HEAD','Submit the current source commit or check out the intended revision');
  const proposal:GitProposal={id:randomUUID(),revision:1,repositoryId:status.repository.id,teamId:scope.teamId,actor:scope.actor,memberSessionId:scope.memberSessionId??scope.actor,sourceSha,sourceRef:status.branch,targetSha,targetRef,summary:string(input.summary,'proposal summary',4000),evidence:this.evidence(input.evidence),reviews:[],createdAt:Date.now()};
  await this.change(s=>{if(s.proposals.length>=5000)failure('GIT_RECORD_LIMIT','Export and retain Git proposal history before adding records');s.proposals.push(proposal);this.notice(s,scope,status.repository.id,'proposal',proposal);});return structuredClone(proposal);
 }
 private evidence(value:string[]|undefined){if(value!==undefined&&(!Array.isArray(value)||value.length>20||value.some(x=>typeof x!=='string'||x.length>2000)))failure('GIT_ARGUMENT','Invalid evidence references');return value??[];}
 private async proposal(scope:GitScope,id:string){let p=this.state.proposals.find(p=>p.id===id&&p.teamId===scope.teamId);if(!p){for(const ref of this.state.archives?.filter(a=>a.teamId===scope.teamId&&a.projectId===scope.projectId)??[]){p=(await loadGitArchive(this.file,ref)).proposals.find(p=>p.id===id);if(p)break;}}if(!p||!this.state.repositories.some(r=>r.id===p.repositoryId&&r.projectId===scope.projectId&&r.teamIds.includes(scope.teamId)))return failure('GIT_PROJECT_SCOPE','Proposal is outside this team and project');return p;}
 async review(scope:GitScope,input:{proposalId:string;expected:number;sourceSha:string;targetSha:string;outcome:'comment'|'passed'|'changes_requested';note:string;evidence?:string[]}){
  if(!['comment','passed','changes_requested'].includes(input.outcome))failure('GIT_ARGUMENT','Invalid review outcome');
  const p=await this.proposal(scope,input.proposalId),repo=await this.repo(scope);if(p.integratedSha)failure('GIT_PROPOSAL_DONE','The proposal has already been integrated');
  if(p.revision!==input.expected||p.sourceSha!==input.sourceSha||p.targetSha!==input.targetSha)failure('GIT_REVIEW_STALE','Proposal or review baseline changed');
  if(await this.oid(scope,repo.root,p.targetRef)!==p.targetSha)failure('GIT_REVIEW_STALE','Target branch changed; create an updated proposal');
  if(p.sourceRef&&await this.oid(scope,repo.root,p.sourceRef)!==p.sourceSha)failure('GIT_REVIEW_STALE','Source branch changed; review the new commit');
  await this.change(s=>{const row=s.proposals.find(x=>x.id===p.id)!;if(row.revision!==input.expected)failure('REVISION_CONFLICT','Proposal changed');row.reviews.push({protocol:2,id:randomUUID(),actor:scope.actor,memberSessionId:scope.memberSessionId??scope.actor,sourceSha:p.sourceSha,targetSha:p.targetSha,outcome:input.outcome,note:string(input.note,'review note',4000),evidence:this.evidence(input.evidence),time:Date.now()});row.revision++;this.notice(s,scope,p.repositoryId,'review',{proposalId:p.id,review:row.reviews.at(-1),revision:row.revision});});
  return structuredClone(await this.proposal(scope,p.id));
 }
 async integrate(scope:GitScope,input:{key:string;proposalId:string;expected:number;strategy:'ff-only'|'merge'|'cherry-pick';commits?:string[];requireReview?:boolean}){
  const p=await this.proposal(scope,input.proposalId),status=await this.status(scope);
  if(p.revision!==input.expected)failure('GIT_REVIEW_STALE','Proposal changed');
  if(p.integratedSha)return {sha:p.integratedSha,alreadyIntegrated:true};
  if(status.branch!==p.targetRef)failure('GIT_TARGET_CHECKOUT','Use the conversation checked out on the target branch',{targetRef:p.targetRef});
  if((await this.text(scope,status.path,['status','--porcelain=v1','-z','--untracked-files=all']))||status.busy.length)failure('GIT_CHECKOUT_BUSY','Target checkout has uncommitted files or an ongoing Git operation');
  if(p.sourceRef&&await this.oid(scope,status.path,p.sourceRef)!==p.sourceSha)failure('GIT_REVIEW_STALE','Source branch changed; create an updated proposal');
  if((status.repository.requireReview||input.requireReview)&&p.reviews.filter(r=>r.protocol===2&&(r.memberSessionId??r.actor)!==(p.memberSessionId??p.actor)&&r.outcome!=='comment'&&r.sourceSha===p.sourceSha&&r.targetSha===p.targetSha).at(-1)?.outcome!=='passed')failure('GIT_REVIEW_REQUIRED','A different member must review these exact commits');
  if(!['ff-only','merge','cherry-pick'].includes(input.strategy))failure('GIT_ARGUMENT','Invalid integration strategy');
  const commits=input.commits?.map(fullObject)??[];
  if(input.strategy==='cherry-pick'&&(!commits.length||commits.length>64))failure('GIT_ARGUMENT','Select 1–64 exact commits');
  for(const sha of commits)if((await this.run(scope,status.path,['merge-base','--is-ancestor',sha,p.sourceSha],[0,1])).exitCode!==0)failure('GIT_ARGUMENT','Selected commit is not part of the proposal');
  for(const sha of commits){const paths=(await this.text(scope,status.path,['diff-tree','--root','--no-commit-id','--name-only','--no-renames','-r','-z',sha])).split('\0').filter(Boolean);if(paths.length)scopedPaths(status.repository,paths);}
  const result=await this.operate(scope,status.repository,status.path,'integrate',input.key,p.targetSha,{proposalId:p.id,sourceSha:p.sourceSha,targetRef:p.targetRef,strategy:input.strategy,commits},async op=>{
   await this.checkHead(scope,status.path,p.targetSha);
   if(input.strategy==='cherry-pick')await this.run(scope,status.path,['cherry-pick','-x',...commits]);
   else await this.run(scope,status.path,input.strategy==='ff-only'?['merge','--ff-only',p.sourceSha]:['merge','--no-ff','-m','Integrate Team Desk proposal '+p.id+'\n\nTeam-Desk-Operation: '+op.id,p.sourceSha]);
   const sha=await this.oid(scope,status.path);
   if((await this.run(scope,status.path,['merge-base','--is-ancestor',p.targetSha,sha],[0,1])).exitCode!==0)failure('GIT_OPERATION_UNCERTAIN','Integration lost the expected target history');
   return {operationId:op.id,sha,sourceSha:p.sourceSha,targetRef:p.targetRef};
  }) as {sha:string};
  await this.change(s=>{const row=s.proposals.find(x=>x.id===p.id)!;row.integratedSha=result.sha;});return result;
 }
 async reconcile(scope:GitScope,id:string){
  const op=this.state.operations.find(o=>o.id===id&&o.teamId===scope.teamId),repo=await this.repo(scope);if(!op||op.repositoryId!==repo.id)failure('GIT_PROJECT_SCOPE','Operation is outside this project');
  if(op.state==='completed')return structuredClone(op);
  const current=await this.head(scope,op.path),candidates=(await this.text(scope,op.path,['log','--all','--format=%H','--fixed-strings','--grep=Team-Desk-Operation: '+op.id,'--max-count=3'])).split('\n').filter(Boolean);
  let sha:string|undefined;
  if(candidates.length===1){const candidate=candidates[0]!,message=await this.text(scope,op.path,['show','-s','--format=%B',candidate]),parent=await this.text(scope,op.path,['show','-s','--format=%P',candidate]);if(message.split('\n').includes('Team-Desk-Operation: '+op.id)&&parent===op.expectedHead)sha=candidate;}
  if(op.action==='integrate'&&op.request.strategy==='ff-only'&&current===op.request.sourceSha&&(await this.run(scope,op.path,['merge-base','--is-ancestor',op.expectedHead,current],[0,1])).exitCode===0)sha=current;
  if(sha&&op.action==='commit-hunks'){
   const tree=await this.text(scope,op.path,['show','-s','--format=%T',sha]);
   if(tree!==op.request.partialTree)failure('GIT_OPERATION_UNCERTAIN','Native commit differs from the selected patch; inspect before resolving');
   await synchronizePartialIndex(this.host,scope,op.path,sha,op.expectedHead,string(op.request.partialPatch,'stored patch',524288),scopedPaths(repo,op.request.partialPaths));
  }
  if(sha)await this.change(s=>{const row=s.operations.find(x=>x.id===op.id)!;row.state='completed';row.result={operationId:op.id,sha,reconciled:true};delete row.error;this.notice(s,scope,repo.id,'reconciled',{operationId:op.id,sha});});
  return structuredClone(this.state.operations.find(x=>x.id===id)!);
 }
 async history(scope:GitScope,id:string){const ref=this.state.archives?.find(a=>a.id===id&&a.teamId===scope.teamId&&a.projectId===scope.projectId);if(!ref)failure('GIT_PROJECT_SCOPE','Archive is outside this team and project');return loadGitArchive(this.file,ref);}
 async exportArchive(id:string){const ref=this.state.archives?.find(a=>a.id===id);if(!ref)failure('GIT_PROJECT_SCOPE','Unknown Git archive');return loadGitArchive(this.file,ref);}
 async archive(scope:GitScope,before:number){
  if(!Number.isFinite(before)||before>Date.now())failure('GIT_ARGUMENT','Select a valid archive cutoff');const repo=await this.repo(scope);
  return this.exclusive(repo.commonDir+'\0archive',async()=>{
   const operations=this.state.operations.filter(o=>o.teamId===scope.teamId&&o.repositoryId===repo.id&&['completed','resolved'].includes(o.state)&&o.time<before);
   const proposals=this.state.proposals.filter(p=>p.teamId===scope.teamId&&p.repositoryId===repo.id&&p.integratedSha&&p.createdAt<before);
   const notices=(this.state.notices??[]).filter(n=>n.teamId===scope.teamId&&n.repositoryId===repo.id&&n.deliveredAt&&n.time<before);
   if(!operations.length&&!proposals.length&&!notices.length)return {archived:false};
   const ref=await saveGitArchive(this.file,{version:1,teamId:scope.teamId,projectId:scope.projectId,time:Date.now(),operations,proposals,notices}),opIds=new Set(operations.map(o=>o.id)),proposalRevisions=new Map(proposals.map(p=>[p.id,p.revision])),noticeIds=new Set(notices.map(n=>n.id));
   await this.change(s=>{(s.archives??=[]).push(ref);s.operations=s.operations.filter(o=>!opIds.has(o.id));s.proposals=s.proposals.filter(p=>proposalRevisions.get(p.id)!==p.revision);s.notices=s.notices?.filter(n=>!noticeIds.has(n.id))??[];});return ref;
  });
 }
 /** Human management action; model tools may strengthen but never lower this policy. */
 async resolve(scope:GitScope,input:{operationId:string;expectedHead:string;reason:string}){
  const repo=await this.repo(scope),op=this.state.operations.find(o=>o.id===input.operationId&&o.teamId===scope.teamId&&o.repositoryId===repo.id);
  if(!op)failure('GIT_PROJECT_SCOPE','Operation is outside this project');
  return this.exclusive(repo.commonDir+'\0'+op.path,async()=>{
   await this.checkHead(scope,op.path,input.expectedHead);
   for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD'])if((await this.run(scope,op.path,['rev-parse','--verify','--quiet',name],[0,1,128])).exitCode===0)failure('GIT_CHECKOUT_BUSY','Resolve the existing Git operation first');
   if(op.state!=='uncertain')failure('GIT_ARGUMENT','Only an uncertain operation can be explicitly resolved');
   await this.change(s=>{const row=s.operations.find(o=>o.id===op.id)!;row.state='resolved';row.resolution={actor:scope.actor,reason:string(input.reason,'resolution reason',2000),head:input.expectedHead,time:Date.now()};this.notice(s,scope,repo.id,'resolved',{operationId:op.id,resolution:row.resolution});});
   return structuredClone(this.state.operations.find(o=>o.id===op.id)!);
  });
 }
 async configure(scope:GitScope,expected:number,requireReview:boolean){await this.repo(scope);await this.change(s=>{if(s.revision!==expected)failure('REVISION_CONFLICT','Git settings changed');s.repositories.find(r=>r.projectId===scope.projectId&&r.teamIds.includes(scope.teamId))!.requireReview=requireReview;});return this.snapshot(scope.teamId);}
 async dispose(){this.host.stop?.();await Promise.allSettled([...this.lanes.values()]);await this.noticeFlight?.catch(()=>{});await this.chain;this.closing=true;await this.writer?.close();this.writer=undefined;}
}
