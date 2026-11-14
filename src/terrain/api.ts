// Entry points for terrain data. Owned by the elevation-data worker.
// Analysis code asks for a TerrainStack and never touches files or URLs itself.
//
// Everything here works in the browser (files are fetched), inside a Web Worker, and under
// Node/vitest (files are read from public/). Decoded grids are cached per JavaScript
// realm, so calling loadTerrainFor inside a worker avoids copying the large grids across.
import type { SiteRef } from '../core/types';
import type { CoverageRegion, HeightGridDescriptor, HeightProvenance, HeightSource, TerrainStack } from './types';
import { decodeLxg, type LxgGrid } from './lxg';
import { localOffset, polarXY, surfaceDistanceM } from './geo';
import { readTerrainFile, readTerrainJson, siteUrl, TerrainFileMissing } from './reader';
import { createSource } from './sources';

export { setTerrainReader, TerrainFileMissing, type BinaryReader } from './reader';

// ---------------------------------------------------------------- file layouts

/** public/terrain/index.json: the per-site windows built by scripts/fetch-terrain.mjs and fetch-apollo-terrain.mjs. */
interface SiteWindowIndex {
  size: number;
  levels: { name: string; spacing: number }[];
  sites: Record<
    string,
    {
      /** Centre the window was built for. */
      lat?: number;
      lon?: number;
      /** Product behind the 60 m and 480 m grids. */
      source: string;
      height: number;
      fine?: { size: number; spacing: number; source: string };
    }
  >;
}

/** One bundled grid, as listed in public/data/dem/index.json (written by scripts/build-dem.mjs). */
export interface DemLayerInfo {
  id: string;
  /** File name inside data/dem/. */
  file: string;
  role: 'global' | 'overview' | 'polar';
  kind: 'equirect' | 'polar';
  name: string;
  resolutionM: number;
  /** Size of the file as shipped (compressed), bytes. */
  bytes: number;
  sha256: string;
  pole?: 'N' | 'S';
  /** Half-width of a polar grid's square footprint, metres in the projection plane. */
  halfWidthM?: number;
  /** Latitude band fully covered. For a polar grid this is the circle inscribed in its square. */
  latMin: number;
  latMax: number;
  /** What the corners of a polar square add beyond that circle, in words. */
  footprintNote?: string;
  provenance: HeightProvenance;
  /** What this layer does NOT give you, in words. */
  notCovered: string;
}

interface DemIndex {
  format: 'lunyx-dem-index/1';
  layers: DemLayerInfo[];
}

// ---------------------------------------------------------------- injection points

/**
 * Asks the elevation server for a site window around custom coordinates and returns the
 * LXG bytes. The default (browser only) calls GET /api/terrain. Pass null to switch remote
 * windows off, or a function to supply your own (tests).
 */
export type WindowFetcher = (lat: number, lon: number, signal: AbortSignal) => Promise<ArrayBuffer>;
let windowFetcher: WindowFetcher | null | undefined;

export function setTerrainWindowFetcher(fetcher: WindowFetcher | null | undefined): void {
  windowFetcher = fetcher;
  remoteWindows.clear();
}

const defaultWindowFetcher: WindowFetcher = async (lat, lon, signal) => {
  const res = await fetch(siteUrl(`api/terrain?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`), { signal });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* not JSON: the status code is all we have */
    }
    throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
  }
  if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new Error('no elevation server at /api/terrain');
  return res.arrayBuffer();
};

function activeWindowFetcher(): WindowFetcher | null {
  if (windowFetcher !== undefined) return windowFetcher;
  // Under Node there is no server to ask unless a test injects one.
  return import.meta.env.SSR ? null : defaultWindowFetcher;
}

// ---------------------------------------------------------------- caches

let siteIndexPromise: Promise<SiteWindowIndex | null> | null = null;
let demIndexPromise: Promise<DemIndex | null> | null = null;
const layerSources = new Map<string, Promise<HeightSource>>();
const siteWindows = new Map<string, Promise<HeightSource[]>>();
const remoteWindows = new Map<string, Promise<{ sources: HeightSource[]; notes: string[] }>>();

/** Forgets everything loaded so far (tests that swap the reader call this). */
export function clearTerrainCache(): void {
  siteIndexPromise = null;
  demIndexPromise = null;
  layerSources.clear();
  siteWindows.clear();
  remoteWindows.clear();
}

async function optionalJson<T>(path: string): Promise<T | null> {
  try {
    return await readTerrainJson<T>(path);
  } catch (e) {
    if (e instanceof TerrainFileMissing) return null;
    throw e;
  }
}

const siteIndex = (): Promise<SiteWindowIndex | null> => (siteIndexPromise ??= optionalJson<SiteWindowIndex>('terrain/index.json'));
const demIndex = (): Promise<DemIndex | null> => (demIndexPromise ??= optionalJson<DemIndex>('data/dem/index.json'));

// ---------------------------------------------------------------- sources

/** Rebuilds a source from its plain description (used on the far side of a Web Worker boundary). */
export function sourceFromDescriptor(descriptor: HeightGridDescriptor): HeightSource {
  return createSource(descriptor);
}

/** The bundled grids (whole Moon, overview, polar layers) and what each one is. Empty until the DEM bundle is installed. */
export async function demLayers(): Promise<DemLayerInfo[]> {
  return (await demIndex())?.layers ?? [];
}

function descriptorFromGrid(g: LxgGrid, data: Int16Array | Float32Array): HeightGridDescriptor {
  const num = (key: string): number => {
    const v = g[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`grid header: ${key} is missing`);
    return v;
  };
  const name = typeof g.name === 'string' ? g.name : 'unnamed grid';
  switch (g.kind) {
    case 'equirect':
      return { kind: 'equirect', name, resolutionM: num('resolutionM'), width: g.width, height: g.height, latN: num('latN'), latS: num('latS'), lonW: num('lonW'), lonE: num('lonE'), data, scale: num('scale'), offset: num('offset'), ...(typeof g.nodata === 'number' ? { nodata: g.nodata } : {}) };
    case 'polar':
      if (g.width !== g.height) throw new Error('grid header: a polar grid must be square');
      if (g.pole !== 'N' && g.pole !== 'S') throw new Error('grid header: pole is missing');
      return { kind: 'polar', name, resolutionM: num('resolutionM'), pole: g.pole, size: g.width, metresPerPx: num('metresPerPx'), data, scale: num('scale'), offset: num('offset'), ...(typeof g.nodata === 'number' ? { nodata: g.nodata } : {}) };
    case 'local':
      if (g.width !== g.height) throw new Error('grid header: a local grid must be square');
      if (!(data instanceof Float32Array)) throw new Error('grid header: a local grid must be float32');
      return { kind: 'local', name, resolutionM: num('resolutionM'), lat0: num('lat0'), lon0: num('lon0'), n: g.width, spacingM: num('spacingM'), data };
    default:
      throw new Error(`grid header: unknown kind ${String(g.kind)}`);
  }
}

function loadLayer(layer: DemLayerInfo): Promise<HeightSource> {
  let p = layerSources.get(layer.id);
  if (!p) {
    p = (async () => {
      const { header, arrays } = await decodeLxg(await readTerrainFile(`data/dem/${layer.file}`));
      return createSource(descriptorFromGrid(header.grids[0], arrays[0]), layer.provenance);
    })();
    // A failed download must not poison the cache.
    p.catch(() => layerSources.delete(layer.id));
    layerSources.set(layer.id, p);
  }
  return p;
}

/**
 * The whole-Moon LOLA grid: 16 px/deg (1.9 km per sample) for analysis, or the small
 * 4 px/deg overview (7.6 km) that loads quickly for a first drawing of the globe's relief.
 */
export async function loadGlobalGrid(ppd: 4 | 16 = 16): Promise<HeightSource> {
  const layers = await demLayers();
  const layer = layers.find((l) => l.role === (ppd === 16 ? 'global' : 'overview'));
  if (!layer) throw new TerrainFileMissing('data/dem/index.json', `no ${ppd} px/deg whole-Moon grid is installed`);
  return loadLayer(layer);
}

// ---------------------------------------------------------------- site windows

const SLDEM_PROVENANCE: HeightProvenance = {
  product: 'SLDEM2015 (LRO LOLA + SELENE Terrain Camera), 512 px/deg, PDS Geosciences Node',
  url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/sldem2015/',
  processing: 'Resampled bilinearly onto a square east/north grid centred on the site; the 480 m grid uses every 8th source sample.',
  citation: 'Barker, M. K., et al. (2016). A new lunar digital elevation model from the Lunar Orbiter Laser Altimeter and SELENE Terrain Camera. Icarus, 273, 346-355.',
};
const LOLA_POLAR_PROVENANCE: HeightProvenance = {
  product: 'LRO LOLA polar gridded data records (LDEM polar stereographic), PDS Geosciences Node',
  url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/',
  processing: 'Resampled bilinearly onto a square east/north grid centred on the site; coarser grids skip source samples.',
  citation: 'Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit. Icarus, 283, 70-91.',
};
const NAC_PROVENANCE: HeightProvenance = {
  product: 'LROC NAC digital terrain model (NASA/GSFC/Arizona State University), PDS',
  url: 'https://wms.lroc.asu.edu/lroc/rdr_product_select',
  processing: 'Resampled to 3 m spacing on a square east/north grid; shifted vertically to match the 60 m model on average, and gaps filled from the 60 m model.',
  citation: 'Henriksen, M. R., et al. (2017). Extracting accurate and precise topography from LROC narrow angle camera stereo observations. Icarus, 283, 122-137.',
};

/** Provenance sent along by the elevation server, if it is complete. */
function asProvenance(v: unknown): HeightProvenance | null {
  const p = v as Partial<HeightProvenance> | null | undefined;
  return p && typeof p.product === 'string' && typeof p.url === 'string' && typeof p.processing === 'string' && typeof p.citation === 'string' ? { product: p.product, url: p.url, processing: p.processing, citation: p.citation } : null;
}

function windowProvenance(source: string): HeightProvenance {
  return /SLDEM/i.test(source) ? SLDEM_PROVENANCE : LOLA_POLAR_PROVENANCE;
}

/** "LOLA ldem_80s_20m" -> "LOLA LDEM_80S_20M": product ids read better in capitals. */
function productLabel(source: string): string {
  return source.replace(/ldem_\w+/gi, (m) => m.toUpperCase());
}

/** The bundled windows of one catalogued site: [3 m (if surveyed), 60 m, 480 m]. */
function loadSiteWindows(id: string, index: SiteWindowIndex): Promise<HeightSource[]> {
  let p = siteWindows.get(id);
  if (!p) {
    p = (async () => {
      const entry = index.sites[id];
      if (entry.lat === undefined || entry.lon === undefined) throw new Error(`terrain/index.json: ${id} has no centre coordinates`);
      const n = index.size;
      const [coarseBuf, fineBuf] = await Promise.all([
        readTerrainFile(`terrain/${id}.bin`),
        entry.fine ? readTerrainFile(`terrain/${id}_fine.bin`).catch((e) => (e instanceof TerrainFileMissing ? null : Promise.reject(e))) : null,
      ]);
      if (coarseBuf.byteLength !== n * n * 4 * index.levels.length) throw new Error(`terrain/${id}.bin: unexpected size ${coarseBuf.byteLength}`);
      const all = new Float32Array(coarseBuf);
      const sources: HeightSource[] = [];
      if (entry.fine && fineBuf) {
        const f = entry.fine;
        if (fineBuf.byteLength !== f.size * f.size * 4) throw new Error(`terrain/${id}_fine.bin: unexpected size ${fineBuf.byteLength}`);
        // "LROC NAC DTM NAC_DTM_APOLLO17_E203N0308.IMG (5.0 m), orthophoto ...": keep the model, drop the photo.
        const model = f.source.split(', orthophoto')[0];
        const native = Number(/\(([\d.]+) m\)/.exec(model)?.[1] ?? NaN);
        sources.push(
          createSource(
            { kind: 'local', name: `${model}, ${f.spacing} m site window`, resolutionM: Number.isFinite(native) ? Math.max(native, f.spacing) : f.spacing, lat0: entry.lat, lon0: entry.lon, n: f.size, spacingM: f.spacing, data: new Float32Array(fineBuf) },
            NAC_PROVENANCE,
          ),
        );
      }
      index.levels.forEach((level, k) => {
        sources.push(
          createSource(
            { kind: 'local', name: `${productLabel(entry.source)}, ${level.spacing} m site window`, resolutionM: level.spacing, lat0: entry.lat!, lon0: entry.lon!, n, spacingM: level.spacing, data: all.subarray(k * n * n, (k + 1) * n * n) },
            windowProvenance(entry.source),
          ),
        );
      });
      return sources;
    })();
    p.catch(() => siteWindows.delete(id));
    siteWindows.set(id, p);
  }
  return p;
}

const REMOTE_TIMEOUT_MS = 45_000;

/** A 60 m + 480 m window built by the elevation server for custom coordinates. Never rejects: failure becomes a note. */
function loadRemoteWindow(lat: number, lon: number): Promise<{ sources: HeightSource[]; notes: string[] }> {
  const fetcher = activeWindowFetcher();
  if (!fetcher) return Promise.resolve({ sources: [], notes: [] });
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  let p = remoteWindows.get(key);
  if (!p) {
    p = (async () => {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), REMOTE_TIMEOUT_MS);
      try {
        const { header, arrays } = await decodeLxg(await fetcher(lat, lon, abort.signal));
        const sources = header.grids.map((g, k) => {
          const d = descriptorFromGrid(g, arrays[k]);
          return createSource(d, asProvenance(g.provenance) ?? windowProvenance(d.name));
        });
        const notes = Array.isArray(header.notes) ? header.notes.filter((s): s is string => typeof s === 'string') : [];
        return { sources, notes };
      } catch (e) {
        remoteWindows.delete(key); // let a later call try again
        const why = abort.signal.aborted ? `no answer within ${REMOTE_TIMEOUT_MS / 1000} s` : e instanceof Error ? e.message : String(e);
        return { sources: [], notes: [`The elevation server could not build a 60 m window for this point (${why}), so only the bundled grids are used here.`] };
      } finally {
        clearTimeout(timer);
      }
    })();
    remoteWindows.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------- stack

export interface LoadTerrainOptions {
  /**
   * For custom coordinates, ask the elevation server (GET /api/terrain) for a 60 m / 480 m
   * window. Default true; it is skipped automatically where no server can be reached and
   * the reason is reported in `notes`. Catalogued landings never need it.
   */
  remote?: boolean;
}

/** A polar layer earns its download when the site is inside it or its edge is this many pixels away at most. */
const POLAR_REACH_PX = 1500;

const km = (m: number): string => (m >= 9950 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(m >= 995 ? 1 : 2)} km`);
const res = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** How far a source reaches from a point in the worst direction, metres (0 if it does not cover the point). */
function reachFrom(source: HeightSource, lat: number, lon: number): number {
  if (!source.covers(lat, lon)) return 0;
  const d = source.descriptor;
  if (d.kind === 'equirect') return Infinity;
  if (d.kind === 'local') {
    const half = ((d.n - 1) / 2) * d.spacingM;
    const { eastM, northM } = localOffset(d.lat0, d.lon0, lat, lon);
    return Math.max(0, half - Math.max(Math.abs(eastM), Math.abs(northM)));
  }
  const half = ((d.size - 1) / 2) * d.metresPerPx;
  const { x, y } = polarXY(d.pole, lat, lon);
  return Math.max(0, half - Math.max(Math.abs(x), Math.abs(y)));
}

/**
 * Elevation data around a site, finest first: surveyed site windows where they exist,
 * the polar model near the south pole, and the whole-Moon grid underneath. `notes` says in
 * plain language what the result rests on and what is missing.
 */
export async function loadTerrainFor(site: SiteRef, options: LoadTerrainOptions = {}): Promise<TerrainStack> {
  if (!Number.isFinite(site.lat) || !Number.isFinite(site.lon) || Math.abs(site.lat) > 90) throw new Error(`loadTerrainFor: bad coordinates ${site.lat}, ${site.lon}`);
  const [windows, dem] = await Promise.all([siteIndex(), demIndex()]);
  const notes: string[] = [];
  const sources: HeightSource[] = [];
  const add = (s: HeightSource): void => {
    if (!sources.includes(s)) sources.push(s);
  };

  // 1. Windows made for this very site.
  const own = site.kind === 'landing' && windows?.sites[site.id] ? site.id : null;
  if (own) {
    try {
      (await loadSiteWindows(own, windows!)).forEach(add);
    } catch (e) {
      notes.push(`The surveyed window for this site could not be read (${e instanceof Error ? e.message : String(e)}).`);
    }
  }

  // 2. Custom coordinates: a window built on request, and any neighbouring site's window that happens to cover the point.
  if (!own || sources.length === 0) {
    // Deep inside a bundled polar layer that is finer than the window's 60 m grid, the server has nothing to add.
    const windowReach = windows ? ((windows.size - 1) / 2) * Math.max(...windows.levels.map((l) => l.spacing)) : 30720;
    const windowFinest = windows ? Math.min(...windows.levels.map((l) => l.spacing)) : 60;
    const alreadyFiner = (dem?.layers ?? []).some((l) => {
      if (l.role !== 'polar' || !l.pole || !l.halfWidthM || l.resolutionM > windowFinest || (l.pole === 'S') !== site.lat < 0) return false;
      const { x, y } = polarXY(l.pole, site.lat, site.lon);
      return l.halfWidthM - Math.max(Math.abs(x), Math.abs(y)) >= windowReach;
    });
    const remote = options.remote === false || alreadyFiner ? { sources: [], notes: [] } : await loadRemoteWindow(site.lat, site.lon);
    remote.sources.forEach(add);
    notes.push(...remote.notes);
    if (windows) {
      const outerHalf = ((windows.size - 1) / 2) * Math.max(...windows.levels.map((l) => l.spacing));
      for (const [id, entry] of Object.entries(windows.sites)) {
        if (entry.lat === undefined || entry.lon === undefined) continue;
        const dist = surfaceDistanceM(entry.lat, entry.lon, site.lat, site.lon);
        if (dist > outerHalf * Math.SQRT2) continue;
        try {
          const near = (await loadSiteWindows(id, windows)).filter((s) => s.covers(site.lat, site.lon));
          // With a window of our own, a neighbour only helps where it is finer (a 3 m survey).
          const useful = remote.sources.length ? near.filter((s) => s.resolutionM < Math.min(...remote.sources.map((r) => r.resolutionM))) : near;
          if (useful.length) {
            useful.forEach(add);
            notes.push(`This point lies ${km(dist)} from the catalogued site "${id}": its surveyed window is used where it reaches (it is centred on that site, so it extends further in some directions than others).`);
          }
        } catch {
          /* a neighbour's window that cannot be read is simply not used */
        }
      }
    }
  }

  // 3. Bundled polar layers near enough to matter, then the whole Moon.
  let global: HeightSource | null = null;
  if (dem) {
    for (const layer of dem.layers) {
      if (layer.role !== 'polar' || !layer.pole || !layer.halfWidthM) continue;
      if ((layer.pole === 'S') !== site.lat < 0) continue;
      const { x, y } = polarXY(layer.pole, site.lat, site.lon);
      const gap = Math.hypot(Math.max(0, Math.abs(x) - layer.halfWidthM), Math.max(0, Math.abs(y) - layer.halfWidthM));
      if (gap > POLAR_REACH_PX * layer.resolutionM) continue;
      try {
        add(await loadLayer(layer));
      } catch (e) {
        notes.push(`${layer.name} could not be loaded (${e instanceof Error ? e.message : String(e)}).`);
      }
    }
    const g = dem.layers.find((l) => l.role === 'global');
    if (g) {
      try {
        global = await loadLayer(g);
      } catch (e) {
        notes.push(`The whole-Moon grid could not be loaded (${e instanceof Error ? e.message : String(e)}).`);
      }
    }
  }

  // Finest first; between equals, the one that reaches further from this site.
  const reach = new Map(sources.map((s) => [s, reachFrom(s, site.lat, site.lon)]));
  sources.sort((a, b) => a.resolutionM - b.resolutionM || reach.get(b)! - reach.get(a)!);
  if (global) sources.push(global);

  // 4. Say what this rests on.
  const here = sources.filter((s) => s.covers(site.lat, site.lon));
  if (here.length === 0) {
    notes.unshift('No elevation data is available at this point.');
  } else {
    const parts = here.map((s) => {
      const r = reachFrom(s, site.lat, site.lon);
      return `${s.name} (${res(s.resolutionM)} per sample${Number.isFinite(r) ? `, to about ${km(r)}` : ', whole Moon'})`;
    });
    notes.unshift(`Elevation data at this point, finest first: ${parts.join('; ')}.`);
    const finest = here[0];
    if (finest.resolutionM > 100) {
      notes.push(`No high-resolution survey is loaded for this point: relief smaller than about ${res(finest.resolutionM)} is not resolved, so the nearby skyline and the slope are approximate.`);
    }
  }
  if (global) {
    const finer = here.filter((s) => s !== global);
    const finerReach = finer.length ? Math.max(...finer.map((s) => reachFrom(s, site.lat, site.lon))) : 0;
    if (finerReach > 0) notes.push(`Beyond about ${km(finerReach)} from the site only the whole-Moon grid is available (${res(global.resolutionM)} per sample), which smooths ridges narrower than that; distant skyline peaks can read slightly low.`);
  } else if (here.length) {
    const anyReach = Math.max(...here.map((s) => reachFrom(s, site.lat, site.lon)));
    notes.push(`The whole-Moon grid is not installed, so terrain farther than about ${km(anyReach)} from the site is not taken into account.`);
  }
  return { sources, notes };
}

// ---------------------------------------------------------------- coverage

/** Where each class of elevation data exists, for the coverage display. Finest first. */
export async function coverageRegions(): Promise<CoverageRegion[]> {
  const [windows, dem] = await Promise.all([siteIndex(), demIndex()]);
  const regions: CoverageRegion[] = [];
  if (windows) {
    const located = Object.entries(windows.sites).filter(([, e]) => e.lat !== undefined && e.lon !== undefined);
    const fine = located.filter(([, e]) => e.fine);
    if (fine.length) {
      const f = fine[0][1].fine!;
      regions.push({
        name: 'LROC NAC stereo models around landing sites',
        resolutionM: f.spacing,
        sites: fine.map(([, e]) => ({ lat: e.lat!, lon: e.lon!, halfWidthM: ((e.fine!.size - 1) / 2) * e.fine!.spacing })),
        note: `${fine.length} landing sites; source models are 2 to 5 m per pixel, resampled to ${f.spacing} m.`,
      });
    }
    for (const level of windows.levels) {
      regions.push({
        name: `Site windows at ${level.spacing} m (SLDEM2015, LOLA polar grids)`,
        resolutionM: level.spacing,
        sites: located.map(([, e]) => ({ lat: e.lat!, lon: e.lon!, halfWidthM: ((windows.size - 1) / 2) * level.spacing })),
        note: `${located.length} catalogued landing sites.`,
      });
    }
    regions.push({
      name: 'Site windows built on request for any coordinates (60 m and 480 m)',
      resolutionM: Math.min(...windows.levels.map((l) => l.spacing)),
      latMin: -90,
      latMax: 90,
      onDemand: true,
      note: 'Built by the elevation server from the PDS LOLA / SLDEM2015 archive; needs network access. Not bundled.',
    });
  }
  for (const layer of dem?.layers ?? []) {
    regions.push({ name: layer.name, resolutionM: layer.resolutionM, latMin: layer.latMin, latMax: layer.latMax, ...(layer.footprintNote ? { note: layer.footprintNote } : {}) });
  }
  return regions.sort((a, b) => a.resolutionM - b.resolutionM);
}
