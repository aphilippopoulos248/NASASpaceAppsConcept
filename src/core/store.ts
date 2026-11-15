// The one application state. Scenes, panels, charts and the assistant all read and
// write through here, which is what keeps time, site and viewpoint in step everywhere.
import type { AppState } from './types';

/** Simulated time is limited to the span the ephemeris model is validated for. */
export const MIN_TIME_MS = Date.UTC(1950, 0, 1);
export const MAX_TIME_MS = Date.UTC(2100, 0, 1);

export type StateKey = keyof AppState;
export type StateListener = (state: Readonly<AppState>, changed: ReadonlySet<StateKey>) => void;

export function initialState(nowMs: number): AppState {
  return {
    timeMs: nowMs,
    playing: false,
    rate: 3600,
    view: 'globe',
    site: null,
    mastHeightM: 2,
    windowStartMs: nowMs,
    windowDurationH: 24,
    delayH: 0,
    compareA: null,
    compareB: null,
    comparing: false,
    slopeLimitDeg: 10,
    maxEarthGapH: null,
    sunElMinDeg: 0,
    sunElMaxDeg: 90,
    decisionProfileId: '',
    decisionOverrides: {},
    overlay: 'off',
    showMissions: true,
    showTerritories: false,
    showFlags: false,
    lightMode: 'real',
    globeCenter: { lat: 0, lon: 0, altitudeKm: 4170 },
    look: { azDeg: 0, elDeg: 0, fovDeg: 70 },
    assistantOpen: false,
  };
}

export class Store {
  private state: AppState;
  private readonly listeners = new Set<{ keys: ReadonlySet<StateKey> | null; fn: StateListener }>();

  constructor(state: AppState) {
    this.state = state;
  }

  get(): Readonly<AppState> {
    return this.state;
  }

  /** Applies a partial update. Listeners run synchronously, once, with the set of keys that really changed. */
  set(patch: Partial<AppState>): void {
    const changed = new Set<StateKey>();
    const next = { ...this.state };
    for (const key of Object.keys(patch) as StateKey[]) {
      const value = patch[key];
      if (value === undefined || Object.is(this.state[key], value)) continue;
      (next as Record<StateKey, unknown>)[key] = value;
      changed.add(key);
    }
    if (!changed.size) return;
    this.state = next;
    for (const l of [...this.listeners]) {
      if (l.keys === null || [...changed].some((k) => l.keys!.has(k))) l.fn(this.state, changed);
    }
  }

  /** Calls `fn` whenever one of `keys` changes (any key when `keys` is null). Returns the unsubscribe function. */
  subscribe(keys: readonly StateKey[] | null, fn: StateListener): () => void {
    const entry = { keys: keys ? new Set(keys) : null, fn };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
}

export const store = new Store(initialState(Date.now()));
