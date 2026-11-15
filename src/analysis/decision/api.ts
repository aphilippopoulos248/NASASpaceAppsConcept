// Landing-site decision engine: entry points (decision D-17).
// Signatures by the coordinator (the contract: callers in actions T-73, UI T-74 and the assistant
// code against them); bodies by @analysis (T-71), in the modules beside this file:
//   criteria.ts  the six criteria and the number formats of every sentence
//   measure.ts   siteMetrics(): analysis and region terrain into measured values
//   evaluate.ts  verdicts, feasibility, utility, summary
//   rank.ts      ranking, Pareto frontier, explanations, pairwise comparison
//   profiles.ts  presets (public/data/mission-profiles.json) and overrides
// Everything here is pure and deterministic except loadMissionProfiles(), which reads a bundled file once.

import type { SiteRef } from '../../core/types';
import type { WindowMetrics } from '../types';
import { CRITERION_DEFS } from './criteria';
import { evaluateMetrics as evaluate } from './evaluate';
import { siteMetrics as measure } from './measure';
import { loadMissionProfiles as loadProfiles, resolveProfile as resolve } from './profiles';
import { compareEvaluations as compare, rankEvaluations as rank } from './rank';
import type {
  CriterionDef,
  MissionProfile,
  PairComparison,
  ProfileOverrides,
  Ranking,
  RegionTerrain,
  Relaxation,
  ResolvedProfile,
  SiteEvaluation,
  SiteMetrics,
} from './types';

/** The six criteria: label, unit, sense, safety flag, ideal and reference worst values, definition. */
export function criterionDefs(): readonly CriterionDef[] {
  return CRITERION_DEFS;
}

/** Mission profiles from public/data/mission-profiles.json, loaded once. The first is the default. */
export function loadMissionProfiles(): Promise<MissionProfile[]> {
  return loadProfiles();
}

/**
 * Applies overrides to a base profile. Loosening a safety threshold (or removing it) beyond the
 * base value is refused unless overrides.allowSafetyRelaxation is true; when allowed, it is listed
 * in relaxations. Tightening is always allowed. Out-of-range values are refused with a reason.
 */
export function resolveProfile(base: MissionProfile, overrides: ProfileOverrides): ResolvedProfile {
  return resolve(base, overrides);
}

/** Input for siteMetrics(): what the analysis and the terrain module measured for one candidate. */
export interface MeasurementInput {
  site: SiteRef;
  window: { startUtc: string; durationH: number };
  mastHeightM: number;
  /** Window metrics from analyse() or from a nearby-scan candidate; null when no skyline could be computed. */
  metrics: WindowMetrics | null;
  region: RegionTerrain | null;
  /** Provenance sentences of the analysis (ephemeris, elevation layers). */
  provenance: string[];
  /** Extra basis text, e.g. the nearby scan's speed settings. */
  basisNote?: string;
}

/** Builds the six measured values, with bounds, basis and missing reasons. Never fills a gap with a guess. */
export function siteMetrics(input: MeasurementInput): SiteMetrics {
  return measure(input);
}

/** Verdicts against the profile's thresholds, the utility (feasible sites only) and the summary sentences. */
export function evaluateMetrics(metrics: SiteMetrics, profile: MissionProfile): SiteEvaluation {
  return evaluate(metrics, profile);
}

/** Orders the evaluations, marks the Pareto frontier of the feasible ones and explains the order. */
export function rankEvaluations(evaluations: readonly SiteEvaluation[], profile: MissionProfile, relaxations: readonly Relaxation[]): Ranking {
  return rank(evaluations, profile, relaxations);
}

/** Criterion-by-criterion comparison of two evaluations under the same profile, with dominance and sentences. */
export function compareEvaluations(a: SiteEvaluation, b: SiteEvaluation): PairComparison {
  return compare(a, b);
}
