// Deterministic mode against the app's real core actions (src/core/coreActions.ts) and a
// real store: the commands must leave the same state the UI controls leave, and the
// replies must read the real result shapes.
import { beforeEach, describe, expect, it } from 'vitest';
import { actionLog, registerActions, resetActions, toolDefinitions } from '../../core/actions';
import { createCoreActions, GLOBE_ALTITUDE_KM } from '../../core/coreActions';
import { MissionFilterStore } from '../../core/missionFilter';
import { initialState, Store } from '../../core/store';
import type { Landing } from '../../data/landings';
import { currentTools, stateSnapshot } from '../tools';
import { DeterministicEngine } from './engine';

const L = (id: string, name: string, program: string, country: string, date: string, lat: number, lon: number, crewed = false): Landing =>
  ({ id, name, program, country, date, time: '12:00', lat, lon, crewed, region: 'r', summary: 's' }) as Landing;

const LANDINGS = [
  L('luna-9', 'Luna 9', 'Luna', 'USSR', '1966-02-03', 7.08, -64.37),
  L('apollo-11', 'Apollo 11', 'Apollo', 'USA', '1969-07-20', 0.67408, 23.47297, true),
  L('change-4', "Chang'e 4 / Yutu-2", "Chang'e", 'China', '2019-01-03', -45.4446, 177.5991),
  L('im-2', 'IM-2 Athena', 'Commercial (CLPS)', 'USA', '2025-03-06', -84.79, 29.2),
];

const T0 = Date.UTC(2025, 2, 14, 6, 0);

describe('deterministic mode on the real core actions', () => {
  let store: Store;
  let filters: MissionFilterStore;
  let engine: DeterministicEngine;
  beforeEach(() => {
    resetActions();
    store = new Store(initialState(T0));
    filters = new MissionFilterStore();
    registerActions(createCoreActions({ store, filters, landings: () => LANDINGS }));
    engine = new DeterministicEngine(undefined, { wait: () => Promise.resolve() });
  });

  it('offers the model exactly the registry: one tool per action, nothing hand-written', () => {
    expect(currentTools()).toEqual(toolDefinitions());
    expect(currentTools().length).toBeGreaterThan(20);
  });

  it('selects sites, pins coordinates and switches views like the controls do', async () => {
    let r = await engine.reply('Go to Apollo 11');
    expect(store.get().site).toMatchObject({ id: 'apollo-11', kind: 'landing' });
    expect(r.text).toContain('Selected Apollo 11 (latitude 0.6741°, longitude 23.4730° (east-positive), landed 1969-07-20 12:00 UTC)');
    r = await engine.reply("select chang'e 4");
    expect(store.get().site?.id).toBe('change-4');
    r = await engine.reply('drop a pin at 89.45 S, 137.2 W');
    expect(store.get().site).toMatchObject({ id: 'pin:-89.45000,-137.20000', kind: 'custom', lat: -89.45, lon: -137.2 });
    expect(r.text).toContain('latitude -89.4500°, longitude -137.2000° (east-positive)');
    r = await engine.reply('enter the surface');
    expect(store.get().view).toBe('surface');
    await engine.reply('look south-west');
    expect(store.get().look.azDeg).toBe(225);
    await engine.reply('back to the globe');
    expect(store.get().view).toBe('globe');
    await engine.reply('clear the pin');
    expect(store.get().site).toBeNull();
  });

  it('sets time, delay, window, mast and requirements in the store', async () => {
    await engine.reply('set time to 2026-03-01 12:00 then forward 6 hours');
    expect(store.get().timeMs).toBe(Date.UTC(2026, 2, 1, 18, 0));
    await engine.reply('delay arrival by 24 h; mast 10 m; mission window 14 days; slope limit 8; maximum earth gap 12 h; sun elevation between 5 and 60');
    expect(store.get()).toMatchObject({ delayH: 24, mastHeightM: 10, windowDurationH: 336, slopeLimitDeg: 8, maxEarthGapH: 12, sunElMinDeg: 5, sunElMaxDeg: 60 });
    const r = await engine.reply('set time to 1900-01-01');
    expect(r.text).toContain('Time must be between');
    expect(store.get().timeMs).toBe(Date.UTC(2026, 2, 1, 18, 0));
  });

  it('switches overlays, markers and filters, by program or by country', async () => {
    await engine.reply('show the average illumination map');
    expect(store.get().overlay).toBe('avg-illumination');
    await engine.reply('hide missions');
    expect(store.get().showMissions).toBe(false);
    let r = await engine.reply('only Apollo');
    expect(filters.get().programs).toEqual(['Apollo']);
    expect(r.text).toBe('Showing 1 of 4 catalogued landings.');
    r = await engine.reply('only USSR and China');
    expect(filters.get().countries).toEqual(['USSR', 'China']);
    expect(r.text).toBe('Showing 2 of 4 catalogued landings.');
    r = await engine.reply('only Atlantis');
    expect(r.text).toContain('Unknown program "atlantis"');
    await engine.reply('reset filters');
    expect(filters.get()).toMatchObject({ programs: null, countries: null });
  });

  it('builds a delayed-arrival comparison from the same actions as the compare controls', async () => {
    await engine.reply('go to IM-2');
    const r = await engine.reply('compare with a 24 h delay');
    const s = store.get();
    expect(s.comparing).toBe(true);
    expect(s.compareA).toMatchObject({ site: { id: 'im-2' }, startMs: T0, durationH: 24 });
    expect(s.compareB).toMatchObject({ site: { id: 'im-2' }, startMs: T0 + 24 * 3_600_000, durationH: 24 });
    expect(s.delayH).toBe(24);
    // No analysis store is attached in this test: the reply must say so, not invent numbers.
    expect(r.text).toContain('A: IM-2 Athena, from 2025-03-14T06:00Z for 24 h, mast 2 m: no analysis available.');
    expect(r.text).not.toMatch(/illumination \d/);
  });

  it('moves the globe camera and reports state from getState', async () => {
    await engine.reply('show the south pole');
    expect(store.get().globeCenter).toMatchObject({ lat: -90, lon: 0 });
    await engine.reply('show the whole moon');
    expect(store.get().globeCenter.altitudeKm).toBeCloseTo(GLOBE_ALTITUDE_KM, 6);
    await engine.reply('go to Apollo 11');
    const r = await engine.reply('status');
    expect(r.text).toContain('Globe view. Simulated time 2025-03-14 06:00 UTC (clock paused).');
    expect(r.text).toContain('Site: Apollo 11');
    expect(r.text).toContain('Mission window: from 2025-03-14 06:00 UTC for 24.0 h; mast height 2 m.');
  });

  it('snapshots the state for the model without logging an action', async () => {
    await engine.reply('go to Apollo 11');
    const before = actionLog().length;
    const snap = (await stateSnapshot()) as { site: { id: string }; timeUtc: string };
    expect(snap.site.id).toBe('apollo-11');
    expect(snap.timeUtc).toBe('2025-03-14T06:00Z');
    expect(actionLog().length).toBe(before);
  });

  it('reaches every registered action by name', async () => {
    for (const tool of toolDefinitions()) {
      const r = await engine.reply(`/${tool.name}`);
      // Each one either runs or answers with its own validation or precondition message: none is "not understood".
      expect(r.understood, tool.name).toBe(true);
      expect(r.text, tool.name).not.toContain('There is no action named');
    }
  });
});
