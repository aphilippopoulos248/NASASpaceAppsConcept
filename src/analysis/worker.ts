// Web Worker for the heavy part of analyse(): rebuilds the terrain sources from their
// plain descriptors, then runs the same code as the inline path.
import { sourceFromDescriptor } from '../terrain/api';
import type { Scenario } from '../core/types';
import type { HeightGridDescriptor } from '../terrain/types';
import type { HorizonsTable } from './sky';
import { runAnalysis } from './engine';

export interface WorkerRequest {
  id: number;
  scenario: Scenario;
  descriptors: HeightGridDescriptor[];
  notes: string[];
  table: HorizonsTable | null;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, scenario, descriptors, notes, table } = ev.data;
  try {
    const stack = { sources: descriptors.map((d) => sourceFromDescriptor(d)), notes };
    const result = runAnalysis(scenario, stack, table);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
