// Entry points for terrain data. Owned by the elevation-data worker.
// Analysis code asks for a TerrainStack and never touches files or URLs itself.
//
// Everything here works in the browser (files are fetched), inside a Web Worker, and under
// Node/vitest (files are read from public/). Decoded grids are cached per JavaScript
// realm, so calling loadTerrainFor inside a worker avoids copying the large grids across.
import type { SiteRef } from '../core/types';
import type { CoverageRegion, HeightGridDescriptor, HeightProvenance, HeightSource, TerrainSeam, TerrainStack } from './types';
import { decodeLxg, type LxgArray, type LxgGrid } from './lxg';
import { localOffset, offsetPoint, polarXY, surfaceDistanceM } from './geo';
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
  handOverCache.clear();
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

function descriptorFromGrid(g: LxgGrid, data: LxgArray): HeightGridDescriptor {
  if (data instanceof Uint8Array) throw new Error('grid header: a height grid cannot be 8-bit');
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
/**
 * Grids that are a measurement of their own rather than a finer sampling of the grids around
 * them: the 3 m stereo models, each tied to its 60 m window by one vertical shift only
 * (scripts/fetch-apollo-terrain.mjs). These are the grids whose edges are eased (easeStack).
 */
const separateSurveys = new WeakSet<HeightSource>();

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
        const survey = createSource(
          { kind: 'local', name: `${model}, ${f.spacing} m site window`, resolutionM: Number.isFinite(native) ? Math.max(native, f.spacing) : f.spacing, lat0: entry.lat, lon0: entry.lon, n: f.size, spacingM: f.spacing, data: new Float32Array(fineBuf) },
          NAC_PROVENANCE,
        );
        separateSurveys.add(survey);
        sources.push(survey);
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
  /**
   * Ease each 3 m survey model onto the 60 m window that takes over outside it, over the
   * model's outer 129 m, so the ground has no step there (see easeStack). Off by default
   * (decision D-7): checked against laser altimetry (LOLA), the stored 3 m models are closer
   * to the ground at their edges than the eased ones, and the step is the 60 m window's error
   * (docs/lunyx/handover/T-32-verification.md). True gives the eased stack, for comparison.
   */
  easeEdges?: boolean;
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
  // 5. Where one grid hands over to the next: how well they agree there, measured for this site, and
  //    (only when asked for) a separately measured model eased onto the grid around it.
  const edges = handOvers(sources, site, options.easeEdges === true);
  notes.push(...edges.notes);
  // 6. Where that disagreement moves a sunrise or a sunset by more than a minute, say by how much.
  const modelEdge = edges.seams.find((x) => x.inner === '3 m model' && x.distanceM === MODEL_EDGE_M);
  const events = own && modelEdge ? SEAM_EVENT_MINUTES[own] : undefined;
  if (events) notes.push(seamEventNote(events, site.lat, modelEdge!));
  return { sources: edges.stack, notes, ...(edges.seams.length ? { seams: edges.seams } : {}) };
}

/** Half the width of the bundled 3 m site models (513 samples at 3 m), metres: where their edge is from the site. */
const MODEL_EDGE_M = 768;

/**
 * Sites where a sunrise or a sunset is seen over the edge of the site's own 3 m model, so that
 * the two grids' disagreement there moves it by more than a minute: the largest difference
 * between the skyline on the stored grids and on the eased ones (easeEdges: true), over the
 * azimuths where the Sun can rise or set (90 or 270 degrees, give or take 2 degrees divided by
 * the cosine of the latitude), divided by the Sun's fastest climb at that latitude; observer
 * 2 m up. Measured with `node scripts/terrain-seams-skyline.mjs` (docs/lunyx/handover/
 * T-32-verification.md); at the other 17 sites with a 3 m model it is under a minute.
 * src/terrain/api.test.ts recomputes the two entries.
 */
const SEAM_EVENT_MINUTES: Record<string, { sunrise?: number; sunset?: number }> = {
  'blue-ghost-1': { sunset: 20 },
  'luna-23': { sunrise: 12 },
};

/** The Sun's motion across the lunar sky, degrees per minute (360 degrees per synodic month of 29.530589 days). */
const SUN_DEG_PER_MIN = 360 / (29.530589 * 1440);

/** "Sunsets here are seen over the 3 m model's edge ...": the event-time uncertainty that the seam implies at this site. */
function seamEventNote(events: { sunrise?: number; sunset?: number }, lat: number, seam: TerrainSeam): string {
  const rate = SUN_DEG_PER_MIN * Math.cos((lat * Math.PI) / 180);
  const kinds = (['sunrise', 'sunset'] as const).filter((k) => events[k] !== undefined);
  const which = kinds.map((k) => `${k}s`).join(' and ');
  const side = kinds.map((k) => (k === 'sunrise' ? 'east' : 'west')).join(' and ');
  const upTo = kinds.map((k) => `${kinds.length > 1 ? `${k}s ` : ''}by up to about ${events[k]} minutes`).join(', ');
  return (
    `For an observer 2 m up, ${which} here are seen over the 3 m model's edge, ${km(seam.distanceM)} ${side} of the site, so the two grids' disagreement there moves a computed ${kinds.length > 1 ? 'event' : kinds[0]} ${upTo}` +
    ` (near the horizon the Sun climbs at most ${rate.toFixed(4)}° per minute at this latitude, so 1 m of height at ${km(seam.distanceM)} is about ${Math.round(seam.degPerMetre / rate)} minutes).`
  );
}

// ---------------------------------------------------------------- easing grids onto each other

/** The band of a grid that is eased, in samples from its edge: the surface view's rule (blendEdge in src/scene/surface/ground.ts), a twelfth of the grid. */
const easeBand = (n: number): number => Math.max(10, Math.round(n / 12));

/** For an eased grid: the grid it was made from, and how far inside its edge it was changed. */
const easedFrom = new WeakMap<HeightSource, { raw: HeightSource; overM: number }>();

/**
 * The grid as stored, for a source that loadTerrainFor eased at its edge (any other source
 * is returned as it is). For code that does its own edge blending, such as the surface view,
 * and for comparisons: easing a grid twice moves it further than once.
 */
export function storedGrid(source: HeightSource): HeightSource {
  return easedFrom.get(source)?.raw ?? source;
}

interface HandOvers {
  raw: HeightSource[];
  stack: HeightSource[];
  seams: TerrainSeam[];
  notes: string[];
}
/** The last few sites asked for: the result is the same every time, and the eased grids should stay the same objects. */
const handOverCache = new Map<string, HandOvers>();
const HAND_OVERS_KEPT = 8;

/** A seam as measured, with the grid it belongs to. */
interface MeasuredSeam extends TerrainSeam {
  source: HeightSource;
  /** The grid is centred on the site, so its edge is equally far in the four cardinal directions. */
  centred: boolean;
}

/** The stack to hand out (eased, or as stored), its hand-overs measured, and the sentences that say so. */
function handOvers(sources: HeightSource[], site: { lat: number; lon: number }, ease: boolean): HandOvers {
  const key = `${site.lat},${site.lon},${ease}`;
  const known = handOverCache.get(key);
  if (known && known.raw.length === sources.length && known.raw.every((x, i) => x === sources[i])) {
    handOverCache.delete(key);
    handOverCache.set(key, known); // most recently used last
    return known;
  }
  const before = measureSeams(sources, site);
  const stack = ease ? easeStack(sources) : sources;
  const measured =
    stack === sources
      ? before
      : measureSeams(stack, site).map((x): MeasuredSeam => {
          const from = easedFrom.get(x.source);
          const was = from && before.find((r) => r.source === from.raw);
          return from && was ? { ...x, eased: { overM: from.overM, minM: was.minM, maxM: was.maxM, rmsM: was.rmsM } } : x;
        });

  const notes: string[] = [];
  const metres = (v: number): string => (Math.abs(v) >= 99.5 ? Math.abs(v).toFixed(0) : Math.abs(v).toFixed(1));
  const side = (v: number): string => `${metres(v)} m ${v < 0 ? 'below' : 'above'}`;
  const lay = (x: { minM: number; maxM: number; rmsM: number }): string => `between ${side(x.minM)} and ${side(x.maxM)} it, ${metres(x.rmsM)} m RMS`;
  const where = (x: MeasuredSeam): string => `${km(x.distanceM)} from the site${x.centred ? '' : ' at the nearest'}`;
  const handOver = (x: MeasuredSeam): string => `${where(x)} the ${x.inner} ends and the ${x.outer} takes over, lying ${lay(x)} (1 m of height is ${x.degPerMetre.toFixed(3)}° of skyline there)`;
  const eased = measured.filter((x) => x.eased);
  const open = measured.filter((x) => !x.eased);
  if (!ease) {
    if (open.length) {
      notes.push(
        `Where one grid hands over to the next, the heights do not match exactly; the grids are used as stored, so the ground steps there: ${open.map(handOver).join('; ')}. A skyline point formed right at such an edge is uncertain by about that much.` +
          (open.some((x) => separateSurveys.has(x.source)) ? ' The 3 m model is kept as measured up to its edge: where the bundled models were checked against laser altimetry (LOLA), they are closer to the ground there than the 60 m windows.' : ''),
      );
    }
  } else {
    if (eased.length) {
      notes.push(
        `Edge easing was asked for (a comparison mode; by default the grids are used as stored). Where a separately measured model ends, its heights are eased onto the grid that continues outside it, as in the surface view, so the ground has no step: ` +
          eased.map((x) => `the ${x.inner} onto the ${x.outer} over its outer ${Math.round(x.eased!.overM)} m (${where(x)}, where the ${x.outer} lay ${lay(x.eased!)})`).join('; ') +
          `. The model is a stereo survey tied to the grid around it by a single vertical shift; that grid is the reference at the edge because the ground beyond comes from it. The two still disagree by that much: inside the eased band the heights are a blend of both, and a skyline point formed there is uncertain by about ` +
          eased.map((x, i) => `${x.degPerMetre.toFixed(3)}°${i === 0 ? ' per metre of height' : ''} at ${km(x.distanceM)}`).join(' and ') +
          `.`,
      );
    }
    if (open.length) {
      notes.push(
        `Hand-overs left as stored: ${open.map(handOver).join('; ')}. These grids share one frame (LOLA) and differ in sampling: the finer grid is right up to its edge, the difference is relief the coarser grid misses from there on, and easing the finer grid onto it would flatten real relief.`,
      );
    }
  }

  const result: HandOvers = { raw: sources.slice(), stack, seams: measured.map(({ source: _source, centred: _centred, ...seam }) => seam), notes };
  handOverCache.delete(key);
  handOverCache.set(key, result);
  if (handOverCache.size > HAND_OVERS_KEPT) handOverCache.delete(handOverCache.keys().next().value as string);
  return result;
}

/**
 * Returns the stack with every separately measured model (the 3 m stereo models) eased onto
 * the ground that continues outside it: within a twelfth of the grid from its edge the
 * heights move, along a smooth step, from the model's own to those of the next coarser
 * source with data there, and at the edge they are that source's. This is what the surface
 * view does to the grids it draws (blendEdge), with the same band and the same weights, so
 * the picture and the analysis rest on the same ground there.
 *
 * Which grid is the reference in this mode: the coarser one. The 60 m and 480 m windows, the polar layers
 * and the whole-Moon grid are all in the LOLA frame, and all the ground beyond the model's
 * edge comes from them; the model was tied to its 60 m window by one constant shift (the mean
 * difference), which leaves tilts and local offsets of several metres between the two.
 *
 * Only such models are eased. Where a 60 m window meets a 480 m window or a polar layer, or a
 * 480 m window meets the whole-Moon grid, both sides are the same frame at different sampling:
 * the mismatch is relief the coarser grid misses, the finer grid is right up to its edge, and
 * easing it would replace real ridges by the coarser grid's chords (measured on the computed
 * skyline: up to 0.4 degrees lower at Apollo 15; docs/lunyx/handover/T-32-edge-easing.md).
 *
 * The stored grids are not changed; an eased grid is a copy (see storedGrid).
 *
 * Used only when loadTerrainFor is asked for it (easeEdges: true), for comparison: by default
 * the stack keeps the stored grids (decision D-7). Checked against laser altimetry (LOLA) at 17
 * sites, the stored 3 m model is closer to the ground in this band than the eased one at 16,
 * and the step at the edge follows the 60 m window's error, not the model's
 * (docs/lunyx/handover/T-32-verification.md).
 */
function easeStack(sources: HeightSource[]): HeightSource[] {
  const stack = sources.slice();
  let changed = false;
  stack.forEach((inner, at) => {
    const d = inner.descriptor;
    if (d.kind !== 'local' || !separateSurveys.has(inner)) return;
    const band = easeBand(d.n);
    const c = (d.n - 1) / 2;
    const data = d.data.slice();
    const onto = new Set<string>();
    let moved = 0;
    for (let j = 0; j < d.n; j++) {
      for (let i = 0; i < d.n; i++) {
        const fromEdge = Math.min(i, j, d.n - 1 - i, d.n - 1 - j);
        if (fromEdge >= band) continue;
        const k = j * d.n + i;
        if (Number.isNaN(data[k])) continue;
        const p = offsetPoint(d.lat0, d.lon0, (i - c) * d.spacingM, (j - c) * d.spacingM);
        // The ground that continues outside: the first coarser source of the stack with data here.
        let outer: HeightSource | null = null;
        let h = NaN;
        for (const other of sources) {
          if (other === inner || other.resolutionM <= inner.resolutionM) continue;
          h = other.sample(p.lat, p.lon);
          if (Number.isNaN(h)) continue;
          outer = other;
          break;
        }
        // (A model with nothing but the whole-Moon grid around it is left alone: 1.9 km cells say nothing about its edge.)
        if (!outer || outer.descriptor.kind === 'equirect') continue;
        const t = 1 - fromEdge / band;
        data[k] += (h - data[k]) * t * t * (3 - 2 * t);
        onto.add(shortName(outer));
        moved++;
      }
    }
    if (moved === 0) return;
    const overM = band * d.spacingM;
    const eased = createSource(
      { ...d, data },
      inner.provenance && {
        ...inner.provenance,
        processing: `${inner.provenance.processing} When loaded: within ${Math.round(overM)} m of its edge the heights are eased onto the ${[...onto].join(' / ')}, which continues outside it, so the two meet without a step (at the edge they are that grid's, in between a blend of both).`,
      },
    );
    easedFrom.set(eased, { raw: inner, overM });
    stack[at] = eased;
    changed = true;
  });
  return changed ? stack : sources;
}

/** Short name of a grid for the seam sentence: "3 m model", "60 m window", "whole-Moon grid". */
function shortName(s: HeightSource): string {
  const d = s.descriptor;
  if (d.kind === 'equirect') return 'whole-Moon grid';
  if (d.kind === 'polar') return `${res(d.metresPerPx)} polar layer`;
  return /NAC/.test(s.name) ? `${res(d.spacingM)} model` : `${res(d.spacingM)} window`;
}

/**
 * Along the edge of each square grid the site stands on: where that grid is the one in use
 * just inside the edge (the first source of the stack with a value there), compares it, at
 * that same point, with the source in use just outside. Edges that are never a hand-over
 * (a finer layer covers both sides) are left out.
 */
function measureSeams(sources: HeightSource[], site: { lat: number; lon: number }): MeasuredSeam[] {
  /** The source the stack uses at a point, and its height there. */
  const inUse = (lat: number, lon: number): { source: HeightSource; h: number } | null => {
    for (const source of sources) {
      const h = source.sample(lat, lon);
      if (!Number.isNaN(h)) return { source, h };
    }
    return null;
  };
  const seams: MeasuredSeam[] = [];
  for (const inner of sources) {
    const d = inner.descriptor;
    if (d.kind !== 'local') continue;
    const half = ((d.n - 1) / 2) * d.spacingM;
    // The site's own windows are centred on it; a neighbouring site's window is not, and its edge is nearer on one side.
    const at = localOffset(d.lat0, d.lon0, site.lat, site.lon);
    const nearest = half - Math.max(Math.abs(at.eastM), Math.abs(at.northM));
    if (!(nearest >= 0)) continue;
    const centred = Math.hypot(at.eastM, at.northM) <= 1;
    const outerNames = new Map<string, number>();
    let min = Infinity, max = -Infinity, sum2 = 0, n = 0, nearestM = Infinity;
    for (let k = 0; k < d.n - 1; k++) {
      const t = -half + k * d.spacingM;
      for (const [east, north] of [[t, -half], [half, t], [-t, half], [-half, -t]]) {
        // A hair inside the edge and a hair outside it, to see which source is in use on each side.
        const pIn = offsetPoint(d.lat0, d.lon0, east * 0.9999, north * 0.9999);
        const pOut = offsetPoint(d.lat0, d.lon0, east * 1.0001, north * 1.0001);
        const a = inUse(pIn.lat, pIn.lon);
        if (a?.source !== inner) continue;
        const b = inUse(pOut.lat, pOut.lon);
        if (!b) continue;
        // Both grids at the same point, so that the slope of the ground does not count as a step.
        const there = b.source.sample(pIn.lat, pIn.lon);
        const diff = (Number.isNaN(there) ? b.h : there) - a.h;
        const name = shortName(b.source);
        outerNames.set(name, (outerNames.get(name) ?? 0) + 1);
        if (diff < min) min = diff;
        if (diff > max) max = diff;
        sum2 += diff * diff;
        n++;
        nearestM = Math.min(nearestM, Math.hypot(east - at.eastM, north - at.northM));
      }
    }
    if (n < d.n) continue; // this edge is a hand-over along less than a quarter of its length: not worth a line
    // How far from the site the hand-over is at its nearest: half the width for a centred grid.
    const distanceM = centred ? half : Math.round(Math.max(nearestM, d.spacingM) * 10) / 10;
    const tenth = (v: number): number => Math.round(v * 10) / 10 + 0; // + 0: no negative zero
    seams.push({
      source: inner,
      centred,
      inner: shortName(inner),
      outer: [...outerNames].sort((x, y) => y[1] - x[1]).map(([name]) => name).join(' / '),
      distanceM,
      minM: tenth(min),
      maxM: tenth(max),
      rmsM: tenth(Math.sqrt(sum2 / n)),
      degPerMetre: Math.atan(1 / distanceM) * (180 / Math.PI),
    });
  }
  return seams.sort((a, b) => a.distanceM - b.distanceM);
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
