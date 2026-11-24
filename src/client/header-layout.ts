/** Keep native headers in their own sessions. Geometry belongs to the header, never the transcript's inherited styles. */
export function trackSharedHeader(placeholder:HTMLElement,surface:HTMLElement,active:string,onHeight:(height:number)=>void):()=>void{
 const anchored=CSS.supports('position-anchor','--td-shared-header')&&CSS.supports('width','anchor-size(width)')&&CSS.supports('anchor-scope','--td-shared-header');
 let frame:number|undefined,tracking=false,settle:ReturnType<typeof setTimeout>|undefined,observed:HTMLElement|undefined,closed=false;
 const originals=new Map<HTMLElement,{left:string;top:string;width:string}>();
 const measure=()=>{
  frame=undefined;if(closed)return;
  const native=surface.querySelector<HTMLElement>('[data-team-session="'+active+'"] header[data-window-drag]');
  if(native){
   if(observed!==native){if(observed)observer.unobserve(observed);observed=native;observer.observe(native);}
   if(!originals.has(native))originals.set(native,{left:native.style.left,top:native.style.top,width:native.style.width});
   if(!anchored){
    const rect=placeholder.getBoundingClientRect();
    for(const [key,value]of Object.entries({left:rect.left+'px',top:rect.top+'px',width:rect.width+'px'}))if(native.style.getPropertyValue(key)!==value)native.style.setProperty(key,value);
   }
   if(native.dataset.tdHeaderMeasured===undefined)native.dataset.tdHeaderMeasured='';
  }
  if(tracking)schedule();
 };
 const schedule=()=>{if(!closed&&frame===undefined)frame=requestAnimationFrame(measure);};
 const observer=new ResizeObserver(entries=>{
  for(const entry of entries)if(entry.target===observed)onHeight(entry.borderBoxSize?.[0]?.blockSize||observed.offsetHeight||76);
  if(!anchored||!observed?.isConnected)schedule();
 });observer.observe(placeholder);
 const isFrameTransition=(event:TransitionEvent)=>event.propertyName==='grid-template-columns'&&event.target instanceof HTMLElement&&event.target.contains(surface);
 const stop=()=>{tracking=false;clearTimeout(settle);schedule();};
 const start=(event:TransitionEvent)=>{if(anchored||!isFrameTransition(event))return;tracking=true;clearTimeout(settle);settle=setTimeout(stop,650);schedule();};
 const end=(event:TransitionEvent)=>{if(isFrameTransition(event))stop();};
 document.addEventListener('transitionrun',start,true);document.addEventListener('transitionend',end,true);document.addEventListener('transitioncancel',end,true);window.addEventListener('resize',schedule);
 surface.addEventListener('dsh:team-header-mounted',schedule);measure();
 return()=>{closed=true;surface.removeEventListener('dsh:team-header-mounted',schedule);observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);clearTimeout(settle);document.removeEventListener('transitionrun',start,true);document.removeEventListener('transitionend',end,true);document.removeEventListener('transitioncancel',end,true);window.removeEventListener('resize',schedule);for(const [node,style]of originals){Object.assign(node.style,style);delete node.dataset.tdHeaderMeasured;}};
}
