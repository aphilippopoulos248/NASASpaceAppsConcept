// Ranking, Pareto frontier and pairwise comparison of evaluated candidates (decision D-17).
// Deterministic: sorting never depends on the input order or the locale, and every sentence is
// a template filled with the numbers of the evaluations.

import { byId, count, DEF, fmt, fmtDiff, fmtMeasured, list, noun } from './criteria';
import { EPS, limitText } from './evaluate';
import {
  CRITERIA,
  UTILITY_NOTE,
  type CriterionDelta,
  type CriterionId,
  type MeasuredValue,
  type MissionProfile,
  type PairComparison,
  type Ranking,
  type RankedSite,
  type Relaxation,
  type SiteEvaluation,
} from './types';

const EARTH_NOTE = "Earth line of sight and blackout are geometry over the terrain skyline (direct to Earth's centre), not a radio link budget.";
const NAMES_LISTED = 8;

const valueOf = (e: SiteEvaluation, id: CriterionId): MeasuredValue => e.metrics.values[id];
/** Failures or unknowns among the criteria with a threshold: the ones that decide feasibility (T-77). */
const verdictCount = (e: SiteEvaluation, v: 'fail' | 'unknown') => e.criteria.filter((c) => c.threshold !== null && c.verdict === v).length;

/** Feasible sites by utility (ties by site id), then undecided ones (fewest unknowns first), then infeasible ones (fewest failures first). */
function order(evaluations: readonly SiteEvaluation[]) {
  const feasible = evaluations.filter((e) => e.feasibility === 'feasible').sort((a, b) => {
    const d = (b.utility ?? -1) - (a.utility ?? -1);
    return Math.abs(d) > EPS ? d : byId(a.site.id, b.site.id);
  });
  const by = (v: 'fail' | 'unknown') => (a: SiteEvaluation, b: SiteEvaluation) => verdictCount(a, v) - verdictCount(b, v) || byId(a.site.id, b.site.id);
  const unknown = evaluations.filter((e) => e.feasibility === 'unknown').sort(by('unknown'));
  const infeasible = evaluations.filter((e) => e.feasibility === 'infeasible').sort(by('fail'));
  return { feasible, unknown, infeasible };
}

/**
 * 1, 0 or -1: x better than, equal to or worse than y on one criterion, on the values as measured
 * (a bound counts as its value) with a missing value the worst of all (T-77). Every criterion is a
 * total preorder, so dominance over all six is a proper preorder and a front always exists.
 */
function cmp(id: CriterionId, x: number | null, y: number | null): number {
  if (x === null || y === null) return x === y ? 0 : x === null ? -1 : 1;
  const d = DEF[id].sense === 'higher-is-better' ? x - y : y - x;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** x dominates y: at least as good on all six criteria and strictly better on one. */
function dominates(x: SiteEvaluation, y: SiteEvaluation): boolean {
  let better = false;
  for (const id of CRITERIA) {
    const c = cmp(id, valueOf(x, id).value, valueOf(y, id).value);
    if (c < 0) return false;
    if (c > 0) better = true;
  }
  return better;
}

/** Site ids of the feasible sites that no other feasible site dominates, in the given order. */
export function paretoFront(feasible: readonly SiteEvaluation[]): string[] {
  return feasible.filter((e) => !feasible.some((o) => o !== e && dominates(o, e))).map((e) => e.site.id);
}

function namesText(names: readonly string[]): string {
  return names.length <= NAMES_LISTED ? list(names) : `${names.slice(0, NAMES_LISTED).join(', ')} and ${names.length - NAMES_LISTED} more`;
}

function relaxationText(r: Relaxation): string {
  const d = DEF[r.criterion];
  const from = r.from === null ? 'none' : fmt(r.from, d.unit);
  return r.to === null ? `${noun(r.criterion)} limit removed (was ${from})` : `${noun(r.criterion)} ${d.sense === 'higher-is-better' ? 'minimum' : 'maximum'} ${from} → ${fmt(r.to, d.unit)}`;
}

/** Why the first feasible site is ahead of the second: the largest differences of weighted scores. */
function whyFirst(first: SiteEvaluation, second: SiteEvaluation): string {
  const u1 = first.utility ?? 0, u2 = second.utility ?? 0;
  if (Math.abs(u1 - u2) <= EPS) return `${first.site.name} and ${second.site.name} have the same utility (${u1.toFixed(2)}); ${first.site.name} is listed first by site id.`;
  const contribution = (e: SiteEvaluation, id: CriterionId) => {
    const c = e.criteria.find((x) => x.id === id)!;
    return c.score === null ? 0 : c.weight * c.score;
  };
  const diffs = CRITERIA.map((id) => ({ id, d: contribution(first, id) - contribution(second, id) }));
  const ahead = diffs.filter((x) => x.d > 0.0005).sort((a, b) => b.d - a.d || CRITERIA.indexOf(a.id) - CRITERIA.indexOf(b.id)).slice(0, 2);
  const behind = diffs.filter((x) => x.d < -0.0005).sort((a, b) => a.d - b.d || CRITERIA.indexOf(a.id) - CRITERIA.indexOf(b.id)).slice(0, 1);
  let text = `${first.site.name} ranks first (utility ${u1.toFixed(2)}) ahead of ${second.site.name} (${u2.toFixed(2)})`;
  if (ahead.length) text += `: its weighted scores are higher on ${list(ahead.map((x) => `${noun(x.id)} (+${x.d.toFixed(3)})`))}`;
  if (behind.length) text += `; ${second.site.name} is better on ${list(behind.map((x) => `${noun(x.id)} (${(-x.d).toFixed(3)})`))}`;
  return `${text}.`;
}

/** Orders the evaluations, marks the Pareto frontier of the feasible ones and explains the order. */
export function rankEvaluations(evaluations: readonly SiteEvaluation[], profile: MissionProfile, relaxations: readonly Relaxation[]): Ranking {
  const { feasible, unknown, infeasible } = order(evaluations);
  const front = new Set(paretoFront(feasible));
  const ranked: RankedSite[] = feasible.map((e, i) => ({ siteId: e.site.id, name: e.site.name, rank: i + 1, utility: e.utility ?? 0, pareto: front.has(e.site.id) }));
  const n = evaluations.length;

  const explanation: string[] = [];
  explanation.push(`${count(n, 'candidate')} under "${profile.name}": ${feasible.length} feasible, ${unknown.length} undecided, ${infeasible.length} infeasible.`);
  if (relaxations.length) explanation.push(`Safety limits relaxed on request: ${list(relaxations.map(relaxationText))}.`);
  if (feasible.length >= 2) explanation.push(whyFirst(feasible[0], feasible[1]));
  else if (feasible.length === 1) explanation.push(`${feasible[0].site.name} is the only feasible site (utility ${(feasible[0].utility ?? 0).toFixed(2)}).`);
  else if (n > 0) explanation.push(`No candidate meets every constraint of "${profile.name}".`);

  // Which constraints removed candidates, most first (a site that fails two counts for both); only criteria with a threshold decide.
  const tally = (v: 'fail' | 'unknown', from: readonly SiteEvaluation[]) =>
    CRITERIA.map((id) => ({ id, k: from.filter((e) => e.criteria.some((c) => c.id === id && c.threshold !== null && c.verdict === v)).length }))
      .filter((x) => x.k > 0)
      .sort((a, b) => b.k - a.k || CRITERIA.indexOf(a.id) - CRITERIA.indexOf(b.id));
  const removed = tally('fail', infeasible);
  if (removed.length) {
    explanation.push(`Constraints that removed the most candidates: ${list(removed.slice(0, 3).map((x) => `${noun(x.id)} (${limitText(x.id, profile.thresholds[x.id] ?? null)}) ${x.k} of ${n}`))}.`);
  }
  const undecided = tally('unknown', unknown);
  if (undecided.length) {
    explanation.push(`Could not be decided for ${count(unknown.length, 'candidate')}, because a value is missing or only a bound: ${list(undecided.slice(0, 3).map((x) => `${noun(x.id)} at ${x.k}`))}.`);
  }
  if (feasible.length) {
    const names = feasible.filter((e) => front.has(e.site.id)).map((e) => e.site.name);
    explanation.push(
      `${names.length} of the ${count(feasible.length, 'feasible site')} ${names.length === 1 ? 'is' : 'are'} on the Pareto frontier (no other feasible site is at least as good on every criterion and better on one): ${namesText(names)}.`,
    );
  }
  explanation.push(EARTH_NOTE);
  explanation.push(UTILITY_NOTE);

  return {
    profile,
    relaxations: [...relaxations],
    evaluations: [...feasible, ...unknown, ...infeasible],
    ranked,
    paretoFront: feasible.filter((e) => front.has(e.site.id)).map((e) => e.site.id),
    counts: { candidates: n, feasible: feasible.length, unknown: unknown.length, infeasible: infeasible.length },
    explanation,
  };
}

// ---------- two candidates ----------

/** The range a measured value allows: exact, at or above a lower bound, at or below an upper bound. */
function range(m: MeasuredValue): [number, number] | null {
  if (m.value === null) return null;
  return m.bound === 'lower' ? [m.value, Infinity] : m.bound === 'upper' ? [-Infinity, m.value] : [m.value, m.value];
}

function delta(id: CriterionId, a: SiteEvaluation, b: SiteEvaluation, nameA: string, nameB: string): CriterionDelta {
  const d = DEF[id];
  const ma = valueOf(a, id), mb = valueOf(b, id);
  const ra = range(ma), rb = range(mb);
  const out = (better: CriterionDelta['better'], note: string): CriterionDelta => ({ id, a: ma.value, b: mb.value, better, note });
  if (!ra || !rb) {
    const missing = [!ra && `${nameA} (${ma.missingReason ?? 'not measured'})`, !rb && `${nameB} (${mb.missingReason ?? 'not measured'})`].filter(Boolean) as string[];
    return out('unknown', `${d.label} cannot be compared: not available for ${list(missing)}.`);
  }
  const higher = d.sense === 'higher-is-better';
  // a is better when its whole range is on the better side of b's.
  const aBetter = higher ? ra[0] > rb[1] : ra[1] < rb[0];
  const bBetter = higher ? rb[0] > ra[1] : rb[1] < ra[0];
  const exact = !ma.bound && !mb.bound;
  // Exact values are equal only when they are equal (as the dominance reads them); a difference the
  // usual precision would hide is written with more digits.
  let extra = 0;
  if (exact) while (extra < 6 && ma.value !== mb.value && fmt(ma.value!, d.unit, extra) === fmt(mb.value!, d.unit, extra)) extra++;
  if (exact && ma.value === mb.value) return out('tie', `Equal ${noun(id)}: ${fmt(ma.value!, d.unit)} and ${fmt(mb.value!, d.unit)}.`);
  if (!aBetter && !bBetter) return out('unknown', `${d.label} cannot be compared: ${nameA} ${fmtMeasured(ma)} against ${nameB} ${fmtMeasured(mb)} (a bound does not settle it).`);
  const [w, mw, ml] = aBetter ? [nameA, ma, mb] : [nameB, mb, ma];
  const more = higher ? 'more' : 'less';
  const amount = exact ? `${fmtDiff(mw.value! - ml.value!, d.unit, extra)} ` : '';
  return out(aBetter ? 'a' : 'b', `${w} has ${amount}${more} ${noun(id)} (${fmtMeasured(mw, extra)} against ${fmtMeasured(ml, extra)}).`);
}

/** Criterion-by-criterion comparison of two evaluations under the same profile, with dominance and sentences. */
export function compareEvaluations(a: SiteEvaluation, b: SiteEvaluation): PairComparison {
  const distinct = a.site.name !== b.site.name;
  const nameA = distinct ? a.site.name : 'A', nameB = distinct ? b.site.name : 'B';
  const perCriterion = CRITERIA.map((id) => delta(id, a, b, nameA, nameB));
  const unknown = perCriterion.filter((x) => x.better === 'unknown');

  // Dominance reads the values as the Pareto frontier does (T-77): a missing value is the worst, a bound counts as its value.
  const side = CRITERIA.map((id) => ({ id, c: cmp(id, valueOf(a, id).value, valueOf(b, id).value) }));
  const winsA = side.filter((x) => x.c > 0).map((x) => x.id), winsB = side.filter((x) => x.c < 0).map((x) => x.id);
  const dominance: PairComparison['dominance'] = winsA.length && winsB.length ? 'tradeoff' : winsA.length ? 'a-dominates' : winsB.length ? 'b-dominates' : 'equal';
  const rule = unknown.length ? ', reading a missing value as the worst and a bound as its value' : '';

  const labels = (ids: readonly CriterionId[]) => list(ids.map(noun));
  const sentences: string[] = [];
  switch (dominance) {
    case 'a-dominates': sentences.push(`${nameA} dominates ${nameB}${rule}: at least as good on every criterion and better on ${labels(winsA)}.`); break;
    case 'b-dominates': sentences.push(`${nameB} dominates ${nameA}${rule}: at least as good on every criterion and better on ${labels(winsB)}.`); break;
    case 'tradeoff': sentences.push(`Trade-off${rule}: ${nameA} is better on ${labels(winsA)}; ${nameB} is better on ${labels(winsB)}.`); break;
    default: sentences.push(`${nameA} and ${nameB} are equal on every criterion${rule}.`);
  }
  if (unknown.length) sentences.push(`Not comparable as measured: ${labels(unknown.map((x) => x.id))}.`);

  // The differences, most important first: the weighted score gap, then the criterion order.
  const weight = (id: CriterionId) => {
    const ca = a.criteria.find((c) => c.id === id)!, cb = b.criteria.find((c) => c.id === id)!;
    const gap = ca.score !== null && cb.score !== null ? Math.abs(ca.score - cb.score) : 0;
    return ((ca.weight + cb.weight) / 2) * gap;
  };
  const decided = perCriterion.filter((x) => x.better === 'a' || x.better === 'b').sort((x, y) => weight(y.id) - weight(x.id) || CRITERIA.indexOf(x.id) - CRITERIA.indexOf(y.id));
  for (const x of decided) sentences.push(x.note);
  for (const x of unknown) sentences.push(x.note);

  if (a.feasibility !== b.feasibility || a.feasibility !== 'feasible') {
    const state = (e: SiteEvaluation, name: string) => {
      const failed = e.criteria.filter((c) => c.verdict === 'fail').map((c) => noun(c.id));
      const open = e.criteria.filter((c) => c.verdict === 'unknown').map((c) => noun(c.id));
      return e.feasibility === 'infeasible' ? `${name} is infeasible (fails ${list(failed)})` : e.feasibility === 'unknown' ? `${name} is undecided (${list(open)} could not be checked)` : `${name} is feasible`;
    };
    sentences.push(`${state(a, nameA)}; ${state(b, nameB)}.`);
  }
  if (a.utility !== null && b.utility !== null) {
    sentences.push(`Under the profile's weights ${nameA} has utility ${a.utility.toFixed(2)} and ${nameB} ${b.utility.toFixed(2)}.`);
    sentences.push(UTILITY_NOTE);
  }
  if (perCriterion.some((x) => (x.id === 'earthVisibility' || x.id === 'commBlackout') && x.better !== 'tie')) sentences.push(EARTH_NOTE);
  return { a, b, perCriterion, dominance, sentences };
}
