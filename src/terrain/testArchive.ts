// Test helper: a synthetic stand-in for the PDS LOLA archive. It answers range requests for
// the SLDEM2015 tiles and the LOLA polar grids with heights computed from one smooth
// function of latitude and longitude, laid out exactly as the PDS labels describe the real
// files. A window built from it must therefore reproduce that function wherever the
// builder's bookkeeping (tiles, bands, seams, projections, byte offsets) is right.
import { polarLatLon } from './geo';
import type { RangeReader } from './windowBuilder';

const DEG = Math.PI / 180;

/**
 * The "terrain": a polynomial in the unit vector of the point, so it is smooth everywhere
 * on the sphere (poles included) and bilinear interpolation over a few hundred metres
 * reproduces it to a fraction of a millimetre. A few kilometres of relief. Metres.
 */
export function syntheticHeight(lat: number, lon: number): number {
  const φ = lat * DEG;
  const λ = lon * DEG;
  const x = Math.cos(φ) * Math.cos(λ);
  const y = Math.cos(φ) * Math.sin(λ);
  const z = Math.sin(φ);
  return 1500 * z + 1200 * (0.8 * x + 0.6 * y) + 900 * (x * x - y * y) + 700 * x * z - 600 * y * z + 400 * z * z;
}

const POLAR_SIZES: Record<string, number> = { '80_20': 30400, '60_60': 31040, '45_100': 28800 };

export interface SyntheticArchive {
  read: RangeReader;
  /** Every request made: file name, first byte, length. */
  log: { file: string; start: number; length: number }[];
}

export function syntheticArchive(height: (lat: number, lon: number) => number = syntheticHeight): SyntheticArchive {
  const log: SyntheticArchive['log'] = [];
  const read: RangeReader = async (url, start, length) => {
    const file = url.split('/').pop() ?? '';
    log.push({ file, start, length });
    const out = new Uint8Array(length);
    const view = new DataView(out.buffer);
    const sldem = /^sldem2015_512_(\d\d)([ns])_(\d\d)([ns])_(\d{3})_(\d{3})_float\.img$/.exec(file);
    if (sldem) {
      // 30-degree bands of 15360 lines, 45-degree tiles of 23040 samples, float32 kilometres, north at the top.
      const top = Math.max(Number(sldem[1]) * (sldem[2] === 'n' ? 1 : -1), Number(sldem[3]) * (sldem[4] === 'n' ? 1 : -1));
      const west = Number(sldem[5]);
      if (start % 4 || length % 4) throw new Error('synthetic archive: unaligned float read');
      const first = start / 4;
      const line = Math.floor(first / 23040);
      const s0 = first % 23040;
      const count = length / 4;
      if (line < 0 || line >= 15360 || s0 + count > 23040) throw new Error(`synthetic archive: read outside ${file}`);
      for (let i = 0; i < count; i++) view.setFloat32(i * 4, height(top - (line + 0.5) / 512, west + (s0 + i + 0.5) / 512) / 1000, true);
      return out;
    }
    const polar = /^ldem_(\d+)([ns])_(\d+)m\.img$/.exec(file);
    if (polar) {
      // Square, pole at the centre, int16 half-metres, polar stereographic.
      const size = POLAR_SIZES[`${polar[1]}_${polar[3]}`];
      if (!size) throw new Error(`synthetic archive: unknown product ${file}`);
      const scale = Number(polar[3]);
      const pole = polar[2] === 'n' ? 'N' : 'S';
      const c = size / 2 - 0.5;
      if (start % 2 || length % 2) throw new Error('synthetic archive: unaligned int16 read');
      const first = start / 2;
      const line = Math.floor(first / size);
      const s0 = first % size;
      const count = length / 2;
      if (line < 0 || line >= size || s0 + count > size) throw new Error(`synthetic archive: read outside ${file}`);
      for (let i = 0; i < count; i++) {
        const p = polarLatLon(pole, (s0 + i - c) * scale, (c - line) * scale);
        view.setInt16(i * 2, Math.round(height(p.lat, p.lon) / 0.5), true);
      }
      return out;
    }
    throw new Error(`synthetic archive: no such file ${file}`);
  };
  return { read, log };
}
