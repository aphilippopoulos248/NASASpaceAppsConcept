// Landing-site decision engine: entry points (decision D-17).
// Contract stubs by the coordinator; @analysis replaces each body (T-71). Everything here is
// pure and deterministic except loadMissionProfiles(), which reads a bundled file once.
// Signatures are the contract: callers (actions T-73, UI T-74, assistant) code against them.

import type { SiteRef } from '../../core/types';
import type { WindowMetrics } from '../types';
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

/** Thrown by a stub that is not implemented yet. */
class NotImplemented extends Error {
  constructor(what: string) {
    super(`${what} is not part of this build yet (decision engine, T-71).`);
    this.name = 'NotImplemented';
  }
}

/** The six criteria: label, unit, sense, safety flag, ideal and reference worst values, definition. */
export function criterionDefs(): readonly CriterionDef[] {
  throw new NotImplemented('criterionDefs');
}

/** Mission profiles from public/data/mission-profiles.json, loaded once. The first is the default. */
export function loadMissionProfiles(): Promise<MissionProfile[]> {
  return Promise.reject(new NotImplemented('loadMissionProfiles'));
}

/**
 * Applies overrides to a base profile. Loosening a safety threshold (or removing it) beyond the
 * base value is refused unless overrides.allowSafetyRelaxation is true; when allowed, it is listed
 * in relaxations. Tightening is always allowed. Out-of-range values are refused with a reason.
 */
export function resolveProfile(base: MissionProfile, overrides: ProfileOverrides): ResolvedProfile {
  void base;
  void overrides;
  throw new NotImplemented('resolveProfile');
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
  void input;
  throw new NotImplemented('siteMetrics');
}

/** Verdicts against the profile's thresholds, the utility (feasible sites only) and the summary sentences. */
export function evaluateMetrics(metrics: SiteMetrics, profile: MissionProfile): SiteEvaluation {
  void metrics;
  void profile;
  throw new NotImplemented('evaluateMetrics');
}

/** Orders the evaluations, marks the Pareto frontier of the feasible ones and explains the order. */
export function rankEvaluations(evaluations: readonly SiteEvaluation[], profile: MissionProfile, relaxations: readonly Relaxation[]): Ranking {
  void evaluations;
  void profile;
  void relaxations;
  throw new NotImplemented('rankEvaluations');
}

/** Criterion-by-criterion comparison of two evaluations under the same profile, with dominance and sentences. */
export function compareEvaluations(a: SiteEvaluation, b: SiteEvaluation): PairComparison {
  void a;
  void b;
  throw new NotImplemented('compareEvaluations');
}
