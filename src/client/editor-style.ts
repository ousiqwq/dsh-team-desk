/** Settings layout and tokens; all native atoms retain host-owned appearance. */
export const editorCss=`
.td-managed-tree{list-style:none;border-inline-start:2px solid var(--border, currentColor);margin:.25rem 0 .25rem .6rem;padding-inline-start:1rem}
.td-managed-session{justify-content:space-between;min-width:0}
.td-timeline-entry{padding:.45rem 0;border-bottom:1px solid var(--border,rgba(128,128,128,.18))}
.td-timeline-entry summary{cursor:pointer;overflow-wrap:anywhere}
.td-timeline-entry time{opacity:.72;font-variant-numeric:tabular-nums}
.td-timeline-entry p,.td-timeline-entry pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:20rem;overflow:auto}

.td-editor-modal{position:relative;display:grid;padding:0;grid-template-rows:minmax(0,1fr)}
.td-editor-modal [data-settings-region=nav]{padding:22px 12px;display:flex;flex-direction:column}
.td-editor-modal [data-settings-region=navList]{display:flex;flex-direction:column}
.td-editor-modal [data-settings-region=navList]>button{justify-content:flex-start}
.td-editor-modal [aria-current=page]{background:var(--dsw-specific-sidebar-nav-item-active,var(--dsw-alias-bg-l2,#7774))}
.td-editor-modal [data-settings-region=options]{grid-column:2}
@media(max-width:767px){.td-editor-modal [data-settings-region=options]{grid-column:1/-1}}
/* One owner for settings layout. Native atoms own control appearance. */
@media(min-width:768px){.td-editor-modal [data-settings-region=navTitle]{display:none}[data-shortcut-modal=team-desk-editor]{grid-template-columns:232px minmax(0,1fr)}}
[data-shortcut-modal=team-desk-editor]{box-sizing:border-box;width:min(1560px,calc(100vw - 40px));max-width:calc(100vw - 40px);height:min(1060px,calc(100dvh - 40px));max-height:calc(100dvh - 40px);overflow:hidden}
[data-shortcut-modal=team-desk-editor] [data-settings-region=header]{height:0;min-height:0;padding:0;position:absolute;right:16px;top:18px;z-index:3}
[data-shortcut-modal=team-desk-editor] [data-settings-region=options]{grid-row:1/-1;padding:24px 24px 24px 20px;min-width:0;min-height:0;overflow:hidden}
[data-shortcut-modal=team-desk-editor] [data-settings-region=content]{min-width:0;min-height:0}
[data-shortcut-modal=team-desk-editor] [data-settings-region=nav]{min-height:0;gap:14px;padding-bottom:20px;overflow:auto;overscroll-behavior:contain}
[data-shortcut-modal=team-desk-editor] [data-settings-region=navList]{gap:3px;flex:1}
[data-shortcut-modal=team-desk-editor] [data-settings-region=navList]>button:has([data-td-nav-child]){height:34px;min-height:34px;padding:6px 12px 6px 28px;font-size:13px;flex-shrink:0}
[data-shortcut-modal=team-desk-editor] [data-settings-region=navList]>button:has([data-td-nav-child])>svg{display:none}
[data-shortcut-modal=team-desk-editor] [data-settings-region=navList]>button:has([data-td-nav-group]){font-weight:600;flex-shrink:0}
[data-shortcut-modal=team-desk-editor] [data-settings-region=navList]>button:has([data-td-nav-group=manage]){margin-top:16px}
[data-td-nav-group][data-active=false]{color:var(--dsw-alias-label-secondary)}
.td-settings{width:100%;min-width:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;container-type:inline-size}
.td-settings *{box-sizing:border-box}
.td-settings [hidden]{display:none!important}
.td-settings h2,.td-settings h3,.td-settings p{margin:0}
.td-settings h2{font-size:17px;line-height:1.5;font-weight:600}
.td-settings h3{font-size:14px;line-height:1.5;font-weight:600}
.td-settings p{margin:8px 0;overflow-wrap:anywhere}
.td-settings pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;max-width:100%}
.td-settings :where(form,section,article,fieldset){min-width:0}
.td-settings .td-budget-fields{border:0;padding:0;margin:0}
.td-settings label:not(:has(input[type=checkbox])):not(.td-layout-row label):not(.td-git-file){display:flex;flex-direction:column;gap:7px;min-width:0;margin:0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.td-settings label>span:has(input),.td-settings label>span:has(.td-select-trigger){display:block;width:100%;min-width:0}
.td-settings label>span:has(input){display:inline-flex}
.td-settings form{display:flex;flex-direction:column;gap:14px}
.td-settings form>button{align-self:flex-start}
.td-settings textarea{display:block;width:100%;min-width:0;padding:10px 12px;resize:vertical;min-height:80px;line-height:1.65;font:inherit;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline-offset:2px}
.td-settings textarea:focus-visible{outline:1px solid var(--dsw-alias-state-business-primary)}
.td-settings input[type=checkbox]{width:16px;height:16px;flex:none;accent-color:var(--dsw-alias-state-business-primary);margin:0}
.td-settings input:disabled,.td-settings textarea:disabled{cursor:not-allowed}
.td-settings button{flex-shrink:0}
.td-muted{color:var(--dsw-alias-label-secondary);font-size:12px}
.td-error{border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent)}
.td-team-editor{display:flex;flex-direction:column;height:100%;min-height:0;padding:0;gap:0}
.td-team-editor>[data-team-current]{display:flex;flex-direction:column;flex:1;min-height:0}
.td-team-editor .td-editor-heading{display:flex;align-items:center;justify-content:space-between;flex:none;gap:16px;margin:0 0 18px;padding:0 42px 16px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.td-editor-heading>div{min-width:0}
.td-editor-heading h2{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-editor-heading p{margin:4px 0 0;font-size:12px}
.td-team-editor [data-team-current]>section,.td-team-editor .td-management-page{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;padding:0 4px 4px 0}
.td-management-page>[data-team-management]{min-height:100%}
.td-management-page:has([data-preset-editor]){overflow:hidden}
.td-management-page:has([data-preset-editor])>[data-team-management],.td-management-page [data-team-management]>section:has([data-preset-editor]){height:100%;min-height:0}
.td-team-editor [data-team-current]>.td-current-overview{display:flex;flex-direction:column;overflow:hidden}
.td-current-summary{flex:none;padding:0 0 12px;margin:0}
.td-current-summary strong{font-size:13px;overflow-wrap:anywhere}
.td-current-summary>.td-row>div:first-child{display:flex;align-items:center;gap:8px}
.td-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.td-row>div:first-child{min-width:0;flex:1}
.td-row-end{justify-content:flex-end}
.td-ellipsis{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.td-badge{font-size:11px;padding:2px 7px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.td-settings .td-card{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-lg);padding:18px;margin:14px 0;background:transparent;min-width:0}
.td-settings .td-card:first-child{margin-top:0}
.td-settings .td-card .td-card{background:var(--dsw-alias-bg-layer-1)}
.td-settings .td-card>h3{margin-bottom:14px}
.td-card legend{padding:0 6px;font-weight:500}
.td-settings details>summary{font-weight:500;padding:4px 0;cursor:pointer;font-size:13px;line-height:22px}
.td-settings details[open]>summary{margin-bottom:14px}
.td-settings details>.td-help{float:right}
.td-card-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:16px}
.td-card-actions>.td-help:first-child{margin-right:auto}
.td-settings .td-inline-form{display:flex;flex-direction:row;align-items:flex-end;flex-wrap:wrap;gap:10px}
.td-inline-form>label{flex:1;min-width:140px!important}
.td-settings .td-inline-form>button{align-self:flex-end;margin:0}
.td-checks{display:flex;gap:12px 18px;flex-wrap:wrap}
.td-checks label{display:inline-flex;align-items:center;gap:7px;font-size:12px}
.td-preference{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.td-preference:last-child{border-bottom:0}
.td-preference>div{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
.td-preference strong{font-size:13px;font-weight:500}
.td-settings-heading,.td-section-title{display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-height:32px;margin:0 0 16px}
.td-settings-heading{justify-content:space-between;padding-right:36px}
.td-settings-heading>div{min-width:0}
.td-settings-heading .td-section-title{margin:0}
.td-section-actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.td-help{flex:none;width:26px!important;height:26px!important;padding:0!important;color:var(--dsw-alias-label-secondary)}
.td-settings h3:has(+.td-help){display:inline-block;margin-right:4px}
.td-settings .td-select-trigger{width:100%;height:32px;min-height:32px;font-size:13px;max-width:100%;display:flex;justify-content:space-between;gap:10px;text-align:left;white-space:nowrap}
.td-select-trigger>span{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-select-trigger>svg{flex:none}
.td-native-field{display:flex;flex-direction:column;gap:7px;min-width:0;margin:0 0 14px}
.td-native-field>span{display:block;width:100%;min-width:0}
.td-native-field label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.td-form-grid,.td-preset-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.td-option-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:16px;margin:16px 0}
.td-option-grid>.td-card{margin:0;display:flex;flex-direction:column}
.td-option-grid .td-card-actions{margin-top:auto;padding-top:16px}
.td-model-fields{grid-template-columns:minmax(0,1fr) minmax(112px,.38fr)}
.td-context-card{display:flex;align-items:flex-end;gap:16px;padding:16px 18px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1)}
.td-context-card>.td-native-field{flex:1;margin:0;max-width:540px}
.td-session-facts{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding-bottom:4px;min-width:0}
.td-three-fields{grid-template-columns:minmax(0,1.5fr) minmax(0,.75fr) minmax(0,1fr)}
.td-native-settings-grid{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);gap:16px;align-items:start}
.td-native-settings-grid>.td-card{margin:0}
.td-native-model-list{max-height:360px;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:14px 0}
.td-native-sessions,.td-native-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px;margin:12px 0 20px}
.td-native-sessions .td-card,.td-native-metrics .td-card{margin:0;padding:14px}
.td-native-path{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary);font-size:12px}
[data-td-native] .td-card p{font-size:12px;overflow-wrap:anywhere}
.td-member-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr));gap:16px}
.td-member-grid>.td-card{margin:0}
[data-member-settings]>.td-row:first-child{padding-bottom:14px}
[data-member-settings]>.td-session-soul{border-top:1px solid var(--dsw-alias-border-l1);margin:16px 0;padding-top:14px}
[data-member-settings] .td-session-soul>.td-section-title{margin-bottom:12px}
.td-layout-row{display:flex;gap:8px;align-items:center;padding:10px 0}
.td-layout-row>label{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.td-field-heading{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:-10px}
.td-reference-link{padding:10px 2px}
[data-display-preferences]>.td-card{max-width:1000px}
.td-download{font-size:12px;color:var(--dsw-alias-label-secondary)}
.td-create-team{padding:28px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
/* Preset editing has a fixed toolbar and one bounded workspace, never a sticky footer over the graph. */
.td-template-editor{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px}
.td-template-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex:none;padding:0 42px 14px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.td-template-breadcrumb{display:flex;align-items:center;gap:12px;min-width:0}
.td-template-breadcrumb h3{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-heading-divider{height:18px;width:1px;background:var(--dsw-alias-border-l1);flex:none}
.td-template-basics{display:grid;grid-template-columns:minmax(0,1.6fr) repeat(2,minmax(0,1fr));gap:14px;flex:none}
.td-template-description{flex:none}
.td-template-description>summary{padding:0!important;color:var(--dsw-alias-label-secondary);font-size:12px!important}
.td-template-description[open]>summary{margin-bottom:6px!important}
.td-template-description textarea{min-height:64px;max-height:100px}
.td-editor-sections{align-self:flex-start;width:300px;max-width:100%;flex:none}
.td-template-graph-page,.td-live-graph{display:flex;flex-direction:column;flex:1;min-height:0;gap:10px}
.td-template-rules-page{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;flex:1}
.td-template-rules-page>[data-communication-editor]{margin:0;border:0;padding:0}
.td-template-rules-page [data-communication-editor]>article{margin:12px 0}
.td-template-rules-page [data-communication-editor]>label{margin:14px 0}
/* Graph visuals and behaviour reuse the same definition in live and preset editors. */
.td-graph{display:flex;flex-direction:column;min-height:0;height:100%;flex:1}.td-graph-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-bottom:14px}.td-graph-toolbar>div:first-child{flex:1;min-width:180px;display:flex;flex-direction:column}.td-graph-workarea{display:flex;flex:1;min-height:0;border:1px solid var(--dsw-alias-border-l1,#7774);border-radius:var(--dsw-radius-lg,16px);overflow:hidden}.td-graph-viewport{flex:1;min-width:0;overflow:hidden;position:relative;cursor:grab;background-color:var(--dsw-alias-bg-base);background-image:radial-gradient(var(--dsw-alias-border-l1,#7776) 1px,transparent 1px);background-size:18px 18px;touch-action:none}.td-graph-viewport:active{cursor:grabbing}.td-graph-plane{position:absolute;left:0;top:0;transform-origin:0 0}.td-graph-lines{position:absolute;inset:0;overflow:visible;pointer-events:none;color:var(--dsw-alias-state-business-primary,#75a3e8)}.td-edge-line,.td-edge-draft{fill:none;stroke:currentColor;stroke-width:2;pointer-events:none}.td-edge-hit{fill:none;stroke:transparent;stroke-width:16;pointer-events:stroke;cursor:pointer}.td-graph-lines g[data-enabled=false]{color:var(--dsw-alias-label-caption);opacity:.5}.td-graph-lines g[data-enabled=false] .td-edge-line{stroke-dasharray:6 4}.td-graph-lines g[data-selected=true]{color:var(--dsw-alias-state-business-primary);opacity:1}.td-graph-lines g[data-selected=true] .td-edge-line{stroke-width:4}.td-edge-draft{stroke-dasharray:5 4;opacity:.8}
.td-graph-node{position:absolute;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#292929);border:1px solid var(--dsw-alias-border-l1,#7776);border-radius:var(--dsw-radius-lg,14px);padding:14px 16px;box-shadow:0 4px 16px #0001;cursor:grab;user-select:none;touch-action:none}.td-graph-node[data-selected=true]{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary)}.td-node-heading{display:flex;align-items:center;gap:8px;font-size:13px}.td-node-heading strong{flex:1;min-width:0;text-overflow:ellipsis;overflow:hidden;white-space:nowrap}.td-node-title{font-size:12px;color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;overflow:hidden;margin:7px 0}.td-node-meta{font-size:11px;color:var(--dsw-alias-label-caption)}
.td-graph-node>.td-graph-port{appearance:none;position:absolute;top:50%;transform:translateY(-50%);width:15px;height:15px;border-radius:50%;padding:0;border:3px solid var(--dsw-alias-bg-base);background:var(--dsw-alias-state-business-primary,#75a3e8);cursor:crosshair;box-shadow:0 0 0 1px var(--dsw-alias-border-l1)}.td-graph-port:hover{scale:1.3}.td-graph-port.input{left:-8px}.td-graph-port.output{right:-8px}
.td-graph-inspector{flex:0 0 340px;min-width:0;padding:18px;background:var(--dsw-alias-bg-layer-1);overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;font-size:13px}.td-graph-inspector h3{margin-top:12px}.td-operation{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0;font-size:12px}
.td-preset-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:14px;margin:18px 0}
.td-preset-card{font:inherit;text-align:left;color:inherit;cursor:pointer;padding:16px;border:1px solid var(--dsw-alias-border-l1,#7774);background:transparent;border-radius:16px;transition:border-color .15s ease,background-color .15s ease;min-width:0}
.td-preset-card:hover,.td-preset-card[data-selected=true]{border-color:var(--dsw-alias-state-business-primary,#75a3e8);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 5%,transparent)}
.td-preset-select>p{font-size:12px;color:var(--dsw-alias-label-secondary);min-height:38px;margin:8px 0}
.td-preset-card strong{overflow-wrap:anywhere}.td-preset-select .td-row{justify-content:space-between}
.td-mini-graph{display:block;width:100%;height:145px;margin:10px 0;color:var(--dsw-alias-state-business-primary,#75a3e8)}
.td-mini-graph rect{fill:var(--dsw-alias-bg-layer-2,#292929);stroke:var(--dsw-alias-border-l1,#7774);stroke-width:2}
.td-mini-graph text{fill:var(--dsw-alias-label-primary);font:22px system-ui}.td-mini-graph .td-mini-caption{fill:var(--dsw-alias-label-secondary);font-size:16px}
.td-mini-edge{fill:none;stroke:currentColor;stroke-width:2;stroke-linejoin:round}
.td-preset-select{display:block;width:100%;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;padding:0}.td-preset-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.td-library-actions{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px}.td-library-actions>.td-row{padding:7px 0}
.td-import{position:relative;flex:none;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);padding:6px 12px;border-radius:8px}.td-import input[type=file]{position:absolute;inset:0;opacity:0;width:100%;cursor:pointer}
.td-binding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:8px 14px}
.td-layout-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));gap:12px;margin:20px 0}
.td-layout-option{font:inherit;color:inherit;cursor:pointer;background:transparent;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px}.td-layout-option:hover{border-color:var(--dsw-alias-state-business-primary)}.td-layout-option svg{width:100%;height:110px;margin-top:10px}.td-layout-option rect{fill:color-mix(in srgb,var(--dsw-alias-state-business-primary,#75a3e8) 20%,transparent);stroke:var(--dsw-alias-state-business-primary,#75a3e8)}.td-spaced{margin-top:28px!important}
.td-relation-table{flex:1;min-width:0;overflow:auto;padding:16px}.td-relation-table table{border-collapse:collapse;width:100%}.td-relation-table caption{text-align:left;font-size:12px;color:var(--dsw-alias-label-secondary);padding:0 0 14px}.td-relation-table th,.td-relation-table td{border-bottom:1px solid var(--dsw-alias-border-l1);padding:10px;text-align:left;white-space:nowrap;font-size:12px}
.td-edge-line{stroke-linejoin:round;stroke-linecap:round}.td-graph-lines g[data-muted=true]:not([data-selected=true]){opacity:.22}.td-graph-lines g[data-selected=true]{opacity:1}

.td-graph-viewport[data-panning=true]{cursor:grabbing;user-select:none}.td-graph-plane{will-change:transform}
.td-inspector-divider{flex:0 0 7px;background:var(--dsw-alias-bg-base);cursor:col-resize;touch-action:none;position:relative;outline:none}
.td-inspector-divider::after{content:'';position:absolute;inset:0 3px;background:var(--dsw-alias-border-l1)}
.td-inspector-divider:hover::after,.td-inspector-divider:focus-visible::after{inset:0 1px;background:var(--dsw-alias-state-business-primary,#75a3e8)}.td-graph-toolbar{min-height:32px;flex:none;padding:0 0 10px;gap:6px}
.td-graph-toolbar>div:first-child{flex-direction:row;align-items:center;min-width:110px;gap:4px}
.td-graph-inspector>h3:first-child{margin:0 0 14px}
.td-graph-inspector>form{margin-bottom:14px;gap:8px}
.td-graph-inspector form>button{align-self:flex-end}
.td-inspector-tabs{margin-bottom:16px;flex:none}
.td-inspector-prompt textarea{min-height:220px;resize:vertical;max-height:600px}
.td-inspector-prompt form{gap:10px}
.td-graph-inspector .td-session-soul,.td-graph-inspector .td-preset-soul{padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.td-graph-inspector .td-section-title{margin-bottom:12px}
.td-operation{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0}
.td-graph-workarea[data-stacked=true]{flex:none;flex-direction:column}
.td-graph-workarea[data-stacked=true]>.td-graph-viewport{flex:0 0 300px;min-height:300px}
.td-graph-workarea[data-stacked=true]>.td-graph-inspector{flex:none;border-top:1px solid var(--dsw-alias-border-l1);overflow:visible}
.td-graph-workarea[data-stacked=true]>.td-relation-table{flex:none;min-height:160px}
.td-template-graph-page:has([data-stacked=true]),.td-live-graph:has([data-stacked=true]){overflow:auto;overscroll-behavior:contain}
.td-graph:has([data-stacked=true]){height:auto;min-height:0;flex:none}
.td-preset-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:16px;margin:16px 0}
.td-preset-card{border-radius:var(--dsw-radius-lg)}
.td-preset-actions{flex-wrap:wrap}
.td-preset-select .td-row{min-height:28px}
.td-preset-select>p{min-height:36px;line-height:1.6}
.td-layout-options{margin:16px 0}
.td-spaced{margin-top:28px!important;margin-bottom:12px!important}
.td-project-git .td-git-files{max-height:260px;overflow:auto;margin:10px 0}
.td-settings label.td-git-file{display:flex;flex-direction:row;align-items:center;gap:10px;margin:4px 0;color:var(--dsw-alias-label-primary);font-size:13px}
.td-git-file span{overflow-wrap:anywhere}
.td-project-git .td-wrap{overflow-wrap:anywhere;white-space:pre-wrap;max-height:260px;overflow:auto}
.td-pinned-shas{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;overflow-wrap:anywhere;margin:8px 0}
.td-lfs-file{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.td-lfs-file:last-child{border:0}
.td-lfs-file strong{flex:1;min-width:160px;overflow-wrap:anywhere}
.td-mobile-nav{display:none}
@container(max-width:850px){.td-option-grid,.td-native-settings-grid{grid-template-columns:minmax(0,1fr)}.td-three-fields{grid-template-columns:repeat(2,minmax(0,1fr))}.td-three-fields>.td-native-field:first-child{grid-column:1/-1}.td-context-card{align-items:stretch;flex-direction:column;gap:10px}.td-context-card>.td-native-field{max-width:none}.td-option-grid .td-card-actions{padding-top:4px}.td-template-basics{grid-template-columns:repeat(2,minmax(0,1fr))}.td-template-basics>label:first-child{grid-column:1/-1}}
@container(max-width:480px){.td-current-summary>.td-row{flex-wrap:wrap}.td-current-summary>.td-row>div:first-child{flex:1 0 100%;min-width:0;flex-wrap:wrap}.td-form-grid,.td-model-fields,.td-three-fields,.td-preset-pair,.td-member-grid{grid-template-columns:minmax(0,1fr)}.td-three-fields>.td-native-field:first-child{grid-column:auto}.td-settings .td-card{padding:14px}.td-context-card{padding:14px}.td-card-actions{justify-content:flex-start}.td-inline-form>label{min-width:100%!important}.td-settings-heading{padding-right:0}.td-team-editor .td-editor-heading{padding-right:0}.td-editor-heading h2{white-space:normal;font-size:15px}.td-team-editor .td-editor-heading>button{display:none}.td-template-heading{padding-right:0;gap:8px}.td-template-breadcrumb{gap:6px}.td-template-breadcrumb h3{font-size:13px}.td-template-breadcrumb button span{display:none}.td-template-heading>button{max-width:48%;white-space:normal}.td-layout-options{grid-template-columns:repeat(2,minmax(0,1fr))}.td-section-actions{width:100%;margin-left:0}.td-graph-toolbar{gap:4px}.td-graph-toolbar>div:first-child{min-width:100%}}
@media(max-width:767px){
 [data-shortcut-modal=team-desk-editor]{display:grid!important;grid-template-columns:minmax(0,1fr) 44px!important;grid-template-rows:50px minmax(0,1fr);grid-template-areas:none!important;width:calc(100vw - 16px)!important;max-width:calc(100vw - 16px);height:calc(100dvh - 16px)!important;max-height:calc(100dvh - 16px);padding:0;gap:0}
 [data-shortcut-modal=team-desk-editor] [data-settings-region=nav]{display:none}
 [data-shortcut-modal=team-desk-editor] [data-settings-region=navTitle]{grid-area:1 / 1 / 2 / 2;padding:14px 18px 10px;font-size:16px}
 [data-shortcut-modal=team-desk-editor] [data-settings-region=header]{right:12px;top:10px;grid-area:auto;padding:0!important;min-height:0!important;height:32px!important;width:32px;align-items:center;justify-content:center}
 [data-shortcut-modal=team-desk-editor] [data-settings-region=options]{grid-area:2 / 1 / 3 / 3;padding:0 12px 12px;min-width:0}
 .td-mobile-nav{display:block;flex:none;margin-bottom:12px}.td-mobile-nav>span{width:100%;display:block}.td-mobile-nav button{width:100%;justify-content:space-between}
 .td-team-editor .td-editor-heading{margin-bottom:12px;padding-bottom:12px}.td-template-editor{gap:10px}.td-template-basics{gap:10px}.td-template-breadcrumb>button{width:30px;padding:0}.td-template-breadcrumb h3{white-space:normal}.td-template-description[open]{max-height:110px;overflow:auto}
}
@media(max-height:700px) and (min-width:701px){.td-template-graph-page,.td-live-graph{overflow:auto}.td-graph{min-height:360px;flex:none}.td-template-rules-page{min-height:80px}}

.td-partial{display:flex;flex-direction:column;gap:12px;min-width:0}.td-hunk-list{max-height:min(58vh,700px);overflow:auto;min-width:0;border:1px solid var(--dsw-alias-border-l1,#7774);border-radius:12px}.td-hunk-file>summary{display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;overflow-wrap:anywhere}.td-hunk{border-top:1px solid var(--dsw-alias-border-l1,#7774);padding:10px;min-width:0}.td-hunk>label{display:flex;gap:8px;align-items:center;overflow:hidden}.td-hunk code{overflow-wrap:anywhere}.td-hunk pre{max-width:100%;overflow:auto}.td-hunk-file>p{padding:0 12px}.td-partial>.td-row{flex-wrap:wrap}
`;
