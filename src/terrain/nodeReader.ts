// Node-only: reads terrain files straight from public/. Used by the default reader under
// vitest and by scripts; never part of the browser bundle.
//
// The browser tsconfig carries no Node typings (adding them would change the types of
// timers and globals for every browser module), so the one Node API needed here is
// imported dynamically and typed by hand.
import { TerrainFileMissing, type BinaryReader } from './reader';

interface NodeFs {
  readFile(path: string | URL): Promise<Uint8Array>;
}
const NODE_FS: string = 'node:fs/promises';
let fs: Promise<NodeFs> | null = null;
const nodeFs = (): Promise<NodeFs> => (fs ??= import(/* @vite-ignore */ NODE_FS) as Promise<NodeFs>);

/** A reader rooted at a directory laid out like public/ (a file: URL or an absolute path, with or without the trailing slash). */
export function directoryReader(dir: string | URL): BinaryReader {
  const text = String(dir);
  const root = text.endsWith('/') ? text : `${text}/`;
  const isUrl = dir instanceof URL || text.startsWith('file:');
  return async (path) => {
    if (path.split('/').some((part) => part === '..' || part === '')) throw new Error(`bad terrain path: ${path}`);
    try {
      const b = await (await nodeFs()).readFile(isUrl ? new URL(path, root) : root + path);
      // A Node Buffer can be a view into a shared pool; hand back exactly its own bytes.
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') throw new TerrainFileMissing(path);
      throw e;
    }
  };
}

/** Reads from this repository's public/ directory. */
export const readPublicFile: BinaryReader = directoryReader(new URL('../../public/', import.meta.url));
