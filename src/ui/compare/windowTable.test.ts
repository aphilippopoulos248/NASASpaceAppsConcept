import { beforeAll, describe, expect, it } from 'vitest';
import { analyseStack, compareAnalyses } from '../../analysis/api';
import { fnSource, stackOf } from '../../analysis/testing';
import type { SiteAnalysis } from '../../analysis/types';
import type { Scenario } from '../../core/types';
import { exportFilename, isoSeconds, spellRows, toCsv, toJson } from './windowTable';

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

describe('exports', () => {
  it('CSV: a header, one row per spell, quoting where needed, the scenario on every row', () => {
    const csv = toCsv([{ slot: 'A', analysis: eclipse }, { slot: 'B', analysis: dusk }]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('slot,scenario,site_id,site_name,lat_deg,lon_deg_east,mast_height_m,window_start_utc,window_end_utc,group,state,start_utc,end_utc,duration_h,start_found,end_found,in_window_start_utc,in_window_end_utc,in_window_h,runs_past_window_start,runs_past_window_end,note');
    expect(lines).toHaveLength(1 + spellRows(eclipse).length + spellRows(dusk).length);
    expect(csv.endsWith('\r\n')).toBe(true);
    // The pin id and the site name hold a comma, so they are quoted; the note too.
    expect(lines[1]).toBe('A,Eclipse,"pin:0.00000,0.00000","Pin 0.0° N, 0.0° E",0,0,2,2025-03-13T00:00:00Z,2025-03-15T00:00:00Z,sun,Sunlit,2025-03-07T02:09:55Z,2025-03-14T05:44:08Z,171.5703,true,true,2025-03-13T00:00:00Z,2025-03-14T05:44:08Z,29.7357,true,false,"The spell began before the window, at 2025-03-07 02:09 UTC: 171.6 h (7.1 d) in full, 29.7 h of it inside the window."');
    expect(lines[2]).toBe('A,Eclipse,"pin:0.00000,0.00000","Pin 0.0° N, 0.0° E",0,0,2,2025-03-13T00:00:00Z,2025-03-15T00:00:00Z,sun,Dark,2025-03-14T05:44:08Z,2025-03-14T08:10:04Z,2.4323,true,true,2025-03-14T05:44:08Z,2025-03-14T08:10:04Z,2.4323,false,false,');
    expect(lines.filter((l) => l.startsWith('B,Dusk,')).length).toBe(spellRows(dusk).length);
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
    expect(a.requirements).toMatchObject({ sunElevationBand: { minDeg: 0, maxDeg: 90, sunElNowDeg: 30 }, maxEarthGap: { limitH: 12, met: true }, slopeLimitDeg: 10, slopeWithinLimit: true });
    expect(a.provenance.assumptions.length).toBeGreaterThan(3);
    expect(doc.scenarios[1].events.map((e: { label: string }) => e.label)).toContain('Sun fully set');
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
