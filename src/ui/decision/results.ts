// Reading what the decision tools (T-73) return into the contract types the tab's view model
// takes (src/analysis/decision/types.ts). Results arrive as plain JSON from runAction, from the
// panel's own calls or the assistant's; anything that does not have the expected shape is
// refused here (null) rather than drawn half-way.
import type { MissionProfile, PairComparison, ProfileOverrides, Ranking, Relaxation, SiteEvaluation } from '../../analysis/decision/types';

/** The shared decision setting (AppState.decisionProfileId / decisionOverrides) as the tools resolve it. */
export interface DecisionSettings {
  /** The preset in use; '' means the first preset. */
  profileId: string;
  overrides: ProfileOverrides;
  /** The profile with the overrides applied. */
  profile: MissionProfile;
  relaxations: Relaxation[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function isProfile(v: unknown): v is MissionProfile {
  return isObj(v) && typeof v.id === 'string' && typeof v.name === 'string' && isObj(v.thresholds) && isObj(v.weights) && isObj(v.window);
}

function isEvaluation(v: unknown): v is SiteEvaluation {
  return isObj(v) && isObj(v.site) && typeof v.site.id === 'string' && Array.isArray(v.criteria) && typeof v.feasibility === 'string';
}

const listOf = <T>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
const isRelaxation = (v: unknown): v is Relaxation => isObj(v) && typeof v.criterion === 'string';
const isText = (v: unknown): v is string => typeof v === 'string';

/** listMissionProfiles: the presets, first = the default. */
export function readProfiles(r: unknown): MissionProfile[] | null {
  const list = Array.isArray(r) ? r : isObj(r) && Array.isArray(r.profiles) ? r.profiles : null;
  return list && list.length && list.every(isProfile) ? (list as MissionProfile[]) : null;
}

/** getDecisionSettings / setDecisionSettings: the current id, overrides, the resolved profile and its relaxations. */
export function readSettings(r: unknown): DecisionSettings | null {
  if (!isObj(r) || !isProfile(r.profile)) return null;
  return {
    profileId: typeof r.profileId === 'string' ? r.profileId : r.profile.id,
    overrides: isObj(r.overrides) ? (r.overrides as ProfileOverrides) : {},
    profile: r.profile,
    relaxations: listOf(r.relaxations, isRelaxation),
  };
}

/** findBestSites: the ranking, given bare or under `ranking`, with the profile and relaxations it used. */
export function readRanking(r: unknown): Ranking | null {
  if (!isObj(r)) return null;
  const x = isObj(r.ranking) ? r.ranking : r;
  const profile = isProfile(x.profile) ? x.profile : isProfile(r.profile) ? r.profile : null;
  if (!profile || !Array.isArray(x.ranked) || !isObj(x.counts)) return null;
  const ranked = (x.ranked as unknown[]).filter((s): s is Ranking['ranked'][number] => isObj(s) && typeof s.siteId === 'string' && typeof s.rank === 'number');
  const c = x.counts as Obj;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    profile,
    relaxations: listOf(x.relaxations ?? r.relaxations, isRelaxation),
    evaluations: listOf(x.evaluations, isEvaluation),
    ranked,
    paretoFront: Array.isArray(x.paretoFront) ? x.paretoFront.filter(isText) : ranked.filter((s) => s.pareto).map((s) => s.siteId),
    counts: { candidates: num(c.candidates), feasible: num(c.feasible), unknown: num(c.unknown), infeasible: num(c.infeasible) },
    explanation: listOf(x.explanation, isText),
  };
}

/** compareSites: the pair comparison, given bare or under `comparison`. */
export function readComparison(r: unknown): PairComparison | null {
  if (!isObj(r)) return null;
  const x = isObj(r.comparison) ? r.comparison : r;
  if (!isEvaluation(x.a) || !isEvaluation(x.b) || !Array.isArray(x.perCriterion) || typeof x.dominance !== 'string') return null;
  return {
    a: x.a,
    b: x.b,
    perCriterion: (x.perCriterion as unknown[]).filter((d): d is PairComparison['perCriterion'][number] => isObj(d) && typeof d.id === 'string'),
    dominance: x.dominance as PairComparison['dominance'],
    sentences: listOf(x.sentences, isText),
  };
}
