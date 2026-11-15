// The user's requirements, one rule for every panel and for the assistant (task T-46).
//
// The solar elevation band of the Filters panel starts at 0 to 90 degrees: every elevation
// above the horizontal. Nobody asked for that; it is the absence of a band. While the band is
// at that default there is nothing to check, so no panel and no action result may report the
// Sun as "outside the required band" (it would say that about every window with a night).
import type { AppState } from './types';

/** The solar elevation band when nobody has set one (the Filters panel's default, src/core/store.ts). */
export const DEFAULT_SUN_BAND = { minDeg: 0, maxDeg: 90 } as const;

/** True when a solar elevation band is required: the user has set anything other than the default 0 to 90 degrees. */
export function sunBandRequired(s: Pick<AppState, 'sunElMinDeg' | 'sunElMaxDeg'>): boolean {
  return s.sunElMinDeg !== DEFAULT_SUN_BAND.minDeg || s.sunElMaxDeg !== DEFAULT_SUN_BAND.maxDeg;
}

/** Said wherever a requirement result would otherwise stand. */
export const NO_SUN_BAND_TEXT = 'No solar elevation band is required (the Filters panel is at its default, 0° to 90°), so there is nothing to check.';
