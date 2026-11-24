export const syncCss=`
[data-chat-node-key]:has([data-td-sync-group-member],[data-td-sync-index-pending]){display:none}
.td-sync{min-width:0;--td-sync-indent:calc(22px + var(--dsh-content-font-delta,0px))}
.td-sync-disclosure[data-open] > [data-disclosure-header] .td-sync-chevron{transform:rotate(180deg);color:var(--dsw-alias-label-secondary)}
.td-sync-caption{display:inline-flex;align-items:baseline;gap:6px;min-width:0;margin-inline-start:8px;font-size:var(--dsh-content-font-size-secondary,13px);color:inherit}
.td-sync-count,.td-sync-clock{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums}
.td-sync-route,.td-sync-file-preview,.td-sync-filename{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.td-sync-disclosure[data-open]>[data-disclosure-header]>.td-sync-header-row{height:auto;min-height:calc(24px + var(--dsh-content-font-delta,0px))}
.td-sync-disclosure[data-open]>[data-disclosure-header] .td-sync-route{white-space:normal;overflow-wrap:anywhere}
.td-sync-file-preview,.td-sync-clock{color:var(--dsw-alias-label-tertiary)}
.td-sync-clock{font-size:.85em}
@media(hover:hover){.td-sync-header-row:not(:hover):not(:focus-visible) .td-sync-clock{visibility:hidden}}
.td-sync-single,.td-sync-branches{min-width:0;margin:4px 0 4px var(--td-sync-indent)}
.td-sync-branches{display:flex;flex-direction:column;gap:4px;padding-inline-start:8px;border-inline-start:.5px solid var(--dsw-alias-border-l2)}
.td-sync-branches>button{align-self:flex-start}
.td-sync-filename{margin-inline-start:8px;font-family:var(--ds-font-family-code,monospace);font-size:var(--dsh-content-font-size-secondary,13px)}
.td-sync-details{display:grid;gap:4px;min-width:0}
.td-sync-branches .td-sync-details{margin:4px 0 2px var(--td-sync-indent)}
.td-sync-note,.td-sync-box{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.td-sync-note,.td-sync-box p{margin:4px 0}
.td-sync-box{box-sizing:border-box;min-width:0;overflow:hidden;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block)}
.td-sync-banner{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.td-sync-scroll{box-sizing:border-box;max-height:min(var(--dsl-terminal-output-max-height,224px),45dvh);overflow:auto;padding:8px 12px}
.td-sync-scroll:focus-visible{outline:1px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.td-sync dl{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:0;font-size:12px}
.td-sync dt{color:var(--dsw-alias-label-tertiary)}.td-sync dd{margin:0;overflow-wrap:anywhere}
.td-sync-raw{max-height:min(160px,30dvh)}
.td-sync-raw pre{margin:8px 0 0;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2);white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--ds-font-family-code,monospace)}
`;
