import { describe, expect, it } from 'vitest';
import { localOffset, offsetPoint, polarEdgeLatitude, polarLatLon, polarXY, R_MOON_M, surfaceDistanceM } from './geo';
import { decodeLxg, encodeLxg, gzip, type LxgHeader } from './lxg';
import { createSource, EquirectSource, LocalSource, PolarSource } from './sources';

const DEG = Math.PI / 180;

/** The formula the site-window scripts use (scripts/fetch-terrain.mjs), kept here as an independent reference. */
function scriptOffsetPoint(lat: number, lon: number, east: number, north: number): { lat: number; lon: number } {
  const d = Math.hypot(east, north) / R_MOON_M;
  if (d === 0) return { lat, lon };
  const az = Math.atan2(east, north);
  const la = lat * DEG;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
  const lon2 = lon * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return { lat: lat2 / DEG, lon: lon2 / DEG };
}

const wrap = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

describe('geo', () => {
  it('offsetPoint matches the formula the window scripts were built with', () => {
    for (const [lat, lon] of [[0.6742, 23.4731], [-45.4446, 177.5991], [-84.79, 29.2], [44.1214, -19.5116], [-69.3741, 32.32]]) {
      for (const [e, n] of [[0, 3840], [3840, 0], [-30720, 30720], [12345, -23456], [-60, -60]]) {
        const a = offsetPoint(lat, lon, e, n);
        const b = scriptOffsetPoint(lat, lon, e, n);
        expect(surfaceDistanceM(a.lat, a.lon, b.lat, b.lon)).toBeLessThan(1e-6);
      }
    }
  });

  it('localOffset inverts offsetPoint, including across the antimeridian and at the poles', () => {
    for (const [lat, lon] of [[0, 0], [10, 179.99], [-45.4446, 177.5991], [-89.9, 123], [-90, 40], [90, -75], [-84.79, 29.2]]) {
      for (const [e, n] of [[0, 0], [1000, 0], [0, -2500], [30720, 30720], [-7000.5, 12.25], [250000, -150000]]) {
        const p = offsetPoint(lat, lon, e, n);
        const back = localOffset(lat, lon, p.lat, p.lon);
        expect(back.eastM).toBeCloseTo(e, 5);
        expect(back.northM).toBeCloseTo(n, 5);
      }
    }
  });

  it('travelling east/north covers the stated distance in the stated direction', () => {
    const p = offsetPoint(0, 0, 0, 30000);
    expect(p.lon).toBeCloseTo(0, 9);
    expect(p.lat).toBeCloseTo(30000 / R_MOON_M / DEG, 9);
    const q = offsetPoint(0, 0, 30000, 0);
    expect(q.lat).toBeCloseTo(0, 9);
    expect(q.lon).toBeCloseTo(30000 / R_MOON_M / DEG, 9);
    expect(surfaceDistanceM(-84.79, 29.2, ...Object.values(offsetPoint(-84.79, 29.2, 3000, -4000)) as [number, number])).toBeCloseTo(5000, 6);
  });

  it('polar stereographic: LOLA convention, true scale at the pole, exact inverse', () => {
    // South: longitude 0 is +y (up in the image), 90E is +x. North: longitude 0 is -y.
    expect(polarXY('S', -89, 0).x).toBeCloseTo(0, 6);
    expect(polarXY('S', -89, 0).y).toBeGreaterThan(0);
    expect(polarXY('S', -89, 90).x).toBeGreaterThan(0);
    expect(polarXY('N', 89, 0).y).toBeLessThan(0);
    expect(polarXY('N', 89, 90).x).toBeGreaterThan(0);
    // r = 2 R tan(colatitude / 2): 80S is 304.0 km from the pole in the plane, as in LDEM_80S (7600 px of 80 m).
    expect(Math.hypot(...Object.values(polarXY('S', -80, 33)) as [number, number])).toBeCloseTo(2 * R_MOON_M * Math.tan(5 * DEG), 6);
    expect(2 * R_MOON_M * Math.tan(5 * DEG)).toBeCloseTo(304007, -1);
    expect(polarEdgeLatitude(2 * R_MOON_M * Math.tan(5 * DEG))).toBeCloseTo(80, 9);
    for (const pole of ['S', 'N'] as const) {
      for (const [colat, lon] of [[0.01, 10], [2.5, -170], [10, 90], [14.9, 179.5]]) {
        const lat = pole === 'S' ? -90 + colat : 90 - colat;
        const { x, y } = polarXY(pole, lat, lon);
        const back = polarLatLon(pole, x, y);
        expect(back.lat).toBeCloseTo(lat, 9);
        expect(wrap(back.lon - lon)).toBeCloseTo(0, 7);
      }
    }
  });
});

describe('LocalSource', () => {
  const n = 129;
  const spacingM = 60;
  const c = (n - 1) / 2;
  // A tilted plane plus a bump, defined in the window's own east/north metres.
  const f = (e: number, nn: number): number => 100 + 0.02 * e - 0.05 * nn;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) data[j * n + i] = f((i - c) * spacingM, (j - c) * spacingM);

  for (const [lat0, lon0] of [[0.6742, 23.4731], [-84.79, 29.2], [-45.4446, 177.5991], [-90, 0], [89.99, -120]]) {
    it(`samples a plane exactly anywhere in the window (centre ${lat0}, ${lon0})`, () => {
      const src = new LocalSource({ kind: 'local', name: 'test', resolutionM: 60, lat0, lon0, n, spacingM, data });
      // Grid nodes: j grows northwards, i grows eastwards.
      for (const [i, j] of [[0, 0], [128, 128], [0, 128], [64, 64], [10, 100]]) {
        const p = offsetPoint(lat0, lon0, (i - c) * spacingM, (j - c) * spacingM);
        expect(src.covers(p.lat, p.lon)).toBe(true);
        expect(src.sample(p.lat, p.lon)).toBeCloseTo(data[j * n + i], 3);
      }
      // Between nodes (bilinear is exact on a plane).
      for (const [e, nn] of [[123.4, -987.6], [-3839.9, 3839.9], [0.5, 0.5], [3000, 10]]) {
        const p = offsetPoint(lat0, lon0, e, nn);
        expect(src.sample(p.lat, p.lon)).toBeCloseTo(f(e, nn), 3);
      }
      // Outside the square: no data, in every direction.
      for (const [e, nn] of [[3841, 0], [0, -3841], [-3900, 3900], [50000, 0], [0, 2_000_000]]) {
        const p = offsetPoint(lat0, lon0, e, nn);
        expect(src.covers(p.lat, p.lon)).toBe(false);
        expect(src.sample(p.lat, p.lon)).toBeNaN();
      }
      expect(src.halfWidthM).toBe(3840);
    });
  }

  it('north is up the j axis and east is up the i axis', () => {
    const src = new LocalSource({ kind: 'local', name: 'test', resolutionM: 60, lat0: 10, lon0: 20, n, spacingM, data });
    // The plane falls 0.05 m per metre northwards and rises 0.02 m per metre eastwards.
    expect(src.sample(10 + 1000 / R_MOON_M / DEG, 20)).toBeCloseTo(100 - 50, 2);
    expect(src.sample(10, 20 + 1000 / (R_MOON_M * Math.cos(10 * DEG)) / DEG)).toBeCloseTo(100 + 20, 1);
  });

  it('a hole only spoils samples that touch it', () => {
    const holed = data.slice();
    holed[64 * n + 64] = NaN;
    const src = new LocalSource({ kind: 'local', name: 'test', resolutionM: 60, lat0: 0, lon0: 0, n, spacingM, data: holed });
    expect(src.sample(0, 0)).toBeNaN();
    const near = offsetPoint(0, 0, 30, 30);
    expect(src.sample(near.lat, near.lon)).toBeNaN();
    const onNode = offsetPoint(0, 0, 60, 0);
    expect(src.sample(onNode.lat, onNode.lon)).toBeCloseTo(f(60, 0), 3);
  });

  it('rejects a grid whose size does not match', () => {
    expect(() => new LocalSource({ kind: 'local', name: 'bad', resolutionM: 60, lat0: 0, lon0: 0, n: 10, spacingM, data })).toThrow(/expected 10x10/);
  });
});

describe('EquirectSource', () => {
  // 2 px/deg whole-Moon grid whose value is a smooth function of position, stored as int16 half-metres.
  const width = 720;
  const height = 360;
  const g = (lat: number, lon: number): number => 2000 * Math.sin(lat * DEG) + 1500 * Math.cos(lat * DEG) * Math.cos((lon - 30) * DEG);
  const data = new Int16Array(width * height);
  for (let r = 0; r < height; r++) for (let col = 0; col < width; col++) data[r * width + col] = Math.round(g(90 - (r + 0.5) / 2, -180 + (col + 0.5) / 2) * 2);
  const src = new EquirectSource({ kind: 'equirect', name: 'synthetic', resolutionM: 15000, width, height, latN: 90, latS: -90, lonW: -180, lonE: 180, data, scale: 0.5, offset: 0 });

  it('returns pixel values at pixel centres and interpolates between them', () => {
    expect(src.sample(89.75, -179.75)).toBe(data[0] * 0.5);
    expect(src.sample(-89.75, 179.75)).toBe(data[height * width - 1] * 0.5);
    expect(src.sample(0.25, 0.25)).toBe(data[179 * width + 360] * 0.5);
    for (const [lat, lon] of [[12.3, 45.6], [-67.8, -123.4], [0, 0], [45, 179.9], [-30, -179.9]]) expect(src.sample(lat, lon)).toBeCloseTo(g(lat, lon), 0);
  });

  it('wraps across the antimeridian and accepts any longitude convention', () => {
    const west = src.sample(10, -179.999);
    const east = src.sample(10, 179.999);
    expect(Math.abs(west - east)).toBeLessThan(0.2);
    expect(src.sample(10, 180)).toBeCloseTo(src.sample(10, -180), 9);
    expect(src.sample(-20, 200)).toBeCloseTo(src.sample(-20, -160), 9);
    expect(src.sample(-20, -340)).toBeCloseTo(src.sample(-20, 20), 9);
    expect(src.sample(10, 180)).toBeCloseTo(g(10, 180), 0);
  });

  it('is continuous over the poles', () => {
    for (const lon of [0, 37, -150, 180]) {
      expect(src.sample(90, lon)).toBeCloseTo(g(90, 0), 0);
      expect(src.sample(-90, lon)).toBeCloseTo(g(-90, 0), 0);
      expect(src.sample(89.9, lon)).toBeCloseTo(g(89.9, lon), 0);
    }
    // The same point reached over the pole from either side.
    expect(src.sample(89.999, 10)).toBeCloseTo(src.sample(89.999, -170), 1);
  });

  it('reports no data outside its bounds, and honours a nodata value', () => {
    expect(src.sample(90.01, 0)).toBeNaN();
    expect(src.sample(NaN, 0)).toBeNaN();
    const partial = new EquirectSource({ kind: 'equirect', name: 'patch', resolutionM: 1000, width: 4, height: 2, latN: 10, latS: 8, lonW: 170, lonE: -186 + 360, data: new Int16Array([1, 2, 3, 4, 5, 6, -32768, 8]), scale: 1, offset: 100, nodata: -32768 });
    expect(partial.covers(9, 172)).toBe(true);
    expect(partial.covers(9, 175)).toBe(false);
    expect(partial.covers(7.99, 172)).toBe(false);
    expect(partial.sample(9.5, 170.5)).toBe(101);
    expect(partial.sample(9.5, 171)).toBeCloseTo(101.5, 9);
    expect(partial.sample(8.5, 172.5)).toBeNaN(); // the nodata pixel itself
    expect(partial.sample(8.5, 173.5)).toBe(108);
    expect(partial.sample(9, 169)).toBeNaN();
    // Half a pixel inside the bounds but beyond the last pixel centre: held at the edge value.
    expect(partial.sample(9.9, 170.1)).toBe(101);
  });
});

describe('PolarSource', () => {
  // 40 px of 1 km around the pole; the value encodes the projected x coordinate (east at 90E) in metres / 10.
  const size = 40;
  const metresPerPx = 1000;
  const c = size / 2 - 0.5;
  const make = (pole: 'N' | 'S', fn: (x: number, y: number) => number): PolarSource => {
    const data = new Int16Array(size * size);
    for (let line = 0; line < size; line++) for (let s = 0; s < size; s++) data[line * size + s] = Math.round(fn((s - c) * metresPerPx, (c - line) * metresPerPx) / 10);
    return new PolarSource({ kind: 'polar', name: `synthetic ${pole}`, resolutionM: metresPerPx, pole, size, metresPerPx, data, scale: 10, offset: 0 });
  };

  for (const pole of ['S', 'N'] as const) {
    it(`${pole}: x and y of the projection plane land on the right pixels`, () => {
      const xs = make(pole, (x) => x);
      const ys = make(pole, (_x, y) => y);
      for (const [colat, lon] of [[0.1, 0], [0.3, 90], [0.5, -135], [0.6, 180], [0.2, 47]]) {
        const lat = pole === 'S' ? -90 + colat : 90 - colat;
        const { x, y } = polarXY(pole, lat, lon);
        expect(xs.sample(lat, lon)).toBeCloseTo(x, 0);
        expect(ys.sample(lat, lon)).toBeCloseTo(y, 0);
      }
      // The pole itself sits between the four centre pixels.
      expect(xs.sample(pole === 'S' ? -90 : 90, 0)).toBeCloseTo(0, 6);
    });

    it(`${pole}: covers exactly the square between the outer pixel centres`, () => {
      const src = make(pole, () => 50);
      expect(src.halfWidthM).toBe(19500);
      const at = (x: number, y: number): number => {
        const p = polarLatLon(pole, x, y);
        return src.sample(p.lat, p.lon);
      };
      expect(at(19499, 0)).toBe(50);
      expect(at(-19499, 19499)).toBe(50);
      expect(at(19501, 0)).toBeNaN();
      expect(at(0, -19501)).toBeNaN();
      expect(at(19400, 19600)).toBeNaN();
      // The other hemisphere is never covered, not even where the projection would wrap.
      expect(src.sample(pole === 'S' ? 45 : -45, 10)).toBeNaN();
      expect(src.sample(pole === 'S' ? 90 : -90, 10)).toBeNaN();
      expect(src.covers(pole === 'S' ? -89.9 : 89.9, 10)).toBe(true);
    });
  }

  it('honours nodata and scale/offset', () => {
    const data = new Int16Array(16).fill(4);
    data[5] = -32768;
    const src = new PolarSource({ kind: 'polar', name: 't', resolutionM: 100, pole: 'S', size: 4, metresPerPx: 100, data, scale: 0.5, offset: 1000, nodata: -32768 });
    const p = polarLatLon('S', 50, -50); // centre of pixel (line 2, sample 2)
    expect(src.sample(p.lat, p.lon)).toBeCloseTo(1002, 6);
    const q = polarLatLon('S', -50, 50); // centre of pixel (line 1, sample 1) = index 5
    expect(src.sample(q.lat, q.lon)).toBeNaN();
  });
});

describe('createSource', () => {
  it('rebuilds each kind from a plain descriptor (what arrives on the far side of a worker)', () => {
    const local = createSource({ kind: 'local', name: 'l', resolutionM: 60, lat0: 1, lon0: 2, n: 3, spacingM: 60, data: new Float32Array(9).fill(7) });
    expect(local).toBeInstanceOf(LocalSource);
    expect(local.sample(1, 2)).toBe(7);
    const eq = createSource(structuredClone({ kind: 'equirect', name: 'e', resolutionM: 1, width: 2, height: 1, latN: 90, latS: -90, lonW: -180, lonE: 180, data: new Int16Array([10, 20]), scale: 1, offset: 0 } as const));
    expect(eq.sample(0, -90)).toBe(10);
    expect(eq.sample(0, 90)).toBe(20);
    expect(() => createSource({ kind: 'nope' } as never)).toThrow(/unknown height grid kind/);
  });
});

describe('LXG container', () => {
  const header = (grids: LxgHeader['grids']): LxgHeader => ({ format: 'lunyx-grid/1', note: 'héllo', grids });

  it('round-trips int16 grids losslessly through the predictor, including extreme jumps', async () => {
    const w = 257;
    const h = 131;
    const a = new Int16Array(w * h);
    let seed = 12345;
    const rand = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < a.length; i++) a[i] = Math.round(3000 * Math.sin(i / 40) + 500 * rand());
    a[0] = -32768;
    a[1] = 32767;
    a[w] = 32767;
    a[w + 1] = -32768;
    a[5 * w + 7] = -32768;
    const body = encodeLxg(header([{ dtype: 'int16', encoding: 'plane-delta', width: w, height: h, kind: 'polar' }]), [a]);
    const plain = await decodeLxg(body);
    expect(plain.header.note).toBe('héllo');
    expect(plain.arrays[0]).toEqual(a);
    const zipped = await gzip(body);
    expect(zipped[0]).toBe(0x1f);
    expect((await decodeLxg(zipped)).arrays[0]).toEqual(a);
    expect((await decodeLxg(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer)).arrays[0]).toEqual(a);
  });

  it('carries several grids and float data with gaps', async () => {
    const f = new Float32Array([1.5, NaN, -3.25, 1e6, 0, -0]);
    const i = new Int16Array([1, -2, 3, -4]);
    const out = await decodeLxg(encodeLxg(header([{ dtype: 'float32', encoding: 'raw', width: 3, height: 2 }, { dtype: 'int16', encoding: 'raw', width: 2, height: 2 }]), [f, i]));
    expect(out.arrays[0]).toEqual(f);
    expect(out.arrays[1]).toEqual(i);
    expect(out.header.grids).toHaveLength(2);
  });

  it('reads from an unaligned view into a larger buffer (how Node hands files over)', async () => {
    const f = new Float32Array([1.5, -2.5, 3.25, 4]);
    const body = encodeLxg(header([{ dtype: 'float32', encoding: 'raw', width: 2, height: 2 }]), [f]);
    const pool = new Uint8Array(body.length + 7);
    pool.set(body, 3);
    expect((await decodeLxg(pool.subarray(3, 3 + body.length))).arrays[0]).toEqual(f);
  });

  it('refuses damaged input instead of guessing', async () => {
    await expect(decodeLxg(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).rejects.toThrow(/not a Lunyx grid/);
    const body = encodeLxg(header([{ dtype: 'int16', encoding: 'raw', width: 4, height: 4 }]), [new Int16Array(16)]);
    await expect(decodeLxg(body.subarray(0, body.length - 3))).rejects.toThrow(/truncated/);
    expect(() => encodeLxg(header([{ dtype: 'int16', encoding: 'raw', width: 4, height: 4 }]), [new Int16Array(15)])).toThrow(/samples/);
    expect(() => encodeLxg(header([{ dtype: 'float32', encoding: 'plane-delta', width: 1, height: 1 }]), [new Float32Array(1)])).toThrow(/int16 only/);
  });
});
