// Builds a site window (the same two grids as public/terrain/<id>.bin) for any coordinates,
// straight from the PDS LOLA archive by HTTP range requests: only the rows around the site
// are read, never the multi-gigabyte files.
//
//   60 m grid, 129 x 129, to 3.84 km from the site
//   480 m grid, 129 x 129, to 30.72 km
//
// Same recipe as scripts/fetch-terrain.mjs (which built the bundled windows): each grid
// sample is the point reached by travelling east/north over the sphere from the site; the
// source is read at every `step`-th line and sample and interpolated bilinearly. So the
// 480 m grid is a subsample of the source, not an average.
//
// Sources, by latitude of each sample:
//   SLDEM2015 512 px/deg (59 m)        between 60S and 60N
//   LOLA LDEM_80x_20M (20 m)           poleward of about 80.6 degrees
//   LOLA LDEM_60x_60M (60 m)           the rest of the polar caps
//   LOLA LDEM_45x_100M (100 m)         only the thin seam at 60 degrees where the two above meet
// A window that straddles products is stitched from them and lists every product it used.
//
// Environment-neutral: the caller supplies the range reader (the server uses fetch).
import { offsetPoint, polarXY } from './geo';
import { encodeLxg, type LxgHeader } from './lxg';

export const WINDOW_SIZE = 129;
export const WINDOW_LEVELS = [
  { name: 'inner', spacingM: 60 },
  { name: 'outer', spacingM: 480 },
] as const;

/** Reads `length` bytes of a remote file starting at `start`. Must reject on anything but a full answer. */
export type RangeReader = (url: string, start: number, length: number) => Promise<Uint8Array>;

export const PDS_LOLA = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data';
const R = 1_737_400;

interface Product {
  /** Shown in labels, e.g. "SLDEM2015 512 ppd" or "LOLA LDEM_80S_20M". */
  label: string;
  nativeSpacingM: number;
  /** Fractional (line, sample) of a point. `refLon` keeps samples continuous across the 0/360 seam. */
  toPixel(lat: number, lon: number, refLon: number): { line: number; sample: number };
  /** True when a bilinear read at that pixel position, with rows/columns `margin` pixels apart, stays inside the product. */
  inside(line: number, sample: number, margin: number): boolean;
  /** Heights in metres for `count` consecutive samples of one line. */
  readLine(read: RangeReader, line: number, s0: number, count: number): Promise<Float32Array>;
}

// SLDEM2015: 512 px/deg, 60S..60N, float32 kilometres, in 4 latitude bands x 8 longitude tiles.
const SLDEM_PPD = 512;
const SLDEM_LINES = 120 * SLDEM_PPD;
const SLDEM_SAMPLES = 360 * SLDEM_PPD;
const SLDEM_BANDS = ['30n_60n', '00n_30n', '30s_00s', '60s_30s'];
const TILE_LINES = 30 * SLDEM_PPD;
const TILE_SAMPLES = 45 * SLDEM_PPD;

const sldem: Product = {
  label: 'SLDEM2015 512 ppd',
  nativeSpacingM: (Math.PI * R) / (180 * SLDEM_PPD),
  toPixel(lat, lon, refLon) {
    const ref360 = ((refLon % 360) + 360) % 360;
    let d = lon - refLon;
    d -= 360 * Math.round(d / 360);
    return { line: (60 - lat) * SLDEM_PPD - 0.5, sample: (ref360 + d) * SLDEM_PPD - 0.5 };
  },
  inside(line, _sample, margin) {
    return line >= margin && line <= SLDEM_LINES - 1 - margin; // longitude wraps, latitude does not
  },
  async readLine(read, line, s0, count) {
    if (line < 0 || line >= SLDEM_LINES) throw new Error(`SLDEM2015 has no line ${line}`);
    const band = Math.floor(line / TILE_LINES);
    const out = new Float32Array(count);
    // A request may straddle two 45-degree tiles, or the 0/360 seam.
    for (let done = 0; done < count; ) {
      const s = (((s0 + done) % SLDEM_SAMPLES) + SLDEM_SAMPLES) % SLDEM_SAMPLES;
      const tile = Math.floor(s / TILE_SAMPLES);
      const n = Math.min(count - done, (tile + 1) * TILE_SAMPLES - s);
      const w = String(tile * 45).padStart(3, '0');
      const e = String(tile * 45 + 45).padStart(3, '0');
      const url = `${PDS_LOLA}/sldem2015/tiles/float_img/sldem2015_512_${SLDEM_BANDS[band]}_${w}_${e}_float.img`;
      const bytes = await read(url, ((line - band * TILE_LINES) * TILE_SAMPLES + (s - tile * TILE_SAMPLES)) * 4, n * 4);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let i = 0; i < n; i++) out[done + i] = view.getFloat32(i * 4, true) * 1000; // km -> m
      done += n;
    }
    return out;
  },
};

/** A LOLA polar gridded product: int16 half-metres, polar stereographic, the pole at the centre. */
function polarProduct(pole: 'N' | 'S', file: string, metresPerPx: number, size: number): Product {
  const c = size / 2 - 0.5;
  return {
    label: `LOLA ${file.toUpperCase()}`,
    nativeSpacingM: metresPerPx,
    toPixel(lat, lon) {
      // The far hemisphere projects to infinity; anything past the equator is certainly outside.
      if (pole === 'S' ? lat > 0 : lat < 0) return { line: NaN, sample: NaN };
      const { x, y } = polarXY(pole, lat, lon);
      return { line: c - y / metresPerPx, sample: c + x / metresPerPx };
    },
    inside(line, sample, margin) {
      return line >= margin && sample >= margin && line <= size - 1 - margin && sample <= size - 1 - margin;
    },
    async readLine(read, line, s0, count) {
      if (line < 0 || line >= size || s0 < 0 || s0 + count > size) throw new Error(`${file} has no samples ${s0}..${s0 + count - 1} on line ${line}`);
      const bytes = await read(`${PDS_LOLA}/lola_gdr/polar/img/${file}.img`, (line * size + s0) * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) * 0.5;
      return out;
    },
  };
}

const POLAR = {
  S: { fine: polarProduct('S', 'ldem_80s_20m', 20, 30400), wide: polarProduct('S', 'ldem_60s_60m', 60, 31040), seam: polarProduct('S', 'ldem_45s_100m', 100, 28800) },
  N: { fine: polarProduct('N', 'ldem_80n_20m', 20, 30400), wide: polarProduct('N', 'ldem_60n_60m', 60, 31040), seam: polarProduct('N', 'ldem_45n_100m', 100, 28800) },
};

/**
 * Which products to try, best first, for a window centred at this latitude (same
 * thresholds as the bundled windows). Each grid sample takes the first product that can
 * serve it. Around 60 degrees SLDEM2015 and the 60 m polar grid meet edge to edge with no
 * overlap to interpolate in, so the 100 m polar grid (which spans both) fills that seam.
 */
function preference(lat: number): Product[] {
  const cap = POLAR[lat < 0 ? 'S' : 'N'];
  const a = Math.abs(lat);
  if (a >= 80.6) return [cap.fine, cap.wide];
  if (a > 60) return [cap.wide, sldem, cap.seam];
  return [sldem, cap.wide, cap.seam];
}

export interface SiteWindow {
  lat: number;
  lon: number;
  size: number;
  levels: {
    name: string;
    spacingM: number;
    /** size x size heights in metres above the 1737.4 km sphere; row j is (j - c) * spacing north of the site. NaN where no product has data. */
    data: Float32Array;
    /** Products used for this grid, the main one first. */
    products: string[];
    /** Source lines and samples skipped between reads (1 = every one). */
    step: number;
  }[];
  /** Number of range requests made. */
  requests: number;
}

async function buildLevel(read: RangeReader, lat0: number, lon0: number, spacingM: number, products: Product[], count: { requests: number }): Promise<SiteWindow['levels'][number]> {
  const n = WINDOW_SIZE;
  const half = (n - 1) / 2;
  const out = new Float32Array(n * n).fill(NaN);
  const todo = new Uint8Array(n * n).fill(1);
  const used: string[] = [];
  let mainStep = 1;
  // Grid points on the sphere, once.
  const lats = new Float64Array(n * n);
  const lons = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = offsetPoint(lat0, lon0, (i - half) * spacingM, (j - half) * spacingM);
      lats[j * n + i] = p.lat;
      lons[j * n + i] = p.lon;
    }
  }
  for (const product of products) {
    // Read every `step`-th source line and sample: enough for this grid's spacing.
    const step = Math.max(1, Math.round(spacingM / product.nativeSpacingM / 1.05));
    const cells: number[] = [];
    const px: { line: number; sample: number }[] = [];
    let minL = Infinity, maxL = -Infinity, minS = Infinity, maxS = -Infinity;
    for (let k = 0; k < n * n; k++) {
      if (!todo[k]) continue;
      const q = product.toPixel(lats[k], lons[k], lon0);
      // The lattice of rows read starts up to 2 steps before a cell and ends up to 2 steps after it.
      if (!product.inside(q.line, q.sample, 2 * step + 1)) continue;
      cells.push(k);
      px.push(q);
      minL = Math.min(minL, q.line); maxL = Math.max(maxL, q.line);
      minS = Math.min(minS, q.sample); maxS = Math.max(maxS, q.sample);
    }
    if (cells.length === 0) continue;
    const l0 = Math.floor(minL) - step;
    const s0 = Math.floor(minS) - step;
    const nl = Math.ceil((maxL - l0) / step) + 2;
    const ns = Math.ceil((maxS - s0) / step) + 2;
    const rows = await Promise.all(
      Array.from({ length: nl }, (_, k) => {
        count.requests++;
        return product.readLine(read, l0 + k * step, s0, (ns - 1) * step + 1);
      }),
    );
    for (let c = 0; c < cells.length; c++) {
      const fl = (px[c].line - l0) / step;
      const fs = (px[c].sample - s0) / step;
      const k = Math.floor(fl);
      const m = Math.floor(fs);
      const a = fl - k;
      const b = fs - m;
      out[cells[c]] = (1 - a) * ((1 - b) * rows[k][m * step] + b * rows[k][(m + 1) * step]) + a * ((1 - b) * rows[k + 1][m * step] + b * rows[k + 1][(m + 1) * step]);
      todo[cells[c]] = 0;
    }
    if (used.length === 0) mainStep = step;
    used.push(product.label);
  }
  return { name: WINDOW_LEVELS.find((l) => l.spacingM === spacingM)?.name ?? `${spacingM} m`, spacingM, data: out, products: used, step: mainStep };
}

/** Builds both grids of a site window. Rejects if the archive cannot be read. */
export async function buildSiteWindow(read: RangeReader, lat: number, lon: number): Promise<SiteWindow> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) throw new Error(`buildSiteWindow: bad coordinates ${lat}, ${lon}`);
  const products = preference(lat);
  const count = { requests: 0 };
  const levels = [];
  for (const level of WINDOW_LEVELS) levels.push(await buildLevel(read, lat, lon, level.spacingM, products, count));
  return { lat, lon, size: WINDOW_SIZE, levels, requests: count.requests };
}

// ---------------------------------------------------------------- packaging

const SLDEM_CITATION = 'Barker, M. K., et al. (2016). A new lunar digital elevation model from the Lunar Orbiter Laser Altimeter and SELENE Terrain Camera. Icarus, 273, 346-355.';
const LOLA_CITATION = 'Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit. Icarus, 283, 70-91.';

function provenanceFor(products: string[]): { product: string; url: string; processing: string; citation: string } {
  const usesSldem = products.some((p) => /SLDEM/.test(p));
  const usesLola = products.some((p) => /LOLA/.test(p));
  return {
    product: `${products.join(' + ')} (NASA PDS Geosciences Node)`,
    url: usesSldem ? `${PDS_LOLA}/sldem2015/` : `${PDS_LOLA}/lola_gdr/polar/`,
    processing: 'Read by range request and resampled bilinearly onto a square east/north grid centred on the requested point; coarser grids skip source samples (no averaging).',
    citation: [usesSldem ? SLDEM_CITATION : '', usesLola ? LOLA_CITATION : ''].filter(Boolean).join(' '),
  };
}

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;

/**
 * The window as an LXG file (see ./lxg): two 'local' grids plus, in the header, what they
 * are made of and plain-language notes. This is what GET /api/terrain answers with.
 */
export function packSiteWindow(w: SiteWindow): Uint8Array {
  const notes: string[] = [];
  const all = [...new Set(w.levels.flatMap((l) => l.products))];
  const outer = w.levels[w.levels.length - 1];
  notes.push(
    `Site window built on request from ${all.join(' and ') || 'no product'} (NASA PDS): ` +
      w.levels.map((l) => `${l.spacingM} m samples to ${(((w.size - 1) / 2) * l.spacingM) / 1000} km`).join(', ') +
      ` around the point.` +
      (outer.step > 1 ? ` The ${outer.spacingM} m grid reads every ${ordinal(outer.step)} source sample; it is not an average.` : ''),
  );
  if (w.levels.some((l) => l.products.length > 1)) notes.push('This window crosses the edge of an archive product and is stitched from more than one; steps of a few metres can occur along the join.');
  let holes = 0;
  for (const l of w.levels) for (let i = 0; i < l.data.length; i++) if (Number.isNaN(l.data[i])) holes++;
  if (holes) notes.push(`${holes} grid samples have no data in the archive products and are left empty.`);
  const header: LxgHeader = {
    format: 'lunyx-grid/1',
    kind: 'site-window',
    lat: w.lat,
    lon: w.lon,
    datum: 'metres above the 1737.4 km sphere',
    notes,
    grids: w.levels.map((l) => ({
      dtype: 'float32' as const,
      encoding: 'raw' as const,
      width: w.size,
      height: w.size,
      kind: 'local',
      name: `${l.products.join(' + ') || 'no data'}, ${l.spacingM} m site window (built on request)`,
      resolutionM: l.spacingM,
      lat0: w.lat,
      lon0: w.lon,
      spacingM: l.spacingM,
      products: l.products,
      provenance: provenanceFor(l.products),
    })),
  };
  return encodeLxg(
    header,
    w.levels.map((l) => l.data),
  );
}
