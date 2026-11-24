import type {Team} from '../domain/types.ts';
import {activeMember,visibleMembers} from './presentation.ts';
export interface TeamView {teamId:string;sessionId:string;maximized:string;split?:boolean;}
interface StorageLike {getItem(key:string):string|null;setItem(key:string,value:string):void;}
interface Views {version:1;current:TeamView|null;teams:TeamView[];}
const KEY='dsh.team-desk.views.v1';
function valid(value:unknown):value is TeamView {if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;return typeof v.teamId==='string'&&v.teamId.length>0&&typeof v.sessionId==='string'&&typeof v.maximized==='string';}
function read(storage?:StorageLike):Views|undefined {
 try {
  const raw=JSON.parse(storage?.getItem(KEY)??'null');
  if(raw?.version===1)return {version:1,current:valid(raw.current)?raw.current:null,teams:Array.isArray(raw.teams)?raw.teams.slice(-100).filter(valid):[]};
 } catch {}
}
function write(storage:StorageLike|undefined,views:Views){try{storage?.setItem(KEY,JSON.stringify(views));}catch{}}
/** The server owns the dock tree. Each tab owns its selection, with the shared view as a cold-start default. */
export class ViewMemory {
 private entries:Map<string,TeamView>;
 current:TeamView|null;
 constructor(private storage:StorageLike,private tab?:StorageLike){
  const local=read(tab),saved=local??read(storage)??{version:1 as const,current:null,teams:[]};
  this.entries=new Map(saved.teams.map(v=>[v.teamId,v]));this.current=saved.current;
  if(!local)write(tab,saved);
 }
 private save(changed?:TeamView){
  const views:Views={version:1,current:this.current,teams:[...this.entries.values()].slice(-100)};
  write(this.tab,views);
  if(!this.tab){write(this.storage,views);return;}
  const shared=read(this.storage)?.teams??[];
  const teams=changed?[...shared.filter(v=>v.teamId!==changed.teamId),changed].slice(-100):shared;
  write(this.storage,{...views,teams});
 }
 remember(view:TeamView){
  const previous=this.current;
  if(previous?.teamId===view.teamId&&previous.sessionId===view.sessionId&&previous.maximized===view.maximized&&this.hasSplit(view.teamId))return;
  this.current={...view};this.entries.delete(view.teamId);this.entries.set(view.teamId,this.current);this.save(this.current);
 }
 forget(teamId:string){
  this.entries.delete(teamId);
  if(this.current?.teamId===teamId)this.current=null;
  write(this.tab??this.storage,{version:1,current:this.current,teams:[...this.entries.values()]});
  if(this.tab){const shared=read(this.storage);if(shared)write(this.storage,{...shared,current:shared.current?.teamId===teamId?null:shared.current,teams:shared.teams.filter(t=>t.teamId!==teamId)});}
 }
 leave(){if(!this.current)return;this.current=null;this.save();}
 hasSplit(teamId:string){const entry=this.entries.get(teamId);return !!entry&&entry.split!==false;}
 preferSingle(teamId:string){
  const entry=this.entries.get(teamId),single=entry&&{...entry,split:false};
  if(single)this.entries.set(teamId,single);this.current=null;this.save(single);
 }
 forTeam(team:Team,requested?:string):TeamView{const old=this.entries.get(team.id),visible=visibleMembers(team),sessionId=activeMember(team,requested&&visible.includes(requested)?requested:old?.sessionId??'');return {teamId:team.id,sessionId,maximized:old?.maximized&&visible.includes(old.maximized)?sessionId:''};}
}
