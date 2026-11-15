// The decision tools (T-73) against fakes of the engine (T-71), the analysis and the region
// terrain (T-72): what the actions build, pass on, refuse and report. The engine's own rules are
// tested in src/analysis/decision; the fakes here only follow its contract.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CriterionDef,
  CriterionId,
  MeasuredValue,
  MissionProfile,
  PairComparison,
  ProfileOverrides,
  Ranking,
  RegionTerrain,
  Relaxation,
  ResolvedProfile,
  SiteEvaluation,
  SiteMetrics,
} from '../analysis/decision/types';
import { CRITERIA, UTILITY_NOTE } from '../analysis/decision/types';
import { analyse as realAnalyse } from '../analysis/api';
import * as realEngine from '../analysis/decision/api';
import { parseMissionProfiles } from '../analysis/decision/profiles';
import type { MeasurementInput } from '../analysis/decision/api';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis, WindowMetrics } from '../analysis/types';
import type { Landing } from '../data/landings';
import { getAction, listActions, registerActions, resetActions, runAction } from './actions';
import { createDecisionActions, DECISION_CAPS, decisionRun, onDecisionRun, roundDeep, sharedTail, toOverrides, type DecisionEngine, type DecisionRun } from './decisionActions';
import { effectiveStartMs } from './scenario';
import { initialState, Store } from './store';
import type { Scenario, SiteRef } from './types';

const L = (id: string, name: string, lat: number, lon: number): Landing =>
  ({ id, name, program: 'p', country: 'USA', date: '2025-03-06', time: '12:00', lat, lon, crewed: false, region: 'r', summary: 's' }) as Landing;
const LANDINGS = [L('apollo-11', 'Apollo 11', 0.67408, 23.47297), L('im-2', 'IM-2 Athena', -84.7906, 29.1957), L('luna-9', 'Luna 9', 7.08, -64.37)];

const T = (o: Partial<Record<CriterionId, number | null>>) => ({ sunlight: null, darkness: null, earthVisibility: null, commBlackout: null, slope: null, roughness: null, ...o });
const W = (o: Partial<Record<CriterionId, number>> = {}) => ({ sunlight: 1, darkness: 1, earthVisibility: 1, commBlackout: 1, slope: 1, roughness: 1, ...o });

const PROFILES: MissionProfile[] = [
  {
    id: 'polar-short', name: 'Polar lander, short stay', description: 'd', window: { startUtc: 'current', durationH: 72 }, mastHeightM: 2, landingRadiusM: 100,
    thresholds: T({ sunlight: 40, darkness: 24, slope: 10, roughness: 1 }), weights: W(), sources: ['illustrative default'],
  },
  {
    id: 'equatorial-sortie', name: 'Equatorial daylight sortie', description: 'd', window: { startUtc: '2025-03-01T00:00Z', durationH: 48 }, mastHeightM: 3, landingRadiusM: 200,
    thresholds: T({ sunlight: 90, slope: 8 }), weights: W({ sunlight: 3 }), sources: ['illustrative default'],
  },
];

const SAFETY: CriterionId[] = ['slope', 'roughness'];
const HIGHER: CriterionId[] = ['sunlight', 'earthVisibility'];

/** A fake engine that follows the contract (types.ts, api.ts) closely enough to drive the actions. */
function fakeEngine(): DecisionEngine {
  const defs: CriterionDef[] = CRITERIA.map((id) => ({ id, label: id, unit: '%', sense: HIGHER.includes(id) ? 'higher-is-better' : 'lower-is-better', safety: SAFETY.includes(id), ideal: 0, worst: 1, definition: id }));
  return {
    criterionDefs: () => defs,
    loadMissionProfiles: async () => PROFILES,
    resolveProfile: (base: MissionProfile, o: ProfileOverrides): ResolvedProfile => {
      const refused: string[] = [], relaxations: Relaxation[] = [];
      const thresholds = { ...base.thresholds };
      for (const [c, v] of Object.entries(o.thresholds ?? {}) as [CriterionId, number | null][]) {
        const from = base.thresholds[c];
        const looser = from !== null && (v === null || v > from);
        if (SAFETY.includes(c) && looser) {
          if (!o.allowSafetyRelaxation) {
            refused.push(`Loosening the ${c} limit from ${from} to ${v} needs allowSafetyRelaxation.`);
            continue;
          }
          relaxations.push({ criterion: c, from, to: v });
        }
        thresholds[c] = v;
      }
      if (refused.length) return { profile: base, relaxations: [], refused };
      return {
        profile: {
          ...base,
          ...(o.mastHeightM !== undefined && { mastHeightM: o.mastHeightM }),
          ...(o.landingRadiusM !== undefined && { landingRadiusM: o.landingRadiusM }),
          window: { ...base.window, ...o.window },
          thresholds,
          weights: { ...base.weights, ...o.weights },
          ...((o.thresholds || o.weights || o.window || o.mastHeightM !== undefined || o.landingRadiusM !== undefined) && { id: 'custom' }),
        },
        relaxations,
        refused,
      };
    },
    siteMetrics: (i: MeasurementInput): SiteMetrics => {
      const v = (value: number | null | undefined, why: string): MeasuredValue => (value === null || value === undefined ? { value: null, unit: '%', basis: 'fake', missingReason: why } : { value, unit: '%', basis: i.basisNote ?? 'fake' });
      return {
        site: i.site,
        window: i.window,
        mastHeightM: i.mastHeightM,
        values: {
          sunlight: v(i.metrics?.illuminationPct, 'no analysis'),
          darkness: v(i.metrics?.longestDarknessH, 'no analysis'),
          earthVisibility: v(i.metrics?.earthVisiblePct, 'no analysis'),
          commBlackout: v(i.metrics?.longestEarthGapH, 'no analysis'),
          slope: v(i.region?.slopeDeg, 'no region'),
          roughness: v(i.region?.roughnessM, 'no region'),
        },
        provenance: i.provenance,
      };
    },
    evaluateMetrics: (m: SiteMetrics, p: MissionProfile): SiteEvaluation => {
      const criteria = CRITERIA.map((id) => {
        const value = m.values[id].value, t = p.thresholds[id];
        const verdict = value === null ? 'unknown' : t === null ? 'pass' : (HIGHER.includes(id) ? value >= t : value <= t) ? 'pass' : 'fail';
        return { id, measured: m.values[id], threshold: t, verdict, score: value === null ? null : 0.5, weight: 1 / 6, reason: `${id} ${verdict}${value === null ? `: ${m.values[id].missingReason}` : ''}` } as SiteEvaluation['criteria'][number];
      });
      const feasibility = criteria.some((c) => c.verdict === 'fail') ? 'infeasible' : criteria.some((c) => c.verdict === 'unknown') ? 'unknown' : 'feasible';
      const sun = m.values.sunlight.value ?? 0;
      return { site: m.site, metrics: m, criteria, feasibility, utility: feasibility === 'feasible' ? sun / 100 + 0.0001234 : null, summary: [feasibility] };
    },
    rankEvaluations: (evals: readonly SiteEvaluation[], profile: MissionProfile, relaxations: readonly Relaxation[]): Ranking => {
      const feasible = evals.filter((e) => e.feasibility === 'feasible').sort((a, b) => b.utility! - a.utility! || a.site.id.localeCompare(b.site.id));
      const order = [...feasible, ...evals.filter((e) => e.feasibility === 'unknown'), ...evals.filter((e) => e.feasibility === 'infeasible')];
      return {
        profile, relaxations: [...relaxations], evaluations: order,
        ranked: feasible.map((e, i) => ({ siteId: e.site.id, name: e.site.name, rank: i + 1, utility: e.utility!, pareto: i === 0 })),
        paretoFront: feasible.slice(0, 1).map((e) => e.site.id),
        counts: { candidates: evals.length, feasible: feasible.length, unknown: order.length - feasible.length - evals.filter((e) => e.feasibility === 'infeasible').length, infeasible: evals.filter((e) => e.feasibility === 'infeasible').length },
        explanation: ['fake explanation'],
      };
    },
    compareEvaluations: (a: SiteEvaluation, b: SiteEvaluation): PairComparison => ({ a, b, perCriterion: [], dominance: (a.utility ?? 0) > (b.utility ?? 0) ? 'a-dominates' : 'tradeoff', sentences: ['fake comparison'] }),
  };
}

const metricsFor = (sun: number): WindowMetrics => ({ illuminationPct: sun, longestDarknessH: 10, darknessOpenEnded: false, earthVisiblePct: 80, longestEarthGapH: 5, earthGapOpenEnded: false }) as WindowMetrics;
const analysisFor = (s: Scenario, sun: number): SiteAnalysis =>
  ({ scenario: s, metrics: metricsFor(sun), provenance: { ephemeris: 'horizons', ephemerisNote: 'within 0.02 deg', dem: [{ name: 'LOLA 5 m', resolutionM: 5, fromM: 0, toM: 1500 }], assumptions: [], terrainNotes: ['note'] } }) as unknown as SiteAnalysis;
const regionFor = (site: SiteRef, radiusM: number, slope: number | null = 4, rough: number | null = 0.3): RegionTerrain =>
  ({ lat: site.lat, lon: site.lon, radiusM, demName: 'LOLA 5 m', gridSpacingM: 5, samples: 100, slopeDeg: slope, roughnessM: rough, notes: [] });

const SUN: Record<string, number> = { 'apollo-11': 95, 'im-2': 70, 'luna-9': 30 };

function setup(over: { analyse?: (s: Scenario) => Promise<SiteAnalysis>; region?: (s: SiteRef, r: number, l: number | null) => Promise<RegionTerrain>; nearby?: (s: Scenario, o: NearbyOptions) => Promise<NearbyCandidate[]> } = {}) {
  resetActions();
  const store = new Store(initialState(Date.UTC(2025, 2, 6, 17, 28)));
  const calls = { analyse: [] as Scenario[], region: [] as [SiteRef, number, number | null][], nearby: [] as [Scenario, NearbyOptions][] };
  registerActions(
    createDecisionActions({
      store,
      landings: () => LANDINGS,
      engine: fakeEngine(),
      analyse: async (s) => {
        calls.analyse.push(s);
        return over.analyse ? over.analyse(s) : analysisFor(s, SUN[s.site.id] ?? 60);
      },
      loadRegionTerrain: async (site, r, l) => {
        calls.region.push([site, r, l]);
        return over.region ? over.region(site, r, l) : regionFor(site, r);
      },
      rankNearby: async (s, o) => {
        calls.nearby.push([s, o]);
        return over.nearby ? over.nearby(s, o) : [];
      },
    }),
  );
  return { store, calls };
}

describe('decision tools (T-73)', () => {
  beforeEach(() => resetActions());
  afterEach(() => resetActions());

  it('registers six actions with strict schemas and says what utility is not', async () => {
    setup();
    const names = listActions().map((a) => a.name);
    expect(names).toEqual(['listMissionProfiles', 'getDecisionSettings', 'setDecisionSettings', 'evaluateSite', 'compareSites', 'findBestSites']);
    expect(getAction('setDecisionSettings')!.effect).toBe('command');
    for (const n of ['listMissionProfiles', 'getDecisionSettings', 'evaluateSite', 'compareSites', 'findBestSites']) expect(getAction(n)!.effect).toBe('query');
    // Unknown keys and out-of-range numbers are refused before anything runs (D-3).
    expect(await runAction('evaluateSite', { site: { landing: 'im-2' }, overrides: { thresholds: { glare: 3 } } })).toMatchObject({ ok: false, error: 'params.overrides.thresholds.glare is not a known parameter' });
    expect(await runAction('evaluateSite', { site: { landing: 'im-2' }, overrides: { thresholds: { sunlight: 120 } } })).toMatchObject({ ok: false, error: 'params.overrides.thresholds.sunlight must be at most 100' });
    expect(await runAction('findBestSites', { candidates: { from: 'everywhere' } })).toMatchObject({ ok: false, error: 'params.candidates.from must be one of: catalogue, sites, nearby' });
    expect(await runAction('findBestSites', { candidates: { from: 'catalogue' }, limit: 0 })).toMatchObject({ ok: false, error: 'params.limit must be at least 1' });
    expect(await runAction('findBestSites', { candidates: { from: 'sites', sites: Array(DECISION_CAPS.sites + 1).fill({ landing: 'im-2' }) } })).toMatchObject({ ok: false, error: `params.candidates.sites allows at most ${DECISION_CAPS.sites} item(s)` });
    expect(await runAction('findBestSites', { candidates: { from: 'sites' } })).toMatchObject({ ok: false, error: 'candidates.sites is required for from: "sites".' });
    expect(await runAction('findBestSites', { candidates: { from: 'catalogue', radiusM: 500 } })).toMatchObject({ ok: false, error: 'candidates.radiusM does not apply to from: "catalogue".' });
    expect(await runAction('findBestSites', { candidates: { from: 'nearby', radiusM: 500 } })).toMatchObject({ ok: false, error: 'candidates.radiusM and candidates.spacingM are required for from: "nearby".' });
    expect(await runAction('compareSites', { siteA: { landing: 'im-2' }, siteB: { landing: 'IM-2 Athena' } })).toMatchObject({ ok: false, error: 'siteA and siteB are the same site.' });
    expect(await runAction('evaluateSite', { site: { landing: 'Atlantis' } })).toMatchObject({ ok: false, error: expect.stringMatching(/^site: no catalogued landing matches "Atlantis"/) });
    expect(await runAction('evaluateSite', { site: { landing: 'im-2', lat: 1, lon: 2 } })).toMatchObject({ ok: false, error: 'site: give a landing or lat and lon, not both.' });
    expect(await runAction('evaluateSite', {})).toMatchObject({ ok: false, error: 'No site is selected: give `site`.' });
  });

  it('settings: the first profile by default; a profile, overrides, a refused safety relaxation, an allowed one listed, reset', async () => {
    const { store } = setup();
    expect(await runAction<any>('getDecisionSettings')).toMatchObject({ ok: true, result: { profileId: 'polar-short', isDefaultProfile: true, overrides: {}, relaxations: [] } });
    const list: any = await runAction('listMissionProfiles');
    expect(list.ok && list.result).toMatchObject({ current: 'polar-short', profiles: [{ id: 'polar-short' }, { id: 'equatorial-sortie' }] });
    expect(list.ok && list.result.criteria).toHaveLength(6);

    // Tightening: allowed. Overrides alone do not choose a profile: the first one still applies.
    let r: any = await runAction('setDecisionSettings', { overrides: { thresholds: { darkness: 12 } } });
    expect(r).toMatchObject({ ok: true, result: { profileId: 'polar-short', isDefaultProfile: true, overrides: { thresholds: { darkness: 12 } }, profile: { thresholds: { darkness: 12, slope: 10 } }, relaxations: [] } });
    // Overrides REPLACE the stored ones (the tab sends the whole set); a removed threshold is null.
    r = await runAction<any>('setDecisionSettings', { overrides: { weights: { sunlight: 2 }, removeThresholds: ['sunlight'] } });
    expect(r.ok && r.result.overrides).toEqual({ thresholds: { sunlight: null }, weights: { sunlight: 2 } });

    // Loosening slope without the flag: refused, and nothing changes.
    const before = JSON.stringify(store.get());
    r = await runAction<any>('setDecisionSettings', { overrides: { thresholds: { slope: 15 } } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/^Refused, nothing changed: Loosening the slope limit from 10 to 15 needs allowSafetyRelaxation\./) });
    expect(JSON.stringify(store.get())).toBe(before);
    // With it: allowed, and listed on every result.
    r = await runAction<any>('setDecisionSettings', { overrides: { thresholds: { slope: 15 }, allowSafetyRelaxation: true } });
    expect(r).toMatchObject({ ok: true, result: { relaxations: [{ criterion: 'slope', from: 10, to: 15 }] } });
    const ev: any = await runAction('evaluateSite', { site: { landing: 'im-2' } });
    expect(ev).toMatchObject({ ok: true, result: { relaxations: [{ criterion: 'slope', from: 10, to: 15 }], utilityNote: UTILITY_NOTE } });

    // profileId alone switches and clears the overrides; with overrides, those are set.
    r = await runAction<any>('setDecisionSettings', { profileId: 'equatorial-sortie' });
    expect(r).toMatchObject({ ok: true, result: { profileId: 'equatorial-sortie', isDefaultProfile: false, overrides: {}, relaxations: [] } });
    expect(store.get()).toMatchObject({ decisionProfileId: 'equatorial-sortie', decisionOverrides: {} });
    r = await runAction<any>('setDecisionSettings', { profileId: 'equatorial-sortie', overrides: { mastHeightM: 5 } });
    expect(r).toMatchObject({ ok: true, result: { profileId: 'equatorial-sortie', overrides: { mastHeightM: 5 }, profile: { mastHeightM: 5 } } });
    expect(await runAction('setDecisionSettings', { profileId: 'nope' })).toMatchObject({ ok: false, error: 'There is no mission profile "nope". The profiles are: polar-short, equatorial-sortie.' });
    // reset clears the overrides and keeps the profile.
    r = await runAction<any>('setDecisionSettings', { reset: true });
    expect(r).toMatchObject({ ok: true, result: { profileId: 'equatorial-sortie', isDefaultProfile: false, overrides: {} } });
    expect(store.get()).toMatchObject({ decisionProfileId: 'equatorial-sortie', decisionOverrides: {} });
  });

  it('evaluateSite: the scenario from the profile window ("current" = the app\'s) and mast, the region radius and slope limit; defaults from AppState', async () => {
    const { store, calls } = setup();
    store.set({ site: { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.7906, lon: 29.1957 }, delayH: 6 });
    const r: any = await runAction('evaluateSite');
    expect(r.ok).toBe(true);
    const s = calls.analyse[0];
    expect(s).toMatchObject({ site: { id: 'im-2' }, mastHeightM: 2, durationH: 72, startMs: effectiveStartMs(store.get()), stepMin: 10 });
    expect(calls.region[0]).toEqual([expect.objectContaining({ id: 'im-2' }), 100, 10]);
    expect(r.result).toMatchObject({ profile: { id: 'polar-short' }, overrides: {}, relaxations: [], evaluation: { site: { id: 'im-2' }, feasibility: 'feasible' }, utilityNote: UTILITY_NOTE });
    // Rounded: utility 0.7001234 -> 0.7; provenance sentences from the analysis.
    expect(r.result.evaluation.utility).toBe(0.7);
    expect(r.result.evaluation.metrics.provenance[0]).toMatch(/JPL Horizons table/);
    expect(r.result.evaluation.metrics.window).toEqual({ startUtc: '2025-03-06T23:28Z', durationH: 72 });

    // A profile with a fixed window, and a point given by coordinates (longitude wrapped east-positive).
    const r2: any = await runAction('evaluateSite', { site: { lat: -85.5, lon: 330.25 }, profileId: 'equatorial-sortie' });
    expect(r2.ok).toBe(true);
    expect(calls.analyse[1]).toMatchObject({ site: { id: 'pin:-85.50000,-29.75000', kind: 'custom', lon: -29.75 }, mastHeightM: 3, durationH: 48, startMs: Date.UTC(2025, 2, 1) });
    expect(calls.region[1]).toEqual([expect.objectContaining({ kind: 'custom' }), 200, 8]);
    // Overrides on the current profile change the scenario too.
    await runAction('evaluateSite', { site: { landing: 'apollo-11' }, overrides: { mastHeightM: 10, landingRadiusM: 50, window: { durationH: 24 } } });
    expect(calls.analyse[2]).toMatchObject({ mastHeightM: 10, durationH: 24 });
    expect(calls.region[2][1]).toBe(50);
  });

  it('a failed measurement is an unknown with its reason, never a crash; the engine\'s own failure is refused with a sentence', async () => {
    const { calls } = setup({
      analyse: async (s) => {
        if (s.site.id === 'luna-9') throw new Error('no elevation data here');
        return analysisFor(s, SUN[s.site.id]);
      },
      region: async (site, r) => {
        if (site.id === 'apollo-11') throw new Error('regionTerrainMetrics is not part of this build yet (decision engine, T-72).');
        return regionFor(site, r);
      },
    });
    const seen: DecisionRun[] = [];
    const off = onDecisionRun((p) => seen.push({ ...p }));
    const r: any = await runAction('findBestSites', { candidates: { from: 'catalogue' }, detail: 'full' });
    off();
    expect(r.ok).toBe(true);
    expect(calls.analyse).toHaveLength(3);
    // Progress: one step per candidate, then done.
    expect(seen.map((p) => p.label)).toEqual(['Measuring Apollo 11 (1 of 3)', 'Measuring IM-2 Athena (2 of 3)', 'Measuring Luna 9 (3 of 3)', '']);
    expect(decisionRun()).toEqual({ running: false, done: 3, total: 3, label: '' });
    expect(r.result.counts).toEqual({ candidates: 3, feasible: 1, unknown: 2, infeasible: 0 });
    expect(r.result.ranked).toEqual([{ siteId: 'im-2', name: 'IM-2 Athena', rank: 1, utility: 0.7, pareto: true }]);
    // evaluations: the ranked feasible ones, then every unknown, in full.
    expect(r.result.evaluations.map((e: any) => [e.site.id, e.feasibility])).toEqual([['im-2', 'feasible'], ['apollo-11', 'unknown'], ['luna-9', 'unknown']]);
    const reasons = (id: string) => r.result.evaluations.find((e: any) => e.site.id === id).criteria.filter((c: any) => c.verdict !== 'pass').map((c: any) => c.reason);
    expect(reasons('luna-9')[0]).toBe('sunlight unknown: The analysis could not run for this site and window: no elevation data here');
    expect(reasons('apollo-11')).toEqual([
      'slope unknown: The landing-region terrain could not be measured: regionTerrainMetrics is not part of this build yet (decision engine, T-72).',
      'roughness unknown: The landing-region terrain could not be measured: regionTerrainMetrics is not part of this build yet (decision engine, T-72).',
    ]);
    expect(r.result.evaluations[1].criteria[4].measured).toEqual({ value: null, unit: '%', basis: 'fake', missingReason: expect.stringMatching(/^The landing-region terrain could not be measured/) });

    // The engine itself failing (a stub, say) is a refusal with the reason.
    resetActions();
    const store = new Store(initialState(0));
    registerActions(createDecisionActions({ store, landings: () => LANDINGS, engine: { ...fakeEngine(), rankEvaluations: () => { throw new Error('rankEvaluations is not part of this build yet (decision engine, T-71).'); } }, analyse: async (s) => analysisFor(s, 50), loadRegionTerrain: async (s, rr) => regionFor(s, rr) }));
    expect(await runAction('findBestSites', { candidates: { from: 'sites', sites: [{ landing: 'im-2' }] } })).toEqual({
      ok: false,
      error: 'The decision engine could not rank the sites: rankEvaluations is not part of this build yet (decision engine, T-71).',
    });
  });

  it('findBestSites: feasible first by utility, infeasible ones with the criteria that decided, the top `limit`, every echo', async () => {
    setup();
    const r: any = await runAction('findBestSites', { candidates: { from: 'sites', sites: [{ landing: 'luna-9' }, { landing: 'apollo-11' }, { landing: 'im-2' }, { landing: 'Apollo 11' }] }, limit: 1, overrides: { thresholds: { sunlight: 50 } }, detail: 'full' });
    expect(r.ok).toBe(true);
    // The duplicate is measured once.
    expect(r.result).toMatchObject({ candidates: { from: 'sites', considered: 3 }, cap: DECISION_CAPS.sites, dropped: 0 });
    expect(r.result.counts).toEqual({ candidates: 3, feasible: 2, unknown: 0, infeasible: 1 });
    expect(r.result.ranked).toEqual([{ siteId: 'apollo-11', name: 'Apollo 11', rank: 1, utility: 0.95, pareto: true }]);
    // The top `limit` feasible (one), then every infeasible one; the second feasible is only counted.
    expect(r.result.evaluations.map((e: any) => [e.site.id, e.feasibility])).toEqual([['apollo-11', 'feasible'], ['luna-9', 'infeasible']]);
    expect(r.result.evaluations[1].criteria.filter((c: any) => c.verdict === 'fail').map((c: any) => c.reason)).toEqual(['sunlight fail']);
    expect(r.result).toMatchObject({ profile: { id: 'custom', thresholds: { sunlight: 50 } }, overrides: { thresholds: { sunlight: 50 } }, relaxations: [], paretoFront: ['apollo-11'], explanation: ['fake explanation'], utilityNote: UTILITY_NOTE });
    // A profile given alone runs as it is, without the current overrides.
    const r2: any = await runAction('findBestSites', { candidates: { from: 'catalogue' }, profileId: 'polar-short', detail: 'full' });
    expect(r2.ok && r2.result).toMatchObject({ profile: { id: 'polar-short' }, overrides: {}, candidates: { from: 'catalogue', considered: 3, total: 3 }, cap: DECISION_CAPS.catalogue, dropped: 0 });
  });

  it('findBestSites nearby: the scan with the profile\'s slope limit and weights, the best candidates measured, the pre-filter counted', async () => {
    const cand = (i: number, rejected: NearbyCandidate['rejected'], ref = false): NearbyCandidate =>
      ({ site: { id: `pin:${i}`, name: `Candidate ${i}`, kind: 'candidate', lat: -84.79 + i * 1e-3, lon: 29.2 }, rank: rejected ? 0 : i, rejected, isReference: ref, metrics: rejected ? null : metricsFor(60 + i), basis: 'Nearby scan: 1 deg skyline step, 30 min sampling.' }) as unknown as NearbyCandidate;
    const scan = [cand(0, null, true), ...Array.from({ length: 20 }, (_, i) => cand(i + 1, null)), cand(30, 'slope'), cand(31, 'slope'), cand(32, 'no-data')];
    const { store, calls } = setup({ nearby: async () => scan });
    store.set({ site: { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.7906, lon: 29.1957 } });
    const r: any = await runAction('findBestSites', { candidates: { from: 'nearby', radiusM: 1000, spacingM: 100 }, limit: 3, detail: 'full' });
    expect(r.ok).toBe(true);
    expect(calls.nearby[0][1]).toEqual({ radiusM: 1000, spacingM: 100, slopeLimitDeg: 10, weightSun: 1, weightEarth: 1 });
    expect(calls.nearby[0][0]).toMatchObject({ site: { id: 'im-2' }, durationH: 72, mastHeightM: 2 });
    // No full analysis for scan candidates: their window metrics come from the scan.
    expect(calls.analyse).toHaveLength(0);
    expect(calls.region).toHaveLength(DECISION_CAPS.nearby);
    expect(r.result.candidates).toMatchObject({ from: 'nearby', around: { id: 'im-2' }, scanned: 24, removedBySlopePrefilter: 2, withoutData: 1, considered: DECISION_CAPS.nearby });
    // 21 usable scan candidates, 15 measured: 6 over the cap.
    expect(r.result).toMatchObject({ cap: DECISION_CAPS.nearby, dropped: 21 - DECISION_CAPS.nearby });
    expect(r.result.candidates.prefilter).toMatch(/^The scan's slope pre-filter at 10 deg/);
    expect(r.result.ranked).toHaveLength(3);
    expect(r.result.evaluations[0].metrics.values.sunlight.basis).toBe('Nearby scan: 1 deg skyline step, 30 min sampling.');
    // Around another site, by name.
    await runAction('findBestSites', { candidates: { from: 'nearby', around: { landing: 'Apollo 11' }, radiusM: 500, spacingM: 250 } });
    expect(calls.nearby[1][0].site.id).toBe('apollo-11');
  });

  it('compareSites: both under one profile, the engine\'s comparison echoed with the note', async () => {
    const { calls } = setup();
    const pair = { siteA: { landing: 'apollo-11' }, siteB: { lat: -85, lon: 30 } };
    // Summary (the default): the sentences, deltas, verdicts and reasons; each basis once per site.
    const r: any = await runAction('compareSites', pair);
    expect(r).toMatchObject({ ok: true, result: { profile: { id: 'polar-short', name: 'Polar lander, short stay' }, comparison: { dominance: 'a-dominates', sentences: ['fake comparison'], perCriterion: [], a: { siteId: 'apollo-11', summary: ['feasible'] }, b: { siteId: 'pin:-85.00000,30.00000' } }, utilityNote: UTILITY_NOTE } });
    expect(Object.keys(r.result)).toEqual(['profile', 'relaxations', 'overrides', 'utilityNote', 'comparison', 'basis']);
    expect(r.result.comparison.a.criteria[0]).toEqual({ id: 'sunlight', verdict: 'pass', value: 95, unit: '%', threshold: 40, score: 0.5, reason: 'sunlight pass' });
    expect(r.result.comparison.a).not.toHaveProperty('metrics');
    expect(r.result.basis).toMatchObject({ window: { durationH: 72 }, mastHeightM: 2, a: { values: { sunlight: 'fake' }, provenance: [expect.stringMatching(/JPL Horizons table/), expect.any(String), 'note'] } });
    expect(calls.analyse.map((s) => s.site.id)).toEqual(['apollo-11', 'pin:-85.00000,30.00000']);
    // Full: the engine's PairComparison as it is.
    const full: any = await runAction('compareSites', { ...pair, detail: 'full' });
    expect(full).toMatchObject({ ok: true, result: { profile: { id: 'polar-short' }, comparison: { dominance: 'a-dominates', a: { site: { id: 'apollo-11' }, metrics: { values: { sunlight: { basis: 'fake' } } } } }, utilityNote: UTILITY_NOTE } });
  });

  it('findBestSites summary (the default, F-12): small fields first, one basis, per site its rows only; full is the contract Ranking', async () => {
    setup();
    const params = { candidates: { from: 'sites', sites: [{ landing: 'luna-9' }, { landing: 'apollo-11' }, { landing: 'im-2' }] }, limit: 1, overrides: { thresholds: { sunlight: 50 } } };
    const sum: any = await runAction('findBestSites', params);
    expect(sum.ok).toBe(true);
    expect(Object.keys(sum.result)).toEqual(['profile', 'relaxations', 'overrides', 'counts', 'cap', 'dropped', 'candidates', 'utilityNote', 'paretoFront', 'ranked', 'explanation', 'basis', 'sites']);
    expect(sum.result.profile).toEqual({ id: 'custom', name: 'Polar lander, short stay' });
    expect(sum.result.basis).toMatchObject({ window: { durationH: 72 }, mastHeightM: 2, landingRadiusM: 100, criteria: { sunlight: 'sunlight', roughness: 'roughness' } });
    // The ranked site: every criterion without basis text. The others: only what decided them, with the reason.
    expect(sum.result.sites).toEqual([
      { siteId: 'apollo-11', name: 'Apollo 11', feasibility: 'feasible', utility: 0.95, rank: 1, pareto: true, summary: ['feasible'], criteria: expect.any(Array) },
      { siteId: 'im-2', name: 'IM-2 Athena', feasibility: 'feasible', deciding: [] },
      { siteId: 'luna-9', name: 'Luna 9', feasibility: 'infeasible', deciding: [{ id: 'sunlight', verdict: 'fail', value: 30, unit: '%', threshold: 50, score: 0.5, reason: 'sunlight fail' }] },
    ].filter((x) => x.siteId !== 'im-2'));
    // The engine's sentences stay: each criterion's reason and the site's summary lines.
    expect(sum.result.sites[0].criteria[0]).toEqual({ id: 'sunlight', verdict: 'pass', value: 95, unit: '%', threshold: 50, score: 0.5, reason: 'sunlight pass' });
    expect(JSON.stringify(sum.result)).not.toContain('"basis":"fake"');
    // 'full' is the contract Ranking, as before.
    const full: any = await runAction('findBestSites', { ...params, detail: 'full' });
    expect(Object.keys(full.result)).toEqual(['profile', 'overrides', 'relaxations', 'ranked', 'paretoFront', 'counts', 'explanation', 'evaluations', 'cap', 'dropped', 'candidates', 'utilityNote']);
    expect(full.result.evaluations[0].metrics.values.sunlight.basis).toBe('fake');
    expect(await runAction('findBestSites', { ...params, detail: 'brief' })).toMatchObject({ ok: false, error: 'params.detail must be one of: summary, full' });
  });

  it('findBestSites summary on the whole catalogue stays under a model\'s 64,000-character tool result (real engine, realistic texts)', async () => {
    resetActions();
    const catalogue = (JSON.parse(readFileSync('public/data/landings.json', 'utf8')) as { landings: Landing[] }).landings;
    const profiles = parseMissionProfiles(JSON.parse(readFileSync('public/data/mission-profiles.json', 'utf8')));
    const longNote = (site: SiteRef) => [
      `Measured on LROC NAC DTM NAC_DTM_${site.id.toUpperCase()}_E008N0234.IMG (2.0 m), 3 m site window (3 m spacing): 3505 samples within 100 m of the centre.`,
      'Slope: 5.3°, the 95th percentile of 3480 local slopes, each measured across one 3 m grid cell; the steepest is 27.0°. The region\'s best-fit plane tilts 1.5°.',
      'Roughness: 0.67 m, the RMS height difference between the 3505 samples and the region\'s best-fit plane. It takes in relief from the 3 m scale up to the size of the region, the model\'s own height noise included.',
      '0 % of the local slopes (12 of 3480) are steeper than the 10° limit. At 3 m spacing, rocks under about 6 m across are invisible.',
    ];
    const store = new Store(initialState(Date.UTC(2025, 2, 6, 17, 28)));
    registerActions(
      createDecisionActions({
        store,
        landings: () => catalogue,
        engine: { ...realEngine, loadMissionProfiles: async () => profiles },
        analyse: async (s) => ({ ...analysisFor(s, 40 + (s.site.lat % 60)), provenance: { ephemeris: 'model', ephemerisNote: 'Validated against JPL Horizons: within 0.02 deg over 1966-2035 samples.', dem: [{ name: 'LOLA LDEM_80S_20M', resolutionM: 20, fromM: 0, toM: 1500 }, { name: 'SLDEM2015 512 ppd', resolutionM: 59, fromM: 1500, toM: 30000 }, { name: 'LOLA whole-Moon grid', resolutionM: 1895, fromM: 30000, toM: 400000 }], assumptions: [], terrainNotes: ['A 60 m site window was built from LDEM_80S_20M.', 'The skyline beyond 400 km rests on the 1.9 km grid.'] } }) as unknown as SiteAnalysis,
        loadRegionTerrain: async (site, r) => ({ ...regionFor(site, r, 4 + Math.abs(site.lat % 9), 0.3 + Math.abs(site.lon % 1.2)), demName: 'LROC NAC DTM, 3 m site window', gridSpacingM: 3, samples: 3505, notes: longNote(site) }),
      }),
    );
    const sum: any = await runAction('findBestSites', { candidates: { from: 'catalogue' } });
    expect(sum.ok, sum.error).toBe(true);
    expect(sum.result.counts.candidates).toBe(catalogue.length);
    const summaryLength = JSON.stringify(sum.result).length;
    // The model's limit is 64,000 characters: a margin of a quarter.
    expect(summaryLength).toBeLessThan(48_000);
    const full: any = await runAction('findBestSites', { candidates: { from: 'catalogue' }, detail: 'full' });
    const fullLength = JSON.stringify(full.result).length;
    expect(fullLength).toBeGreaterThan(64_000); // why the summary exists
    expect(summaryLength).toBeLessThan(fullLength / 4);
    // The small fields survive any cut: they come first.
    expect(JSON.stringify(sum.result).slice(0, 4000)).toContain('"utilityNote"');
  });

  it('helpers: overrides as the engine takes them, numbers rounded (coordinates to 5 decimals)', () => {
    expect(toOverrides({ thresholds: { slope: 8 }, removeThresholds: ['roughness'], allowSafetyRelaxation: true })).toEqual({ thresholds: { slope: 8, roughness: null }, allowSafetyRelaxation: true });
    expect(toOverrides(undefined)).toEqual({});
    const notes = 'Measured on LOLA, 60 m site window (60 m spacing): 8 samples within 100 m of the centre. Slope: 3.0°, the steepest of 8 local slopes.';
    expect(sharedTail(`Ground slope over the region. ${notes}`, `Roughness over the region. ${notes}`)).toBe(notes);
    expect(sharedTail('Slope, short. Same end.', 'Roughness, short. Same end.')).toBe(''); // not worth saying once
    expect(roundDeep({ utility: 0.123456, site: { lat: -84.7906123456, lon: 29.19571234 }, n: 3, list: [1.23456] })).toEqual({ utility: 0.123, site: { lat: -84.79061, lon: 29.19571 }, n: 3, list: [1.235] });
  });
});

// Real data: the science core on bundled terrain (no network), with the engine and the region
// terrain of this build. Runs once T-71 has replaced the engine stubs; until then it is skipped.
const engineReady = (() => {
  try {
    realEngine.criterionDefs();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!engineReady)('decision tools on real data (slow)', () => {
  it('compareSites summary for a pair with long terrain notes (Apollo 16, 3 m model; Chang\'e 4) stays under 48,000 characters', async () => {
    resetActions();
    const catalogue = (JSON.parse(readFileSync('public/data/landings.json', 'utf8')) as { landings: Landing[] }).landings;
    const profiles = parseMissionProfiles(JSON.parse(readFileSync('public/data/mission-profiles.json', 'utf8')));
    const store = new Store(initialState(Date.UTC(2025, 2, 6, 17, 28)));
    registerActions(createDecisionActions({ store, landings: () => catalogue, engine: { ...realEngine, loadMissionProfiles: async () => profiles } }));
    const pair = { siteA: { landing: 'apollo-16' }, siteB: { landing: 'change-4' } };
    const sum: any = await runAction('compareSites', pair);
    expect(sum.ok, sum.error).toBe(true);
    const full: any = await runAction('compareSites', { ...pair, detail: 'full' });
    const [s1, s2] = [JSON.stringify(sum.result).length, JSON.stringify(full.result).length];
    expect(s1).toBeLessThan(48_000);
    expect(s2).toBeGreaterThan(s1 * 2);
    // The engine's sentences and deltas are all there; the landing-region notes are said once per site.
    expect(sum.result.comparison.sentences).toEqual(full.result.comparison.sentences);
    expect(sum.result.comparison.perCriterion).toEqual(full.result.comparison.perCriterion);
    expect(sum.result.comparison.a.summary).toEqual(full.result.comparison.a.summary);
    expect(sum.result.basis.a.region).toMatch(/^Measured on LROC NAC DTM/);
    expect(sum.result.basis.a.values.slope).toMatch(/^Ground slope over the landing region of 100 m radius/);
  }, 120_000);

  it('evaluateSite at Apollo 11 quotes the analysis\' own window metrics, with their basis', async () => {
    resetActions();
    const store = new Store(initialState(Date.UTC(1969, 6, 20, 20, 17)));
    registerActions(createDecisionActions({ store, landings: () => LANDINGS }));
    const window = { startUtc: '1969-07-20T20:17Z', durationH: 24 };
    const r: any = await runAction('evaluateSite', { site: { landing: 'apollo-11' }, overrides: { window, mastHeightM: 2 } });
    expect(r.ok, r.error).toBe(true);
    const site = { id: 'apollo-11', name: 'Apollo 11', kind: 'landing' as const, lat: 0.67408, lon: 23.47297 };
    const own = await realAnalyse({ id: 'x', label: 'x', site, mastHeightM: 2, startMs: Date.UTC(1969, 6, 20, 20, 17), durationH: 24, stepMin: 10 });
    const v = r.result.evaluation.metrics.values;
    expect(v.sunlight.value).toBeCloseTo(own.metrics.illuminationPct, 2);
    expect(v.earthVisibility.value).toBeCloseTo(own.metrics.earthVisiblePct, 2);
    expect(v.sunlight.basis.length).toBeGreaterThan(0);
    expect(r.result.utilityNote).toBe(UTILITY_NOTE);
  }, 120_000);
});
