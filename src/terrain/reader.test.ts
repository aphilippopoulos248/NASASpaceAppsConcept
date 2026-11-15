import { describe, expect, it } from 'vitest';
import { fetchTerrainBytes, RETRY_DELAYS_MS, TerrainFileMissing, type FetchDeps, type LockLike } from './reader';

const BYTES = new Uint8Array([1, 2, 3, 4]).buffer;
const ok = () => new Response(BYTES.slice(0), { status: 200, headers: { 'content-type': 'application/octet-stream' } });
const status = (code: number, type = 'text/plain') => () => new Response('x', { status: code, headers: { 'content-type': type } });
const netFail = (text = 'net::ERR_CACHE_WRITE_FAILURE') => () => {
  throw new TypeError(text);
};
/** A response whose body fails half way, as a cache-write failure can. */
const bodyFails = () => ({ status: 200, ok: true, headers: new Headers({ 'content-type': 'application/octet-stream' }), arrayBuffer: () => Promise.reject(new TypeError('network error')) }) as unknown as Response;

function setup(responses: (() => Response)[], locks: LockLike | null = null) {
  const calls: (RequestInit | undefined)[] = [];
  const sleeps: number[] = [];
  let k = 0;
  const deps: FetchDeps = {
    fetch: async (_url, init) => {
      calls.push(init);
      return responses[Math.min(k++, responses.length - 1)]();
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    locks,
  };
  return { deps, calls, sleeps };
}

/** Web Locks as the browser does them: requests for one name run one after the other. */
function queueLocks() {
  const tails = new Map<string, Promise<unknown>>();
  const names: string[] = [];
  const locks: LockLike = {
    request(name, _options, callback) {
      names.push(name);
      const run = (tails.get(name) ?? Promise.resolve()).then(callback);
      tails.set(name, run.catch(() => undefined));
      return run;
    },
  };
  return { locks, names };
}

describe('terrain downloads', () => {
  it('downloads once, through the HTTP cache, when all is well', async () => {
    const { deps, calls, sleeps } = setup([ok]);
    expect(new Uint8Array(await fetchTerrainBytes('data/dem/a.lxg', 'http://x/data/dem/a.lxg', deps))).toEqual(new Uint8Array(BYTES));
    expect(calls).toEqual([undefined]);
    expect(sleeps).toEqual([]);
  });

  it('tries a failed download again after a pause, past the HTTP cache', async () => {
    const { deps, calls, sleeps } = setup([netFail(), ok]);
    expect((await fetchTerrainBytes('a.lxg', 'u', deps)).byteLength).toBe(4);
    expect(calls).toEqual([undefined, { cache: 'no-store' }]);
    expect(sleeps).toEqual([RETRY_DELAYS_MS[0]]);
  });

  it('tries again when the body fails half way', async () => {
    const { deps, calls } = setup([bodyFails, ok]);
    expect((await fetchTerrainBytes('a.lxg', 'u', deps)).byteLength).toBe(4);
    expect(calls).toHaveLength(2);
  });

  it('gives up after three tries and says why', async () => {
    const { deps, calls, sleeps } = setup([netFail()]);
    await expect(fetchTerrainBytes('data/dem/lola_global_16ppd.lxg', 'u', deps)).rejects.toThrow(/^data\/dem\/lola_global_16ppd\.lxg: net::ERR_CACHE_WRITE_FAILURE \(tried 3 times\)$/);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([...RETRY_DELAYS_MS]);
  });

  it('tries server errors again, but not a missing or forbidden file', async () => {
    const busy = setup([status(503), ok]);
    expect((await fetchTerrainBytes('a.lxg', 'u', busy.deps)).byteLength).toBe(4);
    expect(busy.calls).toHaveLength(2);

    const missing = setup([status(404), ok]);
    await expect(fetchTerrainBytes('a.lxg', 'u', missing.deps)).rejects.toBeInstanceOf(TerrainFileMissing);
    expect(missing.calls).toHaveLength(1);

    const page = setup([status(200, 'text/html; charset=utf-8'), ok]);
    await expect(fetchTerrainBytes('a.lxg', 'u', page.deps)).rejects.toBeInstanceOf(TerrainFileMissing);
    expect(page.calls).toHaveLength(1);

    const forbidden = setup([status(403), ok]);
    await expect(fetchTerrainBytes('a.lxg', 'u', forbidden.deps)).rejects.toThrow('a.lxg: HTTP 403');
    expect(forbidden.calls).toHaveLength(1);
  });

  it('downloads a file once at a time across the page and its workers, different files side by side', async () => {
    const { locks, names } = queueLocks();
    let inFlight = 0, most = 0;
    const deps: FetchDeps = {
      fetch: async () => {
        most = Math.max(most, ++inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return ok();
      },
      sleep: async () => undefined,
      locks,
    };
    // The page and two workers asking for the same grid at once: one download at a time.
    await Promise.all([1, 2, 3].map(() => fetchTerrainBytes('data/dem/lola_global_16ppd.lxg', 'u', deps)));
    expect(most).toBe(1);
    expect(names).toEqual(Array(3).fill('lunyx-terrain data/dem/lola_global_16ppd.lxg'));
    // Two different files do not wait for each other.
    most = 0;
    await Promise.all(['data/dem/lola_south_85s_80m.lxg', 'data/dem/lola_south_875s_40m.lxg'].map((p) => fetchTerrainBytes(p, 'u', deps)));
    expect(most).toBe(2);
  });

  it('goes ahead alone when the lock cannot be had in time', async () => {
    const refused: LockLike = { request: () => Promise.reject(new DOMException('waited too long', 'TimeoutError')) };
    const { deps, calls } = setup([ok], refused);
    expect((await fetchTerrainBytes('a.lxg', 'u', deps)).byteLength).toBe(4);
    expect(calls).toHaveLength(1);
  });

  it('does not start over outside the lock when the tries inside it failed', async () => {
    const { locks } = queueLocks();
    const { deps, calls } = setup([netFail()], locks);
    await expect(fetchTerrainBytes('a.lxg', 'u', deps)).rejects.toThrow(/tried 3 times/);
    expect(calls).toHaveLength(3);
  });
});
