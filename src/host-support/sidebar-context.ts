export interface SessionSource {getSnapshot():string|undefined;subscribe(listener:()=>void):()=>void;}
/** Per-panel leases: an extension can name a native sidebar session without replacing its renderer. */
export class SidebarContexts {
 private entries=new Map<string,{source:SessionSource;stop:()=>void}>();private listeners=new Set<()=>void>();
 private lastPanel:string|null=null;private lastSession:string|undefined;private expansions=new Map<string,boolean>();
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private emit(){for(const fn of this.listeners)fn();}
 register(panel:string,source:SessionSource){if(!panel||panel==='conversation'||this.entries.has(panel))throw Error('Sidebar context already registered or reserved');const entry={source,stop:source.subscribe(()=>this.emit())};this.entries.set(panel,entry);this.emit();return()=>{if(this.entries.get(panel)!==entry)return;entry.stop();this.entries.delete(panel);this.emit();};}
 has(panel:string|null){return panel!==null&&this.entries.has(panel);}
 select(panel:string|null,native:string|undefined,expanded:boolean){const id=panel===null?native:this.entries.get(panel)?.source.getSnapshot();if(this.has(panel)&&panel===this.lastPanel&&id&&id!==this.lastSession)this.expansions.set(id,expanded);this.lastPanel=panel;this.lastSession=id;return id;}
 takeExpansion(id:string){const value=this.expansions.get(id);this.expansions.delete(id);return value;}
 dispose(){for(const e of this.entries.values())e.stop();this.entries.clear();this.expansions.clear();this.emit();this.listeners.clear();}
}
