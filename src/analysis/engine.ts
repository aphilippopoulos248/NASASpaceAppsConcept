// Runs analyses in whatever thread it is called from: the Web Worker in the browser, the
// calling thread under Node and in tests. Terrain and the bundled ephemeris tables are loaded
// here (both are cached per thread), so nothing large ever crosses a thread boundary.
import type { Scenario } from '../core/types';
import { loadTerrainFor } from '../terrain/api';
import type { TerrainStack } from '../terrain/types';
import { sampleStack } from './horizon';
import { createNearbyScan, rankNearbyWith, type NearbyProgress } from './nearby';
import { outlookWith } from './outlook';
import { findBundledTable, horizonsEphemeris, tabulatedEphemeris, type Ephemeris, type HorizonsTable } from './sky';
import { withTransitions } from './transitions';
import type { NearbyCandidate, NearbyOptions, Outlook, OutlookOptions, SiteAnalysis } from './types';
import { analyseWith } from './window';

const windowEndMs = (s: Scenario) => s.startMs + s.durationH * 3_600_000;

/** The ephemeris for a scenario's observer (terrain height plus mast): a covering Horizons table, or the model. */
export function siteEphemeris(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null): Ephemeris {
  const site = { lat: scenario.site.lat, lon: scenario.site.lon };
  const ground = sampleStack(stack, site.lat, site.lon).h;
  const obsH = (Number.isFinite(ground) ? ground : 0) + Math.max(0, scenario.mastHeightM);
  // Without a table: the model, tabulated over the window (same directions to 0.0005 deg, a fraction of the cost).
  return table ? horizonsEphemeris(table, site, obsH) : tabulatedEphemeris(site, obsH, scenario.startMs, windowEndMs(scenario));
}

export function runAnalysis(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null): SiteAnalysis {
  const eph = siteEphemeris(scenario, stack, table);
  // Both ends of every rise and set (D-8), from the same ephemeris and skyline.
  return withTransitions(analyseWith(scenario, stack, eph), eph);
}

export function runNearby(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null, options: NearbyOptions, onProgress?: NearbyProgress): NearbyCandidate[] {
  return rankNearbyWith(scenario, stack, siteEphemeris(scenario, stack, table), options, onProgress);
}

/** Hands control back to the event loop once, so queued messages and timers get their turn. */
const nextTask: () => Promise<void> =
  typeof MessageChannel !== 'undefined'
    ? () =>
        new Promise<void>((resolve) => {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => {
            ch.port1.close();
            resolve();
          };
          ch.port2.postMessage(0);
        })
    : () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The nearby scan in slices of about `sliceMs`: between slices progress is reported and other
 * work waiting on this thread (another analysis request, for instance) can run.
 */
export async function runNearbyInSlices(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null, options: NearbyOptions, onProgress?: NearbyProgress, sliceMs = 40): Promise<NearbyCandidate[]> {
  const scan = createNearbyScan(scenario, stack, siteEphemeris(scenario, stack, table), options);
  let more = scan.total > 0;
  let sliceStart = now();
  while (more) {
    more = scan.step();
    if (!more || now() - sliceStart >= sliceMs) {
      onProgress?.(scan.done, scan.total);
      if (more) {
        await nextTask();
        sliceStart = now();
      }
    }
  }
  return scan.result();
}

/** Loads what a scenario needs and analyses it. */
export async function analyseScenario(scenario: Scenario): Promise<SiteAnalysis> {
  const [stack, table] = await Promise.all([loadTerrainFor(scenario.site), findBundledTable(scenario.site, scenario.startMs, windowEndMs(scenario))]);
  return runAnalysis(scenario, stack, table);
}

/** Loads what a scenario needs and scans the alternatives around its site. Candidates reuse the site's own terrain stack. */
export async function nearbyScenario(scenario: Scenario, options: NearbyOptions, onProgress?: NearbyProgress): Promise<NearbyCandidate[]> {
  const [stack, table] = await Promise.all([loadTerrainFor(scenario.site), findBundledTable(scenario.site, scenario.startMs, windowEndMs(scenario))]);
  return runNearbyInSlices(scenario, stack, table, options, onProgress);
}

/** Loads what a scenario needs and computes the seasonal outlook for its site and mast height. */
export async function outlookScenario(scenario: Scenario, options: OutlookOptions = {}): Promise<Outlook> {
  return outlookWith(scenario, await loadTerrainFor(scenario.site), options);
}
