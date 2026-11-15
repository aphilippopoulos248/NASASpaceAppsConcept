import { describe, expect, it } from 'vitest';
import { setLandings } from '../data/catalog';
import type { Landing } from '../data/landings';
import { registerActions, resetActions } from './actions';
import { createCoreActions } from './coreActions';
import { setPresets, type MissionPreset } from '../data/presets';
import { applyDeepLink, linkQuery, parseDeepLink } from './deepLink';
import { MissionFilterStore } from './missionFilter';
import { createPresetActions } from './presetActions';
import { initialState, Store } from './store';

const APOLLO_11 = { id: 'apollo-11', name: 'Apollo 11', program: 'Apollo', country: 'USA', date: '1969-07-20', time: '20:17', lat: 0.67408, lon: 23.47297, crewed: true, region: 'r', summary: 's' } as Landing;
const TOUCHDOWN = Date.UTC(1969, 6, 20, 20, 17);

function setup(): Store {
  resetActions();
  setLandings([APOLLO_11]);
  const store = new Store(initialState(Date.UTC(2025, 2, 14, 6, 0)));
  registerActions(createCoreActions({ store, filters: new MissionFilterStore(), landings: () => [APOLLO_11] }));
  return store;
}

describe('deep links', () => {
  it('reads site, view, light and time', () => {
    expect(parseDeepLink('?site=apollo-11&view=surface&light=landing')).toEqual({ site: 'apollo-11', view: 'surface', light: 'landing', t: null, preset: null });
    expect(parseDeepLink('?site=pin:-89.45000,136.70000&t=2025-03-14T06:00Z&view=bogus')).toEqual({ site: 'pin:-89.45000,136.70000', view: null, light: null, t: '2025-03-14T06:00Z', preset: null });
    expect(parseDeepLink('')).toEqual({ site: null, view: null, light: null, t: null, preset: null });
    expect(parseDeepLink('?preset=eclipse-2025-03-14').preset).toBe('eclipse-2025-03-14');
  });

  it('reads &time= as &t= (the spelling of links made for the main branch app); &t= wins when both are given', () => {
    expect(parseDeepLink('?site=apollo-11&time=2026-11-22T03:31Z').t).toBe('2026-11-22T03:31Z');
    expect(parseDeepLink('?time=2026-11-22T03:31Z&t=2025-03-14T06:00Z').t).toBe('2025-03-14T06:00Z');
  });

  it('light=landing sets the clock to touchdown', async () => {
    const store = setup();
    expect(await applyDeepLink(parseDeepLink('?site=apollo-11&light=landing'))).toEqual([]);
    expect(store.get().site?.id).toBe('apollo-11');
    expect(store.get().timeMs).toBe(TOUCHDOWN);
  });

  it('a time in the link wins over light=landing, with either spelling', async () => {
    for (const key of ['time', 't']) {
      const store = setup();
      expect(await applyDeepLink(parseDeepLink(`?site=apollo-11&light=landing&${key}=2026-11-22T03:31Z`))).toEqual([]);
      expect(store.get().timeMs).toBe(Date.UTC(2026, 10, 22, 3, 31));
      expect(store.get().lightMode).toBe('real');
    }
  });

  it('a time that cannot be read is reported, and light=landing then sets the clock', async () => {
    const store = setup();
    const errors = await applyDeepLink(parseDeepLink('?site=apollo-11&light=landing&time=next+tuesday'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^setTime: /);
    expect(store.get().timeMs).toBe(TOUCHDOWN);
  });

  it('starts the mission window where the link sets the clock', async () => {
    let store = setup();
    await applyDeepLink(parseDeepLink('?site=apollo-11&light=landing'));
    expect(store.get()).toMatchObject({ timeMs: TOUCHDOWN, windowStartMs: TOUCHDOWN });
    store = setup();
    await applyDeepLink(parseDeepLink('?site=apollo-11&light=landing&t=2026-11-22T03:31Z'));
    expect(store.get()).toMatchObject({ timeMs: Date.UTC(2026, 10, 22, 3, 31), windowStartMs: Date.UTC(2026, 10, 22, 3, 31) });
    // No time in the link: the window stays where the app started it.
    store = setup();
    await applyDeepLink(parseDeepLink('?site=apollo-11'));
    expect(store.get().windowStartMs).toBe(Date.UTC(2025, 2, 14, 6, 0));
  });

  it('sets the clock without a site', async () => {
    const store = setup();
    expect(await applyDeepLink(parseDeepLink('?time=2026-11-22T03:31Z'))).toEqual([]);
    expect(store.get().timeMs).toBe(Date.UTC(2026, 10, 22, 3, 31));
    expect(store.get().site).toBeNull();
  });
});

describe('preset links', () => {
  const PRESET: MissionPreset = {
    id: 'apollo-11-landing', title: 'Apollo 11', description: 'd.', siteId: 'apollo-11', windowStartMs: TOUCHDOWN, windowDurationH: 24, clockMs: TOUCHDOWN + 3_600_000,
    view: 'globe', rate: 3600, play: true, sources: ['s'],
  };
  function setupPresets(): Store {
    const store = setup();
    setPresets([PRESET]);
    registerActions(createPresetActions({ store, presets: () => [PRESET], landings: () => [APOLLO_11] }));
    return store;
  }

  it('?preset= loads the preset and nothing else from the link', async () => {
    const store = setupPresets();
    expect(await applyDeepLink(parseDeepLink('?preset=apollo-11-landing&t=2030-01-01T00:00Z&view=surface'))).toEqual([]);
    expect(store.get()).toMatchObject({ site: { id: 'apollo-11' }, view: 'globe', timeMs: TOUCHDOWN + 3_600_000, windowStartMs: TOUCHDOWN, windowDurationH: 24, rate: 3600, playing: true });
    setPresets([]);
  });

  it('a preset that does not exist is reported and the rest of the link is used', async () => {
    const store = setupPresets();
    const errors = await applyDeepLink(parseDeepLink('?preset=nothing&site=apollo-11&light=landing'));
    expect(errors).toEqual(['loadPreset: There is no preset "nothing". Presets: apollo-11-landing.']);
    expect(store.get()).toMatchObject({ site: { id: 'apollo-11' }, timeMs: TOUCHDOWN, playing: false });
    setPresets([]);
  });

  it('the address carries the preset while it is on screen, and the site and view afterwards', async () => {
    const store = setupPresets();
    await applyDeepLink(parseDeepLink('?preset=apollo-11-landing'));
    expect(linkQuery(store.get(), '?preset=apollo-11-landing&quality=low')).toBe('quality=low&preset=apollo-11-landing');
    // Scrubbing or playing keeps it; another window does not.
    store.set({ timeMs: TOUCHDOWN + 7_200_000 });
    expect(linkQuery(store.get(), '')).toBe('preset=apollo-11-landing');
    store.set({ windowDurationH: 72, view: 'surface' });
    expect(linkQuery(store.get(), '?preset=apollo-11-landing&t=x')).toBe('site=apollo-11&view=surface');
    store.set({ site: null, view: 'globe' });
    expect(linkQuery(store.get(), '?site=apollo-11')).toBe('');
    setPresets([]);
  });
});
