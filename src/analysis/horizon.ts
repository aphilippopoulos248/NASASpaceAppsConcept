// Terrain skyline (horizon profile) and slope from a TerrainStack.
//
// Geometry is exact on the 1737.4 km reference sphere: a terrain point at ground
// distance d (central angle theta = d / R) with height h, seen from an observer at
// height h0 (site terrain + mast), stands at elevation
//     atan2((R + h) cos(theta) - (R + h0), (R + h) sin(theta))
// above the observer's local horizontal. The Moon's curvature is therefore included.
import type { LatLon } from '../core/types';
import { MOON_RADIUS_M } from '../core/types';
import type { HeightSource, TerrainStack } from '../terrain/types';
import type { DemLayerUse, HorizonProfile, SlopeInfo } from './types';

const R = MOON_RADIUS_M;
const RAD = Math.PI / 180;
/** Highest terrain on the Moon, metres above the 1737.4 km sphere (LOLA: about +10.79 km, Smith et al. 2010; rounded up). */
export const MOON_MAX_HEIGHT_M = 10_800;

export interface HorizonOptions {
  /** Azimuth spacing, degrees (default 0.5). */
  azStepDeg?: number;
  /** Search cap, metres (default 400 km). */
  maxRangeM?: number;
  /** Marching step as a fraction of the distance once that exceeds the source resolution (default 0.004). */
  growth?: number;
  /** Marching step as a fraction of the source resolution (default 0.7). */
  resFraction?: number;
}

/** Point reached from a site after walking `distM` over the sphere towards `azDeg`. */
export function destination(site: LatLon, azDeg: number, distM: number): LatLon {
  const la = site.lat * RAD, lo = site.lon * RAD, az = azDeg * RAD, d = distM / R;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
  let lon2 = lo + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  lon2 = ((((lon2 / RAD + 180) % 360) + 360) % 360) - 180;
  return { lat: lat2 / RAD, lon: lon2 };
}

/** Height at a point from the finest source that has data there; index of that source, or -1. */
export function sampleStack(stack: TerrainStack, lat: number, lon: number): { h: number; idx: number } {
  const s = stack.sources;
  for (let k = 0; k < s.length; k++) {
    if (!s[k].covers(lat, lon)) continue;
    const h = s[k].sample(lat, lon);
    if (Number.isFinite(h)) return { h, idx: k };
  }
  return { h: NaN, idx: -1 };
}

/** Skyline elevation at any azimuth, degrees, interpolated between profile samples. */
export function skylineAt(p: HorizonProfile, azDeg: number): number {
  const n = p.elevDeg.length;
  let x = (((azDeg % 360) + 360) % 360) / p.azStepDeg;
  const i = Math.floor(x) % n;
  x -= Math.floor(x);
  const j = (i + 1) % n;
  return p.elevDeg[i] + (p.elevDeg[j] - p.elevDeg[i]) * x;
}

/** Index of the profile sample nearest an azimuth. */
export function profileIndex(p: HorizonProfile, azDeg: number): number {
  const n = p.elevDeg.length;
  return ((Math.round((((azDeg % 360) + 360) % 360) / p.azStepDeg) % n) + n) % n;
}

/**
 * The terrain skyline around an observer `mastHeightM` above the ground at `site`.
 * For each azimuth the great circle is marched outwards, sampling the finest source
 * that covers each point, with a step of `resFraction` x that source's resolution that
 * grows to `growth` x distance far out. Marching stops where even the highest terrain
 * on the Moon could no longer rise above the skyline found so far, or at `maxRangeM`.
 */
export function computeHorizon(stack: TerrainStack, site: LatLon, mastHeightM: number, options: HorizonOptions = {}): HorizonProfile {
  const azStep = options.azStepDeg ?? 0.5;
  const maxRange = options.maxRangeM ?? 400_000;
  const growth = options.growth ?? 0.004;
  const resFrac = options.resFraction ?? 0.7;
  const nAz = Math.max(1, Math.round(360 / azStep));
  const azStepDeg = 360 / nAz;
  const warnings: string[] = [];
  const sources = stack.sources;

  const elevDeg = new Float32Array(nAz);
  const distM = new Float32Array(nAz);
  const heightM = new Float32Array(nAz);
  const skylineLayer = new Uint8Array(nAz);
  const used = sources.map(() => ({ from: Infinity, to: -Infinity }));

  const here = sampleStack(stack, site.lat, site.lon);
  const mast = Math.max(0, Number.isFinite(mastHeightM) ? mastHeightM : 0);
  const smoothDipDeg = -Math.acos(R / (R + mast)) / RAD;
  if (here.idx < 0) {
    elevDeg.fill(NaN); distM.fill(NaN); heightM.fill(NaN);
    return {
      site: { lat: site.lat, lon: site.lon }, siteElevationM: NaN, mastHeightM: mast, azStepDeg, elevDeg, distM, heightM,
      smoothDipDeg, maxRangeM: 0, layers: [], skylineLayer, warnings: ['No elevation data covers this site: the skyline cannot be computed.'],
    };
  }
  const h0 = here.h + mast;
  const R0 = R + h0;
  const Rmax = R + Math.max(MOON_MAX_HEIGHT_M, h0);
  let gaps = 0;
  let reachedMax = 0;

  // Local frame at the site (same convention as src/astro/topocentric.ts).
  const la = site.lat * RAD, lo = site.lon * RAD;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];

  for (let a = 0; a < nAz; a++) {
    const az = a * azStepDeg * RAD;
    const ca = Math.cos(az), sa = Math.sin(az);
    const tx = ca * north[0] + sa * east[0], ty = ca * north[1] + sa * east[1], tz = ca * north[2] + sa * east[2];
    let best = -Math.PI / 2, bestD = NaN, bestH = NaN, bestIdx = 0;
    let tanBest = -Infinity;
    let idx = here.idx;
    let d = resFrac * sources[idx].resolutionM;
    while (d <= maxRange) {
      const th = d / R;
      const ct = Math.cos(th), st = Math.sin(th);
      // Stop once the highest possible terrain at this distance would sit below the skyline.
      const capEl = Math.atan2(Rmax * ct - R0, Rmax * st);
      if (capEl < best) break;
      const px = ct * up[0] + st * tx, py = ct * up[1] + st * ty, pz = ct * up[2] + st * tz;
      const lat = Math.asin(pz > 1 ? 1 : pz < -1 ? -1 : pz) / RAD;
      const lon = Math.atan2(py, px) / RAD;
      // Finest source with data here.
      let h = NaN;
      idx = -1;
      for (let k = 0; k < sources.length; k++) {
        if (!sources[k].covers(lat, lon)) continue;
        const v = sources[k].sample(lat, lon);
        if (Number.isFinite(v)) { h = v; idx = k; break; }
      }
      let res: number;
      if (idx < 0) {
        gaps++;
        res = sources[sources.length - 1].resolutionM;
      } else {
        res = sources[idx].resolutionM;
        const u = used[idx];
        if (d < u.from) u.from = d;
        if (d > u.to) u.to = d;
        const Rh = R + h;
        const y = Rh * ct - R0, x = Rh * st;
        // Compare by tan to avoid an atan2 per sample (x > 0 always).
        const t = y / x;
        if (t > tanBest) {
          tanBest = t;
          best = Math.atan(t);
          bestD = d; bestH = h; bestIdx = idx;
        }
      }
      if (d > reachedMax) reachedMax = d;
      d += Math.max(resFrac * res, growth * d);
    }
    elevDeg[a] = best / RAD;
    distM[a] = bestD;
    heightM[a] = bestH;
    skylineLayer[a] = bestIdx;
  }

  const layers: DemLayerUse[] = [];
  const layerOf = new Map<number, number>();
  used.forEach((u, k) => {
    if (u.to < 0) return;
    layerOf.set(k, layers.length);
    layers.push({ name: sources[k].name, resolutionM: sources[k].resolutionM, fromM: Math.round(u.from), toM: Math.round(u.to) });
  });
  for (let a = 0; a < nAz; a++) skylineLayer[a] = layerOf.get(skylineLayer[a]) ?? 0;

  if (gaps > 0) warnings.push(`${gaps} terrain samples had no elevation data in any source; the skyline ignores those points.`);
  // Honest coverage: what resolves the near field?
  const near = layers.filter((l) => l.fromM < 30_000);
  const finestNear = near.length ? Math.min(...near.map((l) => l.resolutionM)) : Infinity;
  if (finestNear >= 500) {
    warnings.push(`Only ${Math.round(finestNear)} m elevation data within 30 km of the site: nearby hills and crater rims smaller than about ${Math.round(2 * finestNear)} m across are not resolved, so the near skyline may be too low.`);
  }
  if (stack.notes.length) warnings.push(...stack.notes);

  return {
    site: { lat: site.lat, lon: site.lon },
    siteElevationM: here.h,
    mastHeightM: mast,
    azStepDeg,
    elevDeg,
    distM,
    heightM,
    smoothDipDeg,
    maxRangeM: Math.round(reachedMax),
    layers,
    skylineLayer,
    warnings,
  };
}

/**
 * Terrain slope at a site: least-squares plane through a 3 x 3 pattern of points
 * spaced baselineM / 2 apart (so the slope is measured over `baselineM`), from the
 * finest source that has data at all nine points.
 */
export function slopeAt(stack: TerrainStack, site: LatLon, baselineM: number): SlopeInfo {
  const half = baselineM / 2;
  const offsets: [number, number][] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) offsets.push([i * half, j * half]);
  const pts = offsets.map(([e, n]) => {
    const dist = Math.hypot(e, n);
    return { e, n, p: dist === 0 ? { lat: site.lat, lon: site.lon } : destination(site, Math.atan2(e, n) / RAD, dist) };
  });
  for (const src of stack.sources) {
    if (!src.covers(site.lat, site.lon)) continue;
    const z = pts.map(({ p }) => src.sample(p.lat, p.lon));
    if (z.some((v) => !Number.isFinite(v))) continue;
    return slopeFromPlane(pts, z, baselineM, src);
  }
  return { slopeDeg: NaN, aspectDeg: NaN, baselineM, demName: 'no elevation data at this site' };
}

function slopeFromPlane(pts: { e: number; n: number }[], z: number[], baselineM: number, src: HeightSource): SlopeInfo {
  let sxz = 0, syz = 0, sxx = 0, syy = 0;
  const zm = z.reduce((a, b) => a + b, 0) / z.length;
  pts.forEach(({ e, n }, k) => {
    sxz += e * (z[k] - zm); syz += n * (z[k] - zm); sxx += e * e; syy += n * n;
  });
  const gx = sxz / sxx, gy = syz / syy; // dz/deast, dz/dnorth
  const g = Math.hypot(gx, gy);
  let aspect = g > 1e-9 ? Math.atan2(-gx, -gy) / RAD : NaN;
  if (aspect < 0) aspect += 360;
  const note = baselineM < src.resolutionM ? ` (baseline shorter than the ${src.resolutionM} m grid: interpolated)` : '';
  return { slopeDeg: Math.atan(g) / RAD, aspectDeg: aspect, baselineM, demName: `${src.name}, ${src.resolutionM} m${note}` };
}
