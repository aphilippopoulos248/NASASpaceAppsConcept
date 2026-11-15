import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { blockageAt, nextEvents } from '../../analysis/api';
import type { SiteAnalysis } from '../../analysis/types';
import { listActions, registerActions, resetActions, runAction, toolDefinitions } from '../../core/actions';
import type { AnalysisStatus, AnalysisStore } from '../../core/analysisStore';
import type { Store } from '../../core/store';
import { isoUtc } from '../../core/time';
import type { Scenario } from '../../core/types';
import { blockageResult, createHudActions } from './hudActions';
import { hudState, onHudState, resetHudState } from './hudState';
import { testAnalysis } from './testFixture';

let analysis: SiteAnalysis;
let scenario: Scenario;
let status: AnalysisStatus;
let timeMs = 0;
const H = 3_600_000;

/** The two things the actions read: the simulated time, and the settled analysis of the current scenario. */
const ctx = {
  store: { get: () => ({ timeMs }) } as unknown as Store,
  analysis: { settled: async () => status } as unknown as AnalysisStore,
};

beforeAll(async () => {
  ({ analysis, scenario } = await testAnalysis());
});

beforeEach(() => {
  resetActions();
  resetHudState();
  registerActions(createHudActions(ctx));
  status = { state: 'ready', scenario, value: analysis };
  timeMs = scenario.startMs;
});

describe('surface HUD actions', () => {
  it('registers what the HUD ships, with schemas an LLM tool call can use, and nothing that core already owns', () => {
    const names = listActions().map((a) => a.name).sort();
    expect(names).toEqual(['dismissBlockageExplanation', 'explainBlockage', 'setChart', 'showKeyMetrics']);
    for (const tool of toolDefinitions()) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('explainBlockage returns blockageAt() for the simulated time, with units in the names, and puts it on screen', async () => {
    const seen: (string | null)[] = [];
    onHudState((s) => seen.push(s.explanation ? s.explanation.blockage.body : null));
    const r = await runAction<Record<string, unknown>>('explainBlockage', { body: 'sun' }, 'test');
    if (!r.ok) throw new Error(r.error);
    const b = blockageAt(analysis, 'sun', scenario.startMs);
    expect(r.result).toMatchObject({
      body: 'sun',
      timeUtc: isoUtc(scenario.startMs),
      blocked: false,
      bodyAzDeg: Number(b.bodyAzDeg.toFixed(2)),
      bodyElDeg: Number(b.bodyElDeg.toFixed(2)),
      skylineElDeg: Number(b.skylineElDeg.toFixed(2)),
      clearanceDeg: Number(b.clearanceDeg.toFixed(2)),
      demName: 'Synthetic ridge 60 m',
      demResolutionM: 60,
      explanation: b.explanation,
      site: 'Test pin',
      shownInHud: true,
    });
    for (const key of ['ridgeDistanceM', 'ridgeHeightM', 'ridgeLatDeg', 'ridgeLonDegEast', 'discVisiblePct', 'sunCoveredByEarthPct']) expect(r.result).toHaveProperty(key);
    // On screen: the HUD state holds the same blockage, tied to the scenario, with the site's own height.
    expect(seen).toEqual(['sun']);
    expect(hudState().explanation).toMatchObject({ scenarioId: 'test-scenario', siteElevationM: analysis.horizon.siteElevationM });
    expect(hudState().explanation!.blockage.explanation).toBe(b.explanation);
  });

  it('explains an instant given as UTC: the Sun behind the ridge after it has set early', async () => {
    const t = nextEvents(analysis, scenario.startMs).sunset!.timeMs + 30 * 60_000;
    const r = await runAction<Record<string, unknown>>('explainBlockage', { body: 'sun', utc: new Date(t).toISOString().slice(0, 19) + 'Z' }, 'test');
    if (!r.ok) throw new Error(r.error);
    expect(r.result.blocked).toBe(true);
    expect(r.result.clearanceDeg as number).toBeLessThan(0);
    // The ridge of the fixture: 600 m high, 9 to 11 km to the west.
    expect(r.result.ridgeDistanceM as number).toBeGreaterThan(8500);
    expect(r.result.ridgeDistanceM as number).toBeLessThan(11500);
    expect(r.result.ridgeHeightM as number).toBeGreaterThan(500);
    expect(r.result.explanation).toMatch(/hidden by/);
    expect(hudState().explanation!.blockage.timeMs).toBe(Math.floor(t / 1000) * 1000);
    // Earth has no "covered by Earth" figure.
    const e = await runAction<Record<string, unknown>>('explainBlockage', { body: 'earth' }, 'test');
    if (!e.ok) throw new Error(e.error);
    expect(e.result).not.toHaveProperty('sunCoveredByEarthPct');
    expect(hudState().explanation!.blockage.body).toBe('earth');
  });

  it('explainBlockage says why it cannot answer, and shows nothing then', async () => {
    const bad = await runAction('explainBlockage', { body: 'sun', utc: 'tomorrow' }, 'test');
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toMatch(/Not a UTC date/);
    status = { state: 'idle' };
    const idle = await runAction('explainBlockage', { body: 'earth' }, 'test');
    expect(!idle.ok && idle.error).toMatch(/No site is selected/);
    status = { state: 'error', scenario, error: 'no elevation tiles', notAvailable: false };
    const failed = await runAction('explainBlockage', { body: 'earth' }, 'test');
    expect(!failed.ok && failed.error).toBe('The site analysis is not available: no elevation tiles');
    expect((await runAction('explainBlockage', { body: 'moon' }, 'test')).ok).toBe(false);
    expect(hudState().explanation).toBeNull();
  });

  it('dismissBlockageExplanation removes it', async () => {
    await runAction('explainBlockage', { body: 'sun' }, 'test');
    expect(hudState().explanation).not.toBeNull();
    expect(await runAction('dismissBlockageExplanation', {}, 'test')).toEqual({ ok: true, result: { explanationShown: false } });
    expect(hudState().explanation).toBeNull();
  });

  it('setChart shows, hides, sizes and switches the chart, and reports the state it leaves', async () => {
    const run = async (params: Record<string, unknown>) => {
      const r = await runAction('setChart', params, 'test');
      if (!r.ok) throw new Error(r.error);
      return r.result;
    };
    expect(await run({ expanded: true })).toEqual({ chart: 'expanded', mode: 'skyline', table: false, azimuthRange: 'full' });
    expect(await run({ mode: 'time' })).toEqual({ chart: 'expanded', mode: 'time', table: false, azimuthRange: 'full' });
    expect(await run({ show: false })).toMatchObject({ chart: 'hidden', mode: 'time' });
    // Asking for something of a hidden chart brings it back, small.
    expect(await run({ table: true, azimuthRange: 'tracks' })).toEqual({ chart: 'compact', mode: 'time', table: true, azimuthRange: 'tracks' });
    expect(await run({ show: false })).toMatchObject({ chart: 'hidden' });
    expect(await run({ show: true })).toMatchObject({ chart: 'compact' });
    // Showing a chart that is already large leaves its size alone.
    await run({ expanded: true });
    expect(await run({ show: true })).toMatchObject({ chart: 'expanded' });
    expect(await run({ show: false, expanded: true })).toMatchObject({ chart: 'hidden' });
    const none = await runAction('setChart', {}, 'test');
    expect(!none.ok && none.error).toMatch(/at least one/);
    expect((await runAction('setChart', { mode: 'pie' }, 'test')).ok).toBe(false);
  });

  it('showKeyMetrics folds and opens the panel', async () => {
    expect(await runAction('showKeyMetrics', { open: false }, 'test')).toEqual({ ok: true, result: { keyMetricsOpen: false } });
    expect(hudState().metricsOpen).toBe(false);
    expect(await runAction('showKeyMetrics', { open: true }, 'test')).toEqual({ ok: true, result: { keyMetricsOpen: true } });
    expect((await runAction('showKeyMetrics', {}, 'test')).ok).toBe(false);
  });

  it('blockageResult leaves nothing as NaN when there is no skyline', () => {
    const b = blockageAt(analysis, 'earth', scenario.startMs + 3 * H);
    const r = blockageResult({ ...b, skylineElDeg: NaN, clearanceDeg: NaN, ridgeDistanceM: NaN, ridgeHeightM: NaN, ridge: { lat: NaN, lon: NaN }, demResolutionM: NaN, discVisibleFraction: NaN });
    expect(r).toMatchObject({ skylineElDeg: null, clearanceDeg: null, ridgeDistanceM: null, ridgeHeightM: null, ridgeLatDeg: null, ridgeLonDegEast: null, demResolutionM: null, discVisiblePct: null });
    expect(JSON.stringify(r)).not.toMatch(/NaN/);
  });
});
