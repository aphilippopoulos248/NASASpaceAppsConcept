import { beforeEach, describe, expect, it } from 'vitest';
import type { Landing } from '../data/landings';
import { registerActions, resetActions, runAction } from './actions';
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
