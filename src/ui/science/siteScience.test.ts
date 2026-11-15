// The two site-science actions, run through the action registry on the real science core
// and the bundled data (no network): IM-2, a pin on Shackleton's rim, and an equatorial site.
// (The on-screen section needs a browser; it is checked with screenshots, see the T-30 handover.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAction, registerActions, resetActions, runAction } from '../../core/actions';
import { AnalysisStore } from '../../core/analysisStore';
import { createCoreActions } from '../../core/coreActions';
import { MissionFilterStore } from '../../core/missionFilter';
import { initialState, Store } from '../../core/store';
import type { Landing } from '../../data/landings';
import { createSiteScienceActions, registerSiteScienceActions } from './siteScience';

const IM2 = { lat: -84.79, lon: 29.2 };
const SHACKLETON_RIM = { lat: -89.686, lon: -163.457 };
const APOLLO_11 = { lat: 0.67416, lon: 23.47314 };
const landing = (id: string, name: string, at: { lat: number; lon: number }, date: string, time: string): Landing => ({ id, name, program: 'p', country: 'c', date, time, ...at, crewed: false, region: 'r', summary: 's' }) as Landing;

const store = new Store(initialState(Date.UTC(2026, 10, 14)));
const analysis = new AnalysisStore(store, undefined, 200);
const landings = [landing('im-2', 'IM-2 Athena', IM2, '2025-03-06', '17:28'), landing('apollo-11', 'Apollo 11', APOLLO_11, '1969-07-20', '20:17')];

beforeAll(() => {
  resetActions();
  registerActions([...createCoreActions({ store, filters: new MissionFilterStore(), landings: () => landings, analysis }), ...createSiteScienceActions({ store, analysis })]);
});
afterAll(() => {
  analysis.stop();
  resetActions();
});

/** The result of an action that must succeed. */
async function ok(name: string, params: Record<string, unknown> = {}): Promise<any> {
  const r = await runAction<any>(name, params);
  if (!r.ok) throw new Error(`${name}: ${r.error}`);
  return r.result;
}

describe('getSiteScience', () => {
  it('needs a site', async () => {
    expect(await runAction('getSiteScience')).toMatchObject({ ok: false, error: expect.stringContaining('No site is selected') });
  });

  it('IM-2: DSN geometry from the analysis, long-term averages, ice targets, Diviner annual values; no ShadowCam mosaic', async () => {
    await ok('selectSite', { site: 'im-2', atLanding: true });
    const s = await ok('getSiteScience');
    expect(Object.keys(s)).toEqual(['site', 'dsn', 'longTermAverages', 'iceTargets', 'surfaceTemperature', 'shadowCam', 'notIncluded']);
    expect(s.site).toEqual({ id: 'im-2', name: 'IM-2 Athena', latDeg: IM2.lat, lonDegEast: IM2.lon });
    // DSN: three complexes; "any station" sees at least as much of the window as the best single one.
    expect(s.dsn).toMatchObject({ available: true, windowStartUtc: '2025-03-06T17:28Z', windowDurationH: 24 });
    expect(s.dsn.stations.map((x: any) => x.id)).toEqual(['DSS-14', 'DSS-43', 'DSS-63']);
    for (const st of s.dsn.stations) {
      expect(st.receive.pctOfWindow).toBeGreaterThanOrEqual(0);
      expect(st.receive.pctOfWindow).toBeLessThanOrEqual(100);
      expect(st.transmit.pctOfWindow).toBeLessThanOrEqual(st.receive.pctOfWindow + 1e-9); // the transmit limit is the stricter one
    }
    expect(s.dsn.anyStation.receive.pctOfWindow).toBeGreaterThanOrEqual(Math.max(...s.dsn.stations.map((x: any) => x.receive.pctOfWindow)) - 1e-9);
    expect(s.dsn.meaning).toContain('not a link budget');
    expect(s.dsn.assumptions.length).toBeGreaterThan(0);
    // Long-term averages exist at 84.8S (inside a corner of the 120 m map, which is complete from 85S).
    expect(s.longTermAverages).toMatchObject({ available: true, sunlight: { pctOfTime: 45, cellM: 120 }, earthVisibility: { pctOfTime: 90, cellM: 120 } });
    expect(s.longTermAverages.kind).toContain('not the geometry of the simulated date');
    expect(s.iceTargets.available).toBe(true);
    expect(s.iceTargets.nearest).toHaveLength(3);
    expect(s.iceTargets.nearest[0].distanceKm).toBeCloseTo(6.6, 0);
    // Diviner: annual values, said so in the text itself.
    expect(s.surfaceTemperature).toMatchObject({ available: true, status: 'ok', annualMaxK: 226, annualMeanK: 127, cellM: 240 });
    expect(s.surfaceTemperature.text).toMatch(/^Annual maximum temperature 226 K, annual mean 127 K here/);
    // ShadowCam images shadowed craters; Athena's sunlit plateau is on none of the mosaics.
    expect(s.shadowCam).toMatchObject({ available: false, mosaics: [], imagesBundled: false });
    expect(s.shadowCam.text).toMatch(/^No ShadowCam controlled mosaic covers this point/);
    expect(s.notIncluded.join(' ')).toContain('separate summer and winter maps are not included');
    // Only plain data goes to the assistant.
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  }, 240_000);

  it('a pin on Shackleton\'s rim: every layer has something to say', async () => {
    await ok('dropPin', SHACKLETON_RIM);
    const s = await ok('getSiteScience');
    expect(s.site).toMatchObject({ latDeg: SHACKLETON_RIM.lat, lonDegEast: SHACKLETON_RIM.lon });
    expect(s.dsn.available).toBe(true);
    expect(s.longTermAverages).toMatchObject({ available: true, sunlight: { pctOfTime: 73, cellM: 120 }, earthVisibility: { pctOfTime: 52 } });
    expect(s.iceTargets.nearest.map((t: any) => t.label)).toContain('Shackleton');
    expect(s.iceTargets.nearest[0].distanceKm).toBeLessThan(5);
    expect(s.surfaceTemperature).toMatchObject({ available: true, status: 'ok', cellM: 240, measuredOver: 'July 2009 to February 2019' });
    // Rarely dark: one of the warmest annual means at the pole, far above the crater floor's 58 K.
    expect(s.surfaceTemperature.annualMeanK).toBeGreaterThan(120);
    expect(s.surfaceTemperature.annualMaxK).toBeGreaterThan(s.surfaceTemperature.annualMeanK);
    expect(s.shadowCam).toMatchObject({ available: true, imagesBundled: false, credit: 'NASA/KARI/Arizona State University' });
    expect(s.shadowCam.mosaics).toEqual([
      expect.objectContaining({ id: 'shackleton01', url: 'https://pds.shadowcam.im-ldi.com/derived/cmosaic/shackleton01/', imagesFrom: '2023-02-22', imagesTo: '2023-02-23', pixelScaleM: 2 }),
    ]);
    expect(s.shadowCam.licence).toContain('No licence or usage statement');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  }, 240_000);

  it('an equatorial site has no polar layers, and each says so', async () => {
    await ok('selectSite', { site: 'apollo-11', atLanding: true });
    const s = await ok('getSiteScience');
    expect(s.dsn.available).toBe(true); // station geometry exists anywhere on the Moon
    expect(s.dsn.windowStartUtc).toBe('1969-07-20T20:17Z');
    expect(s.longTermAverages.available).toBe(false);
    expect(s.longTermAverages.sunlight).toMatchObject({ available: false, pctOfTime: null });
    expect(s.longTermAverages.sunlight.text).toContain('only the polar regions');
    expect(s.iceTargets).toMatchObject({ available: true, nearest: [], note: expect.stringContaining('south polar region only') });
    expect(s.surfaceTemperature).toMatchObject({ available: false, status: 'outside', annualMaxK: null, annualMeanK: null });
    expect(s.surfaceTemperature.text).toContain('poleward of 80°');
    expect(s.shadowCam).toMatchObject({ available: false, mosaics: [] });
  }, 240_000);
});

describe('nearestIceTargets', () => {
  it('works for the selected site and for any point, with count or limit', async () => {
    await ok('selectSite', { site: 'im-2' });
    const own = await ok('nearestIceTargets');
    expect(own.from).toEqual({ latDeg: IM2.lat, lonDegEast: IM2.lon });
    expect(own.nearest).toHaveLength(5);
    expect(own.credit).toContain('Lemelin');
    const near = await ok('nearestIceTargets', { lat: SHACKLETON_RIM.lat, lon: SHACKLETON_RIM.lon, count: 2 });
    expect(near.from).toEqual({ latDeg: -89.686, lonDegEast: -163.457 });
    expect(near.nearest).toHaveLength(2);
    const viaLimit = await ok('nearestIceTargets', { lat: SHACKLETON_RIM.lat, lon: SHACKLETON_RIM.lon, limit: 2 });
    expect(viaLimit).toEqual(near);
    // Longitudes beyond 180 are the same place.
    expect((await ok('nearestIceTargets', { lat: SHACKLETON_RIM.lat, lon: SHACKLETON_RIM.lon + 360, count: 2 })).nearest).toEqual(near.nearest);
    const close = await ok('nearestIceTargets', { lat: -89.67, lon: 129.78, count: 1, maxKm: 1 });
    expect(close.nearest).toEqual([expect.objectContaining({ label: 'Shackleton', insideOutline: true, distanceKm: 0, bearingDeg: null })]);
    expect((await ok('nearestIceTargets', { lat: 20, lon: 20, maxKm: 100 })).nearest).toEqual([]);
  });

  it('refuses half a coordinate and conflicting counts', async () => {
    expect(await runAction('nearestIceTargets', { lat: -80 })).toMatchObject({ ok: false, error: expect.stringContaining('both `lat` and `lon`') });
    expect(await runAction('nearestIceTargets', { count: 2, limit: 3 })).toMatchObject({ ok: false, error: expect.stringContaining('`count` and `limit` mean the same thing') });
    expect(await runAction('nearestIceTargets', { count: 0 })).toMatchObject({ ok: false });
  });
});

describe('registration', () => {
  it('describes both actions for the assistant and can be repeated', () => {
    const def = getAction('getSiteScience')!;
    expect(def.effect).toBe('query');
    for (const word of ['dsn', 'longTermAverages', 'iceTargets', 'surfaceTemperature', 'shadowCam', 'ANNUAL', 'not a link budget']) expect(def.description).toContain(word);
    expect(getAction('nearestIceTargets')!.effect).toBe('query');
    // The app's own registration is a second set of definitions: it replaces nothing silently...
    expect(() => registerSiteScienceActions()).toThrow(/already registered/);
    // ...and on a clean registry it can be called any number of times.
    resetActions();
    registerSiteScienceActions();
    registerSiteScienceActions();
    expect(getAction('getSiteScience')).toBeDefined();
    resetActions();
    registerActions([...createCoreActions({ store, filters: new MissionFilterStore(), landings: () => landings, analysis }), ...createSiteScienceActions({ store, analysis })]);
  });
});
