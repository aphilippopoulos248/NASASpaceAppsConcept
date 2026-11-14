/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { candidateOffsets, DEFAULT_NEARBY_OPTIONS, nearbyScore, rankNearbyWith, shiftableEphemeris } from './nearby';
import { modelEphemeris } from './sky';
import { fnSource, readSiteTerrain, stackOf } from './testing';
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
  it('re-projected ephemeris matches the model at a point 2 km away to < 0.001 deg', () => {
    const ref = { lat: -84.79, lon: 29.2 };
    const t0 = Date.parse('2025-03-06T00:00:00Z');
    const shifted = shiftableEphemeris(modelEphemeris(ref, 5000), ref, t0, 1_800_000, 49)(destination(ref, 60, 2000));
    const direct = modelEphemeris(destination(ref, 60, 2000), 5000);
    const a = new Float64Array(6), b = new Float64Array(6);
    for (const dt of [0, 1234_000, 7.7 * 3_600_000, 24 * 3_600_000]) {
      shifted.at(t0 + dt, a); direct.at(t0 + dt, b);
      expect(Math.abs(a[1] - b[1])).toBeLessThan(0.001);
      expect(Math.abs(a[3] - b[3])).toBeLessThan(0.001);
      expect(Math.abs(((a[0] - b[0] + 540) % 360) - 180)).toBeLessThan(0.002);
    }
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
    expect(strict.filter((r) => !r.isReference).every((r) => r.rejected === 'slope' && r.metrics === null && r.rank === 0)).toBe(true);
    const ref = strict.find((r) => r.isReference)!;
    expect(ref.rejected).toBe('slope');
    expect(ref.metrics).not.toBeNull(); // the reference row always carries its metrics
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

describe('rankNearby on real terrain: IM-2 (south polar, LOLA 60 m / 480 m)', () => {
  it('default settings: runtime and plain statement of the data resolution', async () => {
    const st = await readSiteTerrain('im-2');
    const s = scen(st.lat, st.lon, '2025-03-06T17:28:00Z', 14 * 24, 'IM-2');
    let calls = 0;
    const t0 = performance.now();
    const rows = rankNearbyWith(s, st, modelEphemeris(s.site, 5321 + 2), { ...DEFAULT_NEARBY_OPTIONS }, () => calls++);
    const ms = performance.now() - t0;
    const acc = rows.filter((r) => r.rank > 0);
    console.log(`IM-2 nearby: ${rows.length} candidates, ${acc.length} within ${DEFAULT_NEARBY_OPTIONS.slopeLimitDeg} deg, ${ms.toFixed(0)} ms; best ${acc[0]?.site.name} score ${acc[0]?.score.toFixed(1)} (illum ${acc[0]?.metrics?.illuminationPct.toFixed(1)} %, Earth ${acc[0]?.metrics?.earthVisiblePct.toFixed(1)} %); reference score ${rows.find((r) => r.isReference)!.score.toFixed(1)}; basis: ${acc[0]?.basis}`);
    expect(calls).toBe(rows.length);
    expect(rows.some((r) => r.isReference)).toBe(true);
    expect(acc[0].basis).toMatch(/60 m/);
    expect(ms).toBeLessThan(10_000);
  });
  it('Apollo 15 (with the 3 m NAC near field): runtime', async () => {
    const st = await readSiteTerrain('apollo-15');
    const s = scen(st.lat, st.lon, '1971-07-30T22:16:00Z', 14 * 24, 'Apollo 15');
    const t0 = performance.now();
    const rows = rankNearbyWith(s, st, modelEphemeris(s.site, -1928 + 2), { ...DEFAULT_NEARBY_OPTIONS });
    console.log(`Apollo 15 nearby: ${rows.length} candidates, ${rows.filter((r) => r.rank > 0).length} accepted, ${(performance.now() - t0).toFixed(0)} ms`);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
});
