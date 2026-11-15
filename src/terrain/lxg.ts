// "LXG" grid container: how Lunyx stores gridded data on disk (elevation, polar average
// maps) and sends site windows from the server. One file holds a JSON header and one or
// more grids.
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
//   plane-delta  int16 and uint8, lossless. Each sample is predicted from its left, upper
//                and upper-left neighbours (left + up - upperLeft, missing neighbours = 0);
//                the difference (wrapped to the sample width) is zigzag-coded. For int16
//                its low and high bytes are stored as two separate planes. Smooth fields
//                then gzip to roughly half the size.
//
// No imports on purpose: Node build scripts load this file directly.

export type LxgArray = Int16Array | Float32Array | Uint8Array;

export interface LxgGrid {
  dtype: 'int16' | 'float32' | 'uint8';
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
  arrays: LxgArray[];
}

const BYTES_PER_SAMPLE: Record<string, number> = { int16: 2, float32: 4, uint8: 1 };

const MAGIC = [0x4c, 0x58, 0x47, 0x31]; // "LXG1"

/** Builds the uncompressed container. Gzip the result for storage. */
export function encodeLxg(header: LxgHeader, arrays: readonly LxgArray[]): Uint8Array {
  assertLittleEndian();
  if (header.grids.length !== arrays.length) throw new Error('LXG: one array per grid is required');
  const json = new TextEncoder().encode(JSON.stringify(header));
  let total = 8 + json.length;
  header.grids.forEach((g, k) => {
    const count = g.width * g.height;
    const a = arrays[k];
    if (a.length !== count) throw new Error(`LXG: grid ${k} has ${a.length} samples, header says ${count}`);
    const matches = g.dtype === 'int16' ? a instanceof Int16Array : g.dtype === 'float32' ? a instanceof Float32Array : g.dtype === 'uint8' ? a instanceof Uint8Array : false;
    if (!matches) throw new Error(`LXG: grid ${k} dtype does not match its array`);
    if (g.encoding === 'plane-delta' && g.dtype === 'float32') throw new Error('LXG: plane-delta is defined for int16 and uint8 only');
    total += count * BYTES_PER_SAMPLE[g.dtype];
  });
  const out = new Uint8Array(total);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let offset = 8 + json.length;
  header.grids.forEach((g, k) => {
    const a = arrays[k];
    const target = out.subarray(offset, offset + a.byteLength);
    if (g.encoding === 'plane-delta' && a instanceof Int16Array) encodePlaneDelta(a, g.width, g.height, target);
    else if (g.encoding === 'plane-delta' && a instanceof Uint8Array) encodePlaneDelta8(a, g.width, g.height, target);
    else target.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
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
  const arrays: LxgArray[] = [];
  for (const g of header.grids) {
    const count = g.width * g.height;
    if (!Number.isInteger(count) || count < 0) throw new Error('LXG: bad grid size');
    const byteLength = count * (BYTES_PER_SAMPLE[g.dtype] ?? NaN);
    if (!(offset + byteLength <= bytes.length)) throw new Error(Number.isNaN(byteLength) ? `LXG: unsupported sample type ${String(g.dtype)}` : 'LXG: truncated grid data');
    const chunk = bytes.subarray(offset, offset + byteLength);
    if (g.dtype === 'int16' && g.encoding === 'plane-delta') {
      arrays.push(decodePlaneDelta(chunk, g.width, g.height));
    } else if (g.dtype === 'uint8' && g.encoding === 'plane-delta') {
      arrays.push(decodePlaneDelta8(chunk, g.width, g.height));
    } else if (g.encoding === 'raw') {
      // Copy into a buffer of its own: the chunk may not be aligned for a typed-array view,
      // and it may be a Node Buffer, whose slice() would only make another view.
      const copy = new Uint8Array(chunk);
      arrays.push(g.dtype === 'int16' ? new Int16Array(copy.buffer) : g.dtype === 'float32' ? new Float32Array(copy.buffer) : copy);
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

function encodePlaneDelta8(v: Uint8Array, width: number, height: number, out: Uint8Array): void {
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const left = x > 0 ? v[i - 1] : 0;
      const up = y > 0 ? v[i - width] : 0;
      const upLeft = x > 0 && y > 0 ? v[i - width - 1] : 0;
      const res = ((v[i] - (left + up - upLeft)) << 24) >> 24; // wrap to int8
      out[i] = ((res << 1) ^ (res >> 7)) & 0xff;
    }
  }
}

function decodePlaneDelta8(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const v = new Uint8Array(width * height);
  for (let y = 0, i = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const u = bytes[i];
      const res = (u >>> 1) ^ -(u & 1);
      const left = x > 0 ? v[i - 1] : 0;
      const up = y > 0 ? v[i - width] : 0;
      const upLeft = x > 0 && y > 0 ? v[i - width - 1] : 0;
      v[i] = res + left + up - upLeft; // the typed array wraps to uint8
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
