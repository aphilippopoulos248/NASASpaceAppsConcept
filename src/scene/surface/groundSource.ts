// Where the surface scene's ground comes from: turns "a site" into the nested height grids
// that are drawn, and records honestly which elevation product stands behind each distance
// band and at what resolution.
//
// Preferred route: the shared terrain API (loadTerrainFor), which works for any coordinates.
// Fallback (catalogued landings only): the bundled site windows read directly, used when the
// terrain API has nothing to offer (not installed, or its files are missing).
import { loadTerrainFor } from '../../terrain/api';
import type { HeightSource, TerrainStack } from '../../terrain/types';
import { blendEdge, halfExtent, offsetLatLon, sampleGrid, upsample, type Grid } from './ground';

/** What the scene needs to know about a place. A SiteRef and a catalogued Landing both fit. */
export interface SiteLike {
  id: string;
  name?: string;
  lat: number;
  lon: number;
  kind?: 'landing' | 'custom' | 'candidate';
}

/** The fine grid walked on, and the coarser grids around it. */
export const FINE_LEVEL = { n: 513, spacing: 3 } as const; // 768 m each way
export const COARSE_LEVELS = [
  { n: 129, spacing: 60 }, // 3.84 km each way
  { n: 129, spacing: 480 }, // 30.72 km
  { n: 257, spacing: 1920 }, // 245.76 km: mountains on the far horizon, at the whole-Moon grid's own resolution
] as const;
/** A product this fine (metres per sample) counts as a survey of the ground underfoot. */
const SURVEY_MAX_RES_M = 10;

/** One distance band of the ground as drawn. */
export interface GroundBand {
  /** Distance range from the site, metres (measured along the east or north axis). */
  fromM: number;
  toM: number;
  /** Spacing of the grid drawn there, metres. */
  gridM: number;
  /** Elevation products behind it, the one used most first. Resolution is metres per sample. */
  sources: { name: string; resolutionM: number; share: number }[];
  /** True when the product is coarser than the grid drawn from it: the ground is smoothly interpolated and shows no finer relief. */
  interpolated: boolean;
}

export interface GroundData {
  /** Measured fine grid (3 m), or null where no survey exists. */
  fine: Grid | null;
  /** Coarser grids, finest first; at least one. */
  coarse: Grid[];
  bands: GroundBand[];
  /** Plain-language notes from the terrain service about gaps and limits. */
  notes: string[];
  /** Orthophoto draped over the fine grid, and relief worked out from its shading (surveyed landing sites only). */
  ortho: string | null;
  detail: { url: string; size: number; range: number } | null;
  via: 'terrain-service' | 'bundled-windows';
}

// ---------------------------------------------------------------- bundled index (photo assets + fallback grids)

interface BundledIndex {
  radius: number;
  size: number;
  levels: { name: string; spacing: number }[];
  sites: Record<
    string,
    {
      source: string;
      height: number;
      fine?: { size: number; spacing: number; ortho: string | null; source: string; detail?: { file: string; size: number; range: number; agreement: number } };
    }
  >;
}

const terrainUrl = (file: string) => `${import.meta.env.BASE_URL}terrain/${file}`;
let indexPromise: Promise<BundledIndex> | null = null;
function bundledIndex(): Promise<BundledIndex> {
  indexPromise ??= fetch(terrainUrl('index.json')).then((r) => {
    if (!r.ok) throw new Error(`terrain index: HTTP ${r.status}`);
    return r.json() as Promise<BundledIndex>;
  });
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

async function fetchBinary(file: string): Promise<ArrayBuffer> {
  const r = await fetch(terrainUrl(file));
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** "LROC NAC DTM NAC_DTM_APOLLO11_E008N0234.IMG (2.0 m), orthophoto ..." -> the model's name and its own resolution. */
function parseFineSource(text: string): { name: string; resolutionM: number } {
  const name = text.split(', orthophoto')[0];
  const res = Number(/\(([\d.]+) m\)/.exec(name)?.[1] ?? NaN);
  return { name, resolutionM: Number.isFinite(res) ? res : FINE_LEVEL.spacing };
}

// ---------------------------------------------------------------- sampling a terrain stack

const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface Sampled {
  grid: Grid;
  /** Index into stack.sources of the product used at each node; 255 where none had data. */
  use: Uint8Array;
}

/** A local window in the stack that is exactly this grid (same centre, size and spacing): its samples can be used as they are. */
function exactWindow(stack: TerrainStack, site: SiteLike, n: number, spacing: number): number {
  return stack.sources.findIndex((s) => {
    const d = s.descriptor;
    return d.kind === 'local' && d.n === n && d.spacingM === spacing && Math.abs(d.lat0 - site.lat) < 1e-6 && Math.abs(d.lon0 - site.lon) < 1e-6;
  });
}

/**
 * Samples the stack on a square grid around the site: at every node, the finest product
 * that has data there. Where that product is much finer than the grid, a few samples
 * across the cell are averaged so that narrow ridges are not hit or missed by chance.
 * `only` restricts the products considered (for the fine grid: surveys only).
 */
async function sampleLevel(stack: TerrainStack, site: SiteLike, n: number, spacing: number, only: (s: HeightSource) => boolean = () => true): Promise<Sampled> {
  const data = new Float32Array(n * n), use = new Uint8Array(n * n).fill(255);
  const exact = exactWindow(stack, site, n, spacing);
  if (exact >= 0 && only(stack.sources[exact])) {
    // Copy: the grids are edited (edge blending) and the stack's own arrays are shared with the analysis.
    data.set((stack.sources[exact].descriptor as { data: Float32Array }).data);
    use.fill(exact);
    let gaps = false;
    for (let k = 0; k < data.length && !gaps; k++) gaps = !Number.isFinite(data[k]);
    if (!gaps) return { grid: { n, spacing, data }, use };
  }
  const sources = stack.sources.map((s, k) => ({ s, k })).filter(({ s }) => only(s));
  const c = (n - 1) / 2;
  let sliceStart = performance.now();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = j * n + i;
      if (use[o] !== 255 && Number.isFinite(data[o])) continue; // kept from the exact window
      const east = (i - c) * spacing, north = (j - c) * spacing;
      const p = offsetLatLon(site.lat, site.lon, east, north);
      let value = NaN, used = 255;
      for (const { s, k } of sources) {
        if (!s.covers(p.lat, p.lon)) continue;
        const centre = s.sample(p.lat, p.lon);
        if (!Number.isFinite(centre)) continue;
        value = centre;
        used = k;
        const sub = Math.min(4, Math.round(spacing / s.resolutionM));
        if (sub >= 2) {
          // Average sub x sub points across the cell (points with no data are left out).
          let sum = 0, count = 0;
          for (let b = 0; b < sub; b++) {
            for (let a = 0; a < sub; a++) {
              const q = offsetLatLon(site.lat, site.lon, east + ((a + 0.5) / sub - 0.5) * spacing, north + ((b + 0.5) / sub - 0.5) * spacing);
              const v = s.covers(q.lat, q.lon) ? s.sample(q.lat, q.lon) : NaN;
              if (Number.isFinite(v)) {
                sum += v;
                count++;
              }
            }
          }
          if (count) value = sum / count;
        }
        break;
      }
      data[o] = value;
      use[o] = used;
    }
    // Stay responsive while a large grid is sampled.
    if (performance.now() - sliceStart > 14) {
      await pause();
      sliceStart = performance.now();
    }
  }
  return { grid: { n, spacing, data }, use };
}

/** Fills nodes that have no data from a coarser grid (or, for the coarsest, from the mean of what exists). Returns how many were filled. */
function fillGaps(grid: Grid, coarser: Grid | null): number {
  const { n, spacing, data } = grid, c = (n - 1) / 2;
  let missing = 0, sum = 0, count = 0;
  for (let k = 0; k < data.length; k++) {
    if (Number.isFinite(data[k])) {
      sum += data[k];
      count++;
    } else missing++;
  }
  if (!missing) return 0;
  const mean = count ? sum / count : 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(data[j * n + i])) continue;
      const v = coarser ? sampleGrid(coarser, (i - c) * spacing, (j - c) * spacing) : NaN;
      data[j * n + i] = Number.isFinite(v) ? v : mean;
    }
  }
  return missing;
}

/** Which products a grid used between two distances from the site, most used first. */
function bandSources(stack: TerrainStack, sampled: Sampled, fromM: number, toM: number): GroundBand['sources'] {
  const { n, spacing } = sampled.grid, c = (n - 1) / 2;
  const counts = new Map<number, number>();
  let total = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const reach = Math.max(Math.abs(i - c), Math.abs(j - c)) * spacing;
      if (reach < fromM || reach > toM) continue;
      const k = sampled.use[j * n + i];
      if (k === 255) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      total++;
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ name: stack.sources[k].name, resolutionM: stack.sources[k].resolutionM, share: count / total }))
    .filter((s, idx) => idx === 0 || s.share >= 0.05);
}

const band = (fromM: number, toM: number, gridM: number, sources: GroundBand['sources']): GroundBand => ({
  fromM,
  toM,
  gridM,
  sources,
  interpolated: sources.length > 0 && sources[0].resolutionM > gridM * 1.5,
});

/** Builds the scene's grids from a terrain stack. Exported for tests; the app calls loadGround. */
export async function groundFromStack(stack: TerrainStack, site: SiteLike): Promise<Omit<GroundData, 'ortho' | 'detail' | 'via'>> {
  if (!stack.sources.length) throw new Error('No elevation data is available at this point.');
  const notes = [...stack.notes];

  // Coarse levels. The outermost is kept only if real data reaches that far.
  const sampled: Sampled[] = [];
  for (const level of COARSE_LEVELS) {
    const s = await sampleLevel(stack, site, level.n, level.spacing);
    let have = 0;
    for (let k = 0; k < s.use.length; k++) if (s.use[k] !== 255) have++;
    if (have / s.use.length < 0.5) {
      if (!sampled.length) throw new Error('No elevation data is available at this point.');
      notes.push(`Elevation data does not reach ${Math.round(halfExtent(s.grid) / 1000)} km from this site, so terrain beyond ${Math.round(halfExtent(sampled[sampled.length - 1].grid) / 1000)} km is not drawn.`);
      break;
    }
    sampled.push(s);
  }
  // Fill holes from the next coarser level, coarsest first.
  for (let k = sampled.length - 1; k >= 0; k--) {
    const filled = fillGaps(sampled[k].grid, sampled[k + 1]?.grid ?? null);
    if (filled > sampled[k].use.length * 0.02) notes.push(`${Math.round((filled / sampled[k].use.length) * 100)}% of the ${sampled[k].grid.spacing} m grid had no elevation data and was filled in from coarser data.`);
  }

  // Fine level: only from a real survey of the ground at the site.
  const isSurvey = (s: HeightSource) => s.resolutionM <= SURVEY_MAX_RES_M;
  const surveyed = stack.sources.some((s) => isSurvey(s) && s.covers(site.lat, site.lon) && Number.isFinite(s.sample(site.lat, site.lon)));
  let fine: Grid | null = null;
  let fineSampled: Sampled | null = null;
  if (surveyed) {
    fineSampled = await sampleLevel(stack, site, FINE_LEVEL.n, FINE_LEVEL.spacing, isSurvey);
    const base = upsample(sampled[0].grid, FINE_LEVEL.n, FINE_LEVEL.spacing);
    const filled = fillGaps(fineSampled.grid, base);
    if (filled > fineSampled.use.length * 0.02) notes.push(`The survey covers ${Math.round((1 - filled / fineSampled.use.length) * 100)}% of the ground within ${Math.round(halfExtent(fineSampled.grid))} m; the rest is interpolated from the ${sampled[0].grid.spacing} m grid.`);
    fine = fineSampled.grid;
  }

  const bands: GroundBand[] = [];
  const fineHalf = ((FINE_LEVEL.n - 1) / 2) * FINE_LEVEL.spacing;
  bands.push(band(0, fineHalf, FINE_LEVEL.spacing, fineSampled ? bandSources(stack, fineSampled, 0, fineHalf) : bandSources(stack, sampled[0], 0, fineHalf)));
  let inner = fineHalf;
  for (const s of sampled) {
    const outer = halfExtent(s.grid);
    bands.push(band(inner, outer, s.grid.spacing, bandSources(stack, s, inner, outer)));
    inner = outer;
  }
  return { fine, coarse: sampled.map((s) => s.grid), bands, notes };
}

// ---------------------------------------------------------------- fallback: bundled windows read directly

async function groundFromBundle(site: SiteLike, index: BundledIndex): Promise<Omit<GroundData, 'ortho' | 'detail' | 'via'>> {
  const info = index.sites[site.id];
  if (!info) throw new Error(`No elevation data is bundled for ${site.name ?? site.id}.`);
  const [buffer, fineBuffer] = await Promise.all([fetchBinary(`${site.id}.bin`), info.fine ? fetchBinary(`${site.id}_fine.bin`).catch(() => null) : null]);
  const n = index.size, all = new Float32Array(buffer);
  if (all.length !== n * n * index.levels.length) throw new Error(`${site.id}.bin: unexpected size`);
  const coarse: Grid[] = index.levels.map((l, i) => ({ n, spacing: l.spacing, data: all.slice(i * n * n, (i + 1) * n * n) }));
  const fine: Grid | null = info.fine && fineBuffer ? { n: info.fine.size, spacing: info.fine.spacing, data: new Float32Array(fineBuffer) } : null;
  const product = { name: `${info.source} (site window)`, resolutionM: coarse[0].spacing, share: 1 };
  const bands: GroundBand[] = [];
  const fineHalf = fine ? halfExtent(fine) : ((FINE_LEVEL.n - 1) / 2) * FINE_LEVEL.spacing;
  bands.push(band(0, fineHalf, fine ? fine.spacing : FINE_LEVEL.spacing, [fine ? { ...parseFineSource(info.fine!.source), share: 1 } : product]));
  let inner = fineHalf;
  for (const g of coarse) {
    bands.push(band(inner, halfExtent(g), g.spacing, [{ ...product, resolutionM: g.spacing }]));
    inner = halfExtent(g);
  }
  return { fine, coarse, bands, notes: [`Terrain farther than ${Math.round(inner / 1000)} km from the site is not drawn (only the bundled site window is available).`] };
}

// ---------------------------------------------------------------- entry point

/** Loads the ground for a site: any coordinates through the terrain service, catalogued landings from the bundle as a fallback. */
export async function loadGround(site: SiteLike): Promise<GroundData> {
  const index = await bundledIndex().catch(() => null);
  const info = index?.sites[site.id];
  let core: Omit<GroundData, 'ortho' | 'detail' | 'via'> | null = null;
  let via: GroundData['via'] = 'terrain-service';
  let serviceError: unknown = null;
  try {
    const stack = await loadTerrainFor({ id: site.id, name: site.name ?? site.id, lat: site.lat, lon: site.lon, kind: site.kind ?? 'landing' });
    core = await groundFromStack(stack, site);
  } catch (err) {
    serviceError = err;
  }
  if (!core) {
    if (!index || !info) {
      const why = serviceError instanceof Error ? serviceError.message : String(serviceError);
      throw new Error(`No elevation data could be loaded for ${site.name ?? 'this point'} (${why}).`);
    }
    core = await groundFromBundle(site, index);
    via = 'bundled-windows';
  }
  // The photo and its shading-derived relief belong to the surveyed window of this very site.
  const fineInfo = core.fine && info?.fine && core.fine.n === info.fine.size && core.fine.spacing === info.fine.spacing ? info.fine : null;
  return {
    ...core,
    ortho: fineInfo?.ortho ? terrainUrl(fineInfo.ortho) : null,
    detail: fineInfo?.detail ? { url: terrainUrl(fineInfo.detail.file), size: fineInfo.detail.size, range: fineInfo.detail.range } : null,
    via,
  };
}

/** Eases each grid onto the next coarser one at its edge (coarsest pair first), so the meshes meet without steps. */
export function blendLevels(grids: Grid[]): void {
  for (let k = grids.length - 2; k >= 0; k--) blendEdge(grids[k], grids[k + 1]);
}

// ---------------------------------------------------------------- words

const km = (m: number): string => (m >= 9950 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`);
const res = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : m >= 10 ? `${Math.round(m)} m` : `${Number(m.toFixed(1))} m`);

/**
 * States what the ground is built from, band by band, in one line a planner can read:
 * product, its resolution, and how far it reaches. Says so when a band is only interpolated.
 */
export function describeGround(bands: GroundBand[]): string {
  const parts: string[] = [];
  let last = '';
  for (const b of bands) {
    const s = b.sources[0];
    if (!s) continue;
    const what = `${s.name} (${res(s.resolutionM)} per sample)`;
    const text = b.interpolated ? `${what}, interpolated` : what;
    if (text === last) {
      // Same product as the band before: just extend its reach.
      parts[parts.length - 1] = parts[parts.length - 1].replace(/to [\d.]+ k?m$/, `to ${km(b.toM)}`);
    } else {
      parts.push(`${text} to ${km(b.toM)}`);
    }
    last = text;
  }
  return parts.join('; ');
}
