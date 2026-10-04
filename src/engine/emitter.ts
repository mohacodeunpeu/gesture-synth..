/** Minimal typed event emitter for realtime UI feedback (no React state involved). */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Set<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(type: K, cb: (payload: Events[K]) => void): () => void {
    let set = this.handlers[type];
    if (!set) this.handlers[type] = set = new Set();
    set.add(cb);
    return () => set.delete(cb);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers[type];
    if (!set) return;
    for (const cb of set) {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[emitter] ${String(type)} handler failed`, err);
      }
    }
  }
}
