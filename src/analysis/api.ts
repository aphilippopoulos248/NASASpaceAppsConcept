// Entry points of the science core. UI, comparison and assistant code call ONLY these
// (plus the types in ./types). Owned by the ephemeris/analysis worker.
//
// Until an implementation lands each function throws NotImplemented, which callers
// surface as "analysis unavailable" rather than showing placeholder numbers.
import type { LatLon, Scenario } from '../core/types';
import type { Blockage, ComparisonDiff, NearbyCandidate, NearbyOptions, SiteAnalysis, SkyEvent, SkyInstant } from './types';

export class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not implemented yet`);
    this.name = 'NotImplemented';
  }
}

/** Sun and Earth as seen from a site at one instant (topocentric, airless). Synchronous: cheap enough to call every frame. */
export function skyAt(_site: LatLon, _elevationM: number, _timeMs: number): SkyInstant {
  throw new NotImplemented('skyAt');
}

/** Full analysis of a scenario: skyline, Sun/Earth series, metrics, events, slope. Cached per scenario; heavy work runs off the main thread. */
export function analyse(_scenario: Scenario): Promise<SiteAnalysis> {
  return Promise.reject(new NotImplemented('analyse'));
}

/** Why the Sun or Earth is hidden (or how much it clears the skyline by) at an instant. */
export function blockageAt(_analysis: SiteAnalysis, _body: 'sun' | 'earth', _timeMs: number): Blockage {
  throw new NotImplemented('blockageAt');
}

/** The next rise and set of each body after an instant, within the analysed window (null when none occurs in it). */
export function nextEvents(_analysis: SiteAnalysis, _timeMs: number): Record<SkyEvent['type'], SkyEvent | null> {
  throw new NotImplemented('nextEvents');
}

/** Scans alternatives around the scenario's site and ranks those within the slope limit. */
export function rankNearby(_scenario: Scenario, _options: NearbyOptions): Promise<NearbyCandidate[]> {
  return Promise.reject(new NotImplemented('rankNearby'));
}

/** Differences B - A between two analyses, with the headline differences in words. */
export function compareAnalyses(_a: SiteAnalysis, _b: SiteAnalysis): ComparisonDiff {
  throw new NotImplemented('compareAnalyses');
}
