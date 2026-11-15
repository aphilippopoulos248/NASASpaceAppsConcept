// Science readouts for one site, gathered from the merged data layers so that the "Site
// science" section and the assistant state the same things with the same sources and caveats:
//   - geometric opportunities with the three DSN complexes over the mission window (analysis.dsn)
//   - the published multi-year average sunlight and Earth visibility (NASA PGDA product 69)
//   - the nearest mapped ice-bearing permanently shaded regions (Lemelin et al. 2021)
//   - the annual maximum and annual mean surface temperature (LRO Diviner; Schorghofer & Williams)
//   - ShadowCam controlled mosaics that cover the site, as credited links (no imagery bundled)
// Each part says what it is, where it comes from and what it must not be mistaken for. A part
// that has no data for the site says so in words: nothing here is filled in.
//
// The first three readouts were written by @globe (T-20, src/core/siteScience.ts) and moved
// here with T-30; their result keys are unchanged.
//
// No DOM: this is what the actions return, and it runs under vitest on the bundled data.
import type { ContactSummary, SiteAnalysis } from '../analysis/types';
import type { AnalysisStatus } from '../core/analysisStore';
import { isoUtc } from '../core/time';
import type { LatLon } from '../core/types';
import { readTerrainJson } from '../terrain/reader';
import { formatDistance, ICE_TARGETS_URL_PATH, nearestIceTargets, parseIceTargets, type IceTargetDistance, type IceTargetLayer } from './iceTargets';
import { loadPolarAverageIndex, polarAverageAt, type PolarAverageReading } from './polarAverages';
import { loadPolarTemperatureIndex, polarTemperatureAt } from './polarTemperatures';
import { loadShadowCam, shadowCamMosaicsAt } from './shadowCam';

const HOUR_MS = 3_600_000;
const DEG = Math.PI / 180;

/** Rounds for display in action results; null when the value does not exist (NaN). */
function rounded(value: number, digits = 2): number | null {
  if (!Number.isFinite(value)) return null;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

const failure = (what: string, err: unknown) => ({ available: false as const, reason: `${what} could not be read (${err instanceof Error ? err.message : String(err)}).` });

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
    return failure('The long-term average maps', err);
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
  const φ1 = from.lat * DEG;
  const φ2 = to.lat * DEG;
  const dλ = (to.lon - from.lon) * DEG;
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
    return failure('The ice-target database', err);
  }
}

// ---------------------------------------------------------------- surface temperature (Diviner)

/**
 * Annual maximum and annual mean surface temperature of the 240 m cell around a point.
 * `status` says which case this is: 'ok', 'empty' (on the map, but the published cell has no
 * value) or 'outside' (not poleward of 80 degrees).
 */
export async function temperatureReadout(site: LatLon) {
  try {
    const [index, r] = await Promise.all([loadPolarTemperatureIndex(), polarTemperatureAt(site.lat, site.lon)]);
    return {
      available: r.status === 'ok',
      status: r.status,
      annualMaxK: r.annualMaxK,
      annualMeanK: r.annualMeanK,
      cellM: r.cellM,
      /** Span of the Diviner measurements behind the values. */
      measuredOver: r.period,
      text: r.text,
      kind: 'Annual maximum and annual mean of the surface temperature, from many years of LRO Diviner measurements: not the temperature at the simulated date or during the mission window.',
      notIncluded: index.notIncluded,
      caveats: index.caveats,
      citation: index.citation,
      licence: index.licence,
    };
  } catch (err) {
    return failure('The Diviner temperature maps', err);
  }
}

// ---------------------------------------------------------------- ShadowCam

/** ShadowCam controlled mosaics whose published footprint covers a point, newest images first: links, not pictures. */
export async function shadowCamReadout(site: LatLon) {
  try {
    const [layer, r] = await Promise.all([loadShadowCam(), shadowCamMosaicsAt(site.lat, site.lon)]);
    const { index } = layer;
    return {
      available: r.hits.length > 0,
      mosaics: r.hits.map(({ mosaic: m, label, url, text }) => ({
        id: m.id,
        productId: m.productId,
        site: m.site,
        label,
        text,
        /** The product's folder in the ShadowCam PDS archive. */
        url,
        season: m.season,
        localTime: m.localTime,
        imagesFrom: m.imageStart,
        imagesTo: m.imageStop,
        pixelScaleM: m.pixelScaleM,
        ...(m.sourceDisagreements && { archiveDisagreements: m.sourceDisagreements }),
      })),
      text: r.text,
      /** The app holds an index and links only. */
      imagesBundled: false as const,
      credit: r.credit,
      creditNote: index.creditNote,
      licence: index.licence,
      citation: index.citation,
      archiveUrl: index.archive.url,
      mosaicsInIndex: index.mosaics.length,
      coverageMeaning: `"Covers" is decided on a ${index.coverage.cellM} m grid sampled from each mosaic's published footprint, which follows the image strips and their gaps: within ${index.coverage.cellM} m of an edge it can be off either way.`,
    };
  } catch (err) {
    return failure('The ShadowCam mosaic index', err);
  }
}

// ---------------------------------------------------------------- all of it

export type DsnReadout = ReturnType<typeof dsnReadout>;
export type AveragesReadout = Awaited<ReturnType<typeof averagesReadout>>;
export type IceReadout = Awaited<ReturnType<typeof iceReadout>>;
export type TemperatureReadout = Awaited<ReturnType<typeof temperatureReadout>>;
export type ShadowCamReadout = Awaited<ReturnType<typeof shadowCamReadout>>;

export interface SiteScience {
  dsn: DsnReadout;
  longTermAverages: AveragesReadout;
  iceTargets: IceReadout;
  surfaceTemperature: TemperatureReadout;
  shadowCam: ShadowCamReadout;
  /** What a reader might expect here and will not find. */
  notIncluded: string[];
}

export const NOT_INCLUDED = [
  'Diviner temperatures are annual values: separate summer and winter maps are not included.',
  'ShadowCam images are not bundled with the app: where a mosaic covers the site, the readout links to the product in the ShadowCam PDS archive.',
];

/** Every readout for a site. The DSN part comes from the analysis handed in; the others are read from the bundled layers. */
export async function siteScience(site: LatLon, analysis: AnalysisStatus): Promise<SiteScience> {
  const [longTermAverages, iceTargets, surfaceTemperature, shadowCam] = await Promise.all([averagesReadout(site), iceReadout(site), temperatureReadout(site), shadowCamReadout(site)]);
  return { dsn: dsnReadout(analysis), longTermAverages, iceTargets, surfaceTemperature, shadowCam, notIncluded: NOT_INCLUDED };
}
