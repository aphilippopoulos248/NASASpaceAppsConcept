// Web Worker for analyse() and rankNearby(). It receives only the scenario (and options),
// loads terrain and ephemeris tables itself (cached here for later requests) and posts back
// the result; a scan also posts progress and lets other requests run between slices.
import type { Scenario } from '../core/types';
import { analyseScenario, nearbyScenario } from './engine';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis } from './types';

export type WorkerRequestBody =
  | { kind: 'analyse'; scenario: Scenario }
  | { kind: 'nearby'; scenario: Scenario; options: NearbyOptions };
export type WorkerRequest = WorkerRequestBody & { id: number };

export type WorkerReply =
  | { id: number; result: SiteAnalysis | NearbyCandidate[] }
  | { id: number; progress: { done: number; total: number } }
  | { id: number; error: string };

const post = (m: WorkerReply) => (self as unknown as { postMessage(m: WorkerReply): void }).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const work: Promise<SiteAnalysis | NearbyCandidate[]> =
    req.kind === 'nearby'
      ? nearbyScenario(req.scenario, req.options, (done, total) => post({ id: req.id, progress: { done, total } }))
      : analyseScenario(req.scenario);
  work.then(
    (result) => post({ id: req.id, result }),
    (e: unknown) => post({ id: req.id, error: e instanceof Error ? e.message : String(e) }),
  );
};
