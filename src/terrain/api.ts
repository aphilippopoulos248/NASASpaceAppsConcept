// Entry points for terrain data. Owned by the globe/terrain worker.
// Analysis code asks for a TerrainStack and never touches files or URLs itself.
import type { SiteRef } from '../core/types';
import type { CoverageRegion, HeightGridDescriptor, HeightSource, TerrainStack } from './types';

/** Rebuilds a source from its plain description (used on the far side of a Web Worker boundary). */
export function sourceFromDescriptor(_descriptor: HeightGridDescriptor): HeightSource {
  throw new Error('sourceFromDescriptor is not implemented yet');
}

/**
 * Elevation data around a site, finest first: surveyed site windows where they exist,
 * the polar model near the poles, and the whole-Moon grid underneath.
 */
export function loadTerrainFor(_site: SiteRef): Promise<TerrainStack> {
  return Promise.reject(new Error('loadTerrainFor is not implemented yet'));
}

/** Where each class of elevation data exists, for the coverage display. */
export function coverageRegions(): Promise<CoverageRegion[]> {
  return Promise.reject(new Error('coverageRegions is not implemented yet'));
}
