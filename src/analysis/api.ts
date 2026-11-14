// Entry points of the science core. UI, comparison and assistant code call ONLY these
// (plus the types in ./types). Owned by the ephemeris/analysis worker.
//
// Functions not yet implemented throw NotImplemented, which callers surface as
// "analysis unavailable" rather than showing placeholder numbers.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { loadTerrainFor } from '../terrain/api';
import type { Blockage, ComparisonDiff, NearbyCandidate, NearbyOptions, SiteAnalysis, SkyEvent } from './types';
import { findBundledTable, type HorizonsTable } from './sky';
import { runAnalysis } from './engine';
import * as win from './window';

export { skyAt } from './sky';

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplemented';
  }
}

/** Key that identifies everything an analysis depends on. */
export function scenarioKey(s: Scenario): string {
  return [s.site.lat.toFixed(6), s.site.lon.toFixed(6), s.mastHeightM, s.startMs, s.durationH, s.stepMin].join('|');
}

const cache = new Map<string, Promise<SiteAnalysis>>();
const CACHE_MAX = 32;

// ---------- worker plumbing (browser only) ----------
let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, { resolve: (a: SiteAnalysis) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (ev: MessageEvent<{ id: number; result?: SiteAnalysis; error?: string }>) => {
        const p = pending.get(ev.data.id);
        if (!p) return;
        pending.delete(ev.data.id);
        if (ev.data.result) p.resolve(ev.data.result);
        else p.reject(new Error(ev.data.error ?? 'analysis worker failed'));
      };
      worker.onerror = () => {
        workerBroken = true;
        for (const [, p] of pending) p.reject(new Error('analysis worker crashed'));
        pending.clear();
      };
    } catch {
      workerBroken = true;
      return null;
    }
  }
  return worker;
}

function inWorker(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null): Promise<SiteAnalysis> | null {
  const w = getWorker();
  if (!w) return null;
  const id = nextId++;
  return new Promise<SiteAnalysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, scenario, descriptors: stack.sources.map((s) => s.descriptor), notes: stack.notes, table });
  });
}

/** Runs the analysis off the main thread when possible, inline otherwise (Node, tests, or a worker failure). */
export async function analyseStack(scenario: Scenario, stack: TerrainStack): Promise<SiteAnalysis> {
  const endMs = scenario.startMs + scenario.durationH * 3_600_000;
  const table = await findBundledTable(scenario.site, scenario.startMs, endMs);
  const viaWorker = inWorker(scenario, stack, table);
  if (viaWorker) {
    try {
      return await viaWorker;
    } catch {
      // e.g. terrain sources that cannot be rebuilt in the worker: compute here instead.
    }
  }
  return runAnalysis(scenario, stack, table);
}

/** Full analysis of a scenario: skyline, Sun/Earth series, metrics, events, slope. Cached per scenario; heavy work runs off the main thread. */
export function analyse(scenario: Scenario): Promise<SiteAnalysis> {
  if (!(scenario.durationH > 0) || !(scenario.stepMin > 0) || !Number.isFinite(scenario.startMs)) {
    return Promise.reject(new RangeError('analyse: the window needs a start time, a positive duration and a positive step'));
  }
  const key = scenarioKey(scenario);
  let p = cache.get(key);
  if (!p) {
    p = loadTerrainFor(scenario.site).then((stack) => analyseStack(scenario, stack));
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  }
  // Keep the caller's labels even when the result came from the cache.
  return p.then((a) => (a.scenario === scenario ? a : { ...a, scenario }));
}

/** Why the Sun or Earth is hidden (or how much it clears the skyline by) at an instant. */
export function blockageAt(analysis: SiteAnalysis, body: 'sun' | 'earth', timeMs: number): Blockage {
  return win.blockageAt(analysis, body, timeMs);
}

/** The next rise and set of each body after an instant, within the analysed window (null when none occurs in it). */
export function nextEvents(analysis: SiteAnalysis, timeMs: number): Record<SkyEvent['type'], SkyEvent | null> {
  return win.nextEvents(analysis, timeMs);
}

/** Scans alternatives around the scenario's site and ranks those within the slope limit. */
export function rankNearby(_scenario: Scenario, _options: NearbyOptions): Promise<NearbyCandidate[]> {
  return Promise.reject(new NotImplemented('rankNearby'));
}

/** Differences B - A between two analyses, with the headline differences in words. */
export function compareAnalyses(a: SiteAnalysis, b: SiteAnalysis): ComparisonDiff {
  return win.compareAnalyses(a, b);
}
