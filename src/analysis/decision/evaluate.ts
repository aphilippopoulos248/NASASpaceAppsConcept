// One candidate against a mission profile (decision D-17): a verdict per criterion, feasibility,
// and for feasible sites a weighted utility. Deterministic: the same metrics and profile always
// give the same numbers and the same sentences.

import { DEF, fmt, fmtMeasured, list, noun, thresholdText } from './criteria';
import { CRITERIA, UTILITY_NOTE, type CriterionDef, type CriterionId, type CriterionResult, type Feasibility, type MeasuredValue, type MissionProfile, type SiteEvaluation, type SiteMetrics, type Verdict } from './types';

/** Scores closer than this count as equal. */
export const EPS = 1e-9;

/**
 * pass / fail / unknown of one value against its threshold (a minimum for higher-is-better, a
 * maximum for lower-is-better; equal meets it). No threshold: pass. No value: unknown. A bound
 * decides only when it settles the question: a lower bound already over a maximum fails, a lower
 * bound under it cannot say; an upper bound under a maximum passes, over it cannot say (and the
 * mirror image for minimums).
 */
export function verdictOf(sense: CriterionDef['sense'], measured: MeasuredValue, threshold: number | null): Verdict {
  if (threshold === null) return 'pass';
  const v = measured.value;
  if (v === null) return 'unknown';
  const meets = sense === 'higher-is-better' ? v >= threshold : v <= threshold;
  if (!measured.bound) return meets ? 'pass' : 'fail';
  // The true value lies at or above a lower bound, at or below an upper bound.
  const boundOnTheGoodSide = (sense === 'higher-is-better') === (measured.bound === 'lower');
  if (boundOnTheGoodSide) return meets ? 'pass' : 'unknown';
  return meets ? 'unknown' : 'fail';
}

/**
 * score = clamp((v - worst) / (ideal - worst), 0, 1). worst is the threshold when one is set,
 * otherwise the criterion's reference worst value ('window' = the window length, hours). It does
 * not depend on the other candidates.
 */
export function scoreOf(def: CriterionDef, v: number, threshold: number | null, windowH: number): number {
  const worst = threshold ?? (def.worst === 'window' ? windowH : def.worst);
  const span = def.ideal - worst;
  if (Math.abs(span) < EPS) {
    // The threshold is the ideal itself: a value that meets it is ideal.
    return (def.sense === 'higher-is-better' ? v >= def.ideal : v <= def.ideal) ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (v - worst) / span));
}

function reasonOf(id: CriterionId, measured: MeasuredValue, threshold: number | null, verdict: Verdict): string {
  const d = DEF[id];
  const value = fmtMeasured(measured);
  const geometry = id === 'earthVisibility' || id === 'commBlackout' ? ' (geometry, not a link budget)' : '';
  if (threshold === null) {
    return measured.value === null
      ? `${d.label} not available (${measured.missingReason ?? 'not measured'}); no requirement in this profile.`
      : `${d.label} ${value}${geometry}; no requirement in this profile.`;
  }
  const limit = thresholdText(id, threshold);
  if (verdict === 'pass') return `${d.label} ${value} meets ${limit}${geometry}.`;
  if (verdict === 'fail') return `${d.label} ${value} ${d.sense === 'higher-is-better' ? 'is below' : 'exceeds'} ${limit}${geometry}.`;
  if (measured.value === null) return `${d.label} not available (${measured.missingReason ?? 'not measured'}), so it cannot be checked against ${limit}.`;
  return `${d.label} ${value} cannot be checked against ${limit}: the value is only a ${measured.bound} bound.`;
}

/** Verdicts against the profile's thresholds, the utility (feasible sites only) and the summary sentences. */
export function evaluateMetrics(metrics: SiteMetrics, profile: MissionProfile): SiteEvaluation {
  const windowH = metrics.window.durationH;
  const criteria: CriterionResult[] = CRITERIA.map((id) => {
    const def = DEF[id];
    const measured = metrics.values[id];
    const threshold = profile.thresholds[id] ?? null;
    const verdict = verdictOf(def.sense, measured, threshold);
    const score = verdict === 'unknown' || measured.value === null ? null : scoreOf(def, measured.value, threshold, windowH);
    return { id, measured, threshold, verdict, score, weight: 0, reason: reasonOf(id, measured, threshold, verdict) };
  });

  const failed = criteria.filter((c) => c.verdict === 'fail');
  const unknown = criteria.filter((c) => c.verdict === 'unknown');
  const feasibility: Feasibility = failed.length ? 'infeasible' : unknown.length ? 'unknown' : 'feasible';

  // Weights normalised over the criteria that can be scored here.
  const raw = (id: CriterionId) => Math.max(0, profile.weights[id] ?? 0);
  const total = criteria.reduce((s, c) => s + (c.score === null ? 0 : raw(c.id)), 0);
  for (const c of criteria) c.weight = c.score !== null && total > 0 ? raw(c.id) / total : 0;
  const utility = feasibility === 'feasible' && total > 0 ? criteria.reduce((s, c) => s + c.weight * (c.score ?? 0), 0) : null;

  const name = metrics.site.name;
  const summary: string[] = [];
  if (feasibility === 'feasible') summary.push(`${name}: feasible: every criterion meets the profile "${profile.name}".`);
  else if (feasibility === 'infeasible') summary.push(`${name}: infeasible: it fails ${list(failed.map((c) => noun(c.id)))}.`);
  else summary.push(`${name}: undecided: nothing fails, but ${list(unknown.map((c) => noun(c.id)))} could not be checked.`);
  for (const c of [...failed, ...unknown]) summary.push(c.reason);
  if (feasibility === 'feasible') {
    if (utility === null) summary.push('No utility: no criterion with a weight above zero could be scored here.');
    else {
      // What limits the utility: the largest weighted shortfall from the ideal.
      const shortfalls = criteria.filter((c) => c.score !== null && c.weight > 0).map((c) => ({ c, loss: c.weight * (1 - (c.score ?? 0)) }));
      const worst = shortfalls.reduce<(typeof shortfalls)[number] | null>((w, x) => (!w || x.loss > w.loss + EPS ? x : w), null);
      summary.push(
        worst && worst.loss > EPS
          ? `Utility ${utility.toFixed(2)} under the profile's weights; ${noun(worst.c.id)} limits it most (${fmtMeasured(worst.c.measured)}, score ${worst.c.score!.toFixed(2)}).`
          : `Utility ${utility.toFixed(2)} under the profile's weights: every scored criterion is at its ideal.`,
      );
      const unscored = criteria.filter((c) => c.score === null);
      if (unscored.length) summary.push(`Not in the utility: ${list(unscored.map((c) => noun(c.id)))} (not measured here, and not required by the profile).`);
      summary.push(UTILITY_NOTE);
    }
  }
  return { site: metrics.site, metrics, criteria, feasibility, utility, summary };
}

/** The threshold of a criterion as words, or "no requirement". */
export function limitText(id: CriterionId, threshold: number | null): string {
  return threshold === null ? 'no requirement' : `${DEF[id].sense === 'higher-is-better' ? 'at least' : 'at most'} ${fmt(threshold, DEF[id].unit)}`;
}
