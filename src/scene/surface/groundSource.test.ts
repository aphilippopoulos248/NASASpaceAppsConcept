import { describe, expect, it } from 'vitest';
import type { HeightGridDescriptor, HeightSource, TerrainStack } from '../../terrain/types';
import { offsetLatLon } from './ground';
import { COARSE_LEVELS, describeGround, FINE_LEVEL, groundFromStack, type GroundBand } from './groundSource';

const R = 1_737_400;
const SITE = { id: 'pin:10.00000,20.00000', name: 'Test pin', lat: 10, lon: 20, kind: 'custom' as const };

/** Metres east / north of the site for a lat/lon (small-angle; good to centimetres over a few km). */
function local(lat: number, lon: number): { e: number; n: number } {
  const d2r = Math.PI / 180;
  return { e: (lon - SITE.lon) * d2r * R * Math.cos(SITE.lat * d2r), n: (lat - SITE.lat) * d2r * R };
}

/** A source defined by a height function, covering a square of the given half-width around the site (Infinity = everywhere). */
function source(name: string, resolutionM: number, halfM: number, h: (e: number, n: number) => number): HeightSource {
  const covers = (lat: number, lon: number) => {
    const p = local(lat, lon);
    return Math.max(Math.abs(p.e), Math.abs(p.n)) <= halfM;
  };
  return {
    name,
    resolutionM,
    descriptor: { kind: 'equirect', name, resolutionM, width: 1, height: 1, latN: 90, latS: -90, lonW: -180, lonE: 180, data: new Float32Array(1), scale: 1, offset: 0 },
    covers,
    sample: (lat, lon) => {
      if (!covers(lat, lon)) return NaN;
      const p = local(lat, lon);
      return h(p.e, p.n);
    },
  };
}

describe('groundFromStack', () => {
  it('uses the finest product at each point and says which one stands behind each band', async () => {
    const stack: TerrainStack = {
      sources: [source('Survey 2 m', 2, 500, () => 100), source('Window 60 m', 60, 3900, () => 50), source('Whole Moon 1.9 km', 1895, Infinity, () => -20)],
      notes: ['a note from the terrain service'],
    };
    const g = await groundFromStack(stack, SITE);
    expect(g.coarse.map((c) => c.spacing)).toEqual(COARSE_LEVELS.map((l) => l.spacing));
    // Fine grid: the survey where it reaches (500 m), the 60 m grid interpolated beyond.
    expect(g.fine).not.toBeNull();
    const fine = g.fine!, c = (FINE_LEVEL.n - 1) / 2;
    expect(fine.data[c * fine.n + c]).toBe(100);
    expect(fine.data[c * fine.n + c + 100]).toBe(100); // 300 m east
    expect(fine.data[c * fine.n + c + 250]).toBeCloseTo(50, 3); // 750 m east: past the survey
    expect(g.notes.some((t) => /survey covers/i.test(t))).toBe(true);
    expect(g.notes).toContain('a note from the terrain service');
    // 60 m grid: the 60 m window everywhere except its very centre, where the survey is averaged in.
    const l1 = g.coarse[0], c1 = (l1.n - 1) / 2;
    expect(l1.data[c1 * l1.n + c1 + 30]).toBeCloseTo(50, 3); // 1.8 km east
    expect(l1.data[c1 * l1.n + c1]).toBeCloseTo(100, 3);
    // 480 m grid beyond the window: the whole-Moon grid.
    const l2 = g.coarse[1], c2 = (l2.n - 1) / 2;
    expect(l2.data[c2 * l2.n + c2 + 40]).toBeCloseTo(-20, 3); // 19 km east
    // Bands: survey, window, whole Moon (twice); the last two are coarser than the grid drawn from them.
    expect(g.bands.map((b) => b.sources[0].name)).toEqual(['Survey 2 m', 'Window 60 m', 'Whole Moon 1.9 km', 'Whole Moon 1.9 km']);
    expect(g.bands.map((b) => b.interpolated)).toEqual([false, false, true, false]);
    expect(g.bands[3].toM).toBe(245760);
    expect(describeGround(g.bands)).toBe('Survey 2 m (2 m per sample) to 0.8 km; Window 60 m (60 m per sample) to 3.8 km; Whole Moon 1.9 km (1.9 km per sample), interpolated to 31 km; Whole Moon 1.9 km (1.9 km per sample) to 246 km');
  });

  it('has no fine grid where nothing finer than 10 m exists, and drops a far level no data reaches', async () => {
    const stack: TerrainStack = { sources: [source('Window 60 m', 60, 3900, (e) => e * 0.01), source('Window 480 m', 480, 31000, () => 7)], notes: [] };
    const g = await groundFromStack(stack, SITE);
    expect(g.fine).toBeNull();
    expect(g.coarse.map((c) => c.spacing)).toEqual([60, 480]);
    expect(g.notes.some((t) => /beyond 31 km is not drawn/.test(t))).toBe(true);
    expect(g.bands).toHaveLength(3);
    expect(g.bands[0]).toMatchObject({ fromM: 0, toM: 768, gridM: 3, interpolated: true });
    expect(g.bands[0].sources[0].name).toBe('Window 60 m');
  });

  it('takes a matching site window as it is, without resampling, and never edits the stack', async () => {
    const n = COARSE_LEVELS[0].n, spacing = COARSE_LEVELS[0].spacing;
    const data = new Float32Array(n * n).map((_, k) => Math.sin(k) * 30);
    const descriptor: HeightGridDescriptor = { kind: 'local', name: 'Site window 60 m', resolutionM: 60, lat0: SITE.lat, lon0: SITE.lon, n, spacingM: spacing, data };
    const window: HeightSource = { name: descriptor.name, resolutionM: 60, descriptor, covers: () => true, sample: () => 0 };
    const stack: TerrainStack = { sources: [window, source('Whole Moon 1.9 km', 1895, Infinity, () => 1)], notes: [] };
    const before = Array.from(data);
    const g = await groundFromStack(stack, SITE);
    expect(Array.from(g.coarse[0].data)).toEqual(before);
    g.coarse[0].data.fill(0);
    expect(Array.from(data)).toEqual(before); // a copy, not the shared array
  });

  it('averages a much finer product across a cell instead of taking one point', async () => {
    // 10 m stripes of +100 / -100 m: a single point sample would give +-100, the cell average is near zero.
    const stripes = source('Stripes 5 m', 5, Infinity, (e) => (Math.floor(e / 10) % 2 === 0 ? 100 : -100));
    const g = await groundFromStack({ sources: [stripes], notes: [] }, SITE);
    const l1 = g.coarse[0], c1 = (l1.n - 1) / 2;
    expect(Math.abs(l1.data[c1 * l1.n + c1 + 20])).toBeLessThan(60);
  });

  it('fills holes from coarser data and says so', async () => {
    const holed = source('Patchy 60 m', 60, 3900, (e) => (e > 0 ? NaN : 10));
    const g = await groundFromStack({ sources: [holed, source('Whole Moon 1.9 km', 1895, Infinity, () => 3)], notes: [] }, SITE);
    const l1 = g.coarse[0], c1 = (l1.n - 1) / 2;
    expect(l1.data[c1 * l1.n + c1 - 30]).toBeCloseTo(10, 3);
    expect(l1.data[c1 * l1.n + c1 + 30]).toBeCloseTo(3, 3); // from the whole-Moon grid: nothing invented
  });

  it('refuses when there is no elevation data at all', async () => {
    await expect(groundFromStack({ sources: [], notes: [] }, SITE)).rejects.toThrow(/No elevation data/);
    await expect(groundFromStack({ sources: [source('Elsewhere', 60, -1, () => 0)], notes: [] }, SITE)).rejects.toThrow(/No elevation data/);
  });
});

describe('describeGround', () => {
  it('merges neighbouring bands that rest on the same product', () => {
    const s = (name: string, resolutionM: number) => [{ name, resolutionM, share: 1 }];
    const bands: GroundBand[] = [
      { fromM: 0, toM: 768, gridM: 3, sources: s('LOLA whole-Moon grid', 1895), interpolated: true },
      { fromM: 768, toM: 3840, gridM: 60, sources: s('LOLA whole-Moon grid', 1895), interpolated: true },
      { fromM: 3840, toM: 30720, gridM: 480, sources: s('LOLA whole-Moon grid', 1895), interpolated: true },
      { fromM: 30720, toM: 245760, gridM: 1920, sources: s('LOLA whole-Moon grid', 1895), interpolated: false },
    ];
    expect(describeGround(bands)).toBe('LOLA whole-Moon grid (1.9 km per sample), interpolated to 31 km; LOLA whole-Moon grid (1.9 km per sample) to 246 km');
  });
});

describe('test helper', () => {
  it('agrees with the walk over the sphere used by the grids', () => {
    const p = offsetLatLon(SITE.lat, SITE.lon, 1200, -800);
    const back = local(p.lat, p.lon);
    expect(back.e).toBeCloseTo(1200, 0);
    expect(back.n).toBeCloseTo(-800, 0);
  });
});
