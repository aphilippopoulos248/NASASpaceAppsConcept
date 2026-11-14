// "Suggest better landing spots nearby": scan a grid of candidate points around a site,
// reject those too steep (or without data), analyse the rest over the same mission window
// and mast height, and rank them by sunlight and Earth line of sight.
import { pinId, type Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { destination, sampleStack, slopeAt } from './horizon';
import { localFrame, azEl, type V3 } from '../astro/topocentric';
import type { Ephemeris } from './sky';
import { computeHorizon } from './horizon';
import { evaluateWindow, DEFAULT_SLOPE_BASELINE_FACTOR } from './window';
import type { NearbyCandidate, NearbyOptions } from './types';

const RAD = Math.PI / 180;

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
 * sampled once (Moon-fixed unit vectors) and re-projected into each candidate's local
 * horizon. Over a few km the parallax change is < 0.001 deg; the tilt of the local
 * vertical (0.033 deg per km) is what matters, and it is applied exactly.
 */
export function shiftableEphemeris(base: Ephemeris, ref: { lat: number; lon: number }, startMs: number, stepMs: number, n: number) {
  const f = localFrame(ref.lat, ref.lon);
  const toVec = (az: number, el: number): V3 => {
    const ce = Math.cos(el * RAD), x = ce * Math.sin(az * RAD), y = ce * Math.cos(az * RAD), z = Math.sin(el * RAD);
    return [x * f.east[0] + y * f.north[0] + z * f.up[0], x * f.east[1] + y * f.north[1] + z * f.up[1], x * f.east[2] + y * f.north[2] + z * f.up[2]];
  };
  // Half-step sampling keeps the linear interpolation error far below 0.001 deg.
  const sub = 2, m = (n - 1) * sub + 1, dt = stepMs / sub;
  const sun = new Float64Array(m * 3), earth = new Float64Array(m * 3), rs = new Float64Array(m), re = new Float64Array(m);
  const o = new Float64Array(6);
  const last = startMs + (n - 1) * stepMs;
  for (let k = 0; k < m; k++) {
    base.at(Math.min(startMs + k * dt, last), o);
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
        const x = Math.max(0, Math.min(m - 1, (t - startMs) / dt));
        const i = Math.min(m - 2, Math.floor(x)), w = x - i;
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

export function rankNearbyWith(scenario: Scenario, stack: TerrainStack, base: Ephemeris, options: NearbyOptions, onProgress?: NearbyProgress): NearbyCandidate[] {
  const o = { ...DEFAULT_NEARBY_OPTIONS, ...options };
  if (!(o.spacingM > 0) || !(o.radiusM >= 0)) throw new RangeError('rankNearby: radius must be >= 0 and spacing > 0');
  const offsets = candidateOffsets(o.radiusM, o.spacingM);
  if (offsets.length > 2000) throw new RangeError(`rankNearby: ${offsets.length} candidates is too many; increase the spacing or reduce the radius`);
  const scan: Scenario = { ...scenario, stepMin: Math.max(scenario.stepMin, o.stepMin) };
  const stepMs = scan.stepMin * 60_000;
  const n = Math.floor((scan.durationH * 3_600_000) / stepMs + 1e-9) + 1;
  const shift = shiftableEphemeris(base, scenario.site, scan.startMs, stepMs, n + 1);
  const finest = stack.sources.find((s) => s.covers(scenario.site.lat, scenario.site.lon));
  const baseline = Math.max(DEFAULT_SLOPE_BASELINE_FACTOR * (finest?.resolutionM ?? 60), 10);

  const rows: NearbyCandidate[] = [];
  offsets.forEach((off, k) => {
    const dist = Math.hypot(off.e, off.n);
    const p = dist === 0 ? { lat: scenario.site.lat, lon: scenario.site.lon } : destination(scenario.site, Math.atan2(off.e, off.n) / RAD, dist);
    const isRef = k === 0;
    const site = isRef
      ? scenario.site
      : { id: pinId(p.lat, p.lon), name: `Candidate ${Math.round(off.e)} m E, ${Math.round(off.n)} m N`, kind: 'candidate' as const, lat: p.lat, lon: p.lon };
    const ground = sampleStack(stack, p.lat, p.lon).h;
    const slope = slopeAt(stack, p, baseline);
    let rejected: NearbyCandidate['rejected'] = null;
    if (!Number.isFinite(ground) || !Number.isFinite(slope.slopeDeg)) rejected = 'no-data';
    else if (slope.slopeDeg > o.slopeLimitDeg) rejected = 'slope';
    let metrics = null as NearbyCandidate['metrics'];
    let basis = `Slope over ${slope.baselineM} m from ${slope.demName}.`;
    if ((!rejected || isRef) && Number.isFinite(ground)) {
      const hp = computeHorizon(stack, p, scenario.mastHeightM, { azStepDeg: o.azStepDeg, growth: 0.01 });
      metrics = evaluateWindow({ ...scan, site }, hp, shift(p)).metrics;
      const near = hp.layers.filter((l) => l.fromM < 5000).map((l) => `${l.name} (${l.resolutionM} m)`).join(', ');
      basis += ` Skyline every ${hp.azStepDeg} deg from ${near || 'no data'}; window sampled every ${scan.stepMin} min (scan settings, coarser than the main analysis).`;
    }
    rows.push({
      site, eastM: off.e, northM: off.n, distanceM: dist, elevationM: ground, slope, metrics, rejected,
      score: metrics && (!rejected || isRef) ? nearbyScore(metrics.illuminationPct, metrics.earthVisiblePct, o) : NaN,
      rank: 0, isReference: isRef, basis,
    });
    onProgress?.(k + 1, offsets.length);
  });

  const ranked = rows.filter((r) => !r.rejected && Number.isFinite(r.score)).sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const rest = rows.filter((r) => r.rank === 0);
  // Reference first among the unranked, then rejected by distance.
  rest.sort((a, b) => Number(b.isReference) - Number(a.isReference) || a.distanceM - b.distanceM);
  return [...ranked, ...rest];
}
