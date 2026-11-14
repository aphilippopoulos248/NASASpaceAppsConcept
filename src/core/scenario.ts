// Turning app state into the Scenario the science core analyses.
import type { AppState, Scenario } from './types';
import { isoUtc } from './time';

/** Sampling step of the analysed time series, minutes. */
export const SCENARIO_STEP_MIN = 10;

/** The mission window's real start: the planned start plus the arrival delay being explored. */
export function effectiveStartMs(s: Pick<AppState, 'windowStartMs' | 'delayH'>): number {
  return s.windowStartMs + s.delayH * 3_600_000;
}

export function scenarioKey(sc: Omit<Scenario, 'id' | 'label'>): string {
  return `${sc.site.id}|${sc.mastHeightM}|${sc.startMs}|${sc.durationH}|${sc.stepMin}`;
}

/** The scenario under study now, or null when no site is pinned. */
export function scenarioFromState(s: Readonly<AppState>, label?: string): Scenario | null {
  if (!s.site) return null;
  const base = { site: s.site, mastHeightM: s.mastHeightM, startMs: effectiveStartMs(s), durationH: s.windowDurationH, stepMin: SCENARIO_STEP_MIN };
  const delay = s.delayH ? `, +${s.delayH} h delay` : '';
  return {
    ...base,
    id: scenarioKey(base),
    label: label ?? `${s.site.name}, from ${isoUtc(base.startMs)} for ${s.windowDurationH} h, mast ${s.mastHeightM} m${delay}`,
  };
}
