// Sun shadows over a terrain grid, by one sweep across the grid along the Sun's direction.
//
// For every cell it finds the "shadow height": the height below which a point there cannot
// see a light at a given elevation, because terrain towards the light stands in the way.
// Each cell takes that from its neighbour towards the light (interpolated between two cells),
// lowered by the light's slope over the step: one pass, a few operations per cell.
// Done twice, for the Sun's upper and lower limb, it gives the fraction of the Sun's disc a
// cell sees, which is what makes the long, soft-edged shadows of the polar regions.
//
// Pure maths over typed arrays (no three.js): unit-tested, and usable in a worker.

/** Heights on a square map grid: column index grows towards +x, row index towards -y. */
export interface SweepGrid {
  n: number;
  /** Height of each cell above a flat reference plane, metres (the Moon's curvature already taken off). */
  z: Float32Array;
  /** Ground distance between neighbouring cells, metres. */
  cellM: number;
}

/** Stands for "nothing in the way" (finite, so interpolation never produces NaN). */
export const NO_SHADOW = -1e9;

/**
 * Shadow height for light arriving from the map direction (ux, uy) (pointing TOWARDS the
 * light; need not be unit length) at an elevation whose tangent is `tanEl`.
 * `edge(col, row)` supplies the shadow height at a border cell whose neighbour towards the
 * light lies outside the grid (from a coarser, wider grid); without it nothing shades the border.
 */
export function sweepShadowHeight(grid: SweepGrid, ux: number, uy: number, tanEl: number, out: Float32Array, edge?: (col: number, row: number) => number): Float32Array {
  const { n, z, cellM } = grid;
  const ax = Math.abs(ux), ay = Math.abs(uy);
  if (!(ax + ay > 0)) return out.fill(NO_SHADOW);
  if (ax >= ay) {
    // The neighbour towards the light is in the next column; its row is shifted by the direction's slope.
    const step = ux > 0 ? 1 : -1;
    const shift = -uy / ax;
    const drop = cellM * Math.hypot(1, uy / ax) * tanEl;
    for (let k = 0; k < n; k++) {
      const c = step > 0 ? n - 1 - k : k;
      const cq = c + step;
      for (let r = 0; r < n; r++) {
        const rq = r + shift;
        let s: number;
        if (cq < 0 || cq >= n || rq < 0 || rq > n - 1) s = edge ? edge(c, r) : NO_SHADOW;
        else {
          const r0 = Math.min(n - 2, Math.floor(rq)), f = rq - r0;
          const i0 = r0 * n + cq, i1 = i0 + n;
          const a = z[i0] > out[i0] ? z[i0] : out[i0], b = z[i1] > out[i1] ? z[i1] : out[i1];
          s = a + (b - a) * f - drop;
        }
        out[r * n + c] = s;
      }
    }
  } else {
    // Towards the light is the next row (rows grow towards -y); the column is shifted.
    const step = uy > 0 ? -1 : 1;
    const shift = ux / ay;
    const drop = cellM * Math.hypot(1, ux / ay) * tanEl;
    for (let k = 0; k < n; k++) {
      const r = step > 0 ? n - 1 - k : k;
      const rq = r + step;
      for (let c = 0; c < n; c++) {
        const cq = c + shift;
        let s: number;
        if (rq < 0 || rq >= n || cq < 0 || cq > n - 1) s = edge ? edge(c, r) : NO_SHADOW;
        else {
          const c0 = Math.min(n - 2, Math.floor(cq)), f = cq - c0;
          const i0 = rq * n + c0, i1 = i0 + 1;
          const a = z[i0] > out[i0] ? z[i0] : out[i0], b = z[i1] > out[i1] ? z[i1] : out[i1];
          s = a + (b - a) * f - drop;
        }
        out[r * n + c] = s;
      }
    }
  }
  return out;
}

/**
 * Fraction of the Sun's disc each cell sees, 0..255. `low` is the shadow height for the
 * Sun's upper limb (the last part to be hidden), `high` for its lower limb: below `low` the
 * whole disc is hidden, above `high` all of it shows, in between a part.
 */
export function litFraction(z: Float32Array, low: Float32Array, high: Float32Array, out: Uint8Array): Uint8Array {
  for (let i = 0; i < z.length; i++) {
    const h = z[i], a = low[i], b = high[i];
    out[i] = h >= b ? 255 : h <= a ? 0 : Math.round((255 * (h - a)) / (b - a));
  }
  return out;
}

/** Bilinear read of a shadow-height field at fractional (col, row); NO_SHADOW outside. */
export function sampleField(field: Float32Array, n: number, col: number, row: number): number {
  if (!(col >= 0 && row >= 0 && col <= n - 1 && row <= n - 1)) return NO_SHADOW;
  const c0 = Math.min(n - 2, Math.floor(col)), r0 = Math.min(n - 2, Math.floor(row));
  const fc = col - c0, fr = row - r0, i = r0 * n + c0;
  const top = field[i] + (field[i + 1] - field[i]) * fc, bottom = field[i + n] + (field[i + n + 1] - field[i + n]) * fc;
  return top + (bottom - top) * fr;
}

/** Apparent radius of the Sun's disc seen from the Moon, radians (0.266 degrees). */
export const SUN_RADIUS_RAD = (0.2666 * Math.PI) / 180;

/**
 * The Sun in the map frame of a south-polar grid (x towards 90E, y towards 0E, up = out of
 * the south pole), from a Moon-fixed unit vector (x: 0N 0E, y: 0N 90E, z: north pole).
 * Returns the map direction towards the Sun and its elevation above the plane of the map.
 */
export function sunOverSouthPole(sunDir: readonly [number, number, number]): { ux: number; uy: number; elevationRad: number } {
  const [x, y, z] = sunDir;
  return { ux: y, uy: x, elevationRad: Math.atan2(-z, Math.hypot(x, y)) };
}
