// Analysis results as small JSON objects for action results (getAnalysis, compare): what the
// assistant reads and may quote. Units are in the key names; times are UTC; longitudes are
// east-positive; a number that does not exist is null, never a stand-in value.
//
// Everything here is copied or rounded from the science core's output (src/analysis/types.ts).
import { blockageAt as realBlockageAt, nextEvents as realNextEvents } from '../analysis/api';
import type { Blockage, ComparisonDiff, Interval, SiteAnalysis, SkyEvent } from '../analysis/types';
import { rounded, type AnalysisSlot, type AnalysisStatus, type ComparisonStatus } from './analysisStore';
import { describeScenario } from './scenario';
import { isoUtc } from './time';
import type { AppState, Scenario } from './types';

const HOUR_MS = 3_600_000;
/** Longest list of intervals or events put into one result. */
const LIST_LIMIT = 24;

/** The two science lookups the report needs; replaceable in tests. */
export interface ReportScience {
  blockageAt: (a: SiteAnalysis, body: 'sun' | 'earth', timeMs: number) => Blockage;
  nextEvents: (a: SiteAnalysis, timeMs: number) => Record<SkyEvent['type'], SkyEvent | null>;
}

const SCIENCE: ReportScience = { blockageAt: realBlockageAt, nextEvents: realNextEvents };

export function scenarioFacts(sc: Scenario) {
  return {
    label: sc.label,
    description: describeScenario(sc),
    site: { id: sc.site.id, name: sc.site.name, kind: sc.site.kind, latDeg: sc.site.lat, lonDegEast: sc.site.lon },
    startUtc: isoUtc(sc.startMs),
    endUtc: isoUtc(sc.startMs + sc.durationH * HOUR_MS),
    durationH: sc.durationH,
    mastHeightM: sc.mastHeightM,
    stepMin: sc.stepMin,
  };
}

function intervalList(list: readonly Interval[]) {
  return list.slice(0, LIST_LIMIT).map((iv) => ({
    startUtc: isoUtc(iv.startMs),
    endUtc: isoUtc(iv.endMs),
    hours: rounded((iv.endMs - iv.startMs) / HOUR_MS),
    // The span touches an edge of the analysed window, so it may be longer than shown.
    ...(iv.openStart && { touchesWindowStart: true }),
    ...(iv.openEnd && { touchesWindowEnd: true }),
  }));
}

function bodyNow(k: Blockage) {
  // Newer science cores also say how much of the disc shows; passed on when present.
  const disc = k as Blockage & { discVisibleFraction?: number; eclipsedFraction?: number };
  return {
    azDeg: rounded(k.bodyAzDeg),
    elDeg: rounded(k.bodyElDeg),
    skylineElDeg: rounded(k.skylineElDeg),
    /** Elevation of the disc's centre minus the terrain skyline at its azimuth; negative = centre hidden. */
    clearanceDeg: rounded(k.clearanceDeg),
    centreAboveSkyline: Number.isFinite(k.clearanceDeg) ? !k.blocked : null,
    ...(disc.discVisibleFraction !== undefined && { discVisibleFraction: rounded(disc.discVisibleFraction, 3) }),
    ...(disc.eclipsedFraction !== undefined && { coveredByEarthFraction: rounded(disc.eclipsedFraction, 3) }),
    skylineTerrain: {
      distanceKm: rounded(k.ridgeDistanceM / 1000),
      heightM: rounded(k.ridgeHeightM, 0),
      latDeg: rounded(k.ridge.lat, 4),
      lonDegEast: rounded(k.ridge.lon, 4),
      demName: k.demName,
      demResolutionM: rounded(k.demResolutionM, 1),
    },
    explanation: k.explanation,
  };
}

/** Where the skyline around the site is highest and lowest. */
function skylineSummary(a: SiteAnalysis) {
  const p = a.horizon;
  let hi = -1, lo = -1;
  for (let i = 0; i < p.elevDeg.length; i++) {
    const v = p.elevDeg[i];
    if (!Number.isFinite(v)) continue;
    if (hi < 0 || v > p.elevDeg[hi]) hi = i;
    if (lo < 0 || v < p.elevDeg[lo]) lo = i;
  }
  return {
    highestElDeg: hi < 0 ? null : rounded(p.elevDeg[hi]),
    highestAzDeg: hi < 0 ? null : rounded(hi * p.azStepDeg, 1),
    lowestElDeg: lo < 0 ? null : rounded(p.elevDeg[lo]),
    lowestAzDeg: lo < 0 ? null : rounded(lo * p.azStepDeg, 1),
    /** Where the horizon of a perfectly smooth Moon would be for this observer height (negative). */
    smoothMoonHorizonDeg: rounded(p.smoothDipDeg, 3),
    searchedToKm: rounded(p.maxRangeM / 1000, 0),
    azimuthStepDeg: p.azStepDeg,
  };
}

/**
 * The user's requirements against an analysis: plain facts, no verdict beyond met / not met.
 * The Sun band is about elevation above the local horizontal only; whether terrain hides the
 * Sun is in the clearance figures.
 */
export function checkRequirements(a: SiteAnalysis, s: Pick<AppState, 'sunElMinDeg' | 'sunElMaxDeg' | 'maxEarthGapH'>, sunElNowDeg: number) {
  const m = a.metrics;
  const inBand = (el: number) => (Number.isFinite(el) ? el > s.sunElMinDeg && el < s.sunElMaxDeg : null);
  return {
    sunElevationBand: {
      minDeg: s.sunElMinDeg,
      maxDeg: s.sunElMaxDeg,
      sunElNowDeg: rounded(sunElNowDeg),
      metNow: inBand(sunElNowDeg),
      windowMinSunElDeg: rounded(m.minSunElDeg),
      windowMaxSunElDeg: rounded(m.maxSunElDeg),
      metForWholeWindow: Number.isFinite(m.minSunElDeg) && Number.isFinite(m.maxSunElDeg) ? m.minSunElDeg > s.sunElMinDeg && m.maxSunElDeg < s.sunElMaxDeg : null,
    },
    maxEarthGap:
      s.maxEarthGapH === null
        ? null
        : {
            limitH: s.maxEarthGapH,
            longestEarthGapH: rounded(m.longestEarthGapH),
            met: Number.isFinite(m.longestEarthGapH) ? m.longestEarthGapH <= s.maxEarthGapH : null,
            // A gap cut by the window edge is at least this long: "met" then holds only inside the window.
            gapRunsIntoWindowEdge: m.earthGapOpenEnded,
          },
  };
}

/** The getAnalysis result for one slot. */
export function reportAnalysis(slot: AnalysisSlot, st: AnalysisStatus, s: Readonly<AppState>, science: ReportScience = SCIENCE): Record<string, unknown> {
  if (st.state === 'idle') {
    const error = slot === 'current' ? 'No site is selected. Select a landing site or drop a pin first.' : `Comparison slot ${slot} is empty. Save a scenario there first (saveScenario).`;
    return { slot, state: 'idle', error };
  }
  const scenario = scenarioFacts(st.scenario);
  if (st.state === 'loading') return { slot, state: 'loading', scenario };
  if (st.state === 'error') return { slot, state: 'error', scenario, error: st.error };

  const a = st.value, m = a.metrics, t = s.timeMs;
  const endMs = st.scenario.startMs + st.scenario.durationH * HOUR_MS;
  const sun = science.blockageAt(a, 'sun', t), earth = science.blockageAt(a, 'earth', t);
  const next = science.nextEvents(a, t);
  const event = (e: SkyEvent | null) => (e ? { timeUtc: isoUtc(e.timeMs), azDeg: rounded(e.azDeg, 1), inHours: rounded((e.timeMs - t) / HOUR_MS) } : null);
  const list = <T>(items: readonly T[]) => (items.length > LIST_LIMIT ? { shown: LIST_LIMIT, total: items.length } : undefined);
  return {
    slot,
    state: 'ready',
    scenario,
    metrics: {
      /** Time-averaged visible fraction of the Sun's disc over the window. */
      illuminationPct: rounded(m.illuminationPct),
      /** Share of the window with any part of the Sun above the skyline. */
      sunAnyPct: rounded(m.sunAnyPct),
      longestDarknessH: rounded(m.longestDarknessH),
      darknessRunsIntoWindowEdge: m.darknessOpenEnded,
      /** Share of the window with geometric line of sight to Earth's centre (not a radio link budget). */
      earthVisiblePct: rounded(m.earthVisiblePct),
      longestEarthGapH: rounded(m.longestEarthGapH),
      earthGapRunsIntoWindowEdge: m.earthGapOpenEnded,
      minSunElDeg: rounded(m.minSunElDeg),
      maxSunElDeg: rounded(m.maxSunElDeg),
    },
    slope: { slopeDeg: rounded(a.slope.slopeDeg), downhillAzDeg: rounded(a.slope.aspectDeg, 0), baselineM: rounded(a.slope.baselineM, 0), demName: a.slope.demName },
    siteElevationM: rounded(a.horizon.siteElevationM, 0),
    now: {
      timeUtc: isoUtc(t),
      insideAnalysedWindow: t >= st.scenario.startMs && t <= endMs,
      sun: bodyNow(sun),
      earth: bodyNow(earth),
    },
    /** The first event of each kind after the simulated time, inside the analysed window; null when there is none in it. */
    nextEvents: { sunrise: event(next.sunrise), sunset: event(next.sunset), earthrise: event(next.earthrise), earthset: event(next.earthset) },
    events: a.events.slice(0, LIST_LIMIT).map((e) => ({ type: e.type, timeUtc: isoUtc(e.timeMs), azDeg: rounded(e.azDeg, 1) })),
    intervals: {
      darkness: intervalList(m.darkIntervals),
      earthGaps: intervalList(m.earthGapIntervals),
      sunBehindEarth: intervalList(m.eclipseIntervals ?? []),
    },
    ...((list(a.events) || list(m.darkIntervals) || list(m.earthGapIntervals)) && {
      truncated: { events: list(a.events), darkness: list(m.darkIntervals), earthGaps: list(m.earthGapIntervals) },
    }),
    skyline: skylineSummary(a),
    requirements: checkRequirements(a, s, sun.bodyElDeg),
    provenance: {
      ephemeris: a.provenance.ephemeris,
      ephemerisNote: a.provenance.ephemerisNote,
      elevationData: a.provenance.dem.map((d) => ({ name: d.name, resolutionM: rounded(d.resolutionM, 1), fromKm: rounded(d.fromM / 1000, 1), toKm: rounded(d.toM / 1000, 1) })),
      assumptions: a.provenance.assumptions,
    },
    warnings: a.warnings,
  };
}

/** B minus A, rounded like the two sides, with the science core's sentences. */
export function reportDiff(diff: ComparisonDiff) {
  return {
    meaning: 'B minus A',
    illuminationPct: rounded(diff.illuminationPct),
    longestDarknessH: rounded(diff.longestDarknessH),
    earthVisiblePct: rounded(diff.earthVisiblePct),
    longestEarthGapH: rounded(diff.longestEarthGapH),
    slopeDeg: rounded(diff.slopeDeg),
    highlights: diff.highlights,
  };
}

/** The differences part of the compare result: the diff when both sides are ready, the reason otherwise. */
export function reportComparison(c: ComparisonStatus): { diff: ReturnType<typeof reportDiff> | null; error?: string } {
  if (c.state === 'ready') return { diff: reportDiff(c.diff) };
  if (c.state === 'error') return { diff: null, error: c.error };
  if (c.state === 'idle') return { diff: null, error: `Save a scenario in slot ${c.missing.join(' and ')} first (saveScenario).` };
  return { diff: null, error: 'The comparison is still being analysed.' };
}
