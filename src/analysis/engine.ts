// Runs one analysis given plain inputs: what both the inline path and the Web Worker call.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { horizonsEphemeris, modelEphemeris, type HorizonsTable } from './sky';
import { sampleStack } from './horizon';
import { analyseWith } from './window';
import type { SiteAnalysis } from './types';

export function runAnalysis(scenario: Scenario, stack: TerrainStack, table: HorizonsTable | null): SiteAnalysis {
  const site = { lat: scenario.site.lat, lon: scenario.site.lon };
  const ground = sampleStack(stack, site.lat, site.lon).h;
  const obsH = (Number.isFinite(ground) ? ground : 0) + Math.max(0, scenario.mastHeightM);
  const eph = table ? horizonsEphemeris(table, site, obsH) : modelEphemeris(site, obsH);
  return analyseWith(scenario, stack, eph);
}
