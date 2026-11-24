import{useEffect,useMemo,useSyncExternalStore,type ComponentType}from'react';
import type{Context}from'@deepseek-ai/cordis';import type{SnapshotStore}from'@deepseek-ai/dsh-client-store';
import type{ChatNodeViewProps,ChatSnapshot}from'@deepseek-ai/dsh-client-ui-chat/client';import type{ViewData}from'./contracts.ts';import{SyncCard,SyncDeliveryCard}from'./SyncCard.tsx';import{syncMessageSource,type SyncMessageSource}from'./sync-message.ts';
import {deliveryGroups,type DeliveryGroup} from './sync-delivery-group.ts';
import type{Message}from'../domain/types.ts';
import type {SyncDeliveryHint} from '../domain/sync-summary.ts';
/** Use the public keyed node seats and delegate all other messages to the original native component. */
export function installSyncRenderers(ctx:Context,state:SnapshotStore<ViewData>):()=>void{
 // All mounted rows share one index per server snapshot. Focus, resizing and dialog
 // updates leave this data untouched.
 let previous:ViewData['state']|undefined, messages=new Map<string,Message>();
 let labels:Readonly<Record<string,string>>={},labelSignature='';
 // Chat publishes frequently during generation. Reuse the delivery index while the
 // ordered keys and durable context payloads of this step remain the same.
 let groupCache=new WeakMap<readonly string[],{recipient:string;nodes:ChatSnapshot['nodes']; groups:Map<string,DeliveryGroup>}>();
 // Only mounted historical receipts request an index. The archive is immutable, and
 // an archive/recipient pair may be shared by many rows in the same admission.
 let archiveByMessage=new Map<string,string>();
 const archived=new Map<string,Map<string,SyncDeliveryHint>>();
 const failedIndexes=new Set<string>(),pending=new Set<string>(),listeners=new Set<()=>void>(),abort=new AbortController();
 const mounted=new Map<string,{id:string;target:string;count:number}>();
 function retryIndexes(){
  if(document.visibilityState==='hidden')return;
  for(const [key,row] of mounted)if(failedIndexes.has(key))void loadArchiveIndex(row.id,row.target);
 }
 window.addEventListener('online',retryIndexes);window.addEventListener('focus',retryIndexes);
 document.addEventListener('visibilitychange',retryIndexes);
 function archiveKey(id:string,target:string){return id+':'+target;}
 async function loadArchiveIndex(id:string,target:string){
  const key=archiveKey(id,target);
  if(archived.has(key)||pending.has(key)||abort.signal.aborted)return;
  pending.add(key);
  try{
   const q=new URLSearchParams({id,sessionId:target,view:'sync-index',files:'names'});
   const response=await fetch('/api/team-desk.archive?'+q,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])});
   if(!response.ok)return;
   const rows:SyncDeliveryHint[]=await response.json();
   if(abort.signal.aborted||!Array.isArray(rows))return;
   archived.set(key,new Map(rows.filter(r=>r.target===target).map(r=>[r.id,r])));
   groupCache=new WeakMap();
   failedIndexes.delete(key);
  }catch{ /* Keep each original receipt visible if its archive cannot be read. */ }
  finally{
   pending.delete(key);
   if(!abort.signal.aborted){
    if(!archived.has(key))failedIndexes.add(key);
    for(const listener of listeners)listener();
   }
  }
 }
 function stepGroups(chat:ChatSnapshot,keys:readonly string[],recipient:string){
  let cached=groupCache.get(keys);
  if(!cached||cached.nodes!==chat.nodes||cached.recipient!==recipient){
   cached={recipient,nodes:chat.nodes,groups:deliveryGroups(keys,key=>chat.nodes.get(key),recipient,messages,id=>{
    const archive=archiveByMessage.get(id);
    return archive?archived.get(archiveKey(archive,recipient))?.get(id):undefined;
   })};
   groupCache.set(keys,cached);
  }
  return cached.groups;
 }
 function index(){
  const view=state.getSnapshot();
  // The editor fetches scoped records. Preserve the conversation index behind its overlay.
  if(view.snapshotView==='manage'&&previous)return;
  const data=view.state;
  if(data!==previous){
   groupCache=new WeakMap();
   messages=new Map(data.messages.map(m=>[m.id,m]));
   archiveByMessage=new Map(data.archivedKeys?.map(m=>[m.id,m.archive]));
   const entries=data.teams.flatMap(t=>t.members.map(m=>[m.sessionId,m.label]));
   const signature=JSON.stringify(entries);
   if(signature!==labelSignature){labels=Object.fromEntries(entries);labelSignature=signature;}
   previous=data;
  }
 }
 const detach=ctx.slots.inject('conversation.chat.node',function*(){
  for(const key of ['context','turn-trigger'] as const){
   const base=ctx.slots.entries('conversation.chat.node').filter(e=>e.options.key===key).sort((a,b)=>(a.options.priority??0)-(b.options.priority??0))[0];if(!base||base.locale!=='chat'||base.inject||base.store||base.children)continue;
   const Native=base.component as ComponentType<ChatNodeViewProps<typeof key>>;
   type Props=ChatNodeViewProps<typeof key>;
   function TeamNotice({props,message}:{props:Props;message:SyncMessageSource}){
    const chatSource=useMemo(()=>{
     const live=ctx.sessions.binding(props.sessionId);
     return live?ctx.uiConversation.binding(live).snapshot:undefined;
    },[props.sessionId]);
    const location=props.node.location;
    const turn=location.kind==='step'?location.turn.turn:undefined,step=location.kind==='step'?location.step.step:undefined;
    const select=useMemo(()=>{
     let cached:{labels:typeof labels;stored:Message|undefined;archive:string|undefined;waiting:boolean;hint:SyncDeliveryHint|undefined;group:DeliveryGroup|undefined}|undefined;
     return ()=>{
      index();
      const stored=messages.get(message.id),chat=chatSource?.getSnapshot().views.get('chat');
      const archive=!stored&&key==='context'?archiveByMessage.get(message.id):undefined;
      const lookup=archive && archiveKey(archive,message.target);
      const archiveIndex=lookup?archived.get(lookup):undefined;
      const waiting=!!lookup&&!archiveIndex&&!failedIndexes.has(lookup);
      const hint=archiveIndex?.get(message.id);
      const group=key==='context'&&chat?.locations?.getStep&&turn!==undefined&&step!==undefined
       ?stepGroups(chat,chat.locations.getStep(turn,step),message.target).get(props.node.key):undefined;
      if(!cached||labels!==cached.labels||stored!==cached.stored||group!==cached.group||archive!==cached.archive||hint!==cached.hint||waiting!==cached.waiting)cached={labels,stored,group,archive,hint,waiting};
      return cached;
     };
    },[chatSource,message.id,message.target,props.node.key,turn,step]);
    const subscribe=useMemo(()=>(listener:()=>void)=>{
     const offState=state.subscribe(listener),offChat=chatSource?.subscribe(listener);
     listeners.add(listener);
     return ()=>{offState();offChat?.();listeners.delete(listener);};
    },[chatSource]);
    const view=useSyncExternalStore(subscribe,select,select),stored=view.stored;
    useEffect(()=>{
     if(!view.archive)return;
     const key=archiveKey(view.archive,message.target);
     const row=mounted.get(key)??{id:view.archive,target:message.target,count:0};
     row.count++;mounted.set(key,row);void loadArchiveIndex(row.id,row.target);
     return ()=>{if(--row.count===0)mounted.delete(key);};
    },[view.archive,message.target]);
    if(view.waiting)return <span hidden data-td-sync-index-pending/>;
    if(view.group)return view.group[0]!.key===props.node.key
     ?<SyncDeliveryCard group={view.group} labels={view.labels}/>
     :<span hidden data-td-sync-group-member/>;
    if(stored&&(!stored.system||stored.target!==message.target||stored.sender!==message.sender))return <Native {...props}/>;
    return <SyncCard message={message} labels={view.labels} stored={stored} hint={view.hint} time={props.node.data.time} phase={key}/>;
   }
   function SyncNode(props:Props){
    const data=props.node.data;
    const message=useMemo(()=>syncMessageSource(data.content,data.source,props.sessionId),[data.content,data.source,props.sessionId]);
    return message?<TeamNotice key={props.sessionId+':'+message.id} props={props} message={message}/>:<Native {...props}/>;
   }
   if(key==='context')yield ctx.slots.register({name:'conversation.chat.node',key:'context',priority:(base.options.priority??0)-1,locale:'chat'},(props:ChatNodeViewProps<'context'>)=><SyncNode {...props}/>);
   else yield ctx.slots.register({name:'conversation.chat.node',key:'turn-trigger',priority:(base.options.priority??0)-1,locale:'chat'},(props:ChatNodeViewProps<'turn-trigger'>)=><SyncNode {...props}/>);
  }
 });
 return ()=>{detach();window.removeEventListener('online',retryIndexes);window.removeEventListener('focus',retryIndexes);document.removeEventListener('visibilitychange',retryIndexes);abort.abort();mounted.clear();listeners.clear();archived.clear();failedIndexes.clear();};
}
