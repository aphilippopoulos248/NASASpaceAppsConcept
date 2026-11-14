import { describe, expect, it } from 'vitest';
import { setLandings } from '../data/catalog';
import type { Landing } from '../data/landings';
import { registerActions, resetActions } from './actions';
import { createCoreActions } from './coreActions';
import { applyDeepLink, parseDeepLink } from './deepLink';
import { MissionFilterStore } from './missionFilter';
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
    expect(parseDeepLink('?site=apollo-11&view=surface&light=landing')).toEqual({ site: 'apollo-11', view: 'surface', light: 'landing', t: null });
    expect(parseDeepLink('?site=pin:-89.45000,136.70000&t=2025-03-14T06:00Z&view=bogus')).toEqual({ site: 'pin:-89.45000,136.70000', view: null, light: null, t: '2025-03-14T06:00Z' });
    expect(parseDeepLink('')).toEqual({ site: null, view: null, light: null, t: null });
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

  it('sets the clock without a site', async () => {
    const store = setup();
    expect(await applyDeepLink(parseDeepLink('?time=2026-11-22T03:31Z'))).toEqual([]);
    expect(store.get().timeMs).toBe(Date.UTC(2026, 10, 22, 3, 31));
    expect(store.get().site).toBeNull();
  });
});
