// Measurements of one candidate for the decision engine (decision D-17): the window metrics of
// the app's own analysis and the landing-region terrain, turned into the six criterion values,
// each with what it rests on. Nothing is estimated: a value that was not measured is null, with
// the reason, and its criterion can then only be 'unknown' against a threshold.

import type { WindowMetrics } from '../types';
import type { MeasurementInput } from './api';
import { CRITERION_DEFS } from './criteria';
import type { CriterionId, MeasuredValue, RegionTerrain, SiteMetrics } from './types';

const UNIT = Object.fromEntries(CRITERION_DEFS.map((d) => [d.id, d.unit])) as Record<CriterionId, MeasuredValue['unit']>;

const NO_SKYLINE = 'No terrain skyline could be computed for this site (no elevation data around it), so the time-based values are not available.';
const NO_REGION = 'No landing-region terrain was measured for this site.';

/** What each time-based value is, for its basis sentence. */
const TIME_WHAT: Record<'sunlight' | 'darkness' | 'earthVisibility' | 'commBlackout', string> = {
  sunlight: "Time-averaged visible fraction of the Sun's disc against the terrain skyline",
  darkness: "Longest spell with the Sun's disc wholly hidden inside the window",
  earthVisibility: "Share of the window with a line of sight to Earth's centre over the terrain skyline (geometry, not a link budget)",
  commBlackout: "Longest spell without a line of sight to Earth's centre inside the window (geometry, not a link budget)",
};

const hoursText = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
const latLonText = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(4)}° ${lon < 0 ? 'W' : 'E'}`;

/** Builds the six measured values, with bounds, basis and missing reasons. Never fills a gap with a guess. */
export function siteMetrics(input: MeasurementInput): SiteMetrics {
  const { site, window, mastHeightM, metrics, region, provenance, basisNote } = input;
  const when = `mission window from ${window.startUtc} for ${hoursText(window.durationH)}, observer ${mastHeightM} m above the ground`;
  const tail = [...provenance, ...(basisNote ? [basisNote] : [])].join(' ');

  const timed = (id: keyof typeof TIME_WHAT, value: number | undefined, openEnded = false): MeasuredValue => {
    const bounded = openEnded && value !== undefined && Number.isFinite(value) && value > 0;
    const what = bounded ? `${TIME_WHAT[id]}, which runs into an edge of the window, so the value is a lower bound` : TIME_WHAT[id];
    const basis = `${what}; ${when}.${tail ? ` ${tail}` : ''}`;
    if (!metrics) return { value: null, unit: UNIT[id], basis, missingReason: NO_SKYLINE };
    if (value === undefined || !Number.isFinite(value)) return { value: null, unit: UNIT[id], basis, missingReason: 'The analysis did not produce this value (see its warnings).' };
    return { value, unit: UNIT[id], ...(bounded && { bound: 'lower' as const }), basis };
  };

  const m: WindowMetrics | null = metrics;
  const values: Record<CriterionId, MeasuredValue> = {
    sunlight: timed('sunlight', m?.illuminationPct),
    darkness: timed('darkness', m?.longestDarknessH, m?.darknessOpenEnded),
    earthVisibility: timed('earthVisibility', m?.earthVisiblePct),
    commBlackout: timed('commBlackout', m?.longestEarthGapH, m?.earthGapOpenEnded),
    slope: regional('slope', region),
    roughness: regional('roughness', region),
  };

  return {
    site,
    window: { startUtc: window.startUtc, durationH: window.durationH },
    mastHeightM,
    values,
    provenance: [
      ...provenance,
      ...(basisNote ? [basisNote] : []),
      ...(region ? [`Landing region: ${region.radiusM} m around ${latLonText(region.lat, region.lon)}, measured on ${region.demName} (${region.gridSpacingM} m grid, ${region.samples} samples).`] : []),
    ],
  };
}

function regional(id: 'slope' | 'roughness', region: RegionTerrain | null): MeasuredValue {
  const what = id === 'slope' ? 'Ground slope' : 'Roughness (hazard proxy)';
  if (!region) return { value: null, unit: UNIT[id], basis: `${what} over the landing region.`, missingReason: NO_REGION };
  const notes = region.notes.join(' ');
  const basis = `${what} over the landing region of ${region.radiusM} m radius around ${latLonText(region.lat, region.lon)}, from ${region.demName} (${region.gridSpacingM} m grid, ${region.samples} samples).${notes ? ` ${notes}` : ''}`;
  const value = id === 'slope' ? region.slopeDeg : region.roughnessM;
  if (value === null || !Number.isFinite(value)) {
    return { value: null, unit: UNIT[id], basis, missingReason: notes || `The ${region.gridSpacingM} m grid cannot support this value over a ${region.radiusM} m region.` };
  }
  return { value, unit: UNIT[id], basis };
}
