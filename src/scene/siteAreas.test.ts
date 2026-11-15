import { Group, LineLoop, Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import type { Landing } from '../data/landings';
import type { Marker } from './markers';
import { AREA_DISPLAY_SCALE, areaScale, SiteAreaLayer, type SiteArea } from './siteAreas';

const landing = { id: 'apollo-11', name: 'Apollo 11', program: 'Apollo', country: 'USA', date: '1969-07-20', time: '20:17', lat: 0.674, lon: 23.473, crewed: true, region: 'r', summary: 's' } as Landing;
const marker = { landing, group: new Group() } as unknown as Marker;
const area: SiteArea = {
  polygon: [[0.670, 23.470], [0.670, 23.476], [0.678, 23.476], [0.678, 23.470]],
  extentM: 250,
  areaM2: 40000,
  located: true,
  sources: ['test'],
  note: null,
};

const radii = (layer: SiteAreaLayer) => {
  const out: number[] = [];
  layer.root.traverse((o) => {
    if (!(o instanceof Mesh || o instanceof LineLoop)) return;
    const p = o.geometry.getAttribute('position');
    for (let k = 0; k < p.count; k++) out.push(Math.hypot(p.getX(k), p.getY(k), p.getZ(k)));
  });
  return out;
};

describe('SiteAreaLayer', () => {
  it('draws an area just above the sphere until it is placed', () => {
    const layer = new SiteAreaLayer([marker], new Map([[landing.id, area]]));
    const r = radii(layer);
    expect(r.length).toBe(5 + 4); // fill: centre and ring; outline: ring
    for (const v of r) expect(v).toBeCloseTo(1.00014, 6);
  });

  it('place() puts every vertex on the drawn surface, at the same height above it', () => {
    const layer = new SiteAreaLayer([marker], new Map([[landing.id, area]]));
    // A surface 2 % above the sphere east of 23.473 E and 1 % above it west of there.
    layer.place((_lat, lon) => (lon > 23.473 ? 1.02 : 1.01));
    const r = radii(layer).sort((a, b) => a - b);
    expect(r[0]).toBeCloseTo(1.01014, 6);
    expect(r[r.length - 1]).toBeCloseTo(1.02014, 6);
    layer.root.traverse((o) => {
      if (o instanceof Mesh || o instanceof LineLoop) expect(o.geometry.boundingSphere!.radius).toBeGreaterThan(0);
    });
  });
});

describe('how much larger the areas are drawn', () => {
  it('ten times from orbit, true to size near the ground, eased like the relief', () => {
    expect(areaScale(4170)).toBe(AREA_DISPLAY_SCALE);
    expect(areaScale(1500)).toBe(AREA_DISPLAY_SCALE);
    expect(areaScale(100)).toBe(1);
    // A selected site is seen from about 42 km: the area at its true size.
    expect(areaScale(41.7)).toBe(1);
    const mid = areaScale(800);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(AREA_DISPLAY_SCALE);
    for (let km = 100; km < 1500; km += 50) expect(areaScale(km + 50)).toBeGreaterThanOrEqual(areaScale(km));
  });

  it('place() enlarges each area about its own centre by the scale given', () => {
    const layer = new SiteAreaLayer([marker], new Map([[landing.id, area]]));
    const span = () => {
      let min = Infinity, max = -Infinity;
      layer.root.traverse((o) => {
        if (!(o instanceof LineLoop)) return;
        const p = o.geometry.getAttribute('position');
        // Longitude of each outline vertex (east is -Z, +X at 0 E).
        for (let k = 0; k < p.count; k++) {
          const lon = (Math.atan2(-p.getZ(k), p.getX(k)) * 180) / Math.PI;
          min = Math.min(min, lon);
          max = Math.max(max, lon);
        }
      });
      return max - min;
    };
    layer.place(() => 1, 1);
    expect(span()).toBeCloseTo(0.006, 6); // the true width, 23.470 to 23.476 E
    layer.place(() => 1, 10);
    expect(span()).toBeCloseTo(0.06, 5);
    layer.place(() => 1);
    expect(span()).toBeCloseTo(0.006 * AREA_DISPLAY_SCALE, 5);
  });
});
