// "LXG" grid container: how Lunyx stores elevation grids on disk and sends site windows
// from the server. One file holds a JSON header and one or more grids.
//
//   bytes 0..3   "LXG1"
//   bytes 4..7   header length H, uint32 little-endian
//   bytes 8..    H bytes of UTF-8 JSON (see LxgHeader), then the grids back to back
//
// The whole file is normally gzip-compressed; readers accept it with or without the gzip
// wrapper (some web servers unwrap .gz content on the way out).
//
// Grid encodings:
//   raw          little-endian samples, row by row
//   plane-delta  int16 only, lossless. Each sample is predicted from its left, upper and
//                upper-left neighbours (left + up - upperLeft, missing neighbours = 0); the
//                difference is zigzag-coded and its low and high bytes are stored as two
//                separate planes. Smooth terrain then gzips to roughly half the size.
//
// No imports on purpose: Node build scripts load this file directly.

export interface LxgGrid {
  dtype: 'int16' | 'float32';
  encoding: 'raw' | 'plane-delta';
  width: number;
  height: number;
  /** Anything else the writer wants to say about the grid (projection, scale, source...). */
  [key: string]: unknown;
}

export interface LxgHeader {
  format: 'lunyx-grid/1';
  grids: LxgGrid[];
  [key: string]: unknown;
}

export interface LxgFile {
  header: LxgHeader;
  /** One array per entry of header.grids, in the same order. */
  arrays: (Int16Array | Float32Array)[];
}

const MAGIC = [0x4c, 0x58, 0x47, 0x31]; // "LXG1"

/** Builds the uncompressed container. Gzip the result for storage. */
export function encodeLxg(header: LxgHeader, arrays: readonly (Int16Array | Float32Array)[]): Uint8Array {
  assertLittleEndian();
  if (header.grids.length !== arrays.length) throw new Error('LXG: one array per grid is required');
  const json = new TextEncoder().encode(JSON.stringify(header));
  let total = 8 + json.length;
  header.grids.forEach((g, k) => {
    const count = g.width * g.height;
    if (arrays[k].length !== count) throw new Error(`LXG: grid ${k} has ${arrays[k].length} samples, header says ${count}`);
    if ((g.dtype === 'int16') !== arrays[k] instanceof Int16Array) throw new Error(`LXG: grid ${k} dtype does not match its array`);
    if (g.encoding === 'plane-delta' && g.dtype !== 'int16') throw new Error('LXG: plane-delta is defined for int16 only');
    total += count * (g.dtype === 'int16' ? 2 : 4);
  });
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let offset = 8 + json.length;
  header.grids.forEach((g, k) => {
    const a = arrays[k];
    const count = a.length;
    if (g.encoding === 'plane-delta') {
      encodePlaneDelta(a as Int16Array, g.width, g.height, out.subarray(offset, offset + 2 * count));
    } else {
      out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), offset);
    }
    offset += a.byteLength;
  });
  return out;
}

/** Reads a container, gzip-wrapped or not. */
export async function decodeLxg(input: ArrayBuffer | Uint8Array): Promise<LxgFile> {
  assertLittleEndian();
  let bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  if (bytes.length < 8 || MAGIC.some((m, i) => bytes[i] !== m)) throw new Error('LXG: not a Lunyx grid file');
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (8 + headerLength > bytes.length) throw new Error('LXG: truncated header');
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLength))) as LxgHeader;
  if (header.format !== 'lunyx-grid/1' || !Array.isArray(header.grids)) throw new Error('LXG: unsupported header');
  let offset = 8 + headerLength;
  const arrays: (Int16Array | Float32Array)[] = [];
  for (const g of header.grids) {
    const count = g.width * g.height;
    if (!Number.isInteger(count) || count < 0) throw new Error('LXG: bad grid size');
    const byteLength = count * (g.dtype === 'int16' ? 2 : g.dtype === 'float32' ? 4 : NaN);
    if (!(offset + byteLength <= bytes.length)) throw new Error('LXG: truncated grid data');
    const chunk = bytes.subarray(offset, offset + byteLength);
    if (g.dtype === 'int16' && g.encoding === 'plane-delta') {
      arrays.push(decodePlaneDelta(chunk, g.width, g.height));
    } else if (g.encoding === 'raw') {
      // Copy into a buffer of its own: the chunk may not be aligned for a typed-array view,
      // and it may be a Node Buffer, whose slice() would only make another view.
      const copy = new Uint8Array(chunk).buffer;
      arrays.push(g.dtype === 'int16' ? new Int16Array(copy) : new Float32Array(copy));
    } else {
      throw new Error(`LXG: unsupported encoding ${String(g.encoding)} for ${String(g.dtype)}`);
    }
    offset += byteLength;
  }
  return { header, arrays };
}

function encodePlaneDelta(v: Int16Array, width: number, height: number, out: Uint8Array): void {
  const count = width * height;
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const left = x > 0 ? v[i - 1] : 0;
      const up = y > 0 ? v[i - width] : 0;
      const upLeft = x > 0 && y > 0 ? v[i - width - 1] : 0;
      const res = ((v[i] - (left + up - upLeft)) << 16) >> 16; // wrap to int16
      const u = ((res << 1) ^ (res >> 15)) & 0xffff; // zigzag: small magnitudes -> small numbers
      out[i] = u & 0xff;
      out[count + i] = u >>> 8;
    }
  }
}

function decodePlaneDelta(bytes: Uint8Array, width: number, height: number): Int16Array {
  const count = width * height;
  const v = new Int16Array(count);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const u = bytes[i] | (bytes[count + i] << 8);
      const res = (u >>> 1) ^ -(u & 1);
      const left = x > 0 ? v[i - 1] : 0;
      const up = y > 0 ? v[i - width] : 0;
      const upLeft = x > 0 && y > 0 ? v[i - width - 1] : 0;
      v[i] = res + left + up - upLeft; // the typed array wraps to int16
    }
  }
  return v;
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('LXG: this runtime cannot decompress gzip (DecompressionStream is missing)');
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Gzip helper for writers that have no zlib at hand (tests, browsers). Node scripts use zlib directly. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function assertLittleEndian(): void {
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) throw new Error('LXG: big-endian platforms are not supported');
}
