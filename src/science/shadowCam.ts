// ShadowCam controlled mosaics of permanently shadowed regions: which of them cover a
// point, and where to get them. An INDEX ONLY: no ShadowCam imagery ships with the app.
// Each entry links to the product in the ShadowCam PDS archive
// (https://pds.shadowcam.im-ldi.com/, doi:10.17189/y89z-kt98).
//
// Why links and not pictures: the archive carries no licence or usage statement (see
// `index.licence`), so the app shows where an image exists, credits it, and links out.
//
// Data: public/data/science/shadowcam/, built by scripts/build-shadowcam-index.mjs from
// the archive's outline tables and product readmes.
//   - `outline` of a mosaic is the authors' loose bounding polygon: for drawing.
//   - "covered" is decided on a 200 m grid sampled from the published footprint, which
//     follows the valid pixels (strips, gaps and all). Within 200 m of an edge it can be
//     off either way.
//
// No DOM and no three.js: runs in the browser, in a worker and under vitest.
import { polarLatLon, polarXY } from '../terrain/geo';
import { decodeLxg } from '../terrain/lxg';
import { readTerrainFile, readTerrainJson } from '../terrain/reader';
import type { Pole } from './polarAverages';

export interface ShadowCamMosaic {
  /** Site id in the archive, e.g. "shackleton01". */
  id: string;
  /** PDS product id, e.g. "shadowcam_cmosaic_shackleton01_p896s1350_summer_11am". */
  productId: string;
  /** PDS logical identifier. */
  lid: string;
  /** The archive's own description, e.g. "Shackleton Crater Monthly Mosaic February 2023". */
  title: string;
  site: string | null;
  pole: Pole;
  version: number;
  center: { lat: number; lon: number };
  /** Local season when the images were taken (see index.seasonDefinition): summer, winter, spring or fall. */
  season: string;
  /** Local time at the mosaic centre, rounded to the hour as in the product id, e.g. "11am". */
  localTime: string;
  /** The same as the outline table gives it (HH:MM), verbatim. */
  avgTimeOfDay: string;
  avgSubsolar: { lat: number; lon: number };
  /** First and last day of the images in the mosaic (UTC dates), from the product readme. */
  imageStart: string | null;
  imageStop: string | null;
  images: number;
  /** Metres per pixel of the full-resolution mosaic. */
  pixelScaleM: number;
  /** Present where the archive's outline table and the product readme give different facts. */
  sourceDisagreements?: string[];
  /** Permanently shadowed regions in the mosaic, with their page in the LROC PSR atlas. */
  psr: { id: string; url: string }[];
  referenceDtm: string | null;
  /** The latitude/longitude box the authors trimmed the mosaic to (longitude 0..360 east). */
  trim: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  /** Area as the outline table states it, as its polygon measures, and as sampled at 200 m. */
  statedCoverageKm2: number;
  footprintKm2: number;
  sampledCoverageKm2: number;
  /** Folder of the product in the ShadowCam PDS archive: the link to show. */
  productUrl: string;
  readmeUrl: string;
  /** The 20 m per pixel version of the mosaic in the archive (a GeoTIFF to download, not a web image). */
  preview20m: { url: string; bytes: number; format: string } | null;
  /** The authors' bounding polygon, polar stereographic metres: x0, y0, x1, y1, ... (closed). */
  outline: number[];
  /** Where this mosaic's 200 m coverage grid sits: grid number in the coverage file, top-left corner, size. */
  coverage: { grid: number; left: number; top: number; cols: number; rows: number };
}

export interface ShadowCamIndex {
  format: 'lunyx-shadowcam-index/1';
  title: string;
  what: string;
  archive: { name: string; doi: string; url: string; author: string; portal: string };
  /** Which releases the outline tables cover, in the archive's words. */
  release: string | null;
  /** Credit line to print with any link or image. */
  credit: string;
  creditNote: string;
  /** States that the archive carries no licence statement. */
  licence: string;
  citation: string[];
  seasonDefinition: string;
  projection: string;
  coverage: { file: string; bytes: number; sha256: string; cellM: number; rule: string };
  mosaics: ShadowCamMosaic[];
}

/** The index with its coverage grids, ready to answer "what covers this point". */
export class ShadowCamLayer {
  readonly index: ShadowCamIndex;
  private readonly grids: Uint8Array[];

  constructor(index: ShadowCamIndex, grids: Uint8Array[]) {
    for (const m of index.mosaics) {
      const g = grids[m.coverage.grid];
      if (!g || g.length !== m.coverage.cols * m.coverage.rows) throw new Error(`ShadowCam coverage grid of ${m.id} does not match the index`);
    }
    this.index = index;
    this.grids = grids;
  }

  /** True when the 200 m cell around the point belongs to the mosaic's published footprint. */
  covers(mosaic: ShadowCamMosaic, lat: number, lon: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (mosaic.pole === 'S') !== lat < 0) return false;
    const { x, y } = polarXY(mosaic.pole, lat, lon);
    const c = mosaic.coverage;
    const cell = this.index.coverage.cellM;
    const col = Math.floor((x - c.left) / cell);
    const row = Math.floor((c.top - y) / cell);
    return col >= 0 && row >= 0 && col < c.cols && row < c.rows && this.grids[c.grid][row * c.cols + col] === 1;
  }

  /** Mosaics whose footprint contains the point, most recent images first. */
  mosaicsAt(lat: number, lon: number): ShadowCamMosaic[] {
    return this.index.mosaics.filter((m) => this.covers(m, lat, lon)).sort((a, b) => (b.imageStart ?? '').localeCompare(a.imageStart ?? ''));
  }

  /** The authors' bounding polygon as latitude/longitude, for drawing on the globe. */
  outlineLatLon(mosaic: ShadowCamMosaic): { lat: number; lon: number }[] {
    const out = [];
    for (let i = 0; i + 1 < mosaic.outline.length; i += 2) out.push(polarLatLon(mosaic.pole, mosaic.outline[i], mosaic.outline[i + 1]));
    return out;
  }

  /** Number of covered 200 m cells of a mosaic (for checks and statistics). */
  coveredCells(mosaic: ShadowCamMosaic): number {
    let n = 0;
    for (const v of this.grids[mosaic.coverage.grid]) n += v;
    return n;
  }
}

// ---------------------------------------------------------------- loading

let layerPromise: Promise<ShadowCamLayer> | null = null;

/** Forgets what was loaded (tests that swap the file reader). */
export function clearShadowCamCache(): void {
  layerPromise = null;
}

export function loadShadowCam(): Promise<ShadowCamLayer> {
  if (!layerPromise) {
    layerPromise = (async () => {
      const index = await readTerrainJson<ShadowCamIndex>('data/science/shadowcam/index.json');
      const { arrays } = await decodeLxg(await readTerrainFile(`data/science/shadowcam/${index.coverage.file}`));
      const grids = arrays.map((a) => {
        if (!(a instanceof Uint8Array)) throw new Error('ShadowCam coverage: expected 8-bit grids');
        return a;
      });
      return new ShadowCamLayer(index, grids);
    })();
    layerPromise.catch(() => (layerPromise = null));
  }
  return layerPromise;
}

// ---------------------------------------------------------------- point lookup

export interface ShadowCamHit {
  mosaic: ShadowCamMosaic;
  /** What to call the link. */
  label: string;
  /** The product's folder in the ShadowCam PDS archive. */
  url: string;
  /** One sentence about this mosaic: place, lighting, dates, resolution. */
  text: string;
}

export interface ShadowCamReading {
  lat: number;
  lon: number;
  hits: ShadowCamHit[];
  /** Credit line to print with the links. */
  credit: string;
  /** One or two sentences that can be shown or quoted as they are. */
  text: string;
}

const dates = (m: ShadowCamMosaic): string => (m.imageStart && m.imageStop ? (m.imageStart === m.imageStop ? `images of ${m.imageStart}` : `images of ${m.imageStart} to ${m.imageStop}`) : 'image dates not stated');
/** "11am" -> "11 am", "05pm" -> "5 pm". */
const clock = (t: string): string => t.replace(/^0?(\d+)(am|pm)$/, '$1 $2');

/** ShadowCam controlled mosaics that cover a point, each with a credited link to the archive. Images are not bundled. */
export async function shadowCamMosaicsAt(lat: number, lon: number): Promise<ShadowCamReading> {
  const layer = await loadShadowCam();
  const { index } = layer;
  const hits = layer.mosaicsAt(lat, lon).map((mosaic): ShadowCamHit => {
    const place = mosaic.site ?? mosaic.title;
    return {
      mosaic,
      label: `ShadowCam mosaic: ${place}, ${mosaic.season}, ${clock(mosaic.localTime)}`,
      url: mosaic.productUrl,
      text: `ShadowCam controlled mosaic of ${place}: local ${mosaic.season}, about ${clock(mosaic.localTime)} local time, ${dates(mosaic)}, ${mosaic.pixelScaleM} m per pixel.`,
    };
  });
  const sites = new Set(index.mosaics.map((m) => m.site ?? m.id)).size;
  const text =
    hits.length === 0
      ? `No ShadowCam controlled mosaic covers this point (the archive index lists ${index.mosaics.length} mosaics of ${sites} permanently shadowed sites).`
      : `${hits.length === 1 ? 'One ShadowCam controlled mosaic covers' : `${hits.length} ShadowCam controlled mosaics cover`} this point. The images are not included in the app: follow the link to the ShadowCam PDS archive. Credit: ${index.credit}.`;
  return { lat, lon, hits, credit: index.credit, text };
}
