import {fitDock,type DockNode}from'../domain/docking.ts';
/** Keep live pixels for pointer operations; only publish when the fitted split changes. */
export class DockMeasurement{
 width=1200;height=800;
 update(tree:DockNode|null,width:number,height:number):boolean{
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return false;
  if(width===this.width&&height===this.height)return false;
  const before=fitDock(tree,this.width,this.height);this.width=width;this.height=height;
  return JSON.stringify(before)!==JSON.stringify(fitDock(tree,width,height));
 }
}
