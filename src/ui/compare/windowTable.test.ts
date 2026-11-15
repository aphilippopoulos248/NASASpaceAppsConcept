import { beforeAll, describe, expect, it } from 'vitest';
import { analyseStack, compareAnalyses } from '../../analysis/api';
import { fnSource, stackOf } from '../../analysis/testing';
import type { SiteAnalysis, SkyTransition } from '../../analysis/types';
import type { Scenario } from '../../core/types';
import { exportFilename, isoSeconds, passageRows, spellRows, toCsv, toJson } from './windowTable';

// 0 N 0 E on a smooth Moon. "eclipse": 13-15 March 2025, sunlit, then Earth in front of the Sun
// (totality 05:44-08:10 UTC on the 14th), sunlit again. "dusk": 20-23 March, the Sun sets on the 21st.
const scenario = (label: string, startIso: string, durationH: number): Scenario => ({
  id: label, label, site: { id: 'pin:0.00000,0.00000', name: 'Pin 0.0° N, 0.0° E', kind: 'custom', lat: 0, lon: 0 }, mastHeightM: 2, startMs: Date.parse(startIso), durationH, stepMin: 10,
});
const smooth = stackOf(fnSource('smooth sphere', 60, () => 0));
let eclipse: SiteAnalysis, dusk: SiteAnalysis;
beforeAll(async () => {
  eclipse = await analyseStack(scenario('Eclipse', '2025-03-13T00:00:00Z', 48), smooth);
  dusk = await analyseStack(scenario('Dusk', '2025-03-20T00:00:00Z', 72), smooth);
});
const REQ = { sunElMinDeg: 0, sunElMaxDeg: 90, maxEarthGapH: 12, slopeLimitDeg: 10 };

describe('the mission-window table', () => {
  it('lists sunlit and dark spells in time order, the passages of Earth in front of the Sun, then Earth', () => {
    const rows = spellRows(eclipse);
    expect(rows.map((r) => `${r.group}:${r.kind}`)).toEqual(['sun:sunlit', 'sun:dark', 'sun:sunlit', 'sun:eclipse', 'earth:earth']);
    const [before, totality, after, passage, earth] = rows;
    // Totality lies inside the window: given as it is, with no note.
    expect(isoSeconds(totality.startMs)).toBe('2025-03-14T05:44:08Z');
    expect(isoSeconds(totality.endMs)).toBe('2025-03-14T08:10:04Z');
    expect(totality).toMatchObject({ runsPastStart: false, runsPastEnd: false, startFound: true, endFound: true, note: '' });
    expect(totality.hours).toBeCloseTo(totality.windowHours, 9);
    // The sunlit spell before it began at sunrise on 7 March: the full spell, and the part in the window beside it.
    expect(before).toMatchObject({ runsPastStart: true, runsPastEnd: false, startFound: true });
    expect(isoSeconds(before.startMs)).toBe('2025-03-07T02:09:55Z');
    expect(before.windowStartMs).toBe(eclipse.scenario.startMs);
    expect(before.endMs).toBe(totality.startMs);
    expect(before.hours).toBeCloseTo(171.57, 1);
    expect(before.note).toBe('The spell began before the window, at 2025-03-07 02:09 UTC: 171.6 h (7.1 d) in full, 29.7 h of it inside the window.');
    expect(after.note).toBe('The spell goes on after the window, to 2025-03-21 22:47 UTC: 182.6 h (7.6 d) in full, 15.8 h of it inside the window.');
    // The whole passage of Earth's disc across the Sun's (partial phases included) is inside the window.
    expect(passage.startMs).toBeLessThan(totality.startMs);
    expect(passage.endMs).toBeGreaterThan(totality.endMs);
    expect(passage.note).toBe('');
    // Earth never sets here: the search stops 60 days out each way and says so.
    expect(earth).toMatchObject({ runsPastStart: true, runsPastEnd: true, startFound: false, endFound: false });
    expect(earth.hours).toBeCloseTo(48 + 2 * 60 * 24, 6);
    expect(earth.note).toBe('The spell began more than 60 days before the window (no start found) and goes on more than 60 days after the window (no end found): at least 2928.0 h (122.0 d), 48.0 h (2.0 d) of it inside the window.');
  });

  it('the night after a sunset in the window is the longest darkness in full', () => {
    const rows = spellRows(dusk).filter((r) => r.group === 'sun');
    expect(rows.map((r) => r.kind)).toEqual(['sunlit', 'dark']);
    const night = rows[1];
    expect(night.startMs).toBe(dusk.metrics.longestDarknessFull!.startMs);
    expect(night.endMs).toBe(dusk.metrics.longestDarknessFull!.endMs);
    expect(night.note).toMatch(/^The spell goes on after the window, to 2025-04-05 15:17 UTC: 352\.5 h \(14\.7 d\) in full, 25\.2 h of it inside the window\.$/);
  });
});

describe('passages: both ends of every rise and set (D-8)', () => {
  it('names each end of the sunset in the window', () => {
    const [set] = passageRows(dusk);
    expect(passageRows(dusk)).toHaveLength(1);
    expect(set).toMatchObject({ body: 'sun', kind: 'set', state: 'Sun setting', start: { instant: 'Sun starts setting', inWindow: true }, end: { instant: 'Sun fully set', inWindow: true }, runsPastStart: false, runsPastEnd: false, centre: [], note: '' });
    expect(isoSeconds(set.start.timeMs!)).toBe('2025-03-21T21:44:36Z');
    // The sunset event is the passage's last limb.
    expect(set.end.timeMs).toBe(dusk.events.find((e) => e.type === 'sunset')!.timeMs);
    expect(set.summary).toBe('starts setting 2025-03-21 21:44, fully set 22:47 UTC');
    expect(set.hours).toBeCloseTo(1.05, 2);
    // No passage at all in the eclipse window: the Sun stays up (Earth in front of it is no sunset).
    expect(passageRows(eclipse)).toEqual([]);
  });

  it('words grazes, peeks, Earth with its centre, and ends that were not found', () => {
    const t0 = dusk.scenario.startMs, H = 3_600_000;
    const at = (h: number, inWindow = true) => ({ timeMs: t0 + h * H, azDeg: 270, inWindow });
    const tr = (over: Partial<SkyTransition>): SkyTransition => ({ body: 'sun', kind: 'set', start: { ...at(1), edge: 'first-cut' }, end: { ...at(2), edge: 'last-limb' }, hours: 1, centre: [], minVisibleFraction: NaN, maxVisibleFraction: NaN, limitDays: 60, ...over });
    const a: SiteAnalysis = {
      ...dusk,
      transitions: [
        tr({ kind: 'graze', end: { ...at(2), edge: 'whole-clear' }, minVisibleFraction: 0.62 }),
        tr({ kind: 'peek', start: { ...at(3), edge: 'first-limb' }, end: { ...at(4), edge: 'last-limb' }, maxVisibleFraction: 0.25 }),
        tr({ body: 'earth', start: { ...at(10), edge: 'first-cut' }, end: { ...at(80, false), edge: 'last-limb' }, hours: 70, centre: [{ ...at(40), up: false }] }),
        tr({ kind: 'unresolved', start: { ...at(60), edge: 'first-limb' }, end: { ...at(72 + 1440, false), edge: 'unresolved' }, hours: 1452 }),
      ],
    };
    const [graze, peek, earth, open] = passageRows(a);
    expect(graze).toMatchObject({ state: 'Sun partly hidden, never fully set', start: { instant: 'Sun starts to be partly hidden' }, end: { instant: "Sun's whole disc clear again" }, note: 'At most 38 % of the disc is hidden at the analysis\' samples.' });
    expect(graze.summary).toMatch(/never fully set$/);
    expect(peek).toMatchObject({ state: 'Sun partly visible, never fully risen', start: { instant: 'Sun starts to be partly visible' }, end: { instant: "Sun's last part gone again" }, note: 'At most 25 % of the disc shows at the analysis\' samples.' });
    expect(earth).toMatchObject({ state: 'Earth setting', start: { instant: 'Earth starts setting' }, end: { instant: 'Earth fully set', inWindow: false }, runsPastEnd: true, centre: [{ instant: "Earth's centre sets", inWindow: true }] });
    expect(earth.windowEndMs).toBe(t0 + 72 * H);
    expect(earth.summary).toMatch(/^starts setting .*, centre sets .*, fully set .* \(after the analysed window\) UTC$/);
    // An end not found gets no time anywhere (D-8), and the note says how far the search went.
    expect(open).toMatchObject({ state: 'Sun rising (an end not found)', start: { instant: 'Sun starts rising' }, end: { instant: 'end not found', timeMs: null }, runsPastEnd: true, note: '' });
    expect(open.summary).toBe('starts rising 2025-03-22 12:00 UTC, not over within 60 days after the analysed window');
    const csv = toCsv([{ slot: 'current', analysis: a }]).trimEnd().split('\r\n');
    const openLine = csv.at(-1)!;
    // Its end_utc is empty and end_found false; the note is the summary.
    expect(openLine).toContain(`,sun,Sun rising (an end not found),${isoSeconds(t0 + 60 * H)},,1452,true,false,`);
    expect(openLine).toMatch(/,"starts rising 2025-03-22 12:00 UTC, not over within 60 days after the analysed window",Sun starts rising,end not found,$/);
    const grazeLine = csv.find((l) => l.includes('partly hidden'))!;
    expect(grazeLine).toContain(',"Sun partly hidden, never fully set",');
    expect(grazeLine).toContain("never fully set. At most 38 % of the disc is hidden at the analysis' samples.");
    expect(csv.find((l) => l.includes(',Earth setting,'))).toMatch(/,Earth starts setting,Earth fully set,Earth's centre sets \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});

describe('exports', () => {
  it('CSV: a header, one row per spell and per passage, quoting where needed, the scenario on every row', () => {
    const csv = toCsv([{ slot: 'A', analysis: eclipse }, { slot: 'B', analysis: dusk }]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('slot,scenario,site_id,site_name,lat_deg,lon_deg_east,mast_height_m,window_start_utc,window_end_utc,group,state,start_utc,end_utc,duration_h,start_found,end_found,in_window_start_utc,in_window_end_utc,in_window_h,runs_past_window_start,runs_past_window_end,note,start_instant,end_instant,earth_centre_crossings');
    expect(lines).toHaveLength(1 + spellRows(eclipse).length + spellRows(dusk).length + passageRows(dusk).length);
    expect(csv.endsWith('\r\n')).toBe(true);
    // The pin id and the site name hold a comma, so they are quoted; the note too.
    expect(lines[1]).toBe('A,Eclipse,"pin:0.00000,0.00000","Pin 0.0° N, 0.0° E",0,0,2,2025-03-13T00:00:00Z,2025-03-15T00:00:00Z,sun,Sunlit,2025-03-07T02:09:55Z,2025-03-14T05:44:08Z,171.5703,true,true,2025-03-13T00:00:00Z,2025-03-14T05:44:08Z,29.7357,true,false,"The spell began before the window, at 2025-03-07 02:09 UTC: 171.6 h (7.1 d) in full, 29.7 h of it inside the window.",,,');
    expect(lines[2]).toBe('A,Eclipse,"pin:0.00000,0.00000","Pin 0.0° N, 0.0° E",0,0,2,2025-03-13T00:00:00Z,2025-03-15T00:00:00Z,sun,Dark,2025-03-14T05:44:08Z,2025-03-14T08:10:04Z,2.4323,true,true,2025-03-14T05:44:08Z,2025-03-14T08:10:04Z,2.4323,false,false,,,,');
    expect(lines.filter((l) => l.startsWith('B,Dusk,')).length).toBe(spellRows(dusk).length + 1);
    // The sunset as a passage: both ends, each named (D-8).
    expect(lines.at(-1)).toBe('B,Dusk,"pin:0.00000,0.00000","Pin 0.0° N, 0.0° E",0,0,2,2025-03-20T00:00:00Z,2025-03-23T00:00:00Z,sun,Sun setting,2025-03-21T21:44:36Z,2025-03-21T22:47:44Z,1.0521,true,true,2025-03-21T21:44:36Z,2025-03-21T22:47:44Z,1.0521,false,false,"starts setting 2025-03-21 21:44, fully set 22:47 UTC",Sun starts setting,Sun fully set,');
    // A field with a quote in it is doubled.
    const quoted = toCsv([{ slot: 'current', analysis: { ...dusk, scenario: { ...dusk.scenario, label: 'The "late" arrival' } } }]);
    expect(quoted.split('\r\n')[1].startsWith('current,"The ""late"" arrival",')).toBe(true);
  });

  it('JSON: everything behind the table, with the definitions of the events and the comparison', () => {
    const text = toJson([{ slot: 'A', analysis: eclipse }, { slot: 'B', analysis: dusk }], REQ, () => 30, compareAnalyses(eclipse, dusk), Date.UTC(2026, 10, 15, 3, 4, 5));
    const doc = JSON.parse(text);
    expect(doc.exportedUtc).toBe('2026-11-15T03:04:05Z');
    expect(doc.conventions).toMatch(/east-positive/);
    expect(doc.eventDefinitions.sunset).toBe("Sun fully set: the last part of the Sun's disc goes behind the terrain skyline.");
    expect(doc.scenarios).toHaveLength(2);
    const a = doc.scenarios[0];
    expect(a.slot).toBe('A');
    expect(a.scenario).toMatchObject({ label: 'Eclipse', startUtc: '2025-03-13T00:00Z', durationH: 48, mastHeightM: 2, site: { latDeg: 0, lonDegEast: 0 } });
    expect(a.metrics.earthCentreVisiblePct).toBe(100);
    expect(a.spells).toHaveLength(spellRows(eclipse).length);
    expect(a.spells[1]).toEqual({ group: 'sun', state: 'Dark', startUtc: '2025-03-14T05:44:08Z', endUtc: '2025-03-14T08:10:04Z', hours: 2.4323, startFound: true, endFound: true, inWindow: { startUtc: '2025-03-14T05:44:08Z', endUtc: '2025-03-14T08:10:04Z', hours: 2.4323 }, runsPastWindowStart: false, runsPastWindowEnd: false });
    // The default band (0 to 90 deg) is no requirement: nothing is checked against it, and the export says so.
    expect(a.requirements).toMatchObject({ sunElevationBand: { required: false, minDeg: 0, maxDeg: 90, sunElNowDeg: 30, metNow: null, metForWholeWindow: null, note: expect.stringMatching(/^No solar elevation band is required/) }, maxEarthGap: { limitH: 12, met: true }, slopeLimitDeg: 10, slopeWithinLimit: true });
    expect(a.requirements).not.toHaveProperty('sunElevationBandSet');
    expect(a.provenance.assumptions.length).toBeGreaterThan(3);
    expect(doc.scenarios[1].events.map((e: { label: string }) => e.label)).toContain('Sun fully set');
    // Each event with its passage, every passage with both ends named, and Earth by any part of its disc beside its centre.
    expect(doc.scenarios[1].events.find((e: { type: string }) => e.type === 'sunset').passage).toBe('starts setting 2025-03-21 21:44, fully set 22:47 UTC');
    expect(doc.scenarios[1].passages).toEqual([
      expect.objectContaining({ body: 'sun', kind: 'set', state: 'Sun setting', start: { instant: 'Sun starts setting', timeUtc: '2025-03-21T21:44:36Z', inWindow: true, azDeg: 270.11 }, end: expect.objectContaining({ instant: 'Sun fully set', timeUtc: '2025-03-21T22:47:44Z' }), hoursIsLowerBound: false, summary: 'starts setting 2025-03-21 21:44, fully set 22:47 UTC' }),
    ]);
    expect(a.passages).toEqual([]);
    expect(a.metrics).toMatchObject({ earthCentreVisiblePct: 100, earthAnyPartVisiblePct: 100, longestEarthWhollyHiddenH: 0, earthWhollyHiddenRunsIntoWindowEdge: false });
    expect(doc.passageInstantDefinitions['Sun starts setting']).toBe("the terrain skyline starts to cut into the Sun's disc.");
    expect(doc.conventions).toMatch(/start_instant and end_instant/);
    expect(doc.comparison).toMatchObject({ meaning: 'B minus A' });
    expect(doc.comparison.highlights.length).toBeGreaterThan(0);
    // One side, no comparison.
    expect(JSON.parse(toJson([{ slot: 'current', analysis: dusk }], REQ, () => NaN, null, 0))).not.toHaveProperty('comparison');
  });

  it('file names say the site, the arrival, the window and the mast', () => {
    expect(exportFilename([{ slot: 'current', analysis: dusk }], 'csv')).toBe('lunyx_pin_0.00000_0.00000_2025-03-20T0000Z_72h_2m.csv');
    expect(exportFilename([{ slot: 'A', analysis: eclipse }, { slot: 'B', analysis: dusk }], 'json')).toBe('lunyx_compare_A_pin_0.00000_0.00000_2025-03-13T0000Z_48h_2m_B_pin_0.00000_0.00000_2025-03-20T0000Z_72h_2m.json');
  });
});
