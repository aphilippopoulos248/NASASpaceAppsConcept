import { describe, expect, it } from 'vitest';
import { registerActions, resetActions, runAction } from './actions';
import { AnalysisStore } from './analysisStore';
import { createCoreActions } from './coreActions';
import { MissionFilterStore } from './missionFilter';
import { createScienceActions } from './scienceActions';
import { averagesReadout, bearingDeg, dsnReadout, iceReadout } from './siteScience';
import { initialState, Store } from './store';
import type { Landing } from '../data/landings';

const IM2 = { lat: -84.79, lon: 29.2 };
/** The most sunlit ground on Shackleton's rim in the 120 m average map (10.7 km from the crater's centre). */
const SHACKLETON_RIM = { lat: -89.686, lon: -163.457 };
const APOLLO_11 = { lat: 0.67416, lon: 23.47314 };

describe('site science readouts (bundled data, no network)', () => {
  it('reads the published long-term averages near the south pole and says there are none elsewhere', async () => {
    const rim = await averagesReadout(SHACKLETON_RIM);
    expect(rim.available).toBe(true);
    if (!('sunlight' in rim) || !rim.sunlight || !rim.earthVisibility) throw new Error('expected readings');
    // The rim of Shackleton is among the most sunlit ground at the pole (73 % in the 120 m cells); Earth is in view part of the time.
    expect(rim.sunlight.pctOfTime!).toBeGreaterThan(60);
    expect(rim.sunlight.pctOfTime!).toBeLessThanOrEqual(100);
    expect(rim.earthVisibility.pctOfTime!).toBeGreaterThan(10);
    expect(rim.sunlight.cellM).toBe(120);
    expect(rim.sunlight.text).toContain('multi-year average');
    expect(rim.kind).toContain('not the geometry of the simulated date');
    expect(rim.averagingPeriod).toContain('18.6 years');
    // Shackleton's floor: never sunlit in the model.
    const floor = await averagesReadout({ lat: -89.625, lon: 118.68 });
    expect('sunlight' in floor && floor.sunlight).toMatchObject({ available: true, pctOfTime: 0, neverInModel: true });
    // Tranquility Base: no such map.
    const equator = await averagesReadout(APOLLO_11);
    expect(equator.available).toBe(false);
    expect('sunlight' in equator && equator.sunlight?.text).toContain('only the polar regions');
  });

  it('lists the nearest mapped ice targets with distance, bearing, credit and the data notes', async () => {
    const r = await iceReadout(SHACKLETON_RIM, 5);
    expect(r.available).toBe(true);
    if (!r.available) return;
    expect(r.mappedRegions).toBe(169);
    expect(r.nearest).toHaveLength(5);
    // Shackleton itself is mapped: the rim point lies within a few kilometres of its outline.
    const shackleton = r.nearest.find((t) => t.label === 'Shackleton');
    expect(shackleton).toBeDefined();
    expect(shackleton!.distanceKm!).toBeLessThan(5);
    expect(r.nearest[0].distanceKm!).toBeLessThan(5);
    for (let i = 1; i < r.nearest.length; i++) expect(r.nearest[i].distanceKm!).toBeGreaterThanOrEqual(r.nearest[i - 1].distanceKm!);
    for (const t of r.nearest) {
      if (!t.insideOutline) {
        expect(t.bearingDeg!).toBeGreaterThanOrEqual(0);
        expect(t.bearingDeg!).toBeLessThan(360);
      }
      expect(t.measuredTo).toBe('area-outline');
    }
    expect(r.distanceMeaning).toContain('not a traverse');
    expect(r.credit).toContain('Lemelin');
    expect(r.credit).toContain('CC-BY-4.0');
    expect(r.dataNotes.join(' ')).toContain('Wiechert J');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    // Far from the south pole nothing is within reach, and the readout says so instead of listing distant regions.
    const far = await iceReadout(APOLLO_11, 3);
    expect(far).toMatchObject({ available: true, nearest: [], note: expect.stringContaining('south polar region only') });
  });

  it('gives compass bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 6);
  });

  it('states why there is no DSN readout when there is no analysis', () => {
    expect(dsnReadout({ state: 'idle' })).toEqual({ available: false, reason: 'No site is selected.' });
  });
});

describe('science actions on the real analysis', () => {
  it('getSiteScience gathers DSN geometry, long-term averages and ice targets for the selected site; nearestIceTargets works for any point', async () => {
    resetActions();
    const store = new Store(initialState(Date.UTC(2026, 10, 14)));
    const analysis = new AnalysisStore(store, undefined, 200);
    const landings = [{ id: 'im-2', name: 'IM-2 Athena', program: 'p', country: 'c', date: '2025-03-06', time: '17:28', lat: IM2.lat, lon: IM2.lon, crewed: false, region: 'r', summary: 's' } as Landing];
    registerActions([...createCoreActions({ store, filters: new MissionFilterStore(), landings: () => landings, analysis }), ...createScienceActions({ store, analysis })]);
    expect(await runAction('getSiteScience')).toMatchObject({ ok: false, error: expect.stringContaining('No site is selected') });

    await runAction('selectSite', { site: 'im-2', atLanding: true });
    const r = await runAction<any>('getSiteScience');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.result;
    expect(s.site).toEqual({ id: 'im-2', name: 'IM-2 Athena', latDeg: IM2.lat, lonDegEast: IM2.lon });
    // DSN: three complexes; "any station" sees at least as much of the window as the best single one.
    expect(s.dsn).toMatchObject({ available: true, windowStartUtc: '2025-03-06T17:28Z', windowDurationH: 24 });
    expect(s.dsn.stations).toHaveLength(3);
    for (const st of s.dsn.stations) {
      expect(st.receive.pctOfWindow).toBeGreaterThanOrEqual(0);
      expect(st.receive.pctOfWindow).toBeLessThanOrEqual(100);
      expect(st.transmit.pctOfWindow).toBeLessThanOrEqual(st.receive.pctOfWindow + 1e-9); // the transmit limit is the stricter one
    }
    expect(s.dsn.anyStation.receive.pctOfWindow).toBeGreaterThanOrEqual(Math.max(...s.dsn.stations.map((x: any) => x.receive.pctOfWindow)) - 1e-9);
    expect(s.dsn.meaning).toContain('not a link budget');
    expect(s.dsn.assumptions.length).toBeGreaterThan(0);
    // Long-term averages exist at 84.8S (inside a corner of the 120 m map, which is complete from 85S).
    expect(s.longTermAverages.available).toBe(true);
    expect([120, 960]).toContain(s.longTermAverages.sunlight.cellM);
    expect(s.iceTargets.available).toBe(true);
    expect(s.iceTargets.nearest.length).toBeGreaterThan(0);
    expect(s.notIncluded[0]).toContain('Diviner');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);

    const near = await runAction<any>('nearestIceTargets', { lat: SHACKLETON_RIM.lat, lon: SHACKLETON_RIM.lon, count: 2 });
    expect(near).toMatchObject({ ok: true, result: { from: { latDeg: -89.686, lonDegEast: -163.457 }, available: true } });
    expect(near.ok && near.result.nearest).toHaveLength(2);
    expect(await runAction('nearestIceTargets', { lat: -80 })).toMatchObject({ ok: false, error: expect.stringContaining('both `lat` and `lon`') });
    const own = await runAction<any>('nearestIceTargets', {});
    expect(own.ok && own.result.from).toEqual({ latDeg: IM2.lat, lonDegEast: IM2.lon });
    analysis.stop();
    resetActions();
  }, 120_000);
});
