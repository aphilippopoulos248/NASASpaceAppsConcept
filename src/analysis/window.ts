// Mission-window analysis: Sun/Earth series against the skyline, metrics, events,
// blocking ridge and comparison. Pure and synchronous: runs in a Web Worker in the
// browser and inline under Node.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { computeHorizon, destination, profileIndex, skylineAt, slopeAt, type HorizonOptions } from './horizon';
import { dsnOpportunities } from './dsn';
import { EXTEND_LIMIT_DAYS, fullSpans, longestFull } from './extend';
import { EVENT_PRECISION_MS, hours, intervalsOf, longest } from './intervals';
import { modelEphemeris, skyAt, tabulatedEphemeris, type Ephemeris } from './sky';
import type {
  Blockage, ComparisonDiff, FullSpan, HorizonProfile, Interval, SiteAnalysis, SkyEvent, SkySeries, WindowMetrics,
} from './types';

const RAD = Math.PI / 180;
const H = 3_600_000;
export { EVENT_PRECISION_MS };
/** Strips across a disc when integrating its visible fraction. */
const STRIPS = 24;

// ---------- disc visibility ----------

/**
 * Fraction of a disc of angular radius r (deg) centred at (az, el) that stands above the
 * skyline. The disc is cut into vertical strips; each strip's chord is compared with the
 * skyline at that strip's azimuth (azimuth offsets are scaled by 1/cos(el)).
 * Also returns the clearance of the highest visible point ("any part visible" when > 0).
 */
export function discVisibility(p: HorizonProfile, az: number, el: number, r: number): { fraction: number; topClearance: number } {
  const ce = Math.max(Math.cos(el * RAD), 1e-3);
  let num = 0, den = 0, top = -Infinity;
  for (let k = 0; k < STRIPS; k++) {
    const x = -r + ((k + 0.5) * 2 * r) / STRIPS;
    const c = Math.sqrt(Math.max(0, r * r - x * x));
    const s = skylineAt(p, az + x / ce);
    const vis = Math.min(2 * c, Math.max(0, el + c - s));
    num += vis;
    den += 2 * c;
    top = Math.max(top, el + c - s);
  }
  return { fraction: num / den, topClearance: top };
}

/** Fraction of a disc of radius rs covered by a disc of radius re whose centre is `sep` away (degrees, small-angle). */
export function discOverlap(sep: number, rs: number, re: number): number {
  if (sep >= rs + re) return 0;
  if (sep <= Math.abs(re - rs)) return re >= rs ? 1 : (re * re) / (rs * rs);
  const a1 = rs * rs * Math.acos((sep * sep + rs * rs - re * re) / (2 * sep * rs));
  const a2 = re * re * Math.acos((sep * sep + re * re - rs * rs) / (2 * sep * re));
  const k = 0.5 * Math.sqrt(Math.max(0, (-sep + rs + re) * (sep + rs - re) * (sep - rs + re) * (sep + rs + re)));
  return (a1 + a2 - k) / (Math.PI * rs * rs);
}

/** Angular separation of two az/el directions, degrees. */
export function separation(az1: number, el1: number, az2: number, el2: number): number {
  const c = Math.sin(el1 * RAD) * Math.sin(el2 * RAD) + Math.cos(el1 * RAD) * Math.cos(el2 * RAD) * Math.cos((az1 - az2) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

// ---------- series ----------

export function sampleTimes(s: Scenario): { startMs: number; stepMs: number; n: number; endMs: number } {
  const stepMs = Math.max(1, s.stepMin) * 60_000;
  const endMs = s.startMs + s.durationH * H;
  const n = Math.floor((endMs - s.startMs) / stepMs + 1e-9) + 1;
  return { startMs: s.startMs, stepMs, n, endMs };
}

/** What is known about one instant: positions, clearances and visible fractions. */
interface InstantState {
  sunAz: number; sunEl: number; earthAz: number; earthEl: number;
  sunClearance: number; earthClearance: number;
  /** Fraction of the Sun's disc above the skyline AND not behind Earth. */
  sunVisible: number;
  earthVisible: number;
  sunEclipsed: number;
  /** Clearance of the highest point of the Sun's disc above the skyline (terrain only). */
  sunTop: number;
}

function instantState(p: HorizonProfile, eph: Ephemeris, t: number, o: Float64Array): InstantState {
  eph.at(t, o);
  const sunR = o[4], earthR = o[5];
  const sun = discVisibility(p, o[0], o[1], sunR);
  const ecl = discOverlap(separation(o[0], o[1], o[2], o[3]), sunR, earthR);
  return {
    sunAz: o[0], sunEl: o[1], earthAz: o[2], earthEl: o[3],
    sunClearance: o[1] - skylineAt(p, o[0]),
    earthClearance: o[3] - skylineAt(p, o[2]),
    // Terrain and Earth cover are treated as independent across the disc (exact when either is 0 or 1).
    sunVisible: sun.fraction * (1 - ecl),
    earthVisible: discVisibility(p, o[2], o[3], earthR).fraction,
    sunEclipsed: ecl,
    sunTop: sun.topClearance,
  };
}

/** The sampled series, plus the per-sample top-of-disc clearance used for sunrise and sunset. */
export function buildSeries(s: Scenario, p: HorizonProfile, eph: Ephemeris): { series: SkySeries; sunTop: Float32Array } {
  const { startMs, stepMs, n } = sampleTimes(s);
  const f = () => new Float32Array(n);
  const out = { sunAz: f(), sunEl: f(), earthAz: f(), earthEl: f(), sunClearance: f(), earthClearance: f(), sunVisible: f(), earthVisible: f(), sunEclipsed: f() };
  const sunTop = f();
  const o = new Float64Array(6);
  for (let i = 0; i < n; i++) {
    const st = instantState(p, eph, startMs + i * stepMs, o);
    out.sunAz[i] = st.sunAz; out.sunEl[i] = st.sunEl; out.earthAz[i] = st.earthAz; out.earthEl[i] = st.earthEl;
    out.sunClearance[i] = st.sunClearance;
    out.earthClearance[i] = st.earthClearance;
    out.sunVisible[i] = st.sunVisible;
    out.earthVisible[i] = st.earthVisible;
    out.sunEclipsed[i] = st.sunEclipsed;
    sunTop[i] = st.sunTop;
  }
  return { series: { startMs, stepMs, n, ...out, source: eph.source }, sunTop };
}

/**
 * Continuous indicators of a skyline and an ephemeris at an instant, each positive while its
 * state is "on": some of the Sun above the skyline; Earth's disc overlapping the Sun's; some of
 * the Sun actually shining (above the skyline and not wholly behind Earth); Earth's centre above
 * the skyline.
 */
export function indicators(p: HorizonProfile, eph: Ephemeris) {
  const o = new Float64Array(6);
  const sunTop = (t: number) => { eph.at(t, o); return discVisibility(p, o[0], o[1], o[4]).topClearance; };
  const overlap = (t: number) => { eph.at(t, o); return o[5] + o[4] - separation(o[0], o[1], o[2], o[3]); };
  const sunAny = (t: number) => {
    eph.at(t, o);
    // > 0 while some of the Sun is not behind Earth
    const notTotal = separation(o[0], o[1], o[2], o[3]) - (o[5] - o[4]);
    const top = discVisibility(p, o[0], o[1], o[4]).topClearance;
    return top < notTotal ? top : notTotal;
  };
  const earth = (t: number) => { eph.at(t, o); return o[3] - skylineAt(p, o[2]); };
  return { sunTop, overlap, sunAny, earth };
}

export interface WindowResult {
  series: SkySeries;
  metrics: WindowMetrics;
  events: SkyEvent[];
}

/** Series, metrics and events for one scenario over a skyline. */
export function evaluateWindow(s: Scenario, p: HorizonProfile, eph: Ephemeris): WindowResult {
  const times = sampleTimes(s);
  const { startMs, stepMs, n, endMs } = times;
  const { series, sunTop } = buildSeries(s, p, eph);
  const o = new Float64Array(6);

  // The window may end between two samples: the state at the very end is then evaluated as well,
  // so that a rise or set in the last partial step is not missed.
  const lastSampleMs = startMs + (n - 1) * stepMs;
  const tail = lastSampleMs < endMs ? instantState(p, eph, endMs, o) : null;
  const count = tail ? n + 1 : n;
  const timeAt = (i: number) => (i < n ? startMs + i * stepMs : endMs);

  // Continuous indicators (positive = "on") for refining the crossings.
  const { sunTop: gSunTop, overlap: gOverlap, sunAny: gSunAny, earth: gEarth } = indicators(p, eph);

  // Above the skyline (sunrise/sunset events) versus actually shining (skyline and Earth eclipses: the metrics).
  const terrain = intervalsOf((i) => (i < n ? sunTop[i] : tail!.sunTop) > 0, gSunTop, timeAt, count, startMs, endMs);
  const sun = intervalsOf((i) => (i < n ? series.sunVisible[i] : tail!.sunVisible) > 0, gSunAny, timeAt, count, startMs, endMs);
  const eclipse = intervalsOf((i) => (i < n ? series.sunEclipsed[i] : tail!.sunEclipsed) > 0, gOverlap, timeAt, count, startMs, endMs);
  const earth = intervalsOf((i) => (i < n ? series.earthClearance[i] : tail!.earthClearance) > 0, gEarth, timeAt, count, startMs, endMs);
  const windowMs = endMs - startMs;
  const sumH = (l: Interval[]) => l.reduce((a, iv) => a + hours(iv), 0);

  // Time-averaged visible fraction: trapezoid rule over the samples and the partial last step.
  let integ = 0;
  for (let i = 1; i < n; i++) integ += ((series.sunVisible[i - 1] + series.sunVisible[i]) / 2) * stepMs;
  if (tail) integ += ((series.sunVisible[n - 1] + tail.sunVisible) / 2) * (endMs - lastSampleMs);
  const dark = longest(sun.off);
  const gap = longest(earth.off);
  let maxEl = -Infinity, minEl = Infinity;
  for (let i = 0; i < n; i++) { maxEl = Math.max(maxEl, series.sunEl[i]); minEl = Math.min(minEl, series.sunEl[i]); }
  if (tail) { maxEl = Math.max(maxEl, tail.sunEl); minEl = Math.min(minEl, tail.sunEl); }

  const metrics: WindowMetrics = {
    illuminationPct: windowMs > 0 ? (100 * integ) / windowMs : NaN,
    sunAnyPct: windowMs > 0 ? (100 * sumH(sun.on) * H) / windowMs : NaN,
    longestDarknessH: dark.h,
    darknessOpenEnded: dark.open,
    earthVisiblePct: windowMs > 0 ? (100 * sumH(earth.on) * H) / windowMs : NaN,
    longestEarthGapH: gap.h,
    earthGapOpenEnded: gap.open,
    maxSunElDeg: maxEl,
    minSunElDeg: minEl,
    sunIntervals: sun.on,
    darkIntervals: sun.off,
    earthIntervals: earth.on,
    earthGapIntervals: earth.off,
    eclipseIntervals: eclipse.on,
  };

  const events: SkyEvent[] = [];
  for (const c of terrain.crossings) { eph.at(c.t, o); events.push({ type: c.up ? 'sunrise' : 'sunset', timeMs: c.t, azDeg: o[0] }); }
  for (const c of earth.crossings) { eph.at(c.t, o); events.push({ type: c.up ? 'earthrise' : 'earthset', timeMs: c.t, azDeg: o[2] }); }
  events.sort((a, b) => a.timeMs - b.timeMs);
  return { series, metrics, events };
}

/** Metrics that cannot be computed (no terrain under the site). */
export function unavailableMetrics(): WindowMetrics {
  return {
    illuminationPct: NaN, sunAnyPct: NaN, longestDarknessH: NaN, darknessOpenEnded: false, earthVisiblePct: NaN,
    longestEarthGapH: NaN, earthGapOpenEnded: false, maxSunElDeg: NaN, minSunElDeg: NaN,
    sunIntervals: [], darkIntervals: [], earthIntervals: [], earthGapIntervals: [], eclipseIntervals: [],
  };
}

// ---------- full analysis ----------

/** Steps of the search beyond a window edge: the Sun can slip past a ridge within the hour, Earth barely moves. */
const FOLLOW_SUN_STEP_MS = 20 * 60_000;
const FOLLOW_EARTH_STEP_MS = 60 * 60_000;

/**
 * Follows the darkness and the Earth gap that run past a window edge to their real ends (with the
 * model, which is valid at any date) and records the longest of each, in full, in the metrics.
 */
function addFullSpans(m: WindowMetrics, scenario: Scenario, p: HorizonProfile, warnings: string[]): void {
  const { startMs, endMs } = sampleTimes(scenario);
  const limitMs = EXTEND_LIMIT_DAYS * 86_400_000;
  const obsH = p.siteElevationM + p.mastHeightM;
  // The model outside the window, tabulated on first use for each side.
  let before: Ephemeris | null = null, after: Ephemeris | null = null;
  const direct = modelEphemeris(p.site, obsH);
  const outside: Ephemeris = {
    source: 'model',
    note: direct.note,
    at(t, out) {
      if (t < startMs) (before ??= tabulatedEphemeris(p.site, obsH, startMs - limitMs, startMs)).at(t, out);
      else if (t > endMs) (after ??= tabulatedEphemeris(p.site, obsH, endMs, endMs + limitMs)).at(t, out);
      else direct.at(t, out);
    },
    instant: direct.instant,
  };
  const ind = indicators(p, outside);
  const describe = (what: string, full: FullSpan, inWindowH: number) => {
    if (full.startFound && full.endFound) {
      if (full.hours > inWindowH + 0.05) warnings.push(`${what} that touches this window lasts ${f1(full.hours)} h in full, from ${utcMinute(full.startMs).replace(' UTC', '')} to ${utcMinute(full.endMs)}; the window itself holds ${f1(inWindowH)} h of it at most in one stretch.`);
    } else {
      const where = !full.startFound && !full.endFound ? 'start or end' : !full.endFound ? 'end' : 'start';
      warnings.push(`${what} that touches this window has no ${where} within ${full.limitDays} days of the window: it lasts at least ${f1(full.hours)} h.`);
    }
  };
  if (m.darkIntervals.length) {
    const full = longestFull(fullSpans(m.darkIntervals, ind.sunAny, FOLLOW_SUN_STEP_MS));
    if (full) {
      m.longestDarknessFull = full;
      describe('The longest darkness', full, m.longestDarknessH);
    }
  }
  if (m.earthGapIntervals.length) {
    const full = longestFull(fullSpans(m.earthGapIntervals, ind.earth, FOLLOW_EARTH_STEP_MS));
    if (full) {
      m.longestEarthGapFull = full;
      describe('The longest spell without Earth in view', full, m.longestEarthGapH);
    }
  }
}

export const DEFAULT_SLOPE_BASELINE_FACTOR = 2;

/** The slope baseline used for a site: twice the finest grid there, at least 10 m. */
export function slopeBaselineM(stack: TerrainStack, lat: number, lon: number): number {
  const finest = stack.sources.find((s) => s.covers(lat, lon));
  return Math.max(DEFAULT_SLOPE_BASELINE_FACTOR * (finest?.resolutionM ?? 60), 10);
}

const utcMinute = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Terrain notes that only describe what is loaded (shown as provenance) rather than a limitation (shown as a warning). */
const isDescriptiveNote = (note: string) => /^Elevation data at this point, finest first/.test(note);

export function analyseWith(scenario: Scenario, stack: TerrainStack, eph: Ephemeris, horizonOptions: HorizonOptions = {}): SiteAnalysis {
  const site = { lat: scenario.site.lat, lon: scenario.site.lon };
  const horizon = computeHorizon(stack, site, scenario.mastHeightM, horizonOptions);
  const warnings = [...horizon.warnings, ...stack.notes.filter((n) => !isDescriptiveNote(n))];
  const slope = slopeAt(stack, site, slopeBaselineM(stack, site.lat, site.lon));
  if (!Number.isFinite(slope.slopeDeg)) warnings.push('Slope unavailable: no elevation data around the site.');
  let res: WindowResult;
  let dsn: SiteAnalysis['dsn'];
  if (!Number.isFinite(horizon.siteElevationM)) {
    const times = sampleTimes(scenario);
    const nan = () => new Float32Array(times.n).fill(NaN);
    res = {
      series: { startMs: times.startMs, stepMs: times.stepMs, n: times.n, sunAz: nan(), sunEl: nan(), earthAz: nan(), earthEl: nan(), sunClearance: nan(), earthClearance: nan(), sunVisible: nan(), earthVisible: nan(), sunEclipsed: nan(), source: eph.source },
      metrics: unavailableMetrics(),
      events: [],
    };
    warnings.push('Window metrics unavailable: without terrain at the site there is no skyline to measure against.');
  } else {
    res = evaluateWindow(scenario, horizon, eph);
    dsn = dsnOpportunities(scenario, horizon);
  }
  if (res.metrics.eclipseIntervals.length) {
    const spans = res.metrics.eclipseIntervals.map((iv) => `${utcMinute(iv.startMs).replace(' UTC', '')} to ${utcMinute(iv.endMs)}`).join('; ');
    warnings.push(`Earth passes in front of the Sun during this window (${spans}): the sunlight and darkness figures include it.`);
  }
  if (res.metrics.darknessOpenEnded) warnings.push('The longest darkness runs into the edge of the window: it is a lower bound.');
  if (res.metrics.earthGapOpenEnded) warnings.push('The longest Earth gap runs into the edge of the window: it is a lower bound.');
  // What those spells amount to in full, followed beyond the window.
  if (Number.isFinite(horizon.siteElevationM)) addFullSpans(res.metrics, scenario, horizon, warnings);
  const layersText = horizon.layers.map((l) => `${l.name} (${Math.round(l.resolutionM)} m) from ${(l.fromM / 1000).toFixed(1)} to ${(l.toM / 1000).toFixed(1)} km`).join('; ');
  return {
    scenario,
    horizon,
    series: res.series,
    metrics: res.metrics,
    events: res.events,
    slope,
    provenance: {
      ephemeris: eph.source,
      ephemerisNote: eph.note,
      dem: horizon.layers,
      terrainNotes: [...stack.notes],
      assumptions: [
        `Observer ${horizon.mastHeightM} m above the terrain at ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)} (degrees, east-positive, ME frame); heights above the 1737.4 km sphere.`,
        'Positions are topocentric and airless (no refraction), as JPL Horizons APPARENT=AIRLESS for a coord@301 observer.',
        `Skyline from elevation data, including the Moon's curvature, ${horizon.azStepDeg} deg in azimuth, searched to ${(horizon.maxRangeM / 1000).toFixed(0)} km: ${layersText || 'no data'}.`,
        `Sampled every ${scenario.stepMin} min; rise and set times refined to ${EVENT_PRECISION_MS / 1000} s; the Sun and Earth are discs (visible fraction integrated across each disc).`,
        'Sunrise/sunset = first/last moment any part of the Sun stands above the skyline. Earthrise/Earthset = Earth\'s centre crossing the skyline.',
        'Sunlight also counts Earth passing in front of the Sun (geometric discs; the faint light refracted by Earth\'s atmosphere is ignored).',
        'Earth visibility is geometric line of sight only; it says nothing about a working radio link.',
        `Slope over a ${slope.baselineM} m baseline from ${slope.demName}: hazards smaller than the grid are not seen.`,
      ],
    },
    warnings,
    ...(dsn ? { dsn } : {}),
  };
}

// ---------- instant queries ----------

/** Body az/el at an instant: interpolated from the series inside the window, the model outside it. */
function bodyAt(a: SiteAnalysis, body: 'sun' | 'earth', t: number): { az: number; el: number } {
  const s = a.series;
  const x = (t - s.startMs) / s.stepMs;
  if (x >= 0 && x <= s.n - 1 && s.n > 1) {
    const i = Math.min(s.n - 2, Math.floor(x)), f = x - i;
    const AZ = body === 'sun' ? s.sunAz : s.earthAz, EL = body === 'sun' ? s.sunEl : s.earthEl;
    if (Number.isFinite(AZ[i]) && Number.isFinite(AZ[i + 1])) {
      const v = (k: number) => [Math.cos(EL[k] * RAD) * Math.sin(AZ[k] * RAD), Math.cos(EL[k] * RAD) * Math.cos(AZ[k] * RAD), Math.sin(EL[k] * RAD)];
      const p = v(i), q = v(i + 1);
      const X = p[0] + (q[0] - p[0]) * f, Y = p[1] + (q[1] - p[1]) * f, Z = p[2] + (q[2] - p[2]) * f;
      let az = Math.atan2(X, Y) / RAD;
      if (az < 0) az += 360;
      return { az, el: Math.atan2(Z, Math.hypot(X, Y)) / RAD };
    }
  }
  const sky = skyAt(a.scenario.site, observerHeightM(a), t)[body];
  return { az: sky.azDeg, el: sky.elDeg };
}

/** Height of the analysed observer above the 1737.4 km sphere: terrain plus mast. */
function observerHeightM(a: SiteAnalysis): number {
  return (Number.isFinite(a.horizon.siteElevationM) ? a.horizon.siteElevationM : 0) + a.horizon.mastHeightM;
}

const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);
const pct = (fraction: number) => `${Math.round(fraction * 100)} %`;

export function blockageAt(a: SiteAnalysis, body: 'sun' | 'earth', timeMs: number): Blockage {
  const { az, el } = bodyAt(a, body, timeMs);
  const p = a.horizon;
  const sky = skylineAt(p, az);
  const i = profileIndex(p, az);
  const dist = p.distM[i], hgt = p.heightM[i];
  const layer = p.layers[p.skylineLayer?.[i] ?? 0];
  const ridge = Number.isFinite(dist) ? destination(p.site, i * p.azStepDeg, dist) : { lat: NaN, lon: NaN };
  const clearance = el - sky;
  const name = body === 'sun' ? 'the Sun' : 'Earth';
  const Name = body === 'sun' ? 'The Sun' : 'Earth';

  // Sizes of the discs at this instant (model distances; they differ from Horizons by less than 0.004 %).
  let discVisibleFraction = NaN;
  let eclipsedFraction: number | undefined;
  if (Number.isFinite(sky)) {
    const inst = skyAt(a.scenario.site, observerHeightM(a), timeMs);
    discVisibleFraction = discVisibility(p, az, el, inst[body].angularRadiusDeg).fraction;
    if (body === 'sun') {
      const earth = bodyAt(a, 'earth', timeMs);
      eclipsedFraction = discOverlap(separation(az, el, earth.az, earth.el), inst.sun.angularRadiusDeg, inst.earth.angularRadiusDeg);
    }
  }

  let explanation: string;
  if (!Number.isFinite(sky)) {
    explanation = `${Name} is at ${f2(el)} deg elevation, azimuth ${f1(az)} deg at ${utcMinute(timeMs)}; no skyline is available here because no elevation data covers the site.`;
  } else {
    const data = layer ? `${layer.name}, ${Math.round(layer.resolutionM)} m grid` : 'unknown data';
    const what = `the skyline at azimuth ${f1(az)} deg is ${f2(sky)} deg, formed by terrain ${f1(dist / 1000)} km away at ${Math.round(hgt)} m (${data})`;
    explanation = Math.abs(clearance) < 0.005
      ? `At ${utcMinute(timeMs)} ${name}'s centre is ${f2(el)} deg high and ${what}: its centre is right on the skyline (within 0.01 deg).`
      : clearance > 0
        ? `At ${utcMinute(timeMs)} ${name}'s centre is ${f2(el)} deg high and ${what}: it clears the skyline by ${f2(clearance)} deg.`
        : `At ${utcMinute(timeMs)} ${name}'s centre is ${f2(el)} deg high but ${what}: it is hidden by ${f2(-clearance)} deg.`;
    if (discVisibleFraction > 0.005 && discVisibleFraction < 0.995) {
      explanation += ` About ${pct(discVisibleFraction)} of ${name}'s disc is above the skyline.`;
    } else if (clearance <= 0 && discVisibleFraction >= 0.995) {
      explanation += ` Its disc is still almost entirely above the skyline.`;
    } else if (clearance > 0 && discVisibleFraction <= 0.005) {
      explanation += ` Almost none of its disc is above the skyline.`;
    }
    if (eclipsedFraction !== undefined && eclipsedFraction > 0.005) {
      explanation += eclipsedFraction >= 0.995
        ? ' Earth is in front of the Sun at this moment and covers it completely (an eclipse seen from the site).'
        : ` Earth is in front of the Sun at this moment and covers about ${pct(eclipsedFraction)} of it.`;
    }
  }
  return {
    body, timeMs, blocked: !(clearance > 0), bodyAzDeg: az, bodyElDeg: el, skylineElDeg: sky, clearanceDeg: clearance,
    ridgeDistanceM: dist, ridgeHeightM: hgt, ridge, demName: layer?.name ?? 'none', demResolutionM: layer?.resolutionM ?? NaN, explanation,
    discVisibleFraction,
    ...(eclipsedFraction !== undefined ? { eclipsedFraction } : {}),
  };
}

export function nextEvents(a: SiteAnalysis, timeMs: number): Record<SkyEvent['type'], SkyEvent | null> {
  const out: Record<SkyEvent['type'], SkyEvent | null> = { sunrise: null, sunset: null, earthrise: null, earthset: null };
  for (const e of a.events) if (e.timeMs > timeMs && !out[e.type]) out[e.type] = e;
  return out;
}

// ---------- comparison ----------

const hoursText = (h: number) => (Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`);

/**
 * Short names for the two sides of a comparison. Distinct, short labels are used as they
 * are; otherwise the names say what differs (site, arrival time, mast height, window length).
 */
export function comparisonNames(a: Scenario, b: Scenario): { a: string; b: string } {
  const la = (a.label ?? '').trim(), lb = (b.label ?? '').trim();
  if (la && lb && la !== lb && la.length <= 32 && lb.length <= 32) return { a: la, b: lb };
  const sameSite = Math.abs(a.site.lat - b.site.lat) < 1e-7 && Math.abs(a.site.lon - b.site.lon) < 1e-7;
  if (!sameSite) {
    const na = (a.site.name ?? '').trim(), nb = (b.site.name ?? '').trim();
    if (na && nb && na !== nb) return { a: na, b: nb };
    const at = (s: Scenario) => `the site at ${s.site.lat.toFixed(4)}, ${s.site.lon.toFixed(4)}`;
    return { a: at(a), b: at(b) };
  }
  const partsA: string[] = [], partsB: string[] = [];
  if (a.startMs !== b.startMs) {
    const dH = Math.abs(b.startMs - a.startMs) / H;
    const later = `the arrival ${hoursText(dH)} later`, earlier = 'the earlier arrival';
    partsA.push(b.startMs > a.startMs ? earlier : later);
    partsB.push(b.startMs > a.startMs ? later : earlier);
  }
  if (a.mastHeightM !== b.mastHeightM) {
    partsA.push(`the ${a.mastHeightM} m mast`);
    partsB.push(`the ${b.mastHeightM} m mast`);
  }
  if (a.durationH !== b.durationH) {
    partsA.push(`the ${hoursText(a.durationH)} window`);
    partsB.push(`the ${hoursText(b.durationH)} window`);
  }
  if (!partsA.length) return { a: 'scenario A', b: 'scenario B' };
  // "the earlier arrival with the 2 m mast"
  const join = (parts: string[]) => parts.join(' with ');
  return { a: join(partsA), b: join(partsB) };
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export function compareAnalyses(a: SiteAnalysis, b: SiteAnalysis): ComparisonDiff {
  const A = a.metrics, B = b.metrics;
  const names = comparisonNames(a.scenario, b.scenario);
  const la = names.a, lb = names.b;
  const d = {
    illuminationPct: B.illuminationPct - A.illuminationPct,
    longestDarknessH: B.longestDarknessH - A.longestDarknessH,
    earthVisiblePct: B.earthVisiblePct - A.earthVisiblePct,
    longestEarthGapH: B.longestEarthGapH - A.longestEarthGapH,
    slopeDeg: b.slope.slopeDeg - a.slope.slopeDeg,
  };
  const items: { w: number; text: string }[] = [];
  const edge = (open: boolean) => (open ? ' (at least: it runs into the window edge)' : '');
  const add = (diff: number, scale: number, text: string) => { if (Number.isFinite(diff) && Math.abs(diff) > 1e-9) items.push({ w: Math.abs(diff) / scale, text: capitalise(text) }); };
  add(d.illuminationPct, 5, `${lb} gets ${f1(Math.abs(d.illuminationPct))} percentage points ${d.illuminationPct > 0 ? 'more' : 'less'} sunlight than ${la} (${f1(B.illuminationPct)} % vs ${f1(A.illuminationPct)} % of the window, time-averaged visible disc).`);
  add(d.longestDarknessH, 12, `with ${lb} the longest darkness is ${f1(Math.abs(d.longestDarknessH))} h ${d.longestDarknessH > 0 ? 'longer' : 'shorter'} than with ${la} (${f1(B.longestDarknessH)} h${edge(B.darknessOpenEnded)} vs ${f1(A.longestDarknessH)} h${edge(A.darknessOpenEnded)}).`);
  add(d.earthVisiblePct, 5, `${lb} has line of sight to Earth ${f1(Math.abs(d.earthVisiblePct))} percentage points ${d.earthVisiblePct > 0 ? 'more' : 'less'} of the time than ${la} (${f1(B.earthVisiblePct)} % vs ${f1(A.earthVisiblePct)} %; geometry only).`);
  add(d.longestEarthGapH, 12, `with ${lb} the longest gap without Earth in view is ${f1(Math.abs(d.longestEarthGapH))} h ${d.longestEarthGapH > 0 ? 'longer' : 'shorter'} than with ${la} (${f1(B.longestEarthGapH)} h${edge(B.earthGapOpenEnded)} vs ${f1(A.longestEarthGapH)} h${edge(A.earthGapOpenEnded)}).`);
  add(d.slopeDeg, 3, `the ground at ${lb} is ${f1(Math.abs(d.slopeDeg))} deg ${d.slopeDeg > 0 ? 'steeper' : 'gentler'} than at ${la} (${f1(b.slope.slopeDeg)} deg over ${b.slope.baselineM} m vs ${f1(a.slope.slopeDeg)} deg over ${a.slope.baselineM} m).`);
  items.sort((x, y) => y.w - x.w);
  const highlights = items.filter((x) => x.w >= 0.02).map((x) => x.text);
  if (!highlights.length) highlights.push(capitalise(`${la} and ${lb} are practically the same on sunlight, darkness, Earth line of sight and slope.`));
  const missing = [A, B].some((m) => !Number.isFinite(m.illuminationPct)) || !Number.isFinite(d.slopeDeg);
  if (missing) highlights.push('Some figures are unavailable for one of the two scenarios (see its warnings), so those differences are not shown.');
  return { ...d, highlights, names };
}
