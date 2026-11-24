import {useSyncExternalStore} from 'react';
import type {SessionId} from '@deepseek-ai/dsh-session/types';
import type {SessionPanelToggleInjected} from '@deepseek-ai/dsh-client-ui-session-panel/client';
import {Button,IconFlatListOutlineRegular} from '@deepseek-ai/dsh-client-ui-primitives';
import {tr} from './locale.ts';

export function PanePanelButton({panel,id,focus}:{panel:SessionPanelToggleInjected;id:SessionId;focus:()=>void}){
  const {dockable,visibility}=panel.hooks;
  const fits=useSyncExternalStore(dockable.subscribe,()=>dockable.getSnapshot().get(id));
  const shown=useSyncExternalStore(visibility.subscribe,()=>{
    const view=visibility.getSnapshot();
    return fits===true?view.pinned:view.overlay===id;
  });
  const label=tr(shown?'隐藏会话面板':'显示会话面板');
  return <Button size="sm" className="td-pane-icon td-pane-panel-toggle" data-team-pane-panel={id}
    title={label} aria-label={label} aria-expanded={shown} aria-controls={shown?'dsh-session-panel-'+id:undefined}
    disabled={fits===undefined} draggable={false}
    onPointerDown={e=>e.stopPropagation()} onDoubleClick={e=>e.stopPropagation()}
    onClick={e=>{e.stopPropagation();focus();panel.toggle(id);}}><IconFlatListOutlineRegular size={14}/></Button>;
}
