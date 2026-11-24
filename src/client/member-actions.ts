import {tr} from './locale.ts';
export function confirmDetach(title:string):boolean {
  return window.confirm(tr('将「{p0}」解除绑定并保留为普通会话？',{p0:title}));
}
