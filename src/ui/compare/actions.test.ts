import { describe, expect, it } from 'vitest';
import type { SiteAnalysis } from '../../analysis/types';
import { listActions, registerActions, resetActions, runAction } from '../../core/actions';
import { AnalysisStore } from '../../core/analysisStore';
import { createCoreActions } from '../../core/coreActions';
import { MissionFilterStore } from '../../core/missionFilter';
import { initialState, Store } from '../../core/store';
import type { Scenario } from '../../core/types';
import type { Landing } from '../../data/landings';
import { bindWorkingPair, createCompareActions } from './actions';
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

function fakeBackend() {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

function setup(options: { real?: boolean; backend?: ReturnType<typeof fakeBackend> } = {}) {
  resetActions();
  const store = new Store(initialState(T0));
  const calls: string[] = [];
  const analysis = options.real
    ? new AnalysisStore(store, undefined, 200)
    : new AnalysisStore(store, { analyse: (sc) => (calls.push(sc.id), Promise.resolve(fake(sc))), rankNearby: () => Promise.resolve([]) }, 200);
  void analysis.start();
  const panel = createPanelStore();
  const backend = options.backend ?? fakeBackend();
  const storage = createCompareStorage(backend);
  registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [IM2], analysis }));
  registerActions(createCompareActions({ store, analysis, panel, storage, now: () => Date.UTC(2026, 0, 2, 3, 4, 5) }));
  return { store, analysis, panel, storage, backend, calls };
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
    const mine = ['openCompare', 'compareDelayedArrival', 'compareMastHeights', 'swapComparison', 'clearComparison', 'saveComparison', 'loadComparison', 'deleteComparison', 'listComparisons'];
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
