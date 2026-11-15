// The Moon's phase as seen from Earth at an instant: the line under the time scrubber, and the
// same words and number in getState.
import { moonGeometry, phaseName } from '../astro/ephemeris';

export interface MoonPhase {
  /** "New Moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full Moon", ... */
  name: string;
  /** Sunlit part of the disc that faces Earth, percent, rounded as it is shown. */
  litFromEarthPct: number;
  /** True between new and full Moon. */
  waxing: boolean;
}

export function moonPhaseAt(timeMs: number): MoonPhase {
  const g = moonGeometry(new Date(timeMs));
  return { name: phaseName(g), litFromEarthPct: Math.round(g.litFraction * 100), waxing: g.waxing };
}

/** As the scrubber shows it: "First quarter · 51% lit from Earth". */
export function moonPhaseText(p: MoonPhase): string {
  return `${p.name} · ${p.litFromEarthPct}% lit from Earth`;
}
