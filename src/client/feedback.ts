export interface EditorAction {
  teamId: string;
  key: string;
  text: string;
  label: string;
  apply(): void | Promise<void>;
  dismiss?(): void;
}

/** Local to this browser's plugin instance. A pane owns the lifetime of its recovery action. */
export class TeamFeedback {
  private listeners = new Set<() => void>();
  private actions: EditorAction[] = [];
  private queue: { id: number; text: string; member?: string }[] = [];
  private sequence = 0;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  currentNotice = () => this.queue[0];
  editorActions = () => this.actions;
  private changed() { for (const listener of this.listeners) listener(); }

  notify = (text: string, member?: string) => {
    if (!text || this.queue.some(item => item.text === text && item.member === member)) return;
    this.queue.push({id: ++this.sequence, text, ...(member ? {member} : {})});
    this.changed();
  };
  focusMember(member: string) {
    const pending = this.queue.filter(item => !item.member || item.member === member);
    if (pending.length === this.queue.length) return;
    this.queue = pending;
    this.changed();
  }
  finish(id: number) {
    if (this.queue[0]?.id !== id) return;
    this.queue.shift();
    this.changed();
  }
  register(action: EditorAction) {
    this.actions = [...this.actions.filter(a => a.teamId !== action.teamId || a.key !== action.key), action];
    this.changed();
    return () => {
      if (!this.actions.includes(action)) return;
      this.actions = this.actions.filter(a => a !== action);
      this.changed();
    };
  }
}
