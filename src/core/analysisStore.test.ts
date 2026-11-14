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
  it('shows "not available yet" (never numbers) while the science core is missing', async () => {
    const store = new Store(initialState(0));
    const a = new AnalysisStore(store);
    await a.start();
    expect(a.get('current')).toEqual({ state: 'idle' });
    store.set({ site });
    await a.refresh();
    expect(a.get('current')).toMatchObject({ state: 'error', notAvailable: true, error: NOT_AVAILABLE_TEXT });
    expect(a.summary('current')).not.toHaveProperty('illuminationPct');
    const n = await a.requestNearby({ radiusM: 5000, spacingM: 500, slopeLimitDeg: 10, weightSun: 1, weightEarth: 1 });
    expect(n).toMatchObject({ state: 'error', notAvailable: true });
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
