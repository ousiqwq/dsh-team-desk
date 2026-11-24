import {Children,Fragment,isValidElement,useId,useState,type ReactNode,type ReactElement} from 'react';
import {Button,Menu,IconChevronDownOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import {tr} from './locale.ts';
function optionText(value:ReactNode):string{let text='';Children.forEach(value,v=>{if(typeof v==='string'||typeof v==='number')text+=v;else if(isValidElement(v))text+=optionText((v.props as {children?:ReactNode}).children);});return text;}
interface Option {id:string;label:string;disabled?:boolean;}
function options(children:ReactNode,result:Option[]=[]):Option[]{
 Children.forEach(children,child=>{if(!isValidElement(child))return;const node=child as ReactElement<{value?:string|number;disabled?:boolean;children?:ReactNode}>;if(node.type==='option')result.push({id:String(node.props.value??''),label:optionText(node.props.children),...(node.props.disabled?{disabled:true}:{})});else if(node.type===Fragment||node.type==='optgroup')options(node.props.children,result);});return result;
}
/** A single shared selector backed by the host's menu and button, including focus return. */
export function Select({value,onValueChange,children,disabled=false,'aria-label':label,id,className}:{value:string|number;onValueChange:(value:string)=>void;children:ReactNode;disabled?:boolean;'aria-label':string;id?:string;className?:string;required?:boolean}){
 const [open,setOpen]=useState(false),fallback=useId(),items=options(children),selected=items.find(o=>o.id===String(value));
 return <Menu open={open&&!disabled} onClose={()=>setOpen(false)} onSelect={next=>{onValueChange(next);setOpen(false);}} selectedId={String(value)} items={items} dense portal minWidthFromAnchor anchor={<Button id={id??fallback} variant="outline" className={['td-select-trigger',className].filter(Boolean).join(' ')} disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open&&!disabled} onClick={()=>setOpen(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);}}}><span>{selected?.label??tr('请选择')}</span><IconChevronDownOutlineRegular size={14}/></Button>}/>;
}
