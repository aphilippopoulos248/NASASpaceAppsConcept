// Entry points of the science core. UI, comparison and assistant code call ONLY these
// (plus the types in ./types). Owned by the ephemeris/analysis worker.
//
// analyse() and rankNearby() do their heavy work in a Web Worker when the browser provides
// one and on the calling thread otherwise (Node, tests, or a worker that fails to start).
// A rejection means "analysis unavailable" with the reason; nothing here returns placeholder numbers.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { analyseScenario, nearbyScenario, runAnalysis, runNearbyInSlices } from './engine';
import type { NearbyProgress } from './nearby';
import { findBundledTable } from './sky';
import { dsnInstant } from './dsn';
import type { Blockage, ComparisonDiff, NearbyCandidate, NearbyOptions, SiteAnalysis, SkyEvent, StationInstant } from './types';
import * as win from './window';
import type { WorkerReply, WorkerRequestBody } from './worker';

export { DEFAULT_NEARBY_OPTIONS, type NearbyProgress } from './nearby';
export { skyAt } from './sky';

/** Kept for callers that test for it: every entry point is implemented. */
export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplemented';
  }
}

/** Key that identifies everything an analysis depends on (labels are not part of it). */
export function scenarioKey(s: Scenario): string {
  return [s.site.kind, s.site.id, s.site.lat.toFixed(6), s.site.lon.toFixed(6), s.mastHeightM, s.startMs, s.durationH, s.stepMin].join('|');
}

const windowEndMs = (s: Scenario) => s.startMs + s.durationH * 3_600_000;

function checkWindow(what: string, s: Scenario): void {
  if (!Number.isFinite(s.startMs) || !(s.durationH > 0) || !(s.stepMin > 0)) throw new RangeError(`${what}: the window needs a start time, a positive duration and a positive step`);
  if (!Number.isFinite(s.site.lat) || !Number.isFinite(s.site.lon) || Math.abs(s.site.lat) > 90) throw new RangeError(`${what}: the site needs a latitude within -90..90 and a longitude`);
  if (s.durationH / (s.stepMin / 60) > 200_000) throw new RangeError(`${what}: more than 200 000 time samples; use a longer step for a window this long`);
}

// ---------- worker plumbing (browser only) ----------

/** The worker itself failed (could not start, or crashed): the work is then done on the calling thread instead. */
class WorkerFailure extends Error {}

type Pending = { resolve: (value: SiteAnalysis | NearbyCandidate[]) => void; reject: (e: Error) => void; progress?: NearbyProgress };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
        const msg = ev.data;
        const p = pending.get(msg.id);
        if (!p) return;
        if ('progress' in msg) {
          p.progress?.(msg.progress.done, msg.progress.total);
          return;
        }
        pending.delete(msg.id);
        if ('result' in msg) p.resolve(msg.result);
        else p.reject(new Error(msg.error || 'the analysis failed'));
      };
      worker.onerror = () => {
        workerBroken = true;
        worker = null;
        const waiting = [...pending.values()];
        pending.clear();
        for (const p of waiting) p.reject(new WorkerFailure('the analysis worker stopped'));
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

/** Sends a request to the worker; null when there is no worker to send it to. */
function viaWorker<T extends SiteAnalysis | NearbyCandidate[]>(request: WorkerRequestBody, progress?: NearbyProgress): Promise<T> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as Pending['resolve'], reject, progress });
    try {
      w.postMessage({ ...request, id });
    } catch (e) {
      pending.delete(id);
      reject(new WorkerFailure(e instanceof Error ? e.message : String(e)));
    }
  });
}

/** Worker first; the calling thread when there is no worker or the worker itself failed. */
function offThread<T extends SiteAnalysis | NearbyCandidate[]>(request: WorkerRequestBody, inline: () => Promise<T>, progress?: NearbyProgress): Promise<T> {
  const sent = viaWorker<T>(request, progress);
  if (!sent) return inline();
  return sent.catch((e: unknown) => (e instanceof WorkerFailure ? inline() : Promise.reject(e)));
}

// ---------- analysis ----------

/** True when the terrain module reported that a file or an on-request window could not be obtained. */
function terrainIncomplete(a: SiteAnalysis): boolean {
  return (a.provenance.terrainNotes ?? []).some((note) => /could not/i.test(note));
}

const cache = new Map<string, Promise<SiteAnalysis>>();
const CACHE_MAX = 32;

/** Full analysis of a scenario: skyline, Sun/Earth series, metrics, events, slope. Cached per scenario; heavy work runs off the main thread. */
export function analyse(scenario: Scenario): Promise<SiteAnalysis> {
  try {
    checkWindow('analyse', scenario);
  } catch (e) {
    return Promise.reject(e);
  }
  const key = scenarioKey(scenario);
  let p = cache.get(key);
  if (p) {
    // Most recently used last.
    cache.delete(key);
    cache.set(key, p);
  } else {
    p = offThread<SiteAnalysis>({ kind: 'analyse', scenario }, () => analyseScenario(scenario));
    const mine = p;
    const forget = () => {
      if (cache.get(key) === mine) cache.delete(key);
    };
    // A failure is not remembered, and neither is a result computed while some elevation data could not be
    // fetched (the terrain module says so in its notes): asking again should get the chance to do better.
    p.then((a) => {
      if (terrainIncomplete(a)) forget();
    }, forget);
    cache.set(key, p);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  // Keep the caller's own scenario object (its label may differ) even when the numbers came from the cache.
  return p.then((a) => (a.scenario === scenario ? a : { ...a, scenario }));
}

/** Analysis with terrain the caller already holds (tools and tests); runs on the calling thread and is not cached. */
export async function analyseStack(scenario: Scenario, stack: TerrainStack): Promise<SiteAnalysis> {
  checkWindow('analyse', scenario);
  return runAnalysis(scenario, stack, await findBundledTable(scenario.site, scenario.startMs, windowEndMs(scenario)));
}

/** Forgets cached results (tests; or after the terrain data changed). */
export function clearAnalysisCache(): void {
  cache.clear();
  nearbyCache.clear();
}

/** Why the Sun or Earth is hidden (or how much it clears the skyline by) at an instant. */
export function blockageAt(analysis: SiteAnalysis, body: 'sun' | 'earth', timeMs: number): Blockage {
  return win.blockageAt(analysis, body, timeMs);
}

/** The next rise and set of each body after an instant, within the analysed window (null when none occurs in it). */
export function nextEvents(analysis: SiteAnalysis, timeMs: number): Record<SkyEvent['type'], SkyEvent | null> {
  return win.nextEvents(analysis, timeMs);
}

/**
 * Extension: each Deep Space Network station at an instant, for an analysed site: the site's
 * elevation at the station, the station's clearance above the site's skyline, and whether the
 * straight line is open with the receive / transmit elevation limits. Geometry only, not a link.
 * The spans over the whole window are in `analysis.dsn`.
 */
export function dsnAt(analysis: SiteAnalysis, timeMs: number): StationInstant[] {
  return dsnInstant(analysis, timeMs);
}

/** Differences B - A between two analyses, with the headline differences in words. */
export function compareAnalyses(a: SiteAnalysis, b: SiteAnalysis): ComparisonDiff {
  return win.compareAnalyses(a, b);
}

// ---------- nearby alternatives ----------

const nearbyCache = new Map<string, Promise<NearbyCandidate[]>>();
const NEARBY_CACHE_MAX = 4;

/**
 * Scans alternatives around the scenario's site and ranks those within the slope limit.
 * The scenario's own site is always included (isReference). `onProgress(done, total)` reports
 * candidates analysed. The scan uses coarser settings than analyse() (DEFAULT_NEARBY_OPTIONS;
 * each candidate's `basis` says which) and the site's own terrain data for every candidate.
 * The last few scans are remembered, so asking again with the same scenario and options is free.
 */
export function rankNearby(scenario: Scenario, options: NearbyOptions, onProgress?: NearbyProgress): Promise<NearbyCandidate[]> {
  try {
    checkWindow('rankNearby', scenario);
  } catch (e) {
    return Promise.reject(e);
  }
  const key = `${scenarioKey(scenario)}|${JSON.stringify(Object.entries(options).sort(([a], [b]) => (a < b ? -1 : 1)))}`;
  let p = nearbyCache.get(key);
  if (p) {
    nearbyCache.delete(key);
    nearbyCache.set(key, p);
    if (onProgress) void p.then((rows) => onProgress(rows.length, rows.length), () => undefined);
    return p;
  }
  p = offThread<NearbyCandidate[]>({ kind: 'nearby', scenario, options }, () => nearbyScenario(scenario, options, onProgress), onProgress);
  p.catch(() => {
    if (nearbyCache.get(key) === p) nearbyCache.delete(key);
  });
  nearbyCache.set(key, p);
  if (nearbyCache.size > NEARBY_CACHE_MAX) nearbyCache.delete(nearbyCache.keys().next().value as string);
  return p;
}

/** The scan with terrain the caller already holds (tools and tests); runs on the calling thread and is not cached. */
export async function rankNearbyStack(scenario: Scenario, stack: TerrainStack, options: NearbyOptions, onProgress?: NearbyProgress): Promise<NearbyCandidate[]> {
  checkWindow('rankNearby', scenario);
  return runNearbyInSlices(scenario, stack, await findBundledTable(scenario.site, scenario.startMs, windowEndMs(scenario)), options, onProgress);
}
