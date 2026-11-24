import type {Team,TeamPreset} from './types.ts';

export interface SeatSettings { mode?:string; permission?:string }
export interface SeatSelection { key:string; label:string; sessionId?:string; settings:SeatSettings }

export function seatSelections(team:Team,preset:TeamPreset,bindings:Record<string,string>,edit:boolean):SeatSelection[] {
 const result:SeatSelection[]=[];
 for(const slot of preset.members){
  if(!slot.native)continue;
  const id=bindings[slot.key];
  const previous=edit&&id&&team.configuration?.bindings[slot.key]===id
   ?team.configuration.preset.members.find(m=>m.key===slot.key)?.native:undefined;
  const settings:SeatSettings={};
  for(const field of ['mode','permission'] as const){
   const value=slot.native[field];
   if(value&&value!==previous?.[field])settings[field]=value;
  }
  if(Object.keys(settings).length)result.push({key:slot.key,label:slot.label,...(id?{sessionId:id}:{}),settings});
 }
 return result;
}

export function permissionConsent(seats:SeatSelection[]):string {
 const sensitive=seats.filter(s=>['auto','danger-full-access'].includes(s.settings.permission??''));
 return sensitive.length?JSON.stringify(sensitive.map(s=>[s.key,s.sessionId??null,s.settings.permission])):'';
}
