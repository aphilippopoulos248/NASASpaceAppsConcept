// Outlines of the mapped ice-bearing permanently shaded regions (Lemelin et al. 2021) on the
// globe. Each outline is drawn vertex by vertex on the sphere (near the pole a polygon can
// span many longitudes), on the drawn surface, over the terrain; a region is hidden while it
// is behind the Moon. The outlines are the authors' regions of interest, about 0.3 km wider
// than the listed shadowed areas: the legend says so.
import { BufferAttribute, BufferGeometry, Camera, Group, LineBasicMaterial, LineLoop, Vector3 } from 'three';
import type { IceTargetLayer } from '../../science/iceTargets';
import { dirOf } from './reliefTiles';

export const ICE_COLOUR = '#7fe7ff';

interface Ring {
  lat: Float32Array;
  lon: Float32Array;
  position: BufferAttribute;
}

interface Region {
  /** A point of the outline itself (the listed centre can lie outside it). */
  anchor: Vector3;
  group: Group;
  rings: Ring[];
}

export class IceOutlines {
  readonly root = new Group();
  private readonly regions: Region[] = [];

  constructor(layer: IceTargetLayer) {
    const material = new LineBasicMaterial({ color: ICE_COLOUR, transparent: true, opacity: 0.95, depthTest: false, toneMapped: false });
    for (const target of layer.targets) {
      const rings: Ring[] = [];
      const group = new Group();
      for (const polygon of target.polygons) {
        for (const ring of polygon) {
          // Rings are closed (first vertex repeated at the end): a line loop closes itself.
          const n = ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lon === ring[ring.length - 1].lon ? ring.length - 1 : ring.length;
          if (n < 3) continue;
          const lat = Float32Array.from({ length: n }, (_, i) => ring[i].lat), lon = Float32Array.from({ length: n }, (_, i) => ring[i].lon);
          const geometry = new BufferGeometry();
          const position = new BufferAttribute(new Float32Array(n * 3), 3);
          geometry.setAttribute('position', position);
          const loop = new LineLoop(geometry, material);
          loop.frustumCulled = false;
          loop.renderOrder = 3;
          group.add(loop);
          rings.push({ lat, lon, position });
        }
      }
      if (!rings.length) continue;
      const d = dirOf(rings[0].lat[0], rings[0].lon[0]) as number[];
      this.regions.push({ anchor: new Vector3(d[0], d[1], d[2]), group, rings });
      this.root.add(group);
    }
  }

  get count(): number {
    return this.regions.length;
  }

  /** Puts every outline on the drawn surface: `radius(lat, lon)` in Moon radii, relief exaggeration included. */
  place(radius: (lat: number, lon: number) => number): void {
    const d = [0, 0, 0];
    for (const region of this.regions) {
      for (const ring of region.rings) {
        const out = ring.position.array as Float32Array;
        for (let k = 0; k < ring.lat.length; k++) {
          dirOf(ring.lat[k], ring.lon[k], d);
          const r = radius(ring.lat[k], ring.lon[k]) + 0.0001;
          out[k * 3] = d[0] * r;
          out[k * 3 + 1] = d[1] * r;
          out[k * 3 + 2] = d[2] * r;
        }
        ring.position.needsUpdate = true;
      }
    }
  }

  /** Hides the regions that are behind the Moon. */
  update(camera: Camera): void {
    for (const region of this.regions) region.group.visible = region.anchor.dot(camera.position) > 1;
  }
}
