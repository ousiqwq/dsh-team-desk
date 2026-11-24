// Read compatibility for exact title citations already present in a pre-upgrade backup.
import {UnsupportedHostBuild, readHostFile, reportHostError} from './host-compatibility.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { glob, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = data => createHash('sha256').update(data).digest('hex');
const originalHash = 'da0b0c2e1460316e659f48f4222730962046b3634d1fb634683bb7243a7bba80';
const [mode, root, manifest] = process.argv.slice(2);
function fingerprint(sessionId, title, message) {
  return digest(JSON.stringify([sessionId, title.type, title.seq, title.time, title.data, message.seq, message.time, message.data]));
}

async function fromBackup() {
  const entries = new Set();
  let sessions = 0, affected = 0;
  for await (const file of glob('*/*/session.v4.jsonl.zstd', { cwd: root })) {
    sessions++;
    const proc = spawn('zstd',['-qdc',join(root,file)],{stdio:['ignore','pipe','inherit']});
    const done = new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',code=>resolve(code));});
    const inputs = new Map();
    let sessionId, matched = false;
    for await (const line of createInterface({ input:proc.stdout, crlfDelay:Infinity })) {
      if (!sessionId) { sessionId = JSON.parse(line).id; if(!sessionId)throw Error('Missing session header');continue; }
      if (!/^\{"type":"(?:user\/message|session\/title(?:-llm-request)?)"/.test(line)) continue;
      const event = JSON.parse(line), data = event.data;
      if (event.type === 'user/message') {
        if (data.source?.kind !== 'agent-message' || !data.id?.startsWith('team-desk:')) continue;
        const header = data.content?.[0]?.text?.split('\n',1)[0];
        const match = /^\[Team Desk [^\n{]+ (\{.*\})\]$/.exec(header ?? '');
        if (!match)continue;
        let envelope;try{envelope=JSON.parse(match[1]);}catch{continue;}
        if (envelope.target===sessionId && envelope.sender===data.source.senderSessionId && 'team-desk:'+envelope.id===data.id) inputs.set(event.seq,event);
      } else {
        for(const seq of data.messageSeqs ?? []) {
          const message = inputs.get(seq);
          if(message && seq<event.seq){entries.add(fingerprint(sessionId,event,message));matched=true;}
        }
      }
    }
    if ((await done)!==0) throw Error('Unable to decode backup: '+file);
    if (matched) affected++;
  }
  if(!sessions)throw Error('No historical session files found');
  const record={version:1,sessions,affected,entries:[...entries].sort()};
  await writeFile(manifest,JSON.stringify(record)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({sessions,affected,citations:entries.size}));
}

const call = 'titleSources(this.artifact.events, event, data, this.knownEventTypes)';
const fn = 'function titleSources(events, event, data, knownEventTypes)';
const guard = 'record(record(source.data, "title input")["source"], "title input source")["kind"] !== "user"';
const specs=[[call,'titleSources(this.artifact.events, event, data, this.knownEventTypes, this.artifact.header.id)'],[fn,fn.replace('knownEventTypes)','knownEventTypes, sessionId)')],[guard,'('+guard+' && !tdArchivedTitle(sessionId,event,source))']];
const start='/* Team Desk archived title compatibility */',end='/* end Team Desk archived titles */\n';
const generatorHash='4960aeda1e558d833230c3c3a70b04ad0d9b937ee47754c5ff1b1fa18f0cfa92';
// Only a title already present in a native fork's inherited prefix may cite its ancestor.
const inheritedCall='this.artifact.header.id, this.artifact.inheritedEventCount)';
const currentReader=[
 ['this.knownEventTypes, this.artifact.header.id)', 'this.knownEventTypes, '+inheritedCall],
 ['knownEventTypes, sessionId) {','knownEventTypes, sessionId, inheritedCount) {'],
 ['!tdArchivedTitle(sessionId,event,source)','!tdAcceptTitleSource(sessionId,inheritedCount,event,source)']
];
const titleEdits=[
 ['function sessionTitleUserMessageOf(event) {','function sessionTitleUserMessageOf(event,target) {\n\tconst task=tdVerifiedTask(event,target);if(task)return task;'],
 ['function collectSessionTitleMessages(events, throughSeq)', 'function collectSessionTitleMessages(events, throughSeq, target)'],
 ['const message = sessionTitleUserMessageOf(event);\n\t\tif', 'const message = sessionTitleUserMessageOf(event,target);\n\t\tif'],
 ['collectSessionTitleMessages(events, work.throughSeq)', 'collectSessionTitleMessages(events, work.throughSeq, session.id)'],
 ['stateVersion: 3,\n\t\t\tstateSchema: titleInputStateSchema,\n\t\t\tinit: () => EMPTY_TITLE_INPUT,',
  'stateVersion: 4,\n\t\t\tstateSchema: titleInputStateSchema.safeExtend({tdTarget:z$1.string()}),\n\t\t\tinit: header => ({...EMPTY_TITLE_INPUT,tdTarget:header.id}),'],
 ['const message = sessionTitleUserMessageOf(event);\n\t\t\t\tif','const message = sessionTitleUserMessageOf(event,state.tdTarget);\n\t\t\t\tif'],
 ['first: state.first ?? message,\n\t\t\t\t\tcount: state.count + 1,\n\t\t\t\t\tlastSeq: message.seq',
  'tdTarget:state.tdTarget,first:state.first??message,count:state.count+1,lastSeq:message.seq'],
 ['event.data.source.kind !== "user" || sessionTitleUserMessageOf(event) === void 0','sessionTitleUserMessageOf(event,session.id) === void 0'],
];
function edit(text,edits){for(const [before,after] of edits){if(text.split(before).length!==2)throw Error('Unexpected title adapter anchor: '+before);text=text.replace(before,()=>after);}return text;}
function reverse(text,edits){for(const [before,after] of [...edits].reverse())text=text.replace(after,()=>before);return text;}
async function replaceFile(file,bytes){const temp=file+'.'+randomUUID();try{await writeFile(temp,bytes,{flag:'wx',mode:(await stat(file)).mode});await rename(temp,file);}finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
async function host() {
  const helper=await readFile(new URL('../dist/title-receipt.js',import.meta.url),'utf8');
  const files=[];
  for(const name of ['dsh-session-format-v3-to-v4','dsh-session-title']){
    const pkg=join(root,'node_modules/@deepseek-ai',name);
    const file=join(pkg,'lib/index.js'),current=await readHostFile(file);
    let original=current,desired,entries=[];
    if(name==='dsh-session-title'){
      if(original.startsWith(helper))original=reverse(original.slice(helper.length),titleEdits);
      if(digest(original)!==generatorHash)throw new UnsupportedHostBuild('Unexpected title service checksum');
      desired=mode==='--restore'||mode==='--read-only'?original:helper+edit(original,titleEdits);
    }else{
      if(original.startsWith(helper))original=original.slice(helper.length);
      if(original.startsWith(start)){
        const match=/const tdFrozen=new Set\((\[[^\n]*\])\);/.exec(original),stop=original.indexOf(end);
        if(stop<0||!match)throw Error('Incomplete title reader');
        entries=JSON.parse(match[1]);
        if(original.slice(stop+end.length).includes('!tdAcceptTitleSource('))original=reverse(original.slice(stop+end.length),currentReader);
        else original=original.slice(stop+end.length);
        original=reverse(original,specs);
      }
      if(digest(original)!==originalHash)throw new UnsupportedHostBuild('Unexpected session format package checksum');
      if(manifest){const data=JSON.parse(await readFile(manifest,'utf8'));if(data.version!==1||!Array.isArray(data.entries))throw Error('Invalid historical title manifest');entries=[...new Set([...entries,...data.entries])];}
      if(!Array.isArray(entries)||!entries.every(x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)))throw Error('Invalid historical title fingerprint');
      const prefix=start+'\nimport {createHash as tdHash} from "node:crypto";\nconst tdFrozen=new Set('+JSON.stringify(entries)+');\n'
        +'function tdArchivedTitle(s,t,m){return m.data.source.kind==="agent-message" && tdFrozen.has(tdHash("sha256").update(JSON.stringify([s,t.type,t.seq,t.time,t.data,m.seq,m.time,m.data])).digest("hex"));}\n'
        +'function tdAcceptTitleSource(sessionId,cut,event,source){let target=sessionId;\n'
        +'  if(event.seq<cut&&source.seq<cut){const line=source.data.content?.[0]?.text?.split("\\n",1)[0];const match=/^\\[Team Desk [^{]+ (\\{.*\\})\\]$/.exec(line??"");if(match){try{target=JSON.parse(match[1]).target;}catch{return false;}}}\n'
        +'  return tdArchivedTitle(target,event,source)||!!tdVerifiedTask(source,target); }\n'+end;
      desired=mode==='--restore'?original:helper+prefix+edit(edit(original,specs),currentReader);
    }
    files.push({file,current,desired});
  }
  if(mode==='--check'){console.log(files.map(f=>f.current===f.desired?'active':'inactive').join(', '));return;}
  const applied=[];
  try{for(const f of files)if(f.current!==f.desired){await replaceFile(f.file,f.desired);applied.push(f);}}
  catch(error){for(const f of applied.reverse())await replaceFile(f.file,f.current);throw error;}
}
if(!root||!['--inventory','--check','--apply','--read-only','--restore'].includes(mode))throw Error('Expected --inventory <backup-sessions> <manifest>, or --check/--apply/--read-only/--restore <host> [manifest]');
if(mode==='--inventory')await fromBackup();else await host().catch(reportHostError);
