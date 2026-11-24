// A closed native chat group can contain hundreds of already folded steps. Restore its outer box once.
const foldedHistorySelector = ':is([data-chat-group-key],[data-chat-node-key][data-turn-process-member])[hidden="until-found"]:not([hidden="until-found"] *):not([data-chat-motion]):not([data-chat-motion="collapse"] *):not([data-chat-motion="reveal"] *)';

/** Keep the native row and its scroll anchor. Defer off-screen layout only after measuring its natural height. */
export function observeHistoryRows(surface: HTMLElement): () => void {
  if (!CSS.supports('content-visibility', 'auto') || !CSS.supports('contain-intrinsic-block-size', 'auto 1px')) return () => {};
  const selector = '[data-chat-node-key]';
  const measured = new Set<HTMLElement>();
  const scrollerSelector = '[data-conversation-scroll]';
  const observedScrollers = new Set<HTMLElement>();
  const release = (row: HTMLElement) => {
    if (!measured.delete(row)) return;
    row.classList.remove('td-history-sized');
    row.style.removeProperty('contain-intrinsic-block-size');
  };
  const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && entry.target instanceof HTMLElement) {
      visibility.unobserve(entry.target);
      release(entry.target);
    }
  });
  let foldedRows: HTMLElement[] = [];
  let foldedDirty = true;
  const getFoldedRows = () => {
    if (foldedDirty) {
      const next = new Set(surface.querySelectorAll<HTMLElement>('.td-native '+foldedHistorySelector));
      for (const row of foldedRows) if (!next.has(row)) row.removeAttribute('data-td-folded-root');
      for (const row of next) if (!row.hasAttribute('data-td-folded-root')) row.setAttribute('data-td-folded-root', '');
      foldedRows = [...next];
      foldedDirty = false;
    }
    return foldedRows;
  };
  let resizedSinceMeasure = true;
  let timer: ReturnType<typeof setTimeout>;
  let measurementFrame = 0;
  const cancelMeasurement = () => {
    clearTimeout(timer);
    cancelAnimationFrame(measurementFrame);
  };
  const refresh = () => {
    const remeasure = resizedSinceMeasure;
    for (const row of measured) if (!surface.contains(row)) { visibility.unobserve(row); release(row); }
    for (const old of observedScrollers) if (!surface.contains(old)) {
      resized.unobserve(old);
      observedScrollers.delete(old);
    }
    const scrollers = Array.from(surface.querySelectorAll<HTMLElement>(scrollerSelector));
    getFoldedRows();
    // Each pane has its own width and scroll anchor. Read natural heights for one pane together.
    let index = 0;
    const measurePane = () => {
      while (index < scrollers.length) {
        const scroller = scrollers[index++]!;
        if (!surface.contains(scroller)) continue;
        if (!observedScrollers.has(scroller)) {
          resized.observe(scroller);
          observedScrollers.add(scroller);
        }
        const rows = scroller.querySelectorAll<HTMLElement>(selector);
        if (!rows.length || !scroller.clientHeight) continue;
        if (remeasure) for (const row of rows) if (measured.has(row)) {
          visibility.unobserve(row);
          release(row);
        }
        const view = scroller.getBoundingClientRect();
        const sizes: Array<[HTMLElement, number]> = [];
        for (const row of rows) {
          if (measured.has(row) || row.style.containIntrinsicBlockSize || row.closest('[hidden], [data-chat-motion]:not([data-chat-flow]), [data-streaming]') || row.matches(':focus-within') || row.querySelector('[data-streaming], [data-chat-motion="collapse"], [data-chat-motion="reveal"]')) continue;
          const rect = row.getBoundingClientRect();
          if (rect.height && (rect.bottom < view.top - 96 || rect.top > view.bottom + 96)) sizes.push([row,rect.height]);
        }
        for (const [row, height] of sizes) {
          measured.add(row);
          row.style.containIntrinsicBlockSize = 'auto ' + height + 'px';
          row.classList.add('td-history-sized');
          visibility.observe(row);
        }
        break;
      }
      if (index === scrollers.length) resizedSinceMeasure = false;
      else measurementFrame = requestAnimationFrame(measurePane);
    };
    measurePane();
  };
  const schedule = () => {
    if (sidebar.active()) return;
    cancelMeasurement();
    timer = setTimeout(refresh, 350);
  };
  const sidebar = trackSidebarTransitions(surface, () => [...getFoldedRows(), ...measured], cancelMeasurement, () => {
    // Keep measured off-screen rows skipped until the settled-width measurement pass.
    resizedSinceMeasure = true;
    schedule();
  });
  const resized = new ResizeObserver(() => {
    resizedSinceMeasure = true;
    sidebar.noteResize();
    schedule();
  });
  resized.observe(surface);
  const mutations = new MutationObserver(records => {
    let relevant = false;
    for (const {target, addedNodes, removedNodes} of records) {
      const element = target instanceof Element ? target : target.parentElement;
      if (!element?.closest(scrollerSelector)) {
        const changed = [...addedNodes, ...removedNodes];
        if (changed.some(node => node instanceof Element && (node.matches(scrollerSelector) || node.querySelector(scrollerSelector)))) relevant = true;
        continue;
      }
      relevant = true;
      const row = element.closest<HTMLElement>(selector);
      if (row) { visibility.unobserve(row); release(row); }
    }
    if (relevant) {
      if (records.some(record => record.type !== 'characterData')) foldedDirty = true;
      schedule();
    }
  });
  mutations.observe(surface,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['hidden','data-chat-motion','data-streaming']});
  surface.addEventListener('scrollend',schedule,true);
  schedule();
  return () => {
    sidebar.stop();
    for (const row of foldedRows) row.removeAttribute('data-td-folded-root');
    mutations.disconnect();
    resized.disconnect();
    visibility.disconnect();
    surface.removeEventListener('scrollend',schedule,true);
    cancelMeasurement();
    measured.forEach(release);
  };
}


// Native folded steps retain a searchable subtree. Keep it out of layout during the outer sidebar transition.
function trackSidebarTransitions(surface: HTMLElement, getDeferredRows: () => HTMLElement[], onStart: () => void, onSettled: () => void) {
  const moving = new Set<HTMLElement>();
  const shell = surface.closest<HTMLElement>('[style*="grid-template-columns"]');
  // The host sets data-animating before its children measure their new widths.
  // Arm only on the native layout frame. Other tabs and other teams keep their own state.
  surface.setAttribute('data-td-history-managed', '');
  const arm = () => surface.toggleAttribute('data-td-sidebar-ready', !!shell && !shell.hasAttribute('data-animating'));
  const shellObserver = new MutationObserver(() => {
    if (!shell?.hasAttribute('data-animating')) arm();
  });
  if (shell) shellObserver.observe(shell, {attributes:true, attributeFilter:['data-animating']});
  arm();
  let interrupted = false;
  let frame = 0;
  let lastFrame = 0;
  let sampleCount = 0;
  let sampleMs = 0;
  let pending: HTMLElement[] = [];
  let released = 0;

  const clear = () => {
    cancelAnimationFrame(frame);
    surface.removeAttribute('data-td-measured-paused');
    surface.removeAttribute('data-td-restoring');
    surface.removeAttribute('data-td-sidebar-moving');
    for (let i = 0; i < released; i++) pending[i]!.removeAttribute('data-td-restored');
    pending = [];
    released = 0;
  };
  const noteResize = () => {
    if (!moving.size) return;
    const now = performance.now();
    if (lastFrame) {
      const elapsed = now - lastFrame;
      sampleCount++;
      sampleMs += elapsed;
    }
    lastFrame = now;
  };
  const startRestore = (frameMs: number) => {
    pending = getDeferredRows();
    if (pending.length < 40) { clear(); return; }
    surface.setAttribute('data-td-restoring', '');
    surface.removeAttribute('data-td-measured-paused');
    if (shell?.hasAttribute('data-animating')) surface.removeAttribute('data-td-sidebar-ready');
    surface.removeAttribute('data-td-sidebar-moving');
    const minimum = Math.ceil(pending.length / 10);
    let count = Math.ceil(pending.length / Math.max(4, Math.min(10, frameMs / 5)));
    let previous = 0;
    const releaseBatch = (now: number) => {
      if (previous) {
        // Rendering occurs after the previous callback. Include that cost in the next batch size.
        const elapsed = Math.max(1, now - previous);
        count = Math.max(minimum, Math.min(pending.length, Math.round(count * Math.min(1.5, 24 / elapsed))));
      }
      previous = now;
      const end = Math.min(pending.length, released + count);
      if (end === pending.length) { clear(); return; }
      for (; released < end; released++) pending[released]!.setAttribute('data-td-restored', '');
      frame = requestAnimationFrame(releaseBatch);
    };
    frame = requestAnimationFrame(releaseBatch);
  };
  const track = (event: TransitionEvent) => {
    const target = event.target;
    if (event.propertyName !== 'grid-template-columns' || !(target instanceof HTMLElement) || !target.contains(surface)) return;
    if (event.type === 'transitionrun') {
      if (!moving.size) {
        const alreadyInterrupted = !!shell?.hasAttribute('data-animating') && !surface.hasAttribute('data-td-sidebar-ready');
        clear();
        interrupted = alreadyInterrupted;
        sampleCount = sampleMs = lastFrame = 0;
        onStart();
        // The host has committed its first width change when transitionrun is delivered.
        if (!interrupted) frame = requestAnimationFrame(() => {
          if (moving.size && !interrupted) surface.setAttribute('data-td-measured-paused', '');
        });
        surface.toggleAttribute('data-td-sidebar-moving', !interrupted && !shell?.hasAttribute('data-animating'));
      }
      moving.add(target);
      return;
    }
    if (!moving.delete(target) || moving.size) return;
    cancelAnimationFrame(frame);
    if (event.type === 'transitionend' && !interrupted) startRestore(sampleCount ? sampleMs / sampleCount : 24);
    else clear();
    onSettled();
  };
  const interrupt = () => {
    if (!moving.size && !pending.length && !shell?.hasAttribute('data-animating')) return;
    surface.removeAttribute('data-td-sidebar-ready');
    interrupted = true;
    clear();
    if (!moving.size && !shell?.hasAttribute('data-animating')) arm();
  };
  const onKey = (event: KeyboardEvent) => {
    if (['PageDown','PageUp','Home','End','ArrowUp','ArrowDown',' '].includes(event.key) || event.key === 'F3' || event.key === '/' || event.key === "'" || ((event.ctrlKey || event.metaKey) && /^[fg]$/i.test(event.key))) interrupt();
  };
  const transitions = ['transitionrun','transitionend','transitioncancel'] as const;
  for (const name of transitions) document.addEventListener(name, track, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('beforematch', interrupt, true);
  document.addEventListener('visibilitychange', interrupt, true);
  surface.addEventListener('pointerdown', interrupt, true);
  surface.addEventListener('focusin', interrupt, true);
  surface.addEventListener('wheel', interrupt, {capture:true, passive:true});
  const stop = () => {
    for (const name of transitions) document.removeEventListener(name, track, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('beforematch', interrupt, true);
    document.removeEventListener('visibilitychange', interrupt, true);
    surface.removeEventListener('pointerdown', interrupt, true);
    surface.removeEventListener('focusin', interrupt, true);
    surface.removeEventListener('wheel', interrupt, true);
    shellObserver.disconnect();
    surface.removeAttribute('data-td-history-managed');
    surface.removeAttribute('data-td-sidebar-ready');
    clear();
  };
  return {noteResize, active: () => moving.size > 0, stop};
}
