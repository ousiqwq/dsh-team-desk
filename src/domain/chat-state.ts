import type {ArchivedKey,Message,State,Team} from './types.ts';

/** The conversation view displays team layout, synchronization receipts and blocked orders. */
export function chatState(state:State):State {
  const teams=state.teams.map(({history,changes,resourceIndex,shared,tasks,controls,taskHeads,controlKeys,...team})=>team);
  const blocked=new Set(teams.flatMap(t=>Object.values(t.runs??{}).filter(r=>r.phase==='blocked'&&r.epoch===t.epoch).flatMap(r=>r.requests)));
  const messages:Message[]=[];
  for(const m of state.messages){
    if(blocked.has(m.id)){messages.push(m);continue;}
    if(m.system)messages.push({id:m.id,teamId:m.teamId,sender:m.sender,target:m.target,state:m.state,time:m.time,
      key:'',text:'',system:true,...(m.epoch&&{epoch:m.epoch}),...(m.kind&&{kind:m.kind}),
      ...(m.syncKey&&{syncKey:m.syncKey}),...(m.syncSummary&&{syncSummary:m.syncSummary})});
  }
  return {version:state.version,revision:state.revision,teams,messages,archivedKeys:state.archivedKeys??[],presets:[],events:[]};
}
interface ListPatch<T> {rows:T[]; order?:string[];}
export interface ChatDelta {
  version:State['version'];revision:number;teams?:ListPatch<Team>;messages?:ListPatch<Message>;archivedKeys?:ListPatch<ArchivedKey>;
}
function changed<T extends {id:string}>(before:T[],after:T[],equal:(a:T,b:T)=>boolean):ListPatch<T>|undefined {
  const previous=new Map(before.map(row=>[row.id,row]));
  const rows=after.filter(row=>{const old=previous.get(row.id);return !old||!equal(old,row);});
  const reordered=before.length>after.length||before.some((row,i)=>row.id!==after[i]?.id);
  if(rows.length||reordered)return {rows,...(reordered&&{order:after.map(row=>row.id)})};
}
export function chatDelta(before:State,after:State,equal:(a:unknown,b:unknown)=>boolean):ChatDelta {
  const result:ChatDelta={version:after.version,revision:after.revision};
  const teams=changed(before.teams,after.teams,equal),messages=changed(before.messages,after.messages,equal);
  const archivedKeys=changed(before.archivedKeys??[],after.archivedKeys??[],equal);
  if(teams)result.teams=teams;if(messages)result.messages=messages;if(archivedKeys)result.archivedKeys=archivedKeys;
  return result;
}
function updateList<T extends {id:string}>(before:T[],patch?:ListPatch<T>):T[]{
  if(!patch)return before;
  const rows=new Map(before.map(row=>[row.id,row]));
  for(const row of patch.rows)rows.set(row.id,row);
  return patch.order?patch.order.map(id=>rows.get(id)!):Array.from(rows.values());
}
export function applyChatDelta(before:State,delta:ChatDelta):State {
  return {...before,version:delta.version,revision:delta.revision,teams:updateList(before.teams,delta.teams),
    messages:updateList(before.messages,delta.messages),archivedKeys:updateList(before.archivedKeys??[],delta.archivedKeys)};
}
