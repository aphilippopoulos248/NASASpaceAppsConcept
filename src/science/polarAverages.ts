// Long-term average sunlight and Earth visibility at the lunar poles: NASA PGDA product 69
// ("Lunar Polar Illumination", Mazarico et al. 2011), packaged by scripts/build-heatmap.mjs
// into public/data/heatmap/. For the globe overlay (a texture) and for reading the value
// at a point.
//
// WHAT THESE NUMBERS ARE. A value is the share of time, over hourly steps spanning 18.6
// years, in which ANY part of the Sun's (or Earth's) disc is above the terrain horizon
// there. It is a multi-year average of a model computed from LOLA elevation maps. It is
// NOT the Sun's or Earth's position at the simulated date, not an energy fraction, and
// (for Earth) not a radio link budget. Text shown with it must say "multi-year average":
// PolarAverageIndex and PolarAverageReading carry wording that does.
//
// Layout of a map: square, polar stereographic (sphere of 1737.4 km, true scale at the
// pole), the pole at the centre. Row 0 is the top row of the published image:
//   south: longitude 0 points up (towards row 0), 90E to the right
//   north: longitude 0 points down, 90E to the right
// One byte per cell: 0 = never lit in the model (every source pixel of the cell is in
// permanent shadow), 1..100 = percent of time, the mean over the cell.
//
// No DOM and no three.js: runs in the browser, in a worker and under vitest.
import { R_MOON_M } from '../terrain/geo';
import { decodeLxg } from '../terrain/lxg';
import { readTerrainFile, readTerrainJson } from '../terrain/reader';

export type PolarAverageQuantity = 'illumination' | 'earth-visibility';
export type Pole = 'N' | 'S';
/** 'wide': 960 m cells out to 65 degrees. 'detail': 120 m cells out to 85 degrees. */
export type PolarAverageRole = 'wide' | 'detail';

/** A place whose value was read from the source file when the map was packaged. */
export interface PolarAverageCheck {
  name?: string;
  lat: number;
  lon: number;
  /** Pixel of the source map that contains the point, and its value (0..1). */
  sourceLine: number;
  sourceSample: number;
  sourceFraction: number;
  /** Cell of the packaged map, the exact mean of its source pixels (0..1), and the stored percent. */
  line: number;
  sample: number;
  cellMeanFraction: number;
  storedPercent: number;
}

export interface PolarAverageLayerInfo {
  id: string;
  file: string;
  quantity: PolarAverageQuantity;
  pole: Pole;
  role: PolarAverageRole;
  /** Cells per side. */
  size: number;
  metresPerPx: number;
  /** Half the width of the square footprint, metres in the projection plane. */
  halfWidthM: number;
  /** The map is complete from the pole to this latitude; its corners reach latCornersTo. */
  latCompleteTo: number;
  latCornersTo: number;
  /** Value of one stored step as a fraction (0.01 = one percent). */
  valueStep: number;
  source: { product: string; url: string; label: string; resolutionM: number; sizePx: number; basedOn: string };
  processing: string;
  stats: { neverLitFraction: number; meanFraction: number; maxPercent: number };
  /** The brightest pixel of the source map and what the packaged cell around it holds. */
  brightest: PolarAverageCheck;
  checks: PolarAverageCheck[];
  bytes: number;
  sha256: string;
}

export interface PolarAverageIndex {
  format: 'lunyx-polar-averages/1';
  title: string;
  what: string;
  averagingPeriod: string;
  projection: string;
  values: string;
  quantities: Record<PolarAverageQuantity, { label: string; shortLabel: string; unit: string; meaning: string }>;
  caveats: string[];
  citation: string;
  productPage: string;
  sourceDirectory: string;
  usage: string;
  totalBytes: number;
  layers: PolarAverageLayerInfo[];
}

const DEG = Math.PI / 180;

/**
 * Position of a point in a polar map, in texture coordinates: u to the right, v down the
 * rows (v = 0 is the top edge of row 0), both 0..1 inside the map. The same arithmetic
 * works in a shader:
 *
 *   r = 2 R tan(colatitude / 2) / (2 halfWidth)      colatitude measured from this pole
 *   u = 0.5 + r sin(lon)
 *   v = 0.5 - r cos(lon)   for the south,   0.5 + r cos(lon)   for the north
 *
 * Upload `data` as a one-channel texture with flipY off, so that v = 0 is row 0.
 * Returns null on the other hemisphere, where the projection has no meaning.
 */
export function polarAverageUv(pole: Pole, lat: number, lon: number, halfWidthM: number): { u: number; v: number } | null {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  if (!(colat >= 0 && colat < 90)) return null;
  const r = (2 * R_MOON_M * Math.tan((colat / 2) * DEG)) / (2 * halfWidthM);
  const λ = lon * DEG;
  return { u: 0.5 + r * Math.sin(λ), v: pole === 'S' ? 0.5 - r * Math.cos(λ) : 0.5 + r * Math.cos(λ) };
}

/** One packaged map, decoded. */
export class PolarAverageMap {
  readonly info: PolarAverageLayerInfo;
  readonly pole: Pole;
  readonly size: number;
  readonly metresPerPx: number;
  /** Row-major, row 0 first, one byte per cell: 0 = never lit, 1..100 = percent of time. Usable as an 8-bit texture as it is. */
  readonly data: Uint8Array;

  constructor(info: PolarAverageLayerInfo, data: Uint8Array) {
    if (data.length !== info.size * info.size) throw new Error(`${info.file}: expected ${info.size}x${info.size} cells, got ${data.length}`);
    this.info = info;
    this.pole = info.pole;
    this.size = info.size;
    this.metresPerPx = info.metresPerPx;
    this.data = data;
  }

  /** Fractional column (x) and row (y) of a point; cell centres are at whole numbers. Null on the other hemisphere. */
  pixelOf(lat: number, lon: number): { x: number; y: number } | null {
    const uv = polarAverageUv(this.pole, lat, lon, this.info.halfWidthM);
    return uv ? { x: uv.u * this.size - 0.5, y: uv.v * this.size - 0.5 } : null;
  }

  /** Latitude and longitude of a (fractional) column and row. */
  latLonOf(x: number, y: number): { lat: number; lon: number } {
    const c = this.size / 2 - 0.5;
    const east = (x - c) * this.metresPerPx;
    const up = (c - y) * this.metresPerPx;
    const colat = (2 * Math.atan(Math.hypot(east, up) / (2 * R_MOON_M))) / DEG;
    return this.pole === 'S' ? { lat: colat - 90, lon: Math.atan2(east, up) / DEG } : { lat: 90 - colat, lon: Math.atan2(east, -up) / DEG };
  }

  /** Index of the cell that contains a point, or -1 outside the map. */
  private cellIndex(lat: number, lon: number): number {
    const p = this.pixelOf(lat, lon);
    if (!p) return -1;
    const col = Math.round(p.x);
    const row = Math.round(p.y);
    return col >= 0 && row >= 0 && col < this.size && row < this.size ? row * this.size + col : -1;
  }

  covers(lat: number, lon: number): boolean {
    return this.cellIndex(lat, lon) >= 0;
  }

  /** Percent of time (0..100) in the cell that contains the point; NaN outside the map. 0 means never lit in the model. */
  percentAt(lat: number, lon: number): number {
    const i = this.cellIndex(lat, lon);
    return i < 0 ? NaN : this.data[i];
  }

  /** The same as a fraction, 0..1. */
  valueAt(lat: number, lon: number): number {
    return this.percentAt(lat, lon) * this.info.valueStep;
  }
}

// ---------------------------------------------------------------- loading

let indexPromise: Promise<PolarAverageIndex> | null = null;
const maps = new Map<string, Promise<PolarAverageMap>>();

/** Forgets what was loaded (tests that swap the file reader). */
export function clearPolarAverageCache(): void {
  indexPromise = null;
  maps.clear();
}

/** What is packaged: meaning, averaging period, projection, citation, caveats, and every layer. */
export function loadPolarAverageIndex(): Promise<PolarAverageIndex> {
  if (!indexPromise) {
    indexPromise = readTerrainJson<PolarAverageIndex>('data/heatmap/index.json');
    indexPromise.catch(() => (indexPromise = null));
  }
  return indexPromise;
}

/** One map. 'wide' (960 m cells, to 65 degrees) is the overlay for the whole cap; 'detail' (120 m cells, to 85 degrees) for close-ups and point values. */
export async function loadPolarAverage(quantity: PolarAverageQuantity, pole: Pole, role: PolarAverageRole = 'wide'): Promise<PolarAverageMap> {
  const index = await loadPolarAverageIndex();
  const info = index.layers.find((l) => l.quantity === quantity && l.pole === pole && l.role === role);
  if (!info) throw new Error(`no ${role} ${quantity} map is packaged for the ${pole === 'S' ? 'south' : 'north'} pole`);
  let p = maps.get(info.id);
  if (!p) {
    p = (async () => {
      const { arrays } = await decodeLxg(await readTerrainFile(`data/heatmap/${info.file}`));
      const data = arrays[0];
      if (!(data instanceof Uint8Array)) throw new Error(`${info.file}: expected an 8-bit grid`);
      return new PolarAverageMap(info, data);
    })();
    p.catch(() => maps.delete(info.id));
    maps.set(info.id, p);
  }
  return p;
}

// ---------------------------------------------------------------- point values

export interface PolarAverageReading {
  quantity: PolarAverageQuantity;
  lat: number;
  lon: number;
  /** False where no packaged map covers the point; `text` then says why. */
  available: boolean;
  /** Percent of time, 0..100 (mean of the cell); null when not available. */
  percent: number | null;
  /** True when the cell is never lit in the model (permanent shadow, or Earth never in view). */
  neverLit: boolean;
  /** Side of the cell the value is the mean of, metres; null when not available. */
  cellM: number | null;
  /** Layer the value came from. */
  layerId: string | null;
  sourceProduct: string | null;
  /** One sentence that can be shown or quoted as it is: value, what it means, and that it is a multi-year average. */
  text: string;
}

/**
 * The published multi-year average at a point: from the 120 m map within its reach of the
 * pole, otherwise from the 960 m map. Away from the poles there is no such map and the
 * reading says so.
 */
export async function polarAverageAt(quantity: PolarAverageQuantity, lat: number, lon: number): Promise<PolarAverageReading> {
  const index = await loadPolarAverageIndex();
  const pole: Pole = lat < 0 ? 'S' : 'N';
  const whose = quantity === 'illumination' ? "the Sun's" : "Earth's";
  const base = { quantity, lat, lon };
  for (const role of ['detail', 'wide'] as const) {
    const info = index.layers.find((l) => l.quantity === quantity && l.pole === pole && l.role === role);
    if (!info) continue;
    // Decide from the footprint first, so a map is only downloaded when it will be used.
    const uv = polarAverageUv(pole, lat, lon, info.halfWidthM);
    if (!uv || uv.u < 0 || uv.v < 0 || uv.u >= 1 || uv.v >= 1) continue;
    const map = await loadPolarAverage(quantity, pole, role);
    const percent = map.percentAt(lat, lon);
    if (Number.isNaN(percent)) continue;
    const cell = `mean of a ${info.metresPerPx} m cell`;
    const basis = `multi-year average over 18.6 years, ${cell}, NASA PGDA product 69`;
    const text =
      percent === 0
        ? quantity === 'illumination'
          ? `Never sunlit in the long-term model here: permanent shadow (${basis}).`
          : `Earth is never above the terrain horizon here in the long-term model (${basis}).`
        : `Any part of ${whose} disc is above the terrain horizon ${percent === 1 ? 'about 1 % of the time or less' : `${percent} % of the time`} here (${basis}; not ${whose} position on the date shown).`;
    return { ...base, available: true, percent, neverLit: percent === 0, cellM: info.metresPerPx, layerId: info.id, sourceProduct: info.source.product, text };
  }
  const widest = index.layers.find((l) => l.quantity === quantity && l.pole === pole && l.role === 'wide');
  const limit = widest ? `${Math.abs(widest.latCompleteTo)}°${pole}` : 'the polar regions';
  return {
    ...base,
    available: false,
    percent: null,
    neverLit: false,
    cellM: null,
    layerId: null,
    sourceProduct: null,
    text: `No long-term average is published for this point: NASA PGDA product 69 maps only the polar regions (complete poleward of ${limit}).`,
  };
}
