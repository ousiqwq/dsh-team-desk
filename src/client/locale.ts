import type {Context} from '@deepseek-ai/cordis';
import type {LocaleRuntime} from '@deepseek-ai/dsh-client-locale/client';
import {zh,en} from './messages.ts';
export {zh,en};
export const NS='teamDesk' as const;
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap {teamDesk:keyof typeof zh;} }
let locale:LocaleRuntime|undefined;
export function installLocale(ctx:Context){
 const old=locale,release=ctx.locale.register(NS,{zh,en});locale=ctx.locale;
 return()=>{if(locale===ctx.locale)locale=old;release();};
}
export function tr(key:string,params?:Record<string,unknown>):string{
 if(locale)return locale.bind(NS)(key as keyof typeof zh,params);
 return params?key.replace(/\{(\w+)\}/g,(match,name:string)=>name in params?String(params[name]):match):key;
}
export function localeId():string {const id=locale?.getSnapshot().active??'zh';try{return new Intl.Locale(id==='zh'?'zh-CN':id==='pt'?'pt-BR':id).toString();}catch{return 'en';}}
const escapePattern=(value:string)=>[...value].map(c=>c===String.fromCharCode(92)||'^$.*+?()[]{}|'.includes(c)?String.fromCharCode(92)+c:c).join('');
const english:Record<string,string>=en,chinese:Record<string,string>=zh;
const patterns=Object.entries(zh).flatMap(([key,value])=>[value,english[key]].filter((text):text is string=>!!text&&/\{p\d+\}/.test(text)).map(text=>({key,names:[...text.matchAll(/\{(p\d+)\}/g)].map(m=>m[1]!),pattern:new RegExp('^'+text.split(/\{p\d+\}/).map(escapePattern).join('(.*?)')+'$','s')})));
/** Localize owned status messages; leave user content and unknown diagnostics verbatim. */
export function messageText(value:unknown):string{
 if(!value)return '';
 const item=value as {message?:string;localized?:{key:string;params?:Record<string,unknown>}};
 if(item.localized)return tr(item.localized.key,item.localized.params);
 const text=typeof value==='string'?value:item.message??String(value);
 if(Object.hasOwn(chinese,text))return tr(text);
 const reverse=Object.keys(english).find(k=>english[k]===text);if(reverse)return tr(reverse);
 const prefix=text.match(/^(?:Error: |[A-Z_]+: )/)?.[0]??'',body=text.slice(prefix.length);
 if(Object.hasOwn(chinese,body))return prefix+tr(body);
 for(const row of patterns){const match=row.pattern.exec(body);if(match)return prefix+tr(row.key,Object.fromEntries(row.names.map((n,i)=>[n,match[i+1]])));}
 return text;
}
