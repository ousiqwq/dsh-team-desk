/** UI-only projection shared by the native workspace list and right sidebar. */
export interface TeamWorkspaceView {
  seat?: string|undefined;
  session?: string|undefined;
  expansion: Readonly<Record<string,boolean>>;
}
const storageKey='dsh.managed-session.expansion.v1';
export function workspaceView(events:EventTarget,storage:Pick<Storage,'getItem'|'setItem'>) {
  let expansion:Record<string,boolean>={};
  try {
    const saved=JSON.parse(storage.getItem(storageKey)??'{}');
    expansion=Object.fromEntries(Object.entries(saved).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>;
  }catch{}
  let view:TeamWorkspaceView={expansion};
  const notify=()=>events.dispatchEvent(new Event('dsh:team-view-change'));
  const saveExpansion=(id:string,open:boolean)=>{
    expansion={...expansion,[id]:open};
    try{storage.setItem(storageKey,JSON.stringify(expansion));}catch{}
  };
  const read=(e:Event)=>{(e as CustomEvent<{view?:TeamWorkspaceView}>).detail.view=view;};
  events.addEventListener('dsh:team-view-read',read);
  return {
    get:()=>view,
    focus(seat?:string,session?:string,parent?:string){
      if(view.seat===seat&&view.session===session)return;
      if(view.seat!==seat&&parent&&expansion[parent]===false)saveExpansion(parent,true);
      view={expansion,seat,session};notify();
    },
    toggle(id:string){
      saveExpansion(id,expansion[id]===false);
      view={...view,expansion};notify();
    },
    dispose(){events.removeEventListener('dsh:team-view-read',read);notify();},
  };
}
