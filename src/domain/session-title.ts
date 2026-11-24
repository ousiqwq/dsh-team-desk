/** A display-only suffix: never write this result into the native session title. */
export interface TitleHint {raw:string;heading:string}
export function teamSessionTitle(title:string|undefined,role:string|undefined,hint?:TitleHint):string {
 const name=(hint&&(title??'')===hint.raw?hint.heading:title)?.trim(),label=role?.trim();
 if(!name)return label??'';
 if(!label||name===label||name.endsWith(`（${label}）`))return name;
 return `${name}（${label}）`;
}
