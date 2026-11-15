/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Scenario, SiteRef } from '../core/types';
import { loadTerrainFor } from '../terrain/api';
import { analyseStack, clearAnalysisCache, outlook, outlookStack, SYNODIC_DAYS } from './api';
import { siteEphemeris } from './engine';
import { followOff, fullSpans, longestFull } from './extend';
import { nearbyScore } from './nearby';
import { outlookWith } from './outlook';
import { findBundledTable, setBundleReader } from './sky';
import { withTransitions } from './transitions';
import { analyseWith } from './window';
import { fnSource, radialSource, stackOf } from './testing';

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
beforeEach(() => clearAnalysisCache());

const H = 3_600_000, DAY = 86_400_000;
const isoM = (t: number) => `${new Date(t).toISOString().slice(0, 16)}Z`;
const pin = (lat: number, lon: number, name = 'pin'): SiteRef => ({ id: `pin:${lat},${lon}`, name, kind: 'custom', lat, lon });
const scen = (site: SiteRef, start: string, durationH: number, mastHeightM = 2): Scenario => ({ id: `${site.id}|${start}`, label: site.name, site, mastHeightM, startMs: Date.parse(start), durationH, stepMin: 10 });
// A smooth Moon, described coarsely so that its skyline is quick to compute.
const sphere = () => stackOf(fnSource('smooth sphere', 500, () => 0));

describe('following a spell beyond an edge', () => {
  // "On" during the first quarter of every 100-hour cycle.
  const g = (t: number) => Math.sin((2 * Math.PI * t) / (100 * H)) - Math.SQRT1_2; // on for 12.5 h < t mod 100 h < 37.5 h
  it('finds the real end going forward and the real start going backward, to 10 s', () => {
    const fwd = followOff(g, 50 * H, 1, 30 * DAY, 20 * 60_000);
    expect(fwd.found).toBe(true);
    expect(Math.abs(fwd.timeMs - 112.5 * H)).toBeLessThan(10_000);
    const back = followOff(g, 50 * H, -1, 30 * DAY, 20 * 60_000);
    expect(back.found).toBe(true);
    expect(Math.abs(back.timeMs - 37.5 * H)).toBeLessThan(10_000);
  });
  it('gives up at the limit and says so', () => {
    const never = followOff(() => -1, 0, 1, 60 * DAY, H);
    expect(never).toEqual({ timeMs: 60 * DAY, found: false });
    expect(followOff(() => -1, 0, -1, 60 * DAY, H)).toEqual({ timeMs: -60 * DAY, found: false });
  });
  it('fullSpans extends only the spans that touch an edge', () => {
    const spans = fullSpans(
      [{ startMs: 40 * H, endMs: 60 * H, openStart: true }, { startMs: 137.5 * H, endMs: 212.5 * H }, { startMs: 237.5 * H, endMs: 250 * H, openEnd: true }],
      g, 20 * 60_000,
    );
    expect(spans.map((s) => Math.round(s.hours))).toEqual([Math.round(60 - 37.5), 75, 75]);
    expect(spans.every((s) => s.startFound && s.endFound && s.limitDays === 60)).toBe(true);
    expect(Math.round(longestFull(spans)!.hours)).toBe(75);
    expect(longestFull([])).toBeNull();
  });
});

describe('analyse(): the longest darkness and Earth gap in full', () => {
  it('a window that ends in the night: the night is followed to sunrise', async () => {
    // At 0 N 0 E the Sun rose on 6 January 2025 and sets on the 21st: ten days from the 15th end in the night.
    const s = scen(pin(0, 0), '2025-01-15T00:00:00Z', 10 * 24, 0);
    const a = await analyseStack(s, sphere());
    const m = a.metrics;
    expect(m.darknessOpenEnded).toBe(true);
    expect(m.longestDarknessH).toBeLessThan(120); // what the window shows of it
    const full = m.longestDarknessFull!;
    expect(full.startFound && full.endFound).toBe(true);
    // An equatorial night on a smooth Moon: half a lunar day, less the hour the Sun's disc takes to set and rise.
    expect(full.hours).toBeGreaterThan(350);
    expect(full.hours).toBeLessThan(356);
    expect(full.startMs).toBeGreaterThan(s.startMs);
    expect(full.endMs).toBeGreaterThan(s.startMs + 10 * 24 * H);
    expect(a.warnings.join(' ')).toMatch(/The longest darkness that touches this window lasts 35\d\.\d h in full/);
    // Earth is always up here: no gap at all.
    expect(m.longestEarthGapFull).toBeUndefined();
  });
  it('a window that starts in the night: the night is followed back to sunset', async () => {
    const a = await analyseStack(scen(pin(0, 0), '2025-01-01T00:00:00Z', 8 * 24, 0), sphere());
    const full = a.metrics.longestDarknessFull!;
    expect(full.startFound && full.endFound).toBe(true);
    expect(full.startMs).toBeLessThan(a.scenario.startMs);
    expect(full.hours).toBeGreaterThan(350);
    expect(full.hours).toBeLessThan(356);
  });
  it('a darkness inside the window is reported as it is', async () => {
    const a = await analyseStack(scen(pin(0, 0), '2025-01-07T00:00:00Z', 40 * 24, 0), sphere());
    const m = a.metrics;
    expect(m.darknessOpenEnded).toBe(false);
    expect(m.longestDarknessFull!.hours).toBeCloseTo(m.longestDarknessH, 6);
  });
  it('a permanently shadowed floor and a far-side site: no end within 60 days, stated as a lower bound', async () => {
    const site = pin(-89.8, 0);
    const bowl = radialSource('bowl', 20, site.lat, site.lon, (d) => (d < 8000 ? -2500 + 2500 * (d / 8000) ** 2 : 0));
    const a = await analyseStack(scen(site, '2025-01-01T00:00:00Z', 5 * 24), stackOf(bowl));
    const full = a.metrics.longestDarknessFull!;
    expect(full.startFound).toBe(false);
    expect(full.endFound).toBe(false);
    expect(full.hours).toBeCloseTo((5 + 120) * 24, 6);
    expect(a.warnings.join(' ')).toMatch(/has no start or end within 60 days of the window: it lasts at least 3000\.0 h/);
    const far = await analyseStack(scen(pin(0, 180), '2025-01-01T00:00:00Z', 3 * 24), sphere());
    expect(far.metrics.longestEarthGapFull).toMatchObject({ startFound: false, endFound: false });
    expect(far.metrics.longestEarthGapH).toBeCloseTo(72, 6); // the existing figure and flag are unchanged
    expect(far.metrics.earthGapOpenEnded).toBe(true);
  });
});

describe('outlook on a smooth Moon', () => {
  it('equator: every lunar day is half light, and the arrival date decides everything for a short mission', () => {
    const s = scen(pin(0, 0), '2025-01-01T00:00:00Z', 7 * 24, 0);
    const o = outlookWith(s, sphere());
    expect(o.rows.length).toBe(12);
    expect(o.months).toBe(12);
    expect(o.windowDays).toBe(SYNODIC_DAYS);
    expect(o.endMs - o.startMs).toBeCloseTo(12 * SYNODIC_DAYS * DAY, 0);
    o.rows.forEach((r, k) => {
      expect(r.index).toBe(k + 1);
      expect(r.startMs).toBeCloseTo(s.startMs + k * SYNODIC_DAYS * DAY, 0);
      expect(r.illuminationPct).toBeGreaterThan(49.3);
      expect(r.illuminationPct).toBeLessThan(50.5);
      expect(r.sunAnyPct).toBeGreaterThan(r.illuminationPct);
      expect(r.sunAnyPct).toBeLessThan(50.6);
      expect(r.longestDarknessH).toBeGreaterThan(350);
      expect(r.longestDarknessH).toBeLessThan(356);
      expect(r.darknessComplete).toBe(true);
      expect(r.longestDarknessInWindowH).toBeLessThanOrEqual(r.longestDarknessH + 1e-9);
      expect(r.earthVisiblePct).toBe(100);
      expect(r.longestEarthGapH).toBe(0);
      expect(r.maxSunElDeg).toBeGreaterThan(88);
    });
    // The window starts in the night: the first row's darkness began before the span and is still measured whole.
    expect(o.rows[0].longestDarknessInWindowH).toBeLessThan(o.rows[0].longestDarknessH - 100);
    expect(o.longestDarkness!.startMs).toBeLessThan(s.startMs);
    expect(o.longestEarthGap).toBeNull();
    // A 7-day mission is all light or all dark depending on the date.
    expect(o.best!.illuminationPct).toBeGreaterThan(99.9);
    expect(o.best!.score).toBeCloseTo(nearbyScore(o.best!.illuminationPct, 100, { weightSun: 1, weightEarth: 1 }), 9);
    expect(o.worst!.illuminationPct).toBe(0);
    expect(o.worst!.longestDarknessH).toBeCloseTo(168, 6);
    expect(o.planned!.startMs).toBe(s.startMs);
    expect(o.planned!.slipDays).toBe(0);
    expect(o.slips.map((x) => x.slipDays)).toEqual([1, 3, 7, 14, 28]);
    expect(o.arrivals.n).toBe(Math.floor((12 * SYNODIC_DAYS * 24) / 2) + 1);
    expect(o.arrivals.stepMs).toBe(2 * H);
    expect(o.arrivals.score.length).toBe(o.arrivals.n);
    expect(Math.max(...o.arrivals.score)).toBeCloseTo(o.best!.score, 4);
    expect(Math.min(...o.arrivals.score)).toBeCloseTo(o.worst!.score, 4);
    expect(o.highlights.join(' ')).toMatch(/Earth's centre is above the skyline throughout the span/);
    expect(o.highlights.join(' ')).toMatch(/For a 7-day mission, arriving \d{4}-\d\d-\d\d \d\d:\d\d UTC scores highest/);
    expect(o.assumptions.join(' ')).toMatch(/nothing here is a statement about power or temperature/);
    expect(o.assumptions.join(' ')).toMatch(/sampled every 20 min/);
    expect(o.dem[0].name).toBe('smooth sphere');
  });

  it('far side: Earth 0 % in every lunar day', () => {
    const o = outlookWith(scen(pin(0, 180), '2025-01-01T00:00:00Z', 14 * 24), sphere());
    expect(o.rows.length).toBe(12);
    for (const r of o.rows) {
      expect(r.earthVisiblePct).toBe(0);
      expect(r.earthGapComplete).toBe(false);
      expect(r.longestEarthGapInWindowH).toBeCloseTo(SYNODIC_DAYS * 24, 6);
      expect(r.illuminationPct).toBeGreaterThan(49.3);
      expect(r.illuminationPct).toBeLessThan(50.5);
    }
    expect(o.longestEarthGap).toMatchObject({ startFound: false, endFound: false });
    expect(o.highlights.join(' ')).toMatch(/Earth's centre is never above the skyline in this span/);
    expect(Math.max(...o.arrivals.earthVisiblePct)).toBe(0);
    // With Earth out of the picture the best score is sunlight alone, halved by the equal weights.
    expect(o.best!.score).toBeCloseTo(o.best!.illuminationPct / 2, 6);
  });

  it('near a pole: the lunar seasons swing a lunar day between all light and all dark', () => {
    const o = outlookWith(scen(pin(-89, 0), '2025-01-01T00:00:00Z', 14 * 24), sphere());
    const ill = o.rows.map((r) => r.illuminationPct);
    const hi = ill.indexOf(Math.max(...ill)), lo = ill.indexOf(Math.min(...ill));
    expect(Math.max(...ill)).toBeGreaterThan(99);
    expect(Math.min(...ill)).toBeLessThan(1);
    // Summer and winter are about half a year (six lunar days) apart, and the Sun's height follows them.
    const apart = Math.min(Math.abs(hi - lo), 12 - Math.abs(hi - lo));
    expect(apart).toBeGreaterThanOrEqual(4);
    expect(apart).toBeLessThanOrEqual(7);
    expect(o.rows[hi].maxSunElDeg).toBeGreaterThan(o.rows[lo].maxSunElDeg + 2.5);
    expect(o.rows[lo].maxSunElDeg).toBeLessThan(0);
    // The polar night is one darkness of months, reported whole in every row it touches.
    expect(o.longestDarkness!.hours).toBeGreaterThan(60 * 24);
    expect(o.rows[lo].longestDarknessH).toBeCloseTo(o.longestDarkness!.hours, 6);
    expect(o.rows[lo].longestDarknessInWindowH).toBeCloseTo(SYNODIC_DAYS * 24, 3);
    expect(o.best!.score - o.worst!.score).toBeGreaterThan(60);
    expect(o.highlights[0]).toMatch(/^Sunlight per lunar day ranges from \d+\.\d % \(lunar day \d+, from \d{4}-\d\d-\d\d\) to 100\.0 %/);
  });

  it('other window lengths, months, weights; and requests it refuses', () => {
    const s = scen(pin(0, 30), '2025-03-01T00:00:00Z', 14 * 24, 0);
    const o = outlookWith(s, sphere(), { months: 3, windowDays: 14, stepMin: 30, weightSun: 3, weightEarth: 1 });
    expect(o.rows.length).toBe(Math.floor((3 * SYNODIC_DAYS) / 14));
    expect(o.rows[1].startMs).toBe(s.startMs + 14 * DAY);
    expect(o.stepMin).toBe(30);
    expect(o.arrivals.stepMs).toBe(2 * H);
    expect(o.best!.score).toBeCloseTo(nearbyScore(o.best!.illuminationPct, o.best!.earthVisiblePct, { weightSun: 3, weightEarth: 1 }), 9);
    expect(o.assumptions.join(' ')).toMatch(/consecutive 14\.0-day windows/);
    expect(o.assumptions.join(' ')).toMatch(/a last partial window is left out/);
    expect(o.highlights.join(' ')).toMatch(/14\.0-day window/);
    expect(() => outlookWith(s, sphere(), { months: 0 })).toThrow(RangeError);
    expect(() => outlookWith(s, sphere(), { months: 100 })).toThrow(/at most 60/);
    expect(() => outlookWith(s, sphere(), { stepMin: 0 })).toThrow(RangeError);
    expect(() => outlookWith(s, sphere(), { windowDays: -1 })).toThrow(RangeError);
    expect(() => outlookWith(s, sphere(), { weightSun: 0, weightEarth: 0 })).toThrow(/weights/);
    expect(() => outlookWith({ ...s, durationH: 0 }, sphere())).toThrow(RangeError);
  });

  it('without terrain: no numbers, and the reason', () => {
    const o = outlookWith(scen(pin(0, 0), '2025-01-01T00:00:00Z', 24), stackOf(fnSource('none', 60, () => 0, () => false)));
    expect(o.rows).toEqual([]);
    expect(o.arrivals.n).toBe(0);
    expect(o.planned).toBeNull();
    expect(o.best).toBeNull();
    expect(o.warnings[0]).toMatch(/No elevation data covers this site/);
  });
});

describe('outlook on real terrain agrees with analyse() for the same windows', () => {
  it('IM-2: twelve lunar days from the landing, three of them analysed separately', async () => {
    const site: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 };
    const stack = await loadTerrainFor(site);
    const s = scen(site, '2025-03-06T17:28:00Z', 14 * 24);
    const o = outlookStack(s, stack);
    console.log(`IM-2 outlook, 12 lunar days from ${isoM(o.startMs)}:\n` + o.rows.map((r) => `  ${String(r.index).padStart(2)}  ${isoM(r.startMs)}  sunlight ${r.illuminationPct.toFixed(1).padStart(5)} %  any Sun ${r.sunAnyPct.toFixed(1).padStart(5)} %  longest darkness ${r.longestDarknessH.toFixed(1).padStart(6)} h  Earth ${r.earthVisiblePct.toFixed(1).padStart(5)} %  longest Earth gap ${r.longestEarthGapH.toFixed(1).padStart(6)} h  max Sun elevation ${r.maxSunElDeg.toFixed(2)} deg`).join('\n') + '\n  ' + o.highlights.join('\n  '));
    expect(o.rows.length).toBe(12);
    // The outlook reads the main profile only (every 0.5 deg); analyse() also reads the skyline every
    // 0.05 deg where a disc meets it (T-50), which moves IM-2's instants by minutes. Compared here on
    // the same skyline: analyse() with the main profile only.
    const sameSkyline = async (sc: Scenario) => {
      const eph = siteEphemeris(sc, stack, await findBundledTable(sc.site, sc.startMs, sc.startMs + sc.durationH * H));
      return withTransitions(analyseWith(sc, stack, eph, {}, { fineSkyline: false }), eph);
    };
    for (const k of [0, 5, 11]) {
      const r = o.rows[k];
      const a = await sameSkyline({ ...s, startMs: r.startMs, durationH: (r.endMs - r.startMs) / H });
      expect(Math.abs(r.illuminationPct - a.metrics.illuminationPct), `row ${r.index} sunlight`).toBeLessThan(0.05);
      expect(Math.abs(r.sunAnyPct - a.metrics.sunAnyPct), `row ${r.index} any Sun`).toBeLessThan(0.05);
      expect(Math.abs(r.earthVisiblePct - a.metrics.earthVisiblePct), `row ${r.index} Earth`).toBeLessThan(0.05);
      expect(Math.abs(r.longestDarknessInWindowH - a.metrics.longestDarknessH), `row ${r.index} darkness in the window`).toBeLessThan(0.1);
      expect(Math.abs(r.longestDarknessH - a.metrics.longestDarknessFull!.hours), `row ${r.index} darkness in full`).toBeLessThan(0.1);
      expect(Math.abs(r.longestEarthGapInWindowH - a.metrics.longestEarthGapH), `row ${r.index} Earth gap`).toBeLessThan(0.1);
      expect(Math.abs(r.maxSunElDeg - a.metrics.maxSunElDeg), `row ${r.index} Sun elevation`).toBeLessThan(0.01);
    }
    // The planned arrival is the scenario itself (analysed here with the bundled Horizons table at 10 min).
    const planned = await sameSkyline(s);
    expect(planned.series.source).toBe('horizons');
    expect(Math.abs(o.planned!.illuminationPct - planned.metrics.illuminationPct)).toBeLessThan(0.1);
    expect(Math.abs(o.planned!.earthVisiblePct - planned.metrics.earthVisiblePct)).toBeLessThan(0.1);
    expect(Math.abs(o.planned!.longestDarknessH - planned.metrics.longestDarknessH)).toBeLessThan(0.1);
    // Lunar seasons at 84.8 S: the Sun's highest point moves by about 3 deg through the year, and the sunlight with it.
    const maxEl = o.rows.map((r) => r.maxSunElDeg), ill = o.rows.map((r) => r.illuminationPct);
    expect(Math.max(...maxEl) - Math.min(...maxEl)).toBeGreaterThan(2.5);
    expect(Math.max(...maxEl) - Math.min(...maxEl)).toBeLessThan(3.6);
    expect(Math.max(...ill) - Math.min(...ill)).toBeGreaterThan(8);
    // The brightest lunar day is the one with the highest Sun, or a close neighbour.
    expect(Math.abs(ill.indexOf(Math.max(...ill)) - maxEl.indexOf(Math.max(...maxEl)))).toBeLessThanOrEqual(2);
    expect(o.best!.score).toBeGreaterThan(o.planned!.score);
    expect(o.worst!.score).toBeLessThan(o.planned!.score);
    expect(o.dem.length).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('a pin on Shackleton\'s rim: months of unbroken light in summer, long darkness in winter', async () => {
    const site = pin(-89.45, -137.2, 'Shackleton rim pin');
    const o = outlookStack(scen(site, '2025-03-06T17:28:00Z', 14 * 24), await loadTerrainFor(site, { remote: false }));
    console.log(`Shackleton rim pin outlook:\n` + o.rows.map((r) => `  ${String(r.index).padStart(2)}  ${isoM(r.startMs)}  sunlight ${r.illuminationPct.toFixed(1).padStart(5)} %  longest darkness ${r.longestDarknessH.toFixed(1).padStart(6)} h  Earth ${r.earthVisiblePct.toFixed(1).padStart(5)} %  max Sun elevation ${r.maxSunElDeg.toFixed(2)} deg`).join('\n') + '\n  ' + o.highlights.join('\n  '));
    const ill = o.rows.map((r) => r.illuminationPct);
    expect(Math.max(...ill)).toBeGreaterThan(99.9);
    expect(Math.min(...ill)).toBeLessThan(60);
    expect(o.rows.filter((r) => r.longestDarknessH === 0).length).toBeGreaterThanOrEqual(3);
    for (const r of o.rows) {
      expect(r.earthVisiblePct).toBeGreaterThan(35);
      expect(r.earthVisiblePct).toBeLessThan(65);
    }
  }, 120_000);
});

describe('outlook() entry point', () => {
  it('loads terrain itself, remembers the result, keeps the caller\'s scenario', async () => {
    const site: SiteRef = { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', kind: 'landing', lat: 18.562, lon: 61.81 };
    const s = scen(site, '2025-03-02T08:34:00Z', 14 * 24);
    const o = await outlook(s, { months: 2 });
    expect(o.scenario).toBe(s);
    expect(o.rows.length).toBe(2);
    expect(o.rows[0].earthVisiblePct).toBe(100);
    expect(o.rows[0].illuminationPct).toBeGreaterThan(45);
    expect(o.rows[0].illuminationPct).toBeLessThan(55);
    const again = await outlook({ ...s, label: 'relabelled' }, { months: 2 });
    expect(again.rows).toBe(o.rows);
    expect(again.scenario.label).toBe('relabelled');
    const other = await outlook(s, { months: 1 });
    expect(other.rows.length).toBe(1);
    await expect(outlook({ ...s, durationH: -1 })).rejects.toThrow(RangeError);
    await expect(outlook(s, { months: 0 })).rejects.toThrow(/months/);
  }, 120_000);
});
