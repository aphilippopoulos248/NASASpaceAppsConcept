// Faster height lookups for the skyline march.
//
// A HeightSource is asked with latitude and longitude, which the march would have to derive
// from the point's unit vector (asin, atan2) only for the source to turn them back into a
// vector (four more trigonometric calls). For the two projected layouts of
// src/terrain/types.ts ('local' and 'polar') the grid position follows directly from the
// unit vector, so this module builds a sampler that takes the vector.
//
// The terrain module stays the authority: a fast sampler is used only if it reproduces the
// source's own sample() at probe points spread over the grid (inside, at the edges, outside).
// If it does not (a synthetic source, or the terrain code changed its conventions), null is
// returned and the caller keeps using source.sample().
import { MOON_RADIUS_M } from '../core/types';
import type { HeightGridDescriptor, HeightSource } from '../terrain/types';

const R = MOON_RADIUS_M;
const RAD = Math.PI / 180;

/** Height in metres at a point given as a Moon-fixed unit vector; NaN where the grid has no data. */
export type UnitSampler = (x: number, y: number, z: number) => number;

type LocalDescriptor = Extract<HeightGridDescriptor, { kind: 'local' }>;
type PolarDescriptor = Extract<HeightGridDescriptor, { kind: 'polar' }>;

/** Bilinear blend with the terrain module's rule: a corner without data only matters if its weight is not negligible. */
function blend(v00: number, v10: number, v01: number, v11: number, a: number, b: number): number {
  const w00 = (1 - a) * (1 - b);
  const w10 = a * (1 - b);
  const w01 = (1 - a) * b;
  const w11 = a * b;
  return (w00 > 1e-9 ? w00 * v00 : 0) + (w10 > 1e-9 ? w10 * v10 : 0) + (w01 > 1e-9 ? w01 * v01 : 0) + (w11 > 1e-9 ? w11 * v11 : 0);
}

function localSampler(d: LocalDescriptor): UnitSampler {
  const la = d.lat0 * RAD, lo = d.lon0 * RAD;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  const ux = cl * co, uy = cl * so, uz = sl; // centre
  const ex = -so, ey = co; // east (z component 0)
  const nx = -sl * co, ny = -sl * so, nz = cl; // north
  const n = d.n, c = (n - 1) / 2, data = d.data;
  const eps = 1e-9 * n, hi = n - 1 + eps, kScale = R / d.spacingM;
  return (x, y, z) => {
    const ce = x * ex + y * ey;
    const cn = x * nx + y * ny + z * nz;
    const cu = x * ux + y * uy + z * uz;
    const t = Math.sqrt(ce * ce + cn * cn);
    let fx: number, fy: number;
    if (t < 1e-15) {
      if (cu < 0) return NaN;
      fx = c;
      fy = c;
    } else {
      const k = (Math.atan2(t, cu) * kScale) / t;
      fx = ce * k + c;
      fy = cn * k + c;
    }
    if (!(fx >= -eps && fy >= -eps && fx <= hi && fy <= hi)) return NaN;
    if (fx < 0) fx = 0; else if (fx > n - 1) fx = n - 1;
    if (fy < 0) fy = 0; else if (fy > n - 1) fy = n - 1;
    let ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix > n - 2) ix = n - 2;
    if (iy > n - 2) iy = n - 2;
    const i = iy * n + ix;
    return blend(data[i], data[i + 1], data[i + n], data[i + n + 1], fx - ix, fy - iy);
  };
}

function polarSampler(d: PolarDescriptor): UnitSampler {
  const n = d.size, c = n / 2 - 0.5, data = d.data;
  const south = d.pole === 'S';
  const sign = south ? 1 : -1;
  const eps = 1e-9 * n, hi = n - 1 + eps, q0 = (2 * R) / d.metresPerPx;
  const hasNodata = d.nodata !== undefined;
  const nd = d.nodata ?? NaN;
  const scale = d.scale, offset = d.offset;
  return (x, y, z) => {
    // cos of the angle from the grid's pole; the far hemisphere is never inside.
    const cosc = south ? -z : z;
    if (!(cosc > 0)) return NaN;
    const q = q0 / (1 + cosc);
    let fx = c + q * y;
    let fy = c - sign * q * x;
    if (!(fx >= -eps && fy >= -eps && fx <= hi && fy <= hi)) return NaN;
    if (fx < 0) fx = 0; else if (fx > n - 1) fx = n - 1;
    if (fy < 0) fy = 0; else if (fy > n - 1) fy = n - 1;
    let ix = Math.floor(fx), iy = Math.floor(fy);
    if (ix > n - 2) ix = n - 2;
    if (iy > n - 2) iy = n - 2;
    const i = iy * n + ix;
    let v00 = data[i], v10 = data[i + 1], v01 = data[i + n], v11 = data[i + n + 1];
    if (hasNodata) {
      if (v00 === nd) v00 = NaN;
      if (v10 === nd) v10 = NaN;
      if (v01 === nd) v01 = NaN;
      if (v11 === nd) v11 = NaN;
    }
    return blend(v00, v10, v01, v11, fx - ix, fy - iy) * scale + offset;
  };
}

const unit = (lat: number, lon: number): [number, number, number] => {
  const la = lat * RAD, lo = lon * RAD, cl = Math.cos(la);
  return [cl * Math.cos(lo), cl * Math.sin(lo), Math.sin(la)];
};

/** Probe points (lat, lon) spread over a descriptor's grid: inside, just inside and just outside each edge, well outside. */
function probePoints(d: LocalDescriptor | PolarDescriptor): { lat: number; lon: number }[] {
  const out: { lat: number; lon: number }[] = [];
  const n = d.kind === 'local' ? d.n : d.size;
  const c = d.kind === 'local' ? (n - 1) / 2 : n / 2 - 0.5;
  const px = d.kind === 'local' ? d.spacingM : d.metresPerPx;
  const toLatLon = (fx: number, fy: number) => {
    if (d.kind === 'local') {
      // (fx - c, fy - c) pixels east and north of the centre, travelled over the sphere.
      const e = (fx - c) * px, nn = (fy - c) * px;
      const dist = Math.hypot(e, nn) / R;
      if (dist === 0) return { lat: d.lat0, lon: d.lon0 };
      const la = d.lat0 * RAD, lo = d.lon0 * RAD, az = Math.atan2(e, nn);
      const lat2 = Math.asin(Math.sin(la) * Math.cos(dist) + Math.cos(la) * Math.sin(dist) * Math.cos(az));
      const lon2 = lo + Math.atan2(Math.sin(az) * Math.sin(dist) * Math.cos(la), Math.cos(dist) - Math.sin(la) * Math.sin(lat2));
      return { lat: lat2 / RAD, lon: lon2 / RAD };
    }
    const sign = d.pole === 'S' ? 1 : -1;
    const x = (fx - c) * px, y = ((c - fy) * px) / sign; // fx = c + x/px, fy = c - sign*y/px with (x, y) = r (sin lon, cos lon)
    const colat = (2 * Math.atan(Math.hypot(x, y) / (2 * R))) / RAD;
    return { lat: d.pole === 'S' ? colat - 90 : 90 - colat, lon: Math.atan2(x, y) / RAD };
  };
  // A fixed pseudo-random sequence: the same probes every time.
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let k = 0; k < 96; k++) out.push(toLatLon(rnd() * (n - 1), rnd() * (n - 1)));
  // Exact nodes and half-way points.
  for (const [fx, fy] of [[0, 0], [n - 1, n - 1], [0, n - 1], [n - 1, 0], [c, c], [1, 1], [n - 2, n - 2], [0.5, 0.5], [n - 1.5, 0.25], [Math.floor(c), Math.floor(c) + 0.5]]) out.push(toLatLon(fx, fy));
  // Just inside and just outside every edge, and well outside.
  for (let k = 0; k < 12; k++) {
    const t = rnd() * (n - 1);
    for (const off of [0.01, -0.01, -3, -n]) {
      out.push(toLatLon(off, t), toLatLon(n - 1 - off, t), toLatLon(t, off), toLatLon(t, n - 1 - off));
    }
  }
  return out;
}

/** True when two heights agree: both absent, or within a micrometre-level tolerance. */
const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/**
 * A unit-vector sampler equivalent to `source.sample(lat, lon)`, or null when none can be
 * built or it fails to reproduce the source at the probe points.
 */
export function fastSamplerFor(source: HeightSource): UnitSampler | null {
  const d = source.descriptor;
  try {
    if (!d || (d.kind !== 'local' && d.kind !== 'polar')) return null;
    const n = d.kind === 'local' ? d.n : d.size;
    if (!(n >= 2) || d.data.length !== n * n) return null;
    if (d.kind === 'local' && !(d.spacingM > 0 && ((n - 1) / 2) * d.spacingM < 0.5 * R)) return null;
    if (d.kind === 'polar' && !(d.metresPerPx > 0)) return null;
    const fast = d.kind === 'local' ? localSampler(d) : polarSampler(d);
    for (const p of probePoints(d)) {
      const u = unit(p.lat, p.lon);
      if (!same(fast(u[0], u[1], u[2]), source.sample(p.lat, p.lon))) return null;
    }
    return fast;
  } catch {
    return null;
  }
}
