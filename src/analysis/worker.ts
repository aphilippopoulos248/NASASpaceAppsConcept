// Web Worker for the heavy parts of analyse() and rankNearby(): rebuilds the terrain
// sources from their plain descriptors, then runs the same code as the inline path.
import { sourceFromDescriptor } from '../terrain/api';
import type { Scenario } from '../core/types';
import type { HeightGridDescriptor } from '../terrain/types';
import type { HorizonsTable } from './sky';
import type { NearbyOptions } from './types';
import { runAnalysis, runNearby } from './engine';

export interface WorkerRequest {
  id: number;
  kind: 'analyse' | 'nearby';
  scenario: Scenario;
  descriptors: HeightGridDescriptor[];
  notes: string[];
  table: HorizonsTable | null;
  options?: NearbyOptions;
}

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, kind, scenario, descriptors, notes, table, options } = ev.data;
  try {
    const stack = { sources: descriptors.map((d) => sourceFromDescriptor(d)), notes };
    const result = kind === 'nearby'
      ? runNearby(scenario, stack, table, options!, (done, total) => post({ id, progress: { done, total } }))
      : runAnalysis(scenario, stack, table);
    post({ id, result });
  } catch (e) {
    post({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
