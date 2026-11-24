const measuredHistorySelector = '.td-history-sized:not([hidden]):not(:focus-within):not([data-chat-motion]):not([data-chat-motion]:not([data-chat-flow]) *):not([data-streaming]):not([data-streaming] *)';
const foldedHistorySelector = '[data-td-folded-root][hidden="until-found"]:not([data-chat-motion]):not([data-chat-motion="collapse"] *):not([data-chat-motion="reveal"] *)';

/** Team workspace and conversation panes. Settings are owned by editor-style.ts. */
export const css=`
/* Reserve the tree gutter inside each row so its native highlight spans the full width. */
.dsh-managed-children[data-managed-parent] {
  --td-tree-indent: 18px;
  padding-inline: 0;
  --td-tree-line: var(--dsw-alias-border-l4, GrayText);
}
.dsh-managed-children > [data-managed-child] [data-row-key] > :first-child {
  position: relative;
  margin-inline-end: var(--td-tree-indent);
}
.dsh-managed-children > [data-managed-child] [data-row-key] > :first-child::before {
  content: '';
  position: absolute;
  pointer-events: none;
  inset-inline-start: calc(50% + var(--td-tree-indent) - 1px);
  inset-block-start: calc(50% - 12px);
  block-size: 24px;
  inline-size: 10px;
  background: var(--td-tree-line);
  /* Paint the translucent elbow and stem as one silhouette over the native row. */
  clip-path: path("M0 0H2V8Q2 11 5 11H10V13H5Q0 13 0 8Z");
}
.dsh-managed-children > [data-managed-child]:not(:last-child) [data-row-key] > :first-child::before {
  clip-path: path("M0 0H2V8Q2 11 5 11H10V13H5Q3 13 2 12V23Q2 24 1 24Q0 24 0 23Z");
}
.dsh-managed-children:dir(rtl) > [data-managed-child] [data-row-key] > :first-child::before {
  transform: scaleX(-1);
}
.td-blocked-requests{flex:none;max-height:5.5rem;overflow:auto;padding:4px 12px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1)}.td-blocked-requests span{display:block;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.td-header-action{width:28px;padding:0;flex:none;color:var(--dsw-alias-label-secondary)}
/* The users glyph has more vertical whitespace than the native sidebar glyph. */
.td-header-action>svg{width:18px;height:18px}
.td-root{height:100%;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.td-grid-shell{flex:1;min-height:0;position:relative}.td-grid{height:100%;min-height:0;min-width:0;display:grid;gap:1px;background:var(--dsw-alias-border-l1,#7774);overflow:hidden}
.td-pane{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;position:relative;background:var(--dsw-alias-bg-base);outline:none}.td-pane[hidden]{display:none}.td-root[data-focus-indicator] .td-pane[data-active=true]:not(:only-child)::after{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 2px 0 color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 65%,transparent)}.td-pane[data-drop=true]::after{content:'';position:absolute;inset:0;pointer-events:none;box-shadow:inset 0 0 0 2px var(--dsw-alias-state-business-primary,#75a3e8)}
.td-shared-editor{position:relative;z-index:16;margin-inline-end:48px}
/* DSH's blank header has a 10px top inset above its 30px title row. */
.td-root:has(.td-dock-pane[data-active=true] [data-conversation-header-corner]:only-child)>.td-shared-header:has(>.td-shared-editor){box-sizing:border-box;padding-block-start:10px}
.td-root:has(.td-dock-pane[data-active=true] [data-conversation-header-corner]:only-child):not(:has(.td-dock-pane[data-active=true] [data-sidebar-right-expand]))>.td-shared-header>.td-shared-editor{margin-inline-end:28px}
.td-native{flex:1;min-height:0;min-width:0;position:relative;overflow:hidden;container-type:inline-size}.td-native>div{height:100%;min-height:0}
.td-native [data-slot="conversation.header"]{min-width:0}.td-native [data-slot="conversation.composer.bar"]{min-width:0}
.td-divider{position:absolute;z-index:10;touch-action:none;outline:none}.td-divider-x{top:0;bottom:0;width:7px;transform:translateX(-50%);cursor:col-resize}.td-divider-y{left:0;right:0;height:7px;transform:translateY(-50%);cursor:row-resize}.td-divider:hover,.td-divider:focus-visible{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 25%,transparent)}
.td-window-tabs{display:flex;overflow-x:auto;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1,#7774);gap:18px;padding:0 16px;background:var(--dsw-alias-bg-base);scrollbar-width:thin}.td-window-tabs button{font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;flex:0 0 auto;background:none;border:0;border-bottom:2px solid transparent;padding:10px 0;cursor:pointer}.td-window-tabs button[aria-selected=true]{color:var(--dsw-alias-state-business-primary);border-color:currentColor}
.td-empty{margin:auto;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:14px}.td-empty h3{font-size:16px;color:var(--dsw-alias-label-primary)}.td-error{font-size:13px;padding:8px 12px;color:var(--dsw-alias-state-error-primary,#e38383);overflow-wrap:anywhere}.td-drag-hint{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);border-radius:8px;padding:6px 12px;background:var(--dsw-alias-bg-layer-2,#333);pointer-events:none;font-size:12px;z-index:11}


@media screen and (prefers-reduced-motion:no-preference){
 [data-animating]:not([data-dragging]) .td-dock-surface[data-td-sidebar-ready] .td-native ${foldedHistorySelector}{display:none}
}
@media screen{
 .td-dock-surface[data-td-history-managed][data-td-sidebar-moving] .td-native ${foldedHistorySelector},
 .td-dock-surface[data-td-restoring] .td-native ${foldedHistorySelector}:not([data-td-restored]){display:none}
 .td-dock-surface[data-td-measured-paused] .td-native ${measuredHistorySelector},
 .td-dock-surface[data-td-restoring] .td-native ${measuredHistorySelector}:not([data-td-restored]){content-visibility:hidden}
 /* The dock allocates each scrolling viewport. Its messages cannot size the outer sidebar grid. */
 .td-dock-surface[data-td-history-managed] .td-native [data-conversation-scroll]{contain:size layout}
 /* Native closed groups have no content height. Their descendants need not contribute intrinsic widths. */
 .td-dock-surface[data-td-history-managed] .td-native ${foldedHistorySelector}{contain:strict}
 .td-dock-surface[data-td-history-managed] .td-native [data-chat-flow-key][data-chat-node-key]:not([hidden]){contain:inline-size}
 .td-dock-pane .td-history-sized:not([hidden]):not([data-chat-motion]):not(:focus-within){content-visibility:auto}
 .td-dock-pane [data-chat-motion]:not([data-chat-flow]) .td-history-sized:not([hidden]):not([data-chat-motion]):not(:focus-within){content-visibility:visible}
}
.td-shared-header{display:flex;align-items:center;justify-content:flex-end;flex:none;min-width:0;background:var(--dsw-alias-bg-base)}
.td-dock-surface{position:relative;flex:1;min-height:0;min-width:0;overflow:hidden;background:var(--dsw-alias-border-l1,#7774)}
.td-dock-pane{position:absolute;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base);border:.5px solid var(--dsw-alias-border-l1,#7774);box-sizing:border-box;transition:left .24s cubic-bezier(.2,.8,.2,1),top .24s cubic-bezier(.2,.8,.2,1),width .24s cubic-bezier(.2,.8,.2,1),height .24s cubic-bezier(.2,.8,.2,1)}
.td-dock-pane[hidden]{display:none}.td-root[data-focus-indicator] .td-dock-surface[data-multiple-panes]>.td-dock-pane[data-active=true]{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary,#75a3e8)}
.td-pane-handle{display:flex;align-items:center;gap:8px;flex:none;height:29px;padding:0 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:grab;user-select:none;touch-action:none}
.td-pane-handle:active{cursor:grabbing}
/* Hide the group, so native disabled buttons keep their own dimming when it is revealed. */
.td-pane-actions{display:flex;align-items:center;flex:none;gap:inherit;opacity:0}
.td-pane-handle:is(:hover,:has(:focus-visible))>.td-pane-actions{opacity:1}
.td-pane-actions>.td-pane-icon{inline-size:28px;padding-inline:0;flex:none}
.td-dock-divider{position:absolute;z-index:8;touch-action:none;outline:none}.td-dock-divider-x{width:7px;transform:translateX(-50%);cursor:col-resize}.td-dock-divider-y{height:7px;transform:translateY(-50%);cursor:row-resize}.td-divider-highlight{position:absolute;z-index:9;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 30%,transparent)}
.td-dock-surface>.td-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;background:var(--dsw-alias-bg-base)}
.td-dock-drop{position:absolute;inset:0;z-index:9;pointer-events:auto}
.td-snap-preview{position:absolute;z-index:10;pointer-events:none;box-sizing:border-box;border:2px solid var(--dsw-alias-state-business-primary,#75a3e8);border-radius:var(--dsw-radius-lg,14px);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 14%,transparent);transition:background-color .14s ease,border-color .14s ease;display:grid;place-items:center;backdrop-filter:blur(2px);color:var(--dsw-alias-label-primary)}.td-snap-preview span,.td-global-preview span{padding:8px 14px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-md,10px);font-size:13px}
.td-trash{position:fixed;z-index:10000;isolation:isolate;transform:translateX(-50%);min-height:92px;box-sizing:border-box;padding:20px 28px;border-radius:var(--dsw-radius-xl,20px);display:flex;gap:16px;justify-content:center;align-items:center;background:var(--dsw-alias-bg-layer-2,#282828);border:2px solid var(--dsw-alias-border-l1,#7776);box-shadow:0 12px 42px #0006;color:var(--dsw-alias-label-primary);font-size:15px;pointer-events:auto;transition:transform .16s ease,background-color .16s ease,border-color .16s ease}.td-trash>div{display:flex;flex-direction:column;gap:5px}.td-trash strong{font-weight:600}.td-trash span{font-size:11px;color:var(--dsw-alias-label-secondary)}.td-trash[data-over=true]{transform:translateX(-50%) scale(1.05);background:var(--dsw-alias-bg-layer-2,#282828);border-color:var(--dsw-alias-state-error-primary,#dc6262);color:var(--dsw-alias-state-error-primary,#dc6262)}.td-trash[data-reduced-motion]{transition:none}
/* Session drags use the actual open sidebar pane as their native chat target.
   Its hit surface follows the pane through the slide and covers embedded frames. */
html[data-td-session-drag] [data-session-drop-zone]{display:none}
html[data-td-session-drag] [data-side="rightbar"]{pointer-events:none}
html[data-td-session-drag] [data-sidebar-right-open] [data-dockkit-pane]{position:relative}
html[data-td-session-drag] [data-sidebar-right-open] :where([data-dockkit-pane],[data-dockkit-empty])::after{
 content:"";position:absolute;inset:0;z-index:10;pointer-events:auto}
html[data-td-session-drag] [data-sidebar-right-open] [data-td-sidebar-drop]::after{
 content:attr(data-td-sidebar-drop);display:grid;place-items:center;inset:0;border:1.5px dashed var(--dsw-alias-border-l2);
 border-radius:var(--dsw-radius-lg);color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-bg-base) 72%,transparent);backdrop-filter:blur(6px)}
.td-global-drop{position:fixed;z-index:30;pointer-events:auto}.td-global-preview{position:absolute;box-sizing:border-box;pointer-events:none}
[data-viewport-resizing]>.td-dock-pane,[data-resizing]>.td-dock-pane,[data-reduced-motion] .td-dock-pane,[data-reduced-motion] .td-snap-preview,[data-reduced-motion] .td-global-preview,[data-reduced-motion] .td-trash{transition:none}
@media(prefers-reduced-motion:reduce){.td-dock-pane,.td-snap-preview,.td-global-preview,.td-trash{transition:none}}

/* Keep native header DOM inside its own session so DOM-scoped plugins retain context. */
.td-dock-pane .td-native{container-type:normal}
.td-dock-pane .td-native header[data-window-drag]{position:fixed;left:0;top:0;width:100%;z-index:15;box-sizing:border-box;background:var(--dsw-alias-bg-base);visibility:hidden;pointer-events:none}
.td-dock-pane[data-active=true] .td-native header[data-window-drag][data-td-header-measured]{visibility:visible;pointer-events:auto}
@supports (position-anchor:--td-shared-header) and (width:anchor-size(width)) and (anchor-scope:--td-shared-header){
 .td-root{anchor-scope:--td-shared-header}
 .td-shared-header{anchor-name:--td-shared-header}
 .td-dock-pane .td-native header[data-window-drag]{position-anchor:--td-shared-header;left:anchor(left);top:anchor(top);width:anchor-size(width)}
}

.td-snap-preview[data-snap-active=false]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,transparent);border-color:var(--dsw-alias-border-l1);backdrop-filter:none}
@media(prefers-reduced-motion:reduce){.td-snap-preview,.td-global-preview{transition:none}}
.td-dock-pane[data-collapse]{opacity:.3;filter:grayscale(1)}

.td-embedded-conversation{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;min-width:0}
.td-hero-team{position:absolute;inset-block-start:8px;inset-inline-end:12px;z-index:3;border:0;color:inherit;background:transparent;cursor:pointer}
.td-panel-members,.td-panel-members ul{padding:0;list-style:none;margin:0}
.td-panel-members ul:not(:empty){padding-inline-start:12px;border-inline-start:1px solid var(--border-subtle,currentColor);margin-inline-start:6px}
.td-panel-members button{cursor:pointer;max-width:100%;color:inherit;background:transparent;border:0;text-align:start;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;padding:4px}


[data-td-reorder="before"] {box-shadow:inset 0 2px var(--dsw-alias-state-business-primary)}
[data-td-reorder="after"] {box-shadow:inset 0 -2px var(--dsw-alias-state-business-primary)}
:is([data-team-branch="solo"],[data-team-branch="root"])>span:first-child {position:relative}
.td-tree-toggle {display:inline-grid;place-items:center;width:16px;height:20px;padding:0;background:none;border:0;color:inherit;cursor:pointer}
.td-tree-toggle:focus-visible {outline:2px solid var(--dsw-alias-state-business-primary);border-radius:3px}
.td-branch-arrow {display:none;width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:rotate(-45deg)}
.td-tree-toggle[aria-expanded=true] .td-branch-arrow {transform:rotate(45deg)}
[data-team-branch="root"]:is(:hover,:focus-within) .td-tree-toggle svg {display:none}
[data-team-branch="root"]:is(:hover,:focus-within) .td-branch-arrow {display:block}
.td-root-status {position:absolute;inset-inline-end:-3px;bottom:-1px;display:inline-flex;transform:scale(.64);transform-origin:bottom right;pointer-events:none}
.td-root-status:empty {display:none}
[data-team-branch]:is([data-team-branch="member"],[data-team-branch="last"])>span:first-child {margin-inline-end:18px;position:relative}
[data-team-branch="member"]>span:first-child::before,[data-team-branch="last"]>span:first-child::before {
 content:"";position:absolute;pointer-events:none;inset-inline-start:calc(50% + 17px);inset-block-start:calc(50% - 12px);inline-size:10px;block-size:24px;
 background:var(--dsw-alias-border-l4,GrayText);clip-path:path("M0 0H2V8Q2 11 5 11H10V13H5Q0 13 0 8Z")
}
[data-team-branch="member"]>span:first-child::before {clip-path:path("M0 0H2V8Q2 11 5 11H10V13H5Q3 13 2 12V23Q2 24 1 24Q0 24 0 23Z")}
[data-team-branch]:dir(rtl)>span:first-child::before {transform:scaleX(-1)}
`;
