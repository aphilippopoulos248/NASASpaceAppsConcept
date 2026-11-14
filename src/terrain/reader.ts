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

async function defaultReader(path: string): Promise<ArrayBuffer> {
  // Vite replaces import.meta.env.SSR with `false` in the browser build, which removes
  // this branch (and the Node-only module behind it) from the bundle.
  if (import.meta.env.SSR) {
    const node = await import('./nodeReader');
    return node.readPublicFile(path);
  }
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (res.status === 404) throw new TerrainFileMissing(path, 'HTTP 404');
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  // A dev server may answer an unknown path with the app's HTML page instead of a 404.
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new TerrainFileMissing(path, 'server returned a web page');
  return res.arrayBuffer();
}
