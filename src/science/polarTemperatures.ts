// Annual maximum and annual mean surface temperature at the lunar poles, from LRO Diviner.
// Data: Schorghofer & Williams, Harvard Dataverse, https://doi.org/10.7910/DVN/EGOOCL
// (CC0 1.0), packaged by scripts/build-diviner.mjs into public/data/science/diviner/.
//
// WHAT THESE NUMBERS ARE. Two values per 240 m cell, poleward of 80 degrees: the highest
// and the mean surface (bolometric) temperature over the year, worked out by the authors
// from Diviner measurements binned by local time and season. They are ANNUAL values:
// separate summer and winter maps are not published as maps and are not included. They
// are not the temperature at the simulated date. Cells the authors left without a value
// are empty here too; nothing is interpolated. Text shown with a value must say "annual
// maximum" / "annual mean": the index and the point reading carry wording that does.
//
// Layout of a map: square, polar stereographic (sphere of 1737.4 km, true scale at the
// pole), the pole at the centre, row 0 at the top: for the south, longitude 0 points up
// and 90E to the right; for the north, longitude 0 points down. Same convention as the
// maps of ./polarAverages, whose polarAverageUv() gives texture coordinates here as well.
//
// No DOM and no three.js: runs in the browser, in a worker and under vitest.
import { R_MOON_M } from '../terrain/geo';
import { decodeLxg } from '../terrain/lxg';
import { readTerrainFile, readTerrainJson } from '../terrain/reader';
import { polarAverageUv, type Pole } from './polarAverages';

export type PolarTemperatureQuantity = 'annual-max' | 'annual-mean';

/** A cell whose value was read from the source file when the map was packaged. */
export interface PolarTemperatureCheck {
  name?: string;
  lat: number;
  lon: number;
  row: number;
  col: number;
  /** Kelvin in the source file (null where the source has no value) and as stored (rounded to 1 K). */
  sourceK: number | null;
  storedK: number | null;
}

export interface PolarTemperatureLayerInfo {
  id: string;
  file: string;
  quantity: PolarTemperatureQuantity;
  pole: Pole;
  size: number;
  metresPerPx: number;
  halfWidthM: number;
  /** The map covers the pole down to this latitude (a circle; the corners of the square are empty). */
  latCompleteTo: number;
  unit: 'K';
  valueStepK: number;
  noData: number;
  /** Span of the Diviner measurements behind the map. */
  period: string;
  source: { dataset: string; version: string; licence: string; file: string; url: string; md5: string; description: string; binning: string; internalTitle: string; dataOffset: number };
  processing: string;
  stats: { minK: number; maxK: number; meanK: number; cellsInside80: number; emptyInside80: number; emptyInside80Fraction: number; filledOutside80: number };
  coldest: PolarTemperatureCheck;
  warmest: PolarTemperatureCheck;
  checks: PolarTemperatureCheck[];
  bytes: number;
  sha256: string;
}

export interface PolarTemperatureIndex {
  format: 'lunyx-polar-temperatures/1';
  title: string;
  what: string;
  /** States that separate summer and winter maps are not included. Show it with the layer. */
  notIncluded: string;
  projection: string;
  values: string;
  quantities: Record<PolarTemperatureQuantity, { label: string; unit: string; sourceDescription: string; meaning: string }>;
  caveats: string[];
  citation: string;
  licence: string;
  source: string;
  totalBytes: number;
  layers: PolarTemperatureLayerInfo[];
}

const DEG = Math.PI / 180;

/** One packaged map, decoded. */
export class PolarTemperatureMap {
  readonly info: PolarTemperatureLayerInfo;
  readonly pole: Pole;
  readonly size: number;
  readonly metresPerPx: number;
  /** Row-major, row 0 first: kelvin, or `info.noData` where there is no value. */
  readonly data: Int16Array;

  constructor(info: PolarTemperatureLayerInfo, data: Int16Array) {
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

  latLonOf(x: number, y: number): { lat: number; lon: number } {
    const c = this.size / 2 - 0.5;
    const east = (x - c) * this.metresPerPx;
    const up = (c - y) * this.metresPerPx;
    const colat = (2 * Math.atan(Math.hypot(east, up) / (2 * R_MOON_M))) / DEG;
    return this.pole === 'S' ? { lat: colat - 90, lon: Math.atan2(east, up) / DEG } : { lat: 90 - colat, lon: Math.atan2(east, -up) / DEG };
  }

  /** True when the point falls on the map's square (it may still be an empty cell). */
  covers(lat: number, lon: number): boolean {
    const p = this.pixelOf(lat, lon);
    return !!p && Math.round(p.x) >= 0 && Math.round(p.y) >= 0 && Math.round(p.x) < this.size && Math.round(p.y) < this.size;
  }

  /** Kelvin in the cell that contains the point; NaN outside the map and in cells without a value. */
  kelvinAt(lat: number, lon: number): number {
    const p = this.pixelOf(lat, lon);
    if (!p) return NaN;
    const col = Math.round(p.x);
    const row = Math.round(p.y);
    if (col < 0 || row < 0 || col >= this.size || row >= this.size) return NaN;
    const v = this.data[row * this.size + col];
    return v === this.info.noData ? NaN : v;
  }

  /**
   * The map as an 8-bit texture for drawing: 0 = no value, 1..255 = minK..maxK (linear,
   * clamped). State the range in the legend. Texture coordinates: polarAverageUv() of
   * ./polarAverages with this map's `info.halfWidthM`; upload with flipY off.
   */
  texture(minK: number, maxK: number): Uint8Array {
    if (!(maxK > minK)) throw new Error('texture: maxK must be above minK');
    const out = new Uint8Array(this.data.length);
    const k = 254 / (maxK - minK);
    const empty = this.info.noData;
    for (let i = 0; i < out.length; i++) {
      const v = this.data[i];
      out[i] = v === empty ? 0 : 1 + Math.round(Math.min(254, Math.max(0, (v - minK) * k)));
    }
    return out;
  }
}

// ---------------------------------------------------------------- loading

let indexPromise: Promise<PolarTemperatureIndex> | null = null;
const maps = new Map<string, Promise<PolarTemperatureMap>>();

/** Forgets what was loaded (tests that swap the file reader). */
export function clearPolarTemperatureCache(): void {
  indexPromise = null;
  maps.clear();
}

/** What is packaged: meaning, what is not included, projection, citation, licence, and every layer. */
export function loadPolarTemperatureIndex(): Promise<PolarTemperatureIndex> {
  if (!indexPromise) {
    indexPromise = readTerrainJson<PolarTemperatureIndex>('data/science/diviner/index.json');
    indexPromise.catch(() => (indexPromise = null));
  }
  return indexPromise;
}

export async function loadPolarTemperature(quantity: PolarTemperatureQuantity, pole: Pole): Promise<PolarTemperatureMap> {
  const index = await loadPolarTemperatureIndex();
  const info = index.layers.find((l) => l.quantity === quantity && l.pole === pole);
  if (!info) throw new Error(`no ${quantity} temperature map is packaged for the ${pole === 'S' ? 'south' : 'north'} pole`);
  let p = maps.get(info.id);
  if (!p) {
    p = (async () => {
      const { arrays } = await decodeLxg(await readTerrainFile(`data/science/diviner/${info.file}`));
      const data = arrays[0];
      if (!(data instanceof Int16Array)) throw new Error(`${info.file}: expected a 16-bit grid`);
      return new PolarTemperatureMap(info, data);
    })();
    p.catch(() => maps.delete(info.id));
    maps.set(info.id, p);
  }
  return p;
}

// ---------------------------------------------------------------- point values

export interface PolarTemperatureReading {
  lat: number;
  lon: number;
  /** 'ok': at least one value. 'empty': on the map, but the published cell has no value. 'outside': not poleward of 80 degrees. */
  status: 'ok' | 'empty' | 'outside';
  /** Annual maximum and annual mean, kelvin; null where there is none. */
  annualMaxK: number | null;
  annualMeanK: number | null;
  /** Side of the cell, metres; null outside. */
  cellM: number | null;
  /** Span of the measurements; null outside. */
  period: string | null;
  /** One or two sentences that can be shown or quoted as they are. */
  text: string;
}

/** The published annual maximum and annual mean temperature of the 240 m cell that contains a point. */
export async function polarTemperatureAt(lat: number, lon: number): Promise<PolarTemperatureReading> {
  const index = await loadPolarTemperatureIndex();
  const pole: Pole = lat < 0 ? 'S' : 'N';
  const any = index.layers.find((l) => l.pole === pole);
  const limit = any ? Math.abs(any.latCompleteTo) : 80;
  // The maps are a circle: poleward of the limit (80 degrees), nothing beyond.
  if (!any || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) < limit) {
    return {
      lat, lon, status: 'outside', annualMaxK: null, annualMeanK: null, cellM: null, period: null,
      text: `No Diviner temperature map for this point: the annual maximum and annual mean maps cover only latitudes poleward of ${limit}° (Schorghofer & Williams, Harvard Dataverse).`,
    };
  }
  const [maxMap, meanMap] = await Promise.all([loadPolarTemperature('annual-max', pole), loadPolarTemperature('annual-mean', pole)]);
  const tmax = maxMap.kelvinAt(lat, lon);
  const tmean = meanMap.kelvinAt(lat, lon);
  const cellM = Math.round(maxMap.metresPerPx);
  const basis = `LRO Diviner, ${cellM} m cell, measurements from ${maxMap.info.period}; Schorghofer & Williams, Harvard Dataverse, CC0`;
  if (Number.isNaN(tmax) && Number.isNaN(tmean)) {
    return {
      lat, lon, status: 'empty', annualMaxK: null, annualMeanK: null, cellM, period: maxMap.info.period,
      text: `The published Diviner maps of annual maximum and annual mean temperature have no value for this ${cellM} m cell; nothing is filled in (${basis}).`,
    };
  }
  const parts = [Number.isNaN(tmax) ? null : `annual maximum temperature ${tmax} K`, Number.isNaN(tmean) ? null : `annual mean ${tmean} K`].filter((s): s is string => s !== null);
  const sentence = parts.join(', ');
  return {
    lat, lon, status: 'ok', annualMaxK: Number.isNaN(tmax) ? null : tmax, annualMeanK: Number.isNaN(tmean) ? null : tmean, cellM, period: maxMap.info.period,
    text: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} here (${basis}). Annual values, not the temperature on the date shown; separate summer and winter maps are not included.`,
  };
}
