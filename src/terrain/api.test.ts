// Loader tests against the files actually shipped in public/ (read from disk under vitest).
import { afterEach, describe, expect, it } from 'vitest';
import type { SiteRef } from '../core/types';
import { clearTerrainCache, coverageRegions, loadTerrainFor, setTerrainReader, setTerrainWindowFetcher, sourceFromDescriptor, TerrainFileMissing } from './api';
import { offsetPoint } from './geo';
import { encodeLxg } from './lxg';
import { readPublicFile } from './nodeReader';
import { readTerrainJson } from './reader';

interface Index {
  size: number;
  levels: { spacing: number }[];
  sites: Record<string, { lat: number; lon: number; source: string; height: number; fine?: { size: number; spacing: number; source: string } }>;
}
const index = await readTerrainJson<Index>('terrain/index.json');
const landing = (id: string): SiteRef => ({ id, name: id, kind: 'landing', lat: index.sites[id].lat, lon: index.sites[id].lon });
const pin = (lat: number, lon: number): SiteRef => ({ id: `pin:${lat.toFixed(5)},${lon.toFixed(5)}`, name: 'Custom pin', kind: 'custom', lat, lon });

afterEach(() => {
  setTerrainReader(null);
  setTerrainWindowFetcher(undefined);
  clearTerrainCache();
});

describe('site windows (public/terrain)', () => {
  it('every catalogued site has its windows, centred where the index says, at the recorded height', async () => {
    const ids = Object.keys(index.sites);
    expect(ids).toHaveLength(28);
    for (const id of ids) {
      const entry = index.sites[id];
      const stack = await loadTerrainFor(landing(id));
      const local = stack.sources.filter((s) => s.descriptor.kind === 'local');
      expect(local.map((s) => s.resolutionM)).toEqual(entry.fine ? [expect.any(Number), 60, 480] : [60, 480]);
      // Finest first.
      for (let i = 1; i < local.length; i++) expect(local[i].resolutionM).toBeGreaterThanOrEqual(local[i - 1].resolutionM);
      const w60 = local.find((s) => s.resolutionM === 60)!;
      const w480 = local.find((s) => s.resolutionM === 480)!;
      // index.json records the 60 m window's centre height, rounded to the metre.
      expect(Math.abs(w60.sample(entry.lat, entry.lon) - entry.height)).toBeLessThanOrEqual(0.5);
      // The 480 m window is the same product read at every 8th sample and interpolated, so it
      // follows the 60 m window to within the local roughness (measured: 2-10 m RMS, 82 m worst case at IM-2).
      expect(Math.abs(w480.sample(entry.lat, entry.lon) - w60.sample(entry.lat, entry.lon)), `${id} centre`).toBeLessThan(10);
      let sum2 = 0;
      let worst = 0;
      let count = 0;
      for (let j = -7; j <= 7; j++) {
        for (let i = -7; i <= 7; i++) {
          const p = offsetPoint(entry.lat, entry.lon, i * 480, j * 480);
          const d = w480.sample(p.lat, p.lon) - w60.sample(p.lat, p.lon);
          sum2 += d * d;
          worst = Math.max(worst, Math.abs(d));
          count++;
        }
      }
      expect(Math.sqrt(sum2 / count), `${id} rms`).toBeLessThan(15);
      expect(worst, `${id} worst`).toBeLessThan(120);
      expect(w60.name).toMatch(/60 m site window/);
      expect(w60.provenance?.citation).toBeTruthy();
      // Reach: 3.84 km and 30.72 km from the centre, no further.
      const inside = offsetPoint(entry.lat, entry.lon, 3839, -3839);
      const outside = offsetPoint(entry.lat, entry.lon, 3841, 0);
      expect(w60.covers(inside.lat, inside.lon)).toBe(true);
      expect(w60.sample(outside.lat, outside.lon)).toBeNaN();
      expect(Number.isFinite(w480.sample(outside.lat, outside.lon))).toBe(true);
      const farOut = offsetPoint(entry.lat, entry.lon, 0, 30721);
      expect(w480.sample(farOut.lat, farOut.lon)).toBeNaN();
    }
  });

  it('a surveyed site also gets its 3 m LROC model, labelled with the real product and its true resolution', async () => {
    const stack = await loadTerrainFor(landing('apollo-17'));
    const [nac, w60] = stack.sources;
    expect(nac.name).toMatch(/^LROC NAC DTM NAC_DTM_APOLLO17_E203N0308\.IMG \(5\.0 m\), 3 m site window$/);
    expect(nac.resolutionM).toBe(5); // a 5 m model resampled to 3 m is still a 5 m model
    expect((await loadTerrainFor(landing('apollo-11'))).sources[0].resolutionM).toBe(3);
    const d = nac.descriptor;
    expect(d.kind === 'local' && d.n).toBe(513);
    // The 3 m model was tied to the 60 m model on average, so the two agree to within the local roughness.
    const site = index.sites['apollo-17'];
    expect(Math.abs(nac.sample(site.lat, site.lon) - w60.sample(site.lat, site.lon))).toBeLessThan(30);
    const edge = offsetPoint(site.lat, site.lon, 769, 0);
    expect(nac.sample(edge.lat, edge.lon)).toBeNaN();
    expect(stack.notes[0]).toMatch(/^Elevation data at this point, finest first: LROC NAC DTM/);
    expect(stack.notes[0]).toMatch(/to about 0\.77 km/);
  });

  it('descriptors survive a structured clone (posting to a worker) and rebuild into equal sources', async () => {
    const stack = await loadTerrainFor(landing('im-2'));
    const site = index.sites['im-2'];
    for (const s of stack.sources.filter((x) => x.descriptor.kind === 'local')) {
      const twin = sourceFromDescriptor(structuredClone(s.descriptor));
      for (const [e, n] of [[0, 0], [1234, -567], [-3000, 2999]]) {
        const p = offsetPoint(site.lat, site.lon, e, n);
        expect(twin.sample(p.lat, p.lon)).toBe(s.sample(p.lat, p.lon));
      }
      expect(twin.name).toBe(s.name);
    }
  });

  it('repeated calls reuse the decoded grids', async () => {
    const a = await loadTerrainFor(landing('luna-9'));
    const b = await loadTerrainFor(landing('luna-9'));
    expect(a.sources[0]).toBe(b.sources[0]);
  });
});

describe('custom coordinates', () => {
  it('without an elevation server, a pin beside a catalogued site borrows that site\'s windows and says so', async () => {
    const a11 = index.sites['apollo-11'];
    const p = offsetPoint(a11.lat, a11.lon, 400, -300); // 500 m away: inside the 3 m survey
    const stack = await loadTerrainFor(pin(p.lat, p.lon));
    const local = stack.sources.filter((s) => s.descriptor.kind === 'local');
    // Apollo 11's three windows, then Surveyor 5's 480 m window, which also reaches this point (25 km away).
    expect(local.map((s) => s.resolutionM)).toEqual([3, 60, 480, 480]);
    expect(local.slice(0, 3).every((s) => s.descriptor.kind === 'local' && s.descriptor.lat0 === a11.lat)).toBe(true);
    expect(local[3].descriptor.kind === 'local' && local[3].descriptor.lat0).toBe(index.sites['surveyor-5'].lat);
    expect(Number.isFinite(local[0].sample(p.lat, p.lon))).toBe(true);
    expect(stack.notes.join(' ')).toMatch(/0\.50 km from the catalogued site "apollo-11"/);
    // 2 km away the 3 m survey no longer covers the point and is left out.
    const q = offsetPoint(a11.lat, a11.lon, 2000, 0);
    const stack2 = await loadTerrainFor(pin(q.lat, q.lon));
    expect(stack2.sources.filter((s) => s.descriptor.kind === 'local').map((s) => s.resolutionM)).toEqual([60, 480, 480]);
  });

  it('uses a window from the elevation server when one answers', async () => {
    const lat = 12.5;
    const lon = -140.25;
    const n = 129;
    const grids = [60, 480].map((spacingM) => ({ dtype: 'float32' as const, encoding: 'raw' as const, width: n, height: n, kind: 'local', name: `SLDEM2015 512 ppd, ${spacingM} m site window (built on request)`, resolutionM: spacingM, lat0: lat, lon0: lon, spacingM }));
    const calls: string[] = [];
    setTerrainWindowFetcher(async (la, lo) => {
      calls.push(`${la},${lo}`);
      return encodeLxg({ format: 'lunyx-grid/1', notes: ['Built on request from SLDEM2015.'], grids }, [new Float32Array(n * n).fill(-1234), new Float32Array(n * n).fill(-1200)]).buffer as ArrayBuffer;
    });
    const stack = await loadTerrainFor(pin(lat, lon));
    const local = stack.sources.filter((s) => s.descriptor.kind === 'local');
    expect(local.map((s) => s.resolutionM)).toEqual([60, 480]);
    expect(local[0].sample(lat, lon)).toBe(-1234);
    expect(local[0].provenance?.product).toMatch(/SLDEM2015/);
    expect(stack.notes).toContain('Built on request from SLDEM2015.');
    await loadTerrainFor(pin(lat, lon));
    expect(calls).toEqual(['12.5,-140.25']); // cached
    // remote: false never asks.
    clearTerrainCache();
    await loadTerrainFor(pin(lat, lon), { remote: false });
    expect(calls).toHaveLength(1);
  });

  it('reports, in words, when the elevation server fails, and still returns what is bundled', async () => {
    setTerrainWindowFetcher(async () => {
      throw new Error('HTTP 502: PDS did not answer');
    });
    const stack = await loadTerrainFor(pin(-30, 100));
    expect(stack.sources.every((s) => s.descriptor.kind !== 'local')).toBe(true);
    expect(stack.notes.join(' ')).toMatch(/could not build a 60 m window for this point \(HTTP 502: PDS did not answer\)/);
  });

  it('rejects coordinates that are not on the Moon', async () => {
    await expect(loadTerrainFor(pin(91, 0))).rejects.toThrow(/bad coordinates/);
    await expect(loadTerrainFor(pin(NaN, 0))).rejects.toThrow(/bad coordinates/);
  });
});

describe('robustness', () => {
  it('a missing window file becomes a note, not a crash', async () => {
    setTerrainReader(async (path) => {
      if (path === 'terrain/luna-9.bin') throw new TerrainFileMissing(path);
      return readPublicFile(path);
    });
    const stack = await loadTerrainFor(landing('luna-9'));
    expect(stack.sources.every((s) => s.descriptor.kind !== 'local')).toBe(true);
    expect(stack.notes.join(' ')).toMatch(/surveyed window for this site could not be read/);
  });

  it('coverageRegions lists the site windows with their true half-widths', async () => {
    const regions = await coverageRegions();
    const nac = regions.find((r) => r.resolutionM === 3)!;
    expect(nac.sites).toHaveLength(Object.values(index.sites).filter((s) => s.fine).length);
    expect(nac.sites![0].halfWidthM).toBe(768);
    const w60 = regions.find((r) => r.resolutionM === 60 && r.sites)!;
    expect(w60.sites).toHaveLength(28);
    expect(w60.sites![0].halfWidthM).toBe(3840);
    expect(regions.find((r) => r.resolutionM === 480)!.sites![0].halfWidthM).toBe(30720);
    const onDemand = regions.find((r) => r.onDemand)!;
    expect(onDemand.note).toMatch(/needs network access/);
    for (let i = 1; i < regions.length; i++) expect(regions[i].resolutionM).toBeGreaterThanOrEqual(regions[i - 1].resolutionM);
  });
});
