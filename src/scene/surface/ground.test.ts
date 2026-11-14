import { describe, expect, it } from 'vitest';
import { blendEdge, decimate, generatedRelief, Ground, halfExtent, offsetLatLon, sampleGrid, sampleSmooth, upsample, type Grid } from './ground';

function grid(n: number, spacing: number, h: (e: number, nn: number) => number): Grid {
  const data = new Float32Array(n * n), c = (n - 1) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = h((i - c) * spacing, (j - c) * spacing);
  return { n, spacing, data };
}
const R = 1_737_400;

describe('height grids', () => {
  it('samples a plane exactly, bilinear and smooth', () => {
    const g = grid(17, 60, (e, nn) => 100 + 0.02 * e - 0.05 * nn);
    for (const [e, nn] of [[0, 0], [33, -71], [-400, 250], [417.5, 12.25]]) {
      expect(sampleGrid(g, e, nn)).toBeCloseTo(100 + 0.02 * e - 0.05 * nn, 3);
      expect(sampleSmooth(g, e, nn)).toBeCloseTo(100 + 0.02 * e - 0.05 * nn, 3);
    }
    expect(halfExtent(g)).toBe(480);
  });

  it('decimates and upsamples without moving the samples', () => {
    const g = grid(17, 3, (e, nn) => Math.sin(e / 9) + nn * 0.1);
    const d = decimate(g, 2);
    expect(d.n).toBe(9);
    expect(d.spacing).toBe(6);
    expect(d.data[4 * 9 + 4]).toBe(g.data[8 * 17 + 8]);
    expect(d.data[2 * 9 + 7]).toBe(g.data[4 * 17 + 14]);
    expect(decimate(g, 3)).toBe(g); // 16 cells do not divide by 3: left alone
    const u = upsample(grid(9, 60, (e) => e * 0.5), 33, 6);
    expect(u.data[16 * 33 + 20]).toBeCloseTo(12, 4); // 24 m east of centre on a 0.5 slope
  });

  it('eases a fine grid onto the coarse one at its edge only', () => {
    const outer = grid(9, 100, () => 50);
    const inner = grid(49, 5, () => 0);
    blendEdge(inner, outer);
    expect(inner.data[0]).toBeCloseTo(50, 5); // corner sits on the coarse surface
    expect(inner.data[24 * 49 + 24]).toBe(0); // centre untouched
  });

  it('generates the same relief for the same seed, and different relief for another', () => {
    const a = generatedRelief('pin:1.00000,2.00000', 65, 3), b = generatedRelief('pin:1.00000,2.00000', 65, 3), c = generatedRelief('pin:1.00000,2.50000', 65, 3);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    // Metres, not kilometres: small craters and gentle undulation only.
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(40);
  });
});

describe('offsetLatLon', () => {
  it('walks over the sphere', () => {
    const quarter = (Math.PI / 2) * R;
    expect(offsetLatLon(0, 0, 0, quarter).lat).toBeCloseTo(90, 9);
    const e = offsetLatLon(0, 10, quarter, 0);
    expect(e.lat).toBeCloseTo(0, 9);
    expect(e.lon).toBeCloseTo(100, 9);
    // One degree of latitude is 30.32 km.
    expect(offsetLatLon(-84.79, 29.2, 0, -30323.1).lat).toBeCloseTo(-85.79, 3);
    // Crossing the south pole comes out on the opposite meridian.
    const over = offsetLatLon(-89.5, 20, 0, -30323.1);
    expect(over.lat).toBeCloseTo(-89.5, 3);
    expect(Math.abs(over.lon)).toBeCloseTo(160, 3);
    expect(offsetLatLon(5, 179.99, 1000, 0).lon).toBeLessThan(-179.9);
  });
});

describe('Ground', () => {
  const make = (h: (e: number, nn: number) => number) => {
    const g = new Ground();
    g.grids = [grid(65, 10, h), grid(65, 100, h), grid(65, 1000, h)];
    g.siteHeight = h(0, 0);
    return g;
  };

  it('picks the finest grid that covers a point', () => {
    const g = make(() => 0);
    expect(g.gridAt(100, -300).spacing).toBe(10);
    expect(g.gridAt(321, 0).spacing).toBe(100);
    expect(g.gridAt(0, 5000).spacing).toBe(1000);
    expect(g.gridAt(9e9, 0).spacing).toBe(1000);
  });

  it('puts the site at the origin and drops distant ground by the curvature', () => {
    const g = make(() => 1234);
    const p = g.point(0, 0, 1234, { x: 9, y: 9, z: 9 });
    expect(Math.abs(p.x) + Math.abs(p.y) + Math.abs(p.z)).toBe(0);
    // 20 km north at the same height: about d^2 / 2R = 115 m below the site's horizontal plane.
    const q = g.point(0, 20000, 1234, { x: 0, y: 0, z: 0 });
    expect(q.z).toBeCloseTo(-20000, -2);
    expect(q.y).toBeCloseTo(-(20000 ** 2) / (2 * (R + 1234)), 0);
    expect(g.surfaceY(0, -20000)).toBeCloseTo(q.y, 3);
  });

  it('finds the skyline of a smooth sphere at the dip of the horizon', () => {
    const g = make(() => 0);
    const eye = 100; // metres above the ground
    const tan = g.skylineTan({ x: 0, y: eye, z: 0 }, 77);
    // Dip = acos(R / (R + h)) = 0.6148 degrees for 100 m.
    expect((Math.atan(tan) * 180) / Math.PI).toBeCloseTo(-0.6148, 2);
  });

  it('finds a ridge above the horizon, from where the viewer stands', () => {
    // A 600 m ridge east of the site: flat top from 10 to 11 km, 4 km flanks (so the grid holds its shape exactly).
    const ridge = (e: number) => 600 * Math.max(0, Math.min(1, (4500 - Math.abs(e - 10500)) / 4000));
    const g = make(ridge);
    const el = (x: number, az: number) => (Math.atan(g.skylineTan({ x, y: 2, z: 0 }, az)) * 180) / Math.PI;
    // The skyline is the near edge of the top, 10 km away, less the curvature drop of 29 m there.
    const expected = (Math.atan((600 - 10000 ** 2 / (2 * R) - 2) / 10000) * 180) / Math.PI; // 3.26 degrees
    expect(Math.abs(el(0, 90) - expected)).toBeLessThan(0.02);
    expect(el(0, 270)).toBeLessThan(0); // nothing to the west
    expect(el(5000, 90)).toBeGreaterThan(el(0, 90)); // closer: higher
  });

  it('adds photo-derived relief only on the finest grid and fades it out at its edge', () => {
    const g = make(() => 0);
    g.detail = { size: 3, half: 300, heights: new Float32Array(9).fill(0.5) };
    expect(g.heightAt(0, 0)).toBeCloseTo(0.5, 6);
    expect(g.detailAt(280, 0)).toBeCloseTo(0.25, 6); // 20 m from the edge of the surveyed square
    expect(g.detailAt(400, 0)).toBe(0);
    expect(g.heightAt(2000, 0)).toBe(0);
  });
});
