// Web Worker for analyse(), rankNearby() and outlook(). It receives only the scenario (and options),
// loads terrain and ephemeris tables itself (cached here for later requests) and posts back
// the result; a scan also posts progress and lets other requests run between slices.
import type { Scenario, SiteRef } from '../core/types';
import { analyseScenario, nearbyScenario, nearbyRegions, outlookScenario, type NearbyRegionResult } from './engine';
import type { NearbyCandidate, NearbyOptions, Outlook, OutlookOptions, SiteAnalysis } from './types';

export type WorkerRequestBody =
  | { kind: 'nearby-regions'; centre: SiteRef; sites: SiteRef[]; radiusM: number; slopeLimitDeg: number | null }
  | { kind: 'analyse'; scenario: Scenario }
  | { kind: 'nearby'; scenario: Scenario; options: NearbyOptions }
  | { kind: 'outlook'; scenario: Scenario; options: OutlookOptions };
export type WorkerRequest = WorkerRequestBody & { id: number };

export type WorkerResult = SiteAnalysis | NearbyCandidate[] | Outlook | NearbyRegionResult[];

export type WorkerReply =
  | { id: number; result: WorkerResult }
  | { id: number; progress: { done: number; total: number } }
  | { id: number; error: string };

const post = (m: WorkerReply) => (self as unknown as { postMessage(m: WorkerReply): void }).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const work: Promise<WorkerResult> =
    req.kind === 'nearby-regions'
      ? nearbyRegions(req.centre, req.sites, req.radiusM, req.slopeLimitDeg)
      : req.kind === 'nearby'
      ? nearbyScenario(req.scenario, req.options, (done, total) => post({ id: req.id, progress: { done, total } }))
      : req.kind === 'outlook'
        ? outlookScenario(req.scenario, req.options)
        : analyseScenario(req.scenario);
  work.then(
    (result) => post({ id: req.id, result }),
    (e: unknown) => post({ id: req.id, error: e instanceof Error ? e.message : String(e) }),
  );
};
