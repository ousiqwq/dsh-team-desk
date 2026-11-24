// Embedded in the supported native reviewer. Each review gets its own reference table.
export function createTeamReviewHistory(sessionId, confirmNotice) {
  const notices = new Map();
  let previousScope;
  let fileRows = new Map();
  const intros = [
    'The following information describes your current session:',
    'The following information describes your current session. It replaces earlier versions of this context, including any retained in conversation summaries.',
  ];
  const sharedMarker = '\n当前共享约定（数据）：\n';
  const wrap = (intro, sections) => '<system-reminder>\n' + intro + '\n\n' + sections.join('\n\n') + '\n</system-reminder>';

  function hasKeys(value, keys) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
  }

  function resetRows() {
    previousScope = undefined;
    fileRows.clear();
  }

  function projectRows(sections, teamIndex, seq) {
    const team = sections[teamIndex].text;
    const start = team.indexOf(sharedMarker);
    if (start < 0 || start !== team.lastIndexOf(sharedMarker)) return;
    const line = start + sharedMarker.length;
    const newline = team.indexOf('\n', line);
    const end = newline < 0 ? team.length : newline;
    const value = team.slice(line, end);
    let shared;
    try { shared = JSON.parse(value); } catch { return; }
    const validRow = row => hasKeys(row, ['resource', 'version', 'origin'])
      && [row.resource, row.version, row.origin].every(field => typeof field === 'string');
    if (!hasKeys(shared, ['defaults', 'values', 'changes']) || JSON.stringify(shared) !== value
        || !Array.isArray(shared.changes) || !shared.changes.every(validRow)) return;

    // Policy, working directory, team and shared configuration delimit the references.
    const scope = JSON.stringify(sections.map((section, index) => [section.name, index === teamIndex
      ? [team.slice(0, line), {...shared, changes: []}, team.slice(end)] : section.text]));
    if (scope !== previousScope) resetRows();
    previousScope = scope;
    const nextRows = new Map();
    let reused = false;
    const changes = shared.changes.map((row, index) => {
      const key = JSON.stringify(row);
      const first = fileRows.get(key);
      nextRows.set(key, first ?? [seq, index]);
      if (!first) return row;
      reused = true;
      return {sameFileChangeAs: first};
    });
    fileRows = nextRows;
    return {text: reused ? team.slice(0, line) + JSON.stringify({...shared, changes}) + team.slice(end) : team, reused};
  }

  function runtime(entry, text, seq) {
    const {source} = entry;
    if (!hasKeys(source, ['kind', 'form', 'sections']) || source.form !== 'snapshot' || !Array.isArray(source.sections)) return;
    const {sections} = source;
    if (!sections.every(section => hasKeys(section, ['name', 'text']) && typeof section.name === 'string' && typeof section.text === 'string')) return;
    const teamIndex = sections.findIndex(section => section.name === 'team-desk:collaboration');
    if (teamIndex < 0 || new Set(sections.map(section => section.name)).size !== sections.length) return;
    const texts = sections.map(section => section.text);
    const intro = intros.find(intro => text === wrap(intro, texts));
    if (!intro) return;

    // Only discard the second copy after verifying all original section boundaries.
    const compactSource = {kind: source.kind, form: source.form, eventSeq: seq,
      sections: sections.map(section => ({name: section.name, textLength: section.text.length}))};
    const rows = projectRows(sections, teamIndex, seq);
    if (!rows) resetRows();
    if (rows?.reused) {
      texts[teamIndex] = rows.text;
      compactSource.sameFileChangeAs = '[eventSeq, zero-based changes index] refers to the identical resource, version and origin in the earlier full row';
    }
    return {...entry, source: compactSource, content: [{type: 'text', text: rows?.reused ? wrap(intro, texts) : text}]};
  }

  return function project(entry, id, seq) {
    const source = entry?.source;
    if (entry?.kind !== 'user-message' || entry.role !== 'fact' || !Number.isSafeInteger(seq)
        || !Array.isArray(entry.content) || entry.content.length !== 1 || !hasKeys(entry.content[0], ['type', 'text'])
        || entry.content[0].type !== 'text' || typeof entry.content[0].text !== 'string') {
      if (source?.kind === 'runtime-context') resetRows();
      return;
    }
    const text = entry.content[0].text;
    if (source?.kind === 'runtime-context') {
      const compact = runtime(entry, text, seq);
      if (!compact) resetRows();
      return compact;
    }
    if (source?.kind !== 'agent-message' || source.form !== 'relay' || typeof id !== 'string' || !id.startsWith('team-desk:')) return;
    // Check the entire native envelope against the durable sent record before comparing its body.
    const identity = confirmNotice(id, source.senderSessionId, text);
    if (!identity) return;
    const newline = text.indexOf('\n');
    if (newline < 0) return;
    const key = JSON.stringify([source, identity, text.slice(newline + 1)]);
    const first = notices.get(key);
    const compactSource = {...source, notification: id, recipient: sessionId, eventSeq: seq};
    if (first === undefined) {
      notices.set(key, seq);
      return {...entry, source: compactSource};
    }
    return {...entry, source: compactSource, content: [{type: 'text',
      text: 'Repeated machine notification. Same source, destination, scope and content as event ' + first + '.'}]};
  };
}
