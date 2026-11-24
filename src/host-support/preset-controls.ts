interface Retention {retainedBy:Readonly<Partial<Record<string,number>>>;}
interface Summary {origin?:string;}
interface Stage {id:string|undefined;introduce:boolean;}
/** Ordinary team members use the same native mode controller as the main view. */
export function controls(summary:Summary|undefined,info:Retention):boolean {
 return summary!==undefined&&summary.origin!=='subagent'&&retained(info);
}
export function retained(info:Retention|undefined):boolean {
 return (info?.retainedBy.mainView??0)>0||(info?.retainedBy.teamDesk??0)>0;
}
/** A mode pick in one docked member must not become another member's staged choice. */
export function stage(info:Retention,shared:Stage):Stage {
 return (info.retainedBy.teamDesk??0)>0?{id:undefined,introduce:false}:shared;
}
