import { describe, expect, it } from 'vitest';
import { NotImplemented } from '../analysis/api';
import type { SiteAnalysis } from '../analysis/types';
import { AnalysisStore, NOT_AVAILABLE_TEXT } from './analysisStore';
import { scenarioFromState } from './scenario';
import { initialState, Store } from './store';
import type { Scenario } from './types';

const site = { id: 'apollo-11', name: 'Apollo 11', kind: 'landing' as const, lat: 0.674, lon: 23.473 };
const fake = (sc: Scenario) => ({ scenario: sc, metrics: { illuminationPct: 50, longestDarknessH: 1, earthVisiblePct: 100, longestEarthGapH: 0 }, slope: { slopeDeg: 2 }, warnings: [] }) as unknown as SiteAnalysis;

describe('analysis store', () => {
  it('shows "not available yet" (never numbers) when a science function is not implemented', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store, {
      analyse: () => Promise.reject(new NotImplemented('analyse')),
      rankNearby: () => Promise.reject(new NotImplemented('rankNearby')),
    });
    await a.start();
    expect(a.get('current')).toEqual({ state: 'idle' });
    store.set({ site });
    await a.refresh();
    expect(a.get('current')).toMatchObject({ state: 'error', notAvailable: true, error: NOT_AVAILABLE_TEXT });
    expect(a.summary('current')).not.toHaveProperty('illuminationPct');
    const n = await a.requestNearby({ radiusM: 5000, spacingM: 500, slopeLimitDeg: 10, weightSun: 1, weightEarth: 1 });
    expect(n).toMatchObject({ state: 'error', notAvailable: true });
  });

  it('runs the real science core on bundled terrain, with no network', async () => {
    // Apollo 11, the 24 h after touchdown: lunar morning on the near side, so the Sun and
    // Earth are both up the whole time. Chang'e 4 is on the far side: Earth is never visible.
    const store = new Store({ ...initialState(Date.UTC(1969, 6, 20, 20, 17)), windowDurationH: 24 });
    const a = new AnalysisStore(store);
    store.set({ site });
    await a.refresh();
    const near = a.get('current');
    expect(near.state).toBe('ready');
    if (near.state !== 'ready') return;
    expect(near.value.metrics.illuminationPct).toBeGreaterThan(99.9);
    expect(near.value.metrics.earthVisiblePct).toBe(100);
    expect(near.value.metrics.longestDarknessH).toBe(0);
    expect(near.value.horizon.layers.length).toBeGreaterThan(1);
    expect(a.summary('current')).toMatchObject({ state: 'ready', earthVisiblePct: 100 });

    store.set({ site: { id: 'change-4', name: "Chang'e 4", kind: 'landing' as const, lat: -45.4446, lon: 177.5991 }, windowStartMs: Date.UTC(2019, 0, 3, 2, 26) });
    await a.refresh();
    const far = a.get('current');
    expect(far.state).toBe('ready');
    if (far.state !== 'ready') return;
    expect(far.value.metrics.earthVisiblePct).toBe(0);
    expect(far.value.metrics.longestEarthGapH).toBeCloseTo(24, 0);
    expect(far.value.metrics.earthGapOpenEnded).toBe(true);
  });

  it('analyses the current scenario and slots A/B once each, ignoring stale results', async () => {
    const store = new Store(initialState(0));
    const calls: string[] = [];
    const resolvers: (() => void)[] = [];
    const a = new AnalysisStore(store, {
      analyse: (sc) => {
        calls.push(sc.id);
        return new Promise((r) => resolvers.push(() => r(fake(sc))));
      },
      rankNearby: () => Promise.reject(new NotImplemented('rankNearby')),
    });
    const seen: string[] = [];
    a.subscribe((slot) => seen.push(`${slot}:${a.get(slot as 'current').state}`));
    void a.start();
    store.set({ site });
    store.set({ mastHeightM: 10 }); // supersedes the first request
    expect(a.get('current').state).toBe('loading');
    resolvers.forEach((r) => r());
    await new Promise((r) => setTimeout(r, 0));
    const st = a.get('current');
    expect(st.state === 'ready' && st.scenario.mastHeightM).toBe(10);
    expect(a.summary('current')).toMatchObject({ state: 'ready', illuminationPct: 50 });
    const current = scenarioFromState(store.get())!;
    store.set({ compareA: current });
    expect(calls.filter((c) => c === current.id).length).toBe(2); // once for "current", once for slot A
    resolvers[resolvers.length - 1]();
    await a.refresh(); // joins the analysis already running; starts nothing new
    expect(a.get('A').state).toBe('ready');
    expect(calls.length).toBe(3);
    store.set({ rate: 1 }); // not part of a scenario: no new analysis
    expect(calls.length).toBe(3);
    expect(seen[0]).toBe('current:loading');
  });

  it('settled() waits out the debounce and the analysis, and follows the scenario if it changes meanwhile', async () => {
    const store = new Store(initialState(0));
    const resolvers = new Map<string, () => void>();
    const a = new AnalysisStore(
      store,
      { analyse: (sc) => new Promise((r) => resolvers.set(sc.id, () => r(fake(sc)))), rankNearby: () => Promise.resolve([]) },
      10_000, // a debounce far longer than the test: settled() must not wait for it
    );
    void a.start();
    expect(await a.settled('current')).toEqual({ state: 'idle' });

    store.set({ site });
    expect(a.get('current').state).toBe('idle'); // nothing published yet: the debounce is running
    let result: unknown = null;
    const waiting = a.settled('current').then((st) => (result = st));
    await Promise.resolve();
    expect(a.get('current').state).toBe('loading');
    // The mast changes while the first analysis is still running: the answer must be for the new scenario.
    store.set({ mastHeightM: 10 });
    const first = scenarioFromState({ ...store.get(), mastHeightM: 2 })!.id;
    resolvers.get(first)!();
    await new Promise((r) => setTimeout(r, 0));
    expect(result).toBeNull();
    resolvers.get(scenarioFromState(store.get())!.id)!();
    const st = await waiting;
    expect(st).toMatchObject({ state: 'ready', scenario: { mastHeightM: 10 } });
    // Asking again does not analyse again.
    expect(await a.settled('current')).toBe(a.get('current'));
    expect(resolvers.size).toBe(2);
    a.stop();
  });

  it('settled() returns the reason when the analysis fails, and idle for an empty slot', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store, { analyse: () => Promise.reject(new Error('DEM tile missing')), rankNearby: () => Promise.resolve([]) });
    store.set({ site });
    expect(await a.settled('current')).toMatchObject({ state: 'error', error: 'DEM tile missing' });
    expect(await a.settled('B')).toEqual({ state: 'idle' });
  });

  it('compares A and B once both are ready, once, and follows a change of label without analysing again', async () => {
    const store = new Store(initialState(0));
    let analyses = 0, comparisons = 0;
    const a = new AnalysisStore(store, {
      analyse: async (sc) => {
        analyses++;
        return fake(sc);
      },
      rankNearby: () => Promise.resolve([]),
      compare: (x, y) => {
        comparisons++;
        return { illuminationPct: 1, longestDarknessH: 2, earthVisiblePct: 3, longestEarthGapH: 4, slopeDeg: 5, highlights: [`${y.scenario.label} vs ${x.scenario.label}`] };
      },
    });
    expect(a.comparison()).toEqual({ state: 'idle', missing: ['A', 'B'] });
    store.set({ site });
    const one = scenarioFromState(store.get(), 'one')!;
    store.set({ compareA: one });
    expect(a.comparison()).toEqual({ state: 'idle', missing: ['B'] });
    store.set({ compareB: scenarioFromState({ ...store.get(), delayH: 24 }, 'two')! });
    expect(a.comparison()).toEqual({ state: 'loading' }); // slot B has not been analysed yet
    const c = await a.settledComparison();
    expect(c).toMatchObject({ state: 'ready', diff: { illuminationPct: 1, highlights: ['two vs one'] } });
    a.comparison();
    expect(comparisons).toBe(1);

    // Renaming a slot keeps its numbers and renames the sentences.
    const before = analyses;
    store.set({ compareA: { ...one, label: 'first' } });
    const renamed = await a.settledComparison();
    expect(analyses).toBe(before);
    expect(renamed).toMatchObject({ state: 'ready', diff: { highlights: ['two vs first'] } });
    const stA = a.get('A');
    expect(stA.state === 'ready' && stA.value.scenario.label).toBe('first');
    expect(a.summary('A')).toMatchObject({ state: 'ready', scenario: 'first' });
  });

  it('reports which side of a comparison failed', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store, {
      analyse: (sc) => (sc.label === 'bad' ? Promise.reject(new Error('no elevation data')) : Promise.resolve(fake(sc))),
      rankNearby: () => Promise.resolve([]),
    });
    store.set({ site });
    store.set({ compareA: scenarioFromState(store.get(), 'good')!, compareB: scenarioFromState({ ...store.get(), mastHeightM: 5 }, 'bad')! });
    expect(await a.settledComparison()).toEqual({ state: 'error', error: 'B (bad): no elevation data' });
  });

  it('publishes progress while nearby alternatives are ranked', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store, {
      analyse: async (sc) => fake(sc),
      rankNearby: async (_sc, _o, onProgress) => {
        onProgress?.(1, 4);
        onProgress?.(4, 4);
        return [];
      },
    });
    store.set({ site });
    const seen: unknown[] = [];
    a.subscribe((slot) => slot === 'nearby' && seen.push(a.nearby().progress ?? a.nearby().state));
    const done = await a.requestNearby({ radiusM: 1000, spacingM: 500, slopeLimitDeg: 10, weightSun: 1, weightEarth: 1 });
    expect(done.state).toBe('ready');
    expect(seen).toEqual(['loading', { done: 1, total: 4 }, { done: 4, total: 4 }, 'ready']);
  });

  it('reports real errors with their message', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store, { analyse: () => Promise.reject(new Error('DEM tile missing')), rankNearby: () => Promise.resolve([]) });
    store.set({ site });
    await a.refresh();
    expect(a.get('current')).toMatchObject({ state: 'error', error: 'DEM tile missing', notAvailable: false });
    expect(await a.requestNearby({ radiusM: 1, spacingM: 1, slopeLimitDeg: 1, weightSun: 1, weightEarth: 1 })).toMatchObject({ state: 'ready', value: [] });
  });
});
