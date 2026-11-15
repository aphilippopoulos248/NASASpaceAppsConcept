import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { landingColor, latLonToVec3 } from '../data/landings';
import { DEFAULT_AREA_SCALE } from './globe/displayState';
import type { Marker } from './markers';

// The area explored at each landing site, from scripts/fetch-site-areas.mjs (see docs/DATA_SOURCES.md).

export interface SiteArea {
  /** Convex polygon, [latitude, longitude] in degrees. */
  polygon: [number, number][];
  extentM: number;
  areaM2: number;
  located: boolean;
  sources: string[];
  note: string | null;
}

let areasLoad: Promise<Map<string, SiteArea>> | null = null;

/** The explored areas, fetched once and shared by the globe layer and the site card. */
export function loadSiteAreas(): Promise<Map<string, SiteArea>> {
  return (areasLoad ??= fetchSiteAreas());
}

async function fetchSiteAreas(): Promise<Map<string, SiteArea>> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/sources/site-areas.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const file = (await res.json()) as { areas: Record<string, SiteArea> };
    return new Map(Object.entries(file.areas));
  } catch (err) {
    console.warn('Site areas unavailable', err);
    return new Map();
  }
}

/** "about 1.6 km across", "about 140 m across" */
export function describeExtent(a: SiteArea): string {
  return a.extentM >= 1000 ? `about ${(a.extentM / 1000).toFixed(1)} km across` : `about ${Math.round(a.extentM / 10) * 10} m across`;
}

/** Lift above the drawn surface, Moon radii (the markers sit at 0.0002). */
const LIFT = 0.0001;

const DEG = Math.PI / 180;

/** Enlarges a polygon about its centre by `scale`, working in local east/north distances. */
function enlarge(polygon: [number, number][], scale: number): [number, number][] {
  let cLat = 0, cLon = 0;
  for (const [lat, lon] of polygon) { cLat += lat; cLon += lon; }
  cLat /= polygon.length;
  cLon /= polygon.length;
  const k = Math.cos(cLat * DEG);
  return polygon.map(([lat, lon]) => [cLat + (lat - cLat) * scale, cLon + ((lon - cLon) * k * scale) / k]);
}

/** Pieces per fan-triangle edge: about one per 8 km of the drawn area, so wide areas follow the curve and relief. */
function piecesFor(polygon: [number, number][]): number {
  let lat0 = Infinity, lat1 = -Infinity, lon0 = Infinity, lon1 = -Infinity;
  for (const [lat, lon] of polygon) {
    lat0 = Math.min(lat0, lat); lat1 = Math.max(lat1, lat);
    lon0 = Math.min(lon0, lon); lon1 = Math.max(lon1, lon);
  }
  const km = Math.max(lat1 - lat0, (lon1 - lon0) * Math.cos(((lat0 + lat1) / 2) * DEG)) * DEG * 1737.4;
  return Math.max(1, Math.min(16, Math.ceil(km / 8)));
}

/** Vertices kept as directions and lat/lon, so they can be put back on the surface when the relief changes. */
class Draped {
  readonly position: BufferAttribute;
  private readonly dirs: Float32Array;
  private readonly latLon: Float32Array;

  constructor(points: Vector3[]) {
    this.dirs = new Float32Array(points.length * 3);
    this.latLon = new Float32Array(points.length * 2);
    points.forEach((p, i) => {
      const d = p.clone().normalize();
      this.dirs.set([d.x, d.y, d.z], i * 3);
      // Inverse of latLonToVec3: +X sub-Earth, +Y north, east = -Z.
      this.latLon[i * 2] = Math.asin(Math.max(-1, Math.min(1, d.y))) / DEG;
      this.latLon[i * 2 + 1] = Math.atan2(-d.z, d.x) / DEG;
    });
    this.position = new BufferAttribute(new Float32Array(points.length * 3), 3);
    this.place(() => 1);
  }

  place(radius: (lat: number, lon: number) => number): void {
    const out = this.position.array as Float32Array;
    for (let i = 0; i < this.latLon.length / 2; i++) {
      const r = radius(this.latLon[i * 2], this.latLon[i * 2 + 1]) + LIFT;
      out[i * 3] = this.dirs[i * 3] * r;
      out[i * 3 + 1] = this.dirs[i * 3 + 1] * r;
      out[i * 3 + 2] = this.dirs[i * 3 + 2] * r;
    }
    this.position.needsUpdate = true;
  }
}

/**
 * Each site's explored area drawn on the globe in its country's colour: a translucent fill with a solid
 * outline, enlarged `scale` times (in width) about its centre so it reads at globe scale; the data, and
 * the size quoted in the info card, stay true. Like the markers it is drawn over the terrain, on the
 * drawn (relief-exaggerated) surface: see place().
 */
export class SiteAreaLayer {
  readonly root = new Group();
  private items: { marker: Marker; group: Group; parts: Draped[] }[] = [];
  private scale = 0;
  private readonly markers: Marker[];
  private readonly areas: Map<string, SiteArea>;

  constructor(markers: Marker[], areas: Map<string, SiteArea>, scale = DEFAULT_AREA_SCALE) {
    this.markers = markers;
    this.areas = areas;
    this.setScale(scale);
  }

  /** Redraws every area `scale` times wider than life. Returns true when it changed: call place() again then. */
  setScale(scale: number): boolean {
    if (scale === this.scale) return false;
    this.scale = scale;
    for (const { group } of this.items) {
      for (const child of group.children as (Mesh | LineLoop)[]) {
        child.geometry.dispose();
        (child.material as MeshBasicMaterial | LineBasicMaterial).dispose();
      }
    }
    this.root.clear();
    this.items = [];
    for (const marker of this.markers) {
      const area = this.areas.get(marker.landing.id);
      if (!area || area.polygon.length < 3) continue;
      const color = landingColor(marker.landing);
      const polygon = enlarge(area.polygon, scale);
      const ring = polygon.map(([lat, lon]) => latLonToVec3(lat, lon));
      const centre = ring.reduce((sum, p) => sum.add(p), new Vector3()).normalize();
      const n = piecesFor(polygon);
      // Convex, so a fan from the centre fills it; each fan triangle is split into n x n pieces.
      const points: Vector3[] = [];
      const index: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        const b = ring[i], c = ring[(i + 1) % ring.length];
        const base = points.length;
        const at = (u: number, v: number) => base + (u * (2 * n + 3 - u)) / 2 + v; // row u holds n + 1 - u points
        for (let u = 0; u <= n; u++) {
          for (let v = 0; v <= n - u; v++) {
            points.push(new Vector3().addScaledVector(centre, 1 - (u + v) / n).addScaledVector(b, u / n).addScaledVector(c, v / n));
          }
        }
        for (let u = 0; u < n; u++) {
          for (let v = 0; v < n - u; v++) {
            index.push(at(u, v), at(u + 1, v), at(u, v + 1));
            if (v < n - u - 1) index.push(at(u + 1, v), at(u + 1, v + 1), at(u, v + 1));
          }
        }
      }
      const fillPart = new Draped(points);
      const fillGeo = new BufferGeometry();
      fillGeo.setAttribute('position', fillPart.position);
      fillGeo.setIndex(index);
      const outlinePoints: Vector3[] = [];
      for (let i = 0; i < ring.length; i++) {
        for (let k = 0; k < n; k++) outlinePoints.push(new Vector3().lerpVectors(ring[i], ring[(i + 1) % ring.length], k / n));
      }
      const linePart = new Draped(outlinePoints);
      const lineGeo = new BufferGeometry();
      lineGeo.setAttribute('position', linePart.position);
      const fill = new Mesh(fillGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false, side: DoubleSide, toneMapped: false }));
      const outline = new LineLoop(lineGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, toneMapped: false }));
      // Positions change with the relief, so bounding spheres would go stale: skip culling (few vertices).
      fill.frustumCulled = outline.frustumCulled = false;
      // Under the markers (3), over the terrain.
      fill.renderOrder = outline.renderOrder = 2.5;
      const group = new Group();
      group.add(fill, outline);
      group.visible = marker.group.visible;
      this.root.add(group);
      this.items.push({ marker, group, parts: [fillPart, linePart] });
    }
    return true;
  }

  /** Puts every area on the drawn surface: `radius(lat, lon)` in Moon radii, relief exaggeration included. */
  place(radius: (lat: number, lon: number) => number): void {
    for (const item of this.items) for (const part of item.parts) part.place(radius);
  }

  /** Follows the markers: hidden when a site is filtered out or behind the Moon. */
  update(_camera: Camera): void {
    for (const { marker, group } of this.items) group.visible = marker.group.visible;
  }
}
