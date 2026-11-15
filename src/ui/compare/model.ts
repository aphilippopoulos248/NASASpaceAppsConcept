// What the compare panel says, worked out from the analyses: pure functions from results to
// rows and sentences, so they can be tested without a browser. Every number comes from a
// SiteAnalysis; a value that does not exist is "not available", never a stand-in.
import { blockageAt as realBlockageAt, nextEvents as realNextEvents } from '../../analysis/api';
import type { Blockage, FullSpan, SiteAnalysis, SkyEvent } from '../../analysis/types';
import { checkRequirements } from '../../core/analysisReport';
import { EVENT_INFO } from '../../core/skyEvents';
import { spanText } from '../../core/scenario';
import { formatDuration } from '../../core/time';
import { MOON_RADIUS_M, type AppState, type Scenario } from '../../core/types';
import { coordsText, degText, distanceText, hoursText, NOT_AVAILABLE, pctText, resolutionText, signedText, utcText } from './format';

/** The two instant lookups of the science core; replaceable in tests. */
export interface Science {
  blockageAt: (a: SiteAnalysis, body: 'sun' | 'earth', timeMs: number) => Blockage;
  nextEvents: (a: SiteAnalysis, timeMs: number) => Record<SkyEvent['type'], SkyEvent | null>;
}
export const SCIENCE: Science = { blockageAt: realBlockageAt, nextEvents: realNextEvents };

/** How a difference reads for a planner: B better than A, worse, the same, or no judgement implied. */
export type Tone = 'better' | 'worse' | 'same' | 'none';

export interface CompareRow {
  key: string;
  label: string;
  /** What the figure means, for a tooltip and for screen readers. */
  hint?: string;
  a: string;
  b: string;
  /** B minus A with its unit; empty when the two cannot be subtracted. */
  delta: string;
  tone: Tone;
}

const EMPTY = '—';
const HOUR_MS = 3_600_000;

/** Great-circle distance between two points on the reference sphere, metres. */
function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * MOON_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * What defines each side: site, coordinates, arrival, end of the window, its length and the
 * mast height, with what differs between the two said in the last column ("same site",
 * "24 h later"). Known as soon as a scenario is saved, before any analysis.
 */
export function scenarioRows(a: Scenario | null, b: Scenario | null): CompareRow[] {
  const side = (text: (sc: Scenario) => string) => ({ a: a ? text(a) : EMPTY, b: b ? text(b) : EMPTY });
  const when = (d: number) => (d === 0 ? 'same time' : `${spanText(d / HOUR_MS)} ${d > 0 ? 'later' : 'earlier'}`);
  const end = (sc: Scenario) => sc.startMs + sc.durationH * HOUR_MS;
  const both = a && b ? { a, b } : null;
  const apart = both ? distanceM(both.a.site, both.b.site) : NaN;
  const row = (key: string, label: string, text: (sc: Scenario) => string, delta: string, hint?: string): CompareRow => ({ key, label, hint, ...side(text), delta, tone: 'none' });
  return [
    row('site', 'Site', (sc) => sc.site.name, both ? (apart < 0.5 ? 'same site' : `${distanceText(apart)} apart`) : ''),
    row('coords', 'Coordinates', (sc) => coordsText(sc.site.lat, sc.site.lon, 4), both && apart < 0.5 ? 'same point' : '', 'Latitude and longitude in degrees, Moon Mean Earth / Polar Axis frame; longitude east-positive, written as E or W.'),
    row('arrival', 'Arrival (window start)', (sc) => utcText(sc.startMs), both ? when(both.b.startMs - both.a.startMs) : ''),
    row('end', 'Window end', (sc) => utcText(end(sc)), both ? when(end(both.b) - end(both.a)) : ''),
    row('length', 'Window length', (sc) => spanText(sc.durationH), both ? (both.a.durationH === both.b.durationH ? 'same length' : `${spanText(both.b.durationH - both.a.durationH)} ${both.b.durationH > both.a.durationH ? 'longer' : 'shorter'}`) : ''),
    row('mast', 'Observer height', (sc) => `${sc.mastHeightM} m above the ground`, both ? (both.a.mastHeightM === both.b.mastHeightM ? 'same height' : `${signedText(both.b.mastHeightM - both.a.mastHeightM, 1).replace(/\.0$/, '')} m`) : '', 'Height of the antenna or solar array above the local terrain (the mast height). A higher observer sees over nearby ridges.'),
  ];
}

/** Where the shared clock stands against one side's mission window, in words. */
export function clockPosition(sc: Pick<Scenario, 'startMs' | 'durationH'>, timeMs: number): string {
  const end = sc.startMs + sc.durationH * HOUR_MS;
  if (timeMs < sc.startMs) return `${formatDuration((sc.startMs - timeMs) / HOUR_MS)} before its window starts`;
  if (timeMs > end) return `${formatDuration((timeMs - end) / HOUR_MS)} after its window ended`;
  return `${formatDuration((timeMs - sc.startMs) / HOUR_MS)} into its window`;
}

/** Tone of a difference d = B - A when smaller (or larger) is better; differences below `eps` count as the same. */
function toneOf(d: number, lowerIsBetter: boolean, eps = 0.05): Tone {
  if (!Number.isFinite(d)) return 'none';
  if (Math.abs(d) < eps) return 'same';
  return d < 0 === lowerIsBetter ? 'better' : 'worse';
}

function numberRow(
  key: string, label: string, hint: string | undefined, a: SiteAnalysis | null, b: SiteAnalysis | null,
  value: (x: SiteAnalysis) => number, text: (x: SiteAnalysis) => string, unit: string, lowerIsBetter: boolean | null, digits = 1,
): CompareRow {
  const va = a ? value(a) : NaN, vb = b ? value(b) : NaN;
  const d = vb - va;
  return {
    key, label, hint,
    a: a ? text(a) : EMPTY,
    b: b ? text(b) : EMPTY,
    delta: Number.isFinite(d) ? `${signedText(d, digits)} ${unit}`.trim() : '',
    tone: lowerIsBetter === null ? 'none' : toneOf(d, lowerIsBetter, 0.5 * 10 ** -digits),
  };
}

const fullText = (f: FullSpan): string =>
  f.startFound && f.endFound
    ? `${hoursText(f.hours)}, ${utcText(f.startMs).replace(' UTC', '')} to ${utcText(f.endMs)}`
    : `at least ${hoursText(f.hours)}: no ${!f.endFound && !f.startFound ? 'start or end' : !f.endFound ? 'end' : 'start'} within ${f.limitDays} days of the window`;

/** A spell measured in full is worth its own row when it differs from what the window shows of it. */
const fullMatters = (f: FullSpan | undefined, inWindowH: number): f is FullSpan => !!f && (!f.startFound || !f.endFound || f.hours > inWindowH + 0.05);

function fullRow(key: string, label: string, hint: string, a: SiteAnalysis | null, b: SiteAnalysis | null, pick: (x: SiteAnalysis) => [FullSpan | undefined, number]): CompareRow | null {
  const [fa, ia] = a ? pick(a) : [undefined, NaN], [fb, ib] = b ? pick(b) : [undefined, NaN];
  if (!fullMatters(fa, ia) && !fullMatters(fb, ib)) return null;
  // The side whose spell lies inside the window shows that same figure, so the two can be read together.
  const side = (x: SiteAnalysis | null, f: FullSpan | undefined, inWindow: number) => (!x ? EMPTY : f ? fullText(f) : hoursText(inWindow));
  const known = (f: FullSpan | undefined, inWindow: number) => (f ? (f.startFound && f.endFound ? f.hours : NaN) : inWindow);
  const d = known(fb, ib) - known(fa, ia);
  return { key, label, hint, a: side(a, fa, ia), b: side(b, fb, ib), delta: Number.isFinite(d) ? `${signedText(d)} h` : '', tone: toneOf(d, true) };
}

/** The mission-window figures of the two sides and B minus A. Either side may be missing (not saved, still analysing, failed). */
export function windowRows(a: SiteAnalysis | null, b: SiteAnalysis | null): CompareRow[] {
  const rows: (CompareRow | null)[] = [
    numberRow('sunlight', 'Sunlight', 'Time-averaged visible part of the Sun\'s disc over the mission window, against the terrain skyline. Earth passing in front of the Sun is included.', a, b, (x) => x.metrics.illuminationPct, (x) => pctText(x.metrics.illuminationPct), 'points', false),
    numberRow('sunAny', 'Any Sun above the skyline', 'Share of the window with any part of the Sun\'s disc showing.', a, b, (x) => x.metrics.sunAnyPct, (x) => pctText(x.metrics.sunAnyPct), 'points', false),
    numberRow('darkness', 'Longest darkness in the window', 'Longest unbroken spell with the Sun entirely hidden, inside the mission window. "or more" means it runs into the edge of the window.', a, b, (x) => x.metrics.longestDarknessH, (x) => `${hoursText(x.metrics.longestDarknessH)}${x.metrics.darknessOpenEnded && x.metrics.longestDarknessH >= 0.05 ? ' or more' : ''}`, 'h', true),
    fullRow('darknessFull', 'Longest darkness in full', 'The longest darkness that touches the window, followed past the window\'s edges to its real start and end (searched up to 60 days each way).', a, b, (x) => [x.metrics.longestDarknessFull, x.metrics.longestDarknessH]),
    numberRow('earth', 'Earth\'s centre in view', 'Share of the window with geometric line of sight to Earth\'s centre over the terrain skyline. Geometry only: not a statement about a radio link.', a, b, (x) => x.metrics.earthVisiblePct, (x) => pctText(x.metrics.earthVisiblePct), 'points', false),
    numberRow('gap', 'Longest Earth gap in the window', 'Longest unbroken spell without line of sight to Earth\'s centre, inside the mission window.', a, b, (x) => x.metrics.longestEarthGapH, (x) => `${hoursText(x.metrics.longestEarthGapH)}${x.metrics.earthGapOpenEnded && x.metrics.longestEarthGapH >= 0.05 ? ' or more' : ''}`, 'h', true),
    fullRow('gapFull', 'Longest Earth gap in full', 'The longest spell without Earth in view that touches the window, followed past the window\'s edges (searched up to 60 days each way).', a, b, (x) => [x.metrics.longestEarthGapFull, x.metrics.longestEarthGapH]),
    slopeRow(a, b),
    {
      key: 'sunRange', label: 'Sun elevation in the window', hint: 'Lowest and highest elevation of the Sun\'s centre above the local horizontal during the window (not against the skyline).',
      a: a ? rangeText(a) : EMPTY, b: b ? rangeText(b) : EMPTY,
      delta: a && b && Number.isFinite(b.metrics.maxSunElDeg - a.metrics.maxSunElDeg) ? `highest ${signedText(b.metrics.maxSunElDeg - a.metrics.maxSunElDeg)}°` : '', tone: 'none',
    },
    numberRow('elevation', 'Site elevation', 'Terrain height at the site above the 1,737.4 km reference sphere.', a, b, (x) => x.horizon.siteElevationM, (x) => (Number.isFinite(x.horizon.siteElevationM) ? `${Math.round(x.horizon.siteElevationM).toLocaleString('en-US').replace('-', '−')} m` : NOT_AVAILABLE), 'm', null, 0),
  ];
  return rows.filter((r): r is CompareRow => r !== null);
}

const rangeText = (x: SiteAnalysis) => (Number.isFinite(x.metrics.minSunElDeg) ? `${degText(x.metrics.minSunElDeg)} to ${degText(x.metrics.maxSunElDeg)}` : NOT_AVAILABLE);

function slopeRow(a: SiteAnalysis | null, b: SiteAnalysis | null): CompareRow {
  const text = (x: SiteAnalysis) => (Number.isFinite(x.slope.slopeDeg) ? `${degText(x.slope.slopeDeg)} over ${Math.round(x.slope.baselineM)} m` : `${NOT_AVAILABLE}: no elevation data`);
  const d = (b?.slope.slopeDeg ?? NaN) - (a?.slope.slopeDeg ?? NaN);
  // A slope over 10 m of a 3 m survey and one over 120 m of a 60 m grid are different measurements.
  const sameBaseline = !!a && !!b && Math.abs(a.slope.baselineM - b.slope.baselineM) < 0.5;
  return {
    key: 'slope', label: 'Ground slope',
    hint: sameBaseline || !a || !b ? 'Slope of the terrain at the site over the stated baseline, from the finest elevation data there. Hazards smaller than the grid are not seen.' : `Measured over different baselines (${Math.round(a.slope.baselineM)} m and ${Math.round(b.slope.baselineM)} m) because the two sites have elevation data of different resolution: the difference is indicative only.`,
    a: a ? text(a) : EMPTY, b: b ? text(b) : EMPTY,
    delta: Number.isFinite(d) ? `${signedText(d)}°${sameBaseline ? '' : ' (different baselines)'}` : '',
    tone: sameBaseline ? toneOf(d, true) : 'none',
  };
}

function bodyNowText(k: Blockage): string {
  if (!Number.isFinite(k.bodyElDeg)) return NOT_AVAILABLE;
  const where = `${degText(k.bodyElDeg)} elevation`;
  if (!Number.isFinite(k.clearanceDeg)) return `${where}; no skyline (no elevation data)`;
  const covered = k.eclipsedFraction !== undefined && k.eclipsedFraction > 0.005 ? `; Earth covers ${Math.round(k.eclipsedFraction * 100)} % of it` : '';
  return k.clearanceDeg > 0 ? `${where}, ${degText(k.clearanceDeg)} above the skyline${covered}` : `${where}, ${degText(-k.clearanceDeg)} below the skyline (centre hidden)${covered}`;
}

// Which instant each event is (decision D-8): the app's shared wording (src/core/skyEvents.ts).
const EVENT_HINT = (type: SkyEvent['type']): string => {
  const info = EVENT_INFO[type];
  const other = info.body === 'sun' ? (info.rising ? ' The whole disc is clear later; that instant is not listed here yet.' : ' Sunlight starts to fall earlier, when the skyline first cuts the disc; that instant is not listed here yet.') : '';
  return `${info.label}: the next time ${info.instant}, after the shared clock.${other}`;
};
const EVENT_ORDER: readonly SkyEvent['type'][] = ['sunset', 'sunrise', 'earthset', 'earthrise'];

/** Where the Sun and Earth are for each side at the shared clock, and the next rise and set of each inside its window. */
export function nowRows(a: SiteAnalysis | null, b: SiteAnalysis | null, timeMs: number, science: Science = SCIENCE): CompareRow[] {
  const rows: CompareRow[] = [
    {
      key: 'clock', label: 'Clock against the window', hint: 'The one clock of the app, shown against each side\'s own mission window. Rise and set times are only known inside a side\'s window.',
      a: a ? clockPosition(a.scenario, timeMs) : EMPTY, b: b ? clockPosition(b.scenario, timeMs) : EMPTY, delta: '', tone: 'none',
    },
  ];
  for (const body of ['sun', 'earth'] as const) {
    const ka = a ? science.blockageAt(a, body, timeMs) : null, kb = b ? science.blockageAt(b, body, timeMs) : null;
    const d = (kb?.clearanceDeg ?? NaN) - (ka?.clearanceDeg ?? NaN);
    rows.push({
      key: `${body}Now`, label: body === 'sun' ? 'Sun now' : 'Earth now',
      hint: 'Centre of the disc at the shared clock: elevation above the local horizontal, and how far above or below the terrain skyline in that direction.',
      a: ka ? bodyNowText(ka) : EMPTY, b: kb ? bodyNowText(kb) : EMPTY,
      delta: Number.isFinite(d) ? `${signedText(d)}° clearance` : '', tone: 'none',
    });
  }
  const na = a ? science.nextEvents(a, timeMs) : null, nb = b ? science.nextEvents(b, timeMs) : null;
  const when = (e: SkyEvent | null) => (e ? `${utcText(e.timeMs)} (in ${formatDuration((e.timeMs - timeMs) / 3_600_000)})` : 'none after the clock in this window');
  for (const type of EVENT_ORDER) {
    const ea = na?.[type] ?? null, eb = nb?.[type] ?? null;
    if (!ea && !eb && type !== 'sunset' && type !== 'earthset') continue; // the two the planner always asks for stay, the others show when they exist
    let delta = '';
    if (ea && eb) {
      const dh = (eb.timeMs - ea.timeMs) / 3_600_000;
      delta = Math.abs(dh) < 1 / 60 ? 'same time' : `${formatDuration(dh)} ${dh > 0 ? 'later' : 'earlier'}`;
    }
    rows.push({
      key: type, label: EVENT_INFO[type].label,
      hint: EVENT_HINT(type),
      a: a ? when(ea) : EMPTY, b: b ? when(eb) : EMPTY, delta, tone: 'none',
    });
  }
  return rows;
}

export interface RequirementLine {
  slot: 'A' | 'B';
  /** 'info': a fact about the window where no requirement is set (the solar band left at its default). */
  status: 'met' | 'breached' | 'unknown' | 'info';
  text: string;
}

type Requirements = Pick<AppState, 'sunElMinDeg' | 'sunElMaxDeg' | 'maxEarthGapH' | 'slopeLimitDeg'>;

/**
 * The user's requirements against one side, in words: the solar elevation band and the
 * largest Earth gap (both set in the Filters panel) and the slope limit. Facts only.
 */
export function requirementLines(slot: 'A' | 'B', a: SiteAnalysis, s: Requirements, sunElNowDeg: number): RequirementLine[] {
  const lines: RequirementLine[] = [];
  const m = a.metrics;
  const r = checkRequirements(a, s, sunElNowDeg);
  // The slot letter is enough: the panel shows the labels of A and B right beside these lines.
  const who = slot;

  const band = r.sunElevationBand;
  const bandText = `${degText(band.minDeg, 0)} to ${degText(band.maxDeg, 0)}`;
  const range = `${degText(m.minSunElDeg)} to ${degText(m.maxSunElDeg)}`;
  if (!band.required) {
    // The Filters default (0 to 90 deg) is not something the user asked for: say what the Sun does, not that a band fails
    // (one rule with getAnalysis and the surface panel: src/core/requirements.ts).
    if (Number.isFinite(m.minSunElDeg) && Number.isFinite(m.maxSunElDeg))
      lines.push({ slot, status: 'info', text: `${who}: no solar elevation band is set. The Sun's elevation ranges from ${range} during the window${m.minSunElDeg < 0 ? ', so it goes below the horizontal' : ''}.` });
  } else if (band.metForWholeWindow === null) lines.push({ slot, status: 'unknown', text: `${who}: the Sun's elevation is not available, so the required band (${bandText}) cannot be checked.` });
  else if (band.metForWholeWindow) lines.push({ slot, status: 'met', text: `${who}: the Sun's elevation stays inside the required band, ${bandText} (it ranges from ${range}).` });
  else lines.push({ slot, status: 'breached', text: `${who}: the Sun's elevation leaves the required band, ${bandText}, during the window (it ranges from ${range}).` });

  if (r.maxEarthGap) {
    const limit = `${r.maxEarthGap.limitH} h`;
    const gap = `${hoursText(m.longestEarthGapH)}${m.earthGapOpenEnded && m.longestEarthGapH >= 0.05 ? ' or more' : ''}`;
    const full = m.longestEarthGapFull;
    const fullNote = fullMatters(full, m.longestEarthGapH) ? ` It runs past the window edge: ${full.startFound && full.endFound ? `${hoursText(full.hours)} in full` : `at least ${hoursText(full.hours)} in full`}.` : '';
    if (r.maxEarthGap.met === null) lines.push({ slot, status: 'unknown', text: `${who}: the longest Earth gap is not available, so the ${limit} limit cannot be checked.` });
    else if (r.maxEarthGap.met) lines.push({ slot, status: 'met', text: `${who}: the longest Earth gap in the window, ${gap}, is within the ${limit} limit.${fullNote}` });
    else lines.push({ slot, status: 'breached', text: `${who}: the longest Earth gap in the window, ${gap}, is over the ${limit} limit.${fullNote}` });
  }

  const slope = a.slope.slopeDeg;
  if (!Number.isFinite(slope)) lines.push({ slot, status: 'unknown', text: `${who}: the slope is not available (no elevation data), so the ${s.slopeLimitDeg}° slope limit cannot be checked.` });
  else if (slope > s.slopeLimitDeg) lines.push({ slot, status: 'breached', text: `${who}: the slope, ${degText(slope)} over ${Math.round(a.slope.baselineM)} m, is over the ${s.slopeLimitDeg}° slope limit.` });
  else lines.push({ slot, status: 'met', text: `${who}: the slope, ${degText(slope)} over ${Math.round(a.slope.baselineM)} m, is within the ${s.slopeLimitDeg}° slope limit.` });
  return lines;
}

export interface Basis {
  coords: string;
  observer: string;
  ephemeris: string;
  elevationData: string[];
  warnings: string[];
}

/** Where a side's numbers come from: coordinates, observer, ephemeris, elevation data by distance, and its warnings. */
export function basisOf(a: SiteAnalysis): Basis {
  const site = a.scenario.site;
  return {
    coords: `${coordsText(site.lat, site.lon, 4)} (longitude east-positive${site.kind === 'candidate' ? '; a scan candidate' : site.kind === 'custom' ? '; a custom pin' : ''})`,
    observer: Number.isFinite(a.horizon.siteElevationM)
      ? `${a.horizon.mastHeightM} m above terrain that stands ${Math.round(a.horizon.siteElevationM).toLocaleString('en-US').replace('-', '−')} m above the 1,737.4 km sphere`
      : `${a.horizon.mastHeightM} m above the terrain (no elevation data at the site)`,
    ephemeris: a.provenance.ephemerisNote,
    elevationData: a.provenance.dem.map((d) => `${resolutionText(d.resolutionM)} grid, ${(d.fromM / 1000).toFixed(1)} to ${(d.toM / 1000).toFixed(1)} km from the site: ${d.name}`),
    warnings: [...a.warnings],
  };
}

/** The assumptions both sides share, said once, and what each side states differently (site, skyline data, sampling). */
export function splitAssumptions(a: readonly string[], b: readonly string[]): { shared: string[]; onlyA: string[]; onlyB: string[] } {
  const inB = new Set(b), inA = new Set(a);
  return { shared: a.filter((x) => inB.has(x)), onlyA: a.filter((x) => !inB.has(x)), onlyB: b.filter((x) => !inA.has(x)) };
}
