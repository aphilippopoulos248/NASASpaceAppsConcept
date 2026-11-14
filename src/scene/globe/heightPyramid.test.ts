import { describe, expect, it } from 'vitest';
import { loadGlobalGrid } from '../../terrain/api';
import { halve, HeightPyramid, type EquirectGrid } from './heightPyramid';

/** A grid whose height is a known function of its pixel centres. */
function grid(ppd: number, f: (lat: number, lon: number) => number, scale = 0.5, offset = 0): EquirectGrid {
  const width = 360 * ppd, height = 180 * ppd;
  const data = new Int16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = Math.round((f(90 - (y + 0.5) / ppd, -180 + (x + 0.5) / ppd) - offset) / scale);
  return { width, height, data, scale, offset };
}

describe('height pyramid', () => {
  it('reads pixel centres exactly and interpolates between them, wrapping at 180 degrees', () => {
    const p = new HeightPyramid();
    p.add(grid(1, (lat, lon) => 100 * lat + lon), 1);
    expect(p.ppds).toEqual([1]);
    expect(p.sample(10.5, 20.5)).toBeCloseTo(1070.5, 6);
    expect(p.sample(10.25, 20.75)).toBeCloseTo(100 * 10.25 + 20.75, 6);
    // Across the seam the two neighbours are 179.5E and 179.5W: halfway between is their mean, not a jump.
    expect(p.sample(0.5, 180)).toBeCloseTo(50, 6);
    expect(p.sample(0.5, -180)).toBeCloseTo(50, 6);
    expect(p.sample(0.5, 540.5)).toBeCloseTo(p.sample(0.5, -179.5), 6);
  });

  it('gives each pole one height, whatever the longitude', () => {
    const p = new HeightPyramid();
    p.add(grid(1, (lat, lon) => (lat > 89 ? lon : 0)), 1);
    const at = [-170, -30, 0, 95, 180].map((lon) => p.sample(90, lon));
    for (const v of at) expect(v).toBeCloseTo(at[0], 9);
    expect(at[0]).toBeCloseTo(0, 6); // the mean of the northern row: longitudes cancel
    // Half-way between the pole and the last row of centres: half-way between their values.
    expect(p.sample(89.75, 95.5)).toBeCloseTo(95.5 / 2, 6);
    expect(p.sample(-90, 10)).toBe(0);
  });

  it('builds coarser levels as 2x2 means and reads the level that matches the wanted spacing', () => {
    // A checkerboard at 4 samples per degree: +100 / -100 m. Its 2x2 means are exactly 0.
    const fine = grid(4, (lat, lon) => ((Math.floor((90 - lat) * 4) + Math.floor((lon + 180) * 4)) % 2 ? 100 : -100));
    const half = halve(fine);
    expect(half.width).toBe(720);
    expect(Math.max(...Array.from(half.data.subarray(0, 2000)).map(Math.abs))).toBe(0);

    const p = new HeightPyramid();
    p.add(fine, 1);
    expect(p.ppds).toEqual([1, 2, 4]);
    expect(p.maxPpd).toBe(4);
    expect(Math.abs(p.sample(12.125, 33.125))).toBe(100); // finest level: the checkerboard itself
    expect(p.sample(12.125, 33.125, 2)).toBe(0); // a coarse tile reads the averaged level, not noise
    expect(p.sample(12.125, 33.125, 0.3)).toBe(0); // coarser than anything held: the coarsest level
    expect(p.levelFor(3)!.ppd).toBe(4);
    expect(p.levelFor(64)!.ppd).toBe(4);
  });

  it('keeps a level that came from its own product when a finer grid is added', () => {
    const p = new HeightPyramid();
    p.add(grid(2, () => 7), 1);
    p.add(grid(8, () => 9), 1);
    expect(p.ppds).toEqual([1, 2, 4, 8]);
    expect(p.sample(0.3, 0.3, 2)).toBe(7); // the 2 px/deg product itself
    expect(p.sample(0.3, 0.3, 4)).toBe(9); // filled in from the finer grid
    expect(new HeightPyramid().sample(1, 2)).toBe(0);
  });

  it('agrees with the terrain module on the bundled LOLA overview grid', async () => {
    const source = await loadGlobalGrid(4);
    const d = source.descriptor;
    if (d.kind !== 'equirect') throw new Error('expected an equirectangular grid');
    const p = new HeightPyramid();
    p.add(d, 1);
    expect(p.ppds).toEqual([1, 2, 4]);
    for (const [lat, lon] of [[0.67416, 23.47314], [-84.79, 29.2], [5.4, -158.6], [-45.4446, 177.5991], [89.9, 12], [-89.99, -75], [12.3, 179.99]]) {
      expect(p.sample(lat, lon)).toBeCloseTo(source.sample(lat, lon), 3);
    }
    // The Moon's highest ground (10.7 km, near 5.4N 158.6W) and the deep South Pole-Aitken floor read sensibly at 4 px/deg.
    expect(p.sample(5.4, -158.6)).toBeGreaterThan(8000);
    expect(p.sample(-70, -170)).toBeLessThan(-4000);
  });
});
