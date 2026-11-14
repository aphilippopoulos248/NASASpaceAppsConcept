import { afterEach, describe, expect, it } from 'vitest';
import { loadTerrainFor, setTerrainWindowFetcher } from './api';
import { offsetPoint } from './geo';
import { decodeLxg } from './lxg';
import { syntheticArchive, syntheticHeight } from './testArchive';
import { buildSiteWindow, packSiteWindow, WINDOW_SIZE } from './windowBuilder';

/** Largest difference between a built window and the function the archive was made from, metres. */
async function worstError(lat: number, lon: number): Promise<{ worst: number[]; products: string[][]; holes: number; requests: number; files: string[] }> {
  const archive = syntheticArchive();
  const w = await buildSiteWindow(archive.read, lat, lon);
  const c = (WINDOW_SIZE - 1) / 2;
  let holes = 0;
  const worst = w.levels.map((level) => {
    let m = 0;
    for (let j = 0; j < WINDOW_SIZE; j++) {
      for (let i = 0; i < WINDOW_SIZE; i++) {
        const v = level.data[j * WINDOW_SIZE + i];
        if (Number.isNaN(v)) {
          holes++;
          continue;
        }
        const p = offsetPoint(lat, lon, (i - c) * level.spacingM, (j - c) * level.spacingM);
        m = Math.max(m, Math.abs(v - syntheticHeight(p.lat, p.lon)));
      }
    }
    return m;
  });
  return { worst, products: w.levels.map((l) => l.products), holes, requests: w.requests, files: [...new Set(archive.log.map((r) => r.file))].sort() };
}

describe('buildSiteWindow against a synthetic archive', () => {
  it('equatorial site: SLDEM2015 only, one tile', async () => {
    const r = await worstError(0.6742, 23.4731);
    expect(r.products).toEqual([['SLDEM2015 512 ppd'], ['SLDEM2015 512 ppd']]);
    // 0.67N with 30.7 km of reach: the window crosses the equator, so two latitude bands are read.
    expect(r.files).toEqual(['sldem2015_512_00n_30n_000_045_float.img', 'sldem2015_512_30s_00s_000_045_float.img']);
    expect(r.holes).toBe(0);
    // float32 kilometres in the tiles: a few centimetres of rounding, nothing more.
    expect(Math.max(...r.worst)).toBeLessThan(0.05);
    // One range request per source line read, as in the script that built the bundled windows.
    expect(r.requests).toBeGreaterThan(250);
    expect(r.requests).toBeLessThan(290);
  });

  it('follows the ground across tile edges, the equator, the band edges and the 0/360 seam', async () => {
    for (const [lat, lon, files] of [
      [10, 0.2, 2], // the prime meridian: tiles 000_045 and 315_360
      [-30.001, 44.99, 4], // a corner where two bands and two tiles meet
      [0.01, -90.3, 4], // the equator and the tile edge at 270E
      [45, 179.95, 2], // the antimeridian is an ordinary tile edge at 180E
      [-58.5, 301.2, 1],
    ] as const) {
      const r = await worstError(lat, lon);
      expect(r.products[0], `${lat},${lon}`).toEqual(['SLDEM2015 512 ppd']);
      expect(r.files.length, `${lat},${lon} files`).toBe(files);
      expect(r.holes).toBe(0);
      expect(Math.max(...r.worst), `${lat},${lon}`).toBeLessThan(0.05);
    }
  });

  it('polar sites use the LOLA polar grids in their own projection, both poles', async () => {
    for (const [lat, lon, product] of [
      [-84.79, 29.2, 'LOLA LDEM_80S_20M'],
      [-89.99, 17, 'LOLA LDEM_80S_20M'],
      [-90, 0, 'LOLA LDEM_80S_20M'],
      [-69.3741, 32.32, 'LOLA LDEM_60S_60M'],
      [88, -120, 'LOLA LDEM_80N_20M'],
      [90, 55, 'LOLA LDEM_80N_20M'],
      [72, -179.95, 'LOLA LDEM_60N_60M'],
    ] as const) {
      const r = await worstError(lat, lon);
      expect(r.products, `${lat},${lon}`).toEqual([[product], [product]]);
      expect(r.holes).toBe(0);
      // int16 half-metres in the source: up to 0.25 m of rounding.
      expect(Math.max(...r.worst), `${lat},${lon}`).toBeLessThan(0.3);
    }
  });

  it('stitches a window that straddles two products, leaving no holes', async () => {
    // 60S/60N on a grid axis: SLDEM2015 ends, the 60 m polar grid begins, and the 100 m polar grid bridges the seam between them.
    for (const [lat, lon] of [[-60.2, 0], [-59.7, 90], [59.6, 90], [60.05, -90], [-60, 180]] as const) {
      const r = await worstError(lat, lon);
      const cap = lat < 0 ? 'S' : 'N';
      expect(new Set(r.products.flat()), `${lat},${lon}`).toEqual(new Set(['SLDEM2015 512 ppd', `LOLA LDEM_60${cap}_60M`, `LOLA LDEM_45${cap}_100M`]));
      expect(r.products[0][0]).toBe(Math.abs(lat) > 60 ? `LOLA LDEM_60${cap}_60M` : 'SLDEM2015 512 ppd');
      expect(r.holes).toBe(0);
      expect(Math.max(...r.worst), `${lat},${lon}`).toBeLessThan(0.3);
    }
    // Towards a corner of the polar square (45 degrees off the axes) the 60 m grid reaches far past 60N: no stitching needed.
    const diagonal = await worstError(60.05, -45);
    expect(diagonal.products).toEqual([['LOLA LDEM_60N_60M'], ['LOLA LDEM_60N_60M']]);
    expect(Math.max(...diagonal.worst)).toBeLessThan(0.3);
    // 80.6S on a grid axis: the 30 km grid pokes out of the 20 m product's square, the 60 m product takes over.
    const r = await worstError(-80.7, 0);
    expect(r.products).toEqual([['LOLA LDEM_80S_20M'], ['LOLA LDEM_80S_20M', 'LOLA LDEM_60S_60M']]);
    expect(r.holes).toBe(0);
    expect(Math.max(...r.worst)).toBeLessThan(0.3);
  });

  it('records how much of the source the coarse grid skips', async () => {
    const archive = syntheticArchive();
    const sldem = await buildSiteWindow(archive.read, 20, 100);
    expect(sldem.levels.map((l) => [l.spacingM, l.step])).toEqual([[60, 1], [480, 8]]);
    const polar = await buildSiteWindow(archive.read, -85, 100);
    expect(polar.levels.map((l) => [l.spacingM, l.step])).toEqual([[60, 3], [480, 23]]);
    expect(polar.size).toBe(129);
  });

  it('passes archive failures on and rejects impossible coordinates', async () => {
    await expect(buildSiteWindow(async () => Promise.reject(new Error('HTTP 503')), 10, 10)).rejects.toThrow('HTTP 503');
    await expect(buildSiteWindow(syntheticArchive().read, 95, 0)).rejects.toThrow(/bad coordinates/);
  });
});

describe('from the archive to the analysis: build, pack, load', () => {
  afterEach(() => setTerrainWindowFetcher(undefined));

  it('a packed window says what it is made of', async () => {
    const { header, arrays } = await decodeLxg(packSiteWindow(await buildSiteWindow(syntheticArchive().read, -60.2, 0)));
    expect(header.grids.map((g) => [g.kind, g.width, g.height, g.spacingM, g.lat0, g.lon0])).toEqual([['local', 129, 129, 60, -60.2, 0], ['local', 129, 129, 480, -60.2, 0]]);
    expect(header.grids[0].name).toBe('LOLA LDEM_60S_60M, 60 m site window (built on request)');
    expect(header.grids[1].name).toBe('LOLA LDEM_60S_60M + SLDEM2015 512 ppd + LOLA LDEM_45S_100M, 480 m site window (built on request)');
    expect(header.notes).toEqual([
      'Site window built on request from LOLA LDEM_60S_60M and SLDEM2015 512 ppd and LOLA LDEM_45S_100M (NASA PDS): 60 m samples to 3.84 km, 480 m samples to 30.72 km around the point. The 480 m grid reads every 8th source sample; it is not an average.',
      'This window crosses the edge of an archive product and is stitched from more than one; steps of a few metres can occur along the join.',
    ]);
    expect(arrays.every((a) => a instanceof Float32Array && a.length === 129 * 129)).toBe(true);
    expect((header.grids[1].provenance as { citation: string }).citation).toMatch(/Barker.*Smith/);
  });

  it('loadTerrainFor turns the server\'s answer into sources that reproduce the archive', async () => {
    const archive = syntheticArchive();
    setTerrainWindowFetcher(async (lat, lon) => packSiteWindow(await buildSiteWindow(archive.read, lat, lon)).buffer as ArrayBuffer);
    const lat = 33.3;
    const lon = -77.7;
    const stack = await loadTerrainFor({ id: 'pin:33.30000,-77.70000', name: 'Custom pin', kind: 'custom', lat, lon });
    const [w60, w480, global] = stack.sources;
    expect(stack.sources.map((x) => Math.round(x.resolutionM))).toEqual([60, 480, 1895]);
    expect(w60.name).toBe('SLDEM2015 512 ppd, 60 m site window (built on request)');
    expect(w60.provenance?.product).toBe('SLDEM2015 512 ppd (NASA PDS Geosciences Node)');
    for (const [e, n] of [[0, 0], [1234.5, -3210], [-3839, 3839], [20000, -25000], [-30719, 30719]]) {
      const p = offsetPoint(lat, lon, e, n);
      const src = Math.max(Math.abs(e), Math.abs(n)) <= 3840 ? w60 : w480;
      // Bilinear between samples of a smooth function: millimetres.
      expect(Math.abs(src.sample(p.lat, p.lon) - syntheticHeight(p.lat, p.lon)), `${e},${n}`).toBeLessThan(0.01);
    }
    expect(global.descriptor.kind).toBe('equirect');
    expect(stack.notes.join(' ')).toMatch(/Site window built on request from SLDEM2015 512 ppd \(NASA PDS\): 60 m samples to 3\.84 km, 480 m samples to 30\.72 km/);
    expect(stack.notes.join(' ')).not.toMatch(/No high-resolution survey/);
  });

  it('does not ask the server where a bundled polar layer is already finer than the window', async () => {
    const asked: string[] = [];
    const archive = syntheticArchive();
    setTerrainWindowFetcher(async (lat, lon) => {
      asked.push(`${lat},${lon}`);
      return packSiteWindow(await buildSiteWindow(archive.read, lat, lon)).buffer as ArrayBuffer;
    });
    // 60 km from the pole: the 40 m layer covers the whole 30.7 km window.
    const deep = await loadTerrainFor({ id: 'pin:a', name: 'pin', kind: 'custom', lat: -89.45, lon: -137.2 });
    expect(asked).toEqual([]);
    expect(deep.sources.map((x) => Math.round(x.resolutionM))).toEqual([40, 80, 160, 1895]);
    // 60 km inside the edge of the 40 m square is not enough everywhere: 88S on an axis is 15 km from its edge.
    const edge = await loadTerrainFor({ id: 'pin:b', name: 'pin', kind: 'custom', lat: -88, lon: 90 });
    expect(asked).toEqual(['-88,90']);
    expect(edge.sources.map((x) => Math.round(x.resolutionM))).toEqual([40, 60, 80, 160, 480, 1895]);
  });
});
