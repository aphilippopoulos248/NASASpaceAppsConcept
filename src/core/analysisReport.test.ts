import { describe, expect, it } from 'vitest';
import type { Blockage, SiteAnalysis, SkyEvent } from '../analysis/types';
import { checkRequirements, reportAnalysis, reportComparison, scenarioFacts, type ReportScience } from './analysisReport';
import { NO_SUN_BAND_TEXT } from './requirements';
import { scenarioFromState } from './scenario';
import { initialState } from './store';

const T = Date.UTC(2025, 2, 6, 17, 28);
const H = 3_600_000;
const state = { ...initialState(T), site: { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, lat: -84.79, lon: 29.2 } };
const scenario = scenarioFromState(state)!;

/** A stand-in analysis: only the fields the report reads. The figures are test inputs, chosen to exercise rounding and flags. */
function analysis(over: Partial<SiteAnalysis['metrics']> = {}, events: SkyEvent[] = []): SiteAnalysis {
  return {
    scenario,
    horizon: { siteElevationM: 5321.4, mastHeightM: 2, azStepDeg: 90, elevDeg: Float32Array.from([1, 4.066, -1.5, NaN]), smoothDipDeg: -0.0869, maxRangeM: 188_580 },
    metrics: {
      illuminationPct: 53.6234, sunAnyPct: 60, longestDarknessH: 6.004, darknessOpenEnded: true, earthVisiblePct: 100, longestEarthGapH: 0, earthGapOpenEnded: false,
      minSunElDeg: -1.234, maxSunElDeg: 3.385, sunIntervals: [], darkIntervals: [{ startMs: T, endMs: T + 6.004 * H, openStart: true }], earthIntervals: [], earthGapIntervals: [], eclipseIntervals: [],
      ...over,
    },
    events,
    slope: { slopeDeg: 2.0612, aspectDeg: 356.3, baselineM: 120, demName: 'test grid' },
    provenance: { ephemeris: 'model', ephemerisNote: 'note', dem: [{ name: 'test grid', resolutionM: 60, fromM: 42, toM: 5418 }], assumptions: ['a'] },
    warnings: ['w'],
  } as unknown as SiteAnalysis;
}

const science: ReportScience = {
  blockageAt: (_a, body, timeMs) =>
    ({ body, timeMs, blocked: body === 'earth', bodyAzDeg: 65.678, bodyElDeg: body === 'sun' ? 2.4567 : 0.5, skylineElDeg: 0.83, clearanceDeg: body === 'sun' ? 1.6267 : -0.33, ridgeDistanceM: 18_350, ridgeHeightM: 5687.2, ridge: { lat: -84.51151, lon: 34.96619 }, demName: 'test grid', demResolutionM: 80, explanation: 'because' }) as Blockage,
  nextEvents: (a, t) => {
    const out: Record<SkyEvent['type'], SkyEvent | null> = { sunrise: null, sunset: null, earthrise: null, earthset: null };
    for (const e of a.events) if (e.timeMs > t && !out[e.type]) out[e.type] = e;
    return out;
  },
};

describe('analysis report', () => {
  it('states a ready analysis with units in the keys, rounded, and nothing invented', () => {
    const events: SkyEvent[] = [{ type: 'sunset', timeMs: T + 5 * H, azDeg: 268.94 }, { type: 'sunrise', timeMs: T + 20 * H, azDeg: 91.26 }];
    const r = reportAnalysis('current', { state: 'ready', scenario, value: analysis({}, events) }, { ...state, timeMs: T + 2 * H }, science) as any;
    expect(r).toMatchObject({
      slot: 'current',
      state: 'ready',
      scenario: { label: scenario.label, startUtc: '2025-03-06T17:28Z', endUtc: '2025-03-07T17:28Z', durationH: 24, mastHeightM: 2, site: { id: 'im-2', latDeg: -84.79, lonDegEast: 29.2 } },
      metrics: { illuminationPct: 53.62, longestDarknessH: 6, darknessRunsIntoWindowEdge: true, earthVisiblePct: 100, longestEarthGapH: 0, minSunElDeg: -1.23, maxSunElDeg: 3.39 },
      slope: { slopeDeg: 2.06, downhillAzDeg: 356, baselineM: 120, demName: 'test grid' },
      siteElevationM: 5321,
      now: {
        timeUtc: '2025-03-06T19:28Z',
        insideAnalysedWindow: true,
        sun: { azDeg: 65.68, elDeg: 2.46, skylineElDeg: 0.83, clearanceDeg: 1.63, centreAboveSkyline: true, skylineTerrain: { distanceKm: 18.35, heightM: 5687, latDeg: -84.5115, lonDegEast: 34.9662, demResolutionM: 80 }, explanation: 'because' },
        earth: { clearanceDeg: -0.33, centreAboveSkyline: false },
      },
      // Each time says which instant of the rise or set it is (decision D-8).
      nextEvents: { sunset: { label: 'Sun fully set', timeUtc: '2025-03-06T22:28Z', azDeg: 268.9, inHours: 3 }, sunrise: { label: 'Sun starts rising', timeUtc: '2025-03-07T13:28Z', inHours: 18 }, earthrise: null, earthset: null },
      events: [{ type: 'sunset', label: 'Sun fully set', timeUtc: '2025-03-06T22:28Z', azDeg: 268.9 }, { type: 'sunrise', label: 'Sun starts rising', timeUtc: '2025-03-07T13:28Z', azDeg: 91.3 }],
      eventDefinitions: { sunset: "Sun fully set: the last part of the Sun's disc goes behind the terrain skyline.", earthset: "Earth's centre sets: the centre of Earth's disc goes behind the terrain skyline." },
      intervals: { darkness: [{ startUtc: '2025-03-06T17:28Z', endUtc: '2025-03-06T23:28Z', hours: 6, touchesWindowStart: true }], earthGaps: [], sunBehindEarth: [] },
      skyline: { highestElDeg: 4.07, highestAzDeg: 90, lowestElDeg: -1.5, lowestAzDeg: 180, smoothMoonHorizonDeg: -0.087, searchedToKm: 189 },
      provenance: { ephemeris: 'model', elevationData: [{ name: 'test grid', resolutionM: 60, fromKm: 0, toKm: 5.4 }], assumptions: ['a'] },
      warnings: ['w'],
    });
    expect(r.truncated).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('gives null, not a number, for what does not exist, and says when lists are cut', () => {
    const many: SkyEvent[] = Array.from({ length: 30 }, (_, i) => ({ type: 'earthset', timeMs: T + i * H, azDeg: 10 }));
    const r = reportAnalysis('A', { state: 'ready', scenario, value: analysis({ longestEarthGapH: NaN }, many) }, { ...state, timeMs: T + 30 * H }, science) as any;
    expect(r.metrics.longestEarthGapH).toBeNull();
    expect(r.now.insideAnalysedWindow).toBe(false);
    expect(r.events).toHaveLength(24);
    expect(r.truncated.events).toEqual({ shown: 24, total: 30 });
    expect(r.nextEvents.earthset).toBeNull(); // the clock is past the last one
  });

  it('explains idle, loading and error states in words', () => {
    expect(reportAnalysis('current', { state: 'idle' }, state)).toEqual({ slot: 'current', state: 'idle', error: 'No site is selected. Select a landing site or drop a pin first.' });
    expect(reportAnalysis('A', { state: 'idle' }, state)).toMatchObject({ state: 'idle', error: expect.stringContaining('Comparison slot A is empty') });
    expect(reportAnalysis('B', { state: 'loading', scenario }, state)).toEqual({ slot: 'B', state: 'loading', scenario: scenarioFacts(scenario) });
    const failed = reportAnalysis('current', { state: 'error', scenario, error: 'no elevation data', notAvailable: false }, state);
    expect(failed).toEqual({ slot: 'current', state: 'error', scenario: scenarioFacts(scenario), error: 'no elevation data' });
  });

  it('checks the requirements: Sun band now and over the window, and the Earth gap limit', () => {
    const a = analysis({ minSunElDeg: 2.46, maxSunElDeg: 3.39, longestEarthGapH: 7.5, earthGapOpenEnded: true });
    expect(checkRequirements(a, { sunElMinDeg: 2, sunElMaxDeg: 80, maxEarthGapH: null }, 2.5)).toEqual({
      sunElevationBand: { required: true, minDeg: 2, maxDeg: 80, sunElNowDeg: 2.5, metNow: true, windowMinSunElDeg: 2.46, windowMaxSunElDeg: 3.39, metForWholeWindow: true },
      maxEarthGap: null,
    });
    const strict = checkRequirements(a, { sunElMinDeg: 3, sunElMaxDeg: 30, maxEarthGapH: 6 }, 2.5);
    expect(strict.sunElevationBand).toMatchObject({ required: true, metNow: false, metForWholeWindow: false });
    expect(strict.maxEarthGap).toEqual({ limitH: 6, basis: "Earth's centre", longestEarthGapH: 7.5, met: false, gapRunsIntoWindowEdge: true });
    expect(checkRequirements(a, { sunElMinDeg: -5, sunElMaxDeg: 90, maxEarthGapH: 8 }, NaN)).toMatchObject({ sunElevationBand: { required: true, sunElNowDeg: null, metNow: null }, maxEarthGap: { met: true } });
  });

  it('checks nothing against the default band (0 to 90 deg), and says so, even for a window with a night', () => {
    const night = analysis({ minSunElDeg: -12.5, maxSunElDeg: 8.25 });
    const band = checkRequirements(night, { sunElMinDeg: 0, sunElMaxDeg: 90, maxEarthGapH: null }, -4).sunElevationBand;
    expect(band).toEqual({ required: false, minDeg: 0, maxDeg: 90, sunElNowDeg: -4, metNow: null, windowMinSunElDeg: -12.5, windowMaxSunElDeg: 8.25, metForWholeWindow: null, note: NO_SUN_BAND_TEXT });
    // The same window against a band the user set is a breach.
    expect(checkRequirements(night, { sunElMinDeg: -1, sunElMaxDeg: 90, maxEarthGapH: null }, -4).sunElevationBand).toMatchObject({ required: true, metNow: false, metForWholeWindow: false });
    expect(checkRequirements(night, { sunElMinDeg: -1, sunElMaxDeg: 90, maxEarthGapH: null }, -4).sunElevationBand).not.toHaveProperty('note');
  });

  it('turns a comparison into B minus A, or into the reason there is none', () => {
    const diff = { illuminationPct: -2.3078, longestDarknessH: 2.7561, earthVisiblePct: 0, longestEarthGapH: 0, slopeDeg: NaN, highlights: ['B gets less sunlight than A.'] };
    expect(reportComparison({ state: 'ready', a: analysis(), b: analysis(), diff })).toEqual({
      diff: { meaning: 'B minus A', illuminationPct: -2.31, longestDarknessH: 2.76, earthVisiblePct: 0, longestEarthGapH: 0, slopeDeg: null, highlights: ['B gets less sunlight than A.'] },
    });
    expect(reportComparison({ state: 'error', error: 'B (x): failed' })).toEqual({ diff: null, error: 'B (x): failed' });
    expect(reportComparison({ state: 'idle', missing: ['A', 'B'] })).toEqual({ diff: null, error: 'Save a scenario in slot A and B first (saveScenario).' });
  });
});
