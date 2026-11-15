// Terrain skyline (horizon profile) and slope from a TerrainStack.
//
// Geometry is exact on the 1737.4 km reference sphere: a terrain point at ground
// distance d (central angle theta = d / R) with height h, seen from an observer at
// height h0 (site terrain + mast), stands at elevation
//     atan2((R + h) cos(theta) - (R + h0), (R + h) sin(theta))
// above the observer's local horizontal. The Moon's curvature is therefore included.
import type { LatLon } from '../core/types';
import { MOON_RADIUS_M } from '../core/types';
import type { HeightGridDescriptor, HeightSource, TerrainStack } from '../terrain/types';
import type { DemLayerUse, HorizonProfile, SlopeInfo } from './types';
import { fastSamplerFor, type UnitSampler } from './fastSample';

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
  /**
   * Close to the observer the marching step is at most this fraction of the distance (default 0.05),
   * because what a small rise does to the skyline grows as the distance shrinks.
   */
  nearFraction?: number;
  /** Set false to look every height up through HeightSource.sample() only (slower; for cross-checks). */
  fast?: boolean;
  /**
   * Set false to skip the fine search between the samples that form (or nearly form) the skyline.
   * With it (the default) the result is the highest point of the interpolated terrain along each
   * ray to about 1/24 of a marching step, instead of the highest of the marching samples.
   */
  refine?: boolean;
  /** Points tried inside each marching step the fine search looks into (default 6; then half as many around the best at a quarter of that spacing). */
  searchPoints?: number;
  /**
   * March only these azimuths (degrees), in this order, instead of the full circle every `azStepDeg`:
   * the profile's arrays then hold one entry per listed azimuth (used for the fine skyline,
   * src/analysis/fineSkyline.ts). Each ray is marched exactly as in the full profile.
   */
  azimuthsDeg?: ArrayLike<number>;
}

const samplerCache = new WeakMap<HeightSource, UnitSampler | null>();
function cachedSampler(source: HeightSource): UnitSampler | null {
  let f = samplerCache.get(source);
  if (f === undefined) {
    f = fastSamplerFor(source);
    samplerCache.set(source, f);
  }
  return f;
}

/** Point reached from a site after walking `distM` over the sphere towards `azDeg`. */
export function destination(site: LatLon, azDeg: number, distM: number): LatLon {
  const la = site.lat * RAD, lo = site.lon * RAD, az = azDeg * RAD, d = distM / R;
  const sl = Math.sin(la), cl = Math.cos(la), sd = Math.sin(d), cd = Math.cos(d);
  // Rotate the site's up vector towards its local north/east bearing. Keeping
  // all three components avoids cancellation in the longitude formula at the
  // poles, where it otherwise folds a whole search circle into three points.
  const north = sd * Math.cos(az);
  const x = cd * cl - north * sl;
  const y = sd * Math.sin(az);
  const z = cd * sl + north * cl;
  const lat2 = Math.atan2(z, Math.hypot(x, y));
  let lon2 = lo + Math.atan2(y, x);
  lon2 = ((((lon2 / RAD + 180) % 360) + 360) % 360) - 180;
  return { lat: lat2 / RAD, lon: lon2 };
}

/** Height at a point from the finest source that has data there; index of that source, or -1. */
export function sampleStack(stack: TerrainStack, lat: number, lon: number): { h: number; idx: number } {
  const s = stack.sources;
  for (let k = 0; k < s.length; k++) {
    // sample() is NaN wherever the source has no data, so no separate covers() call is needed.
    const h = s[k].sample(lat, lon);
    if (Number.isFinite(h)) return { h, idx: k };
  }
  return { h: NaN, idx: -1 };
}

// ---------- which sources can matter at which distance ----------

/**
 * Distances from a site between which a source can have data: nothing nearer than `rMin`,
 * nothing beyond `rOut`. Used only to skip lookups that cannot succeed; inside the band the
 * source itself is still asked, so the skyline is identical with or without it.
 */
export interface SourceReach {
  rMin: number;
  rOut: number;
}

const ANY_DISTANCE: SourceReach = { rMin: 0, rOut: Infinity };

/** Unit vectors of a site's local frame in Moon-fixed coordinates. */
function frameOf(lat: number, lon: number) {
  const la = lat * RAD, lo = lon * RAD;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  return { up: [cl * co, cl * so, sl], east: [-so, co, 0], north: [-sl * co, -sl * so, cl] };
}

/** Reach predicted from the grid's description alone (conservative), or null when no simple bound applies. */
function predictedReach(d: HeightGridDescriptor, site: LatLon): SourceReach | null {
  if (d.kind === 'equirect') {
    const whole = d.lonE - d.lonW >= 360 - 1e-9 && d.latN >= 90 - 1e-9 && d.latS <= -90 + 1e-9;
    return whole ? ANY_DISTANCE : null;
  }
  // Both other layouts are squares in a map projection (azimuthal equidistant about the grid
  // centre; polar stereographic). In both, map distances are never shorter than ground
  // distances and at most `stretch` times longer inside the region considered.
  let half: number, x: number, y: number, stretch: number, px: number;
  if (d.kind === 'local') {
    half = ((d.n - 1) / 2) * d.spacingM;
    px = d.spacingM;
    if (!(half > 0) || half > 0.25 * R) return null;
    const f = frameOf(d.lat0, d.lon0);
    const q = frameOf(site.lat, site.lon).up;
    const ce = q[0] * f.east[0] + q[1] * f.east[1] + q[2] * f.east[2];
    const cn = q[0] * f.north[0] + q[1] * f.north[1] + q[2] * f.north[2];
    const cu = q[0] * f.up[0] + q[1] * f.up[1] + q[2] * f.up[2];
    const t = Math.hypot(ce, cn);
    const ang = Math.atan2(t, cu);
    if (ang > 0.5) return { rMin: Math.max(0, (ang - 0.36) * R), rOut: Infinity };
    const k = t > 1e-15 ? (ang * R) / t : 0;
    x = ce * k;
    y = cn * k;
    const cMax = (Math.hypot(Math.abs(x) + half, Math.abs(y) + half)) / R;
    stretch = cMax / Math.sin(cMax);
  } else {
    half = ((d.size - 1) / 2) * d.metresPerPx;
    px = d.metresPerPx;
    const colat = d.pole === 'S' ? 90 + site.lat : 90 - site.lat;
    if (!(half > 0) || !(colat >= 0 && colat < 60)) return null;
    const r = 2 * R * Math.tan((colat / 2) * RAD);
    x = r * Math.sin(site.lon * RAD);
    y = r * Math.cos(site.lon * RAD);
    const rhoMax = Math.hypot(Math.abs(x) + half, Math.abs(y) + half);
    if (rhoMax > 1.8 * R) return null;
    stretch = 1 + (rhoMax / (2 * R)) ** 2;
  }
  const ax = Math.abs(x), ay = Math.abs(y);
  const margin = 3 * px;
  const nearest = Math.hypot(Math.max(0, ax - half), Math.max(0, ay - half));
  const farthest = Math.hypot(ax + half, ay + half);
  return { rMin: Math.max(0, nearest / stretch - margin), rOut: farthest + margin };
}

/**
 * Reach of a source from a site. The prediction from the descriptor is checked against the
 * source's own covers() at probe points; if they disagree (a synthetic or unusual source),
 * no pruning is applied to it.
 */
export function sourceReach(source: HeightSource, site: LatLon): SourceReach {
  let r: SourceReach | null;
  try {
    r = predictedReach(source.descriptor, site);
  } catch {
    r = null;
  }
  if (!r || (r.rMin === 0 && r.rOut === Infinity)) return ANY_DISTANCE;
  const probe = (dist: number, az: number) => {
    const p = destination(site, az, dist);
    return source.covers(p.lat, p.lon);
  };
  for (let az = 0; az < 360; az += 30) {
    if (r.rMin > 0 && (probe(r.rMin * 0.98, az + 7) || probe(r.rMin * 0.5, az + 7))) return ANY_DISTANCE;
    if (Number.isFinite(r.rOut) && r.rOut < 0.9 * Math.PI * R && (probe(r.rOut * 1.02 + 1, az + 7) || probe(r.rOut * 1.5 + 1, az + 7))) return ANY_DISTANCE;
  }
  if (r.rMin > 0 && source.covers(site.lat, site.lon)) return ANY_DISTANCE;
  return r;
}

/** Skyline elevation at any azimuth, degrees, interpolated between profile samples (between fine samples where `p.fine` covers the azimuth). */
export function skylineAt(p: HorizonProfile, azDeg: number): number {
  const fine = p.fine;
  if (fine && fine.length) {
    for (let s = 0; s < fine.length; s++) {
      const seg = fine[s];
      const m = seg.elevDeg.length;
      let x = azDeg * seg.perDeg - seg.k0;
      const turn = 360 * seg.perDeg;
      // Bring the azimuth into the segment's turn (a segment may run past 360 deg).
      x -= Math.floor(x / turn) * turn;
      if (x <= m - 1) {
        const i = Math.floor(x);
        if (i >= m - 1) return seg.elevDeg[m - 1];
        return seg.elevDeg[i] + (seg.elevDeg[i + 1] - seg.elevDeg[i]) * (x - i);
      }
    }
  }
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

/** Closest terrain sampled in front of the observer, metres. Nearer than this only the limit at the observer's feet is taken (mast 0). */
export const NEAR_FIELD_MIN_M = 0.1;

/**
 * The terrain skyline around an observer `mastHeightM` above the ground at `site`.
 * For each azimuth the great circle is marched outwards, sampling the finest source
 * that covers each point, with a step of `resFraction` x that source's resolution that
 * grows to `growth` x distance far out. Marching stops where even the highest terrain
 * on the Moon could no longer rise above the skyline found so far, or at `maxRangeM`.
 *
 * Near the observer. Seen from height H above the ground, terrain at a small distance d stands
 * at about (h(d) - h(0) - H) / d: a rise of 30 cm matters at 40 m and not at 4 km, and with
 * H = 0 the ground at the observer's own feet is the skyline wherever the ground is convex
 * (a crest, a rim). So the march starts NEAR_FIELD_MIN_M from the observer (a third of the mast
 * height if that is more: nearer terrain stands below -70 deg) with steps of `nearFraction` x
 * distance until those reach the grid step; and for H = 0 the limit at distance zero, the slope
 * of the interpolated terrain along the ray (extrapolated from the two closest samples), is
 * included. Such a skyline point is reported with distance 0.
 */
export function computeHorizon(stack: TerrainStack, site: LatLon, mastHeightM: number, options: HorizonOptions = {}): HorizonProfile {
  const azStep = options.azStepDeg ?? 0.5;
  const maxRange = options.maxRangeM ?? 400_000;
  const growth = options.growth ?? 0.004;
  const resFrac = options.resFraction ?? 0.7;
  const nearFrac = options.nearFraction ?? 0.05;
  const nSub = Math.max(2, Math.round(options.searchPoints ?? 6)), nRef = nSub >> 1;
  const azList = options.azimuthsDeg;
  const nAz = azList ? azList.length : Math.max(1, Math.round(360 / azStep));
  const azStepDeg = azList ? NaN : 360 / nAz;
  const warnings: string[] = [];
  const sources = stack.sources;

  const elevDeg = new Float32Array(nAz);
  const distM = new Float32Array(nAz);
  const heightM = new Float32Array(nAz);
  const skylineLayer = new Uint8Array(nAz);

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
  let gaps = 0;
  let reachedMax = 0;
  const nSrc = sources.length;
  const rMin = new Float64Array(nSrc), rOut = new Float64Array(nSrc), resOf = new Float64Array(nSrc);
  const fast: (UnitSampler | null)[] = [];
  sources.forEach((src, k) => {
    const r = sourceReach(src, site);
    rMin[k] = r.rMin;
    rOut[k] = r.rOut;
    resOf[k] = src.resolutionM;
    fast.push(options.fast === false ? null : cachedSampler(src));
  });
  const usedFrom = new Float64Array(nSrc).fill(Infinity), usedTo = new Float64Array(nSrc).fill(-Infinity);
  const coarsest = resOf[nSrc - 1];
  const refineOn = options.refine !== false;
  // The marching samples of the current ray (distance, tangent of elevation), kept for the fine search.
  let cap = 2048;
  let dArr = new Float64Array(cap), tArr = new Float64Array(cap), sArr = new Float64Array(cap);

  // Local frame at the site (same convention as src/astro/topocentric.ts).
  const { up, east, north } = frameOf(site.lat, site.lon);

  // The ground under the observer, looked up the way the rays look terrain up (the fast samplers
  // reproduce HeightSource.sample() to about a part in a million, which is millimetres here: close
  // to the observer that would tilt the ground by degrees, so one lookup serves both).
  let groundM = here.h;
  const fastHere = fast[here.idx];
  if (fastHere && rMin[here.idx] <= 0) {
    const v = fastHere(up[0], up[1], up[2]);
    if (Number.isFinite(v) && Math.abs(v - here.h) <= 1e-3) groundM = v;
  }
  const h0 = groundM + mast;
  const R0 = R + h0;
  const Rmax = R + Math.max(MOON_MAX_HEIGHT_M, h0);
  // Where the march starts, and the grid step at the site: a skyline point nearer than that is "at the observer's feet".
  const firstStep = resFrac * resOf[here.idx];
  const startD = Math.min(firstStep, Math.max(NEAR_FIELD_MIN_M, mast / 3));
  let atFeet = 0;

  // State of the ray being marched, shared with the fine search below.
  let tx = 0, ty = 0, tz = 0;
  let evalH = NaN, evalIdx = -1;
  /** Tangent of the elevation of the terrain at distance d along the current ray (-Infinity where no source has data). */
  const tanAt = (d: number): number => {
    const th = d / R;
    const ct = Math.cos(th), st = Math.sin(th);
    const px = ct * up[0] + st * tx, py = ct * up[1] + st * ty, pz = ct * up[2] + st * tz;
    let lat = NaN, lon = NaN;
    for (let k = 0; k < nSrc; k++) {
      if (d < rMin[k] || d > rOut[k]) continue;
      const f = fast[k];
      let v: number;
      if (f) v = f(px, py, pz);
      else {
        if (lat !== lat) {
          lat = Math.asin(pz > 1 ? 1 : pz < -1 ? -1 : pz) / RAD;
          lon = Math.atan2(py, px) / RAD;
        }
        v = sources[k].sample(lat, lon);
      }
      if (v === v && v !== Infinity && v !== -Infinity) {
        evalH = v;
        evalIdx = k;
        const Rh = R + v;
        return (Rh * ct - R0) / (Rh * st);
      }
    }
    evalH = NaN;
    evalIdx = -1;
    return -Infinity;
  };

  for (let a = 0; a < nAz; a++) {
    const az = (azList ? azList[a] : a * azStepDeg) * RAD;
    const ca = Math.cos(az), sa = Math.sin(az);
    tx = ca * north[0] + sa * east[0];
    ty = ca * north[1] + sa * east[1];
    tz = ca * north[2] + sa * east[2];
    let bestD = NaN, bestH = NaN, bestIdx = 0;
    // Elevations are compared through their tangents (the horizontal component is always positive).
    let tanBest = -Infinity;
    let m = 0;
    // An observer on the ground: the slope at their feet, the limit of the two closest samples
    // (within one grid cell the interpolated terrain is a polynomial of the distance).
    if (mast === 0) {
      const t1 = tanAt(startD), t2 = tanAt(2 * startD);
      if (t1 > -Infinity && t2 > -Infinity) {
        tanBest = 2 * t1 - t2;
        bestD = 0; bestH = groundM; bestIdx = here.idx;
      }
    }
    let d = startD;
    while (d <= maxRange) {
      const th = d / R;
      const ct = Math.cos(th), st = Math.sin(th);
      // Stop once the highest possible terrain at this distance would sit below the skyline.
      if ((Rmax * ct - R0) / (Rmax * st) < tanBest) break;
      const px = ct * up[0] + st * tx, py = ct * up[1] + st * ty, pz = ct * up[2] + st * tz;
      // Finest source with data here. Latitude and longitude are only worked out if a source needs them.
      let h = NaN;
      let idx = -1;
      let lat = NaN, lon = NaN;
      for (let k = 0; k < nSrc; k++) {
        if (d < rMin[k] || d > rOut[k]) continue;
        const f = fast[k];
        let v: number;
        if (f) v = f(px, py, pz);
        else {
          if (lat !== lat) {
            lat = Math.asin(pz > 1 ? 1 : pz < -1 ? -1 : pz) / RAD;
            lon = Math.atan2(py, px) / RAD;
          }
          v = sources[k].sample(lat, lon);
        }
        if (v === v && v !== Infinity && v !== -Infinity) { h = v; idx = k; break; }
      }
      let res: number;
      let t = -Infinity;
      if (idx < 0) {
        gaps++;
        res = coarsest;
      } else {
        res = resOf[idx];
        if (d < usedFrom[idx]) usedFrom[idx] = d;
        if (d > usedTo[idx]) usedTo[idx] = d;
        const Rh = R + h;
        t = (Rh * ct - R0) / (Rh * st);
        if (t > tanBest) {
          tanBest = t;
          bestD = d; bestH = h; bestIdx = idx;
        }
      }
      if (refineOn) {
        if (m === cap) {
          cap *= 2;
          const d2 = new Float64Array(cap), t2 = new Float64Array(cap), s2 = new Float64Array(cap);
          d2.set(dArr); t2.set(tArr); s2.set(sArr);
          dArr = d2; tArr = t2; sArr = s2;
        }
        dArr[m] = d;
        tArr[m] = t;
        sArr[m] = res;
        m++;
      }
      if (d > reachedMax) reachedMax = d;
      const gridStep = resFrac * res, nearStep = nearFrac * d, farStep = growth * d;
      const step = nearStep < gridStep ? nearStep : gridStep;
      d += step > farStep ? step : farStep;
    }

    // Fine search. Between two marching samples the terrain's elevation can peak higher than at
    // either (a crest, or simply a grid line crossed between them). Every step that such a peak
    // could lift above the best sample is searched at 1/6 and then 1/24 of its length (default
    // `searchPoints`). "Could" is judged from how much the elevation changes from sample to sample
    // around the step, whether or not a sample there is a local maximum: a peak can rise and fall
    // between two samples of a slope that only falls.
    if (refineOn && tanBest > -Infinity) {
      const coarseBest = tanBest;
      for (let i = 0; i < m - 1; i++) {
        const t0 = tArr[i], t1 = tArr[i + 1];
        const top = t0 > t1 ? t0 : t1;
        if (!(top > -Infinity)) continue;
        // The largest change between neighbouring samples around this step bounds what was missed.
        let swing = 0;
        for (let j = i > 0 ? i : 1; j <= i + 2 && j < m; j++) {
          const a0 = tArr[j - 1], a1 = tArr[j];
          if (a0 > -Infinity && a1 > -Infinity) {
            const dv = a1 > a0 ? a1 - a0 : a0 - a1;
            if (dv > swing) swing = dv;
          }
        }
        const lo = dArr[i], hi = dArr[i + 1];
        const step = hi - lo;
        // Far out, where the steps are longer than the data's own sampling, a crest can sit between
        // two samples with only its flanks seen: allow for the steepest ground that could hide
        // there, a 35 deg slope over half a step. (Where the steps follow the grid, the change from
        // sample to sample already measures it: interpolated data has no detail finer than its samples.)
        const hidden = step > 1.05 * resFrac * sArr[i] ? (0.35 * step) / lo : 0;
        if (top + (swing > hidden ? swing : hidden) < coarseBest) continue;
        let localBest = top, localD = t0 > t1 ? lo : hi;
        const w1 = step / nSub;
        for (let k = 0; k < nSub; k++) {
          const dd = lo + (k + 0.5) * w1;
          const tv = tanAt(dd);
          if (tv > localBest) { localBest = tv; localD = dd; }
          if (tv > tanBest) { tanBest = tv; bestD = dd; bestH = evalH; bestIdx = evalIdx; }
        }
        const w2 = w1 / 4;
        for (let k = -nRef; k <= nRef; k++) {
          if (k === 0) continue;
          const dd = localD + k * w2;
          if (dd <= lo || dd >= hi) continue;
          const tv = tanAt(dd);
          if (tv > tanBest) { tanBest = tv; bestD = dd; bestH = evalH; bestIdx = evalIdx; }
        }
      }
    }
    if (bestD < firstStep) atFeet++;
    elevDeg[a] = tanBest === -Infinity ? -90 : Math.atan(tanBest) / RAD;
    distM[a] = bestD;
    heightM[a] = bestH;
    skylineLayer[a] = bestIdx;
  }

  const layers: DemLayerUse[] = [];
  const layerOf = new Map<number, number>();
  for (let k = 0; k < nSrc; k++) {
    if (usedTo[k] < 0) continue;
    layerOf.set(k, layers.length);
    layers.push({ name: sources[k].name, resolutionM: sources[k].resolutionM, fromM: Math.round(usedFrom[k]), toM: Math.round(usedTo[k]) });
  }
  for (let a = 0; a < nAz; a++) skylineLayer[a] = layerOf.get(skylineLayer[a]) ?? 0;

  if (gaps > 0) warnings.push(`${gaps} terrain samples had no elevation data in any source; the skyline ignores those points.`);
  if (atFeet > 0) {
    const res = Math.round(resOf[here.idx]);
    warnings.push(
      `With the observer ${mast === 0 ? 'on the ground' : `${mast} m above the ground`}, the skyline in ${atFeet} of ${nAz} directions is the ground within ${Math.round(firstStep)} m of the observer: the slope of the ${res} m elevation grid there. Rocks and relief smaller than the grid are not in the data, so a real horizon this close can differ; a higher mast depends less on it.`,
    );
  }
  // Honest coverage: what resolves the near field?
  const near = layers.filter((l) => l.fromM < 30_000);
  const finestNear = near.length ? Math.min(...near.map((l) => l.resolutionM)) : Infinity;
  if (finestNear >= 500) {
    warnings.push(`Only ${Math.round(finestNear)} m elevation data within 30 km of the site: nearby hills and crater rims smaller than about ${Math.round(2 * finestNear)} m across are not resolved, so the near skyline may be too low.`);
  }

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

/** The 3 x 3 pattern of points a slope is fitted through: offsets of -half, 0, +half east and north. */
function slopeStencil(site: LatLon, baselineM: number) {
  const half = baselineM / 2;
  const pts: { e: number; n: number; p: LatLon }[] = [];
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const e = i * half, n = j * half;
      const dist = Math.hypot(e, n);
      pts.push({ e, n, p: dist === 0 ? { lat: site.lat, lon: site.lon } : destination(site, Math.atan2(e, n) / RAD, dist) });
    }
  }
  return pts;
}

/**
 * Terrain slope at a site: least-squares plane through a 3 x 3 pattern of points
 * spaced baselineM / 2 apart (so the slope is measured over `baselineM`), from the
 * finest source that has data at all nine points.
 */
export function slopeAt(stack: TerrainStack, site: LatLon, baselineM: number): SlopeInfo {
  const pts = slopeStencil(site, baselineM);
  for (const src of stack.sources) {
    const z = pts.map(({ p }) => src.sample(p.lat, p.lon));
    if (z.some((v) => !Number.isFinite(v))) continue;
    return slopeFromPlane(pts, z, baselineM, src);
  }
  return { slopeDeg: NaN, aspectDeg: NaN, baselineM, demName: 'no elevation data at this site' };
}

/** The same slope from one given source only (NaN where it lacks data at any of the nine points). */
export function slopeOn(source: HeightSource, site: LatLon, baselineM: number): SlopeInfo {
  const pts = slopeStencil(site, baselineM);
  const z = pts.map(({ p }) => source.sample(p.lat, p.lon));
  if (z.some((v) => !Number.isFinite(v))) return { slopeDeg: NaN, aspectDeg: NaN, baselineM, demName: `${source.name}: no data at this point` };
  return slopeFromPlane(pts, z, baselineM, source);
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
  const res = Math.round(src.resolutionM * 100) / 100;
  const note = baselineM < src.resolutionM ? ` (baseline shorter than the ${res} m grid: interpolated)` : '';
  return { slopeDeg: Math.atan(g) / RAD, aspectDeg: aspect, baselineM, demName: `${src.name}, ${res} m${note}` };
}
