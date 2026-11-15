// "Suggest better landing spots nearby": scan a grid of candidate points around a site,
// reject those too steep (or without data), analyse the rest over the same mission window
// and mast height, and rank them by sunlight and Earth line of sight.
import { pinId, type Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { destination, sampleStack, slopeOn } from './horizon';
import { localFrame, azEl, type V3 } from '../astro/topocentric';
import type { Ephemeris } from './sky';
import { computeHorizon } from './horizon';
import { DEFAULT_SLOPE_BASELINE_FACTOR, evaluateWindow } from './window';
import type { NearbyCandidate, NearbyOptions, SlopeInfo } from './types';

const RAD = Math.PI / 180;
/** Far-field marching step of the scan's skylines, as a fraction of distance (the main analysis uses 0.004). */
const SCAN_GROWTH = 0.01;
/** Near-field marching step of the scan's skylines, as a fraction of distance (the main analysis uses 0.05). */
const SCAN_NEAR = 0.1;
/** Points of the fine search inside a marching step in the scan (the main analysis uses 6). */
const SCAN_SEARCH = 3;

/** "300 m E, 600 m S": an offset in words, exact and without signs. */
export function offsetText(eastM: number, northM: number): string {
  const parts: string[] = [];
  if (Math.round(eastM) !== 0) parts.push(`${Math.abs(Math.round(eastM))} m ${eastM > 0 ? 'E' : 'W'}`);
  if (Math.round(northM) !== 0) parts.push(`${Math.abs(Math.round(northM))} m ${northM > 0 ? 'N' : 'S'}`);
  return parts.length ? parts.join(', ') : '0 m';
}

export const DEFAULT_NEARBY_OPTIONS: Required<NearbyOptions> = {
  radiusM: 2000,
  spacingM: 300,
  slopeLimitDeg: 10,
  weightSun: 1,
  weightEarth: 1,
  azStepDeg: 1,
  stepMin: 30,
};

/** Score in 0..100: weighted mean of illumination % and Earth line-of-sight %. */
export function nearbyScore(illuminationPct: number, earthVisiblePct: number, o: Pick<NearbyOptions, 'weightSun' | 'weightEarth'>): number {
  const ws = Math.max(0, o.weightSun), we = Math.max(0, o.weightEarth);
  if (ws + we === 0) return NaN;
  return (ws * illuminationPct + we * earthVisiblePct) / (ws + we);
}

/**
 * Re-expresses a reference site's ephemeris for nearby points: Sun/Earth directions are
 * sampled once over [startMs, endMs] (Moon-fixed unit vectors, every `stepMs` / 2, plus the
 * end itself) and re-projected into each candidate's local horizon. Over a few km the
 * parallax change is < 0.001 deg; the tilt of the local vertical (0.033 deg per km) is what
 * matters, and it is applied exactly. The base ephemeris is never asked outside the window.
 */
export function shiftableEphemeris(base: Ephemeris, ref: { lat: number; lon: number }, startMs: number, endMs: number, stepMs: number) {
  const f = localFrame(ref.lat, ref.lon);
  const toVec = (az: number, el: number): V3 => {
    const ce = Math.cos(el * RAD), x = ce * Math.sin(az * RAD), y = ce * Math.cos(az * RAD), z = Math.sin(el * RAD);
    return [x * f.east[0] + y * f.north[0] + z * f.up[0], x * f.east[1] + y * f.north[1] + z * f.up[1], x * f.east[2] + y * f.north[2] + z * f.up[2]];
  };
  // Half-step sampling keeps the linear interpolation error far below 0.001 deg.
  const dt = stepMs / 2;
  const whole = Math.max(0, Math.floor((endMs - startMs) / dt + 1e-9));
  // Node times: the regular grid, then the window's end if it is not on the grid. At least two nodes.
  const times: number[] = [];
  for (let k = 0; k <= whole; k++) times.push(startMs + k * dt);
  if (times[times.length - 1] < endMs || times.length < 2) times.push(Math.max(endMs, startMs + 1));
  const m = times.length;
  const sun = new Float64Array(m * 3), earth = new Float64Array(m * 3), rs = new Float64Array(m), re = new Float64Array(m);
  const o = new Float64Array(6);
  for (let k = 0; k < m; k++) {
    base.at(Math.min(times[k], Math.max(endMs, startMs)), o);
    sun.set(toVec(o[0], o[1]), k * 3);
    earth.set(toVec(o[2], o[3]), k * 3);
    rs[k] = o[4]; re[k] = o[5];
  }
  return (site: { lat: number; lon: number }): Ephemeris => {
    const fr = localFrame(site.lat, site.lon);
    const lerp = (arr: Float64Array, i: number, w: number): V3 => [
      arr[i * 3] + (arr[i * 3 + 3] - arr[i * 3]) * w, arr[i * 3 + 1] + (arr[i * 3 + 4] - arr[i * 3 + 1]) * w, arr[i * 3 + 2] + (arr[i * 3 + 5] - arr[i * 3 + 2]) * w,
    ];
    return {
      source: base.source,
      note: base.note,
      at(t, out) {
        // All intervals have length dt except possibly the last.
        let i = Math.floor((t - startMs) / dt);
        if (i < 0) i = 0;
        else if (i > m - 2) i = m - 2;
        let w = (t - times[i]) / (times[i + 1] - times[i]);
        if (w < 0) w = 0;
        else if (w > 1) w = 1;
        const a = azEl(fr, lerp(sun, i, w)), b = azEl(fr, lerp(earth, i, w));
        out[0] = a.az; out[1] = a.el; out[2] = b.az; out[3] = b.el;
        out[4] = rs[i] + (rs[i + 1] - rs[i]) * w; out[5] = re[i] + (re[i + 1] - re[i]) * w;
      },
      instant: () => { throw new Error('instant() is not available on the nearby-scan ephemeris'); },
    };
  };
}

export type NearbyProgress = (done: number, total: number) => void;

/** Grid of candidate offsets (east, north) within the radius, the centre first. */
export function candidateOffsets(radiusM: number, spacingM: number): { e: number; n: number }[] {
  const out: { e: number; n: number }[] = [{ e: 0, n: 0 }];
  const k = Math.floor(radiusM / spacingM);
  for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) {
    if ((i || j) && Math.hypot(i, j) * spacingM <= radiusM + 1e-6) out.push({ e: i * spacingM, n: j * spacingM });
  }
  return out;
}

/** A scan that can be advanced one candidate at a time, so a caller can report progress and stay responsive. */
export interface NearbyScan {
  /** Candidates in the scan, the scenario's own site included. */
  total: number;
  /** Candidates analysed so far. */
  done: number;
  /** Analyses the next candidate. Returns false once all are done. */
  step(): boolean;
  /** The ranked rows; call after step() has returned false. */
  result(): NearbyCandidate[];
}

export function createNearbyScan(scenario: Scenario, stack: TerrainStack, base: Ephemeris, options: NearbyOptions): NearbyScan {
  const o = { ...DEFAULT_NEARBY_OPTIONS, ...options };
  if (!(o.spacingM > 0) || !(o.radiusM >= 0)) throw new RangeError('rankNearby: radius must be >= 0 and spacing > 0');
  if (!(o.azStepDeg > 0) || !(o.stepMin > 0)) throw new RangeError('rankNearby: azStepDeg and stepMin must be positive');
  const offsets = candidateOffsets(o.radiusM, o.spacingM);
  if (offsets.length > 2000) throw new RangeError(`rankNearby: ${offsets.length} candidates is too many; increase the spacing or reduce the radius`);
  const scan: Scenario = { ...scenario, stepMin: Math.max(scenario.stepMin, o.stepMin) };
  const shift = shiftableEphemeris(base, scenario.site, scan.startMs, scan.startMs + scan.durationH * 3_600_000, scan.stepMin * 60_000);
  const points = offsets.map((off) => {
    const dist = Math.hypot(off.e, off.n);
    const bearing = dist === 0 ? NaN : (Math.atan2(off.e, off.n) / RAD + 360) % 360;
    return { off, dist, bearing, p: dist === 0 ? { lat: scenario.site.lat, lon: scenario.site.lon } : destination(scenario.site, bearing, dist) };
  });

  // One slope measure for every candidate, so that the limit means the same thing everywhere:
  // the finest elevation layer that has data at most of the candidates (a 3 m survey that only
  // reaches a few hundred metres is not used to judge some points while a 60 m grid judges the rest).
  let slopeSource = stack.sources[stack.sources.length - 1];
  let slopes: SlopeInfo[] = [];
  for (const src of stack.sources) {
    const baseline = Math.max(DEFAULT_SLOPE_BASELINE_FACTOR * src.resolutionM, 10);
    const got = points.map((c) => slopeOn(src, c.p, baseline));
    slopeSource = src;
    slopes = got;
    if (got.filter((g) => Number.isFinite(g.slopeDeg)).length > points.length / 2) break;
  }
  const slopeBasis = `Slope over ${slopes[0]?.baselineM ?? NaN} m from ${slopeSource.name} (${Math.round(slopeSource.resolutionM)} m grid), the same measure for every candidate.`;

  const rows: NearbyCandidate[] = [];
  let k = 0;

  const analyseOne = (index: number): NearbyCandidate => {
    const { off, dist, bearing, p } = points[index];
    const isRef = index === 0;
    const site = isRef
      ? scenario.site
      : { id: pinId(p.lat, p.lon), name: `Candidate ${offsetText(off.e, off.n)} of ${scenario.site.name}`, kind: 'candidate' as const, lat: p.lat, lon: p.lon };
    const ground = sampleStack(stack, p.lat, p.lon).h;
    const slope = slopes[index];
    let rejected: NearbyCandidate['rejected'] = null;
    if (!Number.isFinite(ground) || !Number.isFinite(slope.slopeDeg)) rejected = 'no-data';
    else if (slope.slopeDeg > o.slopeLimitDeg) rejected = 'slope';
    let metrics = null as NearbyCandidate['metrics'];
    let basis = slopeBasis;
    if ((!rejected || isRef) && Number.isFinite(ground)) {
      const hp = computeHorizon(stack, p, scenario.mastHeightM, { azStepDeg: o.azStepDeg, growth: SCAN_GROWTH, nearFraction: SCAN_NEAR, searchPoints: SCAN_SEARCH });
      metrics = evaluateWindow({ ...scan, site }, hp, shift(p)).metrics;
      const near = hp.layers.filter((l) => l.fromM < 5000).map((l) => `${l.name} (${Math.round(l.resolutionM)} m)`).join(', ');
      basis += ` Skyline every ${hp.azStepDeg} deg from ${near || 'no data'}; window sampled every ${scan.stepMin} min (scan settings, coarser than the main analysis).`;
    }
    return {
      site, eastM: off.e, northM: off.n, distanceM: dist, bearingDeg: bearing, elevationM: ground, slope, metrics, rejected,
      // The reference keeps its score even when it is over the slope limit, so candidates can be compared with it.
      score: metrics && (!rejected || isRef) ? nearbyScore(metrics.illuminationPct, metrics.earthVisiblePct, o) : NaN,
      rank: 0, isReference: isRef, basis,
    };
  };

  return {
    total: offsets.length,
    get done() {
      return k;
    },
    step() {
      if (k >= offsets.length) return false;
      rows.push(analyseOne(k));
      k++;
      return k < offsets.length;
    },
    result() {
      if (k < offsets.length) throw new Error('the nearby scan has not finished');
      const ranked = rows.filter((r) => !r.rejected && Number.isFinite(r.score)).sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
      ranked.forEach((r, i) => { r.rank = i + 1; });
      const rest = rows.filter((r) => r.rank === 0);
      // Reference first among the unranked, then rejected by distance.
      rest.sort((a, b) => Number(b.isReference) - Number(a.isReference) || a.distanceM - b.distanceM);
      return [...ranked, ...rest];
    },
  };
}

/** Runs a whole scan in one go (Node, tests). */
export function rankNearbyWith(scenario: Scenario, stack: TerrainStack, base: Ephemeris, options: NearbyOptions, onProgress?: NearbyProgress): NearbyCandidate[] {
  const scan = createNearbyScan(scenario, stack, base, options);
  let more = scan.total > 0;
  while (more) {
    more = scan.step();
    onProgress?.(scan.done, scan.total);
  }
  return scan.result();
}
