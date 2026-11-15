// The decision engine's tools (decision D-17, task T-73): mission profiles and the current
// decision settings, and three queries that measure and judge candidate landing sites:
// evaluateSite, compareSites and findBestSites.
//
// Orchestration only. For every candidate a Scenario is built from the mission profile's window
// ('current' = the app's mission window) and mast height. The app's own pipeline then measures
// it: analyse() for named sites and the catalogue, rankNearby() (window metrics with its slope
// pre-filter) for the surroundings of a site. loadRegionTerrain() measures the landing region.
// The engine (src/analysis/decision/api.ts) turns those into verdicts, a utility, a ranking and
// sentences. Nothing is estimated here: a measurement that fails becomes an unknown value with
// the reason, never a crash and never a guess.
//
// Every result echoes the profile, the overrides and any safety relaxation, rounds its numbers,
// and carries UTILITY_NOTE.
import * as analysisApi from '../analysis/api';
import * as engineApi from '../analysis/decision/api';
import {
  CRITERIA,
  UTILITY_NOTE,
  type CriterionId,
  type CriterionResult,
  type MissionProfile,
  type ProfileOverrides,
  type RegionTerrain,
  type Relaxation,
  type SiteEvaluation,
  type SiteMetrics,
} from '../analysis/decision/types';
import type { NearbyProgress } from '../analysis/api';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis } from '../analysis/types';
import { findLanding, landingSite } from '../data/catalog';
import { formatCoords, type Landing } from '../data/landings';
import { loadRegionTerrain as realLoadRegionTerrain } from '../terrain/region';
import { ActionError, defineAction, type ActionDef, type ObjectSchema } from './actions';
import { ephemerisStatement } from './presetActions';
import { describeScenario, effectiveStartMs, SCENARIO_STEP_MIN, scenarioKey } from './scenario';
import type { Store } from './store';
import { isoUtc, parseUtc } from './time';
import { pinId, wrapLon, type Scenario, type SiteRef } from './types';

/** The engine's entry points (src/analysis/decision/api.ts), replaceable in tests. */
export interface DecisionEngine {
  criterionDefs: typeof engineApi.criterionDefs;
  loadMissionProfiles: typeof engineApi.loadMissionProfiles;
  resolveProfile: typeof engineApi.resolveProfile;
  siteMetrics: typeof engineApi.siteMetrics;
  evaluateMetrics: typeof engineApi.evaluateMetrics;
  rankEvaluations: typeof engineApi.rankEvaluations;
  compareEvaluations: typeof engineApi.compareEvaluations;
}

export interface DecisionContext {
  store: Store;
  landings: () => readonly Landing[];
  /** The science core; defaults to src/analysis/api.ts (cached, off the main thread). */
  analyse?: (scenario: Scenario) => Promise<SiteAnalysis>;
  rankNearby?: (scenario: Scenario, options: NearbyOptions, onProgress?: NearbyProgress) => Promise<NearbyCandidate[]>;
  /** Landing-region slope and roughness; defaults to src/terrain/region.ts. */
  loadRegionTerrain?: (site: SiteRef, radiusM: number, slopeLimitDeg: number | null) => Promise<RegionTerrain>;
  engine?: Partial<DecisionEngine>;
}

/** Most candidates one findBestSites run measures, per source. */
export const DECISION_CAPS = {
  /** {from: 'catalogue'}: the catalogue has 28 landings; more than this and the oldest are kept. */
  catalogue: 40,
  /** {from: 'sites'}: the length of the list (the schema refuses longer ones). */
  sites: 12,
  /** {from: 'nearby'}: the best scan candidates (by the scan's own sunlight and Earth score) that get a landing-region measurement. */
  nearby: 15,
} as const;

/** Largest scan around a site: rankNearby's grid grows with (radius / spacing) squared. */
const NEARBY_MAX_RADIUS_M = 10_000;
const NEARBY_MIN_SPACING_M = 50;

// ---------------------------------------------------------------- progress

/** Where a running tool is, for a status line (the "Rank sites" tab, T-74). */
export interface DecisionRun {
  running: boolean;
  /** Candidates measured so far, and how many there are (0 of 0 while a nearby scan starts). */
  done: number;
  total: number;
  /** What is being measured now, e.g. "Measuring Apollo 15 (4 of 28)" or "Scanning around IM-2 Athena (40 of 120)". */
  label: string;
}

let run: DecisionRun = { running: false, done: 0, total: 0, label: '' };
const runListeners = new Set<(r: DecisionRun) => void>();
const setRun = (r: DecisionRun) => {
  run = r;
  for (const fn of [...runListeners]) fn(r);
};

/** Progress of the decision tools now. One run at a time is reported (the latest). */
export function decisionRun(): DecisionRun {
  return run;
}

/** Calls `fn` on every progress change; returns the unsubscribe. */
export function onDecisionRun(fn: (r: DecisionRun) => void): () => void {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
}

// ---------------------------------------------------------------- parameters (strict, D-3)

const CRITERION_PARAMS = (what: string, unitFor: (c: CriterionId) => string, max: (c: CriterionId) => number) =>
  Object.fromEntries(CRITERIA.map((c) => [c, { type: 'number' as const, description: `${what} for ${c}, ${unitFor(c)}.`, minimum: 0, maximum: max(c) }]));

const UNIT: Record<CriterionId, string> = { sunlight: 'percent', darkness: 'hours', earthVisibility: 'percent', commBlackout: 'hours', slope: 'degrees', roughness: 'metres' };
const MAX_THRESHOLD: Record<CriterionId, number> = { sunlight: 100, darkness: 24 * 365, earthVisibility: 100, commBlackout: 24 * 365, slope: 89, roughness: 1000 };

const OVERRIDES_SCHEMA: ObjectSchema = {
  type: 'object',
  description:
    'Changes on top of the mission profile. Thresholds: a minimum for sunlight and earthVisibility, a maximum for the others. Tightening is always allowed; loosening a SAFETY threshold (slope, roughness) beyond the profile, or removing it, is refused unless allowSafetyRelaxation is true, and is then listed in `relaxations` on every result. Set allowSafetyRelaxation only when the user explicitly asks to relax that limit.',
  properties: {
    window: {
      type: 'object',
      description: 'Mission window: startUtc ("current" = the app\'s mission window) and durationH.',
      properties: {
        startUtc: { type: 'string', description: 'Start of the window, UTC, e.g. "2025-03-06T17:28Z", or "current".' },
        durationH: { type: 'number', description: 'Length of the window, hours.', minimum: 1, maximum: 24 * 60 },
      },
    },
    mastHeightM: { type: 'number', description: 'Observer (antenna / solar array) height above the ground, metres.', minimum: 0, maximum: 100 },
    landingRadiusM: { type: 'number', description: 'Radius of the landing region for slope and roughness, metres.', minimum: 10, maximum: 5000 },
    thresholds: { type: 'object', description: 'Thresholds per criterion.', properties: CRITERION_PARAMS('Threshold', (c) => UNIT[c], (c) => MAX_THRESHOLD[c]) },
    removeThresholds: { type: 'array', description: 'Criteria to judge without a threshold (no requirement).', items: { type: 'string', description: 'Criterion.', enum: CRITERIA } },
    weights: { type: 'object', description: 'Relative weights for the utility (normalised by the engine).', properties: CRITERION_PARAMS('Weight', () => 'no unit', () => 100) },
    allowSafetyRelaxation: { type: 'boolean', description: 'Allow loosening slope or roughness beyond the profile. Only when the user explicitly asks for it; say so in the reply.' },
  },
};

const PROFILE_ID = { type: 'string' as const, description: 'Mission profile id (listMissionProfiles). Without it, the current decision settings are used.' };

const SITE_SCHEMA = (description: string): ObjectSchema => ({
  type: 'object',
  description: `${description} Give a catalogued landing by id or name (\`landing\`), or any point by \`lat\` and \`lon\`.`,
  properties: {
    landing: { type: 'string', description: 'A catalogued landing: id or name, e.g. "apollo-11" or "IM-2".' },
    lat: { type: 'number', description: 'Latitude, degrees north-positive.', minimum: -90, maximum: 90 },
    lon: { type: 'number', description: 'Longitude, degrees east-positive.', minimum: -360, maximum: 360 },
  },
});

interface SiteParam {
  landing?: string;
  lat?: number;
  lon?: number;
}

interface OverridesParam extends Omit<ProfileOverrides, 'thresholds'> {
  thresholds?: Partial<Record<CriterionId, number>>;
  removeThresholds?: CriterionId[];
}

interface ProfileParams {
  profileId?: string;
  overrides?: OverridesParam;
}

/** The parameters' overrides as the engine takes them: removed thresholds become null. */
export function toOverrides(o: OverridesParam | undefined): ProfileOverrides {
  if (!o) return {};
  const { removeThresholds, thresholds, ...rest } = o;
  const t: Partial<Record<CriterionId, number | null>> = { ...thresholds };
  for (const c of removeThresholds ?? []) t[c] = null;
  return { ...rest, ...(Object.keys(t).length && { thresholds: t }) };
}

// ---------------------------------------------------------------- results

/** Rounds every number for a result: coordinates to 5 decimals (about 0.3 m), everything else to 3. */
export function roundDeep<T>(value: T, key = ''): T {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Number.isInteger(value)) return value;
    const digits = key === 'lat' || key === 'lon' ? 5 : 3;
    return (Math.round(value * 10 ** digits) / 10 ** digits) as T;
  }
  if (Array.isArray(value)) return value.map((v) => roundDeep(v)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundDeep(v, k)])) as T;
  return value;
}

const TIME_CRITERIA: readonly CriterionId[] = ['sunlight', 'darkness', 'earthVisibility', 'commBlackout'];
const TERRAIN_CRITERIA: readonly CriterionId[] = ['slope', 'roughness'];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------------------------------------------------------------- findBestSites in summary

/** One criterion without its basis text: what a ranking table needs. */
const criterionRow = (c: CriterionResult) => ({
  id: c.id,
  verdict: c.verdict,
  value: c.measured.value,
  unit: c.measured.unit,
  ...(c.measured.bound && { bound: c.measured.bound }),
  threshold: c.threshold,
  score: c.score,
});

/**
 * findBestSites with detail 'summary' (F-12): a language model takes at most 64,000 characters
 * per tool result, and the full evaluations repeat long basis texts per site and criterion
 * (three sites gave 74,872 characters). So the small fields come first, the basis is said once,
 * and each site carries only its rows: every criterion for the ranked sites, and for an unknown
 * or infeasible one only the criteria that decided it, with their reasons.
 */
export function summariseRanking(o: {
  profile: MissionProfile;
  overrides: ProfileOverrides;
  relaxations: Relaxation[];
  counts: unknown;
  cap: number;
  dropped: number;
  candidates: Record<string, unknown>;
  paretoFront: string[];
  ranked: { siteId: string; name: string; rank: number; utility: number; pareto: boolean }[];
  explanation: string[];
  evaluations: SiteEvaluation[];
  definitions: Partial<Record<CriterionId, string>>;
}) {
  const rankOf = new Map(o.ranked.map((x) => [x.siteId, x]));
  const window = o.evaluations[0]?.metrics.window;
  return roundDeep({
    profile: { id: o.profile.id, name: o.profile.name },
    relaxations: o.relaxations,
    overrides: o.overrides,
    counts: o.counts,
    cap: o.cap,
    dropped: o.dropped,
    candidates: o.candidates,
    utilityNote: UTILITY_NOTE,
    paretoFront: o.paretoFront,
    ranked: o.ranked,
    explanation: o.explanation,
    basis: {
      ...(window && { window }),
      mastHeightM: o.profile.mastHeightM,
      landingRadiusM: o.profile.landingRadiusM,
      criteria: o.definitions,
      perSite: 'Each site\'s data sources (elevation grid and spacing, ephemeris) are in evaluateSite, or in findBestSites with detail "full".',
    },
    sites: o.evaluations.map((e) => {
      const r = rankOf.get(e.site.id);
      return r
        ? { siteId: e.site.id, name: e.site.name, feasibility: e.feasibility, utility: e.utility, rank: r.rank, pareto: r.pareto, criteria: e.criteria.map(criterionRow) }
        : { siteId: e.site.id, name: e.site.name, feasibility: e.feasibility, deciding: e.criteria.filter((c) => c.verdict !== 'pass').map((c) => ({ ...criterionRow(c), reason: c.reason })) };
    }),
  });
}

// ---------------------------------------------------------------- the actions

export function createDecisionActions(ctx: DecisionContext): ActionDef<any, any>[] {
  const { store } = ctx;
  const state = () => store.get();
  const engine: DecisionEngine = {
    criterionDefs: engineApi.criterionDefs,
    loadMissionProfiles: engineApi.loadMissionProfiles,
    resolveProfile: engineApi.resolveProfile,
    siteMetrics: engineApi.siteMetrics,
    evaluateMetrics: engineApi.evaluateMetrics,
    rankEvaluations: engineApi.rankEvaluations,
    compareEvaluations: engineApi.compareEvaluations,
    ...ctx.engine,
  };
  const analyse = ctx.analyse ?? analysisApi.analyse;
  const rankNearby = ctx.rankNearby ?? analysisApi.rankNearby;
  const regionTerrain = ctx.loadRegionTerrain ?? realLoadRegionTerrain;

  /** The engine's own failures (e.g. a part not in this build yet) as a sentence for the caller. */
  const engineCall = <T>(what: string, fn: () => T): T => {
    try {
      return fn();
    } catch (err) {
      throw new ActionError(`The decision engine could not ${what}: ${message(err)}`);
    }
  };

  const profiles = async (): Promise<MissionProfile[]> => {
    let list: MissionProfile[];
    try {
      list = await engine.loadMissionProfiles();
    } catch (err) {
      throw new ActionError(`The mission profiles could not be read: ${message(err)}`);
    }
    if (!list.length) throw new ActionError('No mission profiles are bundled with this build.');
    return list;
  };

  const findProfile = (list: MissionProfile[], id: string): MissionProfile => {
    const p = id ? list.find((x) => x.id === id) : list[0];
    if (!p) throw new ActionError(`There is no mission profile "${id}". The profiles are: ${list.map((x) => x.id).join(', ')}.`);
    return p;
  };

  /**
   * The profile a call runs under. Without profileId and overrides: the current settings
   * (AppState.decisionProfileId and decisionOverrides). With profileId alone: that profile as it
   * is. With overrides: on top of the given profile, or of the current one.
   */
  const resolveFor = async (p: ProfileParams) => {
    const list = await profiles();
    const s = state();
    const base = findProfile(list, p.profileId ?? s.decisionProfileId);
    const overrides = p.overrides !== undefined ? toOverrides(p.overrides) : p.profileId !== undefined ? {} : s.decisionOverrides;
    const r = engineCall('apply the overrides', () => engine.resolveProfile(base, overrides));
    if (r.refused.length) throw new ActionError(`Refused: ${r.refused.join(' ')} Nothing was measured.`);
    return { profile: r.profile, base, overrides, relaxations: r.relaxations };
  };

  const echo = (r: { profile: MissionProfile; overrides: ProfileOverrides; relaxations: Relaxation[] }) => ({
    profile: roundDeep(r.profile),
    overrides: r.overrides,
    relaxations: r.relaxations,
  });

  const settingsResult = async () => {
    const list = await profiles();
    const s = state();
    const base = findProfile(list, s.decisionProfileId);
    const r = engineCall('apply the overrides', () => engine.resolveProfile(base, s.decisionOverrides));
    return {
      profileId: base.id,
      /** True while no profile was chosen: the first preset applies. */
      isDefaultProfile: s.decisionProfileId === '',
      overrides: s.decisionOverrides,
      profile: roundDeep(r.profile),
      relaxations: r.relaxations,
      ...(r.refused.length && { refused: r.refused }),
    };
  };

  const site = (p: SiteParam, what: string): SiteRef => {
    const hasPoint = p.lat !== undefined || p.lon !== undefined;
    if (p.landing !== undefined && hasPoint) throw new ActionError(`${what}: give a landing or lat and lon, not both.`);
    if (p.landing !== undefined) {
      const l = findLanding(p.landing, ctx.landings());
      if (!l) throw new ActionError(`${what}: no catalogued landing matches "${p.landing}". listSites gives the names.`);
      return landingSite(l);
    }
    if (p.lat === undefined || p.lon === undefined) throw new ActionError(`${what}: give a landing (id or name), or both lat and lon.`);
    const lon = wrapLon(p.lon);
    return { id: pinId(p.lat, lon), name: `Pin ${formatCoords(p.lat, lon)}`, kind: 'custom', lat: p.lat, lon };
  };

  const selectedSite = (): SiteRef => {
    const s = state().site;
    if (!s) throw new ActionError('No site is selected: give `site`.');
    return s;
  };

  /** The window and observer a profile asks for, as a scenario for one site. */
  const scenarioFor = (profile: MissionProfile, s: SiteRef): Scenario => {
    let startMs: number;
    if (profile.window.startUtc === 'current') startMs = effectiveStartMs(state());
    else {
      try {
        startMs = parseUtc(profile.window.startUtc);
      } catch {
        throw new ActionError(`The profile's window start "${profile.window.startUtc}" is not a UTC time.`);
      }
    }
    const base = { site: s, mastHeightM: profile.mastHeightM, startMs, durationH: profile.window.durationH, stepMin: SCENARIO_STEP_MIN };
    return { ...base, id: scenarioKey(base), label: describeScenario(base) };
  };

  const provenanceOf = (a: SiteAnalysis): string[] => {
    const e = ephemerisStatement(a);
    const layers = a.provenance.dem.map((d) => `${d.name} (${d.resolutionM} m grid) from ${Math.round(d.fromM)} to ${Math.round(d.toM)} m`);
    return [
      `${e.text}${e.note ? ` ${e.note}` : ''}`,
      ...(layers.length ? [`Terrain skyline: ${layers.join('; ')}.`] : []),
      ...(a.provenance.terrainNotes ?? []),
    ];
  };

  /** Puts a failure's reason on the values it left unmeasured. */
  const explainMissing = (m: SiteMetrics, ids: readonly CriterionId[], why: string): SiteMetrics => ({
    ...m,
    values: Object.fromEntries(CRITERIA.map((c) => [c, ids.includes(c) && m.values[c].value === null ? { ...m.values[c], missingReason: why } : m.values[c]])) as SiteMetrics['values'],
  });

  /**
   * Measures and judges one candidate. Window metrics come from the scan when given (nearby),
   * otherwise from analyse(). A failed measurement leaves its values unknown with the reason.
   */
  const evaluateOne = async (profile: MissionProfile, s: SiteRef, scan?: NearbyCandidate): Promise<SiteEvaluation> => {
    const scenario = scenarioFor(profile, s);
    let analysis: SiteAnalysis | null = null, analysisError: string | null = null;
    if (!scan) {
      try {
        analysis = await analyse(scenario);
      } catch (err) {
        analysisError = message(err);
      }
    }
    let region: RegionTerrain | null = null, regionError: string | null = null;
    try {
      region = await regionTerrain(s, profile.landingRadiusM, profile.thresholds.slope);
    } catch (err) {
      // A RangeError is a bad radius, limit or centre: the request itself, so it is refused. Anything
      // else (no grid covers the region, say) leaves slope and roughness unknown, with the reason.
      if (err instanceof RangeError) throw new ActionError(`The landing region cannot be measured as asked: ${err.message}`);
      regionError = message(err);
    }
    let metrics = engineCall('measure the site', () =>
      engine.siteMetrics({
        site: s,
        window: { startUtc: isoUtc(scenario.startMs), durationH: scenario.durationH },
        mastHeightM: scenario.mastHeightM,
        metrics: scan ? scan.metrics : analysis?.metrics ?? null,
        region,
        provenance: analysis ? provenanceOf(analysis) : [],
        ...(scan && { basisNote: scan.basis }),
      }),
    );
    if (analysisError) metrics = explainMissing(metrics, TIME_CRITERIA, `The analysis could not run for this site and window: ${analysisError}`);
    if (scan && !scan.metrics) metrics = explainMissing(metrics, TIME_CRITERIA, scan.rejected === 'no-data' ? 'The nearby scan has no elevation data here.' : 'The nearby scan did not analyse this candidate.');
    if (regionError) metrics = explainMissing(metrics, TERRAIN_CRITERIA, `The landing-region terrain could not be measured: ${regionError}`);
    return engineCall('judge the site', () => engine.evaluateMetrics(metrics, profile));
  };

  /** Runs evaluateOne over a list, one at a time (the analysis worker takes one job at a time), reporting progress. */
  const evaluateAll = async (profile: MissionProfile, items: { site: SiteRef; scan?: NearbyCandidate }[]): Promise<SiteEvaluation[]> => {
    const out: SiteEvaluation[] = [];
    try {
      for (const [i, it] of items.entries()) {
        setRun({ running: true, done: i, total: items.length, label: `Measuring ${it.site.name} (${i + 1} of ${items.length})` });
        out.push(await evaluateOne(profile, it.site, it.scan));
      }
    } finally {
      setRun({ running: false, done: out.length, total: items.length, label: '' });
    }
    return out;
  };

  return [
    defineAction<Record<string, never>, unknown>({
      name: 'listMissionProfiles',
      title: 'Mission profiles',
      description:
        'Lists the mission profiles the decision tools judge sites under: for each its window, mast height, landing-region radius, thresholds (a minimum for sunlight and Earth visibility, a maximum for the others; null = no requirement), weights and the sources of its numbers ("illustrative default" where no published requirement exists). Also the six criteria (unit, which way is better, which are safety limits) and the id of the current profile. Changes nothing.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: async () => {
        const list = await profiles();
        return {
          profiles: roundDeep(list),
          current: findProfile(list, state().decisionProfileId).id,
          criteria: engineCall('list the criteria', () => engine.criterionDefs()),
        };
      },
    }),
    defineAction<Record<string, never>, unknown>({
      name: 'getDecisionSettings',
      title: 'Decision settings',
      description:
        'The current decision settings that evaluateSite, compareSites and findBestSites use when called without a profile: the profile id, the overrides on top of it, the resulting profile, and any safety relaxation in force. Changes nothing.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: () => settingsResult(),
    }),
    defineAction<{ profileId?: string; overrides?: OverridesParam; reset?: boolean }, unknown>({
      name: 'setDecisionSettings',
      title: 'Set decision settings',
      description:
        'Chooses the mission profile and the overrides the decision tools use by default (shared with the "Rank sites" tab). `overrides` REPLACES the stored overrides (send the whole set). `profileId` alone switches to that profile and clears the overrides. `reset: true` clears the overrides and keeps the profile. A safety relaxation (loosening or removing the slope or roughness limit beyond the profile) is refused without allowSafetyRelaxation, and then nothing changes. The result is the settings after the change, as getDecisionSettings gives them.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Mission profile id (listMissionProfiles).' },
          overrides: OVERRIDES_SCHEMA,
          reset: { type: 'boolean', description: 'Clear the overrides (the profile stays).' },
        },
      },
      run: async ({ profileId, overrides, reset }) => {
        const list = await profiles();
        const s = state();
        let id = s.decisionProfileId;
        if (profileId !== undefined) {
          findProfile(list, profileId); // refuses an unknown id
          id = profileId;
        }
        // Replaced when given; cleared by a profile switch or a reset; kept otherwise.
        const next: ProfileOverrides = overrides !== undefined ? toOverrides(overrides) : profileId !== undefined || reset ? {} : s.decisionOverrides;
        const r = engineCall('apply the overrides', () => engine.resolveProfile(findProfile(list, id), next));
        if (r.refused.length) throw new ActionError(`Refused, nothing changed: ${r.refused.join(' ')}`);
        store.set({ decisionProfileId: id, decisionOverrides: next });
        return settingsResult();
      },
    }),
    defineAction<{ site?: SiteParam } & ProfileParams, unknown>({
      name: 'evaluateSite',
      title: 'Evaluate a site',
      description:
        'Measures one site for a mission profile and judges it: sunlight, longest darkness, Earth visibility and the longest spell without it (the terrain skyline included; geometry, not a link budget), and slope and roughness over the landing region. Each criterion is pass, fail or unknown against its threshold (a value that cannot be measured is unknown, with the reason, never guessed); the site is feasible only when all pass, and only then gets a utility. ' +
        'Without `site`, the selected site. Without profileId and overrides, the current decision settings. The result echoes the profile, overrides and relaxations; quote its numbers and sentences, and give UTILITY_NOTE with any utility.',
      effect: 'query',
      params: { type: 'object', properties: { site: SITE_SCHEMA('The site to evaluate (default: the selected site).'), profileId: PROFILE_ID, overrides: OVERRIDES_SCHEMA } },
      run: async ({ site: sp, profileId, overrides }) => {
        const target = sp ? site(sp, 'site') : selectedSite();
        const r = await resolveFor({ profileId, overrides });
        const [evaluation] = await evaluateAll(r.profile, [{ site: target }]);
        return { ...echo(r), evaluation: roundDeep(evaluation), utilityNote: UTILITY_NOTE };
      },
    }),
    defineAction<{ siteA: SiteParam; siteB: SiteParam } & ProfileParams, unknown>({
      name: 'compareSites',
      title: 'Compare two sites',
      description:
        'Evaluates two sites under the same mission profile (as evaluateSite) and compares them criterion by criterion: which is better on each, whether one dominates the other or each wins somewhere, and deterministic sentences, most important first. Without profileId and overrides, the current decision settings.',
      effect: 'query',
      params: {
        type: 'object',
        properties: { siteA: SITE_SCHEMA('Site A.'), siteB: SITE_SCHEMA('Site B.'), profileId: PROFILE_ID, overrides: OVERRIDES_SCHEMA },
        required: ['siteA', 'siteB'],
      },
      run: async ({ siteA, siteB, profileId, overrides }) => {
        const a = site(siteA, 'siteA'), b = site(siteB, 'siteB');
        if (a.id === b.id) throw new ActionError('siteA and siteB are the same site.');
        const r = await resolveFor({ profileId, overrides });
        const [ea, eb] = await evaluateAll(r.profile, [{ site: a }, { site: b }]);
        const comparison = engineCall('compare the sites', () => engine.compareEvaluations(ea, eb));
        return { ...echo(r), comparison: roundDeep(comparison), utilityNote: UTILITY_NOTE };
      },
    }),
    defineAction<
      { candidates: { from: 'catalogue' | 'sites' | 'nearby'; sites?: SiteParam[]; around?: SiteParam; radiusM?: number; spacingM?: number }; limit?: number; detail?: 'summary' | 'full' } & ProfileParams,
      unknown
    >({
      name: 'findBestSites',
      title: 'Find the best sites',
      description:
        'Measures and ranks candidate sites for a mission profile. Candidates: {from: "catalogue"} (every catalogued landing), {from: "sites", sites: [...]} (up to 12), or {from: "nearby", around?, radiusM, spacingM} (a grid around a site, default the selected one, from the nearby scan with its faster settings and its slope pre-filter; the best ' +
        `${DECISION_CAPS.nearby} by the scan's own score are measured fully). Only feasible sites are ranked (by utility, ties by site id), with the Pareto front; unknown and infeasible sites are listed with the criteria that decided them. ` +
        'With detail "summary" (the default) the result is compact for a reply: the small fields first (profile id and name, relaxations, counts, cap, dropped, candidates, utilityNote, paretoFront, ranked, explanation), one shared `basis`, then `sites`: every criterion\'s verdict, value, unit, bound, threshold and score for the ranked sites, and only the deciding criteria with their reasons for the unknown and infeasible ones. With detail "full" it returns the contract Ranking trimmed to the top `limit` (default 5): the resolved profile, overrides and relaxations, `ranked`, `paretoFront`, `counts`, `explanation`, and `evaluations` as full SiteEvaluations (the top `limit` feasible sites, then every unknown and infeasible one, each criterion with its verdict and reason); plus `cap` and `dropped` (candidates over the cap, not measured), `candidates` (where they came from) and UTILITY_NOTE. Without profileId and overrides, the current decision settings. Can take a minute for the catalogue.',
      effect: 'query',
      params: {
        type: 'object',
        properties: {
          candidates: {
            type: 'object',
            description: 'Where the candidates come from.',
            properties: {
              from: { type: 'string', description: 'catalogue, sites or nearby.', enum: ['catalogue', 'sites', 'nearby'] },
              sites: { type: 'array', description: 'For from: "sites": the sites.', items: SITE_SCHEMA('A candidate.'), minItems: 1, maxItems: DECISION_CAPS.sites },
              around: SITE_SCHEMA('For from: "nearby": the centre of the scan (default: the selected site).'),
              radiusM: { type: 'number', description: 'For from: "nearby": search radius, metres.', minimum: 0, maximum: NEARBY_MAX_RADIUS_M },
              spacingM: { type: 'number', description: 'For from: "nearby": spacing between candidates, metres.', minimum: NEARBY_MIN_SPACING_M, maximum: NEARBY_MAX_RADIUS_M },
            },
            required: ['from'],
          },
          limit: { type: 'integer', description: 'How many ranked sites to return (default 5).', minimum: 1, maximum: 50 },
          detail: {
            type: 'string',
            description: '"summary" (the default): compact, for a reply; per site its verdicts and values, without the basis texts. "full": every SiteEvaluation in full, with each value\'s basis (large: thousands of characters per site).',
            enum: ['summary', 'full'],
          },
          profileId: PROFILE_ID,
          overrides: OVERRIDES_SCHEMA,
        },
        required: ['candidates'],
      },
      run: async ({ candidates: c, limit = 5, detail = 'summary', profileId, overrides }) => {
        const only = (allowed: string[]) => {
          const extra = (['sites', 'around', 'radiusM', 'spacingM'] as const).filter((k) => c[k] !== undefined && !allowed.includes(k));
          if (extra.length) throw new ActionError(`candidates.${extra.join(', candidates.')} does not apply to from: "${c.from}".`);
        };
        let items: { site: SiteRef; scan?: NearbyCandidate }[] = [];
        let source: Record<string, unknown>;
        let cap: number;
        let dropped = 0;
        // Check the candidates before any measuring.
        if (c.from === 'catalogue') {
          only([]);
        } else if (c.from === 'sites') {
          only(['sites']);
          if (!c.sites) throw new ActionError('candidates.sites is required for from: "sites".');
        } else {
          only(['around', 'radiusM', 'spacingM']);
          if (c.radiusM === undefined || c.spacingM === undefined) throw new ActionError('candidates.radiusM and candidates.spacingM are required for from: "nearby".');
        }
        const r = await resolveFor({ profileId, overrides });
        if (c.from === 'catalogue') {
          const all = ctx.landings();
          const kept = all.slice(0, DECISION_CAPS.catalogue);
          items = kept.map((l) => ({ site: landingSite(l) }));
          source = { from: 'catalogue', considered: kept.length, total: all.length };
          cap = DECISION_CAPS.catalogue;
          dropped = all.length - kept.length;
        } else if (c.from === 'sites') {
          const seen = new Set<string>();
          items = c.sites!.map((sp, i) => site(sp, `candidates.sites[${i}]`)).filter((s) => !seen.has(s.id) && seen.add(s.id)).map((s) => ({ site: s }));
          source = { from: 'sites', considered: items.length };
          cap = DECISION_CAPS.sites;
        } else {
          const centre = c.around ? site(c.around, 'candidates.around') : selectedSite();
          const scenario = scenarioFor(r.profile, centre);
          const w = r.profile.weights;
          const options: NearbyOptions = {
            radiusM: c.radiusM!,
            spacingM: c.spacingM!,
            // The scan's pre-filter uses the profile's slope limit; without one it lets every slope through.
            slopeLimitDeg: r.profile.thresholds.slope ?? 90,
            weightSun: w.sunlight > 0 || w.earthVisibility > 0 ? w.sunlight : 1,
            weightEarth: w.sunlight > 0 || w.earthVisibility > 0 ? w.earthVisibility : 1,
          };
          let scan: NearbyCandidate[];
          try {
            setRun({ running: true, done: 0, total: 0, label: `Scanning around ${centre.name}` });
            scan = await rankNearby(scenario, options, (done, total) =>
              setRun({ running: true, done, total, label: `Scanning around ${centre.name} (${done} of ${total})` }),
            );
          } catch (err) {
            setRun({ running: false, done: 0, total: 0, label: '' });
            throw new ActionError(`The nearby scan around ${centre.name} could not run: ${message(err)}`);
          }
          const usable = scan.filter((x) => !x.rejected).sort((a, b) => a.rank - b.rank);
          const kept = usable.slice(0, DECISION_CAPS.nearby);
          cap = DECISION_CAPS.nearby;
          dropped = usable.length - kept.length;
          const reference = scan.find((x) => x.isReference);
          if (reference && !kept.includes(reference)) kept.push(reference);
          items = kept.map((x) => ({ site: x.site, scan: x }));
          source = {
            from: 'nearby',
            around: { id: centre.id, name: centre.name, lat: centre.lat, lon: centre.lon },
            radiusM: c.radiusM,
            spacingM: c.spacingM,
            scanned: scan.length,
            removedBySlopePrefilter: scan.filter((x) => x.rejected === 'slope').length,
            withoutData: scan.filter((x) => x.rejected === 'no-data').length,
            considered: items.length,
            prefilter: `The scan's slope pre-filter at ${options.slopeLimitDeg} deg (the profile's slope limit), on its own coarser settings: ${scan[0]?.basis ?? 'no candidates'}`,
          };
        }
        const evaluations = await evaluateAll(r.profile, items);
        const ranking = engineCall('rank the sites', () => engine.rankEvaluations(evaluations, r.profile, r.relaxations));
        const top = ranking.ranked.slice(0, limit);
        const byId = new Map(ranking.evaluations.map((e) => [e.site.id, e]));
        const shown = [
          ...top.map((t) => byId.get(t.siteId)).filter((e): e is SiteEvaluation => Boolean(e)),
          ...ranking.evaluations.filter((e) => e.feasibility === 'unknown'),
          ...ranking.evaluations.filter((e) => e.feasibility === 'infeasible'),
        ];
        if (detail === 'summary') {
          const definitions = Object.fromEntries(engineCall('list the criteria', () => engine.criterionDefs()).map((d) => [d.id, d.definition]));
          return summariseRanking({
            profile: r.profile, overrides: r.overrides, relaxations: r.relaxations, counts: ranking.counts, cap, dropped, candidates: source,
            paretoFront: ranking.paretoFront, ranked: top, explanation: ranking.explanation, evaluations: shown, definitions,
          });
        }
        return {
          ...echo(r),
          ranked: roundDeep(top),
          paretoFront: ranking.paretoFront,
          counts: ranking.counts,
          explanation: ranking.explanation,
          evaluations: roundDeep(shown),
          cap,
          dropped,
          candidates: source,
          utilityNote: UTILITY_NOTE,
        };
      },
    }),
  ];
}
