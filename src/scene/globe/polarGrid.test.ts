import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M } from '../../core/types';
import { loadTerrainFor } from '../../terrain/api';
import { polarXY } from '../../terrain/geo';
import { cutWindow, decimate, gridCell, gridCovers, gridHeight, gridLatLon, gridX, gridY, groundCell, groundScale, heightsAbovePolarPlane, layerHalfWidth, normalMap, type PolarLayer } from './polarGrid';
import { litFraction, SUN_RADIUS_RAD, sweepShadowHeight } from './polarShadow';

/** A small made-up layer: 100 m cells, height = 2 x + 3 y (metres, x and y in km) so slopes are known. */
function plane(size = 64, metresPerPx = 100): PolarLayer {
  const data = new Float32Array(size * size);
  const edge = (size / 2 - 0.5) * metresPerPx;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) data[r * size + c] = 2 * ((-edge + c * metresPerPx) / 1000) + 3 * ((edge - r * metresPerPx) / 1000);
  return { size, metresPerPx, data, scale: 1, offset: 0 };
}

describe('polar grids', () => {
  it('keeps the map frame: columns grow with x (towards 90E), rows towards -y (away from 0E)', () => {
    const l = plane();
    expect(layerHalfWidth(l)).toBe(3150);
    const g = cutWindow(l, 0, 0, 16)!;
    expect(g.cellM).toBe(100);
    expect(gridX(g, 1) - gridX(g, 0)).toBe(100);
    expect(gridY(g, 1) - gridY(g, 0)).toBe(-100);
    expect(g.h[0]).toBeCloseTo(2 * (g.x0 / 1000) + 3 * (g.y0 / 1000), 5);
    // Longitude 90E lies along +x, longitude 0 along +y.
    const ll = gridLatLon({ ...g, x0: 0, y0: 0 }, 300, 0);
    expect(ll.lon).toBeCloseTo(90, 9);
    expect(ll.lat).toBeLessThan(-89);
    const p = polarXY('S', -89.5, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeGreaterThan(15_000);
  });

  it('cuts a window around a point, shifted to stay inside the layer, and reads heights between cells', () => {
    const l = plane();
    const centred = cutWindow(l, 450, -250, 16)!;
    expect(gridCovers(centred, 450, -250)).toBe(true);
    expect(gridHeight(centred, 450, -250)).toBeCloseTo(2 * 0.45 + 3 * -0.25, 5);
    expect(gridHeight(centred, 437, -211)).toBeCloseTo(2 * 0.437 + 3 * -0.211, 5);
    const [c, r] = gridCell(centred, 450, -250);
    expect(Math.abs(c - 7.5)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r - 7.5)).toBeLessThanOrEqual(0.5);
    // Near the layer's corner the window slides inwards instead of running off the data.
    const corner = cutWindow(l, 3100, 3100, 16)!;
    expect(gridX(corner, 15)).toBe(3150);
    expect(gridY(corner, 0)).toBe(3150);
    expect(gridHeight(corner, 5000, 0)).toBeNaN();
    expect(cutWindow(l, 4000, 0, 16)).toBeNull();
  });

  it('decimates by block means around the same centre', () => {
    const g = decimate(plane(), 4);
    expect(g.n).toBe(16);
    expect(g.cellM).toBe(400);
    // A plane's block mean is its value at the block centre.
    for (const [c, r] of [[0, 0], [5, 9], [15, 15]]) expect(g.h[r * g.n + c]).toBeCloseTo(2 * (gridX(g, c) / 1000) + 3 * (gridY(g, r) / 1000), 4);
    expect(gridX(g, 0) + gridX(g, 15)).toBeCloseTo(0, 6); // still centred on the pole
  });

  it('encodes slopes in the normal map along +column and +row', () => {
    const g = cutWindow(plane(), 0, 0, 16)!;
    const m = normalMap(g);
    const o = (8 * 16 + 8) * 4;
    // Height rises 2 m per km towards +x and 3 m per km towards +y (so falls along +row): the normal tilts to -x and to +row.
    const nx = (m[o] - 127.5) / 127.5, ny = (m[o + 1] - 127.5) / 127.5, nz = (m[o + 2] - 127.5) / 127.5;
    expect(nx).toBeLessThanOrEqual(0);
    expect(ny).toBeGreaterThanOrEqual(0);
    expect(nz).toBeGreaterThan(0.99);
    // A steep made-up ramp: 1 m per m towards +x gives a normal 45 degrees over towards -x.
    const ramp: PolarLayer = { size: 8, metresPerPx: 10, data: Float32Array.from({ length: 64 }, (_, i) => (i % 8) * 10), scale: 1, offset: 0 };
    const rm = normalMap(cutWindow(ramp, 0, 0, 8)!);
    const q = (4 * 8 + 4) * 4;
    expect((rm[q] - 127.5) / 127.5).toBeCloseTo(-Math.SQRT1_2, 1);
    expect((rm[q + 2] - 127.5) / 127.5).toBeCloseTo(Math.SQRT1_2, 1);
  });

  it('takes the curvature of the Moon off the heights and knows the projection scale', () => {
    // 10 degrees from the pole: the sphere lies R (1 - cos 10 deg) = 26.4 km below the plane through the pole.
    const rho = 2 * MOON_RADIUS_M * Math.tan((5 * Math.PI) / 180);
    const g = { n: 2, cellM: rho, x0: 0, y0: 0, h: Float32Array.from([0, 1000, 0, 0]) };
    const z = heightsAbovePolarPlane(g);
    expect(z[0]).toBeCloseTo(0, 3); // the pole itself
    expect(z[1]).toBeCloseTo((MOON_RADIUS_M + 1000) * Math.cos((10 * Math.PI) / 180) - MOON_RADIUS_M, 0);
    expect(groundScale(0, 0)).toBe(1);
    expect(groundScale(rho, 0)).toBeCloseTo(Math.cos((5 * Math.PI) / 180) ** 2, 12);
    expect(groundCell({ n: 3, cellM: 100, x0: -100, y0: 100, h: new Float32Array(9) })).toBe(100);
  });
});

describe('Sun shadows on the real south-polar grid', () => {
  it('keeps Shackleton crater\'s floor dark for every direction of the Sun, and lights the high ground nearby', async () => {
    // The 160 m LOLA layer at 640 m (the close-up's wide grid). Shackleton: 21 km across, floor 4 km below its rim, at 89.67S 129.78E.
    const stack = await loadTerrainFor({ id: 'pin:-90.00000,0.00000', name: 'pole', kind: 'custom', lat: -90, lon: 0 }, { remote: false });
    const coarse = stack.sources.map((s) => s.descriptor).filter((d) => d.kind === 'polar').sort((a, b) => b.metresPerPx - a.metresPerPx)[0];
    expect(coarse.metresPerPx).toBe(160);
    const g = decimate(coarse, 4);
    expect(g.n).toBe(950); // 3800 samples of 160 m, in blocks of 4
    const floor = polarXY('S', -89.625, 118.68);
    expect(gridHeight(g, floor.x, floor.y)).toBeLessThan(-2600); // T-4 measured -2871 m on the 40 m grid
    const z = heightsAbovePolarPlane(g);
    const [fc, fr] = gridCell(g, floor.x, floor.y).map(Math.round);
    const low = new Float32Array(g.n * g.n), high = new Float32Array(g.n * g.n), lit = new Uint8Array(g.n * g.n);
    // The Sun at its highest over the south pole (1.54 degrees), from twelve directions around the horizon.
    const el = (1.54 * Math.PI) / 180;
    let litSomewhere = 0, brightest = 0;
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6;
      sweepShadowHeight({ n: g.n, z, cellM: groundCell(g) }, Math.cos(a), Math.sin(a), Math.tan(el + SUN_RADIUS_RAD), low);
      sweepShadowHeight({ n: g.n, z, cellM: groundCell(g) }, Math.cos(a), Math.sin(a), Math.tan(el - SUN_RADIUS_RAD), high);
      litFraction(z, low, high, lit);
      expect(lit[fr * g.n + fc]).toBe(0); // permanently shadowed
      // Within 60 km of the pole a good share of the ground is in sunlight, and a good share in shadow.
      let on = 0, count = 0;
      for (let r = 380; r < 570; r += 3) for (let c = 380; c < 570; c += 3) { count++; if (lit[r * g.n + c] > 128) on++; }
      expect(on / count).toBeGreaterThan(0.02);
      expect(on / count).toBeLessThan(0.7);
      litSomewhere += on;
      brightest = Math.max(brightest, on / count);
    }
    expect(litSomewhere).toBeGreaterThan(0);
    expect(brightest).toBeGreaterThan(0.1);
  }, 60_000);
});
