// Where the elevation windows around the catalogued landing sites exist: nested squares
// (480 m grid, 60 m grid and, where surveyed, 3 m) drawn on the globe as outlines with a
// light fill. The three large south-polar squares are drawn by the surface shader; these
// small ones are plain geometry, because 28 of them tested per pixel is too slow in a
// software renderer.
//
// Like the landing markers they are symbols: drawn over the terrain, placed on the drawn
// surface, and hidden while their site is behind the Moon.
import { BufferAttribute, BufferGeometry, Camera, DoubleSide, Group, LineBasicMaterial, LineLoop, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { offsetPoint } from '../../terrain/geo';
import type { CoverageRegion } from '../../terrain/types';
import { dirOf } from './reliefTiles';

/** Cells per side of a window's fill, and so points per side of its outline. */
const DIVISIONS = 8;

interface Piece {
  /** Latitude and longitude of each vertex, degrees. */
  lat: Float32Array;
  lon: Float32Array;
  position: BufferAttribute;
}

interface Window {
  centre: Vector3;
  group: Group;
  pieces: Piece[];
}

/** What to draw for one class of window: which sites, how wide, which colour. */
export interface WindowClass {
  sites: { lat: number; lon: number; halfWidthM: number }[];
  colour: string;
}

/** The site windows of the terrain module's coverage list, coarsest first, with the colours of the legend (480 m, 60 m, 3 m). */
export function windowClasses(regions: readonly CoverageRegion[], colours: readonly string[]): WindowClass[] {
  const bundled = regions.filter((r) => r.sites?.length && !r.onDemand).sort((a, b) => b.resolutionM - a.resolutionM);
  return bundled.slice(0, colours.length).map((r, i) => ({ sites: r.sites!, colour: colours[i] }));
}

export class CoverageOutlines {
  readonly root = new Group();
  private readonly windows: Window[] = [];

  constructor(classes: readonly WindowClass[]) {
    const byPlace = new Map<string, Window>();
    for (const cls of classes) {
      const fill = new MeshBasicMaterial({ color: cls.colour, transparent: true, opacity: 0.16, depthTest: false, side: DoubleSide, toneMapped: false });
      const line = new LineBasicMaterial({ color: cls.colour, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
      for (const site of cls.sites) {
        const key = `${site.lat.toFixed(5)},${site.lon.toFixed(5)}`;
        let w = byPlace.get(key);
        if (!w) {
          const d = dirOf(site.lat, site.lon) as number[];
          w = { centre: new Vector3(d[0], d[1], d[2]), group: new Group(), pieces: [] };
          byPlace.set(key, w);
          this.windows.push(w);
          this.root.add(w.group);
        }
        // A square in the window's own frame: metres east and north of the site, over the sphere.
        const n = DIVISIONS + 1;
        const lat = new Float32Array(n * n), lon = new Float32Array(n * n);
        for (let j = 0; j < n; j++) {
          for (let i = 0; i < n; i++) {
            const p = offsetPoint(site.lat, site.lon, site.halfWidthM * ((2 * i) / DIVISIONS - 1), site.halfWidthM * ((2 * j) / DIVISIONS - 1));
            lat[j * n + i] = p.lat;
            lon[j * n + i] = p.lon;
          }
        }
        const index: number[] = [];
        for (let j = 0; j < DIVISIONS; j++) {
          for (let i = 0; i < DIVISIONS; i++) {
            const a = j * n + i;
            index.push(a, a + 1, a + n + 1, a, a + n + 1, a + n);
          }
        }
        const fillGeometry = new BufferGeometry();
        const fillPosition = new BufferAttribute(new Float32Array(n * n * 3), 3);
        fillGeometry.setAttribute('position', fillPosition);
        fillGeometry.setIndex(index);
        const mesh = new Mesh(fillGeometry, fill);
        // The outline: the border points in order.
        const border: number[] = [];
        for (let i = 0; i < DIVISIONS; i++) border.push(i);
        for (let j = 0; j < DIVISIONS; j++) border.push(j * n + DIVISIONS);
        for (let i = DIVISIONS; i > 0; i--) border.push(DIVISIONS * n + i);
        for (let j = DIVISIONS; j > 0; j--) border.push(j * n);
        const lineGeometry = new BufferGeometry();
        const linePosition = new BufferAttribute(new Float32Array(border.length * 3), 3);
        lineGeometry.setAttribute('position', linePosition);
        const loop = new LineLoop(lineGeometry, line);
        for (const o of [mesh, loop]) {
          o.frustumCulled = false;
          o.renderOrder = 3;
          w.group.add(o);
        }
        w.pieces.push({ lat, lon, position: fillPosition }, { lat: Float32Array.from(border, (k) => lat[k]), lon: Float32Array.from(border, (k) => lon[k]), position: linePosition });
      }
    }
  }

  get count(): number {
    return this.windows.length;
  }

  /** Puts every window on the drawn surface: `radius(lat, lon)` in Moon radii, relief exaggeration included. */
  place(radius: (lat: number, lon: number) => number): void {
    const d = [0, 0, 0];
    for (const w of this.windows) {
      for (const p of w.pieces) {
        const out = p.position.array as Float32Array;
        for (let k = 0; k < p.lat.length; k++) {
          dirOf(p.lat[k], p.lon[k], d);
          const r = radius(p.lat[k], p.lon[k]) + 0.0001;
          out[k * 3] = d[0] * r;
          out[k * 3 + 1] = d[1] * r;
          out[k * 3 + 2] = d[2] * r;
        }
        p.position.needsUpdate = true;
      }
    }
  }

  /** Hides the windows whose site is behind the Moon. */
  update(camera: Camera): void {
    for (const w of this.windows) w.group.visible = w.centre.dot(camera.position) > 1;
  }
}
