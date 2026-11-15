// Presentation state of the compare panel that is not part of AppState (which is a shared
// contract): the open tab and what each tab was last asked to show.
// Changed only by the panel's registered actions, so the assistant can reach the same state.

export type CompareTab = 'compare';
/** The tabs of the panel, in order. */
export const COMPARE_TABS: readonly CompareTab[] = ['compare'];
export const TAB_TITLE: Record<CompareTab, string> = { compare: 'A and B' };

export interface PanelState {
  tab: CompareTab;
  /** Goes up each time the list of saved comparisons changes. */
  savedRevision: number;
}

export type PanelListener = (state: Readonly<PanelState>, changed: ReadonlySet<keyof PanelState>) => void;

export interface PanelStore {
  get(): Readonly<PanelState>;
  set(patch: Partial<PanelState>): void;
  subscribe(fn: PanelListener): () => void;
}

export function createPanelStore(): PanelStore {
  let state: PanelState = { tab: 'compare', savedRevision: 0 };
  const listeners = new Set<PanelListener>();
  return {
    get: () => state,
    set(patch) {
      const changed = new Set<keyof PanelState>();
      const next = { ...state };
      for (const key of Object.keys(patch) as (keyof PanelState)[]) {
        const value = patch[key];
        if (value === undefined || Object.is(state[key], value)) continue;
        (next as Record<keyof PanelState, unknown>)[key] = value;
        changed.add(key);
      }
      if (!changed.size) return;
      state = next;
      for (const fn of [...listeners]) fn(state, changed);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
