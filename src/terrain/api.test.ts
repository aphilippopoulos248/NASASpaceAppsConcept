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

// Decoded grids stay cached between tests (decoding the DEM bundle takes seconds); tests that
// swap the file reader clear the cache themselves.
afterEach(() => {
  setTerrainReader(null);
  setTerrainWindowFetcher(undefined);
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
    await loadTerrainFor(pin(lat + 1, lon), { remote: false });
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
    clearTerrainCache();
    setTerrainReader(async (path) => {
      if (path === 'terrain/luna-13.bin') throw new TerrainFileMissing(path);
      if (path.startsWith('data/dem/')) throw new TerrainFileMissing(path); // keep this test light: no DEM bundle
      return readPublicFile(path);
    });
    const stack = await loadTerrainFor(landing('luna-13'), { remote: false });
    expect(stack.sources).toHaveLength(0);
    expect(stack.notes.join(' ')).toMatch(/surveyed window for this site could not be read/);
    expect(stack.notes[0]).toBe('No elevation data is available at this point.');
    // Without the DEM bundle a site still gets its windows, and is told where they stop.
    const a11 = await loadTerrainFor(landing('apollo-11'));
    expect(a11.sources.map((x) => x.resolutionM)).toEqual([3, 60, 480]);
    expect(a11.notes.join(' ')).toMatch(/whole-Moon grid is not installed, so terrain farther than about 31 km from the site is not taken into account/);
    await expect(loadGlobalGrid(16)).rejects.toThrow(TerrainFileMissing);
    clearTerrainCache();
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

// ------------------------------------------------------------------------------------------
// The bundled grids in public/data/dem (built by scripts/build-dem.mjs).

import { demLayers, loadGlobalGrid } from './api';
import { polarLatLon, surfaceDistanceM } from './geo';
import { readTerrainFile } from './reader';
import type { HeightSource } from './types';

/** Mean of a source over a square box (side `boxM`, `k` x `k` samples), in the east/north frame of (lat, lon). */
function boxMean(src: HeightSource, lat: number, lon: number, boxM: number, k: number): number {
  let sum = 0;
  for (let b = 0; b < k; b++) {
    for (let a = 0; a < k; a++) {
      const p = offsetPoint(lat, lon, ((a + 0.5) / k - 0.5) * boxM, ((b + 0.5) / k - 0.5) * boxM);
      sum += src.sample(p.lat, p.lon);
    }
  }
  return sum / (k * k);
}

describe('bundled grids (public/data/dem)', () => {
  it('index.json describes files that are really there, within the size budget', async () => {
    const layers = await demLayers();
    expect(layers.map((l) => l.id)).toEqual(['south-875s-40m', 'south-85s-80m', 'south-80s-160m', 'global-16ppd', 'global-4ppd']);
    let total = 0;
    for (const l of layers) {
      const bytes = await readTerrainFile(`data/dem/${l.file}`);
      expect(bytes.byteLength, l.file).toBe(l.bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(digest, l.file).toBe(l.sha256);
      expect(l.bytes).toBeLessThan(25e6);
      expect(l.provenance.url).toMatch(/^https:\/\/pds-geosciences\.wustl\.edu\//);
      expect(l.provenance.processing.length).toBeGreaterThan(20);
      expect(l.notCovered.length).toBeGreaterThan(20);
      total += l.bytes;
    }
    expect(total).toBeLessThan(41e6);
  });

  it('whole-Moon grid: layout, the highest point on the Moon, the antimeridian and the poles', async () => {
    const g = await loadGlobalGrid(16);
    const d = g.descriptor;
    if (d.kind !== 'equirect') throw new Error('expected an equirectangular grid');
    expect([d.width, d.height, d.latN, d.latS, d.lonW, d.lonE, d.scale, d.offset]).toEqual([5760, 2880, 90, -90, -180, 180, 1, 0]);
    expect(g.resolutionM).toBeCloseTo(1895.21, 2);
    // LOLA's highest point: 10,786 m at 5.4125N, 201.3665E (= 158.6335W). A 1.9 km cell averages the summit down a little.
    let top = 0;
    for (let i = 1; i < d.data.length; i++) if (d.data[i] > d.data[top]) top = i;
    const topLat = 90 - (Math.floor(top / d.width) + 0.5) / 16;
    const topLon = -180 + ((top % d.width) + 0.5) / 16;
    expect(surfaceDistanceM(topLat, topLon, 5.4125, 201.3665 - 360)).toBeLessThan(2000);
    expect(d.data[top]).toBeGreaterThan(10786 - 150);
    expect(d.data[top]).toBeLessThanOrEqual(10786);
    expect(g.sample(topLat, topLon)).toBe(d.data[top]);
    // Longitude conventions and the seam.
    for (const lat of [-75, -30, 0, 22.5, 60]) {
      expect(g.sample(lat, 180)).toBe(g.sample(lat, -180));
      expect(g.sample(lat, 190)).toBe(g.sample(lat, -170));
      // Exactly on the seam the value is the mean of the last and first columns: no jump, no gap.
      const row = Math.round((90 - lat) * 16 - 0.5);
      const rowLat = 90 - (row + 0.5) / 16;
      const eastMost = d.data[row * d.width + d.width - 1];
      const westMost = d.data[row * d.width];
      expect(g.sample(rowLat, 180 - 1 / 32)).toBeCloseTo(eastMost, 6);
      expect(g.sample(rowLat, -180 + 1 / 32)).toBeCloseTo(westMost, 6);
      expect(g.sample(rowLat, 180)).toBeCloseTo((eastMost + westMost) / 2, 6);
      expect(g.sample(rowLat, 180 - 1 / 64)).toBeCloseTo(0.75 * eastMost + 0.25 * westMost, 6);
    }
    // One value at each pole whatever the longitude, and no gaps anywhere.
    for (const pole of [90, -90]) {
      const v = g.sample(pole, 0);
      expect(Number.isFinite(v)).toBe(true);
      for (const lon of [-180, -90, 33, 120, 179.99]) expect(g.sample(pole, lon)).toBeCloseTo(v, 6);
    }
    for (const [lat, lon] of [[89.999, 12], [-89.999, -140], [0, 0], [45, -179.9999]]) expect(g.covers(lat, lon) && Number.isFinite(g.sample(lat, lon))).toBe(true);
    expect(g.sample(90.001, 0)).toBeNaN();
  });

  it('the 4 px/deg overview is the same Moon, coarser', async () => {
    const g16 = await loadGlobalGrid(16);
    const g4 = await loadGlobalGrid(4);
    const d = g4.descriptor;
    if (d.kind !== 'equirect') throw new Error('expected an equirectangular grid');
    expect([d.width, d.height, d.lonW, d.scale]).toEqual([1440, 720, -180, 0.5]);
    const rms = (mirror: number): number => {
      let sum2 = 0;
      let count = 0;
      for (let lat = -80; lat <= 80; lat += 6.5) {
        for (let lon = -175; lon <= 175; lon += 9.3) {
          // A 4 px/deg cell centre against the mean of the 16 px/deg samples inside that cell.
          const la = Math.floor(lat * 4) / 4 + 0.125;
          const lo = Math.floor(lon * 4) / 4 + 0.125;
          let m = 0;
          for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) m += g16.sample(la - 0.125 + (b + 0.5) / 16, lo - 0.125 + (a + 0.5) / 16);
          sum2 += (g4.sample(la, mirror * lo) - m / 16) ** 2;
          count++;
        }
      }
      return Math.sqrt(sum2 / count);
    };
    // Two separately gridded LOLA products: measured 79 m RMS at this scale...
    expect(rms(1)).toBeLessThan(120);
    // ...against kilometres when east and west are swapped.
    expect(rms(-1)).toBeGreaterThan(1500);
  });

  it('site windows agree with the whole-Moon grid within its resolution, and only in the right orientation', async () => {
    const g = await loadGlobalGrid(16);
    let rmsSum = 0;
    let mirroredSum = 0;
    for (const [id, entry] of Object.entries(index.sites)) {
      const w480 = (await loadTerrainFor(landing(id))).sources.find((s) => s.resolutionM === 480)!;
      // The site itself: a point against a 1.9 km cell. Measured worst case 111 m (Luna 20, rough highlands).
      expect(Math.abs(w480.sample(entry.lat, entry.lon) - g.sample(entry.lat, entry.lon)), `${id} site height`).toBeLessThan(150);
      const stat = (flip: number): { rms: number; corr: number } => {
        let n = 0, sw = 0, sg = 0, sww = 0, sgg = 0, swg = 0, s2 = 0;
        for (let j = -6; j <= 6; j++) {
          for (let i = -6; i <= 6; i++) {
            const p = offsetPoint(entry.lat, entry.lon, i * 4320, j * 4320);
            const m = boxMean(w480, p.lat, p.lon, 1920, 4); // the window averaged over one global cell
            const q = offsetPoint(entry.lat, entry.lon, flip * i * 4320, j * 4320);
            const v = g.sample(q.lat, q.lon);
            n++; sw += m; sg += v; sww += m * m; sgg += v * v; swg += m * v; s2 += (m - v) ** 2;
          }
        }
        return { rms: Math.sqrt(s2 / n), corr: (swg - (sw * sg) / n) / Math.sqrt((sww - (sw * sw) / n) * (sgg - (sg * sg) / n)) };
      };
      const right = stat(1);
      const mirrored = stat(-1);
      expect(right.corr, `${id} correlation`).toBeGreaterThan(0.9); // measured 0.93 (Chang'e 4, a flat mare floor) .. 1.00
      expect(right.rms, `${id} rms`).toBeLessThan(100); // measured 2 .. 82 m (Apollo 15, Apennine front)
      rmsSum += right.rms;
      mirroredSum += mirrored.rms;
    }
    // East and west swapped, the same comparison falls apart: the windows are the right way round.
    expect(mirroredSum).toBeGreaterThan(10 * rmsSum);
  });

  it('south-polar layers: nested squares that agree with each other, with the whole-Moon grid and with known geography', async () => {
    const stack = await loadTerrainFor(pin(-89.9, 0), { remote: false });
    const [p40, p80, p160, g] = stack.sources;
    expect(stack.sources.map((s) => s.resolutionM)).toEqual([40, 80, 160, expect.closeTo(1895.21, 2)]);
    expect(stack.sources.map((s) => s.descriptor.kind)).toEqual(['polar', 'polar', 'polar', 'equirect']);
    const d40 = p40.descriptor;
    if (d40.kind !== 'polar') throw new Error('expected a polar grid');
    expect([d40.size, d40.metresPerPx, d40.pole, d40.scale]).toEqual([3792, 40, 'S', 0.5]);

    // Shackleton (IAU: 89.67S, 129.78E, 20.9 km across): the deepest ground within 20 km of the pole is its floor.
    const c = d40.size / 2 - 0.5;
    let best = Infinity;
    let bx = 0;
    let by = 0;
    for (let line = 0; line < d40.size; line++) {
      for (let s = 0; s < d40.size; s++) {
        const x = (s - c) * 40;
        const y = (c - line) * 40;
        if (x * x + y * y > 20000 * 20000) continue;
        const v = d40.data[line * d40.size + s];
        if (v < best) { best = v; bx = x; by = y; }
      }
    }
    const floor = polarLatLon('S', bx, by);
    expect(surfaceDistanceM(floor.lat, floor.lon, -89.67, 129.78)).toBeLessThan(10460); // inside the crater
    expect(best * d40.scale).toBeGreaterThan(-2950);
    expect(best * d40.scale).toBeLessThan(-2800);
    // The pole itself sits on Shackleton's rim, about 1.3 km above the datum.
    expect(p40.sample(-90, 0)).toBeGreaterThan(1200);
    expect(p40.sample(-90, 0)).toBeLessThan(1400);
    expect(p40.sample(-90, 123)).toBe(p40.sample(-90, 0));

    // Where layers overlap they describe the same ground (block means of different LOLA grids).
    const compare = (a: HeightSource, b: HeightSource, latEdge: number, boxM: number): number => {
      let sum2 = 0;
      let n = 0;
      for (let lat = -89.95; lat < latEdge; lat += 0.171) {
        for (let lon = -180; lon < 180; lon += 17.3) {
          const d = boxMean(a, lat, lon, boxM, 4) - boxMean(b, lat, lon, boxM, 4);
          sum2 += d * d;
          n++;
        }
      }
      expect(n).toBeGreaterThan(200);
      return Math.sqrt(sum2 / n);
    };
    expect(compare(p40, p80, -87.6, 160)).toBeLessThan(5);
    expect(compare(p80, p160, -85.1, 320)).toBeLessThan(5);
    // Against the whole-Moon grid, averaged over one of its cells: an independent product in another projection.
    expect(compare(p160, g, -80.1, 1895)).toBeLessThan(80);

    // Coverage is exactly the square: nothing outside, never the other hemisphere.
    expect(p40.covers(-87.6, 77)).toBe(true);
    expect(p40.sample(-87.4, 0)).toBeNaN(); // 78.9 km from the pole along an axis: outside the 75.8 km half-width
    expect(Number.isFinite(p40.sample(-86.7, 45))).toBe(true); // but inside along the diagonal
    expect(p80.sample(-84.9, 90)).toBeNaN();
    expect(p160.sample(-79.9, 180)).toBeNaN();
    expect(Number.isFinite(p160.sample(-76.5, -135))).toBe(true);
    expect(p160.sample(80, 0)).toBeNaN();
    expect(p160.sample(89.9, 0)).toBeNaN();
    expect(stack.notes[0]).toMatch(/LOLA south pole, 87\.5S square at 40 m \(40 m per sample, to about 7[0-9] km\)/);
  });

  it('gives each site the layers that can matter to it, finest first, ending with the whole Moon', async () => {
    const names = async (site: SiteRef): Promise<number[]> => (await loadTerrainFor(site, { remote: false })).sources.map((s) => Math.round(s.resolutionM));
    expect(await names(pin(0.5, 10))).toEqual([1895]);
    expect(await names(pin(75, 10))).toEqual([1895]); // no north-polar layer is bundled
    expect(await names(pin(-70, 10))).toEqual([1895]); // 300 km short of the 80S square
    expect(await names(pin(-78.5, 10))).toEqual([160, 1895]); // 45 km outside the 80S square: its far horizon is in it
    expect(await names(pin(-86, -100))).toEqual([40, 80, 160, 1895]); // 45 km outside the 87.5S square
    expect(await names(pin(-83, 180))).toEqual([80, 160, 1895]);
    expect(await names(landing('apollo-11'))).toEqual([3, 60, 480, 1895]);
    expect(await names(landing('im-2'))).toEqual([60, 80, 160, 480, 1895]);

    const far = await loadTerrainFor(pin(20, 100), { remote: false });
    expect(far.notes.join(' ')).toMatch(/No high-resolution survey is loaded for this point: relief smaller than about 1\.9 km is not resolved/);
    const im2 = await loadTerrainFor(landing('im-2'));
    expect(im2.notes.join(' ')).toMatch(/Beyond about 1\d\d km from the site only the whole-Moon grid is available/);
    // The last source always answers, wherever you ask.
    const last = im2.sources[im2.sources.length - 1];
    for (const [lat, lon] of [[90, 0], [-90, 0], [12.3, -179.99], [-45, 180], [0, 359]]) expect(Number.isFinite(last.sample(lat, lon))).toBe(true);
    // IM-2's own 60 m window and the bundled 80 m polar layer were cut from different LOLA grids: same mountain.
    const site = index.sites['im-2'];
    expect(Math.abs(im2.sources[0].sample(site.lat, site.lon) - im2.sources[1].sample(site.lat, site.lon))).toBeLessThan(15);
  });

  it('coverageRegions adds the polar layers and the whole-Moon grids', async () => {
    const regions = await coverageRegions();
    const polar = regions.filter((r) => /south pole/.test(r.name));
    expect(polar.map((r) => [r.resolutionM, r.latMin, r.latMax])).toEqual([[40, -90, -87.51], [80, -90, -85.01], [160, -90, -80.01]]);
    expect(polar[0].note).toMatch(/Complete south of 87\.51S; towards its corners .* it reaches 86\.5S/);
    expect(regions[regions.length - 1]).toMatchObject({ latMin: -90, latMax: 90 });
  });
});

// ------------------------------------------------------------------------------------------
// Hand-overs between a site's grids (raised by the independent check T-26; eased in T-32).

import { computeHorizon } from '../analysis/horizon';
import { blendEdge, type Grid } from '../scene/surface/ground';
import { storedGrid } from './api';

/**
 * The independent check's table (T-26, tests/fixtures/validation/ephemeris-check/terrain/seams.txt
 * at integration 8e94737): 60 m window just outside minus 3 m model just inside, lowest and
 * highest along the model's edge, metres. Read from the bundled files with separate code.
 */
const INDEPENDENT_EDGE_STEP: Record<string, [number, number]> = {
  'surveyor-3': [-4.74, 3.94], 'surveyor-7': [-4.76, 7.12], 'apollo-11': [-7.45, 17.51], 'apollo-12': [-4.88, 9.57], 'luna-16': [-5.04, 13.93],
  'apollo-14': [-6.4, 6.39], 'apollo-15': [-8.36, 7.68], 'luna-20': [-5.92, 9.96], 'apollo-16': [-5.69, 15.43], 'apollo-17': [-7.38, 21.63],
  'luna-21': [-9.16, 8.5], 'luna-23': [-6.1, 16.04], 'luna-24': [-6.27, 12.56], 'change-3': [-9.6, 7.41], 'change-4': [-5.21, 17.88],
  'change-5': [-10.01, 8.71], slim: [-6.61, 18.8], 'change-6': [-9.3, 7.45], 'blue-ghost-1': [-6.37, 7.77],
};

/** A copy of a site grid in the surface view's own layout. */
function sceneGrid(source: HeightSource): Grid {
  const d = source.descriptor;
  if (d.kind !== 'local') throw new Error(`${source.name}: not a site grid`);
  return { n: d.n, spacing: d.spacingM, data: Float32Array.from(d.data) };
}
function largestDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let k = 0; k < a.length; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
  return worst;
}

describe('where one grid hands over to the next', () => {
  it('as stored, the grids step against each other', async () => {
    const a17 = await loadTerrainFor(landing('apollo-17'), { easeEdges: false });
    expect(a17.seams!.map((x) => [x.inner, x.outer, x.distanceM, x.eased])).toEqual([
      ['3 m model', '60 m window', 768, undefined],
      ['60 m window', '480 m window', 3840, undefined],
      ['480 m window', 'whole-Moon grid', 30720, undefined],
    ]);
    const [nac, w60, w480] = a17.seams!;
    expect(nac).toMatchObject({ minM: -7.4, maxM: 21.1, rmsM: 3.6 });
    expect(w60).toMatchObject({ minM: -14.1, maxM: 29.4, rmsM: 6.8 });
    expect(nac.degPerMetre).toBeCloseTo(0.0746, 4); // 1 m at 768 m
    expect(w60.degPerMetre).toBeCloseTo(0.01492, 5);
    expect(w480.degPerMetre).toBeCloseTo(0.001865, 6);
    expect(a17.notes.join(' ')).toContain(
      'Edge easing was switched off for this request, so the grids are as stored and step against each other: 0.77 km from the site the 3 m model ends and the 60 m window takes over, lying between 7.4 m below and 21.1 m above it, 3.6 m RMS (1 m of height is 0.075° of skyline there)',
    );
    // These are the stored grids themselves, the same objects every time.
    expect((await loadTerrainFor(landing('apollo-17'), { easeEdges: false })).sources[0]).toBe(a17.sources[0]);
    expect(storedGrid(a17.sources[0])).toBe(a17.sources[0]);
  });

  it('by default the 3 m model is eased onto the 60 m window around it: no step left, the middle untouched, nothing else changed', async () => {
    const stored = await loadTerrainFor(landing('apollo-17'), { easeEdges: false });
    const a17 = await loadTerrainFor(landing('apollo-17'));
    const [nac, w60, w480] = a17.seams!;
    // The model's edge now agrees with the window; the record keeps what the mismatch was.
    expect(nac).toMatchObject({ inner: '3 m model', outer: '60 m window', minM: 0, maxM: 0, rmsM: 0, eased: { overM: 129, minM: -7.4, maxM: 21.1, rmsM: 3.6 } });
    // The other two hand-overs are the same data at a coarser sampling and stay as stored, with the reason given.
    expect(w60).toEqual(stored.seams![1]);
    expect(w480).toEqual(stored.seams![2]);
    const notes = a17.notes.join(' ');
    expect(notes).toContain(
      'Where a separately measured model ends, its heights are eased onto the grid that continues outside it, as in the surface view, so the ground has no step: the 3 m model onto the 60 m window over its outer 129 m (0.77 km from the site, where the 60 m window lay between 7.4 m below and 21.1 m above it, 3.6 m RMS).',
    );
    expect(notes).toContain('The model is a stereo survey tied to the grid around it by a single vertical shift; that grid is the reference at the edge because the ground beyond comes from it.');
    expect(notes).toContain('The two still disagree by that much: inside the eased band the heights are a blend of both, and a skyline point formed there is uncertain by about 0.075° per metre of height at 0.77 km.');
    expect(notes).toContain(
      'Hand-overs left as stored: 3.8 km from the site the 60 m window ends and the 480 m window takes over, lying between 14.1 m below and 29.4 m above it, 6.8 m RMS (1 m of height is 0.015° of skyline there); 31 km from the site the 480 m window ends and the whole-Moon grid takes over, lying between 374 m below and 250 m above it, 86.2 m RMS (1 m of height is 0.002° of skyline there).',
    );
    expect(notes).toContain('These grids share one frame (LOLA) and differ in sampling: the finer grid is right up to its edge, the difference is relief the coarser grid misses from there on, and easing the finer grid onto it would flatten real relief.');
    expect(notes).not.toContain('switched off');

    // What changed and what did not: the same grid under the same name; heights identical outside
    // the band, the window's at the very edge, half and half in the middle of the band.
    const site = index.sites['apollo-17'];
    const [fine, mid] = a17.sources;
    const [fine0, mid0] = stored.sources;
    expect(fine).not.toBe(fine0);
    expect(storedGrid(fine)).toBe(fine0);
    expect(fine.name).toBe(fine0.name);
    expect(fine.resolutionM).toBe(fine0.resolutionM);
    expect(fine.provenance!.processing).toBe(`${fine0.provenance!.processing} When loaded: within 129 m of its edge the heights are eased onto the 60 m window, which continues outside it, so the two meet without a step (at the edge they are that grid's, in between a blend of both).`);
    expect(a17.sources.slice(1)).toEqual(stored.sources.slice(1));
    for (let k = 1; k < a17.sources.length; k++) expect(a17.sources[k]).toBe(stored.sources[k]); // the windows and the whole-Moon grid are the stored ones
    for (const [e, n] of [[0, 0], [300, -200], [-630, 630], [638, 0]]) {
      const p = offsetPoint(site.lat, site.lon, e, n);
      expect(fine.sample(p.lat, p.lon), `${e},${n}`).toBe(fine0.sample(p.lat, p.lon));
    }
    for (const [e, n] of [[768, 0], [-768, 123], [300, 768], [-768, -768]]) {
      const p = offsetPoint(site.lat, site.lon, e, n);
      expect(fine.sample(p.lat, p.lon), `${e},${n}`).toBeCloseTo(mid0.sample(p.lat, p.lon), 3);
    }
    const half = offsetPoint(site.lat, site.lon, 768 - 64.5, 100);
    expect(fine.sample(half.lat, half.lon)).toBeCloseTo((fine0.sample(half.lat, half.lon) + mid.sample(half.lat, half.lon)) / 2, 1);
    // Asking again gives the same eased grid, not a new copy; and the stored grid is still what the file holds.
    expect((await loadTerrainFor(landing('apollo-17'))).sources[0]).toBe(fine);
    const file = new Float32Array(await readPublicFile('terrain/apollo-17_fine.bin'));
    const kept = fine0.descriptor.kind === 'local' ? fine0.descriptor.data : new Float32Array(0);
    expect(largestDifference(kept, file)).toBe(0);
    // An eased grid goes to a worker like any other.
    const twin = sourceFromDescriptor(structuredClone(fine.descriptor));
    expect(twin.sample(half.lat, half.lon)).toBe(fine.sample(half.lat, half.lon));
  });

  it('all 19 sites with a 3 m model: the step is gone, and the ground is the one the surface view draws', async () => {
    const withModel = Object.entries(index.sites).filter(([, entry]) => entry.fine).map(([id]) => id);
    expect([...withModel].sort()).toEqual(Object.keys(INDEPENDENT_EDGE_STEP).sort());
    for (const id of withModel) {
      const stored = await loadTerrainFor(landing(id), { easeEdges: false });
      const stack = await loadTerrainFor(landing(id));
      // Before: metres to tens of metres, as the independent check found with its own reader and sampling.
      const before = stored.seams![0];
      expect(before.inner, id).toBe('3 m model');
      const [lowest, highest] = INDEPENDENT_EDGE_STEP[id];
      expect(Math.abs(before.minM - lowest), `${id} lowest`).toBeLessThan(1.5);
      expect(Math.abs(before.maxM - highest), `${id} highest`).toBeLessThan(1.5);
      expect(before.maxM - before.minM, id).toBeGreaterThan(8);
      // After: nothing left at the model's edge; the other hand-overs are untouched.
      expect(stack.seams![0], id).toEqual({ inner: '3 m model', outer: '60 m window', distanceM: 768, minM: 0, maxM: 0, rmsM: 0, degPerMetre: before.degPerMetre, eased: { overM: 129, minM: before.minM, maxM: before.maxM, rmsM: before.rmsM } });
      expect(stack.seams!.slice(1), id).toEqual(stored.seams!.slice(1));
      // The surface view's own function, applied to the stored grids in the view's order
      // (60 m onto 480 m first, then the model onto the result), gives the same heights.
      const [fine, mid, coarse] = stored.sources.slice(0, 3).map(sceneGrid);
      blendEdge(mid, coarse);
      blendEdge(fine, mid);
      const d = stack.sources[0].descriptor;
      expect(largestDifference(fine.data, d.kind === 'local' ? d.data : []), id).toBeLessThan(0.002);
    }
    // Only the last few sites' eased grids are kept; an earlier site is eased again to the same heights.
    const first = await loadTerrainFor(landing(withModel[0]));
    const p = offsetPoint(index.sites[withModel[0]].lat, index.sites[withModel[0]].lon, 700, -700);
    expect(first.sources[0].sample(p.lat, p.lon)).toBe((await loadTerrainFor(landing(withModel[0]))).sources[0].sample(p.lat, p.lon));
    expect(first.sources[0].sample(p.lat, p.lon)).not.toBe(storedGrid(first.sources[0]).sample(p.lat, p.lon));
  });

  it('follows what the stack really uses on each side of an edge, and leaves grids of one frame alone', async () => {
    // IM-2 has no 3 m model. Its 60 m window hands over to the 80 m polar layer; the 480 m window is
    // never in use at its own edge (finer polar layers cover both sides) and has no seam.
    const im2 = await loadTerrainFor(landing('im-2'));
    expect(im2.seams).toEqual([{ inner: '60 m window', outer: '80 m polar layer', distanceM: 3840, minM: -2.6, maxM: 4.2, rmsM: 0.7, degPerMetre: expect.closeTo(0.01492, 5) }]);
    expect(storedGrid(im2.sources[0])).toBe(im2.sources[0]);
    expect(im2.sources[0]).toBe((await loadTerrainFor(landing('im-2'), { easeEdges: false })).sources[0]);
    const notes = im2.notes.join(' ');
    expect(notes).toContain('Hand-overs left as stored: 3.8 km from the site the 60 m window ends and the 80 m polar layer takes over, lying between 2.6 m below and 4.2 m above it, 0.7 m RMS');
    expect(notes).not.toContain('separately measured');
    // IM-1: the 160 m layer ends 4 km north of the site; beyond it the 480 m window is in use up to its own edge.
    const im1 = await loadTerrainFor(landing('im-1'));
    expect(im1.seams!.map((x) => [x.inner, x.outer, x.eased])).toEqual([['60 m window', '160 m polar layer', undefined], ['480 m window', 'whole-Moon grid', undefined]]);
    // A pin with no grid of its own has no such edge.
    const pinStack = await loadTerrainFor(pin(-89.45, -137.2), { remote: false });
    expect(pinStack.seams).toBeUndefined();
    expect(pinStack.notes.some((n) => /eased|easing/.test(n))).toBe(false);
  });

  it('why the 60 m window is not eased as well: on the computed skyline that would lower real ridges', async () => {
    // Apollo 15, at the foot of the Apennine front. The 480 m window is every 8th sample of the same
    // product, so where the two differ the 60 m window is the one that is right. Ease it anyway,
    // the way the surface view does for drawing, and compute the skyline both ways.
    const site = landing('apollo-15');
    const stack = await loadTerrainFor(site);
    const [mid, coarse] = stack.sources.slice(1, 3).map(sceneGrid);
    blendEdge(mid, coarse);
    const d = stack.sources[1].descriptor;
    if (d.kind !== 'local') throw new Error('expected the 60 m window');
    const whatIf = { ...stack, sources: [stack.sources[0], sourceFromDescriptor({ ...d, data: mid.data }), ...stack.sources.slice(2)] };
    const asIs = computeHorizon(stack, site, 2);
    const eased = computeHorizon(whatIf, site, 2);
    let lowest = 0, highest = 0, moved = 0;
    for (let i = 0; i < asIs.elevDeg.length; i++) {
      const change = eased.elevDeg[i] - asIs.elevDeg[i];
      lowest = Math.min(lowest, change);
      highest = Math.max(highest, change);
      if (Math.abs(change) > 0.01) moved++;
    }
    // Measured: 0.40 degrees lower at the worst azimuth (the Sun is 0.53 degrees across), nowhere higher by more than a hundredth.
    expect(lowest).toBeLessThan(-0.3);
    expect(lowest).toBeGreaterThan(-0.5);
    expect(highest).toBeLessThan(0.02);
    expect(moved).toBeGreaterThan(10);
  });

  it('a pin that borrows a neighbouring site\'s 3 m model gets the same ground, with the edge at its true distance', async () => {
    const a11 = index.sites['apollo-11'];
    const p = offsetPoint(a11.lat, a11.lon, 400, -300);
    const stack = await loadTerrainFor(pin(p.lat, p.lon));
    const [nac, w60] = stack.seams!;
    // The model's east edge is 368 m from the pin (768 - 400), not 768 m.
    expect(nac).toMatchObject({ inner: '3 m model', outer: '60 m window', distanceM: 368, minM: 0, maxM: 0, eased: { overM: 129, minM: -7.4, maxM: 17.6, rmsM: 3.6 } });
    expect(nac.degPerMetre).toBeCloseTo(0.1557, 3);
    expect(w60).toMatchObject({ inner: '60 m window', outer: '480 m window', distanceM: 3440 });
    expect(w60.eased).toBeUndefined();
    expect(stack.notes.join(' ')).toContain('the 3 m model onto the 60 m window over its outer 129 m (0.37 km from the site at the nearest, where');
    // The same eased ground as at Apollo 11 itself.
    const own = await loadTerrainFor(landing('apollo-11'));
    const q = offsetPoint(a11.lat, a11.lon, 740, 10);
    expect(stack.sources[0].sample(q.lat, q.lon)).toBe(own.sources[0].sample(q.lat, q.lon));
    expect(stack.sources[0].sample(q.lat, q.lon)).not.toBe(storedGrid(stack.sources[0]).sample(q.lat, q.lon));
  });
});
