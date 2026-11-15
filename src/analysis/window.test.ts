/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { computeHorizon } from './horizon';
import { modelEphemeris, setBundleReader } from './sky';
import { loadTerrainFor } from '../terrain/api';
import { fnSource, radialSource, stackOf } from './testing';
import { analyseWith, blockageAt, compareAnalyses, comparisonNames, discOverlap, discVisibility, nextEvents } from './window';
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

describe('window edges', () => {
  it('a window that ends between two samples still finds an event in its last partial step', () => {
    const base = run(scen(0, 0, '2025-01-01T00:00:00Z', 29.53 * 24, 20, 0));
    const sunset = base.events.find((e) => e.type === 'sunset')!;
    // 60 min steps; the window ends 20 min after the sunset, 35 min after its last sample.
    const startMs = sunset.timeMs - 5 * H - 15 * 60_000;
    const a = run({ ...scen(0, 0, '2025-01-01T00:00:00Z', 5 + 35 / 60, 60, 0), startMs });
    expect(a.series.n).toBe(6);
    const found = a.events.find((e) => e.type === 'sunset');
    expect(found, 'sunset inside the last partial step').toBeDefined();
    expect(Math.abs(found!.timeMs - sunset.timeMs)).toBeLessThan(30_000);
    const lastDark = a.metrics.darkIntervals[a.metrics.darkIntervals.length - 1];
    expect(lastDark.endMs).toBe(startMs + (5 + 35 / 60) * H);
    expect(lastDark.openEnd).toBe(true);
    expect(a.metrics.sunAnyPct).toBeGreaterThan(90);
    expect(a.metrics.sunAnyPct).toBeLessThan(100);
  });
  it('percentages and intervals add up to the window', () => {
    const a = run(scen(0, 89, '2025-03-01T00:00:00Z', 20 * 24 + 7.3, 30, 2));
    const total = (l: { startMs: number; endMs: number }[]) => l.reduce((x, iv) => x + iv.endMs - iv.startMs, 0);
    const windowMs = (20 * 24 + 7.3) * H;
    expect(total(a.metrics.sunIntervals) + total(a.metrics.darkIntervals)).toBeCloseTo(windowMs, -1);
    expect(total(a.metrics.earthIntervals) + total(a.metrics.earthGapIntervals)).toBeCloseTo(windowMs, -1);
    expect(a.metrics.earthVisiblePct).toBeCloseTo((100 * total(a.metrics.earthIntervals)) / windowMs, 6);
  });
});

describe('disc overlap (Earth in front of the Sun)', () => {
  it('limits and symmetry', () => {
    expect(discOverlap(2, 0.27, 0.95)).toBe(0);
    expect(discOverlap(0.5, 0.27, 0.95)).toBe(1);
    expect(discOverlap(0.95, 0.27, 0.95)).toBeGreaterThan(0.45);
    expect(discOverlap(0.95, 0.27, 0.95)).toBeLessThan(0.5);
    // equal discs, centres one radius apart: 2/3 - sqrt(3)/(2 pi) of the disc
    expect(discOverlap(1, 1, 1)).toBeCloseTo(2 / 3 - Math.sqrt(3) / (2 * Math.PI), 9);
    // a smaller covering disc can hide at most its own area
    expect(discOverlap(0, 1, 0.5)).toBeCloseTo(0.25, 12);
  });
});

const landing = (id: string, name: string, lat: number, lon: number) => ({ id, name, kind: 'landing' as const, lat, lon });
const BLUE_GHOST = landing('blue-ghost-1', 'Blue Ghost Mission 1', 18.562, 61.81);
const IM2 = landing('im-2', 'IM-2 Athena', -84.79, 29.2);
const APOLLO15 = landing('apollo-15', 'Apollo 15', 26.13239, 3.6333);
const scenAt = (site: typeof BLUE_GHOST, start: string, durationH: number, stepMin = 10, mastHeightM = 2, label = site.name): Scenario => ({ id: `${site.id}|${start}|${durationH}|${stepMin}|${mastHeightM}`, label, site, mastHeightM, startMs: Date.parse(start), durationH, stepMin });
const isoS = (t: number) => `${new Date(t).toISOString().slice(0, 19)}Z`;

describe('real terrain (loadTerrainFor) and bundled Horizons windows', () => {
  it('Apollo 15, 14 days from landing (model ephemeris): convergence when the step is halved; the 6 August 1971 eclipse is in the window', async () => {
    const st = await loadTerrainFor(APOLLO15);
    const s10 = scenAt(APOLLO15, '1971-07-30T22:16:00Z', 14 * 24);
    const t0 = performance.now();
    const a = await analyseStack(s10, st);
    const ms = performance.now() - t0;
    const b = await analyseStack({ ...s10, stepMin: 5 }, st);
    expect(a.series.source).toBe('model');
    const dark = a.metrics.darkIntervals.find((iv) => isoS(iv.startMs).startsWith('1971-08-06'));
    console.log(`apollo-15 14 d: ${ms.toFixed(0)} ms; illumination ${a.metrics.illuminationPct.toFixed(3)} % at 10 min vs ${b.metrics.illuminationPct.toFixed(3)} % at 5 min; events ${a.events.map((e) => `${e.type} ${isoS(e.timeMs)}`).join(', ')}; Sun behind Earth ${dark ? `${isoS(dark.startMs)} to ${isoS(dark.endMs)}` : 'never'}`);
    expect(Math.abs(a.metrics.illuminationPct - b.metrics.illuminationPct)).toBeLessThan(0.1);
    expect(Math.abs(a.metrics.sunAnyPct - b.metrics.sunAnyPct)).toBeLessThan(0.05);
    expect(a.events.length).toBe(b.events.length);
    a.events.forEach((e, i) => expect(Math.abs(e.timeMs - b.events[i].timeMs)).toBeLessThan(60_000));
    // Total lunar eclipse of 1971 August 6, contacts from F. Espenak's EclipseWise page (UT1): U1 17:55:25,
    // U2 18:53:28, U3 20:32:53, U4 21:30:57, P1 16:59:26, P4 22:26:50. A point on the Moon has the Sun entirely
    // hidden from some moment between U1 and U2 until some moment between U3 and U4.
    expect(dark).toBeDefined();
    expect(dark!.startMs).toBeGreaterThan(Date.parse('1971-08-06T17:55:25Z'));
    expect(dark!.startMs).toBeLessThan(Date.parse('1971-08-06T18:53:28Z'));
    expect(dark!.endMs).toBeGreaterThan(Date.parse('1971-08-06T20:32:53Z'));
    expect(dark!.endMs).toBeLessThan(Date.parse('1971-08-06T21:30:57Z'));
    const overlap71 = a.metrics.eclipseIntervals.find((iv) => isoS(iv.startMs).startsWith('1971-08-06'))!;
    expect(overlap71.startMs).toBeGreaterThan(Date.parse('1971-08-06T16:59:26Z'));
    expect(overlap71.endMs).toBeLessThan(Date.parse('1971-08-06T22:26:50Z'));
    // Sunset over the real skyline on the 13th; Earth stays up (near side).
    expect(a.events.map((e) => e.type)).toEqual(['sunset']);
    expect(isoS(a.events[0].timeMs).slice(0, 13)).toBe('1971-08-13T11');
    expect(a.metrics.earthVisiblePct).toBe(100);
    // Provenance: the terrain module's notes are kept; the purely descriptive one is not repeated as a warning.
    expect(a.provenance.terrainNotes!.some((n) => /finest first/.test(n))).toBe(true);
    expect(a.warnings.some((n) => /finest first/.test(n))).toBe(false);
    expect(a.warnings.some((n) => /whole-Moon grid/.test(n))).toBe(true);
    expect(a.slope.baselineM).toBe(10);
    expect(a.slope.slopeDeg).toBeGreaterThan(0);
    expect(a.slope.slopeDeg).toBeLessThan(10);
  });

  it('Blue Ghost Mission 1, 15 days from landing: Horizons table, the 14 March 2025 eclipse, sunset on 16 March', async () => {
    const st = await loadTerrainFor(BLUE_GHOST);
    const s = scenAt(BLUE_GHOST, '2025-03-02T08:34:00Z', 15 * 24);
    const t0 = performance.now();
    const a = await analyseStack(s, st);
    const ms = performance.now() - t0;
    const m = a.metrics;
    expect(a.series.source).toBe('horizons');
    expect(a.provenance.ephemerisNote).toMatch(/Horizons/);
    const ecl = m.eclipseIntervals.find((iv) => isoS(iv.startMs).startsWith('2025-03-14'))!;
    const dark = m.darkIntervals.find((iv) => iv.startMs < Date.parse('2025-03-14T07:00:00Z') && iv.endMs > Date.parse('2025-03-14T07:00:00Z'))!;
    const sunset = a.events.find((e) => e.type === 'sunset')!;
    console.log(`Blue Ghost 15 d: ${ms.toFixed(0)} ms; illumination ${m.illuminationPct.toFixed(2)} %, any Sun ${m.sunAnyPct.toFixed(2)} %, Earth ${m.earthVisiblePct.toFixed(1)} %; Earth overlaps the Sun ${isoS(ecl.startMs)} to ${isoS(ecl.endMs)}; Sun fully hidden ${isoS(dark.startMs)} to ${isoS(dark.endMs)}; sunset (last limb) ${isoS(sunset.timeMs)} at azimuth ${sunset.azDeg.toFixed(1)}; skyline ${Math.min(...a.horizon.elevDeg).toFixed(2)}..${Math.max(...a.horizon.elevDeg).toFixed(2)} deg; slope ${a.slope.slopeDeg.toFixed(2)} deg over ${a.slope.baselineM} m`);
    // The independent Horizons fixture (tests/fixtures/horizons/ephemeris-check, 10 min samples) has the discs
    // overlapping in its samples from 05:10 to 09:50 and the Sun wholly behind Earth from 06:20 to 08:30.
    expect(ecl.startMs).toBeGreaterThan(Date.parse('2025-03-14T05:00:00Z'));
    expect(ecl.startMs).toBeLessThan(Date.parse('2025-03-14T05:10:00Z'));
    expect(ecl.endMs).toBeGreaterThan(Date.parse('2025-03-14T09:50:00Z'));
    expect(ecl.endMs).toBeLessThan(Date.parse('2025-03-14T10:00:00Z'));
    expect(dark.startMs).toBeGreaterThan(Date.parse('2025-03-14T06:10:00Z'));
    expect(dark.startMs).toBeLessThan(Date.parse('2025-03-14T06:20:00Z'));
    expect(dark.endMs).toBeGreaterThan(Date.parse('2025-03-14T08:30:00Z'));
    expect(dark.endMs).toBeLessThan(Date.parse('2025-03-14T08:40:00Z'));
    expect(a.warnings.join(' ')).toMatch(/Earth passes in front of the Sun/);
    // Published contacts of the lunar eclipse (EclipseWise, UT1): P1 03:57:09, U1 05:09:23, U2 06:25:58,
    // U3 07:32:02, U4 08:48:19, P4 10:00:32. The site's totality starts between U1 and U2 and ends between U3 and U4.
    expect(dark.startMs).toBeGreaterThan(Date.parse('2025-03-14T05:09:23Z'));
    expect(dark.startMs).toBeLessThan(Date.parse('2025-03-14T06:25:58Z'));
    expect(dark.endMs).toBeGreaterThan(Date.parse('2025-03-14T07:32:02Z'));
    expect(dark.endMs).toBeLessThan(Date.parse('2025-03-14T08:48:19Z'));
    expect(ecl.startMs).toBeGreaterThan(Date.parse('2025-03-14T03:57:09Z'));
    expect(ecl.endMs).toBeLessThan(Date.parse('2025-03-14T10:00:32Z'));
    // Reported for the lander (KUT / Texas Public Radio, local CDT = UTC-5): the eclipse "starting at 12 a.m. ...
    // and ending around 4:52 a.m.", "Totality lasted just over 2 hours, beginning at 1:18 a.m.".
    expect(Math.abs(ecl.startMs - Date.parse('2025-03-14T05:00:00Z'))).toBeLessThan(3 * 60_000);
    expect(Math.abs(ecl.endMs - Date.parse('2025-03-14T09:52:00Z'))).toBeLessThan(3 * 60_000);
    expect(Math.abs(dark.startMs - Date.parse('2025-03-14T06:18:00Z'))).toBeLessThan(3 * 60_000);
    expect((dark.endMs - dark.startMs) / H).toBeGreaterThan(2);
    expect((dark.endMs - dark.startMs) / H).toBeLessThan(2.5);
    // Sunset over the real skyline comes before the smooth-sphere time (centre at the horizontal about 20:11 UTC).
    expect(sunset.timeMs).toBeGreaterThan(Date.parse('2025-03-16T18:30:00Z'));
    expect(sunset.timeMs).toBeLessThan(Date.parse('2025-03-16T20:45:00Z'));
    expect(m.earthVisiblePct).toBe(100);
    // The model ephemeris gives practically the same answer as the Horizons table.
    const b = analyseWith(s, st, modelEphemeris(s.site, a.horizon.siteElevationM + 2));
    expect(Math.abs(b.metrics.illuminationPct - m.illuminationPct)).toBeLessThan(0.05);
    expect(Math.abs(b.events[0].timeMs - sunset.timeMs)).toBeLessThan(60_000);
    // What the blocking-ridge explanation says during and around the eclipse.
    const total = blockageAt(a, 'sun', Date.parse('2025-03-14T07:00:00Z'));
    expect(total.blocked).toBe(false);
    expect(total.eclipsedFraction).toBe(1);
    expect(total.explanation).toMatch(/covers it completely/);
    const partial = blockageAt(a, 'sun', Date.parse('2025-03-14T05:40:00Z'));
    expect(partial.eclipsedFraction).toBeGreaterThan(0.3);
    expect(partial.eclipsedFraction).toBeLessThan(0.7);
    expect(partial.explanation).toMatch(/covers about \d+ % of it/);
    const after = blockageAt(a, 'sun', sunset.timeMs + 5 * 60_000);
    expect(after.blocked).toBe(true);
    expect(after.discVisibleFraction).toBe(0);
    expect(after.explanation).toMatch(/hidden by/);
    expect(after.ridgeDistanceM).toBeGreaterThan(0);
  });

  it('IM-2 Athena, 14 days from landing: Horizons table, low Sun, Earth near the skyline', async () => {
    const st = await loadTerrainFor(IM2);
    const s = scenAt(IM2, '2025-03-06T17:28:00Z', 14 * 24);
    const t0 = performance.now();
    const a = await analyseStack(s, st);
    const ms = performance.now() - t0;
    const m = a.metrics;
    console.log(`IM-2 14 d: ${ms.toFixed(0)} ms; illumination ${m.illuminationPct.toFixed(2)} %, any Sun ${m.sunAnyPct.toFixed(2)} %, longest darkness ${m.longestDarknessH.toFixed(1)} h${m.darknessOpenEnded ? ' (open)' : ''}, Earth ${m.earthVisiblePct.toFixed(2)} %, longest gap ${m.longestEarthGapH.toFixed(1)} h${m.earthGapOpenEnded ? ' (open)' : ''}; Sun elevation ${m.minSunElDeg.toFixed(2)}..${m.maxSunElDeg.toFixed(2)}; skyline ${Math.min(...a.horizon.elevDeg).toFixed(2)}..${Math.max(...a.horizon.elevDeg).toFixed(2)} deg; events ${a.events.map((e) => `${e.type} ${isoS(e.timeMs)}`).join(', ')}; layers ${a.horizon.layers.map((l) => `${Math.round(l.resolutionM)} m ${(l.fromM / 1000).toFixed(1)}-${(l.toM / 1000).toFixed(1)} km`).join(', ')}`);
    expect(a.series.source).toBe('horizons');
    expect(m.maxSunElDeg).toBeLessThan(6);
    expect(m.illuminationPct).toBeGreaterThan(85);
    expect(m.illuminationPct).toBeLessThan(97);
    expect(m.earthVisiblePct).toBeGreaterThan(80);
    expect(m.earthVisiblePct).toBeLessThan(95);
    expect(a.events.some((e) => e.type === 'earthset')).toBe(true);
    expect(a.events.some((e) => e.type === 'sunset')).toBe(true);
    // South-polar layers are in the skyline, and the whole-Moon grid closes it.
    expect(a.horizon.layers.some((l) => /160 m/.test(l.name) || Math.round(l.resolutionM) === 160)).toBe(true);
    const b = analyseWith(s, st, modelEphemeris(s.site, a.horizon.siteElevationM + 2));
    expect(Math.abs(b.metrics.illuminationPct - m.illuminationPct)).toBeLessThan(0.2);
    expect(Math.abs(b.metrics.earthVisiblePct - m.earthVisiblePct)).toBeLessThan(0.2);
    // At an Earth event the explanation says how much of the disc still shows.
    const es = a.events.find((e) => e.type === 'earthset')!;
    const blk = blockageAt(a, 'earth', es.timeMs);
    expect(Math.abs(blk.clearanceDeg)).toBeLessThan(0.02);
    expect(blk.discVisibleFraction).toBeGreaterThan(0.3);
    expect(blk.discVisibleFraction).toBeLessThan(0.7);
    expect(blk.explanation).toMatch(/of Earth's disc is above the skyline/);
  });
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
    expect(b.discVisibleFraction).toBe(0);
    expect(b.eclipsedFraction).toBe(0);
    expect(b.explanation).toMatch(/hidden by \d+\.\d\d deg/);
    expect(b.explanation).toContain(b.skylineElDeg.toFixed(2));
    // Outside the window the model is used.
    expect(Number.isFinite(blockageAt(a, 'earth', a.scenario.startMs - 10 * H).bodyElDeg)).toBe(true);
  });
  it('names the ground at the observer\'s feet, and gives near terrain in metres', () => {
    // A dome 30 m east of the observer (h = 500 - 0.004 r^2): with no mast the ground itself, rising at 13.5 deg, is the eastern skyline.
    const site = { lat: 0, lon: 0 };
    const dome = stackOf(radialSource('dome', 40, 0, (30 / 1_737_400) * (180 / Math.PI), (r) => 500 - 0.004 * Math.min(r, 150) ** 2));
    // 10 March 2025: lunar morning at 0 E, the Sun in the east.
    const onGround = run(scen(site.lat, site.lon, '2025-03-10T00:00:00Z', 6, 30, 0), dome);
    const b = blockageAt(onGround, 'sun', onGround.scenario.startMs);
    expect(b.bodyAzDeg).toBeGreaterThan(60);
    expect(b.bodyAzDeg).toBeLessThan(120);
    expect(b.ridgeDistanceM).toBe(0);
    expect(b.skylineElDeg).toBeGreaterThan(11);
    expect(b.explanation).toContain('formed by the ground at the observer\'s own feet, at 496 m (dome, 40 m grid)');
    expect(onGround.warnings.join(' ')).toMatch(/With the observer on the ground, the skyline in \d+ of 720 directions is the ground within 28 m of the observer/);
    // Two metres up, the same slope forms the skyline from about 22 m away, lower.
    const raised = run(scen(site.lat, site.lon, '2025-03-10T00:00:00Z', 6, 30, 2), dome);
    const c = blockageAt(raised, 'sun', raised.scenario.startMs);
    expect(c.ridgeDistanceM).toBeGreaterThan(15);
    expect(c.ridgeDistanceM).toBeLessThan(30);
    expect(c.skylineElDeg).toBeLessThan(b.skylineElDeg - 5);
    expect(c.explanation).toMatch(/formed by terrain \d\d m away at 500 m \(dome, 40 m grid\)/);
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
    expect(d.names).toEqual({ a: 'Site A', b: 'Site B' });
    expect(d.highlights.join(' ')).toMatch(/Site B/);
    const same = compareAnalyses(lit, lit);
    expect(same.highlights[0]).toMatch(/practically the same/);
  });
  it('names the two sides by what differs when the labels do not tell them apart', () => {
    const base = scen(-84.79, 29.2, '2025-03-06T17:28:00Z', 336, 10, 2, 'IM-2 Athena');
    base.site.name = 'IM-2 Athena';
    const later = { ...base, startMs: base.startMs + 24 * H };
    expect(comparisonNames(base, later)).toEqual({ a: 'the earlier arrival', b: 'the arrival 24 h later' });
    expect(comparisonNames(later, base)).toEqual({ a: 'the arrival 24 h later', b: 'the earlier arrival' });
    expect(comparisonNames(base, { ...base, mastHeightM: 10 })).toEqual({ a: 'the 2 m mast', b: 'the 10 m mast' });
    expect(comparisonNames(base, { ...base, durationH: 720 })).toEqual({ a: 'the 336 h window', b: 'the 720 h window' });
    expect(comparisonNames(base, { ...later, mastHeightM: 10 })).toEqual({ a: 'the earlier arrival with the 2 m mast', b: 'the arrival 24 h later with the 10 m mast' });
    expect(comparisonNames(base, { ...base })).toEqual({ a: 'scenario A', b: 'scenario B' });
    // Long generated labels (as the app builds them) are not pasted into sentences either.
    const longA = { ...base, label: 'IM-2 Athena, from 2025-03-06 17:28 UTC for 336 h, mast 2 m' };
    const longB = { ...later, label: 'IM-2 Athena, from 2025-03-07 17:28 UTC for 336 h, mast 2 m, +24 h delay' };
    expect(comparisonNames(longA, longB).b).toBe('the arrival 24 h later');
    // Different sites with the same label fall back to the site names, then to coordinates.
    const other = { ...base, site: { ...base.site, id: 'x', name: 'Ridge pin', lat: -84.8, lon: 29.3 } };
    expect(comparisonNames(base, other)).toEqual({ a: 'IM-2 Athena', b: 'Ridge pin' });
    const unnamed = { ...other, site: { ...other.site, name: 'IM-2 Athena' } };
    expect(comparisonNames(base, unnamed).b).toMatch(/^the site at -84\.8000, 29\.3000$/);
  });
  it('+24 h delayed arrival and two mast heights at the same site read naturally', () => {
    const a = run(scen(0, 0, '2025-01-05T00:00:00Z', 7 * 24, 10, 2, 'Equator'));
    const b = run({ ...scen(0, 0, '2025-01-05T00:00:00Z', 7 * 24, 10, 2, 'Equator'), startMs: Date.parse('2025-01-06T00:00:00Z') });
    const d = compareAnalyses(a, b);
    expect(Number.isFinite(d.illuminationPct)).toBe(true);
    expect(d.names).toEqual({ a: 'the earlier arrival', b: 'the arrival 24 h later' });
    for (const h of d.highlights) {
      expect(h).not.toMatch(/Equator.*Equator/);
      expect(h[0]).toBe(h[0].toUpperCase());
    }
    expect(d.highlights.join(' ')).toMatch(/The arrival 24 h later|the arrival 24 h later/);
    const site = { lat: -89.6, lon: 0 };
    const ring = radialSource('ring', 20, site.lat, site.lon, (dd) => 450 * Math.exp(-(((dd - 20_000) / 1000) ** 2)));
    const low = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 30 * 24, 30, 2, 'Rim'), stackOf(ring));
    const high = run(scen(site.lat, site.lon, '2025-01-01T00:00:00Z', 30 * 24, 30, 100, 'Rim'), stackOf(ring));
    const dm = compareAnalyses(low, high);
    expect(dm.names).toEqual({ a: 'the 2 m mast', b: 'the 100 m mast' });
    expect(dm.illuminationPct).toBeGreaterThan(0);
    expect(dm.highlights[0]).toMatch(/^The 100 m mast gets \d+\.\d percentage points more sunlight than the 2 m mast/);
  });
});
