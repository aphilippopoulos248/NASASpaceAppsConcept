/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearAnalysisCache } from '../analysis/api';
import { setBundleReader } from '../analysis/sky';
import type { Landing } from '../data/landings';
import { parsePresets } from '../data/presets';
import { registerActions, resetActions, runAction } from './actions';
import { AnalysisStore } from './analysisStore';
import { onCommand } from './bus';
import { createCoreActions } from './coreActions';
import { MissionFilterStore } from './missionFilter';
import { activePreset, createPresetActions, ephemerisStatement, presetLook } from './presetActions';
import { initialState, Store } from './store';
import type { SiteRef, ViewMode } from './types';

// The app's own data: the catalogue, the presets file, the bundled Horizons tables and the
// bundled terrain, read from public/ (no network). The analysis is the real science core.
const read = (path: string) => readFileSync(join(process.cwd(), 'public', path), 'utf8');
setBundleReader(async (p) => read(p));
const LANDINGS = (JSON.parse(read('data/landings.json')) as { landings: Landing[] }).landings;
const PRESETS = parsePresets(JSON.parse(read('data/presets.json')));
const LONG = 120_000;
const MIN = 60_000;
const utc = (text: string) => Date.parse(text);

interface Setup {
  /** Called while the surface is being prepared (stands for the user doing something meanwhile). */
  whilePreparing?: (store: Store) => void;
  analysis?: boolean;
}

function setup(options: Setup = {}) {
  resetActions();
  clearAnalysisCache();
  const store = new Store(initialState(Date.UTC(2026, 0, 1)));
  const analysis = options.analysis === false ? undefined : new AnalysisStore(store, undefined, 200);
  void analysis?.start();
  const order: string[] = [];
  const prepareSurface = async (site: SiteRef) => {
    order.push(`prepare ${site.id}`);
    options.whilePreparing?.(store);
  };
  const viewShown = async (view: ViewMode) => {
    order.push(`shown ${view}`);
  };
  const ctx = { store, landings: () => LANDINGS, analysis, prepareSurface, viewShown };
  registerActions(createCoreActions({ ...ctx, filters: new MissionFilterStore() }));
  registerActions(createPresetActions({ ...ctx, presets: () => PRESETS }));
  return { store, analysis, order };
}

describe('listPresets', () => {
  beforeEach(() => resetActions());

  it('describes every preset: what plays, where, when, how fast, and from which data', async () => {
    const { analysis } = setup({ analysis: false });
    const r = await runAction<any>('listPresets');
    expect(r).toMatchObject({ ok: true, result: { loaded: null } });
    if (!r.ok) return;
    expect(r.result.presets.map((p: any) => p.id)).toEqual(['blue-ghost-landing', 'im-2-landing', 'eclipse-2025-03-14']);
    expect(r.result.presets[0]).toMatchObject({
      title: 'Blue Ghost Mission 1, Mare Crisium',
      site: { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', latDeg: 18.562, lonDegEast: 61.81 },
      missionWindow: { startUtc: '2025-03-02T08:34Z', durationH: 336, endUtc: '2025-03-16T08:34Z' },
      clockStartsUtc: '2025-03-02T08:34Z',
      view: 'surface',
      rateSimSecondsPerSecond: 43200,
      playsForSeconds: 28,
      playsOnLoad: true,
    });
    expect(r.result.presets[2]).toMatchObject({
      missionWindow: { startUtc: '2025-03-14T04:30Z', durationH: 6, endUtc: '2025-03-14T10:30Z' },
      clockStartsUtc: '2025-03-14T04:52Z',
      look: { towards: 'earth', fovDeg: 12, elOffsetDeg: -1.5 },
      rateSimSecondsPerSecond: 600,
      playsForSeconds: 34,
      sunBehindEarth: { partlyCoveredFromUtc: '2025-03-14T05:00Z', entirelyHiddenFromUtc: '2025-03-14T06:17Z', entirelyHiddenUntilUtc: '2025-03-14T08:34Z', clearAgainUtc: '2025-03-14T09:51Z' },
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    analysis?.stop();
  });
});

describe('loadPreset', () => {
  beforeEach(() => resetActions());

  it('refuses an id that does not exist and names the ones that do', async () => {
    const { store } = setup({ analysis: false });
    const before = JSON.stringify(store.get());
    expect(await runAction('loadPreset', { id: 'apollo-11' })).toEqual({ ok: false, error: 'There is no preset "apollo-11". Presets: blue-ghost-landing, im-2-landing, eclipse-2025-03-14.' });
    expect(await runAction('loadPreset', {})).toMatchObject({ ok: false, error: expect.stringContaining('params.id is required') });
    expect(JSON.stringify(store.get())).toBe(before);
  });

  it('the eclipse: one step to the Blue Ghost site, minutes before the Sun is covered, facing Earth and the Sun, playing, on the bundled Horizons table', async () => {
    const { store, analysis, order } = setup();
    const looks: unknown[] = [];
    const off = onCommand('lookAt', (p) => looks.push(p));
    store.set({ comparing: true, delayH: 24, lightMode: 'even' });
    const r = await runAction<any>('loadPreset', { id: 'eclipse-2025-03-14' });
    off();
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // What is on screen.
    const s = store.get();
    expect(s).toMatchObject({ view: 'surface', windowStartMs: utc('2025-03-14T04:30Z'), windowDurationH: 6, delayH: 0, timeMs: utc('2025-03-14T04:52Z'), rate: 600, playing: true, lightMode: 'real', comparing: false });
    expect(s.site).toEqual({ id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', kind: 'landing', lat: 18.562, lon: 61.81 });
    // The surface was prepared and shown before the look direction was set.
    expect(order).toEqual(['prepare blue-ghost-1', 'shown surface']);
    // Facing Earth, west-south-west and about 29 degrees up, aimed 1.5 degrees under its centre,
    // with 12 degrees of view: Earth's disc is 1.9 across and the Sun stands 1.3 above its centre.
    expect(looks).toHaveLength(1);
    expect(s.look.azDeg).toBeGreaterThan(258);
    expect(s.look.azDeg).toBeLessThan(259.2);
    expect(s.look.elDeg).toBeGreaterThan(27.2);
    expect(s.look.elDeg).toBeLessThan(27.7);
    expect(s.look.fovDeg).toBe(12);

    // What it reports.
    expect(r.result).toMatchObject({
      preset: { id: 'eclipse-2025-03-14' },
      view: 'surface',
      site: { id: 'blue-ghost-1', latDeg: 18.562, lonDegEast: 61.81 },
      timeUtc: '2025-03-14T04:52Z',
      playing: true,
      rateSimSecondsPerSecond: 600,
      missionWindow: { startUtc: '2025-03-14T04:30Z', durationH: 6, endUtc: '2025-03-14T10:30Z' },
      analysisState: 'ready',
      comparisonClosed: true,
      ephemeris: { source: 'horizons', text: 'Sun and Earth positions for this window come from a JPL Horizons table bundled with the app: no network is needed.' },
    });
    expect(r.result.ephemeris.note).toContain('blue-ghost-1-2025-03');
    expect(r.result.note).toBeUndefined();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);

    // The times the preset states are the analysis' own, to the minute.
    const st = analysis!.get('current');
    expect(st.state).toBe('ready');
    if (st.state !== 'ready') return;
    const stated = PRESETS[2].sunBehindEarth!;
    const overlap = st.value.metrics.eclipseIntervals!;
    const dark = st.value.metrics.darkIntervals;
    expect(overlap).toHaveLength(1);
    expect(dark).toHaveLength(1);
    expect(Math.abs(overlap[0].startMs - stated.partlyCoveredFromMs)).toBeLessThan(MIN);
    expect(Math.abs(dark[0].startMs - stated.entirelyHiddenFromMs)).toBeLessThan(MIN);
    expect(Math.abs(dark[0].endMs - stated.entirelyHiddenUntilMs)).toBeLessThan(MIN);
    expect(Math.abs(overlap[0].endMs - stated.clearAgainMs)).toBeLessThan(MIN);
    expect(activePreset(store.get(), PRESETS)?.id).toBe('eclipse-2025-03-14');
    expect((await runAction<any>('listPresets')) as unknown).toMatchObject({ ok: true, result: { loaded: 'eclipse-2025-03-14' } });
    analysis!.stop();
  }, LONG);

  it('Blue Ghost Mission 1: touchdown and 14 days of daylight, broken only by the eclipse', async () => {
    const { store, analysis } = setup();
    const r = await runAction<any>('loadPreset', { id: 'blue-ghost-landing' });
    expect(r).toMatchObject({ ok: true, result: { view: 'surface', timeUtc: '2025-03-02T08:34Z', playing: true, rateSimSecondsPerSecond: 43200, ephemeris: { source: 'horizons' }, analysisState: 'ready' } });
    // No look of its own: the Sun ahead (it rose in the east a few hours before touchdown), the horizon in view, normal zoom.
    expect(store.get().look.fovDeg).toBe(70);
    expect(store.get().look.azDeg).toBeGreaterThan(80);
    expect(store.get().look.azDeg).toBeLessThan(100);
    expect(store.get().look.elDeg).toBe(0);
    expect(r.ok && r.result.look).toEqual(store.get().look);
    const st = analysis!.get('current');
    if (st.state !== 'ready') throw new Error('not ready');
    // "14 days of daylight and the eclipse of 14 March."
    expect(st.value.events.filter((e) => e.type === 'sunrise' || e.type === 'sunset')).toEqual([]);
    expect(st.value.metrics.darkIntervals).toHaveLength(1);
    expect(new Date(st.value.metrics.darkIntervals[0].startMs).toISOString().slice(0, 10)).toBe('2025-03-14');
    expect(st.value.metrics.minSunElDeg).toBeGreaterThan(0);
    expect(store.get().windowDurationH).toBe(336);
    analysis!.stop();
  }, LONG);

  it('IM-2: touchdown near the south pole, the Sun low over the skyline until it sets on 19 March', async () => {
    const { analysis } = setup();
    const r = await runAction<any>('loadPreset', { id: 'im-2-landing', play: false });
    expect(r).toMatchObject({ ok: true, result: { view: 'surface', timeUtc: '2025-03-06T17:28Z', playing: false, ephemeris: { source: 'horizons' }, analysisState: 'ready' } });
    expect(r.ok && r.result.ephemeris.note).toContain('im-2-2025-03');
    const st = analysis!.get('current');
    if (st.state !== 'ready') throw new Error('not ready');
    const sunsets = st.value.events.filter((e) => e.type === 'sunset').map((e) => new Date(e.timeMs).toISOString().slice(0, 10));
    expect(sunsets).toContain('2025-03-19');
    // "14 days of low Sun": it never stands more than a few degrees up.
    expect(st.value.metrics.maxSunElDeg).toBeLessThan(6);
    // 5 degrees from the pole.
    expect(90 - Math.abs(st.scenario.site.lat)).toBeCloseTo(5.2, 1);
    analysis!.stop();
  }, LONG);

  it('does not start the clock when something else took over while it was loading', async () => {
    const { store, analysis } = setup({ whilePreparing: (s) => s.set({ timeMs: utc('2025-03-14T08:00Z') }) });
    const r = await runAction<any>('loadPreset', { id: 'eclipse-2025-03-14' });
    expect(r).toMatchObject({ ok: true, result: { playing: false, timeUtc: '2025-03-14T08:00Z', note: expect.stringContaining('the clock was not started') } });
    expect(store.get().playing).toBe(false);
    analysis!.stop();
  }, LONG);

  it('says so when the surface cannot be shown, and leaves the site and the window in place', async () => {
    resetActions();
    const store = new Store(initialState(Date.UTC(2026, 0, 1)));
    const ctx = { store, landings: () => LANDINGS, prepareSurface: () => Promise.reject(new Error('No elevation data for this site.')) };
    registerActions(createPresetActions({ ...ctx, presets: () => PRESETS }));
    expect(await runAction('loadPreset', { id: 'im-2-landing' })).toEqual({ ok: false, error: 'No elevation data for this site.' });
    expect(store.get()).toMatchObject({ view: 'globe', site: { id: 'im-2' }, windowDurationH: 336, playing: false });
  });

  it('outside the bundled windows the same site reads "in-app model", and the preset is no longer the one on screen', async () => {
    const { store, analysis } = setup();
    await runAction('loadPreset', { id: 'im-2-landing', play: false });
    await runAction('setMissionWindow', { startUtc: '2030-03-06T17:28Z', durationH: 24, moveClock: true });
    expect(activePreset(store.get(), PRESETS)).toBeNull();
    const st = await analysis!.settled('current');
    if (st.state !== 'ready') throw new Error('not ready');
    expect(ephemerisStatement(st.value)).toMatchObject({ source: 'model', text: expect.stringContaining('in-app model') });
    expect(ephemerisStatement(null)).toMatchObject({ source: null });
    analysis!.stop();
  }, LONG);
});

describe('where a preset looks when its surface view opens', () => {
  const sky = (sunAz: number, sunEl: number, earthAz = 300, earthEl = 40) => ({ sun: { azDeg: sunAz, elDeg: sunEl }, earth: { azDeg: earthAz, elDeg: earthEl } });

  it('with a look of its own: at that body, aimed off its centre', () => {
    expect(presetLook({ look: { towards: 'earth', fovDeg: 12, elOffsetDeg: -1.5 } }, sky(258.6, 30.2, 258.5, 28.9), { azDeg: 10 })).toEqual({ azDeg: 258.5, elDeg: 27.4, fovDeg: 12 });
    expect(presetLook({ look: { towards: 'sun', fovDeg: 5 } }, sky(-10, 12), { azDeg: 10 })).toEqual({ azDeg: 350, elDeg: 12, fovDeg: 5 });
  });

  it('without one: the Sun ahead with the horizon in view, as on any first arrival at a site', () => {
    // A low Sun: look level. A high Sun: look up, but keep the ground in the picture.
    expect(presetLook({}, sky(95, 3), { azDeg: 10 })).toEqual({ azDeg: 95, elDeg: 0, fovDeg: 70 });
    expect(presetLook({}, sky(180, 45), { azDeg: 10 })).toEqual({ azDeg: 180, elDeg: 25, fovDeg: 70 });
    expect(presetLook({}, sky(180, 80), { azDeg: 10 })).toEqual({ azDeg: 180, elDeg: 30, fovDeg: 70 });
    // The Sun is down: Earth instead. Neither is up: level, facing where the viewer already was.
    expect(presetLook({}, sky(95, -5, 300, 40), { azDeg: 10 })).toEqual({ azDeg: 300, elDeg: 20, fovDeg: 70 });
    expect(presetLook({}, sky(95, -5, 300, -2), { azDeg: 370 })).toEqual({ azDeg: 10, elDeg: 0, fovDeg: 70 });
  });

  it('is the same whatever was looked at before: loading the eclipse and then a landing does not keep the zoom', async () => {
    const { store, analysis } = setup();
    await runAction('loadPreset', { id: 'eclipse-2025-03-14', play: false });
    expect(store.get().look.fovDeg).toBe(12);
    const again = await runAction<any>('loadPreset', { id: 'blue-ghost-landing', play: false });
    expect(again).toMatchObject({ ok: true, result: { view: 'surface', playing: false, look: { fovDeg: 70, elDeg: 0 } } });
    // And straight from a fresh start it is the same look.
    const fresh = setup();
    const direct = await runAction<any>('loadPreset', { id: 'blue-ghost-landing', play: false });
    expect(direct.ok && again.ok && direct.result.look).toEqual(again.ok && again.result.look);
    analysis!.stop();
    fresh.analysis!.stop();
  }, LONG);
});
