// Run the native admission checks, archive write and notifications on the same
// registry queue as ordinary sessions. A missing provider means one native row.
const previousRegistryEdits = [
  ['archiveSession(sessionId, options = {}) {\n\t\treturn this.enqueueOperation(async () => {', `archiveSession(sessionId, options = {}) {
		return this.enqueueOperation(() => this.withArchiveGroup(sessionId, async group => {`],
  ['if (this.requireState().archivedSessionIds.includes(sessionId)) return;\n\t\t\tif (!await this.sessionKnown(sessionId))', `const ids = group.filter(id => !this.requireState().archivedSessionIds.includes(id));
			if (!ids.length) return;
			const activity = [];
			for (const id of ids) {
			if (!await this.sessionKnown(id))`],
  ['new WorkspaceUnknownSessionError(sessionId, "archive")','new WorkspaceUnknownSessionError(id, "archive")'],
  ['const activity = await this.ctx.waterfall("workspace/session-activity", { sessionId }, () => Promise.resolve([]));\n\t\t\t\tif (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity);\n\t\t\t}', `activity.push(...await this.ctx.waterfall("workspace/session-activity", { sessionId:id }, () => Promise.resolve([])));
			}
			}
			if (activity.length) throw new WorkspaceActiveSessionError(sessionId, activity);`],
  ['archivedSessionIds: [...state.archivedSessionIds, sessionId]', 'archivedSessionIds: [...state.archivedSessionIds, ...ids]'],
  ['pinnedSessionIds: state.pinnedSessionIds.filter((id) => id !== sessionId)\n\t\t\t});\n\t\t\tif (options.stopActivity === true) await this.stopSessionActivity(sessionId);',`pinnedSessionIds: state.pinnedSessionIds.filter(id => !ids.includes(id))
			});
			for(const sessionId of ids) {
			if (options.stopActivity === true) await this.stopSessionActivity(sessionId);`],
  ['this.ctx.logger.warn("Session archived, but archive follow-up admission failed: %s", error);\n\t\t\t}\n\t\t});','this.ctx.logger.warn("Session archived, but archive follow-up admission failed: %s", error);\n\t\t\t}\n\t\t\t}\n\t\t}));'],
  ['unarchiveSession(sessionId) {\n\t\treturn this.enqueueOperation(async () => {', `withArchiveGroup(sessionId, run) {
		const service = this.ctx.get("teamDeskLifecycle");
		return service ? service.withGroup(sessionId, ids => {
			const access = this.ctx.get("remoteAccess");
			if (ids.some(id => access && !access.allows({kind:"session",id}))) throw Error("Session access denied");
			return run(ids);
		}) : run([sessionId]);
	}
	forgetDeletedTeamSession(id) {
        return this.enqueueOperation(async () => {
            if(this.ctx.get("sessions")?.get(id)||await this.ctx.get("sessionPersistence")?.stat(id))throw Error("Session still exists");
            this.headers.delete(id);
            this.sessionPaths.delete(id);
            this.missingSessionPaths.delete(id);
            this.invalidSessionPaths.delete(id);
            const state=this.requireState();
            if(state.archivedSessionIds.includes(id)||state.pinnedSessionIds.includes(id))
                await this.setState({...state, archivedSessionIds:state.archivedSessionIds.filter(s=>s!==id),pinnedSessionIds:state.pinnedSessionIds.filter(s=>s!==id)});
        });
    }
    unarchiveSession(sessionId) {
		return this.enqueueOperation(() => this.withArchiveGroup(sessionId, async group => {`],
  ['if (!state.archivedSessionIds.includes(sessionId)) return;\n\t\t\tawait this.ctx.parallel("workspace/session-unarchiving", { sessionId });',`const ids = group.filter(id => state.archivedSessionIds.includes(id));
			if (!ids.length) return;
			for (const sessionId of ids) await this.ctx.parallel("workspace/session-unarchiving", { sessionId });`],
  ['archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)\n\t\t\t});\n\t\t});','archivedSessionIds: state.archivedSessionIds.filter(id => !ids.includes(id))\n\t\t\t});\n\t\t}));'],
];

export const previousLifecycleBundles=[
 ['dsh-workspace','4e04f2726c76fc1d1b6c2e7a2a7488f589ccd139303c36ad5e30820fab29de18',previousRegistryEdits],
 ['dsh-agent-loop','48cb4bafc5aaf92af3a37d82e652b8d5dd2310561ea25689538543bd72403f50',[
   ['ready = true;\n\t\t\t\t\tcallerSignal?.removeEventListener("abort", onCallerAbort);','ready = true;\n\t\t\t\t\townerCtx.get("teamDeskLifecycle")?.remember(agent,dispose);\n\t\t\t\t\tcallerSignal?.removeEventListener("abort", onCallerAbort);'],
 ]],
];

export const registryEdits=previousRegistryEdits.map(([before,after])=>[
  before, after.replace(/\tforgetDeletedTeamSession\(id\) \{[\s\S]*?(?=    unarchiveSession\(sessionId\))/, '')
]);
export const lifecycleBundles=[
  [previousLifecycleBundles[0][0],previousLifecycleBundles[0][1],registryEdits],
  [previousLifecycleBundles[1][0],previousLifecycleBundles[1][1],[]],
];
