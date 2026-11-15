// Landing-region slope and roughness (T-72): synthetic grids with known answers, then real
// catalogued sites read from public/ (one with a 3 m LROC model, one with the 60 m window only,
// and a custom pin with the whole-Moon grid only).
import { describe, expect, it } from 'vitest';
import type { SiteRef } from '../core/types';
import { loadTerrainFor, storedGrid } from './api';
import { offsetPoint, polarLatLon } from './geo';
import { readTerrainJson } from './reader';
import { loadRegionTerrain, MAX_RADIUS_M, regionTerrainMetrics, ROUGHNESS_MAX_SPACING_M } from './region';
import { createSource } from './sources';
import type { HeightSource, TerrainStack } from './types';

const DEG = Math.PI / 180;
const CENTRE = { lat: 10, lon: 20 };

/** A square east/north window around (lat0, lon0) with heights f(east, north). */
function localGrid(n: number, spacingM: number, f: (e: number, nM: number) => number, opts: { lat0?: number; lon0?: number; name?: string; resolutionM?: number } = {}): HeightSource {
  const c = (n - 1) / 2;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = f((i - c) * spacingM, (j - c) * spacingM);
  return createSource({ kind: 'local', name: opts.name ?? `test ${spacingM} m window`, resolutionM: opts.resolutionM ?? spacingM, lat0: opts.lat0 ?? CENTRE.lat, lon0: opts.lon0 ?? CENTRE.lon, n, spacingM, data });
}

/** An equirectangular grid of `ppd` samples per degree over the given bounds, heights f(lat, lon). */
function equirectGrid(ppd: number, b: { latN: number; latS: number; lonW: number; lonE: number }, f: (lat: number, lon: number) => number, name = 'test equirect grid'): HeightSource {
  const width = Math.round((b.lonE - b.lonW) * ppd), height = Math.round((b.latN - b.latS) * ppd);
  const data = new Float32Array(width * height);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) data[j * width + i] = f(b.latN - (j + 0.5) / ppd, b.lonW + (i + 0.5) / ppd);
  return createSource({ kind: 'equirect', name, resolutionM: (DEG / ppd) * 1_737_400, width, height, ...b, data, scale: 1, offset: 0 });
}

const stackOf = (...sources: HeightSource[]): TerrainStack => ({ sources, notes: [] });

/** Deterministic standard normal deviates (mulberry32 + Box-Muller). */
function gaussian(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

describe('regionTerrainMetrics on synthetic grids', () => {
  it('a flat plane: slope 0, roughness 0, nothing over the limit', () => {
    const r = regionTerrainMetrics(stackOf(localGrid(129, 3, () => -1200)), CENTRE, 100, 8);
    expect(r.demName).toBe('test 3 m window');
    expect(r.gridSpacingM).toBe(3);
    expect(r.samples).toBeGreaterThan(Math.PI * (100 / 3) ** 2 * 0.97);
    expect(r.samples).toBeLessThan(Math.PI * (100 / 3) ** 2 * 1.03);
    expect(r.slopeDeg).toBeCloseTo(0, 6);
    expect(r.roughnessM).toBeCloseTo(0, 6);
    expect(r.hazardFraction).toBe(0);
    expect(r).toMatchObject({ lat: CENTRE.lat, lon: CENTRE.lon, radiusM: 100 });
    expect(r.notes[0]).toMatch(/^Measured on test 3 m window \(3 m spacing\): \d+ samples within 100 m of the centre\.$/);
    expect(r.notes[1]).toMatch(/^Slope: 0\.0°, the 95th percentile of \d+ local slopes, each measured across one 3 m grid cell/);
    expect(r.notes[2]).toMatch(/^Roughness: 0\.00 m/);
    expect(r.notes[3]).toMatch(/^0 % of the local slopes .* steeper than the 8° limit\.$/);
    expect(r.notes.at(-1)).toMatch(/boulders and craters narrower than about 6 m are not resolved/);
  });

  it('a tilted plane: its tilt, in any direction, and the share over the limit', () => {
    for (const [tiltDeg, azDeg] of [[10, 90], [4, 0], [25, 213]]) {
      const g = Math.tan(tiltDeg * DEG);
      const fall = (e: number, n: number) => -g * (e * Math.sin(azDeg * DEG) + n * Math.cos(azDeg * DEG));
      const r = regionTerrainMetrics(stackOf(localGrid(257, 3, (e, n) => 300 + fall(e, n))), CENTRE, 150, 8);
      // Heights are stored as float32: the 95th percentile picks up the upper tail of their rounding (under 0.001 degree).
      expect(r.slopeDeg!).toBeCloseTo(tiltDeg, 2);
      expect(r.roughnessM!).toBeLessThan(1e-3);
      expect(r.hazardFraction).toBe(tiltDeg > 8 ? 1 : 0);
      expect(r.notes[1]).toContain(`best-fit plane tilts ${tiltDeg.toFixed(1)}°`);
    }
  });

  it('noise: the RMS about the plane is the noise level, on a tilt or not', () => {
    for (const [sigma, tilt] of [[0.5, 0], [2, 0.1]]) {
      const n = gaussian(7);
      const r = regionTerrainMetrics(stackOf(localGrid(257, 3, (e) => -500 + tilt * e + sigma * n())), CENTRE, 300, null);
      expect(r.samples).toBeGreaterThan(30_000);
      expect(r.roughnessM! / sigma).toBeGreaterThan(0.98);
      expect(r.roughnessM! / sigma).toBeLessThan(1.02);
      // No limit given: no share over it.
      expect(r.hazardFraction).toBeNull();
      expect(r.notes.some((s) => /steeper than/.test(s))).toBe(false);
    }
  });

  it('the 95th percentile: half the region flat and half at 15 degrees reads 15, with half over a 10 degree limit', () => {
    const g = Math.tan(15 * DEG);
    const r = regionTerrainMetrics(stackOf(localGrid(129, 3, (e) => (e > 0 ? -g * e : 0))), CENTRE, 90, 10);
    expect(r.slopeDeg!).toBeCloseTo(15, 3);
    expect(r.hazardFraction!).toBeGreaterThan(0.47);
    expect(r.hazardFraction!).toBeLessThan(0.53);
  });

  it('a 60 m grid and a 100 m region: few cells, so the steepest; roughness from 9 samples; narrower than a cell, no slope', () => {
    const grid = localGrid(129, 60, (e) => 0.05 * e);
    const r = regionTerrainMetrics(stackOf(grid), CENTRE, 100, 15);
    expect(r.samples).toBe(9);
    expect(r.notes[1]).toMatch(/^Slope: 2\.9°, the steepest of 12 local slopes \(too few for a percentile\), each measured across one 60 m grid cell/);
    expect(r.slopeDeg!).toBeCloseTo(Math.atan(0.05) / DEG, 4);
    expect(r.roughnessM!).toBeCloseTo(0, 4);
    const n = gaussian(3);
    const rough = regionTerrainMetrics(stackOf(localGrid(129, 60, (e) => 0.05 * e + 3 * n())), CENTRE, 100, 15);
    expect(rough.roughnessM!).toBeGreaterThan(0.5);
    expect(rough.roughnessM!).toBeLessThan(10);
    expect(r.notes.at(-1)).toMatch(/^At 60 m spacing, metre-scale rocks and craters are invisible/);

    const small = regionTerrainMetrics(stackOf(grid), CENTRE, 50, 15);
    expect(small.samples).toBe(1);
    expect(small.slopeDeg).not.toBeNull();
    expect(small.roughnessM).toBeNull();
    expect(small.notes[2]).toMatch(/^Roughness: not measured\. The region holds 1 sample of the 60 m grid, too few/);

    const tiny = regionTerrainMetrics(stackOf(grid), CENTRE, 25, 15);
    expect(tiny.slopeDeg).toBeNull();
    expect(tiny.hazardFraction).toBeNull();
    expect(tiny.notes[1]).toMatch(/^Slope: not measured\. The region \(50 m across\) is narrower than one spacing of the finest grid that covers it \(60 m\)/);
  });

  it('a coarse grid: roughness null with the reason; slope only where the region is wider than a cell', () => {
    // 16 samples per degree as the whole-Moon grid (1.9 km), heights rising 1000 m per degree of latitude.
    const coarse = equirectGrid(16, { latN: 15, latS: 5, lonW: 15, lonE: 25 }, (lat) => 1000 * lat, 'test 1.9 km grid');
    expect(coarse.resolutionM).toBeGreaterThan(ROUGHNESS_MAX_SPACING_M);
    const small = regionTerrainMetrics(stackOf(coarse), CENTRE, 100, 10);
    expect(small.gridSpacingM).toBeCloseTo(1895.2, 0);
    expect(small.roughnessM).toBeNull();
    expect(small.slopeDeg).toBeNull();
    expect(small.notes[2]).toMatch(/^Roughness: not measured\. The finest grid that covers the region has 1\.9 km spacing, coarser than the 100 m limit/);
    expect(small.notes.at(-1)).toMatch(/^At 1\.9 km spacing everything narrower than about 3\.8 km is averaged away/);

    const wide = regionTerrainMetrics(stackOf(coarse), CENTRE, 15_000, 10);
    expect(wide.roughnessM).toBeNull();
    // 1000 m per degree of latitude, i.e. per 30.32 km.
    expect(wide.slopeDeg!).toBeCloseTo(Math.atan(1000 / (DEG * 1_737_400)) / DEG, 2);
    expect(wide.samples).toBeGreaterThan(150);
  });

  it('a whole-Moon grid reaches across a pole', () => {
    const globe = equirectGrid(4, { latN: 90, latS: -90, lonW: -180, lonE: 180 }, () => 250, 'test whole-Moon grid');
    for (const lat of [90, 89.95, -89.99]) {
      const r = regionTerrainMetrics(stackOf(globe), { lat, lon: 179.9 }, 20_000, 5);
      expect(r.slopeDeg).toBeCloseTo(0, 6);
      expect(r.samples).toBeGreaterThan(10);
    }
  });

  it('a polar stereographic grid: its tilt, and no data means not covered', () => {
    const size = 201, m = 40, c = size / 2 - 0.5;
    const g = Math.tan(6 * DEG);
    const data = new Float32Array(size * size);
    // Rising with map x (sample index); ground distances are map distances over the projection's scale, 1 + tiny here.
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) data[j * size + i] = -2000 + g * (i - c) * m;
    const polar = createSource({ kind: 'polar', name: 'test polar grid', resolutionM: m, pole: 'S', size, metresPerPx: m, data, scale: 1, offset: 0 });
    const centre = polarLatLon('S', 1500, -800);
    const r = regionTerrainMetrics(stackOf(polar), centre, 500, 5);
    expect(r.gridSpacingM).toBeCloseTo(40, 3);
    expect(r.slopeDeg!).toBeCloseTo(6, 3);
    expect(r.roughnessM!).toBeLessThan(1e-3);
    expect(r.hazardFraction).toBe(1);

    // A hole in the data inside the region: the polar grid does not cover it, and the coarser grid takes over.
    const holed = new Float32Array(data);
    const at = { i: Math.round(c + 1500 / m), j: Math.round(c + 800 / m) };
    holed[at.j * size + at.i] = -32768;
    const withHole = createSource({ kind: 'polar', name: 'test polar grid with a hole', resolutionM: m, pole: 'S', size, metresPerPx: m, data: holed, scale: 1, offset: 0, nodata: -32768 });
    const globe = equirectGrid(4, { latN: 90, latS: -90, lonW: -180, lonE: 180 }, () => 250, 'test whole-Moon grid');
    const fallback = regionTerrainMetrics(stackOf(withHole, globe), centre, 500, 5);
    expect(fallback.demName).toBe('test whole-Moon grid');
    expect(fallback.notes[0]).toContain('test polar grid with a hole covers only part of the region (it has no data over part of it)');
  });

  it('the finest grid that covers the whole region, saying which finer one stops short', () => {
    const fine = localGrid(101, 3, () => 0, { name: 'fine' }); // reaches 150 m from its centre
    const mid = localGrid(129, 60, () => 0, { name: 'mid' });
    const globe = equirectGrid(4, { latN: 90, latS: -90, lonW: -180, lonE: 180 }, () => 0, 'globe');
    const stack = stackOf(fine, mid, globe);
    expect(regionTerrainMetrics(stack, CENTRE, 100, null).demName).toBe('fine');
    const wider = regionTerrainMetrics(stack, CENTRE, 200, null);
    expect(wider.demName).toBe('mid');
    expect(wider.notes[0]).toContain('Finer data here does not reach over the whole region: fine covers only part of the region (it ends about 150 m from the centre).');
    // Off-centre: 100 m east of the fine grid's centre, a 100 m region runs past its edge.
    const east = offsetPoint(CENTRE.lat, CENTRE.lon, 100, 0);
    const off = regionTerrainMetrics(stack, east, 100, null);
    expect(off.demName).toBe('mid');
    expect(off.notes[0]).toContain('it ends about 50 m from the centre');
    // Out of every local grid: the whole-Moon grid.
    expect(regionTerrainMetrics(stack, { lat: -40, lon: 100 }, 100, null).demName).toBe('globe');
    // The stack's order does not matter: finest first.
    expect(regionTerrainMetrics(stackOf(globe, mid, fine), CENTRE, 100, null).demName).toBe('fine');
  });

  it('never mixes grids: a 20 m step where the fine grid meets the coarse one does not read as slope', () => {
    const fine = localGrid(257, 3, () => 0, { name: 'fine' }); // reaches 384 m from its centre
    const coarse = localGrid(129, 60, () => 20, { name: 'coarse' });
    const stack = stackOf(fine, coarse);
    // The two grids disagree by 20 m, so the stack steps by 20 m at the fine grid's edge.
    expect(fine.sample(CENTRE.lat, CENTRE.lon) - coarse.sample(CENTRE.lat, CENTRE.lon)).toBe(-20);
    const inside = regionTerrainMetrics(stack, CENTRE, 300, 5);
    const across = regionTerrainMetrics(stack, CENTRE, 450, 5);
    expect(inside.demName).toBe('fine');
    expect(across.demName).toBe('coarse');
    for (const r of [inside, across]) {
      expect(r.slopeDeg).toBeCloseTo(0, 6);
      expect(r.roughnessM).toBeCloseTo(0, 6);
      expect(r.hazardFraction).toBe(0);
    }
    expect(across.notes[0]).toContain('The region is measured on this grid alone, so the height step where a finer grid ends does not count as slope or roughness.');
  });

  it('refuses bad input, and says so when nothing covers the region', () => {
    const stack = stackOf(localGrid(65, 3, () => 0));
    for (const radius of [0, -5, NaN, Infinity, MAX_RADIUS_M + 1]) expect(() => regionTerrainMetrics(stack, CENTRE, radius, null)).toThrow(RangeError);
    for (const limit of [-1, 90, NaN]) expect(() => regionTerrainMetrics(stack, CENTRE, 50, limit)).toThrow(RangeError);
    expect(() => regionTerrainMetrics(stack, { lat: 95, lon: 0 }, 50, null)).toThrow(RangeError);
    expect(() => regionTerrainMetrics(stack, CENTRE, 500, null)).toThrow(/No elevation grid covers the whole landing region \(500 m around 10\.0000, 20\.0000\)/);
    expect(() => regionTerrainMetrics(stackOf(), CENTRE, 50, null)).toThrow(/No elevation grid covers/);
  });
});

// ---------------------------------------------------------------- real data (public/)

interface Index {
  sites: Record<string, { lat: number; lon: number; fine?: unknown }>;
}
const index = await readTerrainJson<Index>('terrain/index.json');
const landing = (id: string): SiteRef => ({ id, name: id, kind: 'landing', lat: index.sites[id].lat, lon: index.sites[id].lon });
const show = (id: string, r: Awaited<ReturnType<typeof loadRegionTerrain>>) =>
  console.info(`${id}: ${JSON.stringify({ demName: r.demName, gridSpacingM: r.gridSpacingM, samples: r.samples, slopeDeg: r.slopeDeg, roughnessM: r.roughnessM, hazardFraction: r.hazardFraction })}\n  ${r.notes.join('\n  ')}`);

describe('loadRegionTerrain at real sites', () => {
  it('Apollo 11: the 3 m LROC model, thousands of samples, a mare plain with a few steep crater walls', async () => {
    const r = await loadRegionTerrain(landing('apollo-11'), 100, 10);
    show('apollo-11', r);
    expect(index.sites['apollo-11'].fine).toBeDefined();
    expect(r.demName).toMatch(/^LROC NAC DTM NAC_DTM_APOLLO11_\S+ \(2\.0 m\), 3 m site window$/);
    expect(r.gridSpacingM).toBe(3);
    expect(r.samples).toBeGreaterThan(3400);
    expect(r.samples).toBeLessThan(3600);
    expect(r.slopeDeg!).toBeGreaterThan(1);
    expect(r.slopeDeg!).toBeLessThan(15);
    expect(r.roughnessM!).toBeGreaterThan(0.1);
    expect(r.roughnessM!).toBeLessThan(5);
    expect(r.hazardFraction!).toBeLessThan(0.2);
    expect(r.notes[1]).toMatch(/^Slope: .*95th percentile/);
    // The same stack as the analysis uses, measured the same way.
    expect(regionTerrainMetrics(await loadTerrainFor(landing('apollo-11')), landing('apollo-11'), 100, 10)).toEqual(r);
  });

  it('Apollo 17 with its 3 m model eased onto the 60 m window: measured as stored, the blend band left out', async () => {
    const site = landing('apollo-17');
    const eased = await loadTerrainFor(site, { easeEdges: true });
    const stored = await loadTerrainFor(site);
    expect(storedGrid(eased.sources[0])).not.toBe(eased.sources[0]);
    // 700 m reaches into the band the easing changed (the model's outer 129 m, from 639 m).
    const a = regionTerrainMetrics(eased, site, 700, 10), b = regionTerrainMetrics(stored, site, 700, 10);
    expect(a.gridSpacingM).toBe(3);
    expect({ ...a, notes: [] }).toEqual({ ...b, notes: [] });
    expect(a.notes[0]).toContain('read as stored, not as the copy eased onto the grid around it');
    expect(b.notes[0]).not.toContain('eased');
  });

  it('IM-2: only the 60 m window (from LOLA polar data), a handful of samples, the resolution caveat', async () => {
    const r = await loadRegionTerrain(landing('im-2'), 100, 10);
    show('im-2', r);
    expect(index.sites['im-2'].fine).toBeUndefined();
    expect(r.demName).toBe('LOLA LDEM_80S_20M, 60 m site window');
    expect(r.gridSpacingM).toBe(60);
    expect(r.samples).toBeGreaterThanOrEqual(8);
    expect(r.samples).toBeLessThanOrEqual(12);
    expect(r.slopeDeg!).toBeGreaterThan(0.5);
    expect(r.slopeDeg!).toBeLessThan(20);
    expect(r.roughnessM!).toBeGreaterThan(0.05);
    expect(r.roughnessM!).toBeLessThan(10);
    expect(r.notes.at(-1)).toMatch(/metre-scale rocks and craters are invisible/);
    // A region wider than the 60 m window: the 80 m polar grid of LOLA takes over.
    const wide = await loadRegionTerrain(landing('im-2'), 5000, 10);
    expect(wide.demName).toMatch(/^LOLA south pole, 85S square at 80 m/);
    expect(wide.notes[0]).toContain('LOLA LDEM_80S_20M, 60 m site window covers only part of the region');
  });

  it('a far-side pin with only the whole-Moon grid: slope and roughness unknown, with the reasons', async () => {
    const pin: SiteRef = { id: 'pin:10.00000,150.00000', name: 'Custom pin', kind: 'custom', lat: 10, lon: 150 };
    const r = await loadRegionTerrain(pin, 100, 10);
    show('pin 10N 150E', r);
    expect(r.demName).toMatch(/whole-Moon grid, 16 px\/deg/);
    expect(r.gridSpacingM).toBeGreaterThan(1800);
    expect(r.slopeDeg).toBeNull();
    expect(r.roughnessM).toBeNull();
    expect(r.hazardFraction).toBeNull();
    expect(r.notes[1]).toMatch(/^Slope: not measured/);
    expect(r.notes[2]).toMatch(/^Roughness: not measured/);
  });
});
