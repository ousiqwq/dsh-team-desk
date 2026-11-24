import type {CoordinationPolicy,MessageOptions,Team,DataSchema,State} from './types.ts';
import {jsonValue,normalizeOptions,eventCode} from './coordination.ts';
import {CoordinationError} from './errors.ts';
function record(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v);}
function fail(message:string):never{throw new CoordinationError('SCHEMA_INVALID',message);};
/** Deliberately bounded data-only schema: no references, code, regex or filesystem access. */
export function validateSchema(schema:unknown,depth=0):asserts schema is DataSchema{
 if(depth>8||!record(schema)||Object.keys(schema).some(k=>!['type','enum','properties','required','additionalProperties','items','minimum','maximum','minLength','maxLength','minItems','maxItems','description'].includes(k)))fail('不支持的结构声明');
 if(!['object','array','string','number','integer','boolean','null'].includes(String(schema.type)))fail('必须声明数据类型');
 if(schema.description!==undefined&&(typeof schema.description!=='string'||schema.description.length>1000))fail('无效的说明');
 if(schema.enum!==undefined){if(!Array.isArray(schema.enum)||!schema.enum.length||schema.enum.length>50)fail('枚举最多 50 项');jsonValue(schema.enum);}
 for(const k of ['minimum','maximum','minLength','maxLength','minItems','maxItems'])if(schema[k]!==undefined&&(typeof schema[k]!=='number'||!Number.isFinite(schema[k])||(!['minimum','maximum'].includes(k)&&(!Number.isSafeInteger(schema[k])||Number(schema[k])<0))))fail('无效的数据边界');
 for(const [a,b]of [['minimum','maximum'],['minLength','maxLength'],['minItems','maxItems']])if(schema[a!]!==undefined&&schema[b!]!==undefined&&Number(schema[a!])>Number(schema[b!]))fail('声明的最小值大于最大值');
 if(['minimum','maximum'].some(k=>schema[k]!==undefined)&&!['number','integer'].includes(String(schema.type))||['minLength','maxLength'].some(k=>schema[k]!==undefined)&&schema.type!=='string'||['minItems','maxItems'].some(k=>schema[k]!==undefined)&&schema.type!=='array'||['required','additionalProperties'].some(k=>schema[k]!==undefined)&&schema.type!=='object')fail('结构限制与类型不匹配');
 if(schema.properties!==undefined){if(schema.type!=='object'||!record(schema.properties)||Object.keys(schema.properties).length>50)fail('无效的对象属性');for(const [k,s]of Object.entries(schema.properties)){if(['__proto__','prototype','constructor'].includes(k))fail('保留的属性');validateSchema(s,depth+1);}}
 if(schema.required!==undefined&&(!Array.isArray(schema.required)||schema.required.some(k=>typeof k!=='string'||!record(schema.properties)||!Object.hasOwn(schema.properties,k))))fail('required 必须引用声明的属性');
 if(schema.additionalProperties!==undefined&&typeof schema.additionalProperties!=='boolean')fail('additionalProperties 仅接受布尔值');
 if(schema.items!==undefined){if(schema.type!=='array')fail('items 仅用于数组');validateSchema(schema.items,depth+1);}
}
export function checkValue(schema:DataSchema,value:unknown,path='value'):void{
 const type=schema.type,ok=type==='null'?value===null:type==='array'?Array.isArray(value):type==='object'?record(value):type==='integer'?Number.isSafeInteger(value):typeof value===type;
 if(!ok)fail(path+' 的类型应为 '+type);
 if(schema.enum&&!schema.enum.some(x=>JSON.stringify(x)===JSON.stringify(value)))fail(path+' 不在枚举中');
 if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))fail(path+' 超出数值范围');
 if(typeof value==='string'&&(value.length<(schema.minLength??0)||value.length>(schema.maxLength??12000)))fail(path+' 长度超出范围');
 if(Array.isArray(value)){if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??1000))fail(path+' 数量超出范围');if(schema.items)value.forEach((v,i)=>checkValue(schema.items!,v,`${path}[${i}]`));}
 if(record(value)){for(const k of schema.required??[])if(!Object.hasOwn(value,k))fail(path+' 缺少 '+k);for(const [k,v]of Object.entries(value)){const child=schema.properties&&Object.hasOwn(schema.properties,k)?schema.properties[k]:undefined;if(child)checkValue(child,v,path+'.'+k);else if(schema.additionalProperties!==true)fail(path+' 未声明属性 '+k);}}
}
export function validateDefinitions(policy:CoordinationPolicy):void{
 if(policy.events!==undefined){if(!Array.isArray(policy.events)||policy.events.length>100)fail('事件最多 100 项');const codes=new Set<string>();for(const d of policy.events){if(!record(d)||Object.keys(d).some(k=>!['code','version','label','description','schema','defaults'].includes(k))||!eventCode(d.code)||codes.has(d.code)||!Number.isSafeInteger(d.version)||d.version<1||typeof d.label!=='string'||!d.label||d.label.length>120||typeof d.description!=='string'||d.description.length>2000)fail('无效或重复的事件定义');codes.add(d.code);if(d.schema)validateSchema(d.schema);if(d.defaults){if(!record(d.defaults)||Object.keys(d.defaults).some(k=>!['priority','delivery','wakeup','ttlMs'].includes(k)))fail('无效的事件默认投递');normalizeOptions({kind:'event',...d.defaults});}}}
 if(policy.variables!==undefined){if(!record(policy.variables)||Object.keys(policy.variables).length>100)fail('变量最多 100 项');for(const [key,d]of Object.entries(policy.variables)){if(!/^[-a-zA-Z0-9_.]{1,100}$/.test(key)||['__proto__','prototype','constructor'].includes(key)||!record(d)||Object.keys(d).some(k=>!['schema','default','description'].includes(k)))fail('无效的变量定义');validateSchema(d.schema);if(d.default!==undefined){jsonValue(d.default);checkValue(d.schema,d.default,key);}if(d.description!==undefined&&(typeof d.description!=='string'||d.description.length>2000))fail('无效的变量说明');if(policy.defaults&&Object.hasOwn(policy.defaults,key))checkValue(d.schema,policy.defaults[key],key);}}
}
export function eventOptions(team:Team,raw:MessageOptions):ReturnType<typeof normalizeOptions>{
 const def=team.coordination?.events?.find(x=>x.code===raw.code);
 if(raw.code&&team.coordination?.events?.length&&!def)throw new CoordinationError('EVENT_UNDECLARED','事件未在当前预设中声明');
 if(raw.eventVersion!==undefined&&raw.eventVersion!==def?.version)throw new CoordinationError('EVENT_VERSION','事件版本不匹配');
 if(def?.schema){if(raw.payload===undefined)fail('此事件必须提供 payload');checkValue(def.schema,raw.payload,'payload');}
 return normalizeOptions({...def?.defaults,...raw,...(def?{eventVersion:def.version}:{})});
}
export function resolvedVariables(state:State,team:Team,caller:string,projectId?:string){
 const ledger=projectId?state.projects?.find(p=>p.id===projectId&&p.teamIds.includes(team.id)):team;if(!ledger)throw new CoordinationError('PROJECT_SCOPE','项目未关联');
 const keys=new Set([...Object.keys(team.coordination?.defaults??{}),...Object.keys(team.coordination?.variables??{}),...(ledger.shared??[]).filter(x=>x.scope==='team'||x.scope===caller).map(x=>x.key)]);
 return [...keys].map(key=>{const local=ledger.shared?.find(x=>x.key===key&&x.scope===caller),shared=ledger.shared?.find(x=>x.key===key&&x.scope==='team'),entry=shared?.protected?shared:local??shared;const value=entry?.value??(Object.hasOwn(team.coordination?.defaults??{},key)?team.coordination!.defaults![key]:team.coordination?.variables?.[key]?.default);return {key,value:entry?entry.value:value,source:entry?(entry.scope==='team'?'team':'member'):'preset',provenance:entry?.source??'preset',protected:entry?.protected===true,revision:entry?.revision??0,...(team.coordination?.variables?.[key]?{definition:team.coordination.variables[key]}:{})};});
}
