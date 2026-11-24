import type {Layout} from './types.ts';
export interface Preferences{defaultLayout:Layout;motion:'system'|'reduced';snapPreview:boolean;showOtherPreviews:boolean;}
export const defaults:Preferences={defaultLayout:'grid',motion:'system',snapPreview:true,showOtherPreviews:true};
