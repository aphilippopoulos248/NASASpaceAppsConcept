// Square pieces of the south-polar elevation layers, prepared for drawing: decimated or cut
// out of a LOLA polar grid, with what the close-up needs from them (heights for the mesh,
// a normal map, heights above a flat plane for the shadow sweep). Pure maths, no three.js.
//
// Map frame of the LOLA south-polar products (polar stereographic, true scale at the pole):
// x towards 90E, y towards 0E; column index grows with x, row index grows towards -y.
import { MOON_RADIUS_M } from '../../core/types';
import { polarLatLon } from '../../terrain/geo';

/** The part of a polar height grid this module reads (see src/terrain/types.ts, kind 'polar'). */
export interface PolarLayer {
  size: number;
  metresPerPx: number;
  data: Int16Array | Float32Array;
  scale: number;
  offset: number;
  nodata?: number;
}

export interface PolarGrid {
  n: number;
  /** Map metres between neighbouring cells. */
  cellM: number;
  /** Map x of column 0's centre and map y of row 0's centre, metres. */
  x0: number;
  y0: number;
  /** Height above the 1737.4 km sphere, metres. */
  h: Float32Array;
}

const R = MOON_RADIUS_M;

/** Map x of a layer's column 0 (and map y of its row 0, with the sign flipped). */
const layerEdge = (l: PolarLayer) => (l.size / 2 - 0.5) * l.metresPerPx;

/** Half-width of the square a layer covers, metres in the map. */
export const layerHalfWidth = (l: PolarLayer) => layerEdge(l);

/** The whole layer at `factor` times coarser spacing: each cell is the mean of factor x factor samples. */
export function decimate(l: PolarLayer, factor: number): PolarGrid {
  const n = Math.floor(l.size / factor);
  const start = Math.floor((l.size - n * factor) / 2);
  const h = new Float32Array(n * n);
  const k = l.scale / (factor * factor);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let sum = 0;
      const base = (start + r * factor) * l.size + start + c * factor;
      for (let j = 0; j < factor; j++) {
        const o = base + j * l.size;
        for (let i = 0; i < factor; i++) sum += l.data[o + i];
      }
      h[r * n + c] = sum * k + l.offset;
    }
  }
  const first = start + (factor - 1) / 2; // centre of the first block, in layer pixels
  return { n, cellM: l.metresPerPx * factor, x0: -layerEdge(l) + first * l.metresPerPx, y0: layerEdge(l) - first * l.metresPerPx, h };
}

/**
 * An n x n piece of a layer at its own spacing, centred on map point (x, y) as nearly as the
 * layer allows (the piece is shifted to stay inside the layer). Null when the point is outside.
 */
export function cutWindow(l: PolarLayer, x: number, y: number, n: number): PolarGrid | null {
  const edge = layerEdge(l);
  if (Math.abs(x) > edge || Math.abs(y) > edge || n > l.size) return null;
  const col = Math.round((x + edge) / l.metresPerPx), row = Math.round((edge - y) / l.metresPerPx);
  const c0 = Math.min(l.size - n, Math.max(0, col - (n >> 1))), r0 = Math.min(l.size - n, Math.max(0, row - (n >> 1)));
  const h = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const o = (r0 + r) * l.size + c0;
    for (let c = 0; c < n; c++) h[r * n + c] = l.data[o + c] * l.scale + l.offset;
  }
  return { n, cellM: l.metresPerPx, x0: -edge + c0 * l.metresPerPx, y0: edge - r0 * l.metresPerPx, h };
}

export const gridX = (g: PolarGrid, col: number) => g.x0 + col * g.cellM;
export const gridY = (g: PolarGrid, row: number) => g.y0 - row * g.cellM;

/** Fractional (col, row) of a map point. */
export const gridCell = (g: PolarGrid, x: number, y: number): [number, number] => [(x - g.x0) / g.cellM, (g.y0 - y) / g.cellM];

/** True when a map point lies inside the grid (between its outermost cell centres). */
export function gridCovers(g: PolarGrid, x: number, y: number): boolean {
  const [c, r] = gridCell(g, x, y);
  return c >= 0 && r >= 0 && c <= g.n - 1 && r <= g.n - 1;
}

/** Height at a map point (bilinear), or NaN outside the grid. */
export function gridHeight(g: PolarGrid, x: number, y: number): number {
  const [col, row] = gridCell(g, x, y);
  if (!(col >= 0 && row >= 0 && col <= g.n - 1 && row <= g.n - 1)) return NaN;
  const c0 = Math.min(g.n - 2, Math.floor(col)), r0 = Math.min(g.n - 2, Math.floor(row));
  const fc = col - c0, fr = row - r0, i = r0 * g.n + c0;
  const top = g.h[i] + (g.h[i + 1] - g.h[i]) * fc, bottom = g.h[i + g.n] + (g.h[i + g.n + 1] - g.h[i + g.n]) * fc;
  return top + (bottom - top) * fr;
}

/** Latitude and longitude of a cell (south pole). */
export function gridLatLon(g: PolarGrid, col: number, row: number): { lat: number; lon: number } {
  return polarLatLon('S', gridX(g, col), gridY(g, row));
}

/** Ground metres per map metre at a map point: the projection is conformal, so one factor serves every direction. */
export function groundScale(x: number, y: number): number {
  return 1 / (1 + (x * x + y * y) / (4 * R * R));
}

/**
 * Height of each cell above the plane that touches the reference sphere at the pole, metres:
 * the terrain height with the Moon's curvature taken off. Shadows are swept over this, so a
 * ridge 100 km away sits as low as the curved Moon really puts it.
 */
export function heightsAbovePolarPlane(g: PolarGrid): Float32Array {
  const z = new Float32Array(g.n * g.n);
  for (let r = 0; r < g.n; r++) {
    const y = gridY(g, r);
    for (let c = 0; c < g.n; c++) {
      const x = gridX(g, c);
      const s = (x * x + y * y) / (4 * R * R); // tan^2 of half the angle from the pole
      const i = r * g.n + c;
      z[i] = ((R + g.h[i]) * (1 - s)) / (1 + s) - R;
    }
  }
  return z;
}

/** Ground distance between neighbouring cells at the grid's centre, metres (map spacing times the projection's scale there). */
export function groundCell(g: PolarGrid): number {
  const mid = (g.n - 1) / 2;
  return g.cellM * groundScale(gridX(g, mid), gridY(g, mid));
}

/**
 * Tangent-space normal map of the terrain, RGBA bytes, row 0 first: x along +column,
 * y along +row (the texture's u and v when the rows are uploaded in this order), z outwards.
 */
export function normalMap(g: PolarGrid): Uint8Array {
  const { n, h } = g;
  const out = new Uint8Array(n * n * 4);
  for (let r = 0; r < n; r++) {
    const ra = Math.max(0, r - 1), rb = Math.min(n - 1, r + 1);
    const y = gridY(g, r);
    for (let c = 0; c < n; c++) {
      const ca = Math.max(0, c - 1), cb = Math.min(n - 1, c + 1);
      const ground = g.cellM * groundScale(gridX(g, c), y);
      const du = (h[r * n + cb] - h[r * n + ca]) / ((cb - ca) * ground);
      const dv = (h[rb * n + c] - h[ra * n + c]) / ((rb - ra) * ground);
      const len = Math.hypot(du, dv, 1);
      const o = (r * n + c) * 4;
      out[o] = Math.round((-du / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((-dv / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  }
  return out;
}
