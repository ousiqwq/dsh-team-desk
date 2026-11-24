import { Service, type Context } from '@deepseek-ai/cordis';
import type { AgentHandle, AgentRegistry, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent';
import type { SessionId } from '@deepseek-ai/dsh-session';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-api-session-controller';
import { SessionId as nativeSessionId } from '@deepseek-ai/dsh-session';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { record, string, writeJson } from '../domain/storage.ts';

export interface Ownership { sessionId: string; provider: string; parent: string; label: string; position?:number; }
export interface OwnerProvider { create(options: CreateAgentOptions): Promise<AgentHandle>; resume(options: ResumeAgentOptions): Promise<AgentHandle>; relations?(): Ownership[]; }
interface Registration { factory: OwnerProvider; handles: Map<string, AgentHandle>; pending: Set<Promise<AgentHandle>>; stopping: boolean; }
declare module '@deepseek-ai/cordis' { interface Context { managedSessions: ManagedSessions; } }

/** Generic host extension. It remains installed when a session-owning plugin leaves. */
export class ManagedSessions extends Service {
  readonly protocol = 1;
  private rows: Ownership[] = [];
  private providers = new Map<string, Registration>();
  private chain: Promise<unknown> = Promise.resolve();
  private dataError: string | undefined;
  readonly file: string;
  constructor(ctx: Context) {
    super(ctx, 'managedSessions');
    this.file = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'managed-sessions', 'owners.v1.json');
    try {
      const data: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!record(data) || !Array.isArray(data.owners)) throw new Error('Invalid managed session registry');
      if(data.version!==1)this.dataError='Unsupported managed session registry version; data retained';
      for (const row of data.owners) {
        if (!record(row)) throw new Error('Invalid ownership');
        this.rows.push({sessionId:string(row.sessionId,'sessionId'),provider:string(row.provider,'provider'),parent:string(row.parent,'parent'),label:string(row.label,'label')});
      }
      if (new Set(this.rows.map(x=>x.sessionId)).size !== this.rows.length) throw new Error('Duplicate ownership');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) this.dataError=String(error);
    }
    ctx.inject(['connection'], scope => {
      scope.connection.fetch.register({path:'/api/managed-sessions.state',methods:['GET'],requestBody:'buffered',fetch:async()=>Response.json({protocol:1, owners:this.snapshot(),error:this.dataError})});
      scope.connection.fetch.register({path:'/api/managed-sessions.export',methods:['GET'],requestBody:'buffered',fetch:async(request)=>{
        try {const id=string(new URL(request.url).searchParams.get('sessionId'),'sessionId');if(!this.owned(id))throw new Error('Managed session not found');
          const persistence=scope.get('sessionPersistence');if(!persistence)throw new Error('Session history service unavailable');
          const sessionId=nativeSessionId(id),meta=await persistence.stat(sessionId);if(!meta)throw new Error('Session history not found');
          await persistence.flush();await using reader=await persistence.open(sessionId,'read');
          const events=[];for(let offset=0;;){const page=await reader.read(offset,512);if(!page.events.length)break;events.push(...page.events);offset+=page.events.length;}
          const history={header:meta.header,events};
          return new Response(JSON.stringify(history,null,2),{headers:{'content-type':'application/json','content-disposition':'attachment; filename="conversation.json"'}});
        }catch(error){return Response.json({error:String(error)},{status:400});}
      }});
      scope.connection.fetch.register({path:'/api/managed-sessions.release',methods:['POST'],requestBody:'streaming',fetch:async(request)=>{
        try { const data: unknown = await request.json(); if (!record(data)) throw new Error('Invalid request');
          const id=string(data.sessionId,'sessionId'),owner=this.owned(id);
          if(owner&&this.providers.has(owner.provider))throw new Error('Use the active manager to detach this session');
          await this.release(id); return Response.json({ok:true});
        } catch (error) { return Response.json({error:String(error)},{status:400}); }
      }});
    });
  }
  snapshot(): (Ownership & {available:boolean})[] {
    const rows = this.rows.map(row=>({...row,available:this.providers.has(row.provider) && !this.providers.get(row.provider)!.stopping}));
    for (const [provider, entry] of this.providers) {
      if (entry.stopping) continue;
      for (const link of entry.factory.relations?.() ?? []) {
        if (link.provider !== provider || link.sessionId === link.parent) continue;
        const owned = rows.find(r => r.sessionId === link.sessionId);
        if (owned) { if (owned.provider === provider && owned.parent === link.parent) {owned.label = link.label;Object.assign(owned,{position:link.position});} continue; }
        if (rows.some(r => r.sessionId === link.parent || r.parent === link.sessionId)) continue;
        rows.push({...link, available:true});
      }
    }
    return rows;
  }
  owned(id: string): Ownership | undefined { return this.rows.find(row=>row.sessionId===id); }
  assertAvailable(id: string): void {
    const owner=this.owned(id);
    if (owner && (!this.providers.has(owner.provider) || this.providers.get(owner.provider)!.stopping)) throw new Error(`Session manager ${owner.provider} is unavailable; history is retained`);
  }
  async claim(row: Ownership): Promise<void> {
    await this.mutate(async()=>{
      if(this.dataError)throw new Error(this.dataError);
      if (this.owned(row.sessionId)) throw new Error('Session already has a structural owner');
      if (row.sessionId === row.parent || this.owned(row.parent) || this.rows.some(x=>x.parent===row.sessionId)) throw new Error('Nested ownership cycle is not allowed');
      if (!this.providers.has(row.provider)) throw new Error('Session provider is unavailable');
      const next=[...this.rows, {...row}]; await writeJson(this.file,{version:1,owners:next}); this.rows=next;
    });
  }
  async release(id:string): Promise<void> {
    await this.mutate(async()=>{
      if(this.dataError)throw new Error(this.dataError);
      const row=this.owned(id); if (!row) return;
      const registration=this.providers.get(row.provider);
      const handle=registration?.handles.get(id);
      if (handle) { await handle.dispose(); registration!.handles.delete(id); }
      const next=this.rows.filter(x=>x.sessionId!==id);
      await writeJson(this.file,{version:1,owners:next}); this.rows=next;
    });
  }
  private mutate<T>(run:()=>Promise<T>):Promise<T>{ const job=this.chain.then(run); this.chain=job.catch(()=>{}); return job; }
  register(id:string, factory:OwnerProvider):()=>Promise<void>{
    if(this.dataError)throw new Error(this.dataError);
    if(this.providers.has(id))throw new Error(`Duplicate session provider ${id}`);
    const entry:Registration={factory,handles:new Map(),pending:new Set(),stopping:false}; this.providers.set(id,entry);
    return async()=>{
      entry.stopping=true;
      await Promise.allSettled([...entry.pending]);
      const results=await Promise.allSettled([...entry.handles.values()].map(h=>h.dispose()));
      entry.handles.clear(); this.providers.delete(id);
      const failed=results.find(r=>r.status==='rejected'); if(failed?.status==='rejected')throw failed.reason;
    };
  }
  factoryFor(id:SessionId,fallback:Pick<AgentRegistry,'create'|'resume'>):Pick<AgentRegistry,'create'|'resume'>{
    this.assertAvailable(id); const row=this.owned(id); if(!row)return fallback;
    const entry=this.providers.get(row.provider)!;
    const own=async(promise:Promise<AgentHandle>):Promise<AgentHandle>=>{
      entry.pending.add(promise);
      try { const handle=await promise;
        if(entry.stopping){ await handle.dispose(); throw new Error('Session manager stopped during activation'); }
        entry.handles.set(id,handle); return handle;
      } finally { entry.pending.delete(promise); }
    };
    return {create:options=>own(entry.factory.create(options)),resume:options=>own(entry.factory.resume(options))};
  }
}
