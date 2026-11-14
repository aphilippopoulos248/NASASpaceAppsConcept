/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { computeHorizon } from './horizon';
import { findBundledTable, horizonsEphemeris, modelEphemeris, setBundleReader } from './sky';
import { fnSource, radialSource, readSiteTerrain, stackOf } from './testing';
import { analyseWith, blockageAt, compareAnalyses, discVisibility, nextEvents } from './window';
import { analyseStack } from './api';

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
const H = 3_600_000;
const scen = (lat: number, lon: number, start: string, durationH: number, stepMin = 10, mastHeightM = 2, label = 'S'): Scenario => ({
  id: label, label, site: { id: `pin:${lat},${lon}`, name: label, kind: 'custom', lat, lon }, mastHeightM, startMs: Date.parse(start), durationH, stepMin,
});
const flat = () => stackOf(fnSource('sphere', 60, () => 0));
const run = (s: Scenario, stack = flat()) => analyseWith(s, stack, modelEphemeris(s.site, s.mastHeightM));

describe('discVisibility', () => {
  const p = computeHorizon(flat(), { lat: 0, lon: 0 }, 0);
  const r = 0.2666;
  it('half the disc at the skyline, none below, all above', () => {
    expect(discVisibility(p, 90, 0, r).fraction).toBeCloseTo(0.5, 2);
    expect(discVisibility(p, 90, -r - 0.01, r).fraction).toBe(0);
    expect(discVisibility(p, 90, r + 0.01, r).fraction).toBe(1);
  });
  it('partial disc matches the circular-segment area', () => {
    // centre r/2 above the skyline: hidden part is the segment beyond distance r/2 from the centre
    const seg = (Math.acos(0.5) - 0.5 * Math.sqrt(0.75)) / Math.PI;
    expect(discVisibility(p, 90, r / 2, r).fraction).toBeCloseTo(1 - seg, 2);
    expect(discVisibility(p, 90, -r / 2, r).fraction).toBeCloseTo(seg, 2);
  });
});

describe('analyse on analytic terrain', () => {
  it('equator, smooth sphere, one synodic month: Sun up about half the time, two terminator crossings', () => {
    const a = run(scen(0, 0, '2025-01-01T00:00:00Z', 29.53 * 24, 20, 0));
    expect(a.metrics.sunAnyPct).toBeGreaterThan(49);
    expect(a.metrics.sunAnyPct).toBeLessThan(52);
    const darkH = a.metrics.darkIntervals.reduce((x, iv) => x + (iv.endMs - iv.startMs) / H, 0);
    expect(darkH).toBeGreaterThan(340);
    expect(darkH).toBeLessThan(360);
    expect(a.events.filter((e) => e.type === 'sunrise').length).toBe(1);
    expect(a.events.filter((e) => e.type === 'sunset').length).toBe(1);
    expect(a.metrics.earthVisiblePct).toBe(100);
    expect(a.metrics.longestEarthGapH).toBe(0);
    expect(a.provenance.ephemeris).toBe('model');
  });

  it('permanently shadowed crater floor near the south pole: 0 % illumination', () => {
    const site = { lat: -89.8, lon: 0 };
    const bowl = radialSource('bowl', 20, site.lat, site.lon, (d) => (d < 8000 ? -2500 + 2500 * (d / 8000) ** 2 : 0));
    const a = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 30 * 24, 30, 2), stackOf(bowl));
    expect(a.metrics.illuminationPct).toBe(0);
    expect(a.metrics.sunAnyPct).toBe(0);
    expect(a.metrics.darknessOpenEnded).toBe(true);
    expect(a.metrics.longestDarknessH).toBeCloseTo(30 * 24, 6);
    expect(a.events.filter((e) => e.type.startsWith('sun')).length).toBe(0);
  });

  it('polar peak 2 km above flat surroundings: near-permanent light', () => {
    const site = { lat: -89.5, lon: 45 };
    const peak = radialSource('peak', 20, site.lat, site.lon, (d) => 2000 * Math.exp(-((d / 3000) ** 2)));
    const a = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 30 * 24, 30, 10), stackOf(peak));
    expect(a.metrics.sunAnyPct).toBeGreaterThan(99.9);
    expect(a.metrics.illuminationPct).toBeGreaterThan(99);
  });

  it('far side: Earth never visible, the gap is the whole window and open-ended', () => {
    const a = run(scen(0, 180, '2025-03-01T00:00:00Z', 14 * 24));
    expect(a.metrics.earthVisiblePct).toBe(0);
    expect(a.metrics.longestEarthGapH).toBeCloseTo(14 * 24, 6);
    expect(a.metrics.earthGapOpenEnded).toBe(true);
    expect(a.metrics.earthGapIntervals[0]).toMatchObject({ openStart: true, openEnd: true });
    expect(a.warnings.join(' ')).toMatch(/Earth gap runs into the edge/);
  });

  it('limb site: libration moves Earth across the skyline (earthrise and earthset in a month)', () => {
    const a = run(scen(0, 89, '2025-03-01T00:00:00Z', 30 * 24, 30, 2));
    expect(a.metrics.earthVisiblePct).toBeGreaterThan(5);
    expect(a.metrics.earthVisiblePct).toBeLessThan(95);
    expect(a.events.some((e) => e.type === 'earthrise')).toBe(true);
    expect(a.events.some((e) => e.type === 'earthset')).toBe(true);
  });

  it('Sun grazing a ridge: partial disc fractions between 0 and 1 appear in the series', () => {
    const site = { lat: -89.6, lon: 0 };
    // ring whose elevation (~1.25 deg) sits inside the Sun's polar elevation range
    const ring = radialSource('ring', 20, site.lat, site.lon, (d) => 450 * Math.exp(-(((d - 20_000) / 1000) ** 2)));
    const a = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 30 * 24, 10, 2), stackOf(ring));
    const partial = Array.from(a.series.sunVisible).filter((v) => v > 0.02 && v < 0.98).length;
    expect(partial).toBeGreaterThan(5);
    expect(a.metrics.illuminationPct).toBeLessThan(a.metrics.sunAnyPct);
  });

  it('events at the window edges: a window starting in darkness reports open intervals, no event at the edge', () => {
    const base = run(scen(0, 0, '2025-01-01T00:00:00Z', 29.53 * 24, 20, 0));
    const sr = base.events.find((e) => e.type === 'sunrise')!;
    // start the window exactly at the refined sunrise
    const a = run({ ...scen(0, 0, '2025-01-01T00:00:00Z', 48, 10, 0), startMs: sr.timeMs });
    expect(a.events.filter((e) => e.timeMs <= a.scenario.startMs).length).toBe(0);
    expect(a.metrics.sunIntervals[0].openStart || a.metrics.darkIntervals[0].openStart).toBe(true);
    const all = [...a.metrics.sunIntervals, ...a.metrics.darkIntervals].sort((x, y) => x.startMs - y.startMs);
    expect(all[0].startMs).toBe(a.scenario.startMs);
    expect(all[all.length - 1].endMs).toBe(a.scenario.startMs + 48 * H);
    expect(all[all.length - 1].openEnd).toBe(true);
  });

  it('no terrain: metrics NaN with the reason', () => {
    const a = run(scen(0, 0, '2025-01-01T00:00:00Z', 24), stackOf(fnSource('none', 60, () => 0, () => false)));
    expect(Number.isNaN(a.metrics.illuminationPct)).toBe(true);
    expect(Number.isNaN(a.slope.slopeDeg)).toBe(true);
    expect(a.warnings.join(' ')).toMatch(/unavailable/);
  });
});

describe('real terrain and bundled Horizons windows', () => {
  it('Apollo 15, 14 days from landing: convergence when the step is halved, runtime', async () => {
    const st = await readSiteTerrain('apollo-15');
    const s10 = scen(st.lat, st.lon, '1971-07-30T22:16:00Z', 14 * 24, 10, 2, 'Apollo 15');
    let t0 = performance.now();
    const a = analyseWith(s10, st, modelEphemeris(s10.site, -1928 + 2));
    const ms = performance.now() - t0;
    const b = analyseWith({ ...s10, stepMin: 5 }, st, modelEphemeris(s10.site, -1928 + 2));
    console.log(`apollo-15 14 d: ${ms.toFixed(0)} ms; illum ${a.metrics.illuminationPct.toFixed(3)} vs ${b.metrics.illuminationPct.toFixed(3)}; events ${a.events.map((e) => `${e.type} ${new Date(e.timeMs).toISOString()}`).join(', ')}`);
    expect(Math.abs(a.metrics.illuminationPct - b.metrics.illuminationPct)).toBeLessThan(0.1);
    expect(Math.abs(a.metrics.sunAnyPct - b.metrics.sunAnyPct)).toBeLessThan(0.05);
    expect(a.events.length).toBe(b.events.length);
    a.events.forEach((e, i) => expect(Math.abs(e.timeMs - b.events[i].timeMs)).toBeLessThan(60_000));
    expect(ms).toBeLessThan(3000);
    t0 = performance.now();
    void t0;
  });

  for (const [id, label, start] of [['blue-ghost-1', 'Blue Ghost Mission 1', '2025-03-02T08:34:00Z'], ['im-2', 'IM-2 Athena', '2025-03-06T17:28:00Z']] as const) {
    it(`${label}: bundled Horizons table drives the series; metrics`, async () => {
      const st = await readSiteTerrain(id);
      const s = scen(st.lat, st.lon, start, 14 * 24, 10, 2, label);
      const t0 = performance.now();
      const a = await analyseStack(s, st);
      const ms = performance.now() - t0;
      expect(a.series.source).toBe('horizons');
      expect(a.provenance.ephemerisNote).toMatch(/Horizons/);
      const m = a.metrics;
      console.log(`${label}: ${ms.toFixed(0)} ms; illum ${m.illuminationPct.toFixed(1)} %, sunAny ${m.sunAnyPct.toFixed(1)} %, longest dark ${m.longestDarknessH.toFixed(1)} h${m.darknessOpenEnded ? ' (open)' : ''}, Earth ${m.earthVisiblePct.toFixed(1)} %, longest gap ${m.longestEarthGapH.toFixed(1)} h${m.earthGapOpenEnded ? ' (open)' : ''}, sun el ${m.minSunElDeg.toFixed(2)}..${m.maxSunElDeg.toFixed(2)}, slope ${a.slope.slopeDeg.toFixed(1)} deg / ${a.slope.baselineM} m; events ${a.events.length}; layers ${a.horizon.layers.map((l) => l.name).join(' | ')}`);
      // model ephemeris for the same scenario gives practically the same metrics
      const b = analyseWith(s, st, modelEphemeris(s.site, a.horizon.siteElevationM + 2));
      expect(Math.abs(b.metrics.illuminationPct - m.illuminationPct)).toBeLessThan(0.2);
      expect(Math.abs(b.metrics.earthVisiblePct - m.earthVisiblePct)).toBeLessThan(0.2);
      void horizonsEphemeris; void findBundledTable;
      if (id === 'blue-ghost-1') {
        // 2025-03-14 total lunar eclipse = Earth hides the Sun as seen from the Moon (umbral phase about 05:09-08:48 UTC, totality 06:26-07:31 UTC on Earth's side).
        const ecl = m.eclipseIntervals.find((iv) => new Date(iv.startMs).toISOString().startsWith('2025-03-14'));
        expect(ecl).toBeDefined();
        const dark = m.darkIntervals.find((iv) => iv.startMs < Date.parse('2025-03-14T07:00:00Z') && iv.endMs > Date.parse('2025-03-14T07:00:00Z'));
        expect(dark).toBeDefined();
        console.log(`Blue Ghost eclipse: Earth overlaps the Sun ${new Date(ecl!.startMs).toISOString()} - ${new Date(ecl!.endMs).toISOString()}; Sun fully hidden ${new Date(dark!.startMs).toISOString()} - ${new Date(dark!.endMs).toISOString()}`);
        expect(m.sunAnyPct).toBeLessThan(100);
        expect(a.warnings.join(' ')).toMatch(/Earth passes in front of the Sun/);
      }
    });
  }
});

describe('blockageAt, nextEvents, compareAnalyses', () => {
  it('explains a hidden Sun from the numbers of the ridge', () => {
    const site = { lat: -89.8, lon: 0 };
    const bowl = radialSource('bowl', 20, site.lat, site.lon, (d) => (d < 8000 ? -2500 + 2500 * (d / 8000) ** 2 : 0));
    const a = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 48, 30, 2), stackOf(bowl));
    const b = blockageAt(a, 'sun', a.scenario.startMs + 3 * H);
    expect(b.blocked).toBe(true);
    expect(b.clearanceDeg).toBeCloseTo(b.bodyElDeg - b.skylineElDeg, 6);
    expect(b.ridgeDistanceM).toBeGreaterThan(6000);
    expect(b.ridgeDistanceM).toBeLessThan(10000);
    expect(b.demName).toBe('bowl');
    expect(b.explanation).toMatch(/hidden by \d+\.\d\d deg/);
    expect(b.explanation).toContain(b.skylineElDeg.toFixed(2));
    // Outside the window the model is used.
    expect(Number.isFinite(blockageAt(a, 'earth', a.scenario.startMs - 10 * H).bodyElDeg)).toBe(true);
  });
  it('nextEvents finds the next of each kind, null when none in the window', () => {
    const a = run(scen(0, 0, '2025-01-01T00:00:00Z', 29.53 * 24, 20, 0));
    const n = nextEvents(a, a.scenario.startMs);
    expect(n.sunrise?.type).toBe('sunrise');
    expect(n.earthset).toBeNull();
    expect(nextEvents(a, n.sunrise!.timeMs).sunrise).toBeNull();
  });
  it('compareAnalyses: signed differences and sentences, most important first', () => {
    const lit = run(scen(0, 0, '2025-01-05T00:00:00Z', 72, 10, 2, 'Site A'));
    const far = run(scen(0, 180, '2025-01-05T00:00:00Z', 72, 10, 2, 'Site B'));
    const d = compareAnalyses(lit, far);
    expect(d.earthVisiblePct).toBeCloseTo(far.metrics.earthVisiblePct - lit.metrics.earthVisiblePct, 9);
    expect(d.highlights.length).toBeGreaterThan(0);
    expect(d.highlights.join(' ')).toMatch(/Site B/);
    const same = compareAnalyses(lit, lit);
    expect(same.highlights[0]).toMatch(/practically the same/);
  });
  it('+24 h delayed arrival at the same site', () => {
    const a = run(scen(0, 0, '2025-01-05T00:00:00Z', 7 * 24, 10, 2, 'On time'));
    const b = run({ ...scen(0, 0, '2025-01-05T00:00:00Z', 7 * 24, 10, 2, '+24 h'), startMs: Date.parse('2025-01-06T00:00:00Z') });
    const d = compareAnalyses(a, b);
    expect(Number.isFinite(d.illuminationPct)).toBe(true);
  });
});
