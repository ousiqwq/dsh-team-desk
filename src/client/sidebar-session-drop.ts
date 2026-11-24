import {consumeDrag,dragStore,endDrag} from './drag.ts';

// The DSH drop zone is measured at dragstart, including where a closed sidebar
// would be. Hit-test the live dock instead so an opening or closing pane moves
// its drop target with the native animation.
export function installSidebarSessionDrop(
  doc:Document,
  inConversation:()=>boolean,
  mountedSession:()=>string|undefined,
  openAside:()=>((sessionId:string,paneId?:string)=>void)|undefined,
  label:()=>string,
){
  let marked:HTMLElement|undefined;
  function clear(){
    if(marked)delete marked.dataset.tdSidebarDrop;
    marked=undefined;
  }
  let listeners:AbortController|undefined;
  function stop(){
    listeners?.abort();
    listeners=undefined;
    doc.documentElement.removeAttribute('data-td-session-drag');
    clear();
  }
  function sync(){
    if(!dragStore.getSnapshot()||!inConversation()){stop();return;}
    if(listeners)return;
    listeners=new AbortController();
    const options={capture:true,signal:listeners.signal};
    doc.documentElement.setAttribute('data-td-session-drag','');
    for(const type of ['dragenter','dragover','drop'] as const)doc.addEventListener(type,handle,options);
    doc.addEventListener('dragleave',leave,options);
    doc.addEventListener('mousemove',release,options);
  }
  function handle(event:DragEvent){
    const drag=dragStore.getSnapshot();
    if(!drag)return;
    const element=event.target instanceof Element?event.target:null;
    const pane=element?.closest<HTMLElement>('[data-dockkit-pane], [data-dockkit-empty]');
    const panel=pane?.closest<HTMLElement>('[data-sidebar-right-panel][data-sidebar-right-open]');
    if(!pane||!panel||panel.dataset.sidebarRightSession!==mountedSession()||pane.closest('[hidden], [inert], [data-dockkit-float]')){
      clear();
      return;
    }
    const open=openAside();
    if(!open){clear();return;}
    event.preventDefault();
    event.stopPropagation();
    if(event.dataTransfer)event.dataTransfer.dropEffect='copy';
    if(event.type==='drop'){
      consumeDrag();
      open(drag.sessionId,pane.dataset.dockkitPane);
    }else if(pane!==marked){
      clear();
      marked=pane;
      pane.dataset.tdSidebarDrop=label();
    }
  }
  function leave(event:DragEvent){
    if(marked&&event.target instanceof Node&&marked.contains(event.target)&&
       !(event.relatedTarget instanceof Node&&marked.contains(event.relatedTarget)))clear();
  }
  // A source can unmount during a drop, taking the browser's dragend with it.
  function release(event:MouseEvent){if(!event.buttons)endDrag();}
  const off=dragStore.subscribe(sync);
  sync();
  return ()=>{off();stop();};
}
