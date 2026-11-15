/// <reference types="node" />
// T-44: what the site card shows reaches the assistant: the real time, who a lander belongs to
// (GCAT) and the area explored at the site, read from the bundled files the card uses.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Landing } from '../data/landings';
import type { OwnershipIndex } from '../data/ownership';
import { areaDisplayScale, type SiteArea } from '../scene/siteAreas';
import { registerActions, resetActions, runAction } from './actions';
import { createCoreActions } from './coreActions';
import { MissionFilterStore } from './missionFilter';
import { initialState, Store } from './store';

const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', path), 'utf8'));
/** The real catalogue, ownership record and explored areas, as the app bundles them. */
const LANDINGS = (read('data/landings.json') as { landings: Landing[] }).landings;
const gcat = read('data/sources/gcat-landers.json') as { source: string; sourceUrl: string; catalogVersion: string | null; retrieved: string; records: OwnershipIndex['byLanding'] extends Map<string, infer O> ? O[] : never };
const OWNERS: OwnershipIndex = { byLanding: new Map(gcat.records.map((r) => [r.landing, r])), source: gcat.source, sourceUrl: gcat.sourceUrl, catalogVersion: gcat.catalogVersion, retrieved: gcat.retrieved };
const AREAS = new Map(Object.entries((read('data/sources/site-areas.json') as { areas: Record<string, SiteArea> }).areas));

const WALL = Date.UTC(2026, 10, 15, 3, 41, 7, 500);

function setup(options: { landings?: Landing[]; records?: boolean } = {}) {
  resetActions();
  const store = new Store(initialState(Date.UTC(2025, 2, 6, 17, 28)));
  registerActions(
    createCoreActions({
      store,
      filters: new MissionFilterStore(),
      landings: () => options.landings ?? LANDINGS,
      wallClock: () => WALL,
      ...(options.records !== false && { ownership: async () => OWNERS, siteAreas: async () => AREAS }),
    }),
  );
  return store;
}
const ok = async (name: string, params: unknown = {}) => {
  const r = await runAction<any>(name, params, 'test');
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result;
};

describe('the real time (G-10)', () => {
  it('getState says the time on the computer, apart from the simulated time', async () => {
    setup();
    const s = await ok('getState');
    expect(s.wallClockUtc).toBe('2026-11-15T03:41:07Z');
    expect(s.timeUtc).toBe('2025-03-06T17:28Z');
  });

  it('"real-now" starts the mission window at the real time, to the minute, as the "Now" button does; "now" stays the simulated time', async () => {
    const store = setup();
    expect(await ok('setMissionWindow', { startUtc: 'real-now', moveClock: true })).toMatchObject({ windowStartUtc: '2026-11-15T03:41Z', effectiveStartUtc: '2026-11-15T03:41Z', timeUtc: '2026-11-15T03:41Z' });
    expect(store.get()).toMatchObject({ windowStartMs: Date.UTC(2026, 10, 15, 3, 41), timeMs: Date.UTC(2026, 10, 15, 3, 41) });
    await ok('setTime', { utc: '2025-03-06T17:28Z' });
    expect(await ok('setMissionWindow', { startUtc: 'now' })).toMatchObject({ windowStartUtc: '2025-03-06T17:28Z' });
    expect(await ok('setMissionWindow', { startUtc: ' Real-Now ' })).toMatchObject({ windowStartUtc: '2026-11-15T03:41Z', timeUtc: '2025-03-06T17:28Z' });
  });

  it('setTime takes "real-now" too', async () => {
    const store = setup();
    expect(await ok('setTime', { utc: 'real-now' })).toMatchObject({ timeUtc: '2026-11-15T03:41Z' });
    expect(store.get().timeMs).toBe(Date.UTC(2026, 10, 15, 3, 41));
    const bad = await runAction('setTime', { utc: 'real-later' }, 'test');
    expect(bad.ok).toBe(false);
  });
});

describe('ownership and explored area on the site object (G-12)', () => {
  it('selectSite, getState and listSites carry what the card shows, from the bundled records', async () => {
    setup();
    const r = await ok('selectSite', { site: 'apollo-15' });
    expect(r.site.ownership).toEqual({
      state: 'USA', stateCode: 'US', owner: 'NASA Manned Spacecraft Center', gcatId: OWNERS.byLanding.get('apollo-15')!.jcat, labelDisagrees: false,
      source: `GCAT: General Catalog of Artificial Space Objects, Jonathan C. McDowell, ${gcat.catalogVersion} (https://planet4589.org/space/gcat/)`,
    });
    expect(r.site.exploredArea).toMatchObject({ description: 'about 6.0 km across', extentM: 6025, located: true, displayScale: areaDisplayScale(AREAS.get('apollo-15')!) });
    expect(r.site.exploredArea.source).toMatch(/^LROC anthropogenic objects: Apollo 15 .*Apollo Analyst's Notebook/);
    expect(r.site.exploredArea).not.toHaveProperty('note');
    expect((await ok('getState')).site).toEqual(r.site);
    const rows = (await ok('listSites')).sites;
    expect(rows).toHaveLength(LANDINGS.length);
    const a15 = rows.find((x: { id: string }) => x.id === 'apollo-15');
    expect(a15.ownership).toEqual(r.site.ownership);
    expect(a15.exploredArea).toEqual(r.site.exploredArea);
    // Every catalogued landing has both records.
    for (const row of rows) {
      expect(row.ownership, row.id).not.toBeNull();
      expect(row.exploredArea, row.id).not.toBeNull();
    }
  });

  it('a state that no longer exists is named with its successor; an unlocated lander says so', async () => {
    setup();
    const luna9 = (await ok('selectSite', { site: 'luna-9' })).site;
    expect(luna9.ownership).toMatchObject({ state: 'Russia (launched by the USSR)', stateCode: 'SU', gcatId: 'D00100', labelDisagrees: false });
    expect(luna9.ownership.owner).toMatch(/^Institut Kosmicheksiye Issledovaniya/);
    expect(luna9.exploredArea).toMatchObject({ description: 'about 60 m across', located: false, displayScale: areaDisplayScale(AREAS.get('luna-9')!) });
    expect(luna9.exploredArea.note).toMatch(/^Not located in the LROC catalogue/);
    expect(luna9.exploredArea.source).toMatch(/approximate coordinates/);
    // A rover whose route is not published: the caveat comes with it.
    const luna17 = (await ok('selectSite', { site: 'luna-17' })).site;
    expect(luna17.exploredArea.note).toMatch(/Lunokhod 1 drove about 10 km/);
  });

  it('flags a catalogue label that disagrees with GCAT, in words', async () => {
    const wrong = LANDINGS.map((l) => (l.id === 'change-4' ? { ...l, country: 'Japan' } : l));
    setup({ landings: wrong });
    const s = (await ok('selectSite', { site: 'change-4' })).site;
    expect(s.ownership).toMatchObject({ state: 'China', labelDisagrees: true, note: 'This site\'s own data says "Japan", but the GCAT catalogue records China, People\'s Republic of.' });
  });

  it('a pin has neither; without the records the fields are null, never invented', async () => {
    setup({ records: false });
    const s = (await ok('selectSite', { site: 'apollo-11' })).site;
    expect(s).toMatchObject({ id: 'apollo-11', ownership: null, exploredArea: null });
    const pin = (await ok('dropPin', { lat: 1, lon: 2 })).site;
    expect(pin).not.toHaveProperty('ownership');
    expect(pin).not.toHaveProperty('exploredArea');
    expect((await ok('getState')).site).toEqual(pin);
  });
});
