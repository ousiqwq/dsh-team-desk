import { defineStore } from '@deepseek-ai/dsh-client-store';

export function createViewStore(){return defineStore({
  init:()=>({selected:'',maximized:'',showScope:false,showMessages:false}),
  actions:{select(s,id:string){s.selected=id;s.maximized='';},maximize(s,id:string){s.maximized=s.maximized===id?'':id;},scope(s){s.showScope=!s.showScope;},messages(s){s.showMessages=!s.showMessages;}},
});}
