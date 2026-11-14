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
  const res = await fetch(siteUrl(path));
  if (res.status === 404) throw new TerrainFileMissing(path, 'HTTP 404');
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  // A dev server may answer an unknown path with the app's HTML page instead of a 404.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new TerrainFileMissing(path, 'server returned a web page');
  return res.arrayBuffer();
}
