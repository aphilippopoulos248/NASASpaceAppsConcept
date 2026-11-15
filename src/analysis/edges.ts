// Spells that run past the edges of a mission window, followed to their real ends.
//
// The window metrics hold every spell as the window shows it: sunlit and dark, Earth's centre
// in view and hidden. A spell that touches an edge is flagged open there (openStart / openEnd)
// and is only known to last "at least" that long. edgeSpells() follows each such spell outward
// with the in-app model, which is valid at any date, until the state really changes or
// EXTEND_LIMIT_DAYS have been searched: the same search analyse() runs for the longest darkness
// and the longest Earth gap (metrics.longestDarknessFull / longestEarthGapFull), applied to every
// spell at an edge (at most two per list). For the mission-window table and its export.
//
// Pure math on a finished SiteAnalysis: no terrain is read, the skyline is the analysis' own.
import { EXTEND_LIMIT_DAYS, fullSpans } from './extend';
import { modelEphemeris, tabulatedEphemeris, type Ephemeris } from './sky';
import type { FullSpan, Interval, SiteAnalysis } from './types';
import { indicators, sampleTimes } from './window';

/** The four lists of spells in WindowMetrics. */
export type SpellList = 'sunlit' | 'dark' | 'earth' | 'earthGap';

export interface EdgeSpell {
  list: SpellList;
  /** Index of the spell in its list (sunIntervals, darkIntervals, earthIntervals, earthGapIntervals). */
  index: number;
  /** The spell in full. Where `startFound` / `endFound` is false it lasts at least `hours`. */
  full: FullSpan;
}

/** Steps of the search beyond a window edge (as in analyse()): the Sun can slip past a ridge within the hour, Earth barely moves. */
const SUN_STEP_MS = 20 * 60_000;
const EARTH_STEP_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

const cache = new WeakMap<SiteAnalysis, EdgeSpell[]>();

/** Every spell of the window that runs past one of its edges, measured in full. Empty when the site has no elevation data. */
export function edgeSpells(a: SiteAnalysis, limitDays = EXTEND_LIMIT_DAYS): EdgeSpell[] {
  if (limitDays === EXTEND_LIMIT_DAYS) {
    const hit = cache.get(a);
    if (hit) return hit;
  }
  const p = a.horizon;
  const m = a.metrics;
  const out: EdgeSpell[] = [];
  if (!Number.isFinite(p.siteElevationM)) return out;

  const { startMs, endMs } = sampleTimes(a.scenario);
  const limitMs = limitDays * DAY_MS;
  const obsH = p.siteElevationM + p.mastHeightM;
  // The model outside the window, tabulated on first use for each side (as analyse() does).
  let before: Ephemeris | null = null, after: Ephemeris | null = null;
  const direct = modelEphemeris(p.site, obsH);
  const outside: Ephemeris = {
    source: 'model',
    note: direct.note,
    at(t, o) {
      if (t < startMs) (before ??= tabulatedEphemeris(p.site, obsH, startMs - limitMs, startMs)).at(t, o);
      else if (t > endMs) (after ??= tabulatedEphemeris(p.site, obsH, endMs, endMs + limitMs)).at(t, o);
      else direct.at(t, o);
    },
    instant: direct.instant,
  };
  const ind = indicators(p, outside);
  // fullSpans() follows a spell while its indicator is not positive: "on" spells are followed on the negated indicator.
  const lists: [SpellList, Interval[], (t: number) => number, number][] = [
    ['sunlit', m.sunIntervals, (t) => -ind.sunAny(t), SUN_STEP_MS],
    ['dark', m.darkIntervals, ind.sunAny, SUN_STEP_MS],
    ['earth', m.earthIntervals, (t) => -ind.earth(t), EARTH_STEP_MS],
    ['earthGap', m.earthGapIntervals, ind.earth, EARTH_STEP_MS],
  ];
  for (const [list, spells, g, step] of lists) {
    const atEdge = spells.map((iv, index) => ({ iv, index })).filter(({ iv }) => iv.openStart || iv.openEnd);
    const full = fullSpans(atEdge.map((x) => x.iv), g, step, limitDays);
    atEdge.forEach((x, k) => out.push({ list, index: x.index, full: full[k] }));
  }
  if (limitDays === EXTEND_LIMIT_DAYS) cache.set(a, out);
  return out;
}
