/**
 * Lunar south-pole water-ice science targets and surface distance lookup.
 *
 * Data: Lemelin et al. (2021), "Database of water ice-bearing permanently shaded
 * regions in the lunar south polar region", Zenodo doi:10.5281/zenodo.4646092,
 * CC BY 4.0. Packaged by scripts/build-ice-targets.py into
 * public/data/ice-targets/lemelin2021-psr.geojson (see its "lunyx" block).
 *
 * This module has no browser or three.js dependencies, so it runs under
 * `node --experimental-strip-types` for tests. Keep it that way.
 *
 * Geometry model: a sphere of radius MOON_RADIUS_KM (the source data's own
 * datum). Distances are great-circle distances, measured to the nearest point
 * of the mapped outline for areas and to the coordinate for points.
 * They are NOT traverse distances: they ignore topography, slope and
 * illumination. For slope-limited traverse distances, see the authors'
 * MIN_dist_* attributes.
 */

export const MOON_RADIUS_KM = 1737.4;

export const ICE_TARGETS_URL_PATH = 'data/ice-targets/lemelin2021-psr.geojson';

/** Degrees. lat north-positive; lon east-positive, -180..180. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Whether a target is a mapped area (polygon) or a single coordinate. */
export type TargetGeometryKind = 'area' | 'point';

/** Science objectives the authors flagged a region as best suited for. */
export interface IceObjectives {
  /** Sampling the highest concentration of volatiles. */
  highest: boolean;
  /** Characterising the lateral distribution of water ice. */
  lateral: boolean;
  /** Characterising the vertical distribution of volatiles. */
  vertical: boolean;
  /** Fastest recovery of a scientifically interesting sample. */
  fastest: boolean;
}

export interface IceTarget {
  /** Stable id, e.g. "lemelin2021-psr-23". */
  id: string;
  /** The authors' FID. */
  fid: number;
  /** Crater name, if the authors gave one (31 of 169 regions). */
  name: string | null;
  /** Display label: name, or "Unnamed PSR <FID>". */
  label: string;
  kind: TargetGeometryKind;
  /**
   * The authors' listed centre. Use it for labels only; for areas, distances
   * are measured to the outline. Check `flags` for 'center-outside-polygon'.
   */
  center: LatLon;
  /**
   * For areas: polygons, each [outer ring, ...holes], rings closed
   * (first vertex equals last). Empty for points.
   */
  polygons: LatLon[][][];
  /** The authors' PSR area (km²). The mapped outline is larger; see the layer notes. */
  areaKm2: number | null;
  objectives: IceObjectives;
  /** The authors' TOTAL_Obj: how many objectives the region is best suited for. */
  totalObjectives: number;
  /** Quality flags added by Lunyx, e.g. 'center-outside-polygon'. */
  flags: string[];
  /** Every published attribute, keyed by the original column name (blank cells are null). */
  properties: Record<string, string | number | null>;
}

export interface IceTargetLayer {
  targets: IceTarget[];
  attribution: {
    citation: string;
    paper: string;
    license: string;
    licenseUrl: string;
    sourceUrl: string;
  };
  /** The layer's own notes on geometry, buffers and data issues. */
  geometryNotes: string[];
  /** Processing steps applied to the source data. */
  changes: string[];
  units: Record<string, string>;
  columns: Record<string, string>;
}

export interface IceTargetDistance {
  target: IceTarget;
  /** Great-circle surface distance (km) on the reference sphere. 0 when inside an area. */
  distanceKm: number;
  /** True when the query point lies inside the area outline (always false for points). */
  inside: boolean;
  /** Closest point of the target: on the outline for areas, the coordinate for points. Equals the query when inside. */
  nearest: LatLon;
  /** What was measured, for display next to the number. */
  measuredTo: 'area-outline' | 'point';
  /** Short label with the geometric assumptions, suitable for a tooltip. */
  assumption: string;
}

export const DISTANCE_ASSUMPTIONS = {
  'area-outline':
    'Great-circle distance on a 1737.4 km sphere to the nearest edge of the mapped outline ' +
    '(0 inside). Straight-line surface distance, not a traverse: ignores terrain, slope and lighting.',
  point:
    'Great-circle distance on a 1737.4 km sphere to a single coordinate. Straight-line surface ' +
    'distance, not a traverse: ignores terrain, slope and lighting.',
} as const;

// ---------------------------------------------------------------- vector math

type V3 = [number, number, number];
const D2R = Math.PI / 180;

function toVec({ lat, lon }: LatLon): V3 {
  const φ = lat * D2R;
  const λ = lon * D2R;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}

function toLatLon(v: V3): LatLon {
  const n = Math.hypot(v[0], v[1], v[2]);
  return { lat: Math.asin(clamp(v[2] / n)) / D2R, lon: Math.atan2(v[1], v[0]) / D2R };
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / n, a[1] / n, a[2] / n];
};
const clamp = (x: number) => Math.max(-1, Math.min(1, x));

/** Central angle (rad) between unit vectors; atan2 form is accurate at small and large angles. */
function angle(a: V3, b: V3): number {
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b));
}

/** Great-circle distance (km) between two lat/lon points on the reference sphere. */
export function greatCircleKm(a: LatLon, b: LatLon): number {
  return angle(toVec(a), toVec(b)) * MOON_RADIUS_KM;
}

/** Closest point on the minor great-circle arc a→b to p, and its angular distance. */
function closestOnArc(p: V3, a: V3, b: V3): { q: V3; ang: number } {
  const n = cross(a, b);
  const nn = Math.hypot(n[0], n[1], n[2]);
  if (nn > 1e-15) {
    const u: V3 = [n[0] / nn, n[1] / nn, n[2] / nn];
    // Project p onto the arc's plane; it lies on the arc if it is between a and b.
    const s = dot(p, u);
    const proj: V3 = [p[0] - s * u[0], p[1] - s * u[1], p[2] - s * u[2]];
    if (Math.hypot(proj[0], proj[1], proj[2]) > 1e-15) {
      const q = norm(proj);
      if (dot(cross(a, q), u) >= 0 && dot(cross(q, b), u) >= 0) return { q, ang: angle(p, q) };
    }
  }
  const da = angle(p, a);
  const db = angle(p, b);
  return da <= db ? { q: a, ang: da } : { q: b, ang: db };
}

// ------------------------------------------------------- prepared geometries

interface Prepared {
  /** Unit vectors per ring (closed). */
  rings: V3[][];
  /** Gnomonic tangent point: great circles map to straight lines, so edge tests are exact. */
  centre: V3;
  e: V3;
  n: V3;
  /** Rings in gnomonic plane coordinates. */
  planar: [number, number][][];
  /** Angular radius (rad) from centre to the farthest vertex, for pruning. */
  radius: number;
}

const prepared = new WeakMap<IceTarget, Prepared>();

function gnomonic(p: V3, c: V3, e: V3, n: V3): [number, number] | null {
  const d = dot(p, c);
  if (d <= 1e-9) return null; // on or beyond the tangent hemisphere
  return [dot(p, e) / d, dot(p, n) / d];
}

function prepare(t: IceTarget): Prepared {
  let cached = prepared.get(t);
  if (cached) return cached;
  const rings = t.polygons.flat().map((r) => r.map(toVec));
  const sum: V3 = [0, 0, 0];
  let count = 0;
  for (const r of rings)
    for (const v of r) {
      sum[0] += v[0];
      sum[1] += v[1];
      sum[2] += v[2];
      count++;
    }
  const centre = count ? norm(sum) : toVec(t.center);
  const ref: V3 = Math.abs(centre[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e = norm(cross(ref, centre));
  const n = cross(centre, e);
  let radius = 0;
  for (const r of rings) for (const v of r) radius = Math.max(radius, angle(centre, v));
  if (radius >= Math.PI / 2 - 1e-6) throw new Error(`${t.id}: area spans a hemisphere; not supported`);
  const planar = rings.map((r) => r.map((v) => gnomonic(v, centre, e, n)!));
  cached = { rings, centre, e, n, planar, radius };
  prepared.set(t, cached);
  return cached;
}

/** Even-odd test across all rings (outer rings and holes) in the gnomonic plane. */
function insideArea(p: V3, g: Prepared): boolean {
  if (angle(p, g.centre) > g.radius) return false;
  const xy = gnomonic(p, g.centre, g.e, g.n);
  if (!xy) return false;
  const [x, y] = xy;
  let inside = false;
  for (const ring of g.planar) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ------------------------------------------------------------------- lookups

/** Surface distance from a lat/lon to one target. */
export function distanceToTarget(at: LatLon, target: IceTarget): IceTargetDistance {
  const p = toVec(at);
  if (target.kind === 'point') {
    return {
      target,
      distanceKm: angle(p, toVec(target.center)) * MOON_RADIUS_KM,
      inside: false,
      nearest: { ...target.center },
      measuredTo: 'point',
      assumption: DISTANCE_ASSUMPTIONS.point,
    };
  }
  const g = prepare(target);
  const base = { target, measuredTo: 'area-outline' as const, assumption: DISTANCE_ASSUMPTIONS['area-outline'] };
  if (insideArea(p, g)) return { ...base, distanceKm: 0, inside: true, nearest: { ...at } };
  let best = { q: g.rings[0][0], ang: Infinity };
  for (const r of g.rings)
    for (let i = 0; i + 1 < r.length; i++) {
      const c = closestOnArc(p, r[i], r[i + 1]);
      if (c.ang < best.ang) best = c;
    }
  return { ...base, distanceKm: best.ang * MOON_RADIUS_KM, inside: false, nearest: toLatLon(best.q) };
}

export interface NearestOptions {
  /** Max results (default 5). */
  limit?: number;
  /** Ignore targets farther than this (km). */
  maxKm?: number;
  /** Keep only targets passing this predicate. */
  filter?: (t: IceTarget) => boolean;
}

/** Targets sorted by surface distance from `at`, nearest first. */
export function nearestIceTargets(
  targets: readonly IceTarget[],
  at: LatLon,
  { limit = 5, maxKm = Infinity, filter }: NearestOptions = {},
): IceTargetDistance[] {
  const p = toVec(at);
  // Lower bound per target (centre distance minus radius) lets us skip exact work.
  const cands = targets
    .filter((t) => !filter || filter(t))
    .map((t) => {
      if (t.kind === 'point') return { t, lb: angle(p, toVec(t.center)) * MOON_RADIUS_KM };
      const g = prepare(t);
      return { t, lb: Math.max(0, angle(p, g.centre) - g.radius) * MOON_RADIUS_KM };
    })
    .sort((a, b) => a.lb - b.lb);
  const out: IceTargetDistance[] = [];
  for (const { t, lb } of cands) {
    const worst = out.length >= limit ? out[out.length - 1].distanceKm : maxKm;
    if (lb > worst) break;
    const d = distanceToTarget(at, t);
    if (d.distanceKm > maxKm) continue;
    out.push(d);
    out.sort((a, b) => a.distanceKm - b.distanceKm);
    if (out.length > limit) out.pop();
  }
  return out;
}

/** The targets whose outlines contain `at` (usually zero or one). */
export function targetsContaining(targets: readonly IceTarget[], at: LatLon): IceTarget[] {
  const p = toVec(at);
  return targets.filter((t) => t.kind === 'area' && insideArea(p, prepare(t)));
}

/** "1.23 km" / "850 m" / "inside", for UI. */
export function formatDistance(d: Pick<IceTargetDistance, 'distanceKm' | 'inside'>): string {
  if (d.inside) return 'inside';
  if (d.distanceKm < 1) return `${Math.round(d.distanceKm * 1000)} m`;
  if (d.distanceKm < 100) return `${d.distanceKm.toFixed(1)} km`;
  return `${Math.round(d.distanceKm)} km`;
}

// ------------------------------------------------------------------- loading

interface GeoJsonFeature {
  id?: string;
  properties: Record<string, string | number | null | string[]>;
  geometry:
    | { type: 'Polygon'; coordinates: number[][][] }
    | { type: 'MultiPolygon'; coordinates: number[][][][] }
    | { type: 'Point'; coordinates: number[] };
}

interface GeoJsonLayer {
  type: 'FeatureCollection';
  lunyx: {
    kind: string;
    citation: string;
    paper: string;
    license: string;
    licenseUrl: string;
    source: { record: string };
    geometryNotes: string[];
    changes: string[];
    units: Record<string, string>;
    columns: Record<string, string>;
  };
  features: GeoJsonFeature[];
}

const ring = (r: number[][]): LatLon[] => r.map(([lon, lat]) => ({ lat, lon }));
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Parse the packaged GeoJSON. Throws on anything unexpected rather than guessing. */
export function parseIceTargets(json: unknown): IceTargetLayer {
  const fc = json as GeoJsonLayer;
  if (fc?.type !== 'FeatureCollection' || !fc.lunyx || !Array.isArray(fc.features))
    throw new Error('ice targets: not a Lunyx FeatureCollection');
  const targets = fc.features.map((f): IceTarget => {
    const pr = f.properties;
    const g = f.geometry;
    let kind: TargetGeometryKind;
    let polygons: LatLon[][][] = [];
    if (g.type === 'Polygon') {
      kind = 'area';
      polygons = [g.coordinates.map(ring)];
    } else if (g.type === 'MultiPolygon') {
      kind = 'area';
      polygons = g.coordinates.map((p) => p.map(ring));
    } else if (g.type === 'Point') {
      kind = 'point';
    } else {
      throw new Error(`ice targets: unsupported geometry ${(g as { type: string }).type}`);
    }
    const fid = Number(pr.FID);
    const name = typeof pr.Name === 'string' && pr.Name.trim() ? pr.Name.trim() : null;
    const lat = num(pr.Latitude) ?? (g.type === 'Point' ? g.coordinates[1] : NaN);
    const lon = num(pr.Longitude) ?? (g.type === 'Point' ? g.coordinates[0] : NaN);
    const { lunyxFlags, ...rest } = pr;
    return {
      id: String(f.id ?? pr.id),
      fid,
      name,
      label: name ?? `Unnamed PSR ${fid}`,
      kind,
      center: { lat, lon },
      polygons,
      areaKm2: num(pr.Area_km2),
      objectives: {
        highest: pr.HIGHEST === 1,
        lateral: pr.LATERAL === 1,
        vertical: pr.VERTICAL === 1,
        fastest: pr.FASTEST === 1,
      },
      totalObjectives: num(pr.TOTAL_Obj) ?? 0,
      flags: Array.isArray(lunyxFlags) ? lunyxFlags : [],
      properties: rest as Record<string, string | number | null>,
    };
  });
  const m = fc.lunyx;
  return {
    targets,
    attribution: {
      citation: m.citation,
      paper: m.paper,
      license: m.license,
      licenseUrl: m.licenseUrl,
      sourceUrl: m.source.record,
    },
    geometryNotes: m.geometryNotes,
    changes: m.changes,
    units: m.units,
    columns: m.columns,
  };
}

/** Fetch and parse the packaged layer. `baseUrl` defaults to Vite's BASE_URL. */
export async function loadIceTargets(baseUrl?: string): Promise<IceTargetLayer> {
  const base = baseUrl ?? (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const res = await fetch(`${base}${ICE_TARGETS_URL_PATH}`);
  if (!res.ok) throw new Error(`${ICE_TARGETS_URL_PATH}: HTTP ${res.status}`);
  return parseIceTargets(await res.json());
}
