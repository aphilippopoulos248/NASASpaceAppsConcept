// Presentation state of the surface HUD: how the skyline chart is shown, whether the key
// metrics are folded, and which blockage explanation is on screen. It is not part of the
// shared AppState (a contract), so it lives here; it changes only through the registered
// actions in hudActions.ts, like everything else a user can do.
import type { Blockage } from '../../analysis/types';

export type ChartSize = 'hidden' | 'compact' | 'expanded';
/** 'skyline' = azimuth against elevation; 'time' = elevation and clearance against time. */
export type ChartMode = 'skyline' | 'time';

export interface HudState {
  chart: ChartSize;
  chartMode: ChartMode;
  /** The chart's data as a table instead of the drawing. */
  chartTable: boolean;
  /** Skyline mode: the whole circle, or only the azimuths the Sun and Earth cross in the window. */
  chartFit: 'full' | 'tracks';
  metricsOpen: boolean;
  /** The blockage explanation on show, with the scenario it belongs to and the site's own terrain height (metres above the reference sphere, NaN when unknown); null when none. */
  explanation: { blockage: Blockage; scenarioId: string; siteElevationM: number } | null;
}

const narrow = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 700px)').matches;

let state: HudState = { chart: 'compact', chartMode: 'skyline', chartTable: false, chartFit: 'full', metricsOpen: true, explanation: null };
let phoneDefaultsApplied = false;
const listeners = new Set<(s: Readonly<HudState>) => void>();

/** On a phone the panels start folded, so the landscape is what one sees first. Applied once, at mount. */
export function applyPhoneDefaults(): void {
  if (phoneDefaultsApplied) return;
  phoneDefaultsApplied = true;
  if (narrow()) state = { ...state, chart: 'hidden', metricsOpen: false };
}

export function hudState(): Readonly<HudState> {
  return state;
}

export function setHudState(patch: Partial<HudState>): void {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof HudState)[]) {
    if (patch[key] !== undefined && !Object.is(state[key], patch[key])) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn(state);
}

export function onHudState(fn: (s: Readonly<HudState>) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For tests. */
export function resetHudState(): void {
  state = { chart: 'compact', chartMode: 'skyline', chartTable: false, chartFit: 'full', metricsOpen: true, explanation: null };
  phoneDefaultsApplied = false;
  listeners.clear();
}
