import {useState,type ReactNode} from 'react';
import {Button,Tooltip,Toast,IconInfoOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import {tr} from './locale.ts';

/** Host-owned appearance, placement, delay and keyboard/touch disclosure. */
export function Help({text,label}:{text:string;label?:string}){
 return <Tooltip label={text} delayMs={550} focusDelayMs={200} side="bottom" portal maxWidth={360} openOnClick>
  <Button size="sm" className="td-help" aria-label={label??tr('说明')}><IconInfoOutlineRegular size={14}/></Button>
 </Tooltip>;
}
export function SectionTitle({title,hint,actions}:{title:string;hint?:string;actions?:ReactNode}){
 return <div className="td-section-title"><h3>{title}</h3>{hint&&<Help text={hint} label={title+' · '+tr('说明')}/>}<div className="td-section-actions">{actions}</div></div>;
}
/** Remount per notification; host Toast handles portal, motion and timeout. */
export function Notice({text,onDone}:{text:string;onDone?:()=>void}){
 const [done,setDone]=useState(false);
 return done||!text?null:<Toast text={text} holdMs={4500} onDone={()=>{setDone(true);onDone?.();}}/>;
}
