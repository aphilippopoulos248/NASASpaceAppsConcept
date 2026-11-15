// Landing-region terrain metrics for the decision engine (decision D-17, task T-72).
//
// The landing region is the disc of `radiusM` around a centre. It is measured on the finest
// grid of the stack that has data over all of it, at that grid's own samples (nothing is
// resampled, so no interpolation smooths the ground):
//   - local slopes: one per grid cell (2 x 2 neighbouring samples) whose centre lies in the
//     region, the tilt of the least-squares plane through its four corners, so each one is
//     measured across one grid spacing;
//   - slopeDeg: the 95th percentile of those local slopes, or the steepest of them when there
//     are fewer than PERCENTILE_MIN_SLOPES (a 95th percentile of a handful is its maximum);
//     null when the region is narrower than one grid spacing;
//   - roughnessM: the RMS height difference between the samples inside the region and their
//     least-squares plane, with the plane's three parameters taken out (sqrt(RSS / (n - 3))),
//     only on grids of ROUGHNESS_MAX_SPACING_M or finer and from ROUGHNESS_MIN_SAMPLES or more;
//   - hazardFraction: the share of the local slopes steeper than the profile's limit.
// What the grid cannot support is null, and `notes` says why. Notes come in a fixed order:
// what the region was measured on, then "Slope: ...", "Roughness: ...", the share over the
// limit (when there is a limit), and what the grid's spacing hides.

import type { LatLon, SiteRef } from '../core/types';
import { loadTerrainFor } from './api';
import { localOffset, polarXY, R_MOON_M } from './geo';
import type { HeightGridDescriptor, HeightSource, RegionTerrain, TerrainStack } from './types';

/**
 * Coarsest grid spacing roughness is reported on, metres. It separates the survey grids
 * bundled with Lunyx (the 3 m LROC models, the 40 and 80 m LOLA polar grids, the 60 m site
 * windows) from the regional ones (160 m, 480 m, the 1.9 km whole-Moon grid). On those, a
 * landing region of a few hundred metres holds a handful of samples at most, and every crater
 * or ridge narrower than two samples (320 m and more) is averaged away, so a scatter of heights
 * about a plane says nothing about the hazards of landing there.
 */
export const ROUGHNESS_MAX_SPACING_M = 100;
/** Fewest samples inside the region for a roughness: the plane takes three, which leaves four to measure the scatter with. */
export const ROUGHNESS_MIN_SAMPLES = 7;
/** Fewest local slopes for a 95th percentile; with fewer, the steepest one is the region's slope. */
export const PERCENTILE_MIN_SLOPES = 20;
/** Largest landing region measured, metres of radius (it bounds the work on the finest grids). */
export const MAX_RADIUS_M = 20_000;

const DEG = Math.PI / 180;

/** One grid's samples around the region. Positions are ground metres from the region's centre; heights are NaN where the grid has none. */
interface Patch {
  cols: number;
  rows: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Distance between neighbouring samples, metres: the larger of the two directions. */
  spacingM: number;
  /** The cell that contains the centre (its lower-index corner), in patch indices. */
  centreCol: number;
  centreRow: number;
  /** Distance from the centre to the edge of the grid, metres (Infinity for a whole-Moon grid). */
  edgeM: number;
  /** The region runs past the edge of the grid. */
  offGrid: boolean;
  /** Set for a regular lattice (window and polar grids): ground metres from one sample to the next along a row and along a column. */
  step?: { x: number; y: number };
  /** The last column repeats the first (a whole-Moon grid closing the circle round a pole): it makes cells, not samples. */
  repeatsFirstColumn?: boolean;
}

/** Samples of a square east/north window (azimuthal equidistant about its own centre). */
function localPatch(d: Extract<HeightGridDescriptor, { kind: 'local' }>, centre: LatLon, reachM: number, radiusM: number): Patch {
  const { eastM, northM } = localOffset(d.lat0, d.lon0, centre.lat, centre.lon);
  const h = d.spacingM;
  const c = (d.n - 1) / 2;
  const half = c * h;
  return gridPatch({
    fx: eastM / h + c,
    fy: northM / h + c,
    stepX: h,
    stepY: h,
    reachM,
    radiusM,
    size: [d.n, d.n],
    edgeM: half - Math.max(Math.abs(eastM), Math.abs(northM)),
    height: (i, j) => d.data[j * d.n + i],
  });
}

/** Samples of a polar stereographic grid. Map distances are scaled to the ground by the projection's scale at the centre. */
function polarPatch(d: Extract<HeightGridDescriptor, { kind: 'polar' }>, centre: LatLon, reachM: number, radiusM: number): Patch {
  const { x, y } = polarXY(d.pole, centre.lat, centre.lon);
  // Stereographic, true scale at the pole: map metres per ground metre.
  const k = 1 + (Math.hypot(x, y) / (2 * R_MOON_M)) ** 2;
  const m = d.metresPerPx;
  const c = d.size / 2 - 0.5;
  const half = ((d.size - 1) / 2) * m;
  const hasNodata = d.nodata !== undefined;
  return gridPatch({
    // Sample = c + x / m; line = c - y / m (geo.polarXY). Line j runs against y, so the patch's rows are mirrored: positions below say where each one is.
    fx: c + x / m,
    fy: c - y / m,
    stepX: m / k,
    stepY: -m / k,
    reachM,
    radiusM,
    size: [d.size, d.size],
    edgeM: (half - Math.max(Math.abs(x), Math.abs(y))) / k,
    height: (i, j) => {
      const raw = d.data[j * d.size + i];
      return hasNodata && raw === d.nodata ? NaN : raw * d.scale + d.offset;
    },
  });
}

/**
 * The samples around fractional grid position (fx, fy) of a grid laid out as a regular lattice
 * of `stepX` by `stepY` ground metres: everything within `reachM`, off-grid samples as NaN.
 */
function gridPatch(g: {
  fx: number;
  fy: number;
  stepX: number;
  stepY: number;
  reachM: number;
  radiusM: number;
  size: [number, number];
  edgeM: number;
  height: (i: number, j: number) => number;
}): Patch {
  const ax = Math.abs(g.stepX), ay = Math.abs(g.stepY);
  const i0 = Math.floor(g.fx - g.reachM / ax), i1 = Math.ceil(g.fx + g.reachM / ax);
  const j0 = Math.floor(g.fy - g.reachM / ay), j1 = Math.ceil(g.fy + g.reachM / ay);
  const cols = i1 - i0 + 1, rows = j1 - j0 + 1;
  const x = new Float64Array(cols * rows), y = new Float64Array(cols * rows), z = new Float64Array(cols * rows);
  const [nx, ny] = g.size;
  let offGrid = false;
  for (let r = 0; r < rows; r++) {
    const j = j0 + r;
    for (let q = 0; q < cols; q++) {
      const i = i0 + q, k = r * cols + q;
      x[k] = (i - g.fx) * g.stepX;
      y[k] = (j - g.fy) * g.stepY;
      const inside = i >= 0 && j >= 0 && i < nx && j < ny;
      z[k] = inside ? g.height(i, j) : NaN;
      if (!inside && x[k] * x[k] + y[k] * y[k] <= g.radiusM * g.radiusM * (1 + 1e-9)) offGrid = true;
    }
  }
  return { cols, rows, x, y, z, spacingM: Math.max(ax, ay), centreCol: Math.floor(g.fx) - i0, centreRow: Math.floor(g.fy) - j0, edgeM: g.edgeM, offGrid, step: { x: ax, y: ay } };
}

/** Samples of an equirectangular grid. Positions are exact (azimuthal equidistant about the centre), so cells near a pole are as narrow as they really are. */
function equirectPatch(d: Extract<HeightGridDescriptor, { kind: 'equirect' }>, centre: LatLon, reachM: number, radiusM: number): Patch {
  const lonSpan = d.lonE - d.lonW;
  const full = lonSpan >= 360 - 1e-9;
  const pxX = d.width / lonSpan, pxY = d.height / (d.latN - d.latS);
  const hasNodata = d.nodata !== undefined;
  const reachDeg = reachM / R_MOON_M / DEG;
  const fy = (d.latN - centre.lat) * pxY - 0.5;
  let fx = (((centre.lon - d.lonW) % 360) + 360) % 360;
  fx = fx * pxX - 0.5;
  const j0 = Math.max(0, Math.floor(fy - reachDeg * pxY)), j1 = Math.min(d.height - 1, Math.ceil(fy + reachDeg * pxY));
  const polewards = Math.min(89.999, Math.abs(centre.lat) + reachDeg);
  const aroundPole = Math.abs(centre.lat) + reachDeg >= 90 - 0.5 / pxY;
  const spanPx = aroundPole ? Infinity : Math.ceil((reachDeg / Math.cos(polewards * DEG)) * pxX) + 1;
  // Around a pole (or wider than the grid) the region takes in every meridian: all columns, the first repeated at the end so cells close the circle.
  const allColumns = full && 2 * spanPx + 2 >= d.width;
  let i0: number, cols: number;
  if (allColumns) {
    i0 = 0;
    cols = d.width + 1;
  } else if (full) {
    i0 = Math.floor(fx) - spanPx;
    cols = 2 * spanPx + 2;
  } else {
    // One column of margin past each edge, so a region that runs off the grid is noticed.
    i0 = Math.max(-1, Math.floor(fx) - spanPx);
    cols = Math.min(d.width, Math.floor(fx) + spanPx + 1) - i0 + 1;
  }
  const rows = Math.max(0, j1 - j0 + 1);
  const x = new Float64Array(cols * rows), y = new Float64Array(cols * rows), z = new Float64Array(cols * rows);
  let offGrid = false;
  for (let r = 0; r < rows; r++) {
    const j = j0 + r;
    const lat = d.latN - (j + 0.5) / pxY;
    for (let q = 0; q < cols; q++) {
      let i = i0 + q;
      if (full) i = ((i % d.width) + d.width) % d.width;
      const k = r * cols + q;
      const lon = d.lonW + (i + 0.5) / pxX;
      const p = localOffset(centre.lat, centre.lon, lat, lon);
      x[k] = p.eastM;
      y[k] = p.northM;
      const inside = i >= 0 && i < d.width;
      if (!inside) {
        z[k] = NaN;
        if (p.eastM * p.eastM + p.northM * p.northM <= radiusM * radiusM) offGrid = true;
        continue;
      }
      const raw = d.data[j * d.width + i];
      z[k] = hasNodata && raw === d.nodata ? NaN : raw * d.scale + d.offset;
    }
  }
  // A grid that stops short of a pole, or of the region in latitude, does not cover it.
  const latEdge = Math.min(d.latN >= 90 - 1e-9 ? Infinity : d.latN - centre.lat, d.latS <= -90 + 1e-9 ? Infinity : centre.lat - d.latS) * DEG * R_MOON_M;
  if (latEdge < radiusM) offGrid = true;
  const spacingY = (DEG / pxY) * R_MOON_M;
  const spacingX = (DEG / pxX) * R_MOON_M * Math.cos(centre.lat * DEG);
  const centreCol = allColumns ? ((Math.floor(fx) % d.width) + d.width) % d.width : Math.floor(fx) - i0;
  // Within half a pixel of a pole the centre is past the last row of samples: the last cells stand for it.
  const centreRow = Math.min(Math.max(Math.floor(fy) - j0, 0), Math.max(0, rows - 2));
  return { cols, rows, x, y, z, spacingM: Math.max(spacingX, spacingY), centreCol, centreRow, edgeM: full ? Infinity : latEdge, offGrid, repeatsFirstColumn: allColumns };
}

function patchOf(source: HeightSource, centre: LatLon, radiusM: number): Patch | null {
  const d = source.descriptor;
  // The cells used reach at most 1.5 spacings past the region: two spacings of margin.
  switch (d.kind) {
    case 'local':
      return localPatch(d, centre, radiusM + 2 * d.spacingM, radiusM);
    case 'polar':
      return polarPatch(d, centre, radiusM + 2 * d.metresPerPx, radiusM);
    case 'equirect':
      return equirectPatch(d, centre, radiusM + 2 * ((DEG * (d.latN - d.latS)) / d.height) * R_MOON_M, radiusM);
    default:
      return null;
  }
}

/** The patch covers the region: every sample inside it has a height, and so do the four around the centre. */
function covers(p: Patch, radiusM: number): boolean {
  if (p.offGrid) return false;
  const r2 = radiusM * radiusM * (1 + 1e-9);
  for (let k = 0; k < p.z.length; k++) if (p.x[k] * p.x[k] + p.y[k] * p.y[k] <= r2 && !Number.isFinite(p.z[k])) return false;
  const { centreCol: q, centreRow: r, cols } = p;
  if (q < 0 || r < 0 || q + 1 >= cols || r + 1 >= p.rows) return false;
  const k = r * cols + q;
  return [k, k + 1, k + cols, k + cols + 1].every((i) => Number.isFinite(p.z[i]));
}

/** Least-squares plane z = a + b x + c y through the given samples: its gradient (b, c) and the residual sum of squares, or null when the points do not span a plane. */
function fitPlane(p: Patch, idx: ArrayLike<number>): { gx: number; gy: number; rss: number } | null {
  const n = idx.length;
  if (n < 3) return null;
  let mx = 0, my = 0, mz = 0;
  for (let t = 0; t < n; t++) {
    const k = idx[t];
    mx += p.x[k];
    my += p.y[k];
    mz += p.z[k];
  }
  mx /= n;
  my /= n;
  mz /= n;
  let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, szz = 0;
  for (let t = 0; t < n; t++) {
    const k = idx[t];
    const dx = p.x[k] - mx, dy = p.y[k] - my, dz = p.z[k] - mz;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    sxz += dx * dz;
    syz += dy * dz;
    szz += dz * dz;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-12 * (sxx + syy) * (sxx + syy))) return null;
  const gx = (sxz * syy - syz * sxy) / det;
  const gy = (syz * sxx - sxz * sxy) / det;
  return { gx, gy, rss: Math.max(0, szz - gx * sxz - gy * syz) };
}

interface Measured {
  samples: number;
  /** Local slopes, degrees, ascending. */
  cellSlopes: Float64Array;
  plane: { tiltDeg: number; rss: number } | null;
}

function measure(p: Patch, radiusM: number): Measured {
  const r2 = radiusM * radiusM * (1 + 1e-9);
  const inside: number[] = [];
  const sampleCols = p.repeatsFirstColumn ? p.cols - 1 : p.cols;
  for (let r = 0; r < p.rows; r++) {
    for (let q = 0; q < sampleCols; q++) {
      const k = r * p.cols + q;
      if (p.x[k] * p.x[k] + p.y[k] * p.y[k] <= r2) inside.push(k);
    }
  }
  const fit = fitPlane(p, inside);
  // Cells whose centre lies in the region; a region narrower than a cell takes the cells around its centre.
  const reach = Math.max(radiusM, (p.spacingM / Math.SQRT2) * (1 + 1e-9));
  const cr2 = reach * reach;
  const slopes: number[] = [];
  const { x, y, z, cols } = p;
  const corner = [0, 0, 0, 0];
  for (let r = 0; r + 1 < p.rows; r++) {
    for (let q = 0; q + 1 < cols; q++) {
      const k00 = r * cols + q, k10 = k00 + 1, k01 = k00 + cols, k11 = k01 + 1;
      const z00 = z[k00], z10 = z[k10], z01 = z[k01], z11 = z[k11];
      // NaN anywhere makes the sum NaN: a cell with a missing corner is left out.
      if (!Number.isFinite(z00 + z10 + z01 + z11)) continue;
      const cx = (x[k00] + x[k10] + x[k01] + x[k11]) / 4, cy = (y[k00] + y[k10] + y[k01] + y[k11]) / 4;
      if (cx * cx + cy * cy > cr2) continue;
      let gx: number, gy: number;
      if (p.step) {
        // On a regular lattice the plane through the four corners has the mean of the two edge differences as its gradient.
        gx = (z10 - z00 + z11 - z01) / (2 * p.step.x);
        gy = (z01 - z00 + z11 - z10) / (2 * p.step.y);
      } else {
        corner[0] = k00;
        corner[1] = k10;
        corner[2] = k01;
        corner[3] = k11;
        const g = fitPlane(p, corner);
        if (!g) continue;
        gx = g.gx;
        gy = g.gy;
      }
      slopes.push(Math.atan(Math.sqrt(gx * gx + gy * gy)) / DEG);
    }
  }
  const cellSlopes = Float64Array.from(slopes).sort();
  return { samples: inside.length, cellSlopes, plane: fit && { tiltDeg: Math.atan(Math.hypot(fit.gx, fit.gy)) / DEG, rss: fit.rss } };
}

// ---------------------------------------------------------------- words

const metres = (m: number): string => {
  if (m >= 9950) return `${Math.round(m / 1000)} km`;
  if (m >= 995) return `${(m / 1000).toFixed(1)} km`;
  if (m >= 9.95) return `${Math.round(m)} m`;
  return `${Number(m.toFixed(1))} m`;
};
const deg = (v: number): string => `${v.toFixed(1)}°`;
const height = (m: number): string => `${m < 1 ? m.toFixed(2) : m < 100 ? m.toFixed(1) : Math.round(m)} m`;
const pct = (f: number): string => (f > 0 && f < 0.001 ? 'under 0.1 %' : `${Number((f * 100).toFixed(f < 0.1 ? 1 : 0))} %`);

/** What the grid's spacing hides, in words. */
function resolutionNote(source: HeightSource, spacingM: number, slopeMeasured: boolean): string {
  const s = metres(spacingM), twice = metres(2 * spacingM);
  const native = source.resolutionM > spacingM * 1.05 ? ` The model's own resolution is ${metres(source.resolutionM)}, so at ${s} spacing it is interpolated and local slopes across one cell are smoothed.` : '';
  if (spacingM <= 10) return `At ${s} spacing, boulders and craters narrower than about ${twice} are not resolved, so a hazard at the scale of a lander can still hide in a region that reads smooth.${native}`;
  if (spacingM <= ROUGHNESS_MAX_SPACING_M) return `At ${s} spacing, metre-scale rocks and craters are invisible: the slope and roughness describe the ground at the scale of ${twice} and more, not under a lander's feet. The 3 m LROC models at many catalogued sites resolve more.${native}`;
  return `At ${s} spacing everything narrower than about ${twice} is averaged away, craters, boulders and steep crater walls included${slopeMeasured ? ': the slope describes the lie of the land, not the hazards of landing on it' : ''}.${native}`;
}

// ---------------------------------------------------------------- entry points

function checkInputs(centre: LatLon, radiusM: number, slopeLimitDeg: number | null): void {
  if (!Number.isFinite(centre.lat) || !Number.isFinite(centre.lon) || Math.abs(centre.lat) > 90) throw new RangeError(`Landing region: bad centre ${centre.lat}, ${centre.lon}.`);
  if (!(Number.isFinite(radiusM) && radiusM > 0 && radiusM <= MAX_RADIUS_M)) throw new RangeError(`Landing region: the radius must be more than 0 and at most ${MAX_RADIUS_M} m (got ${radiusM}).`);
  if (slopeLimitDeg !== null && !(Number.isFinite(slopeLimitDeg) && slopeLimitDeg >= 0 && slopeLimitDeg < 90)) throw new RangeError(`Landing region: the slope limit must be from 0 to under 90 degrees, or null (got ${slopeLimitDeg}).`);
}

/**
 * Slope and roughness over the disc of `radiusM` around `center`, from the finest grid of `stack`
 * that covers the whole disc. Pure given the stack. Values the grid cannot support are null, with
 * the reason in `notes` (e.g. roughness on a 1.9 km grid). `slopeLimitDeg` only feeds hazardFraction.
 * Throws a RangeError for a radius outside (0, MAX_RADIUS_M] or a limit outside [0, 90), and an
 * Error when no grid of the stack has data over the whole region.
 */
export function regionTerrainMetrics(stack: TerrainStack, center: LatLon, radiusM: number, slopeLimitDeg: number | null): RegionTerrain {
  checkInputs(center, radiusM, slopeLimitDeg);
  // Finest first (the stack's own order between equals).
  const sources = stack.sources.map((s, k) => ({ s, k })).sort((a, b) => a.s.resolutionM - b.s.resolutionM || a.k - b.k).map((e) => e.s);
  const passedOver: string[] = [];
  for (const source of sources) {
    const patch = patchOf(source, center, radiusM);
    if (!patch) continue;
    if (!covers(patch, radiusM)) {
      if (source.covers(center.lat, center.lon)) {
        const why = patch.offGrid ? (Number.isFinite(patch.edgeM) && patch.edgeM > 0 ? ` (it ends about ${metres(patch.edgeM)} from the centre)` : '') : ' (it has no data over part of it)';
        passedOver.push(`${source.name} covers only part of the region${why}`);
      }
      continue;
    }
    return describe(source, patch, measure(patch, radiusM), center, radiusM, slopeLimitDeg, passedOver);
  }
  throw new Error(`No elevation grid covers the whole landing region (${metres(radiusM)} around ${center.lat.toFixed(4)}, ${center.lon.toFixed(4)}).`);
}

function describe(source: HeightSource, patch: Patch, m: Measured, center: LatLon, radiusM: number, slopeLimitDeg: number | null, passedOver: string[]): RegionTerrain {
  const h = patch.spacingM;
  const notes: string[] = [];
  notes.push(`Measured on ${source.name} (${metres(h)} spacing): ${m.samples} sample${m.samples === 1 ? '' : 's'} within ${metres(radiusM)} of the centre.` + (passedOver.length ? ` Finer data here does not reach over the whole region: ${passedOver.join('; ')}.` : ''));

  // Slope.
  const cells = m.cellSlopes;
  let slopeDeg: number | null = null;
  const tilt = m.plane ? ` The region's best-fit plane tilts ${deg(m.plane.tiltDeg)}.` : '';
  if (2 * radiusM < h) {
    notes.push(`Slope: not measured. The region (${metres(2 * radiusM)} across) is narrower than one spacing of the finest grid that covers it (${metres(h)}), so that grid cannot show a slope inside it.`);
  } else if (cells.length === 0) {
    notes.push(`Slope: not measured. No complete cell of the ${metres(h)} grid lies in the region.`);
  } else if (cells.length >= PERCENTILE_MIN_SLOPES) {
    slopeDeg = cells[Math.ceil(0.95 * cells.length) - 1];
    notes.push(`Slope: ${deg(slopeDeg)}, the 95th percentile of ${cells.length} local slopes, each measured across one ${metres(h)} grid cell; the steepest is ${deg(cells[cells.length - 1])}.${tilt}`);
  } else {
    slopeDeg = cells[cells.length - 1];
    notes.push(`Slope: ${deg(slopeDeg)}, the steepest of ${cells.length} local slope${cells.length === 1 ? '' : 's'} (too few for a percentile), each measured across one ${metres(h)} grid cell.${tilt}`);
  }

  // Roughness.
  let roughnessM: number | null = null;
  if (h > ROUGHNESS_MAX_SPACING_M) {
    notes.push(`Roughness: not measured. The finest grid that covers the region has ${metres(h)} spacing, coarser than the ${ROUGHNESS_MAX_SPACING_M} m limit for this measure: it averages away craters and ridges narrower than about ${metres(2 * h)}, so a scatter of its heights would say nothing about the hazards of landing.`);
  } else if (m.samples < ROUGHNESS_MIN_SAMPLES || !m.plane) {
    notes.push(`Roughness: not measured. The region holds ${m.samples} sample${m.samples === 1 ? '' : 's'} of the ${metres(h)} grid, too few to measure a scatter about a fitted plane (at least ${ROUGHNESS_MIN_SAMPLES} are needed).`);
  } else {
    roughnessM = Math.sqrt(m.plane.rss / (m.samples - 3));
    notes.push(`Roughness: ${height(roughnessM)}, the RMS height difference between the ${m.samples} samples and the region's best-fit plane. It takes in relief from the ${metres(h)} scale up to the size of the region, the model's own height noise included.`);
  }

  // Share of the local slopes over the limit.
  let hazardFraction: number | null = null;
  if (slopeLimitDeg !== null && slopeDeg !== null) {
    let over = 0;
    for (const s of cells) if (s > slopeLimitDeg) over++;
    hazardFraction = over / cells.length;
    notes.push(`${pct(hazardFraction)} of the local slopes (${over} of ${cells.length}) are steeper than the ${Number(slopeLimitDeg.toFixed(2))}° limit.`);
  }

  notes.push(resolutionNote(source, h, slopeDeg !== null));
  return { lat: center.lat, lon: center.lon, radiusM, demName: source.name, gridSpacingM: h, samples: m.samples, slopeDeg, roughnessM, hazardFraction, notes };
}

/**
 * Loads the terrain stack for the site (as the analysis does) and measures its landing region.
 * When part of the stack failed to load (e.g. the elevation server could not build a window),
 * that note is added, since the region may then rest on a coarser grid.
 */
export async function loadRegionTerrain(site: SiteRef, radiusM: number, slopeLimitDeg: number | null): Promise<RegionTerrain> {
  checkInputs(site, radiusM, slopeLimitDeg);
  const stack = await loadTerrainFor(site);
  const region = regionTerrainMetrics(stack, site, radiusM, slopeLimitDeg);
  const failures = stack.notes.filter((n) => /could not/i.test(n));
  return failures.length ? { ...region, notes: [...region.notes, ...failures] } : region;
}
