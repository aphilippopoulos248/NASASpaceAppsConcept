// Science readouts for one site, gathered from the merged data layers so that the site card
// and the assistant state the same things with the same sources and caveats:
//   - geometric opportunities with the three DSN complexes over the mission window (analysis.dsn)
//   - the published multi-year average sunlight and Earth visibility (NASA PGDA product 69)
//   - the nearest mapped ice-bearing permanently shaded regions (Lemelin et al. 2021)
// Each part says what it is, where it comes from and what it must not be mistaken for. A part
// that has no data for the site says so in words: nothing here is filled in.
import type { ContactSummary, SiteAnalysis } from '../analysis/types';
import { formatDistance, ICE_TARGETS_URL_PATH, nearestIceTargets, parseIceTargets, type IceTargetDistance, type IceTargetLayer } from '../science/iceTargets';
import { loadPolarAverageIndex, polarAverageAt, type PolarAverageReading } from '../science/polarAverages';
import { readTerrainJson } from '../terrain/reader';
import { rounded, type AnalysisStatus } from './analysisStore';
import { isoUtc } from './time';
import type { LatLon } from './types';

const HOUR_MS = 3_600_000;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- DSN

function contact(c: ContactSummary) {
  return { pctOfWindow: rounded(c.pct, 1), longestGapH: rounded(c.longestGapH), gapRunsIntoWindowEdge: c.gapOpenEnded };
}

/** Geometric opportunities with the DSN stations over the analysed window, or why there are none to state. */
export function dsnReadout(st: AnalysisStatus) {
  if (st.state === 'idle') return { available: false as const, reason: 'No site is selected.' };
  if (st.state === 'loading') return { available: false as const, reason: 'The site analysis has not finished.' };
  if (st.state === 'error') return { available: false as const, reason: `The site analysis is not available: ${st.error}` };
  const a: SiteAnalysis = st.value;
  if (!a.dsn) return { available: false as const, reason: 'No skyline could be computed for this site, so station geometry is not available.' };
  return {
    available: true as const,
    windowStartUtc: isoUtc(st.scenario.startMs),
    windowEndUtc: isoUtc(st.scenario.startMs + st.scenario.durationH * HOUR_MS),
    windowDurationH: st.scenario.durationH,
    /** Receive: the site is above the station's receive elevation limit and the station is above the site's terrain skyline. */
    stations: a.dsn.stations.map((s) => ({
      id: s.station.id,
      name: s.station.name,
      complex: s.station.complex,
      receive: contact(s.receive),
      transmit: contact(s.transmit),
      receiveLimitDeg: s.station.receiveMaskDeg,
      transmitLimitDeg: s.station.transmitMaskDeg,
    })),
    anyStation: { receive: contact(a.dsn.anyReceive), transmit: contact(a.dsn.anyTransmit) },
    meaning: 'Geometric line of sight only: not a link budget, not a schedule, not antenna availability.',
    assumptions: a.dsn.assumptions,
  };
}

// ---------------------------------------------------------------- long-term averages

function reading(r: PolarAverageReading) {
  return { available: r.available, pctOfTime: r.percent, neverInModel: r.neverLit, cellM: r.cellM, source: r.sourceProduct, text: r.text };
}

/** The published multi-year averages at a point. Never to be mixed with the dated window numbers. */
export async function averagesReadout(site: LatLon) {
  try {
    const [index, sunlight, earth] = await Promise.all([loadPolarAverageIndex(), polarAverageAt('illumination', site.lat, site.lon), polarAverageAt('earth-visibility', site.lat, site.lon)]);
    return {
      available: sunlight.available || earth.available,
      sunlight: reading(sunlight),
      earthVisibility: reading(earth),
      kind: 'Multi-year average of a model (18.6 years of hourly steps), not the geometry of the simulated date or of the mission window.',
      averagingPeriod: index.averagingPeriod,
      caveats: index.caveats,
      citation: index.citation,
    };
  } catch (err) {
    return { available: false as const, reason: `The long-term average maps could not be read (${err instanceof Error ? err.message : String(err)}).` };
  }
}

// ---------------------------------------------------------------- ice targets

let iceLayer: Promise<IceTargetLayer> | null = null;

/** The mapped ice-bearing permanently shaded regions (loaded once; read like the other bundled data, so it also works outside a browser). */
export function iceTargetLayer(): Promise<IceTargetLayer> {
  if (!iceLayer) {
    iceLayer = readTerrainJson<unknown>(ICE_TARGETS_URL_PATH).then(parseIceTargets);
    iceLayer.catch(() => (iceLayer = null));
  }
  return iceLayer;
}

/** Initial compass bearing from one point to another, degrees clockwise from north. */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const φ1 = from.lat * DEG, φ2 = to.lat * DEG, dλ = (to.lon - from.lon) * DEG;
  const b = Math.atan2(Math.sin(dλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ)) / DEG;
  return (b + 360) % 360;
}

function target(site: LatLon, d: IceTargetDistance) {
  const t = d.target;
  const objectives = (['highest', 'lateral', 'vertical', 'fastest'] as const).filter((k) => t.objectives[k]);
  return {
    id: t.id,
    label: t.label,
    distanceKm: rounded(d.distanceKm),
    distanceText: formatDistance(d),
    /** True when the point lies inside the mapped outline (which is about 0.3 km wider than the listed shadowed area). */
    insideOutline: d.inside,
    bearingDeg: d.inside ? null : rounded(bearingDeg(site, d.nearest), 0),
    nearestPoint: { latDeg: rounded(d.nearest.lat, 4), lonDegEast: rounded(d.nearest.lon, 4) },
    measuredTo: d.measuredTo,
    listedAreaKm2: t.areaKm2 === null ? null : rounded(t.areaKm2, 3),
    /** Objectives the authors flagged the region as best suited for. */
    objectives,
    ...(t.flags.length && { dataFlags: t.flags }),
  };
}

export const ICE_DISTANCE_NOTE = 'Straight-line distance over a 1737.4 km sphere to the nearest edge of the mapped outline (0 inside): not a traverse, it ignores terrain, slope and lighting.';

/** The nearest mapped ice-bearing shadowed regions to a point, nearest first. */
export async function iceReadout(site: LatLon, count = 3, maxKm = 500) {
  try {
    const layer = await iceTargetLayer();
    const nearest = nearestIceTargets(layer.targets, site, { limit: count, maxKm });
    return {
      available: true as const,
      nearest: nearest.map((d) => target(site, d)),
      ...(nearest.length === 0 && { note: `No mapped region lies within ${maxKm} km: the database covers the south polar region only.` }),
      mappedRegions: layer.targets.length,
      distanceMeaning: ICE_DISTANCE_NOTE,
      whatTheseAre: 'Permanently shaded regions with water-ice signatures in the south polar region, as mapped by the authors: targets of interest, not confirmed deposits at any one spot.',
      dataNotes: layer.geometryNotes,
      credit: `${layer.attribution.citation} Licence: ${layer.attribution.license} (${layer.attribution.licenseUrl}).`,
    };
  } catch (err) {
    return { available: false as const, reason: `The ice-target database could not be read (${err instanceof Error ? err.message : String(err)}).` };
  }
}

// ---------------------------------------------------------------- all of it

export type DsnReadout = ReturnType<typeof dsnReadout>;
export type AveragesReadout = Awaited<ReturnType<typeof averagesReadout>>;
export type IceReadout = Awaited<ReturnType<typeof iceReadout>>;

export interface SiteScience {
  dsn: DsnReadout;
  longTermAverages: AveragesReadout;
  iceTargets: IceReadout;
  notIncluded: string[];
}

export async function siteScience(site: LatLon, analysis: AnalysisStatus): Promise<SiteScience> {
  const [longTermAverages, iceTargets] = await Promise.all([averagesReadout(site), iceReadout(site)]);
  return {
    dsn: dsnReadout(analysis),
    longTermAverages,
    iceTargets,
    notIncluded: ['Diviner seasonal temperatures and ShadowCam imagery are not packaged in this build.'],
  };
}
