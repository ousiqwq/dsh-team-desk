import {useEffect,useId,useRef} from 'react';
import {draftGuard} from './draft-guard.ts';
export function useDraft(dirty:boolean,discard:()=>void){
 const id=useId(),latest=useRef(discard);latest.current=discard;
 useEffect(()=>{draftGuard.set(id,dirty?()=>latest.current():null);return()=>draftGuard.set(id,null);},[id,dirty]);
}
