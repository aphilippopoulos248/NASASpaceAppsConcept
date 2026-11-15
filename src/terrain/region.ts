// Landing-region terrain metrics for the decision engine (decision D-17).
// Contract stubs by the coordinator; @surface replaces the bodies (T-72).

import type { LatLon, SiteRef } from '../core/types';
import type { RegionTerrain, TerrainStack } from './types';

/** Thrown by a stub that is not implemented yet. */
class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not part of this build yet (decision engine, T-72).`);
    this.name = 'NotImplemented';
  }
}

/**
 * Slope and roughness over the disc of `radiusM` around `center`, from the finest grid of `stack`
 * that covers the whole disc. Pure given the stack. Values the grid cannot support are null, with
 * the reason in `notes` (e.g. roughness on a 1.9 km grid). `slopeLimitDeg` only feeds hazardFraction.
 */
export function regionTerrainMetrics(stack: TerrainStack, center: LatLon, radiusM: number, slopeLimitDeg: number | null): RegionTerrain {
  void stack;
  void center;
  void radiusM;
  void slopeLimitDeg;
  throw new NotImplemented('regionTerrainMetrics');
}

/** Loads the terrain stack for the site (as the analysis does) and measures its landing region. */
export function loadRegionTerrain(site: SiteRef, radiusM: number, slopeLimitDeg: number | null): Promise<RegionTerrain> {
  void site;
  void radiusM;
  void slopeLimitDeg;
  return Promise.reject(new NotImplemented('loadRegionTerrain'));
}
