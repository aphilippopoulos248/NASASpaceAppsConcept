import { describe, expect, it } from 'vitest';
import { analyseStack, outlookStack } from '../../analysis/api';
import { candidateOffsets } from '../../analysis/nearby';
import { fnSource, stackOf } from '../../analysis/testing';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis } from '../../analysis/types';
import { listActions, registerActions, resetActions, runAction } from '../../core/actions';
import { AnalysisStore } from '../../core/analysisStore';
import { createCoreActions } from '../../core/coreActions';
import { MissionFilterStore } from '../../core/missionFilter';
import { initialState, Store } from '../../core/store';
import type { Scenario } from '../../core/types';
import type { Landing } from '../../data/landings';
import { bindWorkingPair, createCompareActions, MAX_NEARBY_CANDIDATES, nearbyPointCount } from './actions';
import { createPanelStore } from './state';
import { createCompareStorage, MAX_SAVED, STORAGE_KEY } from './storage';

const HOUR = 3_600_000;
const T0 = Date.UTC(2025, 2, 6, 17, 28);
const IM2: Landing = { id: 'im-2', name: 'IM-2 Athena', program: 'p', country: 'c', date: '2025-03-06', time: '17:28', lat: -84.79, lon: 29.2, crewed: false, region: 'r', summary: 's' } as Landing;

/** Numbers that follow the scenario, so differences are known: +1 point of sunlight per metre of mast, +1 h of darkness per 12 h of delay. */
const fake = (sc: Scenario): SiteAnalysis =>
  ({
    scenario: sc,
    metrics: { illuminationPct: 40 + sc.mastHeightM, longestDarknessH: 10 + (sc.startMs - T0) / HOUR / 12, darknessOpenEnded: false, earthVisiblePct: 80, longestEarthGapH: 3, earthGapOpenEnded: false },
    slope: { slopeDeg: 4, baselineM: 120 },
    warnings: [],
  }) as unknown as SiteAnalysis;

/** A scan as the science core returns it: two ranked alternatives around the scenario's site (the site itself between them), one too steep, one without data. */
const fakeScan = (sc: Scenario, o: NearbyOptions): NearbyCandidate[] => {
  const at = (e: number, n: number, over: Partial<NearbyCandidate> & { sun?: number }): NearbyCandidate => {
    const isReference = e === 0 && n === 0;
    const lat = sc.site.lat + n / 30_000, lon = sc.site.lon + e / 3_000;
    const scored = over.sun !== undefined;
    return {
      site: isReference ? sc.site : { id: `pin:${lat.toFixed(5)},${lon.toFixed(5)}`, name: `Candidate ${Math.abs(e)} m ${e >= 0 ? 'E' : 'W'} of ${sc.site.name}`, kind: 'candidate', lat, lon },
      eastM: e, northM: n, distanceM: Math.hypot(e, n), bearingDeg: isReference ? NaN : (Math.atan2(e, n) * 180 / Math.PI + 360) % 360, elevationM: 5321,
      slope: { slopeDeg: 3, aspectDeg: 0, baselineM: 120, demName: 'LOLA' },
      metrics: scored ? ({ illuminationPct: over.sun, earthVisiblePct: 100, longestDarknessH: 100 - over.sun!, darknessOpenEnded: false, longestEarthGapH: 0, earthGapOpenEnded: false } as NearbyCandidate['metrics']) : null,
      rejected: null, score: scored ? (over.sun! + 100) / 2 : NaN, rank: 0, isReference,
      basis: `Slope over 120 m from LOLA (60 m grid), the same measure for every candidate. Limit ${o.slopeLimitDeg} deg.`,
      ...over,
    } as NearbyCandidate;
  };
  return [
    at(300, 0, { sun: 90, rank: 1 }),
    at(0, 0, { sun: 80, rank: 2 }),
    at(-600, 0, { sun: 70, rank: 3 }),
    at(900, 0, { rejected: 'slope', slope: { slopeDeg: 21, aspectDeg: 0, baselineM: 120, demName: 'LOLA' } }),
    at(-1200, 0, { rejected: 'no-data', slope: { slopeDeg: NaN, aspectDeg: NaN, baselineM: 120, demName: 'LOLA' } }),
  ];
};

function fakeBackend() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function setup(options: { real?: boolean; backend?: ReturnType<typeof fakeBackend> } = {}) {
  resetActions();
  const store = new Store(initialState(T0));
  const calls: string[] = [];
  const scans: { site: string; options: NearbyOptions }[] = [];
  const analysis = options.real
    ? new AnalysisStore(store, undefined, 200)
    : new AnalysisStore(
        store,
        {
          analyse: (sc) => (calls.push(sc.id), Promise.resolve(fake(sc))),
          rankNearby: (sc, o, onProgress) => {
            scans.push({ site: sc.site.id, options: o });
            onProgress?.(3, 5);
            return Promise.resolve(fakeScan(sc, o));
          },
        },
        200,
      );
  void analysis.start();
  const panel = createPanelStore();
  const backend = options.backend ?? fakeBackend();
  const storage = createCompareStorage(backend);
  registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
  registerActions(createCompareActions({ store, analysis, panel, storage, now: () => Date.UTC(2026, 0, 2, 3, 4, 5) }));
  return { store, analysis, panel, storage, backend, calls, scans };
}

const ok = async (name: string, params: unknown = {}) => {
  const r = await runAction<any>(name, params, 'test');
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  expect(JSON.parse(JSON.stringify(r.result))).toEqual(r.result); // results are plain JSON
  return r.result;
};
const fails = async (name: string, params: unknown = {}) => {
  const r = await runAction(name, params, 'test');
  if (r.ok) throw new Error(`${name} should have failed`);
  return r.error;
};

describe('the compare panel opens through an action', () => {
  it('openCompare opens the panel without touching the scenarios and says what it shows', async () => {
    const { store } = setup();
    expect(await ok('openCompare')).toEqual({ open: true, tab: 'compare', A: null, B: null, comparison: 'idle', emptySlots: ['A', 'B'] });
    expect(store.get()).toMatchObject({ comparing: true, compareA: null, compareB: null });
    await ok('selectSite', { site: 'im-2' });
    await ok('saveScenario', { slot: 'A' });
    expect(await ok('openCompare', { tab: 'compare' })).toMatchObject({ open: true, A: 'IM-2 Athena', B: null, emptySlots: ['B'] });
    expect(await fails('openCompare', { tab: 'elsewhere' })).toMatch(/must be one of/);
    expect(await ok('stopCompare')).toEqual({ comparing: false });
  });

  it('every action has a description and a parameter schema the assistant can use', () => {
    setup();
    const mine = ['openCompare', 'compareDelayedArrival', 'compareMastHeights', 'swapComparison', 'clearComparison', 'saveComparison', 'loadComparison', 'deleteComparison', 'listComparisons', 'rankNearby', 'selectCandidate', 'exportResults', 'showOutlook'];
    const registered = listActions();
    for (const name of mine) {
      const def = registered.find((a) => a.name === name);
      expect(def, name).toBeDefined();
      expect(def!.description.length, name).toBeGreaterThan(40);
      expect(def!.params.type).toBe('object');
    }
  });
});

describe('delayed arrival in one step', () => {
  it('makes B the scenario on screen arriving 24 h later, and leaves the screen scenario alone', async () => {
    const { store, panel } = setup();
    await ok('selectSite', { site: 'im-2' });
    store.set({ windowStartMs: T0, windowDurationH: 168 });
    const r = await ok('compareDelayedArrival');
    expect(r).toMatchObject({
      comparing: true,
      A: 'IM-2 Athena (earlier arrival)',
      B: 'IM-2 Athena (arrival 24 h later)',
      basis: 'current',
      delayH: 24,
      plannedArrivalUtc: '2025-03-06T17:28Z',
      revisedArrivalUtc: '2025-03-07T17:28Z',
      scenarioA: { startUtc: '2025-03-06T17:28Z', endUtc: '2025-03-13T17:28Z', durationH: 168, mastHeightM: 2 },
      scenarioB: { startUtc: '2025-03-07T17:28Z', endUtc: '2025-03-14T17:28Z', durationH: 168, mastHeightM: 2, site: { id: 'im-2' } },
      analysisA: { state: 'ready', longestDarknessH: 10 },
      analysisB: { state: 'ready', longestDarknessH: 12 },
      diff: { meaning: 'B minus A', longestDarknessH: 2, illuminationPct: 0 },
    });
    expect(r.diff.highlights).toEqual(['With IM-2 Athena (arrival 24 h later) the longest darkness is 2.0 h longer than with IM-2 Athena (earlier arrival) (12.0 h vs 10.0 h).']);
    // The scenario on screen keeps its own delay and the clock stays where it was.
    expect(store.get()).toMatchObject({ delayH: 0, windowStartMs: T0, timeMs: T0, comparing: true });
    expect(panel.get().tab).toBe('compare');
  });

  it('starts from the scenario saved in A, keeps a typed label and names B after it', async () => {
    const { store } = setup();
    await ok('selectSite', { site: 'im-2' });
    await ok('saveScenario', { slot: 'A', label: 'Baseline' });
    // The screen moves on to another mast; the what-if is still about A.
    await ok('setMastHeight', { metres: 30 });
    const r = await ok('compareDelayedArrival', { delayH: 36 });
    expect(r).toMatchObject({ A: 'Baseline', B: 'Baseline (arrival 36 h later)', basis: 'A', delayH: 36, scenarioB: { mastHeightM: 2, startUtc: '2025-03-08T05:28Z' }, diff: { longestDarknessH: 3 } });
    // `compare` keeps those names: the label of B is not one the app rewrites.
    expect(await ok('compare')).toMatchObject({ A: 'Baseline', B: 'Baseline (arrival 36 h later)', diff: { longestDarknessH: 3 } });
    // "current" starts over from the screen: the 30 m mast, automatic names.
    expect(await ok('compareDelayedArrival', { delayH: 12, basis: 'current' })).toMatchObject({ A: 'IM-2 Athena (earlier arrival)', B: 'IM-2 Athena (arrival 12 h later)', basis: 'current', scenarioA: { mastHeightM: 30 }, diff: { longestDarknessH: 1 } });
    expect(store.get().mastHeightM).toBe(30);
  });

  it('says what is missing or out of range', async () => {
    const { store } = setup();
    expect(await fails('compareDelayedArrival')).toBe('No site is selected. Select a landing site or drop a pin first.');
    await ok('selectSite', { site: 'im-2' });
    expect(await fails('compareDelayedArrival', { basis: 'A' })).toMatch(/^Slot A is empty/);
    expect(await fails('compareDelayedArrival', { delayH: 0 })).toMatch(/at least 0.1/);
    expect(await fails('compareDelayedArrival', { delayH: 721 })).toMatch(/at most 720/);
    store.set({ windowStartMs: Date.UTC(2099, 11, 20) });
    expect(await fails('compareDelayedArrival', { delayH: 480 })).toMatch(/outside 1950-01-01T00:00Z to 2100-01-01T00:00Z/);
    expect(store.get()).toMatchObject({ compareA: null, compareB: null, comparing: false });
  });
});

describe('two mast heights in one step', () => {
  it('compares the height of A with another one at the same site and window', async () => {
    const { store } = setup();
    await ok('selectSite', { site: 'im-2' });
    const r = await ok('compareMastHeights', { heightBM: 10 });
    expect(r).toMatchObject({
      A: 'IM-2 Athena (2 m mast)',
      B: 'IM-2 Athena (10 m mast)',
      basis: 'current',
      mastHeightAM: 2,
      mastHeightBM: 10,
      scenarioA: { mastHeightM: 2, startUtc: '2025-03-06T17:28Z' },
      scenarioB: { mastHeightM: 10, startUtc: '2025-03-06T17:28Z' },
      diff: { illuminationPct: 8, longestDarknessH: 0 },
    });
    expect(store.get().mastHeightM).toBe(2); // the screen scenario keeps its mast
  });

  it('sets both heights when asked, and refuses two equal heights', async () => {
    setup();
    await ok('selectSite', { site: 'im-2' });
    expect(await ok('compareMastHeights', { heightAM: 5, heightBM: 1.5 })).toMatchObject({ A: 'IM-2 Athena (5 m mast)', B: 'IM-2 Athena (1.5 m mast)', mastHeightAM: 5, mastHeightBM: 1.5, diff: { illuminationPct: -3.5 } });
    // From the saved A (5 m) now: a typed label on A is kept when only B is given.
    await ok('saveScenario', { slot: 'A', label: 'Short mast' });
    expect(await ok('compareMastHeights', { heightBM: 20 })).toMatchObject({ A: 'Short mast', B: 'Short mast (20 m mast)', basis: 'A', mastHeightAM: 2, mastHeightBM: 20 });
    expect(await fails('compareMastHeights', { heightBM: 2 })).toBe('Both sides would have a 2 m mast. Give two different heights.');
    expect(await fails('compareMastHeights', { heightAM: 7, heightBM: 7 })).toMatch(/7 m mast/);
    expect(await fails('compareMastHeights', {})).toMatch(/heightBM is required/);
    expect(await fails('compareMastHeights', { heightBM: 101 })).toMatch(/at most 100/);
  });
});

describe('swap and clear', () => {
  it('swapComparison exchanges the sides, renames them and flips the differences', async () => {
    const { store } = setup();
    await ok('selectSite', { site: 'im-2' });
    await ok('compareDelayedArrival', { delayH: 24 });
    const before = store.get();
    const r = await ok('swapComparison');
    expect(r).toMatchObject({ A: 'IM-2 Athena (arrival 24 h later)', B: 'IM-2 Athena (earlier arrival)', diff: { longestDarknessH: -2 }, analysisA: { longestDarknessH: 12 }, analysisB: { longestDarknessH: 10 } });
    expect(store.get().compareA!.id).toBe(before.compareB!.id);
    expect(store.get().compareB!.id).toBe(before.compareA!.id);
  });

  it('clearComparison empties one slot or both', async () => {
    const { store } = setup();
    expect(await fails('swapComparison')).toMatch(/nothing to swap/);
    await ok('selectSite', { site: 'im-2' });
    await ok('compareMastHeights', { heightBM: 10 });
    // With B gone the remaining side goes back to its plain name.
    expect(await ok('clearComparison', { slot: 'B' })).toEqual({ A: 'IM-2 Athena', B: null });
    expect(await ok('swapComparison')).toEqual({ A: null, B: 'IM-2 Athena' });
    expect(await ok('clearComparison')).toEqual({ A: null, B: null });
    expect(store.get()).toMatchObject({ compareA: null, compareB: null });
  });
});

describe('saved comparisons', () => {
  it('saves the pair with the clock and the requirements, and loads it back exactly', async () => {
    const { store, storage, panel, backend, calls, analysis } = setup();
    await ok('selectSite', { site: 'im-2' });
    await ok('compareDelayedArrival', { delayH: 24 });
    store.set({ timeMs: T0 + 30 * HOUR, sunElMinDeg: 2, sunElMaxDeg: 60, maxEarthGapH: 12, slopeLimitDeg: 8 });
    const pair = { a: store.get().compareA!, b: store.get().compareB! };

    const saved = await ok('saveComparison');
    expect(saved).toEqual({
      saved: { name: 'IM-2 Athena (earlier arrival) vs IM-2 Athena (arrival 24 h later)', savedUtc: '2026-01-02T03:04:05.000Z', A: 'IM-2 Athena, arrival 2025-03-06 17:28 UTC, 24 h window, 2 m mast', B: 'IM-2 Athena, arrival 2025-03-07 17:28 UTC, 24 h window, 2 m mast', clockUtc: '2025-03-07T23:28Z' },
      replaced: false,
      count: 1,
      keptInBrowserStorage: true,
    });
    expect(panel.get().savedRevision).toBe(1);
    expect(await ok('saveComparison', { name: 'Delay study' })).toMatchObject({ saved: { name: 'Delay study' }, replaced: false, count: 2 });
    expect(await ok('saveComparison', { name: ' Delay study ' })).toMatchObject({ replaced: true, count: 2 });
    expect(await ok('listComparisons')).toMatchObject({ comparisons: [{ name: 'Delay study' }, { name: 'IM-2 Athena (earlier arrival) vs IM-2 Athena (arrival 24 h later)' }], keptInBrowserStorage: true });

    // Everything changes, the panel is closed, and the page is "reloaded": a new storage reads the same text.
    await ok('clearComparison');
    await ok('stopCompare');
    store.set({ timeMs: T0 + 900 * HOUR, playing: true, sunElMinDeg: 0, sunElMaxDeg: 90, maxEarthGapH: null, slopeLimitDeg: 10 });
    await analysis.refresh(); // the emptied slots are published as empty
    expect(analysis.get('A').state).toBe('idle');
    expect(createCompareStorage(backend).get('Delay study')).toEqual(storage.get('Delay study'));

    const analysed = calls.length;
    const r = await ok('loadComparison', { name: 'Delay study' });
    expect(r).toMatchObject({
      loaded: 'Delay study',
      savedUtc: '2026-01-02T03:04:05.000Z',
      restored: { clockUtc: '2025-03-07T23:28Z', requirements: { sunElMinDeg: 2, sunElMaxDeg: 60, maxEarthGapH: 12, slopeLimitDeg: 8 } },
      comparing: true,
      A: 'IM-2 Athena (earlier arrival)',
      B: 'IM-2 Athena (arrival 24 h later)',
      diff: { longestDarknessH: 2 },
    });
    expect(store.get().compareA).toEqual(pair.a);
    expect(store.get().compareB).toEqual(pair.b);
    expect(store.get()).toMatchObject({ timeMs: T0 + 30 * HOUR, playing: false, sunElMinDeg: 2, sunElMaxDeg: 60, maxEarthGapH: 12, slopeLimitDeg: 8, comparing: true });
    expect(calls.slice(analysed).sort()).toEqual([pair.a.id, pair.b.id].sort()); // the same two analyses, by identity

    expect(await ok('deleteComparison', { name: 'Delay study' })).toEqual({ deleted: 'Delay study', count: 1 });
    expect(await fails('deleteComparison', { name: 'Delay study' })).toBe('No saved comparison is called "Delay study".');
    expect(await fails('loadComparison', { name: 'Delay study' })).toBe('No saved comparison is called "Delay study". Saved: "IM-2 Athena (earlier arrival) vs IM-2 Athena (arrival 24 h later)".');
  });

  it('needs both slots, and says which saved pair made room for a new one', async () => {
    const { storage } = setup();
    expect(await fails('saveComparison')).toBe('Slot A and B is empty: a saved comparison holds both A and B.');
    expect(await fails('loadComparison', { name: 'x' })).toBe('No saved comparison is called "x". None is saved yet (saveComparison).');
    await ok('selectSite', { site: 'im-2' });
    await ok('saveScenario', { slot: 'A' });
    expect(await fails('saveComparison', { name: 'half' })).toBe('Slot B is empty: a saved comparison holds both A and B.');
    await ok('compareMastHeights', { heightBM: 10 });
    expect(await fails('saveComparison', { name: '   ' })).toBe('Give the saved comparison a name.');
    for (let i = 0; i < MAX_SAVED; i++) await ok('saveComparison', { name: `pair ${i}` });
    expect(await ok('saveComparison', { name: 'one more' })).toMatchObject({ replaced: false, droppedOldest: 'pair 0', count: MAX_SAVED });
    expect(storage.get('pair 0')).toBeUndefined();
  });

  it('says so when the browser gives the page no storage', async () => {
    resetActions();
    const store = new Store(initialState(T0));
    const analysis = new AnalysisStore(store, { analyse: (sc) => Promise.resolve(fake(sc)), rankNearby: () => Promise.resolve([]) });
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
    registerActions(createCompareActions({ store, analysis, panel: createPanelStore(), storage: createCompareStorage(null) }));
    await ok('selectSite', { site: 'im-2' });
    await ok('compareMastHeights', { heightBM: 10 });
    const r = await ok('saveComparison', { name: 'kept for now' });
    expect(r.keptInBrowserStorage).toBe(false);
    expect(r.note).toMatch(/last only until the page is closed/);
    expect(await ok('loadComparison', { name: 'kept for now' })).toMatchObject({ loaded: 'kept for now', diff: { illuminationPct: 8 } });
  });
});

describe('the working pair survives a reload', () => {
  it('writes every change of A and B and puts them back into empty slots', async () => {
    const first = setup();
    const unbind = bindWorkingPair(first.store, first.storage);
    await ok('selectSite', { site: 'im-2' });
    await ok('compareDelayedArrival', { delayH: 24 });
    const pair = { a: first.store.get().compareA!, b: first.store.get().compareB! };
    expect(JSON.parse(first.backend.map.get(STORAGE_KEY)!).current).toEqual(pair);
    unbind();

    // The next page load: same storage text, a fresh app state.
    const second = setup({ backend: first.backend });
    expect(second.store.get().compareA).toBeNull();
    bindWorkingPair(second.store, second.storage);
    expect(second.store.get().compareA).toEqual(pair.a);
    expect(second.store.get().compareB).toEqual(pair.b);
    expect(second.store.get().comparing).toBe(false); // the pair comes back; the panel does not open by itself
    expect(await ok('compare')).toMatchObject({ A: 'IM-2 Athena (earlier arrival)', B: 'IM-2 Athena (arrival 24 h later)', diff: { longestDarknessH: 2 } });

    await ok('clearComparison', { slot: 'A' });
    expect(JSON.parse(first.backend.map.get(STORAGE_KEY)!).current).toMatchObject({ a: null, b: { label: 'IM-2 Athena' } });
  });

  it('does not overwrite slots that are already filled', async () => {
    const first = setup();
    bindWorkingPair(first.store, first.storage);
    await ok('selectSite', { site: 'im-2' });
    await ok('compareMastHeights', { heightBM: 10 });
    const second = setup({ backend: first.backend });
    await ok('selectSite', { site: 'im-2' });
    await ok('saveScenario', { slot: 'A', label: 'Fresh' });
    bindWorkingPair(second.store, second.storage);
    expect(second.store.get()).toMatchObject({ compareA: { label: 'Fresh' }, compareB: null });
    expect(JSON.parse(first.backend.map.get(STORAGE_KEY)!).current).toMatchObject({ a: { label: 'Fresh' }, b: null });
  });
});

describe('nearby alternatives', () => {
  it('rankNearby scans around the site on screen, opens its tab and returns the ranked list', async () => {
    const { store, panel, scans } = setup();
    expect(await fails('rankNearby')).toBe('No site is selected. Select a landing site or drop a pin first, then scan around it.');
    await ok('selectSite', { site: 'im-2' });
    const r = await ok('rankNearby', { radiusM: 1500, spacingM: 250, slopeLimitDeg: 8 });
    expect(scans).toEqual([{ site: 'im-2', options: { radiusM: 1500, spacingM: 250, slopeLimitDeg: 8, weightSun: 1, weightEarth: 1, azStepDeg: 1, stepMin: 30 } }]);
    expect(store.get()).toMatchObject({ comparing: true, slopeLimitDeg: 8 });
    expect(panel.get()).toMatchObject({ tab: 'nearby', nearbyRadiusM: 1500, nearbySpacingM: 250 });
    expect(r).toMatchObject({
      scenario: { site: { id: 'im-2' }, startUtc: '2025-03-06T17:28Z', durationH: 24, mastHeightM: 2 },
      options: { radiusM: 1500, spacingM: 250, slopeLimitDeg: 8 },
      scanned: 5,
      rankedCount: 2,
      betterThanReference: 1,
      rejected: { slope: 1, noData: 1 },
      reference: { rank: 0, id: 'im-2', name: 'IM-2 Athena', isReference: true, overSlopeLimit: false, distanceM: 0, bearingDeg: null, illuminationPct: 80, longestDarknessH: 20, earthVisiblePct: 100, score: 90 },
      basis: 'Slope over 120 m from LOLA (60 m grid), the same measure for every candidate. Limit 8 deg.',
    });
    // The alternatives are numbered without the site itself: 1 = best.
    expect(r.candidates).toEqual([
      { rank: 1, id: 'pin:-84.79000,29.30000', name: 'Candidate 300 m E of IM-2 Athena', latDeg: -84.79, lonDegEast: 29.3, distanceM: 300, bearingDeg: 90, elevationM: 5321, slopeDeg: 3, illuminationPct: 90, longestDarknessH: 10, earthVisiblePct: 100, longestEarthGapH: 0, score: 95 },
      { rank: 2, id: 'pin:-84.79000,29.00000', name: 'Candidate 600 m W of IM-2 Athena', latDeg: -84.79, lonDegEast: 29, distanceM: 600, bearingDeg: 270, elevationM: 5321, slopeDeg: 3, illuminationPct: 70, longestDarknessH: 30, earthVisiblePct: 100, longestEarthGapH: 0, score: 85 },
    ]);
    expect(r.ranking).toMatch(/mean of illuminationPct and earthVisiblePct/);
    // Defaults: 2 km, 300 m, the current slope limit.
    await ok('rankNearby');
    expect(scans[1].options).toMatchObject({ radiusM: 2000, spacingM: 300, slopeLimitDeg: 8 });
  });

  it('refuses a grid the scan cannot take, before starting it', async () => {
    const { scans } = setup();
    await ok('selectSite', { site: 'im-2' });
    expect(await fails('rankNearby', { radiusM: 20_000, spacingM: 100 })).toBe('A 100 m grid out to 20000 m has 160,801 points; a scan takes at most 2,000. Widen the spacing or shorten the radius.');
    expect(await fails('rankNearby', { radiusM: 100, spacingM: 300 })).toBe('A 300 m grid out to 100 m holds only the site itself. Shorten the spacing or widen the radius.');
    expect(await fails('rankNearby', { radiusM: 10 })).toMatch(/at least 50/);
    expect(scans).toEqual([]);
    // The count is the science core's own grid.
    expect(nearbyPointCount(2000, 300)).toBe(candidateOffsets(2000, 300).length);
    expect(nearbyPointCount(2000, 300)).toBe(137);
    expect(nearbyPointCount(7000, 300)).toBe(candidateOffsets(7000, 300).length);
    expect(candidateOffsets(7000, 300).length).toBeLessThanOrEqual(MAX_NEARBY_CANDIDATES);
    expect(nearbyPointCount(50_000, 10)).toBeGreaterThan(1e8);
    expect(Number.isNaN(nearbyPointCount(1000, 0))).toBe(true);
  });

  it('selectCandidate pins a ranked alternative as the site on screen', async () => {
    const { store } = setup();
    expect(await fails('selectCandidate', { rank: 1 })).toBe('There is no ranked list of nearby sites yet. Run rankNearby first.');
    await ok('selectSite', { site: 'im-2' });
    await ok('rankNearby');
    expect(await fails('selectCandidate', {})).toBe('Give exactly one of `rank` or `id`.');
    expect(await fails('selectCandidate', { rank: 1, id: 'x' })).toBe('Give exactly one of `rank` or `id`.');
    expect(await fails('selectCandidate', { rank: 3 })).toBe('There is no candidate ranked 3: the last scan (around IM-2 Athena) ranked 2.');
    expect(await fails('selectCandidate', { id: 'im-2' })).toBe('That id is the scanned site itself, not an alternative.');
    expect(await fails('selectCandidate', { id: 'pin:0.00000,0.00000' })).toMatch(/^No ranked candidate of the last scan/);

    const r = await ok('selectCandidate', { rank: 2 });
    expect(r).toEqual({
      view: 'globe',
      site: { id: 'pin:-84.79000,29.00000', name: 'Candidate 600 m W of IM-2 Athena', kind: 'candidate', latDeg: -84.79, lonDegEast: 29 },
      candidate: expect.objectContaining({ rank: 2, illuminationPct: 70, distanceM: 600 }),
      scannedAround: 'IM-2 Athena',
    });
    expect(store.get().site).toEqual({ id: 'pin:-84.79000,29.00000', name: 'Candidate 600 m W of IM-2 Athena', kind: 'candidate', lat: -84.79, lon: 29 });
    expect(store.get().globeCenter).toMatchObject({ lat: -84.79, lon: 29 }); // the globe flies there
    expect(store.get()).toMatchObject({ compareA: null, compareB: null });
    // The list stays, so another row can be chosen, by id as well.
    expect(await ok('selectCandidate', { id: 'pin:-84.79000,29.30000' })).toMatchObject({ site: { name: 'Candidate 300 m E of IM-2 Athena' }, candidate: { rank: 1 } });
  });

  it('selectCandidate { asB } compares the candidate with the scanned site over the scanned window', async () => {
    const { store, panel } = setup();
    await ok('selectSite', { site: 'im-2' });
    store.set({ windowDurationH: 72, mastHeightM: 5 });
    await ok('rankNearby');
    // The screen moves on before the choice: B still gets the scanned window and mast.
    store.set({ windowDurationH: 24, mastHeightM: 2 });
    const r = await ok('selectCandidate', { rank: 1, asB: true });
    expect(r).toMatchObject({
      site: { kind: 'candidate', name: 'Candidate 300 m E of IM-2 Athena' },
      comparing: true,
      A: 'IM-2 Athena',
      B: 'Candidate 300 m E of IM-2 Athena',
      scenarioA: { site: { id: 'im-2' }, durationH: 72, mastHeightM: 5, startUtc: '2025-03-06T17:28Z' },
      scenarioB: { site: { id: 'pin:-84.79000,29.30000', kind: 'candidate' }, durationH: 72, mastHeightM: 5, startUtc: '2025-03-06T17:28Z' },
      analysisA: { state: 'ready' },
      analysisB: { state: 'ready' },
      diff: { meaning: 'B minus A' },
    });
    expect(panel.get().tab).toBe('compare');
    expect(store.get().site?.kind).toBe('candidate');

    // A scenario already saved in A stays there.
    await ok('selectSite', { site: 'im-2' });
    await ok('saveScenario', { slot: 'A', label: 'Baseline' });
    await ok('rankNearby');
    expect(await ok('selectCandidate', { rank: 2, asB: true })).toMatchObject({ A: 'Baseline', B: 'Candidate 600 m W of IM-2 Athena', scenarioA: { durationH: 24 } });
  });

  it('the assistant\'s own sequence works: save A, pin the candidate, save B, compare', async () => {
    setup();
    await ok('selectSite', { site: 'im-2' });
    await ok('rankNearby');
    await ok('saveScenario', { slot: 'A' });
    await ok('selectCandidate', { rank: 1 });
    await ok('saveScenario', { slot: 'B' });
    expect(await ok('compare')).toMatchObject({ A: 'IM-2 Athena', B: 'Candidate 300 m E of IM-2 Athena', analysisA: { state: 'ready' }, analysisB: { state: 'ready' } });
  });

  it('says when the scan itself failed', async () => {
    resetActions();
    const store = new Store(initialState(T0));
    const analysis = new AnalysisStore(store, { analyse: (sc) => Promise.resolve(fake(sc)), rankNearby: () => Promise.reject(new Error('the 60 m window could not be read')) });
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
    registerActions(createCompareActions({ store, analysis, panel: createPanelStore(), storage: createCompareStorage(null) }));
    await ok('selectSite', { site: 'im-2' });
    expect(await fails('rankNearby')).toBe('The scan is not available: the 60 m window could not be read');
    expect(await fails('selectCandidate', { rank: 1 })).toBe('There is no ranked list of nearby sites yet. Run rankNearby first.');
  });
});

describe('the mission-window table and its export', () => {
  /** Real analyses on a smooth Moon (fast), and a download that only records what it was given. */
  function setupExport(withDownload = true) {
    resetActions();
    const store = new Store(initialState(Date.UTC(2025, 2, 13)));
    const smooth = stackOf(fnSource('smooth sphere', 60, () => 0));
    const analysis = new AnalysisStore(store, { analyse: (sc) => analyseStack(sc, smooth), rankNearby: () => Promise.resolve([]) });
    const panel = createPanelStore();
    const files: { filename: string; mimeType: string; text: string }[] = [];
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
    registerActions(createCompareActions({ store, analysis, panel, storage: createCompareStorage(null), now: () => Date.UTC(2026, 10, 15, 1, 2, 3), ...(withDownload && { download: (filename, mimeType, text) => void files.push({ filename, mimeType, text }) }) }));
    return { store, panel, files };
  }

  it('openCompare { table } shows the window table of the scenario on screen or of a slot', async () => {
    const { panel } = setupExport();
    expect(await ok('openCompare', { table: 'A' })).toMatchObject({ open: true, tab: 'windows', table: 'A' });
    expect(panel.get()).toMatchObject({ tab: 'windows', tableSlot: 'A' });
    expect(await ok('openCompare', { tab: 'compare' })).not.toHaveProperty('table');
    expect(await ok('openCompare', { tab: 'windows' })).toMatchObject({ table: 'A' });
    expect(await fails('openCompare', { table: 'C' })).toMatch(/must be one of: current, A, B/);
  });

  it('exportResults: the scenario on screen as CSV, slots as JSON, A and B together with the differences', async () => {
    const { store, files } = setupExport();
    expect(await fails('exportResults', { format: 'csv' })).toBe('No site is selected. Select a landing site or drop a pin first.');
    await ok('dropPin', { lat: 0, lon: 0 });
    await ok('setMissionWindow', { startUtc: '2025-03-13T00:00Z', durationH: 48 });
    const r = await ok('exportResults', { format: 'csv' });
    expect(r).toMatchObject({ format: 'csv', filename: 'lunyx_pin_0.00000_0.00000_2025-03-13T0000Z_48h_2m.csv', mimeType: 'text/csv;charset=utf-8', scenarios: [{ slot: 'current' }], spells: 5, passages: 0, downloaded: true });
    expect(files).toHaveLength(1);
    expect(r.bytes).toBe(new TextEncoder().encode(files[0].text).length);
    const lines = files[0].text.trimEnd().split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[2]).toMatch(/,sun,Dark,2025-03-14T05:44:08Z,2025-03-14T08:10:04Z,/);

    expect(await fails('exportResults', { format: 'json', slot: 'B' })).toBe('Comparison slot B is empty. Save a scenario there first (saveScenario).');
    await ok('compareDelayedArrival', { delayH: 24 * 7 });
    const j = await ok('exportResults', { format: 'json', slot: 'AB' });
    expect(j).toMatchObject({ format: 'json', mimeType: 'application/json', scenarios: [{ slot: 'A' }, { slot: 'B' }] });
    expect(j.filename).toBe('lunyx_compare_A_pin_0.00000_0.00000_2025-03-13T0000Z_48h_2m_B_pin_0.00000_0.00000_2025-03-20T0000Z_48h_2m.json');
    const doc = JSON.parse(files[1].text);
    expect(doc.exportedUtc).toBe('2026-11-15T01:02:03Z');
    expect(doc.scenarios.map((x: { scenario: { startUtc: string } }) => x.scenario.startUtc)).toEqual(['2025-03-13T00:00Z', '2025-03-20T00:00Z']);
    expect(doc.comparison).toMatchObject({ meaning: 'B minus A' });
    // The requirements are checked with the Sun's elevation at the clock.
    expect(typeof doc.scenarios[0].requirements.sunElevationBand.sunElNowDeg).toBe('number');
    // The default is what the window table shows.
    await ok('openCompare', { table: 'B' });
    expect(await ok('exportResults', { format: 'csv' })).toMatchObject({ scenarios: [{ slot: 'B' }] });
    expect(store.get().comparing).toBe(true);
  });

  it('says so when files cannot be downloaded, or the analysis failed', async () => {
    setupExport(false);
    await ok('dropPin', { lat: 0, lon: 0 });
    expect(await fails('exportResults', { format: 'csv' })).toBe('Files cannot be downloaded in this session.');
    resetActions();
    const store = new Store(initialState(T0));
    const analysis = new AnalysisStore(store, { analyse: () => Promise.reject(new Error('the terrain could not be read')), rankNearby: () => Promise.resolve([]) });
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
    registerActions(createCompareActions({ store, analysis, panel: createPanelStore(), storage: createCompareStorage(null), download: () => undefined }));
    await ok('selectSite', { site: 'im-2' });
    expect(await fails('exportResults', { format: 'json' })).toBe('The analysis of the scenario on screen is not available: the terrain could not be read');
  });
});

describe('the seasonal outlook', () => {
  function setupOutlook(fail = false) {
    resetActions();
    const store = new Store(initialState(Date.UTC(2025, 2, 10)));
    const smooth = stackOf(fnSource('smooth sphere', 60, () => 0));
    const analysis = new AnalysisStore(store, { analyse: (sc) => analyseStack(sc, smooth), rankNearby: () => Promise.resolve([]) });
    const panel = createPanelStore();
    const asked: { label: string; months?: number }[] = [];
    const outlook = (sc: Scenario, o: { months?: number }) => {
      asked.push({ label: sc.label, months: o.months });
      return fail ? Promise.reject(new Error('the terrain could not be read')) : Promise.resolve(outlookStack(sc, smooth, o));
    };
    registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
    registerActions(createCompareActions({ store, analysis, panel, storage: createCompareStorage(null), outlook }));
    return { store, panel, asked };
  }

  it('showOutlook computes the outlook of the scenario on screen, opens its tab and reports it', async () => {
    const { store, panel, asked } = setupOutlook();
    expect(await fails('showOutlook')).toBe('No site is selected. Select a landing site or drop a pin first.');
    await ok('dropPin', { lat: 0, lon: 0 });
    await ok('setMissionWindow', { startUtc: '2025-03-10T00:00Z', durationH: 72 });
    const r = await ok('showOutlook', { months: 3 });
    expect(asked).toEqual([{ label: 'Pin 0.000° N, 0.000° E, arrival 2025-03-10 00:00 UTC, 3-day window, 2 m mast', months: 3 }]);
    expect(store.get().comparing).toBe(true);
    expect(panel.get()).toMatchObject({ tab: 'outlook', outlookSlot: 'current', outlookMonths: 3, outlook: { state: 'ready', months: 3 } });
    expect(r).toMatchObject({ slot: 'current', months: 3, missionH: 72, span: { startUtc: '2025-03-10T00:00Z' }, scenario: { site: { latDeg: 0, lonDegEast: 0 } } });
    expect(r.lunarDays).toHaveLength(3);
    // On a smooth Moon at the equator about half of every lunar day is sunlit and Earth's centre is always in view.
    for (const d of r.lunarDays) {
      expect(d.illuminationPct).toBeGreaterThan(45);
      expect(d.illuminationPct).toBeLessThan(55);
      expect(d.earthVisiblePct).toBe(100);
      // Any part of Earth's disc, beside its centre (D-8).
      expect(d.earthAnyPct).toBe(100);
    }
    expect(r.planned).toMatchObject({ arrivalUtc: '2025-03-10T00:00Z', slipDays: 0 });
    expect(r.best.score).toBeGreaterThanOrEqual(r.planned.score);
    expect(r.worst.score).toBeLessThanOrEqual(r.planned.score);
    expect(r.slips.map((x: { slipDays: number }) => x.slipDays)).toEqual([1, 3, 7, 14, 28]);
    const week = r.slips[2];
    expect(week.scoreChange).toBeCloseTo(week.score - r.planned.score, 1);
    expect(week.longestDarknessChangeH).toBeCloseTo(week.longestDarknessH - r.planned.longestDarknessH, 1);
    expect(r.highlights.length).toBeGreaterThan(2);
    expect(r.scoring).toMatch(/mean of illuminationPct and earthVisiblePct/);
    // Defaults: the span and the scenario last used.
    await ok('showOutlook');
    expect(asked[1].months).toBe(3);
  });

  it('for a comparison slot, refused past 2100, and a failure is said, not drawn', async () => {
    const { store, panel } = setupOutlook();
    expect(await fails('showOutlook', { slot: 'A' })).toBe('Comparison slot A is empty. Save a scenario there first (saveScenario).');
    await ok('dropPin', { lat: 0, lon: 0 });
    await ok('saveScenario', { slot: 'A', label: 'Baseline' });
    expect(await ok('showOutlook', { slot: 'A', months: 1 })).toMatchObject({ slot: 'A', scenario: { label: 'Baseline' } });
    expect(await fails('showOutlook', { months: 61 })).toMatch(/at most 60/);
    store.set({ windowStartMs: Date.UTC(2099, 6, 1) });
    expect(await fails('showOutlook', { slot: 'current', months: 12 })).toMatch(/would run past 2100-01-01T00:00Z/);

    const broken = setupOutlook(true);
    await ok('dropPin', { lat: 0, lon: 0 });
    expect(await fails('showOutlook')).toBe('The outlook is not available: the terrain could not be read');
    expect(broken.panel.get().outlook).toMatchObject({ state: 'error', error: 'the terrain could not be read' });
    expect(panel.get().outlook.state).toBe('ready');
  });
});

describe('on the real science core (bundled terrain, no network)', () => {
  it('the one-step delayed arrival and `compare` report the same comparison at a south-polar site', async () => {
    const { store, analysis } = setup({ real: true });
    await ok('selectSite', { site: 'im-2', atLanding: true });
    const r = await ok('compareDelayedArrival', { delayH: 24 });
    expect(r).toMatchObject({ A: 'IM-2 Athena (earlier arrival)', B: 'IM-2 Athena (arrival 24 h later)', analysisA: { state: 'ready' }, analysisB: { state: 'ready' }, plannedArrivalUtc: '2025-03-06T17:28Z', revisedArrivalUtc: '2025-03-07T17:28Z' });
    for (const side of [r.analysisA, r.analysisB]) {
      expect(side.illuminationPct).toBeGreaterThanOrEqual(0);
      expect(side.illuminationPct).toBeLessThanOrEqual(100);
      expect(side.earthVisiblePct).toBeGreaterThanOrEqual(0);
      expect(side.slopeDeg).toBeGreaterThan(0);
    }
    expect(r.diff.illuminationPct).toBeCloseTo(r.analysisB.illuminationPct - r.analysisA.illuminationPct, 1);
    expect(r.diff.highlights.length).toBeGreaterThan(0);
    const again = await ok('compare');
    expect(again.diff).toEqual(r.diff);
    expect(again.analysisA).toEqual(r.analysisA);
    expect(again.analysisB).toEqual(r.analysisB);
    // What the panel reads is that same comparison.
    const c = analysis.comparison();
    expect(c.state).toBe('ready');
    if (c.state === 'ready') expect(c.diff.highlights).toEqual(r.diff.highlights);
    expect(store.get().delayH).toBe(0);
    analysis.stop();
  }, 90_000);
});
