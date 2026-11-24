/** Route native document drop listeners to one visible composer and its containing pane. */
const cardSelector='[data-composer-card]';
const paneSelector='[data-team-session]';
function visible(element:Element):boolean {
 return element.isConnected&&!element.closest('[hidden], [inert]')&&element.getClientRects().length>0
  &&element.ownerDocument.defaultView?.getComputedStyle(element).visibility!=='hidden';
}
export function accepts(event:DragEvent,owner:HTMLElement|null|undefined):boolean {
 const card=owner?.closest(cardSelector);if(!card||!visible(card))return false;
 const target=event.composedPath().find(item=>(item as Node)?.nodeType===1) as Element|undefined;
 const element=target??((event.target as Node|null)?.nodeType===1?event.target as Element:undefined);
 const targetCard=element?.closest(cardSelector);
 if(targetCard)return targetCard===card;
 if(element?.closest('header[data-window-drag]')?.closest(paneSelector))return false;
 const ownPane=owner?.closest(paneSelector),targetPane=element?.closest(paneSelector);
 if(ownPane||targetPane)return !!ownPane&&targetPane===ownPane;
 const doc=card.ownerDocument;
 if([...doc.querySelectorAll('[data-team-desk]')].some(visible))return false;
 return [...doc.querySelectorAll(cardSelector)].filter(visible).length===1;
}
export function focus(owner:HTMLElement|null|undefined):void {
 owner?.closest(cardSelector)?.querySelector<HTMLElement>('[data-composer-input]')?.focus({preventScroll:true});
}
/** The ordinary overlay remains full page; team overlays cover only the drop receiver. */
export function overlayStyle(owner:HTMLElement|null|undefined):Record<string,string|number>|undefined {
 const pane=owner?.closest(paneSelector);if(!pane)return undefined;
 const rect=pane.getBoundingClientRect();return {left:rect.left,top:rect.top,width:rect.width,height:rect.height,right:'auto',bottom:'auto'};
}
