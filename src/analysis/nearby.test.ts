/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { loadTerrainFor } from '../terrain/api';
import { candidateOffsets, createNearbyScan, DEFAULT_NEARBY_OPTIONS, nearbyScore, offsetText, rankNearbyWith, shiftableEphemeris } from './nearby';
import { modelEphemeris } from './sky';
import { fnSource, stackOf } from './testing';
import { destination } from './horizon';

const RAD = Math.PI / 180;
const R = 1_737_400;
const scen = (lat: number, lon: number, start: string, durationH: number, label = 'site'): Scenario => ({
  id: label, label, site: { id: `pin:${lat},${lon}`, name: label, kind: 'custom', lat, lon }, mastHeightM: 2, startMs: Date.parse(start), durationH, stepMin: 10,
});

describe('nearby scan building blocks', () => {
  it('candidate grid: centre first, inside the radius', () => {
    const c = candidateOffsets(2000, 300);
    expect(c[0]).toEqual({ e: 0, n: 0 });
    expect(c.every((p) => Math.hypot(p.e, p.n) <= 2000 + 1e-6)).toBe(true);
    expect(c.length).toBe(137);
  });
  it('score is the weighted mean', () => {
    expect(nearbyScore(80, 40, { weightSun: 1, weightEarth: 1 })).toBe(60);
    expect(nearbyScore(80, 40, { weightSun: 3, weightEarth: 1 })).toBe(70);
    expect(Number.isNaN(nearbyScore(80, 40, { weightSun: 0, weightEarth: 0 }))).toBe(true);
  });
  it('re-projected ephemeris matches the model at a point 2 km away to < 0.001 deg, up to the very end of the window', () => {
    const ref = { lat: -84.79, lon: 29.2 };
    const t0 = Date.parse('2025-03-06T00:00:00Z');
    // 24 h 20 min: the window does not end on a 30 min sample.
    const t1 = t0 + 24 * 3_600_000 + 20 * 60_000;
    const asked: number[] = [];
    const base = modelEphemeris(ref, 5000);
    const spy = { ...base, at: (t: number, o: Float64Array) => { asked.push(t); base.at(t, o); } };
    const shifted = shiftableEphemeris(spy, ref, t0, t1, 1_800_000)(destination(ref, 60, 2000));
    expect(Math.min(...asked)).toBe(t0);
    expect(Math.max(...asked)).toBe(t1); // never beyond the window (a Horizons table would refuse)
    const direct = modelEphemeris(destination(ref, 60, 2000), 5000);
    const a = new Float64Array(6), b = new Float64Array(6);
    for (const dt of [0, 1234_000, 7.7 * 3_600_000, 24 * 3_600_000, 24 * 3_600_000 + 7 * 60_000, t1 - t0]) {
      shifted.at(t0 + dt, a); direct.at(t0 + dt, b);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(0.001);
      expect(Math.abs(a[3] - b[3])).toBeLessThan(0.001);
      expect(Math.abs(((a[0] - b[0] + 540) % 360) - 180)).toBeLessThan(0.002);
      expect(Math.abs(a[4] - b[4])).toBeLessThan(1e-6);
      expect(Math.abs(a[5] - b[5])).toBeLessThan(1e-5);
    }
  });
  it('offsets in words', () => {
    expect(offsetText(300, -600)).toBe('300 m E, 600 m S');
    expect(offsetText(-1800, 0)).toBe('1800 m W');
    expect(offsetText(0, 900)).toBe('900 m N');
    expect(offsetText(0, 0)).toBe('0 m');
  });
});

describe('rankNearby on synthetic terrain', () => {
  // Polar site in a valley running east-west; a ridge crest 1.2 km to the north.
  const site = { lat: -89.3, lon: 0 };
  const north = (lat: number, lon: number) => {
    // signed distance north of the site along the local meridian plane (approx. for a few km)
    const dLat = (lat - site.lat) * RAD * R;
    const dLon = ((((lon - site.lon + 540) % 360) - 180) * RAD) * R * Math.cos(lat * RAD);
    return { n: dLat, e: dLon };
  };
  const terrain = fnSource('valley+ridge', 20, (lat, lon) => {
    const { n } = north(lat, lon);
    return 400 * Math.exp(-(((n - 1200) / 350) ** 2)) - 300 * Math.exp(-((n / 900) ** 2));
  });
  it('the ridge crest outranks the valley floor', () => {
    const s = scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 7 * 24);
    const rows = rankNearbyWith(s, stackOf(terrain), modelEphemeris(site, -300), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 1500, spacingM: 300, slopeLimitDeg: 30 });
    const ref = rows.find((r) => r.isReference)!;
    const best = rows[0];
    console.log(`best ${best.site.name} score ${best.score.toFixed(1)} vs reference ${ref.score.toFixed(1)}`);
    expect(best.rank).toBe(1);
    expect(best.northM).toBeGreaterThan(600);
    expect(best.score).toBeGreaterThan(ref.score);
    expect(rows.length).toBe(candidateOffsets(1500, 300).length);
  });
  it('a steep wall is rejected at a 10 deg limit and accepted at 30 deg', () => {
    // plane tilted 20 deg everywhere
    const wall = fnSource('20 deg wall', 20, (lat) => Math.tan(20 * RAD) * (lat - site.lat) * RAD * R);
    const s = scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 24);
    const opts = { ...DEFAULT_NEARBY_OPTIONS, radiusM: 300, spacingM: 300 };
    const strict = rankNearbyWith(s, stackOf(wall), modelEphemeris(site, 0), { ...opts, slopeLimitDeg: 10 });
    expect(strict.filter((r) => !r.isReference).every((r) => r.rejected === 'slope' && r.metrics === null && r.rank === 0 && Number.isNaN(r.score))).toBe(true);
    const ref = strict.find((r) => r.isReference)!;
    expect(ref.rejected).toBe('slope');
    expect(ref.rank).toBe(0);
    expect(ref.metrics).not.toBeNull(); // the reference row always carries its metrics and score
    expect(Number.isFinite(ref.score)).toBe(true);
    expect(strict[0]).toBe(ref); // nothing is ranked: the reference leads the list
    const loose = rankNearbyWith(s, stackOf(wall), modelEphemeris(site, 0), { ...opts, slopeLimitDeg: 30 });
    expect(loose.every((r) => r.rejected === null && r.rank > 0)).toBe(true);
    expect(loose[0].slope.slopeDeg).toBeCloseTo(20, 0);
  });
  it('candidates without elevation data are rejected as no-data', () => {
    const patch = fnSource('patch', 20, () => 0, (lat) => lat < site.lat + 0.005);
    const s = scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 24);
    const rows = rankNearbyWith(s, stackOf(patch), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 600, spacingM: 300 });
    expect(rows.some((r) => r.rejected === 'no-data')).toBe(true);
  });
});

describe('rankNearby: one slope measure for all candidates, names, bearings, stepping', () => {
  const site = { lat: 10, lon: 20 };
  // A fine survey that only reaches 400 m around the site, over a coarser layer that covers everything.
  const fine = fnSource('fine survey', 3, () => 0, (lat, lon) => Math.hypot(lat - site.lat, lon - site.lon) * RAD * R < 400);
  const coarse = fnSource('coarse grid', 60, (lat) => Math.tan(4 * RAD) * (lat - site.lat) * RAD * R);
  const s = scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 24, 'Base');
  s.site.name = 'Base';
  it('judges every candidate on the layer that covers most of them, and says so', () => {
    const rows = rankNearbyWith(s, stackOf(fine, coarse), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 1200, spacingM: 300 });
    expect(rows.every((r) => r.slope.demName.startsWith('coarse grid'))).toBe(true);
    expect(rows.every((r) => r.slope.baselineM === 120)).toBe(true);
    expect(rows.every((r) => Math.abs(r.slope.slopeDeg - 4) < 0.05)).toBe(true);
    expect(rows[0].basis).toMatch(/Slope over 120 m from coarse grid \(60 m grid\), the same measure for every candidate\./);
  });
  it('rows carry exact names, distance and bearing', () => {
    const rows = rankNearbyWith(s, stackOf(coarse), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 600, spacingM: 300 });
    const sw = rows.find((r) => r.eastM === -300 && r.northM === -300)!;
    expect(sw.site.name).toBe('Candidate 300 m W, 300 m S of Base');
    expect(sw.site.kind).toBe('candidate');
    expect(sw.bearingDeg).toBeCloseTo(225, 6);
    expect(sw.distanceM).toBeCloseTo(Math.hypot(300, 300), 6);
    const ref = rows.find((r) => r.isReference)!;
    expect(ref.site).toBe(s.site);
    expect(Number.isNaN(ref.bearingDeg as number)).toBe(true);
    expect(new Set(rows.map((r) => r.site.name)).size).toBe(rows.length);
    // ranks are 1..n without gaps among the accepted rows
    expect(rows.filter((r) => r.rank > 0).map((r) => r.rank)).toEqual(rows.filter((r) => r.rank > 0).map((_, i) => i + 1));
  });
  it('can be advanced one candidate at a time', () => {
    const scan = createNearbyScan(s, stackOf(coarse), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 300, spacingM: 300 });
    expect(scan.total).toBe(5);
    expect(() => scan.result()).toThrow(/not finished/);
    let steps = 0;
    while (scan.step()) steps++;
    expect(steps).toBe(4);
    expect(scan.done).toBe(5);
    expect(scan.step()).toBe(false);
    expect(scan.result().length).toBe(5);
  });
  it('rejects impossible settings', () => {
    expect(() => createNearbyScan(s, stackOf(coarse), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, spacingM: 0 })).toThrow(RangeError);
    expect(() => createNearbyScan(s, stackOf(coarse), modelEphemeris(site, 0), { ...DEFAULT_NEARBY_OPTIONS, radiusM: 50_000, spacingM: 100 })).toThrow(/too many/);
  });
});

describe('rankNearby on real terrain (loadTerrainFor)', () => {
  it('IM-2 (south polar: LOLA 60 m window, 80 m and 160 m polar layers): default settings', async () => {
    const site = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, lat: -84.79, lon: 29.2 };
    const st = await loadTerrainFor(site);
    const s = { ...scen(site.lat, site.lon, '2025-03-06T17:28:00Z', 14 * 24, 'IM-2'), site };
    let calls = 0;
    const t0 = performance.now();
    const rows = rankNearbyWith(s, st, modelEphemeris(site, 5321 + 2), { ...DEFAULT_NEARBY_OPTIONS }, () => calls++);
    const ms = performance.now() - t0;
    const acc = rows.filter((r) => r.rank > 0);
    const ref = rows.find((r) => r.isReference)!;
    console.log(`IM-2 nearby: ${rows.length} candidates, ${acc.length} within ${DEFAULT_NEARBY_OPTIONS.slopeLimitDeg} deg, ${ms.toFixed(0)} ms; best ${acc[0].site.name}: score ${acc[0].score.toFixed(1)} (illumination ${acc[0].metrics!.illuminationPct.toFixed(1)} %, Earth ${acc[0].metrics!.earthVisiblePct.toFixed(1)} %, longest darkness ${acc[0].metrics!.longestDarknessH.toFixed(1)} h, slope ${acc[0].slope.slopeDeg.toFixed(1)} deg); reference rank ${ref.rank}, score ${ref.score.toFixed(1)} (illumination ${ref.metrics!.illuminationPct.toFixed(1)} %); basis: ${acc[0].basis}`);
    expect(calls).toBe(rows.length);
    expect(rows.length).toBe(137);
    expect(ref.rank).toBeGreaterThan(0);
    expect(acc[0].score).toBeGreaterThanOrEqual(ref.score);
    expect(acc[0].basis).toMatch(/Slope over 120 m from .*60 m site window \(60 m grid\)/);
    expect(acc[0].basis).toMatch(/Skyline every 1 deg/);
    // No wall-clock limit here: it would fail on a busy machine (T-28). Runtime is checked by scripts/bench-analysis.mjs.
  }, 120_000);
  it('Apollo 15 (3 m survey near the site only): slopes come from the 60 m window for every candidate', async () => {
    const site = { id: 'apollo-15', name: 'Apollo 15', kind: 'landing' as const, lat: 26.13239, lon: 3.6333 };
    const st = await loadTerrainFor(site);
    const s = { ...scen(site.lat, site.lon, '1971-07-30T22:16:00Z', 14 * 24, 'Apollo 15'), site };
    const t0 = performance.now();
    const rows = rankNearbyWith(s, st, modelEphemeris(site, -1927 + 2), { ...DEFAULT_NEARBY_OPTIONS });
    console.log(`Apollo 15 nearby: ${rows.length} candidates, ${rows.filter((r) => r.rank > 0).length} accepted, ${(performance.now() - t0).toFixed(0)} ms; slope basis: ${rows[0].basis.split('.')[0]}`);
    expect(rows.every((r) => r.slope.baselineM === 120 && /60 m site window/.test(r.slope.demName))).toBe(true);
    expect(rows.filter((r) => r.rank > 0).length).toBeGreaterThan(100);
  }, 120_000);
});
