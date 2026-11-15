// The Moon's phase as seen from Earth at an instant: the line under the time scrubber, and the
// same words and number in getState.
//
// At full Moon the phase alone can mislead: during a lunar eclipse the near side faces the Sun
// and is nevertheless in Earth's shadow. The line says so, from the same geometry the rest of
// the app uses (discs of the Sun and Earth as seen from the Moon; Earth's atmosphere ignored).
import { skyAt } from '../analysis/api';
import { moonGeometry, phaseName } from '../astro/ephemeris';
import { MOON_RADIUS_KM } from './types';

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.137;

/**
 * Earth's shadow on the Moon:
 * - 'total': from every point of the Moon, Earth hides the whole Sun (the Moon is inside the umbra);
 * - 'partial': from some of it Earth hides the whole Sun (part of the Moon is in the umbra);
 * - 'penumbral': from some of it Earth hides part of the Sun, from none of it all of the Sun.
 */
export type LunarEclipse = 'total' | 'partial' | 'penumbral';

export interface MoonPhase {
  /** "New Moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full Moon", ... */
  name: string;
  /** Part of the disc that faces Earth which also faces the Sun, percent, rounded as it is shown (the phase; it does not know about eclipses). */
  litFromEarthPct: number;
  /** True between new and full Moon. */
  waxing: boolean;
  /** Earth's shadow on the Moon at this instant, or null when there is none. */
  lunarEclipse: LunarEclipse | null;
}

/** Earth's shadow on the Moon at an instant, from the directions and sizes of the Sun and Earth as seen from the Moon. */
export function lunarEclipseAt(timeMs: number): LunarEclipse | null {
  const g = moonGeometry(new Date(timeMs));
  const dot = g.sunDir[0] * g.earthDir[0] + g.sunDir[1] * g.earthDir[1] + g.sunDir[2] * g.earthDir[2];
  // Far from full Moon nothing can be in the shadow: skip the rest.
  if (dot < 0.999) return null;
  const sep = Math.acos(Math.min(1, dot)) / DEG;
  const earth = Math.asin(EARTH_RADIUS_KM / g.earthDistanceKm) / DEG;
  const sun = skyAt(g.subEarth, 0, timeMs).sun.angularRadiusDeg;
  // Across the Moon, Earth's place in the sky shifts by up to this much against the Sun's.
  const shift = Math.asin(MOON_RADIUS_KM / g.earthDistanceKm) / DEG;
  if (sep + shift < earth - sun) return 'total';
  if (sep - shift < earth - sun) return 'partial';
  if (sep - shift < earth + sun) return 'penumbral';
  return null;
}

export function moonPhaseAt(timeMs: number): MoonPhase {
  const g = moonGeometry(new Date(timeMs));
  return { name: phaseName(g), litFromEarthPct: Math.round(g.litFraction * 100), waxing: g.waxing, lunarEclipse: lunarEclipseAt(timeMs) };
}

const ECLIPSE_TEXT: Record<LunarEclipse, { short: string; long: string }> = {
  total: { short: 'total lunar eclipse', long: 'Total lunar eclipse: the whole Moon is in Earth\'s shadow. From anywhere on the Moon, Earth hides the Sun.' },
  partial: { short: 'partial lunar eclipse', long: 'Partial lunar eclipse: part of the Moon is in Earth\'s shadow. From there, Earth hides the Sun.' },
  penumbral: { short: 'penumbral lunar eclipse', long: 'Penumbral lunar eclipse: from part of the Moon, Earth covers part of the Sun.' },
};

/** As the scrubber shows it: "First quarter · 51% lit from Earth", or during an eclipse "Full Moon · total lunar eclipse". */
export function moonPhaseText(p: MoonPhase): string {
  return p.lunarEclipse ? `${p.name} · ${ECLIPSE_TEXT[p.lunarEclipse].short}` : `${p.name} · ${p.litFromEarthPct}% lit from Earth`;
}

/** The longer sentence behind the line (tooltip): what the percentage is, or what the eclipse means. */
export function moonPhaseDetail(p: MoonPhase): string {
  const phase = `${p.litFromEarthPct}% of the side of the Moon that faces Earth also faces the Sun.`;
  return p.lunarEclipse ? `${ECLIPSE_TEXT[p.lunarEclipse].long} Computed from the discs of the Sun and Earth as seen from the Moon, without Earth's atmosphere. By phase alone: ${phase}` : phase;
}
