import { beforeAll, describe, expect, it } from 'vitest';
import type { SiteAnalysis } from '../../analysis/types';
import { chartData, niceTicks, sampleAtTime, skylineAtAz, skylineRange, stateText, tableRows, thin, timeTicks, trackAzRange, type ChartData } from './chartModel';
import { testAnalysis } from './testFixture';

let analysis: SiteAnalysis;
let data: ChartData;
const H = 3_600_000;

beforeAll(async () => {
  ({ analysis } = await testAnalysis());
  data = chartData(analysis);
});

describe('chart data', () => {
  it('carries every sample of the analysed series with the same numbers', () => {
    const s = analysis.series;
    expect(data.sun).toHaveLength(s.n);
    expect(data.earth).toHaveLength(s.n);
    const k = 100;
    expect(data.sun[k]).toMatchObject({ body: 'sun', index: k, timeMs: s.startMs + k * s.stepMs, azDeg: s.sunAz[k], elDeg: s.sunEl[k], clearanceDeg: s.sunClearance[k], visible: s.sunVisible[k] });
    expect(data.earth[k].elDeg).toBe(s.earthEl[k]);
    expect(data.startMs).toBe(s.startMs);
    expect(data.endMs).toBe(s.startMs + (s.n - 1) * s.stepMs);
    expect(data.scenarioId).toBe('test-scenario');
  });

  it('calls the Sun up while any of its disc shows, and Earth while its centre clears the skyline', () => {
    for (const p of data.sun) expect(p.up).toBe(p.visible > 0);
    for (const p of data.earth) expect(p.up).toBe(p.clearanceDeg >= 0);
    // The window starts by day and ends by night.
    expect(data.sun[0].up).toBe(true);
    expect(data.sun[data.sun.length - 1].up).toBe(false);
  });

  it('has the skyline with its ridge', () => {
    const sky = data.skyline!;
    expect(sky.elDeg).toBe(analysis.horizon.elevDeg);
    // 600 m at 9 km, less the curvature: about 3.6 degrees. Elsewhere the smooth horizon, just below zero.
    expect(sky.maxDeg).toBeGreaterThan(3.3);
    expect(sky.maxDeg).toBeLessThan(3.9);
    expect(sky.minDeg).toBeLessThan(0);
    expect(sky.minDeg).toBeGreaterThan(-0.2);
    expect(skylineAtAz(sky, 270)).toBeCloseTo(sky.maxDeg, 1);
    expect(skylineAtAz(sky, 90)).toBeLessThan(0);
    // Wraps, and interpolates between samples.
    expect(skylineAtAz(sky, 450)).toBe(skylineAtAz(sky, 90));
    expect(skylineAtAz(sky, -90)).toBe(skylineAtAz(sky, 270));
    const a = skylineAtAz(sky, 240), b = skylineAtAz(sky, 240 + sky.azStepDeg);
    expect(skylineAtAz(sky, 240 + sky.azStepDeg / 2)).toBeCloseTo((a + b) / 2, 6);
    expect(skylineAtAz(null, 10)).toBeNaN();
  });

  it('ranges the elevation axis over the skyline and the tracks near it, not down into the night', () => {
    const r = skylineRange(data);
    const highest = Math.max(...data.sun.map((p) => p.elDeg), ...data.earth.map((p) => p.elDeg));
    expect(r.max).toBeGreaterThan(highest);
    expect(r.max).toBeLessThanOrEqual(90);
    expect(r.min).toBeLessThan(data.skyline!.minDeg);
    // The Sun ends tens of degrees under the horizon; the axis follows it only 3 degrees down.
    expect(Math.min(...data.sun.map((p) => p.elDeg))).toBeLessThan(-10);
    expect(r.min).toBeGreaterThan(-8);
  });

  it('fits the azimuth axis to the tracks when asked, with room either side', () => {
    const r = trackAzRange(data, skylineRange(data).min);
    const azs = data.sun.filter((p) => p.elDeg >= skylineRange(data).min).map((p) => p.azDeg);
    expect(r.max - r.min).toBeLessThan(360);
    expect(r.max - r.min).toBeGreaterThanOrEqual(40);
    for (const az of [...azs, ...data.earth.map((p) => p.azDeg)]) {
      const wrapped = az < r.min ? az + 360 : az > r.max ? az - 360 : az;
      expect(wrapped).toBeGreaterThanOrEqual(r.min);
      expect(wrapped).toBeLessThanOrEqual(r.max);
    }
    // Tracks all round the compass: the full circle.
    const round: ChartData = { ...data, sun: Array.from({ length: 36 }, (_, i) => ({ ...data.sun[0], azDeg: i * 10, elDeg: 1 })), earth: [] };
    expect(trackAzRange(round, -1)).toEqual({ min: 0, max: 360 });
  });
});

describe('axes', () => {
  it('picks round ticks', () => {
    expect(niceTicks(0, 360, 8)).toEqual([0, 50, 100, 150, 200, 250, 300, 350]);
    expect(niceTicks(-1.2, 4.1, 5)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(niceTicks(-0.35, 0.42, 4)).toEqual([-0.2, 0, 0.2, 0.4]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it('puts time ticks on whole UTC hours or days', () => {
    const start = Date.UTC(2025, 2, 6, 17, 28);
    const day = timeTicks(start, start + 24 * H, 6);
    expect(day.map((t) => t.label)).toEqual(['18:00', '03-07', '06:00', '12:00']);
    expect(day[0].ms).toBe(Date.UTC(2025, 2, 6, 18));
    const month = timeTicks(start, start + 708 * H, 6);
    expect(month.length).toBeLessThanOrEqual(7);
    expect(month.every((t) => /^\d\d-\d\d$/.test(t.label))).toBe(true);
  });
});

describe('lookups', () => {
  it('finds the sample nearest an instant', () => {
    const s = analysis.series;
    expect(sampleAtTime(data.sun, s.startMs - 5 * H)!.index).toBe(0);
    expect(sampleAtTime(data.sun, s.startMs + 7 * s.stepMs + 1000)!.index).toBe(7);
    expect(sampleAtTime(data.sun, s.startMs + 7 * s.stepMs + s.stepMs * 0.6)!.index).toBe(8);
    expect(sampleAtTime(data.sun, s.startMs + 1e12)!.index).toBe(s.n - 1);
    expect(sampleAtTime([], 0)).toBeNull();
  });

  it('thins a track for drawing but keeps the moment the Sun goes down', () => {
    const kept = thin(data.sun, (p) => ({ x: p.index * 0.5, y: 0 }), 6);
    expect(kept.length).toBeLessThan(data.sun.length / 8);
    const down = data.sun.findIndex((p) => !p.up);
    expect(kept.some((p) => p.index === down)).toBe(true);
    for (let k = 1; k < kept.length; k++) {
      if (kept[k].up === kept[k - 1].up) expect(kept[k].index - kept[k - 1].index).toBeGreaterThanOrEqual(12);
    }
    // Samples the caller cannot place are left out.
    expect(thin(data.sun, () => null, 6)).toEqual([]);
  });

  it('tabulates the window at a readable step', () => {
    const { rows, stepMs } = tableRows(data, 120);
    expect(stepMs).toBe(H); // 96 h: hourly rows
    expect(rows).toHaveLength(97);
    expect(rows[0].timeMs).toBe(data.startMs);
    expect(rows[5].sun!.timeMs).toBe(data.startMs + 5 * H);
    expect(tableRows(data, 20).stepMs).toBe(6 * H);
    expect(tableRows({ ...data, sun: [], earth: [] }).rows).toEqual([]);
  });

  it('puts a sample\'s state in words', () => {
    expect(stateText({ ...data.sun[0], visible: 1 })).toBe('above the skyline');
    expect(stateText({ ...data.sun[0], visible: 0.41 })).toBe('41 % of the disc showing');
    expect(stateText({ ...data.sun[0], visible: 0 })).toBe('hidden');
    expect(stateText({ ...data.earth[0], up: true })).toBe('in line of sight');
    expect(stateText({ ...data.earth[0], up: false })).toBe('hidden');
  });
});
