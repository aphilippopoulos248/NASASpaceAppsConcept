import { beforeAll, describe, expect, it } from 'vitest';
import { analyseStack } from '../../analysis/api';
import { fnSource, stackOf } from '../../analysis/testing';
import type { Blockage, SiteAnalysis, SkyEvent } from '../../analysis/types';
import type { Scenario } from '../../core/types';
import { basisOf, clockPosition, nowRows, requirementLines, scenarioRows, splitAssumptions, windowRows, type Science } from './model';

// A smooth Moon at 0 N 0 E: Earth stays overhead, and the Sun sets about a week after full Moon
// (14 March 2025). "Day" lies wholly in sunlight; "dusk" starts lit and ends in a night that
// runs far past its window.
const scenario = (label: string, startIso: string, durationH = 72, mast = 2): Scenario => ({
  id: label, label, site: { id: 'pin:0.00000,0.00000', name: 'Pin 0.0° N, 0.0° E', kind: 'custom', lat: 0, lon: 0 },
  mastHeightM: mast, startMs: Date.parse(startIso), durationH, stepMin: 10,
});
const smooth = stackOf(fnSource('Synthetic smooth sphere', 60, () => 0));

let day: SiteAnalysis, dusk: SiteAnalysis;
beforeAll(async () => {
  day = await analyseStack(scenario('Day', '2025-03-10T00:00:00Z'), smooth);
  dusk = await analyseStack(scenario('Dusk', '2025-03-20T00:00:00Z'), smooth);
});

const row = (rows: ReturnType<typeof windowRows>, key: string) => rows.find((r) => r.key === key)!;

describe('window rows: A, B and B minus A', () => {
  it('states both sides and the signed difference with its unit', () => {
    const rows = windowRows(day, dusk);
    const sun = row(rows, 'sunlight');
    expect(sun.a).toBe('100.0 %');
    expect(dusk.metrics.illuminationPct).toBeGreaterThan(30);
    expect(dusk.metrics.illuminationPct).toBeLessThan(80);
    expect(sun.b).toBe(`${dusk.metrics.illuminationPct.toFixed(1)} %`);
    expect(sun.delta).toBe(`−${(100 - dusk.metrics.illuminationPct).toFixed(1)} points`);
    expect(sun.tone).toBe('worse');

    const dark = row(rows, 'darkness');
    expect(dark.a).toBe('none');
    expect(dark.b).toMatch(/^\d+\.\d h or more$/); // the night runs into the end of the window
    expect(dark.delta).toMatch(/^\+\d+\.\d h$/);
    expect(dark.tone).toBe('worse');

    // Earth is overhead for both: no difference, and it is said as such rather than coloured.
    expect(row(rows, 'earth')).toMatchObject({ a: '100.0 %', b: '100.0 %', delta: '0.0 points', tone: 'same' });
    expect(row(rows, 'gap')).toMatchObject({ a: 'none', b: 'none', delta: '0.0 h', tone: 'same' });
    expect(row(rows, 'slope')).toMatchObject({ a: '0.0° over 120 m', b: '0.0° over 120 m', delta: '0.0°', tone: 'same' });
  });

  it('gives the full length of a darkness that runs past the window edge, and says when it is the full length', () => {
    const rows = windowRows(day, dusk);
    const full = row(rows, 'darknessFull');
    const f = dusk.metrics.longestDarknessFull!;
    expect(f.startFound && f.endFound).toBe(true);
    expect(f.hours).toBeGreaterThan(300); // about half a lunar day
    expect(full.a).toBe('none'); // A's longest darkness lies inside its window: the same figure as the row above
    expect(full.b).toContain(`${f.hours.toFixed(1)} h (${(f.hours / 24).toFixed(1)} d)`);
    expect(full.b).toMatch(/2025-03-2\d \d\d:\d\d to 2025-04-0\d \d\d:\d\d UTC$/);
    expect(full.delta).toBe(`+${f.hours.toFixed(1)} h`);
    // No such row when neither side's longest spell is cut by the window.
    expect(windowRows(day, day).some((r) => r.key === 'darknessFull' || r.key === 'gapFull')).toBe(false);
  });

  it('says "at least" when the search for the end of a spell gives up', () => {
    const open = { ...dusk, metrics: { ...dusk.metrics, longestDarknessFull: { ...dusk.metrics.longestDarknessFull!, endFound: false, hours: 1440, limitDays: 60 } } };
    const full = row(windowRows(day, open), 'darknessFull');
    expect(full.b).toBe('at least 1440.0 h (60.0 d): no end within 60 days of the window');
    expect(full.delta).toBe(''); // a lower bound is not subtracted
    expect(full.tone).toBe('none');
  });

  it('leaves a missing side blank and shows no difference, never a number', () => {
    const rows = windowRows(day, null);
    for (const r of rows) {
      expect(r.b).toBe('—');
      expect(r.delta).toBe('');
    }
    expect(row(rows, 'sunlight').a).toBe('100.0 %');
    expect(windowRows(null, null).every((r) => r.a === '—' && r.b === '—' && r.tone !== 'better' && r.tone !== 'worse')).toBe(true);
  });

  it('says "not available" for a figure that does not exist and does not colour the difference', () => {
    const noData = { ...day, slope: { ...day.slope, slopeDeg: NaN }, metrics: { ...day.metrics, illuminationPct: NaN, longestDarknessH: NaN } };
    const rows = windowRows(day, noData);
    expect(row(rows, 'sunlight')).toMatchObject({ b: 'not available', delta: '', tone: 'none' });
    expect(row(rows, 'darkness')).toMatchObject({ b: 'not available', delta: '', tone: 'none' });
    expect(row(rows, 'slope')).toMatchObject({ b: 'not available: no elevation data', delta: '', tone: 'none' });
  });

  it('does not judge a slope difference measured over different baselines', () => {
    const coarse = { ...day, slope: { ...day.slope, slopeDeg: 6, baselineM: 10 } };
    const r = row(windowRows(day, coarse), 'slope');
    expect(r.delta).toBe('+6.0° (different baselines)');
    expect(r.tone).toBe('none');
    expect(r.hint).toContain('120 m and 10 m');
    expect(row(windowRows(day, { ...day, slope: { ...day.slope, slopeDeg: 6 } }), 'slope')).toMatchObject({ delta: '+6.0°', tone: 'worse' });
  });

  it('calls more sunlight and shorter gaps better', () => {
    const better = { ...dusk, metrics: { ...dusk.metrics, illuminationPct: dusk.metrics.illuminationPct + 12.34, longestEarthGapH: 0 } };
    const worseGap = { ...dusk, metrics: { ...dusk.metrics, longestEarthGapH: 7.5 } };
    const rows = windowRows(worseGap, better);
    expect(row(rows, 'sunlight')).toMatchObject({ delta: '+12.3 points', tone: 'better' });
    expect(row(rows, 'gap')).toMatchObject({ a: '7.5 h', b: 'none', delta: '−7.5 h', tone: 'better' });
  });
});

describe('scenario rows: what defines each side', () => {
  const by = (rows: ReturnType<typeof scenarioRows>, key: string) => rows.find((r) => r.key === key)!;

  it('says what is the same and what differs for a delayed arrival with a taller mast', () => {
    const a = scenario('A', '2025-03-10T00:00:00Z'), b = scenario('B', '2025-03-11T12:00:00Z', 168, 10);
    const rows = scenarioRows(a, b);
    expect(rows.map((r) => r.key)).toEqual(['site', 'coords', 'arrival', 'end', 'length', 'mast']);
    expect(by(rows, 'site')).toMatchObject({ a: 'Pin 0.0° N, 0.0° E', b: 'Pin 0.0° N, 0.0° E', delta: 'same site' });
    expect(by(rows, 'coords')).toMatchObject({ a: '0.0000° N, 0.0000° E', delta: 'same point' });
    expect(by(rows, 'arrival')).toMatchObject({ a: '2025-03-10 00:00 UTC', b: '2025-03-11 12:00 UTC', delta: '36 h later' });
    expect(by(rows, 'end')).toMatchObject({ a: '2025-03-13 00:00 UTC', b: '2025-03-18 12:00 UTC', delta: '5.5 days later' });
    expect(by(rows, 'length')).toMatchObject({ a: '3 days', b: '7 days', delta: '4 days longer' });
    expect(by(rows, 'mast')).toMatchObject({ a: '2 m above the ground', b: '10 m above the ground', delta: '+8 m' });
  });

  it('gives the distance between two sites and blanks for an empty slot', () => {
    const a = scenario('A', '2025-03-10T00:00:00Z');
    const b = { ...a, site: { ...a.site, id: 'pin:0.00000,1.00000', name: 'One degree east', lon: 1 } };
    // One degree of longitude on the equator of a 1737.4 km sphere is 30.32 km.
    expect(by(scenarioRows(a, b), 'site').delta).toBe('30.32 km apart');
    expect(by(scenarioRows(a, b), 'coords')).toMatchObject({ b: '0.0000° N, 1.0000° E', delta: '' });
    expect(by(scenarioRows(a, b), 'arrival').delta).toBe('same time');
    expect(by(scenarioRows(a, b), 'mast').delta).toBe('same height');
    expect(by(scenarioRows(b, { ...a, startMs: a.startMs - 3_600_000 }), 'arrival').delta).toBe('1 h earlier');
    for (const r of scenarioRows(a, null)) expect(r).toMatchObject({ b: '—', delta: '' });
  });

  it('places the clock against a window', () => {
    const sc = scenario('A', '2025-03-10T00:00:00Z');
    expect(clockPosition(sc, Date.parse('2025-03-09T18:30:00Z'))).toBe('5 h 30 min before its window starts');
    expect(clockPosition(sc, Date.parse('2025-03-10T00:00:00Z'))).toBe('0 min into its window');
    expect(clockPosition(sc, Date.parse('2025-03-11T06:00:00Z'))).toBe('1 d 06 h into its window');
    expect(clockPosition(sc, Date.parse('2025-03-13T00:10:00Z'))).toBe('10 min after its window ended');
  });
});

describe('rows at the shared clock', () => {
  it('reads both sides at the same instant from the science core', () => {
    const t = Date.parse('2025-03-21T00:00:00Z'); // inside "dusk", after "day" has ended
    const rows = nowRows(day, dusk, t);
    const sun = rows.find((r) => r.key === 'sunNow')!;
    // Same site, same instant: the Sun is in the same place for both, a little above the smooth horizon.
    expect(sun.a).toBe(sun.b);
    expect(sun.a).toMatch(/^\d+\.\d° elevation, \d+\.\d° above the skyline$/);
    expect(sun.delta).toBe('0.0° clearance');
    expect(rows.find((r) => r.key === 'earthNow')!.a).toMatch(/^8\d\.\d° elevation, 8\d\.\d° above the skyline$/);
    const sunset = rows.find((r) => r.key === 'sunset')!;
    expect(sunset.a).toBe('none after the clock in this window');
    expect(sunset.b).toMatch(/^2025-03-21 \d\d:\d\d UTC \(in \d+ h \d\d min\)$/);
    expect(sunset.delta).toBe('');
    // Earth never sets here: the row stays and says so; sunrise and Earthrise are left out.
    expect(rows.find((r) => r.key === 'earthset')).toMatchObject({ a: 'none after the clock in this window', b: 'none after the clock in this window' });
    expect(rows.map((r) => r.key)).toEqual(['clock', 'sunNow', 'earthNow', 'sunset', 'earthset']);
    expect(rows[0]).toMatchObject({ a: '8 d 00 h after its window ended', b: '1 d 00 h into its window' });
  });

  it('words hidden bodies, missing skylines, eclipses and event differences', () => {
    const k = (over: Partial<Blockage>): Blockage => ({ bodyAzDeg: 90, bodyElDeg: 1.2, skylineElDeg: 2, clearanceDeg: -0.8, blocked: true, ridgeDistanceM: 0, ridgeHeightM: 0, ridge: { lat: 0, lon: 0 }, demName: '', demResolutionM: 60, explanation: '', ...over }) as Blockage;
    const ev = (type: SkyEvent['type'], iso: string): SkyEvent => ({ type, timeMs: Date.parse(iso), azDeg: 270 });
    const none = { sunrise: null, sunset: null, earthrise: null, earthset: null };
    const science: Science = {
      blockageAt: (a, body) => (a === day ? k(body === 'sun' ? {} : { bodyElDeg: 5, clearanceDeg: NaN }) : k(body === 'sun' ? { bodyElDeg: 3, clearanceDeg: 1, eclipsedFraction: 0.42 } : { bodyElDeg: NaN })),
      nextEvents: (a) => (a === day ? { ...none, sunset: ev('sunset', '2025-03-10T06:00:00Z'), earthrise: ev('earthrise', '2025-03-10T08:00:00Z') } : { ...none, sunset: ev('sunset', '2025-03-11T07:30:00Z') }),
    };
    const rows = nowRows(day, dusk, Date.parse('2025-03-10T00:00:00Z'), science);
    const by = (key: string) => rows.find((r) => r.key === key)!;
    expect(by('sunNow')).toMatchObject({ a: '1.2° elevation, 0.8° below the skyline (centre hidden)', b: '3.0° elevation, 1.0° above the skyline; Earth covers 42 % of it', delta: '+1.8° clearance' });
    expect(by('earthNow')).toMatchObject({ a: '5.0° elevation; no skyline (no elevation data)', b: 'not available', delta: '' });
    expect(by('sunset')).toMatchObject({ a: '2025-03-10 06:00 UTC (in 6 h 00 min)', b: '2025-03-11 07:30 UTC (in 1 d 07 h)', delta: '1 d 01 h later' });
    expect(by('earthrise')).toMatchObject({ a: '2025-03-10 08:00 UTC (in 8 h 00 min)', b: 'none after the clock in this window', delta: '' });
    expect(rows.some((r) => r.key === 'sunrise')).toBe(false);
  });
});

describe('requirements in words', () => {
  const open = { sunElMinDeg: 0, sunElMaxDeg: 90, maxEarthGapH: null, slopeLimitDeg: 10 };

  it('reports the band, the Earth gap and the slope limit as met', () => {
    const lines = requirementLines('A', day, { ...open, sunElMinDeg: 2, sunElMaxDeg: 80, maxEarthGapH: 12 }, 40);
    expect(lines.map((l) => l.status)).toEqual(['met', 'met', 'met']);
    expect(lines[0].text).toMatch(/^A: the Sun's elevation stays inside the required band, 2° to 80° \(it ranges from \d+\.\d° to \d+\.\d°\)\.$/);
    expect(lines[1].text).toBe('A: the longest Earth gap in the window, none, is within the 12 h limit.');
    expect(lines[2].text).toBe('A: the slope, 0.0° over 120 m, is within the 10° slope limit.');
    // No Earth-gap requirement set: no line about it.
    expect(requirementLines('A', day, { ...open, sunElMinDeg: 2, sunElMaxDeg: 80 }, 40)).toHaveLength(2);
  });

  it('the default band (0 to 90 deg, nobody asked for it) is a fact about the Sun, never a failure', () => {
    const [line] = requirementLines('B', dusk, open, 1);
    expect(line.status).toBe('info');
    expect(line.text).toMatch(/^B: no solar elevation band is set\. The Sun's elevation ranges from −\d+\.\d° to \d+\.\d° during the window, so it goes below the horizontal\.$/);
    const [high] = requirementLines('A', day, open, 40);
    expect(high).toMatchObject({ status: 'info' });
    expect(high.text).toMatch(/^A: no solar elevation band is set\. The Sun's elevation ranges from \d+\.\d° to \d+\.\d° during the window\.$/);
  });

  it('flags a breach of each requirement', () => {
    const steep = { ...dusk, slope: { ...dusk.slope, slopeDeg: 14.26 }, metrics: { ...dusk.metrics, longestEarthGapH: 30.04, earthGapOpenEnded: true, longestEarthGapFull: { startMs: 0, endMs: 0, hours: 51.2, startFound: true, endFound: true, limitDays: 60 } } };
    const lines = requirementLines('B', steep, { sunElMinDeg: 5, sunElMaxDeg: 60, maxEarthGapH: 24, slopeLimitDeg: 10 }, -3);
    expect(lines.map((l) => l.status)).toEqual(['breached', 'breached', 'breached']);
    expect(lines[0].text).toMatch(/^B: the Sun's elevation leaves the required band, 5° to 60°, during the window \(it ranges from −\d+\.\d° to \d+\.\d°\)\.$/);
    expect(lines[1].text).toBe('B: the longest Earth gap in the window, 30.0 h or more, is over the 24 h limit. It runs past the window edge: 51.2 h (2.1 d) in full.');
    expect(lines[2].text).toBe('B: the slope, 14.3° over 120 m, is over the 10° slope limit.');
  });

  it('says a gap inside the limit in the window is longer in full', () => {
    const cut = { ...day, metrics: { ...day.metrics, longestEarthGapH: 10, earthGapOpenEnded: true, longestEarthGapFull: { startMs: 0, endMs: 0, hours: 1440, startFound: true, endFound: false, limitDays: 60 } } };
    const [, gap] = requirementLines('A', cut, { ...open, maxEarthGapH: 24 }, 10);
    expect(gap.status).toBe('met');
    expect(gap.text).toBe('A: the longest Earth gap in the window, 10.0 h or more, is within the 24 h limit. It runs past the window edge: at least 1440.0 h (60.0 d) in full.');
  });

  it('says "cannot be checked" when the figure does not exist', () => {
    const blank = { ...day, slope: { ...day.slope, slopeDeg: NaN }, metrics: { ...day.metrics, minSunElDeg: NaN, maxSunElDeg: NaN, longestEarthGapH: NaN } };
    const lines = requirementLines('A', blank, { ...open, sunElMinDeg: 5, maxEarthGapH: 24 }, NaN);
    expect(lines.map((l) => l.status)).toEqual(['unknown', 'unknown', 'unknown']);
    // Without a band, nothing is said about a Sun whose elevation is not known.
    expect(requirementLines('A', blank, { ...open, maxEarthGapH: 24 }, NaN).map((l) => l.status)).toEqual(['unknown', 'unknown']);
    for (const l of lines) expect(l.text).toContain('cannot be checked');
  });
});

describe('basis and assumptions', () => {
  it('states coordinates, observer, ephemeris, elevation data and warnings', () => {
    const b = basisOf({ ...day, warnings: ['Coarse data only.'] });
    expect(b.coords).toBe('0.0000° N, 0.0000° E (longitude east-positive; a custom pin)');
    expect(b.observer).toBe('2 m above terrain that stands 0 m above the 1,737.4 km sphere');
    expect(b.ephemeris).toBe(day.provenance.ephemerisNote);
    expect(b.ephemeris.length).toBeGreaterThan(20);
    expect(b.elevationData.length).toBe(day.provenance.dem.length);
    expect(b.elevationData[0]).toMatch(/^60 m grid, 0\.0 to \d+\.\d km from the site: Synthetic smooth sphere$/);
    expect(b.warnings).toEqual(['Coarse data only.']);
  });

  it('says shared assumptions once and keeps what differs per side', () => {
    const split = splitAssumptions(['same 1', 'only a', 'same 2'], ['same 2', 'same 1', 'only b']);
    expect(split).toEqual({ shared: ['same 1', 'same 2'], onlyA: ['only a'], onlyB: ['only b'] });
    // Two real analyses of the same site share the geometry statements.
    const real = splitAssumptions(day.provenance.assumptions, dusk.provenance.assumptions);
    expect(real.shared.length).toBeGreaterThan(2);
    expect(real.shared.join(' ')).toMatch(/line of sight only/);
  });
});
