import {mkdir,readdir,readFile,unlink} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {writeJson} from '../domain/storage.ts';import type {ChangeDetails,ObservationOrigin} from '../domain/types.ts';import type {TeamEngine} from '../domain/engine.ts';
export interface ObservedChange {origin?:ObservationOrigin|undefined;caller:string;resource:string;version:string;summary:string;details:ChangeDetails;}
export interface SyncIntent {caller:string;origin:ObservationOrigin;callId?:string;tool?:string;evidence:string;}
export type IntentRecovery={kind:'changed';items:ObservedChange[];complete?:boolean}|{kind:'unchanged';evidence:string}|{kind:'unknown'};
export type RecoverIntent=((intent:SyncIntent)=>Promise<IntentRecovery>) & {
  batch?:(intents:SyncIntent[])=>Promise<IntentRecovery[]>;
};
/** Durable recovery records bridge successful native writes and the plugin snapshot.
 * A lost write before this observer is not reconstructible; never invent missing history. */
export class SyncJournal {
  private replayScope:string|undefined;
  private replaying:Promise<void>|undefined;
  private active=new Set<string>();
  private closed=false;
  constructor(private readonly directory:string,private readonly engine:TeamEngine,private readonly recover?:RecoverIntent|undefined){}
  private async commit(item:ObservedChange){if(!item.origin)throw Error('OBSERVATION_SCOPE: 原始团队信息缺失，保留记录供核对');await this.engine.reportChange(item.caller,item.resource,item.version,item.summary,'native-file',item.details,item.origin);}
  async record(item:ObservedChange):Promise<void>{
    if(this.closed)throw Error('Sync journal is closed');
    item={...item,origin:item.origin??this.engine.observationOrigin(item.caller,item.resource)};
    const id=randomUUID()+'.json',path=join(this.directory,id);this.active.add(id);
    try{await writeJson(path,{version:2,item});await this.commit(item);await unlink(path);}finally{this.active.delete(id);}
  }
  async begin(caller:string,origin:ObservationOrigin,callId:string,tool?:string):Promise<string>{
    const id='attempt-'+randomUUID()+'.json';this.active.add(id);try{await writeJson(join(this.directory,id),{version:2,kind:'native-write-intent',caller,origin,callId,...(tool?{tool}:{}),evidence:'dsh://'+(origin.actorSessionId??caller)+'/call/'+callId});return id;}catch(error){this.active.delete(id);throw error;}
  }
  async end(id:string):Promise<void>{if(!/^attempt-[-a-f0-9]{36}\.json$/.test(id))throw Error('Invalid journal id');await unlink(join(this.directory,id));this.active.delete(id);}
  releaseAttempt(id:string):void{this.active.delete(id);}
  async inspect(){await mkdir(this.directory,{recursive:true,mode:0o700});const rows=[];for(const id of (await readdir(this.directory)).filter(x=>!this.active.has(x)&&/^(?:attempt-)?[-a-f0-9]{36}\.json$/.test(x))){try{const value=JSON.parse(await readFile(join(this.directory,id),'utf8'));rows.push({id,resource:value.item?.resource??'原生写入结果待核对',origin:value.item?.origin??value.origin});}catch{rows.push({id,resource:'记录格式待核对'});}}return rows;}
  async exportRecord(id:string){if(!/^(?:attempt-)?[-a-f0-9]{36}\.json$/.test(id))throw Error('Invalid journal id');return readFile(join(this.directory,id),'utf8');}
  private async finishIntent(name:string,intent:SyncIntent,result:IntentRecovery){
    if(result.kind==='changed'){
      if(!result.items.length)throw Error('Empty recovery evidence');
      const missing:ObservedChange[]=[];
      for(const item of result.items){if(item.caller!==intent.caller||item.origin?.teamId!==intent.origin.teamId||item.origin.epoch!==intent.origin.epoch||intent.origin.id&&item.origin.id!==intent.origin.id||intent.origin.actorSessionId&&item.origin.actorSessionId!==intent.origin.actorSessionId)throw Error('Recovery scope mismatch');if(!await this.engine.observedChangeExists(item.caller,item.resource,item.version,item.origin))missing.push(item);}
      if(intent.origin.id)await this.engine.recordNativeBatch(missing);else for(const item of missing)await this.commit(item);
      if(result.complete!==false)await unlink(join(this.directory,name));
    }else if(result.kind==='unchanged'&&result.evidence)await unlink(join(this.directory,name));
  }
  replay(teamId?:string):Promise<void>{
    if(this.closed)return Promise.resolve();
    if(this.replaying)return teamId===this.replayScope?this.replaying:this.replaying.then(()=>this.replay(teamId));
    this.replayScope=teamId;
    this.replaying=(async()=>{
      let failed=false;
      await mkdir(this.directory,{recursive:true,mode:0o700});
      const inScope=teamId?new Set((await this.inspect()).filter(row=>row.origin?.teamId===teamId).map(row=>row.id)):undefined;
      const groups=new Map<string,{name:string;intent:SyncIntent}[]>();
      for(const name of await readdir(this.directory))if(/^attempt-[-a-f0-9]{36}\.json$/.test(name)&&!this.active.has(name)&&(!inScope||inScope.has(name))&&this.recover){
        this.active.add(name);
        try{
          const intent=JSON.parse(await readFile(join(this.directory,name),'utf8')) as SyncIntent;
          if(teamId&&intent.origin?.teamId!==teamId){this.active.delete(name);continue;}
          if(!intent.origin?.teamId||!intent.origin.epoch||!intent.caller)throw Error('Invalid native write intent');
          const actor=intent.origin.actorSessionId??intent.caller;
          const group=groups.get(actor)??[];group.push({name,intent});groups.set(actor,group);
        }catch(error){this.active.delete(name);failed=true;this.engine.syncFailure(error);}
      }
      for(const group of groups.values()){
        try{
          const results=this.recover!.batch?await this.recover!.batch(group.map(row=>row.intent)):undefined;
          for(const [index,{name,intent}] of group.entries()){
            try{
              const result=results?results[index]!:await this.recover!(intent);
              await this.finishIntent(name,intent,result);
            }catch(error){failed=true;this.engine.syncFailure(error);}
          }
        }catch(error){failed=true;this.engine.syncFailure(error);}
        finally{for(const {name} of group)this.active.delete(name);}
      }
      for(const name of await readdir(this.directory))if(/^[-a-f0-9]{36}\.json$/.test(name)&&!this.active.has(name)&&(!inScope||inScope.has(name))){
        this.active.add(name);
        try{const data=JSON.parse(await readFile(join(this.directory,name),'utf8'));if(teamId&&data.item?.origin?.teamId!==teamId)continue;if(![1,2].includes(data.version)||typeof data.item?.caller!=='string'||typeof data.item?.resource!=='string')throw Error('Invalid pending change journal');
          if(!data.item.origin)throw Error('OBSERVATION_SCOPE: legacy/detached observation has no original scope; retained for inspection');
          if(!await this.engine.observedChangeExists(data.item.caller,data.item.resource,data.item.version,data.item.origin))await this.commit(data.item);await unlink(join(this.directory,name));
        }catch(error){failed=true;this.engine.syncFailure(error);}finally{this.active.delete(name);}
      }
      if(teamId){if(!failed&&!this.active.size&&!(await this.inspect()).length)this.engine.syncRecovered();return;}
      if((await readdir(this.directory)).some(x=>x.startsWith('attempt-')&&!this.active.has(x))) {failed=true;this.engine.syncFailure('原生写入存在未确认结果，请在协作记录下载对应调用记录核对');}if(!failed)this.engine.syncRecovered();
    })().finally(()=>{this.replaying=undefined;});return this.replaying;
  }
  /** Called after native observers have stopped and their writes have drained. */
  async drain():Promise<void>{this.closed=true;await this.replaying;}
}
