import { beforeEach, describe, expect, it } from 'vitest';
import type { SiteAnalysis } from '../analysis/types';
import type { Landing } from '../data/landings';
import { registerActions, resetActions, runAction } from './actions';
import { AnalysisStore } from './analysisStore';
import { onCommand } from './bus';
import { createCoreActions } from './coreActions';
import { MissionFilterStore } from './missionFilter';
import { initialState, Store } from './store';
import type { SiteRef } from './types';

const L = (id: string, name: string, program: string, country: string, date: string, lat: number, lon: number, crewed = false): Landing =>
  ({ id, name, program, country, date, time: '12:00', lat, lon, crewed, region: 'r', summary: 's' }) as Landing;

const LANDINGS = [
  L('luna-9', 'Luna 9', 'Luna', 'USSR', '1966-02-03', 7.08, -64.37),
  L('apollo-11', 'Apollo 11', 'Apollo', 'USA', '1969-07-20', 0.67408, 23.47297, true),
  L('luna-17', 'Luna 17 / Lunokhod 1', 'Luna', 'USSR', '1970-11-17', 38.2378, -35.0017),
  L('change-4', "Chang'e 4 / Yutu-2", "Chang'e", 'China', '2019-01-03', -45.4446, 177.5991),
];

const T0 = Date.UTC(2025, 2, 14, 6, 0);

function setup(prepareSurface?: (s: SiteRef) => Promise<void>) {
  resetActions();
  const store = new Store(initialState(T0));
  const filters = new MissionFilterStore();
  registerActions(createCoreActions({ store, filters, landings: () => LANDINGS, prepareSurface }));
  return { store, filters };
}

describe('core actions', () => {
  beforeEach(() => resetActions());

  it('sets time from UTC text or an offset, and rejects out-of-range times', async () => {
    const { store } = setup();
    expect(await runAction('setTime', { utc: '1969-07-20T20:17Z' })).toMatchObject({ ok: true, result: { timeUtc: '1969-07-20T20:17Z' } });
    await runAction('setTime', { offsetHours: -24 });
    expect(store.get().timeMs).toBe(Date.UTC(1969, 6, 19, 20, 17));
    expect(await runAction('setTime', { utc: '1900-01-01' })).toMatchObject({ ok: false });
    expect(await runAction('setTime', { utc: 'tomorrow' })).toMatchObject({ ok: false });
    expect(await runAction('setTime', {})).toEqual({ ok: false, error: 'Give exactly one of `utc` or `offsetHours`.' });
  });

  it('plays, pauses and sets the rate; even lighting pauses and play restores real light', async () => {
    const { store } = setup();
    await runAction('play', { rate: 60 });
    expect(store.get()).toMatchObject({ playing: true, rate: 60 });
    await runAction('setLightMode', { mode: 'even' });
    expect(store.get()).toMatchObject({ playing: false, lightMode: 'even' });
    await runAction('play');
    expect(store.get()).toMatchObject({ playing: true, lightMode: 'real' });
    await runAction('pause');
    await runAction('setRate', { secondsPerSecond: 3600 });
    expect(store.get()).toMatchObject({ playing: false, rate: 3600 });
  });

  it('selects landings by id or loose name and flies there', async () => {
    const { store } = setup();
    const flights: unknown[] = [];
    const off = onCommand('flyTo', (p) => flights.push(p));
    for (const q of ['apollo-11', 'Apollo 11', 'apollo11', ' APOLLO 11 ']) {
      const r = await runAction('selectSite', { site: q });
      expect(r).toMatchObject({ ok: true, result: { site: { id: 'apollo-11', program: 'Apollo', landedUtc: '1969-07-20T12:00Z' } } });
    }
    expect((await runAction('selectSite', { site: 'Lunokhod 1' })) as unknown).toMatchObject({ ok: true, result: { site: { id: 'luna-17' } } });
    expect((await runAction('selectSite', { site: "chang'e-4" })) as unknown).toMatchObject({ ok: true, result: { site: { id: 'change-4' } } });
    expect(await runAction('selectSite', { site: 'Apollo 99' })).toMatchObject({ ok: false });
    expect(store.get().site?.id).toBe('change-4');
    expect(flights.at(-1)).toMatchObject({ lat: -45.4446, lon: 177.5991 });
    off();
  });

  it('drops pins at custom coordinates, wrapping longitude east-positive', async () => {
    const { store } = setup();
    const r = await runAction('dropPin', { lat: -89.45, lon: 222.5 });
    expect(r.ok).toBe(true);
    expect(store.get().site).toEqual({ id: 'pin:-89.45000,-137.50000', name: 'Pin 89.450° S, 137.500° W', kind: 'custom', lat: -89.45, lon: -137.5 });
    expect(await runAction('dropPin', { lat: 91, lon: 0 })).toMatchObject({ ok: false });
    // A pin id is also accepted by selectSite (deep links).
    await runAction('clearSite');
    await runAction('selectSite', { site: 'pin:-89.45000,-137.50000' });
    expect(store.get().site?.kind).toBe('custom');
  });

  it('enters the surface only with a site, after the scene says it is ready', async () => {
    let release!: () => void;
    const { store } = setup((site) => (site.kind === 'custom' ? Promise.reject(new Error('No terrain for custom pins yet.')) : new Promise<void>((r) => (release = r))));
    expect(await runAction('enterSurface')).toMatchObject({ ok: false, error: expect.stringContaining('No site is selected') });
    await runAction('selectSite', { site: 'apollo-11' });
    const pending = runAction('enterSurface');
    await Promise.resolve();
    expect(store.get().view).toBe('globe');
    release();
    expect(await pending).toMatchObject({ ok: true, result: { view: 'surface' } });
    expect(await runAction('lookAt', { azDeg: -90, elDeg: 10 })).toEqual({ ok: true, result: { look: { azDeg: 270, elDeg: 10, fovDeg: 70 } } });
    await runAction('exitSurface');
    expect(store.get().view).toBe('globe');
    expect(await runAction('lookAt', { azDeg: 0 })).toMatchObject({ ok: false });
    await runAction('dropPin', { lat: 1, lon: 2 });
    expect(await runAction('enterSurface')).toEqual({ ok: false, error: 'No terrain for custom pins yet.' });
  });

  it('records the globe camera when no scene is listening', async () => {
    const { store } = setup();
    await runAction('setGlobeCamera', { lat: 10, lon: 190, altitudeKm: 500 });
    expect(store.get().globeCenter).toEqual({ lat: 10, lon: -170, altitudeKm: 500 });
  });

  it('validates the scenario parameters', async () => {
    const { store } = setup();
    await runAction('setMastHeight', { metres: 10 });
    await runAction('setMissionWindow', { startUtc: '2025-03-15T00:00Z', durationH: 48 });
    await runAction('setDelay', { hours: 24 });
    await runAction('setSlopeLimit', { degrees: 8 });
    await runAction('setMaxEarthGap', { hours: 6 });
    await runAction('setSunBand', { minDeg: 2, maxDeg: 30 });
    await runAction('setOverlay', { mode: 'sun-band' });
    await runAction('showMissions', { show: false });
    expect(store.get()).toMatchObject({
      mastHeightM: 10, windowStartMs: Date.UTC(2025, 2, 15), windowDurationH: 48, delayH: 24, slopeLimitDeg: 8,
      maxEarthGapH: 6, sunElMinDeg: 2, sunElMaxDeg: 30, overlay: 'sun-band', showMissions: false,
    });
    await runAction('setMaxEarthGap', {});
    expect(store.get().maxEarthGapH).toBeNull();
    expect(await runAction('setSunBand', { minDeg: 30, maxDeg: 2 })).toMatchObject({ ok: false });
    expect(await runAction('setMissionWindow', {})).toMatchObject({ ok: false });
    await runAction('setMissionWindow', { startUtc: 'now' });
    expect(store.get().windowStartMs).toBe(T0);
  });

  it('filters landings and deselects a hidden site', async () => {
    const { store, filters } = setup();
    await runAction('selectSite', { site: 'apollo-11' });
    const r = await runAction<{ shown: number; shownIds: string[] }>('setFilters', { programs: ['luna'] });
    expect(r).toMatchObject({ ok: true, result: { shown: 2, total: 4, shownIds: ['luna-9', 'luna-17'] } });
    expect(store.get().site).toBeNull();
    await runAction('setFilters', { type: 'crewed' });
    expect(filters.get()).toMatchObject({ programs: ['Luna'], type: 'crewed' });
    expect(await runAction('setFilters', { reset: true, fromYear: 1969, toYear: 1970 })).toMatchObject({ result: { shownIds: ['apollo-11', 'luna-17'] } });
    expect(filters.get().programs).toBeNull();
    expect(await runAction('setFilters', { countries: ['Atlantis'] })).toMatchObject({ ok: false });
    expect(await runAction('setFilters', { fromYear: 2000, toYear: 1990 })).toMatchObject({ ok: false });
  });

  it('saves scenarios A/B (with the delay applied) and compares them', async () => {
    const { store } = setup();
    expect(await runAction('saveScenario', { slot: 'A' })).toMatchObject({ ok: false });
    await runAction('selectSite', { site: 'apollo-11' });
    await runAction('saveScenario', { slot: 'A' });
    expect(await runAction('compare')).toEqual({ ok: false, error: 'Save a scenario in slot B first (saveScenario).' });
    await runAction('setDelay', { hours: 24 });
    await runAction('saveScenario', { slot: 'B', label: 'late' });
    expect(store.get().compareB).toMatchObject({ label: 'late', startMs: T0 + 24 * 3_600_000, stepMin: 10 });
    expect(await runAction('compare')).toMatchObject({ ok: true, result: { comparing: true, B: 'late' } });
    await runAction('stopCompare');
    expect(store.get().comparing).toBe(false);
  });

  it('reports state as plain JSON', async () => {
    setup();
    await runAction('selectSite', { site: 'Luna 9' });
    const r = await runAction<Record<string, any>>('getState');
    expect(r.ok && r.result).toMatchObject({ view: 'globe', timeUtc: '2025-03-14T06:00Z', site: { id: 'luna-9', lonDegEast: -64.37 }, missionsShown: { shown: 4, total: 4 } });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });
});

// ---------------------------------------------------------------------------------------------
// The actions the assistant reads results from, run on the real science core with the bundled
// terrain (no network). The sites, coordinates and touchdown times are the catalogue's own.

const at = (id: string, name: string, date: string, time: string, lat: number, lon: number): Landing =>
  ({ id, name, program: 'p', country: 'c', date, time, lat, lon, crewed: false, region: 'r', summary: 's' }) as Landing;

const CATALOGUE = [at('apollo-11', 'Apollo 11', '1969-07-20', '20:17', 0.67416, 23.47314), at('im-2', 'IM-2 Athena', '2025-03-06', '17:28', -84.79, 29.2)];
const IM2_TOUCHDOWN = Date.UTC(2025, 2, 6, 17, 28);
const APOLLO_TOUCHDOWN = Date.UTC(1969, 6, 20, 20, 17);
const LONG = 90_000;

/** The app's wiring: a store, the analysis store following it with its usual debounce, the core actions. */
function setupReal() {
  resetActions();
  const store = new Store(initialState(T0));
  const analysis = new AnalysisStore(store, undefined, 200);
  void analysis.start();
  registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => CATALOGUE, analysis }));
  return { store, analysis };
}

describe('one step to a landing and its date', () => {
  it('selectSite { atLanding } lines the clock and the mission window up with touchdown', async () => {
    const { store, analysis } = setupReal();
    const flights: unknown[] = [];
    const off = onCommand('flyTo', (p) => flights.push(p));
    store.set({ delayH: 24, playing: true, lightMode: 'even' });
    const r = await runAction('selectSite', { site: 'IM-2', atLanding: true });
    expect(r).toMatchObject({
      ok: true,
      result: {
        site: { id: 'im-2', landedUtc: '2025-03-06T17:28Z' },
        timeUtc: '2025-03-06T17:28Z',
        playing: false,
        lightMode: 'real',
        missionWindow: { startUtc: '2025-03-06T17:28Z', durationH: 24, delayH: 0, effectiveStartUtc: '2025-03-06T17:28Z', endUtc: '2025-03-07T17:28Z', clockInsideWindow: true },
      },
    });
    expect(store.get()).toMatchObject({ timeMs: IM2_TOUCHDOWN, windowStartMs: IM2_TOUCHDOWN, delayH: 0, playing: false, lightMode: 'real' });
    expect(flights).toHaveLength(1);

    // The site card's button: the same step for the site already selected, without moving the camera.
    store.set({ timeMs: T0, windowStartMs: T0 });
    await runAction('selectSite', { site: 'im-2', atLanding: true, fly: false });
    expect(store.get()).toMatchObject({ timeMs: IM2_TOUCHDOWN, windowStartMs: IM2_TOUCHDOWN });
    expect(flights).toHaveLength(1);

    // A pin has no landing date: nothing changes.
    expect(await runAction('selectSite', { site: 'pin:-89.45000,136.70000', atLanding: true })).toMatchObject({ ok: false, error: expect.stringContaining('a pin has no landing date') });
    expect(store.get().site?.id).toBe('im-2');
    off();
    analysis.stop();
  });

  it('setMissionWindow understands "landing" and "now", and can bring the clock along', async () => {
    const { store, analysis } = setupReal();
    await runAction('dropPin', { lat: -89.45, lon: 136.7 });
    expect(await runAction('setMissionWindow', { startUtc: 'landing' })).toMatchObject({ ok: false, error: expect.stringContaining('needs a selected catalogued landing') });

    await runAction('selectSite', { site: 'Apollo 11' });
    // Without moveClock the window moves and the clock stays: the result says the clock is outside.
    expect(await runAction('setMissionWindow', { startUtc: 'Landing' })).toEqual({
      ok: true,
      result: { windowStartUtc: '1969-07-20T20:17Z', windowDurationH: 24, delayH: 0, effectiveStartUtc: '1969-07-20T20:17Z', windowEndUtc: '1969-07-21T20:17Z', timeUtc: '2025-03-14T06:00Z', clockInsideWindow: false },
    });
    expect(store.get()).toMatchObject({ windowStartMs: APOLLO_TOUCHDOWN, timeMs: T0 });

    // With a delay the window really starts later, and that is where the clock goes.
    await runAction('setDelay', { hours: 24 });
    expect(await runAction('setMissionWindow', { moveClock: true })).toMatchObject({ ok: true, result: { effectiveStartUtc: '1969-07-21T20:17Z', timeUtc: '1969-07-21T20:17Z', clockInsideWindow: true } });
    expect(store.get().timeMs).toBe(APOLLO_TOUCHDOWN + 24 * 3_600_000);

    await runAction('setDelay', { hours: 0 });
    await runAction('setMissionWindow', { startUtc: '2030-01-01T00:00Z', durationH: 72, moveClock: true });
    expect(store.get()).toMatchObject({ windowStartMs: Date.UTC(2030, 0, 1), windowDurationH: 72, timeMs: Date.UTC(2030, 0, 1) });
    expect(await runAction('setMissionWindow', { startUtc: '2150-01-01' })).toMatchObject({ ok: false, error: expect.stringContaining('The window start must be between') });
    expect(await runAction('setMissionWindow', {})).toMatchObject({ ok: false });
    expect(store.get().windowStartMs).toBe(Date.UTC(2030, 0, 1));
    analysis.stop();
  });
});

describe('getAnalysis', () => {
  it('waits for the analysis and reports it with units, for the scenario on screen', async () => {
    const { analysis } = setupReal();
    await runAction('selectSite', { site: 'IM-2', atLanding: true });
    // getState does not wait: straight after the change the analysis has not been published.
    const snapshot = await runAction<any>('getState');
    expect(snapshot.ok && snapshot.result.analysis.state).not.toBe('ready');

    const r = await runAction<any>('getAnalysis');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.result;
    expect(a).toMatchObject({
      slot: 'current',
      state: 'ready',
      scenario: { site: { id: 'im-2', latDeg: -84.79, lonDegEast: 29.2 }, startUtc: '2025-03-06T17:28Z', endUtc: '2025-03-07T17:28Z', durationH: 24, mastHeightM: 2 },
      now: { timeUtc: '2025-03-06T17:28Z', insideAnalysedWindow: true },
      requirements: { sunElevationBand: { minDeg: 0, maxDeg: 90, metNow: true }, maxEarthGap: null },
    });
    for (const key of ['illuminationPct', 'sunAnyPct', 'earthVisiblePct']) {
      expect(a.metrics[key]).toBeGreaterThanOrEqual(0);
      expect(a.metrics[key]).toBeLessThanOrEqual(100);
    }
    expect(a.metrics.longestDarknessH).toBeGreaterThanOrEqual(0);
    // At touchdown near the south pole the Sun stood a few degrees up and Earth low in the north-north-west.
    expect(a.now.sun.elDeg).toBeGreaterThan(1.5);
    expect(a.now.sun.elDeg).toBeLessThan(3.5);
    expect(a.now.earth.elDeg).toBeGreaterThan(9);
    expect(a.now.earth.elDeg).toBeLessThan(13);
    expect(a.now.earth.azDeg).toBeGreaterThan(320);
    for (const body of [a.now.sun, a.now.earth]) {
      expect(body.clearanceDeg).toBeCloseTo(body.elDeg - body.skylineElDeg, 1);
      expect(body.centreAboveSkyline).toBe(body.clearanceDeg > 0);
      expect(typeof body.explanation).toBe('string');
      expect(body.skylineTerrain.distanceKm).toBeGreaterThan(0);
    }
    expect(a.slope.slopeDeg).toBeGreaterThan(0);
    expect(a.slope.slopeDeg).toBeLessThan(20);
    expect(Object.keys(a.nextEvents)).toEqual(['sunrise', 'sunset', 'earthrise', 'earthset']);
    expect(a.provenance.elevationData[0]).toMatchObject({ resolutionM: 60, fromKm: 0 });
    expect(a.provenance.assumptions.length).toBeGreaterThan(3);
    expect(a.skyline.highestElDeg).toBeGreaterThan(a.skyline.lowestElDeg);
    // Plain JSON: nothing is lost on the way to the assistant.
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);

    // The same call answers for a comparison slot, and says why when there is nothing to report.
    expect(await runAction('getAnalysis', { slot: 'B' })).toEqual({ ok: true, result: { slot: 'B', state: 'idle', error: 'Comparison slot B is empty. Save a scenario there first (saveScenario).' } });
    await runAction('saveScenario', { slot: 'B' });
    expect(await runAction('getAnalysis', { slot: 'B' })).toMatchObject({ ok: true, result: { slot: 'B', state: 'ready', scenario: { label: 'IM-2 Athena' }, metrics: a.metrics } });
    await runAction('clearSite');
    expect(await runAction('getAnalysis')).toEqual({ ok: true, result: { slot: 'current', state: 'idle', error: 'No site is selected. Select a landing site or drop a pin first.' } });
    analysis.stop();
  }, LONG);

  it('puts Apollo 11 where history does: the Sun about 10.8 degrees up in the east at touchdown', async () => {
    const { analysis } = setupReal();
    await runAction('selectSite', { site: 'apollo-11', atLanding: true });
    const r = await runAction<any>('getAnalysis');
    expect(r.ok && r.result.now).toMatchObject({ timeUtc: '1969-07-20T20:17Z', sun: { centreAboveSkyline: true }, earth: { centreAboveSkyline: true } });
    if (!r.ok) return;
    expect(r.result.now.sun.elDeg).toBeGreaterThan(10.2);
    expect(r.result.now.sun.elDeg).toBeLessThan(11.4);
    expect(r.result.now.sun.azDeg).toBeGreaterThan(85);
    expect(r.result.now.sun.azDeg).toBeLessThan(92);
    // Earth hangs high in the west for a site at 23.5 degrees east.
    expect(r.result.now.earth.elDeg).toBeGreaterThan(55);
    expect(r.result.now.earth.azDeg).toBeGreaterThan(255);
    expect(r.result.now.earth.azDeg).toBeLessThan(285);
    analysis.stop();
  }, LONG);

  it('reports a failed analysis with its reason, never with numbers', async () => {
    resetActions();
    const store = new Store(initialState(T0));
    const analysis = new AnalysisStore(store, { analyse: () => Promise.reject(new Error('data/dem/index.json is missing')), rankNearby: () => Promise.resolve([]) }, 200);
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => CATALOGUE, analysis }));
    await runAction('selectSite', { site: 'im-2' });
    const r = await runAction<any>('getAnalysis');
    expect(r).toMatchObject({ ok: true, result: { state: 'error', error: 'data/dem/index.json is missing', scenario: { site: { id: 'im-2' } } } });
    expect(r.ok && r.result.metrics).toBeUndefined();
    // Without an analysis store the action says so.
    resetActions();
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => CATALOGUE }));
    expect(await runAction('getAnalysis')).toEqual({ ok: false, error: 'The site analysis is not running in this session.' });
  });
});

describe('jumpToEvent', () => {
  it('waits for the analysis, then moves the clock to an event measured against the skyline', async () => {
    const { store, analysis } = setupReal();
    expect(await runAction('jumpToEvent', { type: 'sunset' })).toMatchObject({ ok: false, error: expect.stringContaining('No site is selected') });
    // Tranquility Base, 30 days from touchdown: the Sun sets about two weeks after the landing.
    await runAction('selectSite', { site: 'apollo-11', atLanding: true });
    await runAction('setMissionWindow', { durationH: 720 });
    store.set({ playing: true });
    const r = await runAction<any>('jumpToEvent', { type: 'sunset' });
    expect(r).toMatchObject({ ok: true, result: { event: 'sunset', playing: false } });
    if (!r.ok) return;
    const t = store.get().timeMs;
    expect(t).toBeGreaterThan(Date.UTC(1969, 7, 2));
    expect(t).toBeLessThan(Date.UTC(1969, 7, 5));
    expect(r.result.timeUtc).toBe(new Date(t).toISOString().slice(0, 16) + 'Z');
    expect(r.result.azDeg).toBeGreaterThan(260);
    expect(r.result.azDeg).toBeLessThan(280);
    expect(store.get().playing).toBe(false);
    // From there, the previous sunset does not exist in the window, and Earth never sets at this site.
    expect(await runAction('jumpToEvent', { type: 'sunset', which: 'previous' })).toMatchObject({ ok: false, error: expect.stringContaining('There is no previous sunset before the simulated time inside the analysed mission window (1969-07-20T20:17Z to 1969-08-19T20:17Z)') });
    expect(await runAction('jumpToEvent', { type: 'earthset' })).toMatchObject({ ok: false, error: expect.stringContaining('There is no next earthset') });
    const sunrise = await runAction<any>('jumpToEvent', { type: 'sunrise' });
    expect(sunrise.ok && store.get().timeMs).toBeGreaterThan(Date.UTC(1969, 7, 16));
    analysis.stop();
  }, LONG);
});

describe('compare', () => {
  it('names the two sides, waits for both analyses and returns B minus A', async () => {
    const { store, analysis } = setupReal();
    await runAction('selectSite', { site: 'IM-2', atLanding: true });
    await runAction('setMissionWindow', { durationH: 168 });
    expect(await runAction('saveScenario', { slot: 'A' })).toMatchObject({ ok: true, result: { scenario: { label: 'IM-2 Athena' }, labels: { A: 'IM-2 Athena', B: null } } });
    await runAction('setDelay', { hours: 24 });
    expect(await runAction('saveScenario', { slot: 'B' })).toMatchObject({
      ok: true,
      result: { scenario: { label: 'IM-2 Athena (arrival 24 h later)', startUtc: '2025-03-07T17:28Z' }, labels: { A: 'IM-2 Athena (earlier arrival)', B: 'IM-2 Athena (arrival 24 h later)' } },
    });

    const r = await runAction<any>('compare');
    expect(r).toMatchObject({
      ok: true,
      result: {
        comparing: true,
        A: 'IM-2 Athena (earlier arrival)',
        B: 'IM-2 Athena (arrival 24 h later)',
        scenarioA: { startUtc: '2025-03-06T17:28Z', durationH: 168 },
        scenarioB: { startUtc: '2025-03-07T17:28Z', durationH: 168 },
        analysisA: { state: 'ready', scenario: 'IM-2 Athena (earlier arrival)' },
        analysisB: { state: 'ready', scenario: 'IM-2 Athena (arrival 24 h later)' },
        diff: { meaning: 'B minus A' },
      },
    });
    if (!r.ok) return;
    const { analysisA: A, analysisB: B, diff } = r.result;
    for (const key of ['illuminationPct', 'longestDarknessH', 'earthVisiblePct', 'longestEarthGapH', 'slopeDeg']) expect(diff[key]).toBeCloseTo(B[key] - A[key], 1);
    // The later week runs into the eclipse of 14 March 2025 (Earth in front of the Sun), the earlier one does not.
    expect(diff.illuminationPct).toBeLessThan(0);
    expect(diff.longestDarknessH).toBeGreaterThan(1);
    expect(diff.highlights.length).toBeGreaterThan(0);
    expect(typeof diff.highlights[0]).toBe('string');
    expect(store.get().comparing).toBe(true);
    expect(JSON.parse(JSON.stringify(r.result))).toEqual(r.result);

    // A different mast at the original time: both names follow, and nothing is left "loading".
    await runAction('setDelay', { hours: 0 });
    await runAction('setMastHeight', { metres: 10 });
    await runAction('saveScenario', { slot: 'B' });
    expect(await runAction('compare')).toMatchObject({ ok: true, result: { A: 'IM-2 Athena (2 m mast)', B: 'IM-2 Athena (10 m mast)', analysisA: { state: 'ready' }, analysisB: { state: 'ready' }, diff: { meaning: 'B minus A' } } });
    analysis.stop();
  }, LONG);

  it('says which side failed instead of showing a difference', async () => {
    resetActions();
    const store = new Store(initialState(T0));
    const fake = (sc: { mastHeightM: number }) => ({ scenario: sc, metrics: { illuminationPct: 40, longestDarknessH: 3, earthVisiblePct: 90, longestEarthGapH: 1 }, slope: { slopeDeg: 4 }, warnings: [] }) as unknown as SiteAnalysis;
    const analysis = new AnalysisStore(store, { analyse: (sc) => (sc.mastHeightM > 50 ? Promise.reject(new Error('no elevation data here')) : Promise.resolve(fake(sc))), rankNearby: () => Promise.resolve([]) }, 200);
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => CATALOGUE, analysis }));
    await runAction('selectSite', { site: 'im-2' });
    await runAction('saveScenario', { slot: 'A' });
    await runAction('setMastHeight', { metres: 60 });
    await runAction('saveScenario', { slot: 'B' });
    expect(await runAction('compare')).toMatchObject({
      ok: true,
      result: { comparing: true, analysisA: { state: 'ready', illuminationPct: 40 }, analysisB: { state: 'error', error: 'no elevation data here' }, diff: null, error: 'B (IM-2 Athena (60 m mast)): no elevation data here' },
    });
  });
});
