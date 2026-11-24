import type {Point} from '../domain/graph-layout.ts';

export interface Camera extends Point { zoom:number }
export const INSPECTOR_DEFAULT=340;
export const INSPECTOR_KEY='dsh:team-desk:graph-inspector-width:v1';
export function inspectorBounds(width:number){
 return {min:260,max:Math.max(260,Math.min(640,width-256)),stacked:width<660};
}
export function inspectorWidth(preferred:number,width:number){
 const {min,max}=inspectorBounds(width);
 return Math.min(max,Math.max(min,Number.isFinite(preferred)?preferred:INSPECTOR_DEFAULT));
}
export function readInspectorWidth(storage:Pick<Storage,'getItem'>){
 try{const raw=storage.getItem(INSPECTOR_KEY),value=Number(raw);return raw&&Number.isFinite(value)&&value>=260&&value<=640?value:INSPECTOR_DEFAULT;}catch{return INSPECTOR_DEFAULT;}
}
export function writeInspectorWidth(storage:Pick<Storage,'setItem'>,value:number){
 try{storage.setItem(INSPECTOR_KEY,String(inspectorWidth(value,10000)));}catch{/* A blocked storage must not disable the editor. */}
}
export function graphPoint(point:Point,camera:Camera):Point{
 return {x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom};
}
export function zoomCamera(camera:Camera,zoom:number,focus:Point):Camera{
 zoom=Math.max(.1,Math.min(1.6,zoom));const p=graphPoint(focus,camera);
 return {x:focus.x-p.x*zoom,y:focus.y-p.y*zoom,zoom};
}
export function fitCamera(view:{width:number;height:number},graph:{width:number;height:number}):Camera{
 const zoom=Math.max(.1,Math.min(1,Math.max(1,view.width-24)/graph.width,Math.max(1,view.height-24)/graph.height));
 return {zoom,x:(view.width-graph.width*zoom)/2,y:(view.height-graph.height*zoom)/2};
}
