import {createSnapshotStore} from '@deepseek-ai/dsh-client-store';
export interface DraggedSession{sessionId:string;title:string;source:'sidebar'|'pane';}
export const dragStore=createSnapshotStore<DraggedSession|null>(null);
export function beginDrag(value:DraggedSession){dragStore.set(value);}
export function endDrag(){dragStore.set(null);}
// DSH treats a copy drop from a sidebar row as claimed by another surface.
// The native list then discards its last hover marker instead of reordering rows.
export function dockDropEffect(drag:DraggedSession){return drag.source==='sidebar'?'copy':'move';}
export function consumeDrag(){window.dispatchEvent(new Event('dsh:managed-drag-consumed'));endDrag();}
