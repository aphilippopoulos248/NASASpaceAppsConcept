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
import { vec3ToLatLon } from './globe/latLon';
import { FULL_EXAGGERATION_KM, TRUE_SCALE_BELOW_KM } from './globe/reliefTiles';
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

/** "about 150 km across", "about 1.6 km across", "about 140 m across" */
function widthText(m: number): string {
  if (m >= 100_000) return `about ${Math.round(m / 1000)} km across`;
  return m >= 1000 ? `about ${(m / 1000).toFixed(1)} km across` : `about ${Math.round(m / 10) * 10} m across`;
}

/** "about 1.6 km across", "about 140 m across" */
export function describeExtent(a: SiteArea): string {
  return widthText(a.extentM);
}

/** Just above the site imagery patches (radius 1.0001), below the markers. */
const RADIUS = 1.00014;
/** The same height above the drawn surface once the relief is applied (see SiteAreaLayer.place). */
const LIFT = RADIUS - 1;

/**
 * The territory setting (areaScale in src/scene/globe/displayState.ts, the setTerritoryScale action)
 * at which each area gets the full display enlargement: seen from orbit it is then drawn
 * MIN_ORBIT_AREA_WIDTH_M to MAX_ORBIT_AREA_WIDTH_M across (its width x 100 within those bounds), so
 * the smallest sites are enlarged most. It is a setting, not a width multiplier: 1 is true size and
 * the settings in between blend linearly (areaDisplayScale). The data, and the size quoted in the
 * info card, stay true.
 */
export const AREA_DISPLAY_SCALE = 100;
export const MIN_ORBIT_AREA_WIDTH_M = 150_000;
export const MAX_ORBIT_AREA_WIDTH_M = 500_000;

/**
 * How many times wider than it is an area is drawn from orbit at a territory setting: orbital display
 * symbols stay legible even for a stationary lander, and bounded for long traverses.
 */
export function areaDisplayScale(area: Pick<SiteArea, 'extentM'>, factor = AREA_DISPLAY_SCALE): number {
  const extent = Math.max(1, area.extentM);
  const orbital = Math.max(1, Math.min(MAX_ORBIT_AREA_WIDTH_M, Math.max(MIN_ORBIT_AREA_WIDTH_M, extent * AREA_DISPLAY_SCALE)) / extent);
  return 1 + (orbital - 1) * Math.min(1, Math.max(0, (factor - 1) / (AREA_DISPLAY_SCALE - 1)));
}

/** "2.7", "44", "2500": a width factor as the card and the action results quote it. */
const factorText = (k: number): string => String(k < 10 ? Math.round(k * 10) / 10 : Math.round(k));

/**
 * One area as drawn from orbit (a camera above FULL_EXAGGERATION_KM) at a territory setting: how many
 * times wider than it is, how wide, and the words the site card and setTerritoryScale use. Closer
 * in it eases to true size (areaScale).
 */
export function areaDisplayFacts(area: Pick<SiteArea, 'extentM'>, setting: number) {
  const k = areaDisplayScale(area, setting);
  const drawnM = k * Math.max(1, area.extentM);
  const widthFactorFromOrbit = Math.round(k * 10) / 10;
  return {
    widthFactorFromOrbit,
    drawnWidthFromOrbitKm: Math.round(drawnM / 100) / 10,
    drawn: widthFactorFromOrbit <= 1
      ? 'drawn at true size on the globe'
      : `drawn ${factorText(k)}× larger in width from orbit, ${widthText(drawnM)}, so it can be seen; true size close to the ground`,
  };
}

/** The site card's "Explored" row: "about 11.4 km across (drawn 44× larger in width from orbit, about 500 km across, ...)". */
export function exploredText(area: SiteArea, setting: number): string {
  return `${describeExtent(area)} (${areaDisplayFacts(area, setting).drawn})`;
}

/**
 * The territory setting in effect at a camera altitude: `orbitScale` (the chosen setting,
 * AREA_DISPLAY_SCALE unless changed) from orbit, 1 (true size) close to the ground, eased in between
 * over the same altitudes as the relief exaggeration (src/scene/globe/reliefTiles.ts). place() turns
 * it into each area's own enlargement, between true size and its display width from orbit.
 */
export function areaScale(altitudeKm: number, orbitScale = AREA_DISPLAY_SCALE): number {
  const t = Math.min(1, Math.max(0, (altitudeKm - TRUE_SCALE_BELOW_KM) / (FULL_EXAGGERATION_KM - TRUE_SCALE_BELOW_KM)));
  return 1 + (orbitScale - 1) * t * t * (3 - 2 * t);
}

/**
 * Each site's explored area drawn on the globe in its country's colour: a translucent fill with a solid
 * outline, enlarged about its centre so it reads at globe scale (areaDisplayScale, areaScale).
 */
/** The vertices of one drawn piece (fill or outline) by true latitude and longitude, so it can follow the relief and be enlarged about its centre. */
interface Piece {
  points: Vector3[];
  position: BufferAttribute;
}

export class SiteAreaLayer {
  readonly root = new Group();
  private readonly items: { marker: Marker; group: Group; centre: Vector3; orbitScale: number; pieces: Piece[] }[] = [];

  constructor(markers: Marker[], areas: Map<string, SiteArea>) {
    for (const marker of markers) {
      const area = areas.get(marker.landing.id);
      if (!area || area.polygon.length < 3) continue;
      const color = landingColor(marker.landing);
      const ring = area.polygon.map(([lat, lon]) => latLonToVec3(lat, lon));
      const centre = ring.reduce((sum, p) => sum.add(p), new Vector3()).normalize();
      // Subdivide the convex fan so the enlarged footprint follows the globe's curvature.
      const divisions = 8;
      const fillPoints: Vector3[] = [];
      const outlinePoints: Vector3[] = [];
      const idx: number[] = [];
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const rows: number[][] = [];
        for (let r = 0; r <= divisions; r++) {
          const row: number[] = [];
          for (let c = 0; c <= r; c++) {
            row.push(fillPoints.length);
            fillPoints.push(centre.clone().multiplyScalar(1 - r / divisions)
              .addScaledVector(a, (r - c) / divisions).addScaledVector(b, c / divisions).normalize());
          }
          rows.push(row);
        }
        for (let r = 0; r < divisions; r++) for (let c = 0; c <= r; c++) {
          idx.push(rows[r][c], rows[r + 1][c], rows[r + 1][c + 1]);
          if (c < r) idx.push(rows[r][c], rows[r + 1][c + 1], rows[r][c + 1]);
        }
        for (let s = 0; s < divisions; s++) outlinePoints.push(a.clone().lerp(b, s / divisions).normalize());
      }
      const fillGeo = new BufferGeometry();
      fillGeo.setAttribute('position', new Float32BufferAttribute(fillPoints.flatMap((p) => p.clone().multiplyScalar(RADIUS).toArray()), 3));
      fillGeo.setIndex(idx);
      const fill = new Mesh(fillGeo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: DoubleSide, toneMapped: false }));
      const lineGeo = new BufferGeometry().setFromPoints(outlinePoints.map((p) => p.clone().multiplyScalar(RADIUS)));
      const outline = new LineLoop(lineGeo, new LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }));

      fill.renderOrder = outline.renderOrder = 2.5;
      const group = new Group();
      group.add(fill, outline);
      this.root.add(group);
      const pieces: Piece[] = [
        { points: fillPoints, position: fillGeo.getAttribute('position') as BufferAttribute },
        { points: outlinePoints, position: lineGeo.getAttribute('position') as BufferAttribute },
      ];
      this.items.push({ marker, group, centre, orbitScale: areaDisplayScale(area), pieces });
    }
    this.place(() => 1);
  }

  /**
   * Puts every area on the drawn surface, as the globe's other overlays do: `radius(lat, lon)` in
   * Moon radii, relief exaggeration included. Without this the areas stay on the plain sphere and
   * disappear under raised terrain. `scale` enlarges each area about its centre (see areaScale).
   */
  place(radius: (lat: number, lon: number) => number, scale = AREA_DISPLAY_SCALE): void {
    const v = new Vector3();
    const tangent = new Vector3();
    const mix = Math.min(1, Math.max(0, (scale - 1) / (AREA_DISPLAY_SCALE - 1)));
    for (const { pieces, centre, orbitScale } of this.items) {
      const kScale = 1 + (orbitScale - 1) * mix;
      for (const p of pieces) {
        const out = p.position.array as Float32Array;
        for (let k = 0; k < p.points.length; k++) {
          const point = p.points[k], dot = Math.min(1, Math.max(-1, centre.dot(point)));
          tangent.copy(point).addScaledVector(centre, -dot);
          const sin = tangent.length(), angle = Math.atan2(sin, dot) * kScale;
          v.copy(centre).multiplyScalar(Math.cos(angle));
          if (sin > 1e-15) v.addScaledVector(tangent, Math.sin(angle) / sin);
          const { lat, lon } = vec3ToLatLon(v);
          v.multiplyScalar(radius(lat, lon) + LIFT);
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
