// A finer skyline where it decides a rise or a set (task T-50).
//
// The main profile reads the skyline every 0.5 deg of azimuth and interpolates in between. A notch
// or a peak narrower than that, under a disc that is rising or setting, then goes unseen: near the
// poles, where the Sun and Earth cross the skyline slowly and at a shallow angle, the independent
// validation found instants up to 14 min off for that reason alone (lunyx-science T-3,
// tests/fixtures/validation/science-validation/README.md: "the app's 0.5 deg azimuth step meeting
// narrow skyline features"; read every 0.5 deg, their own skyline agrees with the app to 0.004 deg).
//
// So the skyline is read a second time, every 0.05 deg, but only over the azimuths where the Sun's
// or Earth's disc comes near it during the window: there the profile carries the fine samples
// (HorizonProfile.fine) and skylineAt() reads them. Everything downstream (visible fractions,
// events, both ends of each passage, metrics, blockage) then sees the fine skyline exactly where a
// disc meets it. The main profile, and its cost, are unchanged; the extra rays are reported in
// `fine` and in the analysis' assumptions.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { computeHorizon, type HorizonOptions } from './horizon';
import type { Ephemeris } from './sky';
import type { FineSkyline, HorizonProfile } from './types';
import { sampleTimes } from './window';

/** Samples per degree of the fine skyline: every 0.05 deg. */
export const FINE_PER_DEG = 20;
/** How far beyond a disc's own half-width (in azimuth) the fine skyline reaches, degrees: covers its motion between two samples and a shifted instant. */
export const FINE_AZ_PAD_DEG = 0.3;
/**
 * A disc counts as near the skyline when its edge comes within this many degrees of the main
 * profile's skyline under it. The validation found the step costing at most 0.02 deg of skyline:
 * this margin is more than ten times that.
 */
export const FINE_EL_MARGIN_DEG = 0.25;

const RAD = Math.PI / 180;

/** An azimuth range in degrees, from <= to, not normalised (it may start below 0 or end above 360). */
export type AzRange = [from: number, to: number];

/**
 * Where the Sun's or Earth's disc comes near the skyline during the window, judged on the main
 * profile: at every sample (and the window's end), the disc's elevation span widened by
 * FINE_EL_MARGIN_DEG against the lowest and highest skyline under its azimuth span widened by
 * FINE_AZ_PAD_DEG. Returns the azimuth ranges of those discs, padded, merged.
 */
export function nearSkylineRanges(s: Scenario, p: HorizonProfile, eph: Ephemeris): AzRange[] {
  const { startMs, stepMs, n, endMs } = sampleTimes(s);
  const lastSampleMs = startMs + (n - 1) * stepMs;
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(startMs + i * stepMs);
  if (lastSampleMs < endMs) times.push(endMs);
  const o = new Float64Array(6);
  const nCoarse = p.elevDeg.length;
  const step = p.azStepDeg;
  /** Lowest and highest skyline of the main profile over an azimuth span (the samples inside it and the interpolated ends). */
  const skylineSpan = (a0: number, a1: number): [number, number] => {
    let lo = Infinity, hi = -Infinity;
    const take = (v: number) => {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    };
    const at = (az: number) => {
      let x = (((az % 360) + 360) % 360) / step;
      const i = Math.floor(x) % nCoarse;
      x -= Math.floor(x);
      return p.elevDeg[i] + (p.elevDeg[(i + 1) % nCoarse] - p.elevDeg[i]) * x;
    };
    take(at(a0));
    take(at(a1));
    for (let k = Math.ceil(a0 / step); k * step < a1; k++) take(p.elevDeg[((k % nCoarse) + nCoarse) % nCoarse]);
    return [lo, hi];
  };

  // Per body: the azimuth span of each sample whose disc is near the skyline; a sample's neighbours
  // are taken too, so the motion between two samples is covered.
  const ranges: AzRange[] = [];
  for (const body of ['sun', 'earth'] as const) {
    const near: boolean[] = [];
    const span: AzRange[] = [];
    for (const t of times) {
      eph.at(t, o);
      const az = body === 'sun' ? o[0] : o[2], el = body === 'sun' ? o[1] : o[3], r = body === 'sun' ? o[4] : o[5];
      const half = r / Math.max(Math.cos(el * RAD), 1e-3) + FINE_AZ_PAD_DEG;
      const [lo, hi] = skylineSpan(az - half, az + half);
      near.push(el - r - FINE_EL_MARGIN_DEG <= hi && el + r + FINE_EL_MARGIN_DEG >= lo);
      span.push([az - half, az + half]);
    }
    for (let i = 0; i < times.length; i++) {
      if (!(near[i] || (i > 0 && near[i - 1]) || (i + 1 < times.length && near[i + 1]))) continue;
      ranges.push(span[i]);
    }
  }
  return mergeRanges(ranges);
}

/** Ranges normalised to start in [0, 360), sorted and merged where they overlap (a range wider than a turn becomes the whole turn). */
export function mergeRanges(ranges: readonly AzRange[]): AzRange[] {
  const norm: AzRange[] = [];
  for (const [a, b] of ranges) {
    if (!(b >= a)) continue;
    if (b - a >= 360) return [[0, 360]];
    const shift = Math.floor(a / 360) * 360;
    norm.push([a - shift, b - shift]);
  }
  norm.sort((x, y) => x[0] - y[0]);
  const out: AzRange[] = [];
  for (const r of norm) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  // A range running past 360 that reaches the first one: join them across north.
  if (out.length > 1) {
    const last = out[out.length - 1], first = out[0];
    if (last[1] >= first[0] + 360) {
      last[1] = Math.max(last[1], first[1] + 360);
      out.shift();
    }
  }
  if (out.length && out[out.length - 1][1] - out[out.length - 1][0] >= 360) return [[0, 360]];
  return out;
}

/**
 * The skyline at FINE_PER_DEG samples per degree over each range: the same ray march as the main
 * profile (same options), only at more azimuths. Rays on the main profile's own azimuths come out
 * identical to its samples.
 */
export function fineSkyline(stack: TerrainStack, site: { lat: number; lon: number }, mastHeightM: number, ranges: readonly AzRange[], options: HorizonOptions = {}): FineSkyline[] {
  const perDeg = FINE_PER_DEG;
  const turn = 360 * perDeg;
  const segs: { k0: number; m: number }[] = [];
  const azimuths: number[] = [];
  for (const [a, b] of ranges) {
    const k0 = Math.floor(a * perDeg), k1 = Math.ceil(b * perDeg);
    const m = Math.min(k1 - k0 + 1, turn + 1);
    segs.push({ k0: ((k0 % turn) + turn) % turn, m });
    // k / perDeg is exact where the main profile has a sample (k a multiple of perDeg / 2).
    for (let k = 0; k < m; k++) azimuths.push((((k0 + k) % turn) + turn) % turn / perDeg);
  }
  if (!azimuths.length) return [];
  const { azimuthsDeg: _ignored, ...rest } = options;
  const marched = computeHorizon(stack, site, mastHeightM, { ...rest, azimuthsDeg: azimuths });
  const out: FineSkyline[] = [];
  let at = 0;
  for (const s of segs) {
    out.push({ k0: s.k0, perDeg, elevDeg: marched.elevDeg.slice(at, at + s.m) });
    at += s.m;
  }
  return out;
}

/** Number of rays in a set of fine segments. */
export const fineRayCount = (fine: readonly FineSkyline[] | undefined): number => (fine ?? []).reduce((n, s) => n + s.elevDeg.length, 0);
