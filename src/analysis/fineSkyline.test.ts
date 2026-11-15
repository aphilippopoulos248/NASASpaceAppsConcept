/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { loadTerrainFor } from '../terrain/api';
import { siteEphemeris } from './engine';
import { fineRayCount, fineSkyline, mergeRanges, nearSkylineRanges } from './fineSkyline';
import { computeHorizon, skylineAt } from './horizon';
import { findBundledTable, setBundleReader } from './sky';
import { withTransitions } from './transitions';
import type { HorizonProfile, SkyTransition } from './types';
import { analyseWith } from './window';

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
const LONG = 300_000;

/** A flat skyline at 0 deg every 0.5 deg, as the main profile stores it. */
function flat(): HorizonProfile {
  const n = 720;
  return {
    site: { lat: 0, lon: 0 }, siteElevationM: 0, mastHeightM: 2, azStepDeg: 0.5, elevDeg: new Float32Array(n), distM: new Float32Array(n), heightM: new Float32Array(n),
    smoothDipDeg: -0.05, maxRangeM: 1000, layers: [], skylineLayer: new Uint8Array(n), warnings: [],
  };
}

describe('reading a fine skyline segment', () => {
  it('reads the fine samples where a segment covers the azimuth, the main profile elsewhere', () => {
    const p = flat();
    // 100.00 to 101.00 deg every 0.05 deg, with a notch 0.1 deg wide at 100.5: the main profile cannot hold it.
    const elev = new Float32Array(21);
    elev[10] = -1;
    p.fine = [{ k0: 2000, perDeg: 20, elevDeg: elev }];
    expect(skylineAt(p, 100.5)).toBeCloseTo(-1, 6);
    expect(skylineAt(p, 100.525)).toBeCloseTo(-0.5, 6);
    expect(skylineAt(p, 100.45)).toBeCloseTo(0, 6);
    expect(skylineAt(p, 101)).toBe(0);
    expect(skylineAt(p, 99.9)).toBe(0);
    expect(skylineAt(p, 100.5 - 360)).toBeCloseTo(-1, 6);
  });

  it('wraps across north', () => {
    const p = flat();
    // 359.90 to 0.10 deg: k0 = 7198, 5 samples.
    p.fine = [{ k0: 7198, perDeg: 20, elevDeg: Float32Array.from([1, 2, 3, 4, 5]) }];
    expect(skylineAt(p, 359.9)).toBeCloseTo(1, 6);
    expect(skylineAt(p, 0)).toBeCloseTo(3, 6);
    expect(skylineAt(p, 360)).toBeCloseTo(3, 6);
    expect(skylineAt(p, 0.075)).toBeCloseTo(4.5, 6);
    expect(skylineAt(p, -0.05)).toBeCloseTo(2, 6);
    expect(skylineAt(p, 0.2)).toBe(0);
  });

  it('merges azimuth ranges, across north too', () => {
    expect(mergeRanges([[10, 12], [11, 13], [20, 21]])).toEqual([[10, 13], [20, 21]]);
    expect(mergeRanges([[-1, 1], [358, 359.5]])).toEqual([[358, 361]]);
    expect(mergeRanges([[370, 371]])).toEqual([[10, 11]]);
    expect(mergeRanges([[0, 400]])).toEqual([[0, 360]]);
    expect(mergeRanges([])).toEqual([]);
  });
});

const scenario = (id: string, lat: number, lon: number, start: string, hours: number): Scenario => ({
  id, label: id, site: { id, name: id, kind: 'custom', lat, lon }, mastHeightM: 2, startMs: Date.parse(start), durationH: hours, stepMin: 10,
});

describe('the fine skyline on real terrain', () => {
  it('marches the same rays as the main profile, only at more azimuths', async () => {
    const site = { lat: -84.7906, lon: 29.19567 };
    const stack = await loadTerrainFor({ id: 'im-2', name: 'IM-2', kind: 'custom', ...site }, { remote: false });
    const main = computeHorizon(stack, site, 2);
    const fine = fineSkyline(stack, site, 2, [[264, 266]]);
    expect(fine).toHaveLength(1);
    expect(fine[0].elevDeg.length).toBe(41);
    // Every tenth fine ray lies on a main-profile azimuth: identical values.
    for (let k = 0; k <= 4; k++) expect(fine[0].elevDeg[10 * k]).toBe(main.elevDeg[528 + k]);
  }, LONG);

  it('covers the azimuths where the Sun and Earth cross the skyline in a 14-day window at IM-2', async () => {
    const s = scenario('im-2', -84.7906, 29.19567, '2025-03-06T17:28:00Z', 336);
    const stack = await loadTerrainFor(s.site, { remote: false });
    const eph = siteEphemeris(s, stack, await findBundledTable(s.site, s.startMs, s.startMs + 336 * 3_600_000));
    const a = withTransitions(analyseWith(s, stack, eph), eph);
    const ranges = nearSkylineRanges(s, { ...a.horizon, fine: undefined }, eph);
    const covered = (az: number) => ranges.some(([from, to]) => (az >= from && az <= to) || (az + 360 >= from && az + 360 <= to));
    // Earth sets on 18 to 20 March, the Sun on 19 March: every instant of both passages lies in a fine range.
    expect(a.transitions!.length).toBeGreaterThanOrEqual(2);
    for (const tr of a.transitions!) for (const x of [tr.start, tr.end, ...tr.centre]) if (x.inWindow) expect(covered(x.azDeg), `${tr.body} ${tr.kind} at ${x.azDeg}`).toBe(true);
    // A few hundred rays, against 720 in the main profile.
    expect(fineRayCount(a.horizon.fine)).toBeGreaterThan(50);
    expect(fineRayCount(a.horizon.fine)).toBeLessThan(720);
    expect(a.provenance.assumptions.join(' ')).toMatch(/read every 0\.05 deg \(\d+ more directions\)/);
  }, LONG);
});

/**
 * The independent validation's worst cases (lunyx-science T-3, bca1ff0:
 * tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878.txt): instants the 0.5 deg
 * profile put minutes away from the validator's own skyline, which reads every azimuth the disc
 * covers. Same pins, 2 m, 60 days from 2025-03-01, the in-app model.
 */
describe("the validator's worst cases collapse", () => {
  const instantOf = (trs: SkyTransition[], body: 'sun' | 'earth', near: string, which: 'start' | 'end' | 'centre') => {
    const t = Date.parse(near);
    const tr = trs.filter((x) => x.body === body).sort((p, q) => Math.abs(p.start.timeMs - t) - Math.abs(q.start.timeMs - t))[0];
    return which === 'centre' ? tr.centre[0].timeMs : tr[which].timeMs;
  };
  const run = async (lat: number, lon: number, fine: boolean) => {
    const s = scenario('pin', lat, lon, '2025-03-01T00:00:00Z', 1440);
    const stack = await loadTerrainFor(s.site, { remote: false });
    const eph = siteEphemeris(s, stack, null);
    return withTransitions(analyseWith(s, stack, eph, {}, { fineSkyline: fine }), eph).transitions!;
  };
  const seconds = (t: number, ref: string) => Math.round((t - Date.parse(ref)) / 1000);

  it("IM-2 pin, the Sun's centre rising on 6 March: 7.7 min late on the main profile, seconds with the fine skyline", async () => {
    const [coarse, fine] = [await run(-84.79, 29.2, false), await run(-84.79, 29.2, true)];
    const ref = '2025-03-06T00:32:49Z';
    expect(seconds(instantOf(coarse, 'sun', '2025-03-05T22:44Z', 'centre'), ref)).toBeGreaterThan(400);
    expect(Math.abs(seconds(instantOf(fine, 'sun', '2025-03-05T22:44Z', 'centre'), ref))).toBeLessThan(60);
    // The same passage's whole-disc-clear instant: 146 s early before.
    expect(Math.abs(seconds(instantOf(fine, 'sun', '2025-03-05T22:44Z', 'end'), '2025-03-06T03:38:08Z'))).toBeLessThan(60);
  }, LONG);

  it("connecting-ridge pin, Earth's first limb rising on 23 April: 13.9 min late on the main profile, under a minute with the fine skyline", async () => {
    const [coarse, fine] = [await run(-89.45, -137.2, false), await run(-89.45, -137.2, true)];
    const ref = '2025-04-23T12:42:43Z';
    expect(seconds(instantOf(coarse, 'earth', '2025-04-23T12:50Z', 'start'), ref)).toBeGreaterThan(800);
    expect(Math.abs(seconds(instantOf(fine, 'earth', '2025-04-23T12:50Z', 'start'), ref))).toBeLessThan(60);
    // The Sun setting on 12 April, last limb: 341 s late before.
    expect(Math.abs(seconds(instantOf(fine, 'sun', '2025-04-12T04:30Z', 'end'), '2025-04-12T08:41:45Z'))).toBeLessThan(60);
  }, LONG);

  it('east-limb pin, the Sun rising on 29 March: a minute late on the main profile, seconds with the fine skyline', async () => {
    const fine = await run(0, 90, true);
    expect(Math.abs(seconds(instantOf(fine, 'sun', '2025-03-29T06:21Z', 'start'), '2025-03-29T06:21:15Z'))).toBeLessThan(15);
    expect(Math.abs(seconds(instantOf(fine, 'sun', '2025-03-29T06:21Z', 'end'), '2025-03-29T07:24:20Z'))).toBeLessThan(15);
  }, LONG);
});
