import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { landingColor, latLonToVec3 } from '../data/landings';
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

/** Just above the site imagery patches (radius 1.0001), below the markers. */
const RADIUS = 1.00014;
/** The same height above the drawn surface once the relief is applied (see SiteAreaLayer.place). */
const LIFT = RADIUS - 1;

/**
 * Areas are drawn this many times larger (in width) than they really are, so they read on the globe.
 * The data, and the size quoted in the info card, stay true.
 */
export const AREA_DISPLAY_SCALE = 10;

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

/**
 * Each site's explored area drawn on the globe in its country's colour: a translucent fill with a solid
 * outline, enlarged AREA_DISPLAY_SCALE times about its centre so it reads at globe scale.
 */
/** The vertices of one drawn piece (fill or outline) by latitude and longitude, so it can follow the relief. */
interface Piece {
  lat: Float32Array;
  lon: Float32Array;
  position: BufferAttribute;
}

export class SiteAreaLayer {
  readonly root = new Group();
  private readonly items: { marker: Marker; group: Group; pieces: Piece[] }[] = [];

  constructor(markers: Marker[], areas: Map<string, SiteArea>) {
    for (const marker of markers) {
      const area = areas.get(marker.landing.id);
      if (!area || area.polygon.length < 3) continue;
      const color = landingColor(marker.landing);
      const polygon = enlarge(area.polygon, AREA_DISPLAY_SCALE);
      const ring = polygon.map(([lat, lon]) => latLonToVec3(lat, lon, RADIUS));
      // Convex, so a fan from the centre fills it.
      let cLat = 0, cLon = 0;
      for (const [lat, lon] of polygon) { cLat += lat; cLon += lon; }
      const centre = latLonToVec3(cLat / polygon.length, cLon / polygon.length, RADIUS);
      const pos: number[] = [...centre.toArray()];
      for (const p of ring) pos.push(p.x, p.y, p.z);
      const idx: number[] = [];
      for (let i = 0; i < ring.length; i++) idx.push(0, 1 + i, 1 + ((i + 1) % ring.length));
      const fillGeo = new BufferGeometry();
      fillGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      fillGeo.setIndex(idx);
      const fill = new Mesh(fillGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide, toneMapped: false }));
      const lineGeo = new BufferGeometry().setFromPoints(ring);
      const outline = new LineLoop(lineGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));
      fill.renderOrder = outline.renderOrder = 2.5;
      const group = new Group();
      group.add(fill, outline);
      this.root.add(group);
      const ringLat = Float32Array.from(polygon, ([lat]) => lat), ringLon = Float32Array.from(polygon, ([, lon]) => lon);
      const pieces: Piece[] = [
        {
          lat: Float32Array.from([cLat / polygon.length, ...ringLat]),
          lon: Float32Array.from([cLon / polygon.length, ...ringLon]),
          position: fillGeo.getAttribute('position') as BufferAttribute,
        },
        { lat: ringLat, lon: ringLon, position: lineGeo.getAttribute('position') as BufferAttribute },
      ];
      this.items.push({ marker, group, pieces });
    }
  }

  /**
   * Puts every area on the drawn surface, as the globe's other overlays do: `radius(lat, lon)` in
   * Moon radii, relief exaggeration included. Without this the areas stay on the plain sphere and
   * disappear under raised terrain.
   */
  place(radius: (lat: number, lon: number) => number): void {
    const v = new Vector3();
    for (const { pieces } of this.items) {
      for (const p of pieces) {
        const out = p.position.array as Float32Array;
        for (let k = 0; k < p.lat.length; k++) {
          latLonToVec3(p.lat[k], p.lon[k], radius(p.lat[k], p.lon[k]) + LIFT, v);
          out[k * 3] = v.x;
          out[k * 3 + 1] = v.y;
          out[k * 3 + 2] = v.z;
        }
        p.position.needsUpdate = true;
      }
    }
    // The surface can move by a good fraction of a Moon radius at high exaggeration: keep culling right.
    for (const { group } of this.items) {
      for (const child of group.children) (child as Mesh).geometry.computeBoundingSphere();
    }
  }

  /** Follows the markers: hidden when a site is filtered out. */
  update(_camera: Camera): void {
    for (const { marker, group } of this.items) group.visible = marker.group.visible;
  }
}
