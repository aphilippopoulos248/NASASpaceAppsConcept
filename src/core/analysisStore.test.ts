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
    const store = new Store(initialState(Date.UTC(1969, 6, 20, 20, 17)));
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
    await a.refresh();
    expect(calls.filter((c) => c === current.id).length).toBe(2); // once for "current", once for slot A
    store.set({ rate: 1 }); // not part of a scenario: no new analysis
    expect(calls.length).toBe(3);
    expect(seen[0]).toBe('current:loading');
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
