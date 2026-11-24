export interface GitRunOptions {env?:Record<string,string|undefined>;input?:string;allow?:number[];signal?:AbortSignal;}
export interface GitHost {
 stop?():void;
 removeTemporaryIndex?(actor:string,path:string):Promise<void>;
 readWorkingFile?(actor:string,root:string,path:string,limit:number,signal?:AbortSignal):Promise<{kind:"bytes";bytes:Uint8Array}|{kind:"missing"|"unsafe"|"unchecked"}>;
 run(actor:string,cwd:string,args:string[],options?:GitRunOptions):Promise<{stdout:string;stderr:string;exitCode:number}>;
 cwd(actor:string):Promise<string>;
 worktree(actor:string,request:{name?:string;from?:string},signal?:AbortSignal,sourcePath?:string):Promise<{path:string;branch:string;baseCommit:string;repositoryRoot:string}>;
}
export interface GitScope {memberSessionId?:string;actor:string;teamId:string;projectId:string;projectRoot:string;signal?:AbortSignal;epoch?:string;}
export interface GitRepository {id:string;teamIds:string[];projectId:string;projectRoot:string;root:string;commonDir:string;prefix:string;defaultTarget:string;requireReview:boolean;}
export interface GitCheckout {teamId?:string;repositoryId:string;sessionId:string;path:string;branch:string;baseline:string;}
export interface GitReview {protocol?:2;memberSessionId?:string;id:string;actor:string;sourceSha:string;targetSha:string;outcome:'comment'|'passed'|'changes_requested';note:string;evidence:string[];time:number;}
export interface GitProposal {memberSessionId?:string;id:string;revision:number;repositoryId:string;teamId:string;actor:string;sourceSha:string;sourceRef:string;targetSha:string;targetRef:string;summary:string;evidence:string[];reviews:GitReview[];createdAt:number;integratedSha?:string;}
export interface GitOperation {id:string;key:string;fingerprint:string;actor:string;teamId:string;repositoryId:string;action:string;path:string;expectedHead:string;request:Record<string,unknown>;time:number;state:'prepared'|'completed'|'uncertain'|'failed'|'resolved';result?:unknown;error?:string;resolution?:{actor:string;reason:string;head:string;time:number};}
export interface GitNotice {memberSessionId?:string;id:string;teamId:string;projectId:string;epoch?:string;actor:string;action:string;repositoryId:string;payload:unknown;time:number;deliveredAt?:number;}
export interface GitArchive {version:1;teamId:string;projectId:string;time:number;operations:GitOperation[];proposals:GitProposal[];notices:GitNotice[];}
export interface GitArchiveRef {id:string;sha256:string;teamId:string;projectId:string;time:number;operations:Pick<GitOperation,'id'|'key'|'actor'|'teamId'|'fingerprint'>[];proposalCount:number;}
export interface GitState {archives?:GitArchiveRef[];notices?:GitNotice[];version:2;revision:number;repositories:GitRepository[];checkouts:GitCheckout[];proposals:GitProposal[];operations:GitOperation[];}
export interface GitStatus {repository:GitRepository;path:string;head:string;branch:string;files:{status:string;path:string;from?:string}[];busy:string[];sharedWith:string[];targets:{ref:string;sha:string}[];}
