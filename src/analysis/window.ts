// Mission-window analysis: Sun/Earth series against the skyline, metrics, events,
// blocking ridge and comparison. Pure and synchronous: runs in a Web Worker in the
// browser and inline under Node.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { computeHorizon, destination, profileIndex, skylineAt, slopeAt } from './horizon';
import { skyAt, type Ephemeris } from './sky';
import type {
  Blockage, ComparisonDiff, HorizonProfile, Interval, SiteAnalysis, SkyEvent, SkySeries, WindowMetrics,
} from './types';

const RAD = Math.PI / 180;
const H = 3_600_000;
/** Event times are refined by bisection to this precision. */
export const EVENT_PRECISION_MS = 10_000;
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

export function buildSeries(s: Scenario, p: HorizonProfile, eph: Ephemeris): SkySeries {
  const { startMs, stepMs, n } = sampleTimes(s);
  const f = () => new Float32Array(n);
  const out = { sunAz: f(), sunEl: f(), earthAz: f(), earthEl: f(), sunClearance: f(), earthClearance: f(), sunVisible: f(), earthVisible: f(), sunEclipsed: f() };
  const o = new Float64Array(6);
  for (let i = 0; i < n; i++) {
    eph.at(startMs + i * stepMs, o);
    const sunR = o[4], earthR = o[5];
    out.sunAz[i] = o[0]; out.sunEl[i] = o[1]; out.earthAz[i] = o[2]; out.earthEl[i] = o[3];
    out.sunClearance[i] = o[1] - skylineAt(p, o[0]);
    out.earthClearance[i] = o[3] - skylineAt(p, o[2]);
    const ecl = discOverlap(separation(o[0], o[1], o[2], o[3]), sunR, earthR);
    out.sunEclipsed[i] = ecl;
    // Terrain and Earth cover treated as independent across the disc (exact when either is 0 or 1).
    out.sunVisible[i] = discVisibility(p, o[0], o[1], sunR).fraction * (1 - ecl);
    out.earthVisible[i] = discVisibility(p, o[2], o[3], earthR).fraction;
  }
  return { startMs, stepMs, n, ...out, source: eph.source };
}

// ---------- intervals and events ----------

/** Finds where a continuous indicator g(t) changes sign between two sample times, to EVENT_PRECISION_MS. */
function refine(g: (t: number) => number, t0: number, t1: number, up: boolean): number {
  let a = t0, b = t1;
  while (b - a > EVENT_PRECISION_MS) {
    const m = (a + b) / 2;
    if ((g(m) > 0) === up) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** True-intervals of a state sampled at the series times, with crossings refined on the continuous indicator. */
function intervalsOf(state: (i: number) => boolean, g: (t: number) => number, times: { startMs: number; stepMs: number; n: number; endMs: number }) {
  const on: Interval[] = [];
  const off: Interval[] = [];
  const crossings: { t: number; up: boolean }[] = [];
  const tAt = (i: number) => Math.min(times.startMs + i * times.stepMs, times.endMs);
  let cur = state(0);
  let segStart = times.startMs;
  let openStart = true;
  const close = (end: number, openEnd: boolean) => {
    const iv: Interval = { startMs: segStart, endMs: end };
    if (openStart) iv.openStart = true;
    if (openEnd) iv.openEnd = true;
    if (end > segStart || openEnd) (cur ? on : off).push(iv);
  };
  for (let i = 1; i < times.n; i++) {
    const s = state(i);
    if (s !== cur) {
      const t = refine(g, tAt(i - 1), tAt(i), s);
      close(t, false);
      crossings.push({ t, up: s });
      cur = s;
      segStart = t;
      openStart = false;
    }
  }
  close(times.endMs, true);
  return { on, off, crossings };
}

const hours = (iv: Interval) => (iv.endMs - iv.startMs) / H;

function longest(list: Interval[]): { h: number; open: boolean } {
  let best: Interval | null = null;
  for (const iv of list) if (!best || hours(iv) > hours(best)) best = iv;
  return best ? { h: hours(best), open: !!(best.openStart || best.openEnd) } : { h: 0, open: false };
}

export interface WindowResult {
  series: SkySeries;
  metrics: WindowMetrics;
  events: SkyEvent[];
}

/** Series, metrics and events for one scenario over a skyline. */
export function evaluateWindow(s: Scenario, p: HorizonProfile, eph: Ephemeris): WindowResult {
  const series = buildSeries(s, p, eph);
  const times = sampleTimes(s);
  const o = new Float64Array(6);
  const tAt = (i: number) => times.startMs + i * times.stepMs;
  const sunTop = (t: number) => { eph.at(t, o); return discVisibility(p, o[0], o[1], o[4]).topClearance; };
  // > 0 while some of the Sun is not behind Earth.
  const notTotal = (t: number) => { eph.at(t, o); return separation(o[0], o[1], o[2], o[3]) - (o[5] - o[4]); };
  const anyOverlap = (t: number) => { eph.at(t, o); return o[5] + o[4] - separation(o[0], o[1], o[2], o[3]); };
  const sunAnyG = (t: number) => Math.min(sunTop(t), notTotal(t));
  const earthClear = (t: number) => { eph.at(t, o); return o[3] - skylineAt(p, o[2]); };

  // Above the skyline (for sunrise/sunset events) vs actually shining (skyline and Earth eclipses, for the metrics).
  const terrain = intervalsOf((i) => sunTop(tAt(i)) > 0, sunTop, times);
  const sun = intervalsOf((i) => series.sunVisible[i] > 0, sunAnyG, times);
  const eclipse = intervalsOf((i) => series.sunEclipsed[i] > 0, anyOverlap, times);
  const earth = intervalsOf((i) => series.earthClearance[i] > 0, earthClear, times);
  const windowH = (times.endMs - times.startMs) / H;
  const sumH = (l: Interval[]) => l.reduce((a, iv) => a + hours(iv), 0);

  // Time-averaged visible fraction: trapezoid rule over the samples (last step may be partial).
  let integ = 0;
  for (let i = 1; i < times.n; i++) {
    const dt = Math.min(times.startMs + i * times.stepMs, times.endMs) - (times.startMs + (i - 1) * times.stepMs);
    integ += ((series.sunVisible[i - 1] + series.sunVisible[i]) / 2) * dt;
  }
  const lastT = times.startMs + (times.n - 1) * times.stepMs;
  if (lastT < times.endMs) integ += series.sunVisible[times.n - 1] * (times.endMs - lastT);
  const dark = longest(sun.off);
  const gap = longest(earth.off);
  let maxEl = -Infinity, minEl = Infinity;
  for (let i = 0; i < times.n; i++) { maxEl = Math.max(maxEl, series.sunEl[i]); minEl = Math.min(minEl, series.sunEl[i]); }

  const metrics: WindowMetrics = {
    illuminationPct: windowH > 0 ? (100 * integ) / (times.endMs - times.startMs) : NaN,
    sunAnyPct: windowH > 0 ? (100 * sumH(sun.on)) / windowH : NaN,
    longestDarknessH: dark.h,
    darknessOpenEnded: dark.open,
    earthVisiblePct: windowH > 0 ? (100 * sumH(earth.on)) / windowH : NaN,
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

export const DEFAULT_SLOPE_BASELINE_FACTOR = 2;

export function analyseWith(scenario: Scenario, stack: TerrainStack, eph: Ephemeris, horizonOptions = {}): SiteAnalysis {
  const site = { lat: scenario.site.lat, lon: scenario.site.lon };
  const horizon = computeHorizon(stack, site, scenario.mastHeightM, horizonOptions);
  const warnings = [...horizon.warnings];
  const finest = stack.sources.find((s) => s.covers(site.lat, site.lon));
  const baseline = Math.max(DEFAULT_SLOPE_BASELINE_FACTOR * (finest?.resolutionM ?? 60), 10);
  const slope = slopeAt(stack, site, baseline);
  if (!Number.isFinite(slope.slopeDeg)) warnings.push('Slope unavailable: no elevation data around the site.');
  let res: WindowResult;
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
  }
  if (res.metrics.eclipseIntervals.length) {
    warnings.push(`Earth passes in front of the Sun during this window (${res.metrics.eclipseIntervals.map((iv) => new Date(iv.startMs).toISOString().slice(0, 16).replace('T', ' ')).join(', ')} UTC): sunlight and darkness include it.`);
  }
  if (res.metrics.darknessOpenEnded) warnings.push('The longest darkness runs into the edge of the window: it is a lower bound.');
  if (res.metrics.earthGapOpenEnded) warnings.push('The longest Earth gap runs into the edge of the window: it is a lower bound.');
  const layersText = horizon.layers.map((l) => `${l.name} (${l.resolutionM} m) from ${(l.fromM / 1000).toFixed(1)} to ${(l.toM / 1000).toFixed(1)} km`).join('; ');
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
    if (Number.isFinite(AZ[i])) {
      const v = (k: number) => [Math.cos(EL[k] * RAD) * Math.sin(AZ[k] * RAD), Math.cos(EL[k] * RAD) * Math.cos(AZ[k] * RAD), Math.sin(EL[k] * RAD)];
      const p = v(i), q = v(i + 1);
      const X = p[0] + (q[0] - p[0]) * f, Y = p[1] + (q[1] - p[1]) * f, Z = p[2] + (q[2] - p[2]) * f;
      let az = Math.atan2(X, Y) / RAD;
      if (az < 0) az += 360;
      return { az, el: Math.atan2(Z, Math.hypot(X, Y)) / RAD };
    }
  }
  const h = (Number.isFinite(a.horizon.siteElevationM) ? a.horizon.siteElevationM : 0) + a.horizon.mastHeightM;
  const sky = skyAt(a.scenario.site, h, t)[body];
  return { az: sky.azDeg, el: sky.elDeg };
}

const fmtUtc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const f1 = (v: number) => v.toFixed(1);
const f2 = (v: number) => v.toFixed(2);

export function blockageAt(a: SiteAnalysis, body: 'sun' | 'earth', timeMs: number): Blockage {
  const { az, el } = bodyAt(a, body, timeMs);
  const p = a.horizon;
  const sky = skylineAt(p, az);
  const i = profileIndex(p, az);
  const dist = p.distM[i], hgt = p.heightM[i];
  const layer = p.layers[p.skylineLayer?.[i] ?? 0];
  const ridge = Number.isFinite(dist) ? destination(p.site, i * p.azStepDeg, dist) : { lat: NaN, lon: NaN };
  const clearance = el - sky;
  const name = body === 'sun' ? 'The Sun' : 'Earth';
  let explanation: string;
  if (!Number.isFinite(sky)) {
    explanation = `${name} is at ${f2(el)} deg elevation, azimuth ${f1(az)} deg at ${fmtUtc(timeMs)}; no skyline is available here because no elevation data covers the site.`;
  } else {
    const what = `the skyline at azimuth ${f1(az)} deg is ${f2(sky)} deg, formed by terrain ${f1(dist / 1000)} km away at ${Math.round(hgt)} m (${layer ? `${layer.name}, ${layer.resolutionM} m grid` : 'unknown data'})`;
    explanation = clearance >= 0
      ? `At ${fmtUtc(timeMs)} ${name.toLowerCase().replace('the sun', 'the Sun')}'s centre is ${f2(el)} deg high and ${what}: it clears the skyline by ${f2(clearance)} deg.`
      : `At ${fmtUtc(timeMs)} ${name.toLowerCase().replace('the sun', 'the Sun')}'s centre is ${f2(el)} deg high but ${what}: it is hidden by ${f2(-clearance)} deg.`;
    explanation = explanation.replace(/^At (.*?) earth/, 'At $1 Earth');
  }
  return {
    body, timeMs, blocked: !(clearance > 0), bodyAzDeg: az, bodyElDeg: el, skylineElDeg: sky, clearanceDeg: clearance,
    ridgeDistanceM: dist, ridgeHeightM: hgt, ridge, demName: layer?.name ?? 'none', demResolutionM: layer?.resolutionM ?? NaN, explanation,
  };
}

export function nextEvents(a: SiteAnalysis, timeMs: number): Record<SkyEvent['type'], SkyEvent | null> {
  const out: Record<SkyEvent['type'], SkyEvent | null> = { sunrise: null, sunset: null, earthrise: null, earthset: null };
  for (const e of a.events) if (e.timeMs > timeMs && !out[e.type]) out[e.type] = e;
  return out;
}

export function compareAnalyses(a: SiteAnalysis, b: SiteAnalysis): ComparisonDiff {
  const A = a.metrics, B = b.metrics;
  const la = a.scenario.label || 'A', lb = b.scenario.label || 'B';
  const d = {
    illuminationPct: B.illuminationPct - A.illuminationPct,
    longestDarknessH: B.longestDarknessH - A.longestDarknessH,
    earthVisiblePct: B.earthVisiblePct - A.earthVisiblePct,
    longestEarthGapH: B.longestEarthGapH - A.longestEarthGapH,
    slopeDeg: b.slope.slopeDeg - a.slope.slopeDeg,
  };
  const items: { w: number; text: string }[] = [];
  const lb2 = (open: boolean) => (open ? ' (at least: runs into the window edge)' : '');
  const add = (diff: number, scale: number, text: string) => { if (Number.isFinite(diff) && Math.abs(diff) > 1e-9) items.push({ w: Math.abs(diff) / scale, text }); };
  add(d.illuminationPct, 5, `${lb} gets ${f1(Math.abs(d.illuminationPct))} percentage points ${d.illuminationPct > 0 ? 'more' : 'less'} sunlight than ${la} (${f1(B.illuminationPct)} % vs ${f1(A.illuminationPct)} % of the window, time-averaged visible disc).`);
  add(d.longestDarknessH, 12, `${lb}'s longest darkness is ${f1(Math.abs(d.longestDarknessH))} h ${d.longestDarknessH > 0 ? 'longer' : 'shorter'} (${f1(B.longestDarknessH)} h${lb2(B.darknessOpenEnded)} vs ${f1(A.longestDarknessH)} h${lb2(A.darknessOpenEnded)}).`);
  add(d.earthVisiblePct, 5, `${lb} has line of sight to Earth ${f1(Math.abs(d.earthVisiblePct))} percentage points ${d.earthVisiblePct > 0 ? 'more' : 'less'} of the time (${f1(B.earthVisiblePct)} % vs ${f1(A.earthVisiblePct)} %; geometry only).`);
  add(d.longestEarthGapH, 12, `${lb}'s longest gap without Earth in view is ${f1(Math.abs(d.longestEarthGapH))} h ${d.longestEarthGapH > 0 ? 'longer' : 'shorter'} (${f1(B.longestEarthGapH)} h${lb2(B.earthGapOpenEnded)} vs ${f1(A.longestEarthGapH)} h${lb2(A.earthGapOpenEnded)}).`);
  add(d.slopeDeg, 3, `${lb}'s ground slope is ${f1(Math.abs(d.slopeDeg))} deg ${d.slopeDeg > 0 ? 'steeper' : 'gentler'} (${f1(b.slope.slopeDeg)} deg vs ${f1(a.slope.slopeDeg)} deg).`);
  items.sort((x, y) => y.w - x.w);
  const highlights = items.filter((x) => x.w >= 0.02).map((x) => x.text);
  if (!highlights.length) highlights.push(`${la} and ${lb} are practically the same on sunlight, darkness, Earth line of sight and slope.`);
  const nan = [A, B].some((m) => !Number.isFinite(m.illuminationPct));
  if (nan) highlights.push('Some metrics are unavailable for one of the two scenarios (see its warnings), so those differences are not shown.');
  return { ...d, highlights };
}
