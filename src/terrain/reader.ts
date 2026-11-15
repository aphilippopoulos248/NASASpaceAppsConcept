// How terrain files reach the loaders. In the browser they are fetched from the site
// root; under Node (vitest, scripts run through Vite) they are read from public/.
// Tests and unusual hosts can inject their own reader.

/** Reads a file of the site root, e.g. 'terrain/apollo-11.bin' or 'data/dem/index.json'. Rejects with TerrainFileMissing when it does not exist. */
export type BinaryReader = (path: string) => Promise<ArrayBuffer>;

export class TerrainFileMissing extends Error {
  constructor(path: string, detail?: string) {
    super(`terrain file not found: ${path}${detail ? ` (${detail})` : ''}`);
    this.name = 'TerrainFileMissing';
  }
}

let injected: BinaryReader | null = null;

/** Replaces the way terrain files are read (pass null to restore the default). */
export function setTerrainReader(reader: BinaryReader | null): void {
  injected = reader;
}

export function readTerrainFile(path: string): Promise<ArrayBuffer> {
  return (injected ?? defaultReader)(path);
}

export async function readTerrainJson<T>(path: string): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await readTerrainFile(path))) as T;
}

/**
 * Absolute URL of a path under the site root. Works in pages, in ordinary workers and in
 * workers started from a blob: URL (whose own address cannot anchor a relative URL).
 */
export function siteUrl(path: string): string {
  const relative = `${import.meta.env.BASE_URL}${path}`;
  const here = (globalThis as { location?: { href?: string; origin?: string } }).location;
  for (const base of [here?.href, here?.origin]) {
    if (!base) continue;
    try {
      return new URL(relative, base).href;
    } catch {
      /* try the next anchor */
    }
  }
  return relative;
}

async function defaultReader(path: string): Promise<ArrayBuffer> {
  // Vite replaces import.meta.env.SSR with `false` in the browser build, which removes
  // this branch (and the Node-only module behind it) from the bundle.
  if (import.meta.env.SSR) {
    const node = await import('./nodeReader');
    return node.readPublicFile(path);
  }
  const locks = (globalThis as { navigator?: { locks?: LockLike } }).navigator?.locks ?? null;
  return fetchTerrainBytes(path, siteUrl(path), {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    locks,
  });
}

// ---------------------------------------------------------------- downloading in the browser
//
// The page and the analysis worker are separate JavaScript realms. Each keeps its own cache
// of decoded grids, so opening a site used to start the same download (the 15.6 MB whole-Moon
// grid, the south-polar layers) two or three times at once. With several 15 MB writes of one
// entry under way, Chromium sometimes failed one of them with ERR_CACHE_WRITE_FAILURE, and
// that grid was then missing (coarser relief, a coarser elevation in the site card).
// Two measures:
// - One download of a file at a time across the page and its workers (the Web Locks API).
//   The second asker waits, then normally gets the file from the browser's HTTP cache.
// - A failed download is tried again, twice, after a pause, past the HTTP cache.

/** The part of the Web Locks API used here (navigator.locks, in pages and workers). */
export interface LockLike {
  request<T>(name: string, options: { signal?: AbortSignal }, callback: () => Promise<T>): Promise<T>;
}

export interface FetchDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  /** null where the platform has no Web Locks (non-secure pages, old browsers): no waiting then. */
  locks: LockLike | null;
}

/** Pauses before the second and third try. */
export const RETRY_DELAYS_MS = [500, 2000] as const;
/** Longest wait for another page's or worker's download of the same file before going ahead alone. */
export const LOCK_WAIT_MS = 120_000;

/** A failure worth trying again: the network or the server, not a missing file. */
class Retryable extends Error {}

/** Downloads one terrain file: one download of it at a time across realms, three tries. */
export async function fetchTerrainBytes(path: string, url: string, deps: FetchDeps): Promise<ArrayBuffer> {
  const once = async (bypassCache: boolean): Promise<ArrayBuffer> => {
    let res: Response;
    try {
      res = await deps.fetch(url, bypassCache ? { cache: 'no-store' } : undefined);
    } catch (e) {
      throw new Retryable(e instanceof Error ? e.message : String(e));
    }
    if (res.status === 404) throw new TerrainFileMissing(path, 'HTTP 404');
    if (res.status >= 500 || res.status === 408 || res.status === 429) throw new Retryable(`HTTP ${res.status}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    // A dev server may answer an unknown path with the app's HTML page instead of a 404.
    if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new TerrainFileMissing(path, 'server returned a web page');
    try {
      return await res.arrayBuffer();
    } catch (e) {
      // The body can fail half way (the cache-write failure shows up here too).
      throw new Retryable(e instanceof Error ? e.message : String(e));
    }
  };
  const withRetries = async (): Promise<ArrayBuffer> => {
    let last = '';
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await deps.sleep(RETRY_DELAYS_MS[attempt - 1]);
      try {
        // Later tries go past the HTTP cache: the failures seen were the browser failing to write it.
        return await once(attempt > 0);
      } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        last = e.message;
      }
    }
    throw new Error(`${path}: ${last} (tried ${RETRY_DELAYS_MS.length + 1} times)`);
  };
  if (!deps.locks) return withRetries();
  let started = false;
  try {
    return await deps.locks.request(`lunyx-terrain ${path}`, { signal: AbortSignal.timeout(LOCK_WAIT_MS) }, () => {
      started = true;
      return withRetries();
    });
  } catch (e) {
    // Waited too long for someone else's download of this file, or locks are refused here: go ahead alone.
    if (!started) return withRetries();
    throw e;
  }
}
