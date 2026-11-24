import type {Context} from '@deepseek-ai/cordis';
import type {LocaleRuntime} from '@deepseek-ai/dsh-client-locale/client';
const zh={team:'团队会话',collapse:'收起',expand:'展开',unavailable:'管理插件不可用',export:'导出历史',release:'转为普通会话',confirm:'转为普通会话并保留历史？',service:'会话归属服务不可用',protocol:'会话归属接口版本不兼容'};
const en={team:'Team conversation',collapse:'Collapse',expand:'Expand',unavailable:'Manager plugin unavailable',export:'Export history',release:'Convert to ordinary conversation',confirm:'Convert to an ordinary conversation and keep its history?',service:'Conversation ownership service unavailable',protocol:'Incompatible conversation ownership protocol'};
const NS='managedSessions';
declare module '@deepseek-ai/dsh-client-ui-slots' {interface LocaleNamespaceMap {managedSessions:keyof typeof zh;}}
let locale:LocaleRuntime|undefined;
export function installManagedLocale(ctx:Context){const release=ctx.locale.register(NS,{zh,en});locale=ctx.locale;return()=>{locale=undefined;release();};}
export function mt(key:keyof typeof zh){return locale?.bind(NS)(key)??zh[key];}
