// Terrain model of the surface scene: nested square height grids centred on the site, how
// a point on them maps into the scene (with the Moon's curvature), and where the terrain
// skyline sits for a viewer standing in it. Pure math: no DOM, no three.js.
import { MOON_RADIUS_M } from '../../core/types';
import { DEG, type Vec3Like } from './skyMath';

/**
 * A square height grid centred on the site. Sample (i, j) lies (i - c) * spacing east and
 * (j - c) * spacing north of it (c = (n - 1) / 2), measured over the sphere along the great
 * circle with that bearing: the same convention as the bundled site windows.
 * Heights are metres above the 1737.4 km reference sphere.
 */
export interface Grid {
  n: number;
  spacing: number;
  data: Float32Array;
}

export const halfExtent = (g: Grid): number => ((g.n - 1) / 2) * g.spacing;

/** Small deterministic random generator, so a site's generated detail is the same on every visit. */
export function seededRandom(text: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bilinear height at an east/north offset; clamped to the grid's edge outside it. */
export function sampleGrid(grid: Grid, east: number, north: number): number {
  const n = grid.n, c = (n - 1) / 2;
  const fx = Math.min(n - 1.001, Math.max(0, east / grid.spacing + c));
  const fy = Math.min(n - 1.001, Math.max(0, north / grid.spacing + c));
  const x = Math.floor(fx), y = Math.floor(fy), a = fx - x, b = fy - y;
  const d = grid.data;
  return (1 - b) * ((1 - a) * d[y * n + x] + a * d[y * n + x + 1]) + b * ((1 - a) * d[(y + 1) * n + x] + a * d[(y + 1) * n + x + 1]);
}

/** Catmull-Rom interpolation, so upsampled terrain has no creases at cell edges. */
export function sampleSmooth(grid: Grid, east: number, north: number): number {
  const n = grid.n, c = (n - 1) / 2;
  const fx = Math.min(n - 2.001, Math.max(1, east / grid.spacing + c));
  const fy = Math.min(n - 2.001, Math.max(1, north / grid.spacing + c));
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
  const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (yy: number) => {
    const o = yy * n + x;
    return cubic(grid.data[o - 1], grid.data[o], grid.data[o + 1], grid.data[o + 2], tx);
  };
  return cubic(row(y - 1), row(y), row(y + 1), row(y + 2), ty);
}

/** Near its edge, eases the inner grid onto the outer one so the two meshes meet without a step. */
export function blendEdge(inner: Grid, outer: Grid): void {
  const n = inner.n, c = (n - 1) / 2, band = Math.max(10, Math.round(n / 12));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const fromEdge = Math.min(i, j, n - 1 - i, n - 1 - j);
      if (fromEdge >= band) continue;
      const t = 1 - fromEdge / band;
      const coarse = sampleGrid(outer, (i - c) * inner.spacing, (j - c) * inner.spacing);
      inner.data[j * n + i] += (coarse - inner.data[j * n + i]) * t * t * (3 - 2 * t);
    }
  }
}

/** Every `stride`-th sample of a grid (for a lighter mesh). The grid's size minus one must divide evenly. */
export function decimate(grid: Grid, stride: number): Grid {
  if (stride <= 1 || (grid.n - 1) % stride !== 0) return grid;
  const n = (grid.n - 1) / stride + 1;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = grid.data[j * stride * grid.n + i * stride];
  return { n, spacing: grid.spacing * stride, data };
}

/** A coarser grid resampled smoothly onto a finer one of `n` samples at `spacing` metres. */
export function upsample(coarse: Grid, n: number, spacing: number): Grid {
  const c = (n - 1) / 2, data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = sampleSmooth(coarse, (i - c) * spacing, (j - c) * spacing);
  return { n, spacing, data };
}

/** Craters per square metre larger than D metres, about D^-2: roughly the equilibrium density of old lunar surfaces. */
const CRATER_DENSITY = 0.03;
const CRATER_MIN = 7;
const CRATER_MAX = 220;

/**
 * GENERATED relief (not measured): craters and gentle undulation that a coarse elevation
 * model cannot resolve, as height offsets in metres for an n x n grid. Deterministic per
 * seed. Shown only where no survey exists, always labelled, and switchable.
 */
export function generatedRelief(seed: string, n: number, spacing: number): Float32Array {
  const sp = spacing, c = (n - 1) / 2, half = c * sp;
  const rand = seededRandom(seed);
  const detail = new Float32Array(n * n);

  // Craters: sizes follow a D^-2 cumulative law, most of them old and shallow.
  const area = (2 * half) ** 2;
  const count = Math.round((CRATER_DENSITY * area) / CRATER_MIN ** 2);
  for (let k = 0; k < count; k++) {
    const d = Math.min(CRATER_MAX, CRATER_MIN / Math.sqrt(1 - rand()));
    const r = d / 2;
    const cx = (rand() * 2 - 1) * half, cy = (rand() * 2 - 1) * half;
    const fresh = rand() ** 3; // 0 = worn almost flat, 1 = sharp
    const depth = d * (0.025 + 0.16 * fresh);
    const rim = depth * 0.22;
    const reach = r * 2.2;
    const i0 = Math.max(0, Math.floor((cx - reach) / sp + c)), i1 = Math.min(n - 1, Math.ceil((cx + reach) / sp + c));
    const j0 = Math.max(0, Math.floor((cy - reach) / sp + c)), j1 = Math.min(n - 1, Math.ceil((cy + reach) / sp + c));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const rho = Math.hypot((i - c) * sp - cx, (j - c) * sp - cy) / r;
        if (rho >= 2.2) continue;
        // Bowl inside the rim, raised rim falling away outside it.
        detail[j * n + i] += rho < 1 ? -depth * (1 - rho * rho) + rim * rho * rho : rim * (1 - (rho - 1) / 1.2) ** 2;
      }
    }
  }

  // Gentle undulation at a few scales.
  for (let cells = 6, amp = 1.6; cells <= 48; cells *= 2, amp *= 0.5) {
    const lattice = new Float32Array((cells + 1) * (cells + 1)).map(() => rand() * 2 - 1);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const fx = (i / (n - 1)) * cells, fy = (j / (n - 1)) * cells;
        const x = Math.min(cells - 1, Math.floor(fx)), y = Math.min(cells - 1, Math.floor(fy));
        const tx = fx - x, ty = fy - y, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const row = cells + 1;
        const top = lattice[y * row + x] * (1 - sx) + lattice[y * row + x + 1] * sx;
        const bot = lattice[(y + 1) * row + x] * (1 - sx) + lattice[(y + 1) * row + x + 1] * sx;
        detail[j * n + i] += (top * (1 - sy) + bot * sy) * amp;
      }
    }
  }
  return detail;
}

/** The point reached from (lat0, lon0) after going `east` and `north` metres over the sphere (degrees). */
export function offsetLatLon(lat0: number, lon0: number, east: number, north: number): { lat: number; lon: number } {
  const d = Math.hypot(east, north) / MOON_RADIUS_M;
  if (d === 0) return { lat: lat0, lon: lon0 };
  const az = Math.atan2(east, north);
  const la = lat0 * DEG;
  const sinLat = Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  const lon2 = lon0 * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * sinLat);
  return { lat: lat2 / DEG, lon: ((((lon2 / DEG + 180) % 360) + 360) % 360) - 180 };
}

/** Relief finer than the elevation model, worked out from shading in the orbital photo. Row 0 is north. */
export interface DetailMap {
  size: number;
  /** Half the width of the square it covers, metres. */
  half: number;
  heights: Float32Array;
}

export class Ground {
  readonly radius = MOON_RADIUS_M;
  /** Terrain height at the site, metres above the reference sphere. */
  siteHeight = 0;
  /** Finest first; the first grid is the one walked on. */
  grids: Grid[] = [];
  detail: DetailMap | null = null;

  /** The finest grid that covers a point. */
  gridAt(east: number, north: number): Grid {
    const reach = Math.max(Math.abs(east), Math.abs(north));
    const g = this.grids;
    for (let k = 0; k < g.length; k++) if (reach <= halfExtent(g[k])) return g[k];
    return g[g.length - 1];
  }

  /** Photo-derived fine relief at a point, metres; zero where there is none. */
  detailAt(east: number, north: number): number {
    const d = this.detail;
    if (!d) return 0;
    const fx = ((east + d.half) / (2 * d.half)) * (d.size - 1);
    const fy = ((d.half - north) / (2 * d.half)) * (d.size - 1);
    if (fx < 0 || fy < 0 || fx >= d.size - 1 || fy >= d.size - 1) return 0;
    const x = Math.floor(fx), y = Math.floor(fy), a = fx - x, b = fy - y, h = d.heights, n = d.size;
    const v = (1 - b) * ((1 - a) * h[y * n + x] + a * h[y * n + x + 1]) + b * ((1 - a) * h[(y + 1) * n + x] + a * h[(y + 1) * n + x + 1]);
    // Ease out towards the edge of the surveyed square.
    return v * Math.min(1, (d.half - Math.max(Math.abs(east), Math.abs(north))) / 40);
  }

  /** Height above the sphere at a local east/north offset, metres. */
  heightAt(east: number, north: number): number {
    const grid = this.gridAt(east, north);
    if (grid === this.grids[0]) return sampleSmooth(grid, east, north) + this.detailAt(east, north);
    return sampleGrid(grid, east, north);
  }

  /** Scene position of a point at height `h` over a local east/north offset, including the Moon's curvature. */
  point<T extends Vec3Like>(east: number, north: number, h: number, out: T): T {
    const d = Math.hypot(east, north);
    const theta = d / this.radius;
    const rr = this.radius + h;
    const horiz = d > 0 ? (rr * Math.sin(theta)) / d : 0;
    out.x = east * horiz;
    out.y = rr * Math.cos(theta) - (this.radius + this.siteHeight);
    out.z = -north * horiz;
    return out;
  }

  /** Scene height of the terrain surface under a scene x/z. Uses plain (bilinear) lookups: for ray tests, not for standing on. */
  surfaceY(x: number, z: number): number {
    const east = x, north = -z;
    const grid = this.gridAt(east, north);
    const h = sampleGrid(grid, east, north) + (grid === this.grids[0] ? this.detailAt(east, north) : 0);
    return (this.radius + h) * Math.cos(Math.hypot(east, north) / this.radius) - (this.radius + this.siteHeight);
  }

  /**
   * Tangent of the terrain skyline's elevation along an azimuth, as seen from a scene
   * point: the highest of (terrain height - eye height) / distance out to the edge of the
   * modelled terrain. Measured in the scene frame, so it compares directly with the
   * direction of a body in the sky.
   */
  skylineTan(from: Vec3Like, azDeg: number): number {
    if (!this.grids.length) return -Infinity;
    const sx = Math.sin(azDeg * DEG), sz = -Math.cos(azDeg * DEG);
    const limit = halfExtent(this.grids[this.grids.length - 1]);
    let best = -Infinity;
    let t = Math.max(0.5, this.grids[0].spacing * 0.5);
    for (let guard = 0; guard < 20000; guard++) {
      const x = from.x + sx * t, z = from.z + sz * t;
      if (Math.abs(x) > limit || Math.abs(z) > limit) break;
      const tan = (this.surfaceY(x, z) - from.y) / t;
      if (tan > best) best = tan;
      // A fraction of a cell of whatever grid is underfoot, growing gently with distance.
      t += Math.max(this.gridAt(x, -z).spacing * 0.25, t * 0.003);
    }
    return best;
  }
}
