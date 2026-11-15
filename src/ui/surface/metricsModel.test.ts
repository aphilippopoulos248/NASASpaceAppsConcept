import { beforeAll, describe, expect, it } from 'vitest';
import { blockageAt, nextEvents } from '../../analysis/api';
import type { SiteAnalysis } from '../../analysis/types';
import type { AnalysisStatus } from '../../core/analysisStore';
import type { Scenario } from '../../core/types';
import { buildMetrics, EVENT_ORDER } from './metricsModel';
import { TEST_SITE, testAnalysis } from './testFixture';

let analysis: SiteAnalysis, scenario: Scenario, sunsetMs: number;
const H = 3_600_000;
const req = (timeMs: number, over: Partial<Parameters<typeof buildMetrics>[2]> = {}) => ({ timeMs, site: TEST_SITE, mastHeightM: 2, sunElMinDeg: 0, sunElMaxDeg: 90, maxEarthGapH: null, ...over });

beforeAll(async () => {
  ({ analysis, scenario, sunsetMs } = await testAnalysis());
});

describe('key metrics', () => {
  it('says so when no site is selected', () => {
    const v = buildMetrics({ state: 'idle' }, null, { ...req(0), site: null });
    expect(v.status).toBe('idle');
    expect(v.message).toMatch(/No site is selected/);
    expect(v.sun).toBeNull();
    expect(v.window).toBeNull();
  });

  it('while the analysis runs: Sun and Earth directions from the sky model, no skyline figures', () => {
    const v = buildMetrics({ state: 'loading', scenario }, scenario.id, req(scenario.startMs));
    expect(v.status).toBe('loading');
    expect(v.message).toMatch(/Working out/);
    expect(v.sun!.azDeg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v.sun!.elDeg)).toBe(true);
    expect(v.sun!.clearanceDeg).toBeNull();
    expect(v.sun!.stateText).toMatch(/not available yet/);
    expect(v.countdowns).toBeNull();
    expect(v.window).toBeNull();
  });

  it('treats a result for another scenario as still loading', () => {
    const st: AnalysisStatus = { state: 'ready', scenario, value: analysis };
    expect(buildMetrics(st, 'some-other-scenario', req(scenario.startMs)).status).toBe('loading');
    expect(buildMetrics(st, scenario.id, req(scenario.startMs)).status).toBe('ready');
  });

  it('passes the reason of a failed analysis on, without numbers', () => {
    const v = buildMetrics({ state: 'error', scenario, error: 'No elevation data covers this site.', notAvailable: false }, scenario.id, req(scenario.startMs));
    expect(v.status).toBe('error');
    expect(v.message).toBe('The site analysis is not available: No elevation data covers this site.');
    expect(v.window).toBeNull();
    expect(v.flags).toEqual([]);
  });

  it('shows exactly what the science core gives for the instant', () => {
    const t = scenario.startMs + 6 * H;
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(t));
    for (const body of ['sun', 'earth'] as const) {
      const b = blockageAt(analysis, body, t), shown = v[body]!;
      expect(shown.azDeg).toBe(b.bodyAzDeg);
      expect(shown.elDeg).toBe(b.bodyElDeg);
      expect(shown.clearanceDeg).toBe(b.clearanceDeg);
      expect(shown.skylineElDeg).toBe(b.skylineElDeg);
    }
    expect(v.insideWindow).toBe(true);
    // Two days before sunset the Sun is well up in the west and nothing is in the way.
    expect(v.sun!.state).toBe('visible');
    expect(v.sun!.stateText).toBe('above the skyline');
    expect(v.earth!.stateText).toBe('in line of sight');
  });

  it('counts down to the next events of the analysis, in the design order', () => {
    const t = scenario.startMs + 6 * H;
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(t));
    const next = nextEvents(analysis, t);
    expect(v.countdowns!.map((c) => c.type)).toEqual([...EVENT_ORDER]);
    const sunset = v.countdowns!.find((c) => c.type === 'sunset')!;
    expect(next.sunset).not.toBeNull();
    expect(sunset.timeMs).toBe(next.sunset!.timeMs);
    expect(sunset.inHours).toBeCloseTo((next.sunset!.timeMs - t) / H, 9);
    expect(sunset.text).toMatch(/^in \d/);
    // The ridge hides the Sun before it reaches the horizontal.
    expect(next.sunset!.timeMs).toBeLessThan(sunsetMs);
    // Every event time says which instant of the transition it is (decision D-8)...
    expect(v.countdowns!.map((c) => c.instant)).toEqual(['Sun fully set', 'Sun starts rising', "Earth's centre sets", "Earth's centre rises"]);
    expect(sunset.detail).toMatch(/the last limb of the Sun goes behind the terrain skyline/);
    // ...and the label is true of the science core's event: some of the disc still shows just before it, none just after.
    expect(blockageAt(analysis, 'sun', sunset.timeMs! - 3 * 60_000).discVisibleFraction!).toBeGreaterThan(0);
    expect(blockageAt(analysis, 'sun', sunset.timeMs! + 3 * 60_000).discVisibleFraction!).toBe(0);
    expect(blockageAt(analysis, 'sun', sunset.timeMs! - 3 * 60_000).discVisibleFraction!).toBeLessThan(0.2);
    // No sunrise follows within 96 h of an equatorial sunset minus two days.
    const sunrise = v.countdowns!.find((c) => c.type === 'sunrise')!;
    expect(sunrise.timeMs).toBeNull();
    expect(sunrise.text).toBe('none before the window ends');
    // The hint names the end of the window it was searched to.
    expect(sunrise.detail).toMatch(/^No sunrise between now and the end of the analysed mission window \(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\)\. Sunrise here means: the first limb of the Sun appears/);
    expect(sunset.detail).toMatch(/^Sunset at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC: the last limb of the Sun goes behind the terrain skyline/);
  });

  it('says why there are no countdowns once the clock has left the window', () => {
    const end = scenario.startMs + scenario.durationH * H;
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(end + 5 * H));
    expect(v.insideWindow).toBe(false);
    expect(v.countdowns!.every((c) => c.timeMs === null && c.text === 'none: clock past the window' && /past the analysed mission window, which ended \d{4}-/.test(c.detail))).toBe(true);
    // The instant itself is still described (sky model against the same skyline).
    expect(Number.isFinite(v.sun!.elDeg)).toBe(true);
    expect(v.sun!.state).toBe('hidden');
    expect(v.sun!.stateText).toBe('below the horizon');
  });

  it('names the ridge as the reason while the Sun is behind it but still above the horizontal', () => {
    const next = nextEvents(analysis, scenario.startMs).sunset!;
    const t = next.timeMs + 20 * 60_000;
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(t));
    expect(v.sun!.elDeg).toBeGreaterThan(0);
    expect(v.sun!.clearanceDeg!).toBeLessThan(0);
    expect(v.sun!.stateText).toBe('behind terrain');
  });

  it('gives the mission-window figures of the analysis with units in the text', () => {
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(scenario.startMs));
    const m = analysis.metrics, w = v.window!;
    expect(w.illuminationPct).toBe(m.illuminationPct);
    expect(w.earthVisiblePct).toBe(m.earthVisiblePct);
    expect(w.startMs).toBe(scenario.startMs);
    expect(w.durationH).toBe(96);
    // The window ends in the night that follows the sunset: the darkness is cut by its edge.
    expect(m.darknessOpenEnded).toBe(true);
    expect(w.longestDarknessText).toMatch(/or more inside the window/);
    expect(w.longestEarthGapText).toBe('none');
    expect(w.slopeText).toMatch(/^0\.0° over \d+ m$/);
    expect(w.slopeDetail).toMatch(/^Slope of the ground at the site: 0\.0° from horizontal, measured over \d+ m on Synthetic ridge 60 m/);
    expect(v.provenance.some((line) => /^Slope measured over \d+ m on Synthetic ridge 60 m/.test(line))).toBe(true);
    expect(w.sunElRangeText).toMatch(/° to /);
  });

  it('flags unmet requirements in words, and only then', () => {
    const t = scenario.startMs + 6 * H;
    const ready: AnalysisStatus = { state: 'ready', scenario, value: analysis };
    // A band that takes in every elevation is met.
    const relaxed = buildMetrics(ready, scenario.id, req(t, { sunElMinDeg: -90 }));
    expect(relaxed.flags).toEqual([]);
    // The window runs into the night, but the default band (0 to 90 degrees) is no requirement:
    // nothing is flagged, at night or over the window (one rule with getAnalysis, src/core/requirements.ts).
    expect(analysis.metrics.minSunElDeg).toBeLessThan(0);
    const night = sunsetMs + 3 * H;
    expect(blockageAt(analysis, 'sun', night).bodyElDeg).toBeLessThan(0);
    expect(buildMetrics(ready, scenario.id, req(t)).flags).toEqual([]);
    expect(buildMetrics(ready, scenario.id, req(night)).flags).toEqual([]);
    const el = blockageAt(analysis, 'sun', t).bodyElDeg;
    const strict = buildMetrics(ready, scenario.id, req(t, { sunElMinDeg: Math.ceil(el) + 5, sunElMaxDeg: 90 }));
    expect(strict.flags[0]).toMatch(/^Sun elevation now \d+\.\d\d° is below the required band \(\d+° to 90°\)\.$/);
    expect(strict.flags[1]).toMatch(/^Over the mission window the Sun's elevation runs from −\d+\.\d\d° to \d+\.\d\d°: outside the required band/);
    // Earth is always in view from this near-side site: no gap to flag, however strict the limit.
    expect(buildMetrics(ready, scenario.id, req(t, { sunElMinDeg: -90, maxEarthGapH: 0.1 })).flags).toEqual([]);
  });

  it('states where the numbers come from', () => {
    const v = buildMetrics({ state: 'ready', scenario, value: analysis }, scenario.id, req(scenario.startMs));
    const text = v.provenance.join(' ');
    expect(text).toMatch(/in-app sky model/);
    expect(text).toMatch(/topocentric/);
    expect(text).toMatch(/UTC/);
    expect(text).toMatch(/Synthetic ridge 60 m \(60 m per sample/);
    expect(text).toMatch(/Observer 2 m above the ground/);
    expect(text).toMatch(/not a radio link/);
    // The analysis' own accuracy statement is passed on as it is.
    expect(v.provenance).toContain(analysis.provenance.ephemerisNote);
    // The compact line names the three things a reader checks first.
    expect(v.provenanceShort).toBe('Observer 2 m above the ground · in-app sky model · skyline from Synthetic ridge 60 m, 60 m per sample');
    // Nothing is claimed before an analysis exists.
    expect(buildMetrics({ state: 'loading', scenario }, scenario.id, req(scenario.startMs)).provenanceShort).toBe('');
  });
});
