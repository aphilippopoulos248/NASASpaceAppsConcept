// Sun-directed terrain shadows for a height field. Pure math: no DOM, no three.js.
//
// For a Sun direction, one pass over a grid gives every node its "shadow ceiling": the
// height above which a point over that node sees the Sun past all terrain on the Sun's
// side. Marching from the edge nearest the Sun,
//     ceiling(p) = max(terrain(q), ceiling(q)) - distance(p, q) * tan(elevation)
// where q is the neighbouring point one grid step towards the Sun. A node is lit when its
// own height is above its ceiling.
//
// The Sun is a disc, so two ceilings are kept: one for its lower limb (the first part to be
// hidden) and one for its upper limb (the last). Ground above the first is fully lit, ground
// below the second is fully dark. In between, the ridge that hides the lower limb is a known
// distance away, which turns "how far the ground is below that ceiling" into the fraction of
// the solar disc still showing: the penumbra, which is tens of metres wide behind a far ridge.
//
// Heights are scene heights (metres above the site's horizontal plane, so the Moon's
// curvature is already in them) and the Sun's rays are parallel, so a ridge 100 km away
// shadows the ground exactly as it is drawn. Grids nest: a finer grid takes the ceiling at
// its Sun-side edges from the coarser grid around it, and the coarsest takes it from a
// smooth sphere (the Moon's limb beyond the modelled terrain).
import { DEG, discAreaAbove } from './skyMath';

/** "No terrain on the Sun's side": lower than any real height. Finite, so interpolation stays finite. */
export const NO_CEILING = -1e9;

export interface SweepField {
  /** Nodes per side. */
  n: number;
  /** Metres between nodes. */
  spacing: number;
  /** East / north offset of the grid's centre from the site, metres. */
  east0: number;
  north0: number;
  /** Scene height of every node, metres; index j * n + i with i east and j north. */
  y: Float32Array;
  /** Shadow ceiling for the Sun's lower limb (the higher of the two) and upper limb. */
  ceilLow: Float32Array;
  ceilUp: Float32Array;
  /** Horizontal distance to the terrain that sets the lower-limb ceiling, metres. */
  dist: Float32Array;
  /** Fraction of the solar disc that clears the terrain at every node, 0..255. */
  lit: Uint8Array;
}

export function createField(n: number, spacing: number, east0 = 0, north0 = 0): SweepField {
  const m = n * n;
  return { n, spacing, east0, north0, y: new Float32Array(m), ceilLow: new Float32Array(m), ceilUp: new Float32Array(m), dist: new Float32Array(m), lit: new Uint8Array(m) };
}

/** The smooth Moon beyond the modelled terrain, as a boundary for the coarsest grid. */
export interface Limb {
  /** Radius of the sphere, metres. */
  radius: number;
  /** Scene height of that sphere directly under the site (reference height minus the site's own height), metres. */
  height0: number;
}

function sampleField(p: SweepField, values: Float32Array, east: number, north: number, outside: number): number {
  const c = (p.n - 1) / 2;
  const fx = (east - p.east0) / p.spacing + c, fy = (north - p.north0) / p.spacing + c;
  if (!(fx >= 0 && fy >= 0 && fx <= p.n - 1 && fy <= p.n - 1)) return outside;
  const x = Math.min(p.n - 2, Math.floor(fx)), y = Math.min(p.n - 2, Math.floor(fy));
  const a = fx - x, b = fy - y, o = y * p.n + x;
  return (1 - b) * ((1 - a) * values[o] + a * values[o + 1]) + b * ((1 - a) * values[o + p.n] + a * values[o + p.n + 1]);
}

/**
 * Ceiling cast at (east, north) by a smooth sphere for a ray of elevation tangent `tanEl`
 * towards the unit direction (sx, sy). The sphere is treated as a paraboloid, which is
 * accurate to a few metres over the distances drawn.
 */
function limbCeiling(limb: Limb, east: number, north: number, sx: number, sy: number, tanEl: number): number {
  const u = east * sx + north * sy; // distance along the Sun's azimuth
  const v2 = east * east + north * north - u * u;
  const R = limb.radius;
  // The ray grazes the sphere a distance t* = -R tan(el) - u further towards the Sun.
  if (-R * tanEl - u > 0) return limb.height0 + 0.5 * R * tanEl * tanEl + u * tanEl - v2 / (2 * R);
  // Otherwise the sphere only falls away from here on: nothing beyond the grid can hide the Sun.
  return NO_CEILING;
}

/**
 * Fills `field.ceilLow`, `field.ceilUp` and `field.lit` for a Sun at the given azimuth and
 * elevation (degrees, centre of the disc) with the given angular radius.
 * `parent` is the coarser field around this one (already swept for the same Sun), or null
 * for the outermost field, which then uses `limb` if given.
 */
export function sweepSunlight(field: SweepField, sunAzDeg: number, sunElDeg: number, sunRadiusDeg: number, parent: SweepField | null, limb: Limb | null = null): void {
  const { n, spacing, y, ceilLow, ceilUp, dist, lit } = field;
  const az = sunAzDeg * DEG;
  const sx = Math.sin(az), sy = Math.cos(az); // towards the Sun, in (east, north)
  const alongEast = Math.abs(sx) >= Math.abs(sy);
  const major = alongEast ? sx : sy, minor = alongEast ? sy : sx;
  const step = major >= 0 ? 1 : -1; // index step towards the Sun along the major axis
  const shift = minor / Math.abs(major); // sideways index shift of that step
  const run = spacing / Math.abs(major); // its horizontal length
  const clampEl = (e: number) => Math.max(-89.9, Math.min(89.9, e));
  const tanLow = Math.tan(clampEl(sunElDeg - sunRadiusDeg) * DEG), tanUp = Math.tan(clampEl(sunElDeg + sunRadiusDeg) * DEG);
  const dropLow = run * tanLow, dropUp = run * tanUp;
  /** Height on the ground that the Sun's diameter spans per metre of distance from the terrain hiding it. */
  const span = Math.max(1e-9, tanUp - tanLow);
  const majorStride = alongEast ? 1 : n, minorStride = alongEast ? n : 1;
  const c = (n - 1) / 2;

  for (let k = 0; k < n; k++) {
    const a = step > 0 ? n - 1 - k : k; // rows in order, starting at the edge nearest the Sun
    for (let b = 0; b < n; b++) {
      const node = a * majorStride + b * minorStride;
      const bb = b + shift;
      let low: number, up: number, far: number;
      if (k > 0 && bb >= 0 && bb <= n - 1) {
        const b0 = Math.min(n - 2, Math.floor(bb)), t = bb - b0;
        const p0 = (a + step) * majorStride + b0 * minorStride, p1 = p0 + minorStride;
        const y0 = y[p0], y1 = y[p1];
        // Whichever is higher at the neighbour: its own ground (a new ridge, distance zero) or the ceiling it inherited.
        const own0 = y0 >= ceilLow[p0], own1 = y1 >= ceilLow[p1];
        const l0 = own0 ? y0 : ceilLow[p0], l1 = own1 ? y1 : ceilLow[p1];
        const d0 = own0 ? 0 : dist[p0], d1 = own1 ? 0 : dist[p1];
        const u0 = y0 > ceilUp[p0] ? y0 : ceilUp[p0], u1 = y1 > ceilUp[p1] ? y1 : ceilUp[p1];
        low = l0 + (l1 - l0) * t - dropLow;
        up = u0 + (u1 - u0) * t - dropUp;
        far = d0 + (d1 - d0) * t + run;
      } else {
        // The neighbour towards the Sun lies outside this grid.
        const i = alongEast ? a : b, j = alongEast ? b : a;
        const east = field.east0 + (i - c) * spacing, north = field.north0 + (j - c) * spacing;
        if (parent) {
          low = sampleField(parent, parent.ceilLow, east, north, NO_CEILING);
          up = sampleField(parent, parent.ceilUp, east, north, NO_CEILING);
          far = sampleField(parent, parent.dist, east, north, 0);
        } else if (limb) {
          low = limbCeiling(limb, east, north, sx, sy, tanLow);
          up = limbCeiling(limb, east, north, sx, sy, tanUp);
          // The grazing point on the sphere, when there is one.
          far = Math.max(run, -limb.radius * tanLow - (east * sx + north * sy));
        } else {
          low = up = NO_CEILING;
          far = 0;
        }
      }
      ceilLow[node] = low;
      ceilUp[node] = up;
      dist[node] = far;
      const h = y[node];
      if (h >= low) lit[node] = 255;
      else if (h <= up) lit[node] = 0;
      // Part of the disc shows: the share of its vertical diameter above the hiding terrain, as an area.
      else lit[node] = Math.round(discAreaAbove(1 - (low - h) / (far * span)) * 255);
    }
  }
}

/** Sunlit fraction (0..1) at a point of a swept field, interpolated between nodes; 1 outside the field. */
export function litAt(field: SweepField, east: number, north: number): number {
  const c = (field.n - 1) / 2;
  const fx = (east - field.east0) / field.spacing + c, fy = (north - field.north0) / field.spacing + c;
  if (!(fx >= 0 && fy >= 0 && fx <= field.n - 1 && fy <= field.n - 1)) return 1;
  const x = Math.min(field.n - 2, Math.floor(fx)), yy = Math.min(field.n - 2, Math.floor(fy));
  const a = fx - x, b = fy - yy, o = yy * field.n + x, l = field.lit;
  return ((1 - b) * ((1 - a) * l[o] + a * l[o + 1]) + b * ((1 - a) * l[o + field.n] + a * l[o + field.n + 1])) / 255;
}
