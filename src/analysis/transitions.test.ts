/// <reference types="node" />
// Both ends of every rise and set (T-31 item 2, D-8) and Earth by disc (item 3).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { loadTerrainFor } from '../terrain/api';
import { analyseStack, nextEvents, nextTransitions } from './api';
import { outlookWith } from './outlook';
import { setBundleReader, type Ephemeris } from './sky';
import { fnSource, stackOf } from './testing';
import { buildTransitions, eventText, transitionSummary, transitionText } from './transitions';
import type { HorizonProfile, SiteAnalysis, SkyTransition } from './types';
import { compareAnalyses, evaluateWindow } from './window';

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
const H = 3_600_000;
const T0 = Date.UTC(2026, 0, 10, 0, 0, 0);
const iso = (t: number) => `${new Date(t).toISOString().slice(0, 19)}Z`;

/** A skyline given as a function of azimuth (0.5 deg samples), for exact cases. */
function profile(elev: (az: number) => number): HorizonProfile {
  const n = 720;
  const elevDeg = new Float32Array(n), distM = new Float32Array(n).fill(1000), heightM = new Float32Array(n);
  for (let i = 0; i < n; i++) elevDeg[i] = elev(i * 0.5);
  return {
    site: { lat: 0, lon: 0 }, siteElevationM: 0, mastHeightM: 2, azStepDeg: 0.5, elevDeg, distM, heightM, smoothDipDeg: 0, maxRangeM: 1000,
    layers: [{ name: 'synthetic', resolutionM: 1, fromM: 0, toM: 1000 }], skylineLayer: new Uint8Array(n), warnings: [],
  };
}

interface Motion { sunAz: number; sunEl: number; earthAz?: number; earthEl?: number }
/** Sun and Earth moving as told, valid at any time (so it also serves to follow passages past the window). Radii 0.25 and 0.95 deg. */
function stub(f: (h: number) => Motion): Ephemeris {
  return {
    source: 'model', note: 'test motion',
    at(t, out) {
      const m = f((t - T0) / H);
      out[0] = m.sunAz; out[1] = m.sunEl; out[2] = m.earthAz ?? 180; out[3] = m.earthEl ?? 45; out[4] = 0.25; out[5] = 0.95;
    },
    instant: () => { throw new Error('not used'); },
  };
}

const scen = (startMs: number, durationH: number, stepMin = 10): Scenario => ({
  id: 't', label: 't', site: { id: 'pin', name: 'test', kind: 'custom', lat: 0, lon: 0 }, mastHeightM: 2, startMs, durationH, stepMin,
});

function run(p: HorizonProfile, eph: Ephemeris, s: Scenario, follow = true) {
  const w = evaluateWindow(s, p, eph);
  const transitions = buildTransitions(s, p, eph, w, { outside: follow ? eph : null });
  return { ...w, transitions };
}

// The strips nearest the disc's centre have half-chords of r * sqrt(1 - (1/24)^2): the lowest and highest point the disc is tested at.
const C_SUN = 0.25 * Math.sqrt(1 - 1 / 576);
const C_EARTH = 0.95 * Math.sqrt(1 - 1 / 576);
const flat = profile(() => 0);

describe('passages on a flat skyline (exact times)', () => {
  // The Sun's elevation 3 cos(2 pi h / 48): it sets through 0 deg near 12 h and rises again near 36 h.
  const A = 3, P = 48;
  const eph = stub((h) => ({ sunAz: 270, sunEl: A * Math.cos((2 * Math.PI * h) / P) }));
  const at = (el: number, rising: boolean) => T0 + (rising ? P - (P / (2 * Math.PI)) * Math.acos(el / A) : (P / (2 * Math.PI)) * Math.acos(el / A)) * H;
  const r = run(flat, eph, scen(T0, 48));

  it('one set and one rise, each with both ends, the centre in between and the existing events as their ends', () => {
    const sun = r.transitions.filter((t) => t.body === 'sun');
    expect(sun.map((t) => t.kind)).toEqual(['set', 'rise']);
    const [set, rise] = sun;
    expect(set.start.edge).toBe('first-cut');
    expect(set.end.edge).toBe('last-limb');
    expect(Math.abs(set.start.timeMs - at(C_SUN, false))).toBeLessThan(10_000);
    expect(Math.abs(set.end.timeMs - at(-C_SUN, false))).toBeLessThan(10_000);
    expect(set.centre).toHaveLength(1);
    expect(Math.abs(set.centre[0].timeMs - (T0 + 12 * H))).toBeLessThan(10_000);
    expect(set.centre[0].up).toBe(false);
    expect(rise.start.edge).toBe('first-limb');
    expect(rise.end.edge).toBe('whole-clear');
    expect(Math.abs(rise.start.timeMs - at(-C_SUN, true))).toBeLessThan(10_000);
    expect(Math.abs(rise.end.timeMs - at(C_SUN, true))).toBeLessThan(10_000);
    // 2 x 0.2498 deg at 0.39 deg per hour: 1.27 h each way.
    expect(Math.abs(set.hours - (at(-C_SUN, false) - at(C_SUN, false)) / H)).toBeLessThan(10 / 3600);
    expect(Math.abs(rise.hours - set.hours)).toBeLessThan(10 / 3600);
    expect(set.minVisibleFraction).toBeGreaterThan(0);
    expect(set.maxVisibleFraction).toBeLessThan(1);
    // The existing events are unchanged and are the passages' ends.
    const sunset = r.events.find((e) => e.type === 'sunset')!, sunrise = r.events.find((e) => e.type === 'sunrise')!;
    expect(sunset.span).toBe(set);
    expect(set.end.timeMs).toBe(sunset.timeMs);
    expect(set.end.azDeg).toBe(sunset.azDeg);
    expect(sunrise.span).toBe(rise);
    expect(rise.start.timeMs).toBe(sunrise.timeMs);
    for (const t of sun) expect(t.start.inWindow && t.end.inWindow).toBe(true);
  });

  it('Earth high in the sky: no passage, all of it and its centre always in view', () => {
    expect(r.transitions.filter((t) => t.body === 'earth')).toHaveLength(0);
    expect(r.metrics.earthAnyPct).toBe(100);
    expect(r.metrics.earthVisiblePct).toBe(100);
    expect(r.metrics.longestEarthAnyGapH).toBe(0);
  });

  it('a window that starts while the Sun is setting: the first cut is found before it, or left unresolved without following', () => {
    const mid = Math.round((at(C_SUN, false) + at(-C_SUN, false)) / 2);
    const followed = run(flat, eph, scen(mid, 6));
    const set = followed.transitions.find((t) => t.body === 'sun')!;
    expect(set.kind).toBe('set');
    expect(set.start.inWindow).toBe(false);
    expect(Math.abs(set.start.timeMs - at(C_SUN, false))).toBeLessThan(10_000);
    expect(set.end.inWindow).toBe(true);
    expect(transitionSummary(set)).toMatch(/^starts setting \d{4}-\d\d-\d\d \d\d:\d\d \(before the analysed window\), fully set \d\d:\d\d UTC$/);
    const cut = run(flat, eph, scen(mid, 6), false).transitions.find((t) => t.body === 'sun')!;
    expect(cut.kind).toBe('unresolved');
    expect(cut.start.edge).toBe('unresolved');
    expect(cut.start.timeMs).toBe(mid);
    expect(transitionSummary(cut)).toMatch(/^already under way when the analysed window starts, fully set \d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  });

  it('a disc that stays cut by the skyline beyond the search limit: both ends unresolved, no time quoted for them', () => {
    const parked = stub((h) => ({ sunAz: 90 + 0.5 * h, sunEl: 0 }));
    const s = scen(T0, 12);
    const w = evaluateWindow(s, flat, parked);
    const [tr] = buildTransitions(s, flat, parked, w, { outside: parked, limitDays: 1 });
    expect(tr.kind).toBe('unresolved');
    expect([tr.start.edge, tr.end.edge]).toEqual(['unresolved', 'unresolved']);
    expect([tr.start.inWindow, tr.end.inWindow]).toEqual([false, false]);
    expect(tr.hours).toBeCloseTo(12 + 2 * 24, 6);
    expect(transitionSummary(tr)).toBe('began more than 1 day before the analysed window, not over within 1 day after the analysed window');
    expect(transitionText(tr)).toMatch(/one end of this passage lies beyond the searched span/);
  });

  it('a window that ends while the Sun is rising: the whole-disc-clear instant is found after it', () => {
    const end = Math.round((at(-C_SUN, true) + at(C_SUN, true)) / 2);
    const w = run(flat, eph, scen(T0 + 30 * H, (end - T0 - 30 * H) / H));
    const rise = w.transitions.find((t) => t.body === 'sun')!;
    expect(rise.kind).toBe('rise');
    expect(rise.end.inWindow).toBe(false);
    expect(Math.abs(rise.end.timeMs - at(C_SUN, true))).toBeLessThan(10_000);
    // nextEvents is unchanged (the sunrise is in the window); nextTransitions also reaches past the window's end.
    expect(transitionSummary(rise)).toMatch(/fully risen \d\d:\d\d \(after the analysed window\) UTC$/);
  });

  it('nextTransitions: in progress, next, or none', () => {
    const a = { ...r, scenario: scen(T0, 48) } as unknown as SiteAnalysis;
    const [set, rise] = r.transitions;
    expect(nextTransitions(a, T0).sun).toBe(set);
    expect(nextTransitions(a, set.start.timeMs + 60_000).sun).toBe(set);
    expect(nextTransitions(a, set.end.timeMs).sun).toBe(rise);
    expect(nextTransitions(a, rise.end.timeMs + 1).sun).toBeNull();
    expect(nextTransitions(a, T0).earth).toBeNull();
    // nextEvents keeps its meaning and now hands out the span with the event.
    expect(nextEvents(a, T0).sunset?.span).toBe(set);
  });
});

describe('a ridge in the west (exact times)', () => {
  it('the Sun sets behind a ridge 1.5 deg high: both ends earlier than over the flat horizon, as the ridge height says', () => {
    const A = 3, P = 48;
    const eph = stub((h) => ({ sunAz: 270, sunEl: A * Math.cos((2 * Math.PI * h) / P) }));
    const ridge = profile((az) => (az >= 250 && az <= 290 ? 1.5 : 0));
    const at = (el: number) => T0 + (P / (2 * Math.PI)) * Math.acos(el / A) * H;
    const r = run(ridge, eph, scen(T0, 24));
    const set = r.transitions.find((t) => t.body === 'sun')!;
    expect(set.kind).toBe('set');
    expect(Math.abs(set.start.timeMs - at(1.5 + C_SUN))).toBeLessThan(10_000);
    expect(Math.abs(set.end.timeMs - at(1.5 - C_SUN))).toBeLessThan(10_000);
    expect(Math.abs(set.centre[0].timeMs - at(1.5))).toBeLessThan(10_000);
    const overFlat = run(flat, eph, scen(T0, 24)).transitions.find((t) => t.body === 'sun')!;
    expect(overFlat.start.timeMs - set.start.timeMs).toBeGreaterThan(3 * H);
    expect(r.events.find((e) => e.type === 'sunset')!.span).toBe(set);
  });
});

describe('grazes and peeks: the disc cut but never fully set, or seen but never fully risen', () => {
  // The Sun moves along the skyline at 0.5 deg of azimuth per hour, at a fixed elevation.
  const along = (el: number) => stub((h) => ({ sunAz: 90 + 0.5 * h, sunEl: el }));
  it('a flat-topped rise level with the Sun\'s centre hides the lower half of the disc and lets it go: a graze, no event', () => {
    const bump = profile((az) => (az >= 100 && az <= 110 ? 1 : 0));
    const r = run(bump, along(1), scen(T0, 48));
    expect(r.events.filter((e) => e.type.startsWith('sun'))).toHaveLength(0);
    const sun = r.transitions.filter((t) => t.body === 'sun');
    expect(sun).toHaveLength(1);
    const g = sun[0];
    expect(g.kind).toBe('graze');
    expect([g.start.edge, g.end.edge]).toEqual(['first-cut', 'whole-clear']);
    expect(g.minVisibleFraction).toBeGreaterThan(0.45);
    expect(g.minVisibleFraction).toBeLessThan(0.55);
    // It starts as the disc's leading edge (0.25 deg ahead of its centre) reaches the slope up to the bump (99.5-100 deg of azimuth).
    expect(g.start.azDeg).toBeGreaterThan(99.0);
    expect(g.start.azDeg).toBeLessThan(99.8);
    expect(g.end.azDeg).toBeGreaterThan(110.2);
    expect(g.end.azDeg).toBeLessThan(111);
    expect(transitionSummary(g)).toMatch(/^partly hidden from \d{4}-\d\d-\d\d \d\d:\d\d, whole disc clear again (\d{4}-\d\d-\d\d )?\d\d:\d\d UTC; never fully set$/);
    expect(transitionText(g)).toMatch(/at most (4[5-9]|5[0-5]) % of the disc is hidden/);
    expect(r.metrics.sunAnyPct).toBe(100);
  });

  it('a notch in a skyline that hides the Sun lets part of it show: a peek, whose sunrise and sunset are the same passage', () => {
    const notch = profile((az) => (az >= 100 && az <= 110 ? -0.5 : 0));
    const r = run(notch, along(-0.4), scen(T0, 48));
    const sun = r.transitions.filter((t) => t.body === 'sun');
    expect(sun.map((t) => t.kind)).toEqual(['peek']);
    const pk = sun[0];
    const rise = r.events.find((e) => e.type === 'sunrise')!, set = r.events.find((e) => e.type === 'sunset')!;
    expect(rise.span).toBe(pk);
    expect(set.span).toBe(pk);
    expect(pk.start.timeMs).toBe(rise.timeMs);
    expect(pk.end.timeMs).toBe(set.timeMs);
    // In the notch the centre is 0.1 deg (0.4 radii) above its floor: the part of the disc below the floor is about 25 % of its area.
    expect(pk.maxVisibleFraction).toBeGreaterThan(0.7);
    expect(pk.maxVisibleFraction).toBeLessThan(0.8);
    expect(eventText(set)).toMatch(/^Sunset: partly visible from .*, last part gone again .* UTC; never fully risen$/);
  });
});

describe('Earth: both ends around the centre, and any part of its disc', () => {
  // Earth sinks through a flat skyline at 0.1 deg per hour from 2 deg: first cut, centre (the existing Earthset), last limb.
  const eph = stub((h) => ({ sunAz: 90, sunEl: 30, earthAz: 200, earthEl: 2 - 0.1 * h }));
  const r = run(flat, eph, scen(T0, 48));
  it('the Earthset is a centre crossing inside a set that lasts about 19 hours', () => {
    const tr = r.transitions.filter((t) => t.body === 'earth');
    expect(tr).toHaveLength(1);
    const set = tr[0];
    expect(set.kind).toBe('set');
    expect(Math.abs(set.start.timeMs - (T0 + ((2 - C_EARTH) / 0.1) * H))).toBeLessThan(10_000);
    expect(Math.abs(set.end.timeMs - (T0 + ((2 + C_EARTH) / 0.1) * H))).toBeLessThan(10_000);
    const es = r.events.find((e) => e.type === 'earthset')!;
    expect(Math.abs(es.timeMs - (T0 + 20 * H))).toBeLessThan(10_000);
    expect(es.span).toBe(set);
    expect(set.centre.map((c) => [c.timeMs, c.up])).toEqual([[es.timeMs, false]]);
    // 10:30, 20:00 (refined to 10 s, so 19:59 when written to the minute) and 05:29 the next day: a date only where the day changes.
    expect(eventText(es)).toMatch(/^Earthset: starts setting 2026-01-10 10:30, centre sets (19:59|20:00), fully set 2026-01-11 05:29 UTC$/);
  });
  it('the any-part figure is the time to the last limb; the centre figure the time to the centre', () => {
    const m = r.metrics;
    expect(m.earthVisiblePct).toBeCloseTo((100 * 20) / 48, 2);
    expect(m.earthAnyPct!).toBeCloseTo((100 * (2 + C_EARTH)) / 0.1 / 48, 2);
    expect(m.longestEarthAnyGapH!).toBeCloseTo(48 - (2 + C_EARTH) / 0.1, 2);
    expect(m.earthAnyGapOpenEnded).toBe(true);
    // The last limb is the end of the any-part span: the same instant, not a second computation of it.
    expect(m.earthAnyIntervals![0].endMs).toBe(r.transitions.find((t) => t.body === 'earth')!.end.timeMs);
  });
  it('outlook rows carry the any-part figure beside the centre one (smooth Moon, east limb: Earth librates across the horizon)', () => {
    const o = outlookWith({ ...scen(Date.UTC(2025, 2, 1), 24), site: { id: 'limb', name: 'limb', kind: 'custom', lat: 0, lon: 89 } }, stackOf(fnSource('sphere', 60, () => 0)), { months: 2 });
    expect(o.rows.length).toBe(2);
    for (const row of o.rows) {
      expect(row.earthAnyPct!).toBeGreaterThan(row.earthVisiblePct);
      expect(row.earthAnyPct!).toBeLessThanOrEqual(100);
    }
  });
});

describe('comparison sentences name Earth\'s centre; the any-part difference is in the diff', () => {
  it('B (Earth sinking) against A (Earth high)', () => {
    const asAnalysis = (r: ReturnType<typeof run>, label: string) =>
      ({ ...r, scenario: { ...scen(T0, 48), label, id: label }, slope: { slopeDeg: 1, aspectDeg: 0, baselineM: 120, demName: 'synthetic' } }) as unknown as SiteAnalysis;
    const high = asAnalysis(run(flat, stub(() => ({ sunAz: 90, sunEl: 30 })), scen(T0, 48)), 'Site A');
    const sinking = asAnalysis(run(flat, stub((h) => ({ sunAz: 90, sunEl: 30, earthAz: 200, earthEl: 2 - 0.1 * h })), scen(T0, 48)), 'Site B');
    const d = compareAnalyses(high, sinking);
    expect(d.earthAnyPct!).toBeCloseTo(sinking.metrics.earthAnyPct! - 100, 9);
    const text = d.highlights.join(' ');
    expect(text).toMatch(/Site B has line of sight to Earth's centre \d+\.\d percentage points less of the time than Site A/);
    expect(text).toMatch(/the longest gap without Earth's centre in view is \d+\.\d h longer/);
  });
});

// ---------- real terrain and the bundled Horizons windows, against the independent validation ----------

/** Invariants every analysis must satisfy. */
function checkInvariants(a: SiteAnalysis) {
  const tr = a.transitions!;
  for (const e of a.events) {
    expect(e.span, `${e.type} ${iso(e.timeMs)} has a span`).toBeDefined();
    if (e.type === 'sunset') expect([e.span!.end.timeMs, e.span!.end.edge]).toEqual([e.timeMs, 'last-limb']);
    if (e.type === 'sunrise') expect([e.span!.start.timeMs, e.span!.start.edge]).toEqual([e.timeMs, 'first-limb']);
    if (e.type === 'earthset' || e.type === 'earthrise') expect(e.span!.centre.some((c) => c.timeMs === e.timeMs && c.up === (e.type === 'earthrise'))).toBe(true);
    expect(tr).toContain(e.span);
  }
  for (const body of ['sun', 'earth'] as const) {
    const list = tr.filter((t) => t.body === body);
    for (let i = 0; i < list.length; i++) {
      expect(list[i].end.timeMs).toBeGreaterThanOrEqual(list[i].start.timeMs);
      if (i > 0) expect(list[i].start.timeMs).toBeGreaterThanOrEqual(list[i - 1].end.timeMs);
    }
  }
  const m = a.metrics;
  expect(m.earthAnyPct!).toBeGreaterThanOrEqual(m.earthVisiblePct - 1e-9);
  expect(m.longestEarthAnyGapH!).toBeLessThanOrEqual(m.longestEarthGapH + 1e-9);
}

const landing = (id: string, name: string, lat: number, lon: number) => ({ id, name, kind: 'landing' as const, lat, lon });
const BLUE_GHOST = landing('blue-ghost-1', 'Blue Ghost Mission 1', 18.562, 61.81);
const IM2 = landing('im-2', 'IM-2 Athena', -84.79, 29.2);
const CH3 = landing('chandrayaan-3', 'Chandrayaan-3', -69.3741, 32.32);
const scenAt = (site: typeof BLUE_GHOST, start: string, durationH: number, mastHeightM = 2): Scenario => ({ id: `${site.id}|${start}|${mastHeightM}`, label: site.name, site, mastHeightM, startMs: Date.parse(start), durationH, stepMin: 10 });
const minutesOff = (t: number, ref: string) => (t - Date.parse(ref)) / 60_000;
const f1 = (v: number) => v.toFixed(1);
const describeSet = (t: SkyTransition) => `${t.kind} ${iso(t.start.timeMs)} (${t.start.edge}) .. ${iso(t.end.timeMs)} (${t.end.edge}), ${t.hours.toFixed(2)} h, centre ${t.centre.map((c) => `${c.up ? 'up' : 'down'} ${iso(c.timeMs)}`).join(', ') || 'none'}`;

describe('real terrain: the validator\'s instants (tests/fixtures/validation/ephemeris-check/events)', () => {
  it('Blue Ghost Mission 1, sunset of 16 March 2025 (bundled Horizons), eye heights 0.5, 2 and 5 m', async () => {
    const st = await loadTerrainFor(BLUE_GHOST);
    // Independent: skyline cuts the Sun, half hidden, last limb (results.json, blueGhostSunset).
    const ref = [
      { mast: 0.5, cut: '2025-03-16T18:09:45Z', half: '2025-03-16T18:42:57Z', last: '2025-03-16T19:16:07Z' },
      { mast: 2, cut: '2025-03-16T18:23:40Z', half: '2025-03-16T18:56:53Z', last: '2025-03-16T19:30:03Z' },
      { mast: 5, cut: '2025-03-16T18:51:31Z', half: '2025-03-16T19:24:45Z', last: '2025-03-16T19:57:57Z' },
    ];
    for (const r of ref) {
      const a = await analyseStack(scenAt(BLUE_GHOST, '2025-03-02T08:34:00Z', 15 * 24, r.mast), st);
      expect(a.series.source).toBe('horizons');
      checkInvariants(a);
      const sunset = a.events.find((e) => e.type === 'sunset')!;
      const set = sunset.span!;
      const half = set.centre.find((c) => !c.up);
      console.log(`Blue Ghost ${r.mast} m: ${describeSet(set)}; minus independent: first cut ${f1(minutesOff(set.start.timeMs, r.cut))} min, centre ${half ? f1(minutesOff(half.timeMs, r.half)) : '-'} min (independent: half of the disc hidden), last limb ${f1(minutesOff(set.end.timeMs, r.last))} min. ${eventText(sunset)}`);
      expect(set.kind).toBe('set');
      expect(set.start.inWindow).toBe(true);
      // Tolerances leave room for elevation-data changes still pending (T-32 moves this sunset); the differences are reported, not tuned.
      expect(Math.abs(minutesOff(set.start.timeMs, r.cut))).toBeLessThan(20);
      expect(Math.abs(minutesOff(set.end.timeMs, r.last))).toBeLessThan(20);
      expect(set.hours).toBeGreaterThan(0.8);
      expect(set.hours).toBeLessThan(1.4);
      expect(a.metrics.earthAnyPct).toBe(100);
    }
  });

  it('Chandrayaan-3, September 2023 (model ephemeris): sunset first cut, and the whole disc clear after the next sunrise', async () => {
    const st = await loadTerrainFor(CH3);
    const a = await analyseStack(scenAt(CH3, '2023-08-23T12:33:00Z', 791), st);
    expect(a.series.source).toBe('model');
    checkInvariants(a);
    const set = a.events.find((e) => e.type === 'sunset')!.span!;
    const rise = a.events.find((e) => e.type === 'sunrise')!.span!;
    console.log(`Chandrayaan-3: ${describeSet(set)}; ${describeSet(rise)}; minus independent: first cut ${f1(minutesOff(set.start.timeMs, '2023-09-04T04:53:35Z'))} min, last limb ${f1(minutesOff(set.end.timeMs, '2023-09-04T08:02:23Z'))} min, first limb ${f1(minutesOff(rise.start.timeMs, '2023-09-19T23:57:08Z'))} min, whole disc clear ${f1(minutesOff(rise.end.timeMs, '2023-09-20T02:42:19Z'))} min. ${transitionText(set)} ${transitionText(rise)}`);
    expect([set.kind, rise.kind]).toEqual(['set', 'rise']);
    expect(Math.abs(minutesOff(set.start.timeMs, '2023-09-04T04:53:35Z'))).toBeLessThan(10);
    expect(Math.abs(minutesOff(rise.end.timeMs, '2023-09-20T02:42:19Z'))).toBeLessThan(10);
  });

  it('IM-2, 14 days from landing (bundled Horizons): the Sun sets over hours; Earth\'s set around its Earthset; any part of Earth above the centre figure', async () => {
    const st = await loadTerrainFor(IM2);
    const a = await analyseStack(scenAt(IM2, '2025-03-06T17:28:00Z', 14 * 24), st);
    expect(a.series.source).toBe('horizons');
    checkInvariants(a);
    const m = a.metrics;
    const sunset = a.events.find((e) => e.type === 'sunset')!, earthset = a.events.find((e) => e.type === 'earthset')!;
    console.log(`IM-2: Earth's centre ${m.earthVisiblePct.toFixed(2)} %, any part ${m.earthAnyPct!.toFixed(2)} %; longest gap centre ${m.longestEarthGapH.toFixed(1)} h, whole disc hidden ${m.longestEarthAnyGapH!.toFixed(1)} h${m.earthAnyGapOpenEnded ? ' (open)' : ''}; Sun ${describeSet(sunset.span!)}; Earth ${describeSet(earthset.span!)}. ${eventText(sunset)} ${eventText(earthset)}. Passages: ${a.transitions!.map((t) => `${t.body} ${t.kind}`).join(', ')}`);
    expect(sunset.span!.kind).toBe('set');
    expect(sunset.span!.hours).toBeGreaterThan(2);
    // Independent Earthset (Earth's centre) 2025-03-19 04:07:45; the app's is 04:09:38 (validation record).
    expect(Math.abs(minutesOff(earthset.timeMs, '2025-03-19T04:07:45Z'))).toBeLessThan(5);
    expect(earthset.span!.start.timeMs).toBeLessThan(earthset.timeMs);
    expect(earthset.span!.end.timeMs).toBeGreaterThan(earthset.timeMs);
    expect(m.earthAnyPct!).toBeGreaterThan(m.earthVisiblePct);
  });
});

// ---------- 18.6 years: any part of Earth's disc against the validator and PGDA product 69 (opt-in) ----------

/** The validator's 18.6-year results (T-26 check 3): its own Earth centre / any-part shares on the same elevation data, and PGDA's pixels. */
interface IlluminationRef {
  window: { start: string; durationH: number; stepMin: number };
  sites: Record<string, { site: { name: string; kind: 'landing' | 'custom'; lat: number; lon: number }; pgda: { earth: { pixel: number; min3x3: number; max3x3: number } }; masts: Record<string, { own: { earthCentrePct: number; earthAnyPct: number } }> }>;
}

describe.skipIf(!process.env.LUNYX_LONG)('18.6 years: any part of Earth against the validator and PGDA product 69 (opt-in: LUNYX_LONG=1, several minutes)', () => {
  it('five south-polar points, observer on the ground and 2 m up', async () => {
    const ref = JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures/validation/ephemeris-check/illumination/results.json'), 'utf8')) as IlluminationRef;
    const lines: string[] = [];
    for (const [key, v] of Object.entries(ref.sites)) {
      if (v.pgda.earth.pixel === 0) continue; // Shackleton's floor: no Earth for anyone
      // The site objects of the validator's own runs (illumination/scenarios.json).
      const site = { id: v.site.kind === 'landing' ? key : `pin:${v.site.lat.toFixed(5)},${v.site.lon.toFixed(5)}`, name: v.site.name, kind: v.site.kind, lat: v.site.lat, lon: v.site.lon };
      const stack = await loadTerrainFor(site);
      for (const mast of [0, 2]) {
        const own = v.masts[String(mast)]?.own;
        if (!own) continue;
        const s: Scenario = { id: `${key}-${mast}`, label: key, site, mastHeightM: mast, startMs: Date.parse(ref.window.start), durationH: ref.window.durationH, stepMin: ref.window.stepMin };
        const t0 = Date.now();
        const a = await analyseStack(s, stack);
        const m = a.metrics;
        lines.push(`${key.padEnd(17)} ${String(mast).padStart(1)} m | centre: app ${m.earthVisiblePct.toFixed(2)} own ${own.earthCentrePct.toFixed(2)} | any part: app ${m.earthAnyPct!.toFixed(2)} own ${own.earthAnyPct.toFixed(2)} (app - own ${(m.earthAnyPct! - own.earthAnyPct).toFixed(2)}) | PGDA ${v.pgda.earth.pixel.toFixed(2)} (3x3 ${v.pgda.earth.min3x3.toFixed(2)}..${v.pgda.earth.max3x3.toFixed(2)}) | any - centre: app ${(m.earthAnyPct! - m.earthVisiblePct).toFixed(2)} | ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        // Same elevation data and definition as the validator's own figure: within half a point (the validator's tolerance for the Sun).
        expect(Math.abs(m.earthAnyPct! - own.earthAnyPct)).toBeLessThan(0.5);
        expect(m.earthAnyPct!).toBeGreaterThanOrEqual(m.earthVisiblePct);
      }
    }
    console.log(`Earth over 18.6 years from ${ref.window.start}, hourly:\n${lines.join('\n')}`);
  }, 3_600_000);
});
