// GET /api/terrain?lat=<deg>&lon=<deg>
//
// Builds the elevation window for custom coordinates: the same two grids the catalogued
// sites ship with (60 m to 3.84 km, 480 m to 30.72 km), read from the NASA PDS LOLA /
// SLDEM2015 archive by HTTP range requests. Answers with an LXG file (src/terrain/lxg.ts)
// holding both grids and a header that says which products were used.
//
//   200  application/octet-stream   the window (x-lunyx-cache: hit | miss)
//   400  { error }                  missing or impossible coordinates
//   405  { error }                  anything but GET
//   429  { error }                  too many windows being built; retry-after says when
//   502  { error }                  the archive could not be read
//   504  { error }                  the archive did not answer in time
//
// Finished windows are kept under scripts/.cache/terrain-api/ (git-ignored), so each point
// costs the archive one visit. At most two windows are built at a time, each within a
// fixed time budget, and identical requests share one build.
//
// Handler contract: server/plugin.ts (ApiRequest -> ApiResponse). Runs server-side only.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSiteWindow, packSiteWindow, type RangeReader } from '../../src/terrain/windowBuilder';

/** The parts of the plugin's ApiRequest this handler reads. */
interface TerrainRequest {
  method: string;
  query: URLSearchParams;
}
interface TerrainResponse {
  status: number;
  json?: unknown;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

export interface TerrainHandlerOptions {
  /** Where finished windows are kept. Pass null to keep nothing on disk. */
  cacheDir?: string | null;
  /** How the archive is read; tests supply a synthetic archive. `signal` aborts when the build runs out of time. */
  rangeReader?: (signal: AbortSignal) => RangeReader;
  /** Windows built at the same time (default 2). */
  maxActive?: number;
  /** Builds allowed to wait behind them (default 6); beyond that the answer is 429. */
  maxQueued?: number;
  /** Time budget for one window, waiting included, ms (default 40 000). */
  timeoutMs?: number;
}

/** scripts/.cache/terrain-api/ beside this repository's scripts (falls back to the working directory if the module has no file address). */
function defaultCacheDir(): string {
  try {
    return fileURLToPath(new URL('../../scripts/.cache/terrain-api/', import.meta.url));
  } catch {
    return join(process.cwd(), 'scripts', '.cache', 'terrain-api');
  }
}
// The PDS web server turns away clients that ask too fast (HTTP 403 for a few seconds;
// measured: trouble starts after several hundred requests at 100-200 per second). A window
// needs 270-500 small reads, so they are paced, and a refusal means "wait", not "fail".
const RANGE_CONCURRENCY = 6;
const RANGE_PER_SECOND = 50;
const RANGE_BURST = 20;
const RANGE_TIMEOUT_MS = 15_000;
const RANGE_RETRY_DELAYS_MS = [1000, 2000, 4000];

// ---------------------------------------------------------------- reading the archive

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((go, fail) => {
    if (signal.aborted) return fail(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop);
      go();
    }, ms);
    const stop = (): void => {
      clearTimeout(timer);
      fail(signal.reason);
    };
    signal.addEventListener('abort', stop, { once: true });
  });

/** Range requests to PDS for the whole process: a few at a time, at a steady pace, each with a timeout and retries. */
function pdsRangeReader(): (signal: AbortSignal) => RangeReader {
  let active = 0;
  const waiting: (() => void)[] = [];
  let tokens = RANGE_BURST;
  let stamp = Date.now();
  const pace = async (signal: AbortSignal): Promise<void> => {
    for (;;) {
      const now = Date.now();
      tokens = Math.min(RANGE_BURST, tokens + ((now - stamp) * RANGE_PER_SECOND) / 1000);
      stamp = now;
      if (tokens >= 1) {
        tokens -= 1;
        return;
      }
      await sleep(Math.ceil(((1 - tokens) * 1000) / RANGE_PER_SECOND), signal);
    }
  };
  const acquire = async (signal: AbortSignal): Promise<void> => {
    while (active >= RANGE_CONCURRENCY) {
      await new Promise<void>((go, fail) => {
        const wake = (): void => {
          signal.removeEventListener('abort', stop);
          go();
        };
        const stop = (): void => {
          waiting.splice(waiting.indexOf(wake), 1);
          fail(signal.reason);
        };
        waiting.push(wake);
        signal.addEventListener('abort', stop, { once: true });
      });
    }
    active++;
  };
  const release = (): void => {
    active--;
    waiting.shift()?.();
  };
  return (signal) => async (url, start, length) => {
    await acquire(signal);
    try {
      for (let attempt = 0; ; attempt++) {
        await pace(signal);
        let problem: string;
        try {
          const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` }, signal: AbortSignal.any([signal, AbortSignal.timeout(RANGE_TIMEOUT_MS)]) });
          const bytes = new Uint8Array(await res.arrayBuffer());
          if (res.status === 206 && bytes.length === length) return bytes;
          problem = res.status === 206 ? `short read ${bytes.length}/${length}` : `HTTP ${res.status}`;
          // Refused for asking too fast: hold everything back for a moment.
          if (res.status === 403 || res.status === 429 || res.status === 503) tokens = -RANGE_PER_SECOND;
        } catch (e) {
          if (signal.aborted) throw signal.reason;
          problem = e instanceof Error ? e.message : String(e);
        }
        if (attempt >= RANGE_RETRY_DELAYS_MS.length) throw new Error(`could not read ${url.split('/').pop()} from the PDS archive (${problem})`);
        await sleep(RANGE_RETRY_DELAYS_MS[attempt], signal);
      }
    } finally {
      release();
    }
  };
}

// ---------------------------------------------------------------- handler

class TimedOut extends Error {}

function parseCoordinate(text: string | null): number {
  // Number('') is 0 and Number(' 1 ') is 1: insist on a plain decimal number.
  return text !== null && /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text.trim()) ? Number(text) : NaN;
}

export function createTerrainHandler(options: TerrainHandlerOptions = {}): (req: TerrainRequest) => Promise<TerrainResponse> {
  const cacheDir = options.cacheDir === undefined ? defaultCacheDir() : options.cacheDir;
  const makeReader = options.rangeReader ?? pdsRangeReader();
  const maxActive = options.maxActive ?? 2;
  const maxQueued = options.maxQueued ?? 6;
  const timeoutMs = options.timeoutMs ?? 40_000;

  const inFlight = new Map<string, Promise<Uint8Array>>();
  let running = 0;
  const queue: (() => void)[] = [];

  async function readCache(key: string): Promise<Uint8Array | null> {
    if (!cacheDir) return null;
    try {
      const b = await readFile(join(cacheDir, `${key}.lxg`));
      // "LXG1": anything else is a damaged file, rebuilt below.
      return b.length > 8 && b[0] === 0x4c && b[1] === 0x58 && b[2] === 0x47 && b[3] === 0x31 ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : null;
    } catch {
      return null;
    }
  }

  async function writeCache(key: string, bytes: Uint8Array): Promise<void> {
    if (!cacheDir) return;
    try {
      await mkdir(cacheDir, { recursive: true });
      const tmp = join(cacheDir, `${key}.${process.pid}.${Date.now()}.tmp`);
      await writeFile(tmp, bytes);
      await rename(tmp, join(cacheDir, `${key}.lxg`));
    } catch (e) {
      console.warn('[api/terrain] could not write the window cache:', e instanceof Error ? e.message : e);
    }
  }

  async function build(key: string, lat: number, lon: number): Promise<Uint8Array> {
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new TimedOut(`no complete answer from the PDS archive within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    try {
      // Wait for a free slot, but never past the deadline.
      if (running >= maxActive) {
        await new Promise<void>((go, fail) => {
          const start = (): void => {
            deadline.signal.removeEventListener('abort', giveUp);
            go();
          };
          const giveUp = (): void => {
            queue.splice(queue.indexOf(start), 1);
            fail(deadline.signal.reason);
          };
          queue.push(start);
          deadline.signal.addEventListener('abort', giveUp, { once: true });
        });
      }
      running++;
      try {
        const building = buildSiteWindow(makeReader(deadline.signal), lat, lon);
        // The reader stops on abort, but make sure a hung read cannot hold the answer back.
        const window = await Promise.race([
          building,
          new Promise<never>((_, fail) => deadline.signal.addEventListener('abort', () => fail(deadline.signal.reason), { once: true })),
        ]);
        building.catch(() => undefined);
        const bytes = packSiteWindow(window);
        await writeCache(key, bytes);
        return bytes;
      } finally {
        running--;
        queue.shift()?.();
      }
    } finally {
      clearTimeout(timer);
    }
  }

  return async function handler(req: TerrainRequest): Promise<TerrainResponse> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return { status: 405, json: { error: 'Use GET /api/terrain?lat=<degrees>&lon=<degrees>.' }, headers: { allow: 'GET, HEAD' } };
    const lat = parseCoordinate(req.query.get('lat'));
    const rawLon = parseCoordinate(req.query.get('lon'));
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return { status: 400, json: { error: 'lat must be a number of degrees between -90 and 90 (north positive).' } };
    if (!Number.isFinite(rawLon) || Math.abs(rawLon) > 360) return { status: 400, json: { error: 'lon must be a number of degrees between -360 and 360 (east positive).' } };
    // Canonical form: 5 decimals (0.3 m), longitude in -180..180. "-0" must not make a second cache entry.
    const lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
    const fix = (v: number): number => Number(v.toFixed(5)) + 0;
    const la = fix(lat);
    const lo = fix(lon) === -180 ? 180 : fix(lon);
    const key = `window_${la.toFixed(5)}_${lo.toFixed(5)}`;
    const ok = (bytes: Uint8Array, cache: 'hit' | 'miss'): TerrainResponse => ({
      status: 200,
      body: bytes,
      // The archive products do not change: a window for given coordinates can be kept.
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'public, max-age=86400', 'x-lunyx-cache': cache },
    });

    const cached = await readCache(key);
    if (cached) return ok(cached, 'hit');

    let job = inFlight.get(key);
    if (!job) {
      if (running >= maxActive && queue.length >= maxQueued) {
        return { status: 429, json: { error: 'The elevation server is busy building other windows. Try again in a few seconds.' }, headers: { 'retry-after': '10' } };
      }
      job = build(key, la, lo);
      inFlight.set(key, job);
      const forget = (): void => {
        inFlight.delete(key);
      };
      job.then(forget, forget);
    }
    try {
      return ok(await job, 'miss');
    } catch (e) {
      if (e instanceof TimedOut) return { status: 504, json: { error: `The elevation archive is too slow right now: ${e.message}.` } };
      return { status: 502, json: { error: `The elevation archive could not be read: ${e instanceof Error ? e.message : String(e)}.` } };
    }
  };
}

export default createTerrainHandler();
