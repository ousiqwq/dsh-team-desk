import {readJson,writeJson,record} from './storage.ts';
import type {Layout} from './types.ts';
import {defaults,type Preferences} from './preference-values.ts';
export type {Preferences} from './preference-values.ts';
export class PreferencesStore{
 private value={...defaults};private queue:Promise<unknown>=Promise.resolve();constructor(private file:string){}
 async load(){const value=await readJson(this.file);if(value!==undefined)this.value=this.validate(record(value)?{...defaults,...value}:value);}
 snapshot(){return {...this.value};}
 private validate(value:unknown):Preferences{if(!record(value)||!['columns','rows','grid','four-columns'].includes(String(value.defaultLayout))||!['system','reduced'].includes(String(value.motion))||typeof value.snapPreview!=='boolean'||typeof value.showOtherPreviews!=='boolean')throw new Error('Invalid team preferences');return {defaultLayout:value.defaultLayout as Layout,motion:value.motion as Preferences['motion'],snapPreview:value.snapPreview,showOtherPreviews:value.showOtherPreviews};}
 async update(change:unknown){if(!record(change)||Object.keys(change).some(k=>!['defaultLayout','motion','snapPreview','showOtherPreviews'].includes(k)))throw new Error('Invalid preference');const next=this.queue.then(async()=>{const value=this.validate({...this.value,...change});await writeJson(this.file,value);this.value=value;});this.queue=next.catch(()=>{});return next;}
}
