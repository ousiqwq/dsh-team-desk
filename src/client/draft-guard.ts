/** One navigation guard for all configuration editors in the dialog. */
export class DraftGuard {
 private entries=new Map<string,()=>void>();private listeners=new Set<()=>void>();private pending:(()=>void)|null=null;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 getSnapshot=()=>this.pending;
 get dirty(){return this.entries.size>0;}
 set(id:string,discard:(()=>void)|null){if(discard)this.entries.set(id,discard);else this.entries.delete(id);}
 request(action:()=>void){if(!this.dirty){action();return;}this.pending=action;this.emit();}
 cancel(){this.pending=null;this.emit();}
 discard(){const action=this.pending;this.pending=null;const resets=[...this.entries.values()];this.entries.clear();for(const reset of resets)reset();this.emit();action?.();}
 private emit(){for(const fn of this.listeners)fn();}
}
export const draftGuard=new DraftGuard();
