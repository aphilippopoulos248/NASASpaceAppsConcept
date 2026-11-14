// The /api/terrain handler, exercised without the network: the archive is replaced by a
// synthetic one (src/terrain/testArchive.ts). Set LUNYX_LIVE=1 to also run the test at the
// bottom, which rebuilds three bundled windows from the real PDS archive and compares.
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { offsetPoint } from '../../src/terrain/geo';
import { decodeLxg } from '../../src/terrain/lxg';
import { EquirectSource, LocalSource } from '../../src/terrain/sources';
import { syntheticArchive, syntheticHeight } from '../../src/terrain/testArchive';
import type { RangeReader } from '../../src/terrain/windowBuilder';
import defaultHandler, { createTerrainHandler } from './terrain';

const get = (params: Record<string, string>, method = 'GET'): { method: string; query: URLSearchParams } => ({ method, query: new URLSearchParams(params) });
const errorOf = (res: { json?: unknown }): string => (res.json as { error: string }).error;

let cacheDir: string;
beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'lunyx-terrain-'));
});
afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe('GET /api/terrain', () => {
  it('rejects bad input before touching the archive', async () => {
    const archive = syntheticArchive();
    const handler = createTerrainHandler({ cacheDir, rangeReader: () => archive.read });
    for (const [params, message] of [
      [{}, /lat must be a number/],
      [{ lat: '10' }, /lon must be a number/],
      [{ lat: 'abc', lon: '0' }, /lat must be a number/],
      [{ lat: '', lon: '0' }, /lat must be a number/],
      [{ lat: '90.5', lon: '0' }, /between -90 and 90/],
      [{ lat: '10', lon: '361' }, /between -360 and 360/],
      [{ lat: '1e5', lon: '0' }, /lat must be a number/],
      [{ lat: '10', lon: 'NaN' }, /lon must be a number/],
      [{ lat: '10; rm -rf', lon: '0' }, /lat must be a number/],
      [{ lat: 'Infinity', lon: '0' }, /lat must be a number/],
    ] as const) {
      const res = await handler(get(params));
      expect(res.status, JSON.stringify(params)).toBe(400);
      expect(errorOf(res)).toMatch(message);
    }
    const post = await handler(get({ lat: '1', lon: '2' }, 'POST'));
    expect(post.status).toBe(405);
    expect(post.headers?.allow).toBe('GET, HEAD');
    expect(archive.log).toHaveLength(0);
    expect(await readdir(cacheDir)).toHaveLength(0);
  });

  it('answers with both grids, labelled, and serves the same bytes from its cache afterwards', async () => {
    const archive = syntheticArchive();
    const handler = createTerrainHandler({ cacheDir, rangeReader: () => archive.read });
    const first = await handler(get({ lat: '-84.79', lon: '29.2' }));
    expect(first.status).toBe(200);
    expect(first.headers).toMatchObject({ 'content-type': 'application/octet-stream', 'x-lunyx-cache': 'miss' });
    const { header, arrays } = await decodeLxg(first.body!);
    expect(header.grids.map((g) => g.name)).toEqual(['LOLA LDEM_80S_20M, 60 m site window (built on request)', 'LOLA LDEM_80S_20M, 480 m site window (built on request)']);
    expect([header.lat, header.lon]).toEqual([-84.79, 29.2]);
    // The centre sample is the height at the requested point (the source stores half-metres).
    expect(Math.abs(arrays[0][64 * 129 + 64] - syntheticHeight(-84.79, 29.2))).toBeLessThan(0.3);
    expect(Math.abs(arrays[1][64 * 129 + 64] - syntheticHeight(-84.79, 29.2))).toBeLessThan(0.3);

    const requests = archive.log.length;
    expect(await readdir(cacheDir)).toEqual(['window_-84.79000_29.20000.lxg']);
    const second = await handler(get({ lat: '-84.79', lon: '29.2' }));
    expect(second.headers?.['x-lunyx-cache']).toBe('hit');
    expect(Buffer.from(second.body!).equals(Buffer.from(first.body!))).toBe(true);
    expect(archive.log.length).toBe(requests);
    // A fresh server process finds the file too.
    const restarted = createTerrainHandler({ cacheDir, rangeReader: () => () => Promise.reject(new Error('the archive must not be needed')) });
    expect((await restarted(get({ lat: '-84.79', lon: '29.2' }))).headers?.['x-lunyx-cache']).toBe('hit');
  });

  it('treats equivalent coordinates as one window', async () => {
    const archive = syntheticArchive();
    const handler = createTerrainHandler({ cacheDir, rangeReader: () => archive.read });
    expect((await handler(get({ lat: '10', lon: '190' }))).headers?.['x-lunyx-cache']).toBe('miss');
    for (const params of [{ lat: '10.000001', lon: '-170' }, { lat: '+10.0', lon: '-170.000002' }, { lat: '10', lon: '190.0' }]) {
      expect((await handler(get(params))).headers?.['x-lunyx-cache'], JSON.stringify(params)).toBe('hit');
    }
    expect(await readdir(cacheDir)).toEqual(['window_10.00000_-170.00000.lxg']);
    // 180 and -180 are the same meridian; -0 is 0.
    await handler(get({ lat: '-0', lon: '-180' }));
    expect((await handler(get({ lat: '0', lon: '180' }))).headers?.['x-lunyx-cache']).toBe('hit');
    expect((await readdir(cacheDir)).sort()).toEqual(['window_0.00000_180.00000.lxg', 'window_10.00000_-170.00000.lxg']);
  });

  it('builds a window once when the same point is asked for twice at the same moment', async () => {
    const archive = syntheticArchive();
    const handler = createTerrainHandler({ cacheDir: null, rangeReader: () => archive.read });
    const [a, b] = await Promise.all([handler(get({ lat: '5', lon: '5' })), handler(get({ lat: '5', lon: '5' }))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(Buffer.from(a.body!).equals(Buffer.from(b.body!))).toBe(true);
    const once = archive.log.length;
    await handler(get({ lat: '5', lon: '5' })); // no cache directory: built again
    expect(archive.log.length).toBe(2 * once);
  });

  it('limits how many windows are built at once: the next waits, the one after is told to come back', async () => {
    const archive = syntheticArchive();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((go) => (release = go));
    let started = 0;
    const slow: RangeReader = async (url, start, length) => {
      started++;
      await gate;
      return archive.read(url, start, length);
    };
    const handler = createTerrainHandler({ cacheDir: null, rangeReader: () => slow, maxActive: 1, maxQueued: 1 });
    const first = handler(get({ lat: '1', lon: '1' }));
    const second = handler(get({ lat: '2', lon: '2' }));
    await new Promise((go) => setTimeout(go, 20));
    const startedByFirst = started;
    expect(startedByFirst).toBeGreaterThan(0);
    const third = await handler(get({ lat: '3', lon: '3' }));
    expect(third.status).toBe(429);
    expect(third.headers?.['retry-after']).toBe('10');
    expect(errorOf(third)).toMatch(/busy/);
    // Asking again for a window already being built does not count against the limit.
    const firstAgain = handler(get({ lat: '1', lon: '1' }));
    expect(started).toBe(startedByFirst); // the queued build has not touched the archive yet
    release();
    expect((await first).status).toBe(200);
    expect((await firstAgain).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await handler(get({ lat: '3', lon: '3' }))).status).toBe(200);
  });

  it('gives up cleanly when the archive does not answer in time, and recovers', async () => {
    const archive = syntheticArchive();
    let hang = true;
    const aborted: boolean[] = [];
    const handler = createTerrainHandler({
      cacheDir,
      timeoutMs: 60,
      maxActive: 1,
      rangeReader: (signal) => (url, start, length) => {
        if (!hang) return archive.read(url, start, length);
        return new Promise((_, fail) => signal.addEventListener('abort', () => {
          aborted.push(true);
          fail(signal.reason);
        }));
      },
    });
    const t0 = Date.now();
    const [a, queued] = await Promise.all([handler(get({ lat: '7', lon: '7' })), handler(get({ lat: '8', lon: '8' }))]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(a.status).toBe(504);
    expect(errorOf(a)).toMatch(/too slow right now: no complete answer from the PDS archive within 0 s/);
    expect(queued.status).toBe(504); // it never got a slot, and says so instead of hanging
    expect(aborted.length).toBeGreaterThan(0); // outstanding reads were cancelled
    expect(await readdir(cacheDir)).toHaveLength(0);
    hang = false;
    const again = createTerrainHandler({ cacheDir, timeoutMs: 20_000, rangeReader: () => archive.read });
    expect((await again(get({ lat: '7', lon: '7' }))).status).toBe(200);
    // The first handler's slot was released too.
    const later = await handler(get({ lat: '7', lon: '7' }));
    expect([later.status, later.headers?.['x-lunyx-cache']]).toEqual([200, 'hit']);
  });

  it('reports an unreadable archive as 502 and caches nothing', async () => {
    const handler = createTerrainHandler({ cacheDir, rangeReader: () => () => Promise.reject(new Error('could not read sldem2015_512_00n_30n_000_045_float.img from the PDS archive (HTTP 503)')) });
    const res = await handler(get({ lat: '12', lon: '12' }));
    expect(res.status).toBe(502);
    expect(errorOf(res)).toBe('The elevation archive could not be read: could not read sldem2015_512_00n_30n_000_045_float.img from the PDS archive (HTTP 503).');
    expect(await readdir(cacheDir)).toHaveLength(0);
  });

  it('rebuilds a damaged cache file instead of serving it', async () => {
    const archive = syntheticArchive();
    const handler = createTerrainHandler({ cacheDir, rangeReader: () => archive.read });
    await writeFile(join(cacheDir, 'window_4.00000_4.00000.lxg'), 'not a grid file at all');
    const res = await handler(get({ lat: '4', lon: '4' }));
    expect([res.status, res.headers?.['x-lunyx-cache']]).toEqual([200, 'miss']);
    expect((await decodeLxg(await readFile(join(cacheDir, 'window_4.00000_4.00000.lxg')))).header.grids).toHaveLength(2);
  });

  it('exports a ready-made handler for the plugin', () => {
    expect(typeof defaultHandler).toBe('function');
  });
});

// ------------------------------------------------------------------------------------------

describe.skipIf(!process.env.LUNYX_LIVE)('live: the real PDS archive', () => {
  it('rebuilds bundled site windows sample for sample', async () => {
    const handler = createTerrainHandler({ cacheDir: null });
    const index = JSON.parse(await readFile(new URL('../../public/terrain/index.json', import.meta.url), 'utf8')) as { sites: Record<string, { lat: number; lon: number; source: string }> };
    for (const id of ['apollo-11', 'surveyor-6', 'chandrayaan-3', 'im-2']) {
      const site = index.sites[id];
      const t0 = Date.now();
      const res = await handler(get({ lat: String(site.lat), lon: String(site.lon) }));
      expect(res.status, `${id}: ${JSON.stringify(res.json)}`).toBe(200);
      const { header, arrays } = await decodeLxg(res.body!);
      const bundled = await readFile(new URL(`../../public/terrain/${id}.bin`, import.meta.url));
      const expected = new Float32Array(bundled.buffer.slice(bundled.byteOffset, bundled.byteOffset + bundled.byteLength));
      let worst = 0;
      for (let k = 0; k < 2; k++) for (let i = 0; i < 129 * 129; i++) worst = Math.max(worst, Math.abs(arrays[k][i] - expected[k * 129 * 129 + i]));
      console.log(`${id}: ${String(header.grids[0].name)} | worst difference from the bundled window ${worst.toExponential(2)} m | ${Date.now() - t0} ms`);
      expect(worst, id).toBeLessThan(0.01);
    }
  }, 180_000);

  it('north-polar windows match the whole-Moon grid, and only the right way round', async () => {
    // The bundled windows are all south of 45N, so the north-polar products get their own check:
    // a window from each of them against the 16 px/deg grid (whose orientation the DEM tests pin down).
    const g = await decodeLxg(await readFile(new URL('../../public/data/dem/lola_global_16ppd.lxg', import.meta.url)));
    const h = g.header.grids[0] as unknown as { width: number; height: number; latN: number; latS: number; lonW: number; lonE: number; scale: number; offset: number };
    const global = new EquirectSource({ kind: 'equirect', name: 'global', resolutionM: 1895, width: h.width, height: h.height, latN: h.latN, latS: h.latS, lonW: h.lonW, lonE: h.lonE, data: g.arrays[0] as Int16Array, scale: h.scale, offset: h.offset });
    const handler = createTerrainHandler({ cacheDir: null });
    for (const [lat, lon, product] of [[85.2, 30, 'LOLA LDEM_80N_20M'], [70, -120, 'LOLA LDEM_60N_60M']] as const) {
      const res = await handler(get({ lat: String(lat), lon: String(lon) }));
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      const { header, arrays } = await decodeLxg(res.body!);
      expect(header.grids[1].name).toBe(`${product}, 480 m site window (built on request)`);
      const window = new LocalSource({ kind: 'local', name: 'window', resolutionM: 480, lat0: lat, lon0: lon, n: 129, spacingM: 480, data: arrays[1] as Float32Array });
      const correlation = (flipEast: number): number => {
        let n = 0, sw = 0, sg = 0, sww = 0, sgg = 0, swg = 0;
        for (let j = -7; j <= 7; j++) {
          for (let i = -7; i <= 7; i++) {
            // The window averaged over one cell of the whole-Moon grid (4 x 4 samples of 480 m).
            let m = 0;
            for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) {
              const p = offsetPoint(lat, lon, i * 3840 + (a - 1.5) * 480, j * 3840 + (b - 1.5) * 480);
              m += window.sample(p.lat, p.lon);
            }
            const q = offsetPoint(lat, lon, flipEast * i * 3840, j * 3840);
            const v = global.sample(q.lat, q.lon);
            n++; sw += m / 16; sg += v; sww += (m / 16) ** 2; sgg += v * v; swg += (m / 16) * v;
          }
        }
        return (swg - (sw * sg) / n) / Math.sqrt((sww - (sw * sw) / n) * (sgg - (sg * sg) / n));
      };
      const right = correlation(1);
      const mirrored = correlation(-1);
      console.log(`${lat}, ${lon}: ${product} | correlation with the whole-Moon grid ${right.toFixed(3)}, east-west mirrored ${mirrored.toFixed(3)}`);
      expect(right).toBeGreaterThan(0.98);
      expect(mirrored).toBeLessThan(0.6);
    }
  }, 180_000);
});
