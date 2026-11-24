interface StorageLike {getItem(key:string):string|null;setItem(key:string,value:string):void;}
const KEY='dsh.team-desk.display.v1';
/** Browser display preference: never changes team permissions or server lifecycle. */
export class DisplayPreferences {
 showFocusIndicator=false;
 constructor(private storage:StorageLike){try{this.showFocusIndicator=JSON.parse(storage.getItem(KEY)??'null')?.showFocusIndicator===true;}catch{}}
 setFocusIndicator(value:boolean){this.showFocusIndicator=value;try{this.storage.setItem(KEY,JSON.stringify({showFocusIndicator:value}));}catch{}}
}
