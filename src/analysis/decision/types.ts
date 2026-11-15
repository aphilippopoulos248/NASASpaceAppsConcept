// Landing-site decision engine: shared contract (coordinator, decision D-17).
//
// Hybrid by design:
//   1. Deterministic measurements per site, from the app's own pipeline (ephemeris, terrain
//      skyline, elevation grids). Never invented: a value that cannot be measured is null,
//      with the reason, and its criterion is 'unknown'.
//   2. Hard feasibility constraints: each criterion is pass / fail / unknown against a
//      mission threshold. A site is feasible only when every criterion passes.
//   3. Among feasible sites only: a transparent weighted UTILITY in 0..1, a Pareto frontier
//      on the raw measurements, and deterministic trade-off sentences.
// Utility orders sites under the user's own weights. It is NOT a probability of success and
// must never be described as one.
//
// The language model (assistant) only fills in the structured inputs below (profile id,
// thresholds, weights, sites). It never supplies measurements, and it cannot loosen a safety
// threshold without the explicit relaxation flag, which every result then reports.

import type { SiteRef } from '../../core/types';

/** The six criteria of the MVP, each from one measured quantity. */
export type CriterionId =
  /** Time-averaged visible fraction of the solar disc over the window, percent (WindowMetrics.illuminationPct). */
  | 'sunlight'
  /** Longest continuous spell with the Sun entirely hidden, hours (WindowMetrics.longestDarknessH; lower bound when open-ended). */
  | 'darkness'
  /** Percent of the window with line of sight to Earth, terrain skyline included (Earth's centre: WindowMetrics.earthVisiblePct). */
  | 'earthVisibility'
  /** Longest continuous spell without that line of sight, hours (WindowMetrics.longestEarthGapH): the direct-to-Earth blackout. Geometry only, not a link budget. */
  | 'commBlackout'
  /** Ground slope over the landing region, degrees (RegionTerrain.slopeDeg). */
  | 'slope'
  /** Terrain roughness / hazard proxy over the landing region, metres (RegionTerrain.roughnessM). */
  | 'roughness';

export const CRITERIA: readonly CriterionId[] = ['sunlight', 'darkness', 'earthVisibility', 'commBlackout', 'slope', 'roughness'];

export type Sense = 'higher-is-better' | 'lower-is-better';

export interface CriterionDef {
  id: CriterionId;
  /** Short label for tables, e.g. "Sunlight". */
  label: string;
  unit: '%' | 'h' | 'deg' | 'm';
  sense: Sense;
  /** A safety criterion: its threshold cannot be loosened beyond the profile's value without explicit relaxation. */
  safety: boolean;
  /** The best possible value (utility 1), e.g. 100 % sunlight, 0 h darkness, 0 deg slope. */
  ideal: number;
  /** Reference worst value used for utility when no threshold is set (utility 0), e.g. 0 % or the window length. */
  worst: number | 'window';
  /** One sentence: what is measured and from which data. */
  definition: string;
}

/** Verdict of one criterion against its threshold. */
export type Verdict = 'pass' | 'fail' | 'unknown';

/** One measured quantity with what it rests on. */
export interface MeasuredValue {
  /** null when the quantity could not be measured here (never guessed). */
  value: number | null;
  unit: '%' | 'h' | 'deg' | 'm';
  /** Set when the value is only a bound, e.g. a darkness that runs past the window end is a lower bound. */
  bound?: 'lower' | 'upper';
  /** What the value rests on, in words: dataset and resolution, window, method. */
  basis: string;
  /** Why value is null. */
  missingReason?: string;
}

export type { RegionTerrain } from '../../terrain/types';

/** All measurements of one candidate for one mission profile. */
export interface SiteMetrics {
  site: SiteRef;
  /** The window and observer the time-based values are for. */
  window: { startUtc: string; durationH: number };
  mastHeightM: number;
  values: Record<CriterionId, MeasuredValue>;
  /** Where the analysis came from (ephemeris source, elevation layers), in words. */
  provenance: string[];
}

/** Thresholds per criterion: a minimum for higher-is-better, a maximum for lower-is-better; null = no requirement. */
export type Thresholds = Record<CriterionId, number | null>;
/** Non-negative weights; the engine normalises them over the criteria it can score. */
export type Weights = Record<CriterionId, number>;

/** A mission profile: the constraints and preferences one evaluation runs under. */
export interface MissionProfile {
  /** A preset id from public/data/mission-profiles.json, or 'custom'. */
  id: string;
  name: string;
  description: string;
  /** Mission window. 'current' = the app's mission window at the time of the request. */
  window: { startUtc: string | 'current'; durationH: number };
  /** Observer (antenna / solar array) height above the ground, metres. */
  mastHeightM: number;
  /** Radius of the landing region for slope and roughness, metres. */
  landingRadiusM: number;
  thresholds: Thresholds;
  weights: Weights;
  /** Where each number comes from, with sources; numbers that are not from a published requirement say "illustrative default". */
  sources: string[];
}

/** Changes a user or the assistant asks for on top of a profile. */
export interface ProfileOverrides {
  window?: Partial<MissionProfile['window']>;
  mastHeightM?: number;
  landingRadiusM?: number;
  thresholds?: Partial<Thresholds>;
  weights?: Partial<Weights>;
  /** Must be true to loosen a safety threshold beyond the base profile's value. */
  allowSafetyRelaxation?: boolean;
}

/** A safety threshold loosened on purpose; every result that used it lists it. */
export interface Relaxation {
  criterion: CriterionId;
  from: number | null;
  to: number | null;
}

/** The outcome of applying overrides: the profile to use, or why not. */
export interface ResolvedProfile {
  profile: MissionProfile;
  relaxations: Relaxation[];
  /** Non-empty when the overrides were refused (e.g. a safety relaxation without the flag); profile is then the base. */
  refused: string[];
}

export interface CriterionResult {
  id: CriterionId;
  measured: MeasuredValue;
  threshold: number | null;
  verdict: Verdict;
  /** Utility contribution 0..1 before weighting; null when unknown. */
  score: number | null;
  /** Normalised weight actually applied, 0..1. */
  weight: number;
  /** One deterministic sentence, e.g. "Sunlight 87.1 % meets the minimum of 70 %." */
  reason: string;
}

export type Feasibility = 'feasible' | 'infeasible' | 'unknown';

export interface SiteEvaluation {
  site: SiteRef;
  metrics: SiteMetrics;
  criteria: CriterionResult[];
  /** feasible: every criterion passes. infeasible: at least one fails. unknown: none fails, at least one is unknown. */
  feasibility: Feasibility;
  /** Weighted utility 0..1, only for feasible sites; null otherwise. Not a probability. */
  utility: number | null;
  /** Deterministic sentences: verdicts first, then what limits the utility. */
  summary: string[];
}

export interface RankedSite {
  siteId: string;
  name: string;
  rank: number;
  utility: number;
  /** On the Pareto frontier of the feasible sites (raw measurements, all criteria with a value). */
  pareto: boolean;
}

export interface Ranking {
  profile: MissionProfile;
  relaxations: Relaxation[];
  /** Every candidate: feasible ones by utility (ties broken by site id), then unknown, then infeasible. */
  evaluations: SiteEvaluation[];
  ranked: RankedSite[];
  /** Site ids of the feasible sites that no other feasible site beats on every criterion. */
  paretoFront: string[];
  counts: { candidates: number; feasible: number; unknown: number; infeasible: number };
  /** Deterministic sentences: why the first beats the second, which constraints removed most candidates, the utility caveat. */
  explanation: string[];
}

export interface CriterionDelta {
  id: CriterionId;
  a: number | null;
  b: number | null;
  better: 'a' | 'b' | 'tie' | 'unknown';
  /** e.g. "B has 12.4 h less longest darkness (31.0 h against 43.4 h)." */
  note: string;
}

export interface PairComparison {
  a: SiteEvaluation;
  b: SiteEvaluation;
  perCriterion: CriterionDelta[];
  /** a-dominates / b-dominates: better or equal on every known criterion and better on one; tradeoff: each wins somewhere; incomparable: too much unknown. */
  dominance: 'a-dominates' | 'b-dominates' | 'tradeoff' | 'equal' | 'incomparable';
  /** Deterministic sentences, most important first. */
  sentences: string[];
}

/** Text every result carries next to a utility. */
export const UTILITY_NOTE =
  'Utility ranks feasible sites under the chosen weights (0 to 1). It is not a probability of mission success.';
