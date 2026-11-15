// The "Rank sites" tab as plain data (decision engine, D-17): the requirement fields of a mission
// profile, what an edit sends to setDecisionSettings (and when a safety limit needs a
// confirmation first), the rows of a ranking with one badge per criterion, and a pair compared.
//
// Pure and DOM-free, so it is tested in node. Nothing here measures or scores a site: every
// value, verdict, reason, utility and sentence is the decision tools' own (T-73 over the engine
// of T-71). This module only orders, groups and words what they returned.
import { criterionDefs } from '../../analysis/decision/api';
import {
  CRITERIA,
  UTILITY_NOTE,
  type CriterionDef,
  type CriterionId,
  type CriterionResult,
  type MeasuredValue,
  type MissionProfile,
  type PairComparison,
  type ProfileOverrides,
  type RankedSite,
  type Ranking,
  type Relaxation,
  type SiteEvaluation,
  type Verdict,
} from '../../analysis/decision/types';
import type { ObjectSchema } from '../../core/actions';
import { spanText } from '../../core/scenario';
import type { Scenario, SiteRef } from '../../core/types';
import { degText, hoursText, pctText } from '../compare/format';

// ---------- the criteria ----------

/** What the tab needs to know about a criterion to draw its field and its column. */
export type CriterionUi = Pick<CriterionDef, 'id' | 'label' | 'unit' | 'sense' | 'safety'> & { definition?: string };

/** The six criteria as docs/lunyx/DECISION-ENGINE.md section 1 lists them, for a build whose engine is not there yet. */
const FALLBACK: readonly CriterionUi[] = [
  { id: 'sunlight', label: 'Sunlight', unit: '%', sense: 'higher-is-better', safety: false },
  { id: 'darkness', label: 'Longest darkness', unit: 'h', sense: 'lower-is-better', safety: false },
  { id: 'earthVisibility', label: 'Earth line of sight', unit: '%', sense: 'higher-is-better', safety: false },
  { id: 'commBlackout', label: 'Longest blackout', unit: 'h', sense: 'lower-is-better', safety: false },
  { id: 'slope', label: 'Slope', unit: 'deg', sense: 'lower-is-better', safety: true },
  { id: 'roughness', label: 'Roughness', unit: 'm', sense: 'lower-is-better', safety: true },
];

/** The criteria in their fixed order: the engine's own definitions (criterionDefs), or the design note's list without it. */
export function criteriaUi(defs: () => readonly CriterionDef[] = criterionDefs): CriterionUi[] {
  let given: readonly CriterionDef[] = [];
  try {
    given = defs();
  } catch {
    given = [];
  }
  return CRITERIA.map((id) => {
    const d = given.find((g) => g.id === id);
    return d ? { id, label: d.label, unit: d.unit, sense: d.sense, safety: d.safety, definition: d.definition } : FALLBACK.find((f) => f.id === id)!;
  });
}

const defOf = (defs: readonly CriterionUi[], id: CriterionId) => defs.find((d) => d.id === id) ?? FALLBACK.find((f) => f.id === id)!;

/** The criterion inside a sentence: "slope", "longest darkness", but "Earth line of sight" (as the engine writes it). */
export const noun = (def: Pick<CriterionUi, 'label'>) => (/^Earth\b/.test(def.label) ? def.label : def.label.charAt(0).toLowerCase() + def.label.slice(1));

// ---------- numbers in words ----------

const MINUS = '−';
const plain = (v: number, digits: number) => String(Number(v.toFixed(digits))).replace('-', MINUS);

/** A threshold as typed: "70 %", "50 h", "8°", "0.5 m" (no rounding to a display precision). */
export function limitText(v: number, unit: CriterionUi['unit']): string {
  const n = plain(v, 3);
  return unit === 'deg' ? `${n}°` : `${n} ${unit}`;
}

/**
 * A measured value: "87.1 %", "43.4 h", "2.5°", "0.42 m"; "unknown" without one. Long spells also
 * in days ("379.8 h (15.8 d)"), except `compact` (the badges of the ranked table).
 */
export function valueText(v: number | null, unit: MeasuredValue['unit'], compact = false): string {
  if (v === null || !Number.isFinite(v)) return 'unknown';
  if (unit === '%') return pctText(v);
  if (unit === 'h') return compact && Math.abs(v) >= 0.05 ? `${v.toFixed(1).replace('-', MINUS)} h` : hoursText(v);
  if (unit === 'deg') return degText(v);
  return `${v.toFixed(Math.abs(v) < 10 ? 2 : 1).replace('-', MINUS)} m`;
}

/** A measured value with its bound: "≥ 43.4 h" when the true value can only be larger (a spell that runs past the window end). */
export function measuredText(m: Pick<MeasuredValue, 'value' | 'unit' | 'bound'>, compact = false): string {
  const text = valueText(m.value, m.unit, compact);
  if (m.value === null || !m.bound) return text;
  return `${m.bound === 'lower' ? '≥' : '≤'} ${text}`;
}

/** "at least" for a minimum (higher is better), "at most" for a maximum. */
export const direction = (def: Pick<CriterionUi, 'sense'>) => (def.sense === 'higher-is-better' ? 'at least' : 'at most');
const symbol = (def: Pick<CriterionUi, 'sense'>) => (def.sense === 'higher-is-better' ? '≥' : '≤');

/** The requirement in a column head: "≥ 70 %", "≤ 8°", or "no limit". */
export function limitShort(def: CriterionUi, threshold: number | null): string {
  return threshold === null ? 'no limit' : `${symbol(def)} ${limitText(threshold, def.unit)}`;
}

/** Utility on its 0..1 scale, to two decimals. */
export const utilityText = (u: number | null) => (u === null || !Number.isFinite(u) ? '—' : u.toFixed(2));

const pct0 = (share: number) => `${Math.round(share * 100)} %`;

// ---------- thresholds, weights and the safety confirmation ----------

/** How a threshold compares with the profile's own value: a minimum raised or a maximum lowered is tighter; removing one is looser. */
export function thresholdChange(def: Pick<CriterionUi, 'sense'>, base: number | null, next: number | null): 'same' | 'tighter' | 'looser' {
  if (next === base) return 'same';
  if (next === null) return 'looser';
  if (base === null) return 'tighter';
  return (def.sense === 'lower-is-better' ? next < base : next > base) ? 'tighter' : 'looser';
}

/** The question asked before a safety limit is loosened beyond the profile's value. */
export interface RelaxationPrompt {
  criterion: CriterionId;
  from: number | null;
  to: number | null;
  text: string;
  confirm: string;
  cancel: string;
}

/** The effective threshold under the overrides: the override when there is one (null = removed), else the profile's. */
export function effectiveThreshold(base: MissionProfile, overrides: ProfileOverrides, id: CriterionId): number | null {
  const o = overrides.thresholds;
  return o && o[id] !== undefined ? (o[id] as number | null) : base.thresholds[id];
}

export function relaxationPrompt(def: CriterionUi, base: number | null, next: number | null): RelaxationPrompt | null {
  if (!def.safety || thresholdChange(def, base, next) !== 'looser') return null;
  const name = noun(def);
  const was = base === null ? 'no limit' : `${direction(def)} ${limitText(base, def.unit)}`;
  const text =
    next === null
      ? `${def.label} is a safety limit. Removing it drops the profile's requirement (${was}). Every ranking made with it will list the relaxation.`
      : `${def.label} is a safety limit. The profile asks for ${was}; ${direction(def)} ${limitText(next, def.unit)} is looser. Every ranking made with it will list the relaxation.`;
  return {
    criterion: def.id,
    from: base,
    to: next,
    text,
    confirm: next === null ? `Remove the ${name} limit` : `Relax ${name} to ${limitText(next, def.unit)}`,
    cancel: base === null ? 'Keep no limit' : `Keep ${limitText(base, def.unit)}`,
  };
}

/** What an edit asks the tools for: nothing, the new overrides, or the new overrides once a safety relaxation is confirmed. */
export type EditOutcome =
  | { kind: 'none' }
  | { kind: 'apply'; overrides: ProfileOverrides }
  | { kind: 'confirm'; overrides: ProfileOverrides; prompt: RelaxationPrompt };

/** Keeps allowSafetyRelaxation exactly while some safety limit in the overrides is looser than the profile's. */
function settleRelaxationFlag(defs: readonly CriterionUi[], base: MissionProfile, o: ProfileOverrides): ProfileOverrides {
  const relaxed = defs.some((d) => d.safety && thresholdChange(d, base.thresholds[d.id], effectiveThreshold(base, o, d.id)) === 'looser');
  const next = { ...o };
  if (relaxed) next.allowSafetyRelaxation = true;
  else delete next.allowSafetyRelaxation;
  return next;
}

/**
 * The overrides after one threshold is typed (null = no requirement). A value equal to the
 * profile's drops the override. Loosening a safety limit beyond the profile's value, and beyond
 * what is in force now, needs a confirmation; the overrides then carry allowSafetyRelaxation.
 */
export function thresholdEdit(defs: readonly CriterionUi[], base: MissionProfile, current: ProfileOverrides, id: CriterionId, value: number | null): EditOutcome {
  const def = defOf(defs, id);
  const now = effectiveThreshold(base, current, id);
  if (value === now) return { kind: 'none' };
  const thresholds = { ...current.thresholds };
  if (value === base.thresholds[id]) delete thresholds[id];
  else thresholds[id] = value;
  const draft: ProfileOverrides = { ...current, thresholds };
  if (!Object.keys(thresholds).length) delete draft.thresholds;
  const overrides = settleRelaxationFlag(defs, base, draft);
  const prompt = relaxationPrompt(def, base.thresholds[id], value);
  // Already relaxed this far or further (confirmed before): going part of the way back needs no new confirmation.
  if (prompt && thresholdChange(def, now, value) === 'looser') return { kind: 'confirm', overrides, prompt };
  return { kind: 'apply', overrides };
}

/** The overrides after one weight is typed. A weight equal to the profile's drops the override. */
export function weightEdit(base: MissionProfile, current: ProfileOverrides, id: CriterionId, weight: number): EditOutcome {
  const now = current.weights?.[id] ?? base.weights[id];
  if (weight === now) return { kind: 'none' };
  const weights = { ...current.weights };
  if (weight === base.weights[id]) delete weights[id];
  else weights[id] = weight;
  const overrides: ProfileOverrides = { ...current, weights };
  if (!Object.keys(weights).length) delete overrides.weights;
  return { kind: 'apply', overrides };
}

/** Each weight's share of the total, 0..1 (all 0 when every weight is 0). */
export function weightShares(weights: Readonly<Record<CriterionId, number>>): Record<CriterionId, number> {
  const total = CRITERIA.reduce((s, id) => s + Math.max(0, weights[id] ?? 0), 0);
  return Object.fromEntries(CRITERIA.map((id) => [id, total > 0 ? Math.max(0, weights[id] ?? 0) / total : 0])) as Record<CriterionId, number>;
}

/** One requirement field: the threshold and weight in force, the profile's own, and whether a safety limit is relaxed. */
export interface RequirementView {
  def: CriterionUi;
  threshold: number | null;
  baseThreshold: number | null;
  weight: number;
  baseWeight: number;
  /** Share of the total weight, 0..1. */
  share: number;
  /** The threshold or the weight differs from the profile's. */
  changed: boolean;
  relaxed: Relaxation | null;
  /** "Relaxed from ≤ 10°", for the badge; null when not relaxed. */
  relaxedText: string | null;
}

export function requirementViews(defs: readonly CriterionUi[], resolved: MissionProfile, base: MissionProfile | null, relaxations: readonly Relaxation[]): RequirementView[] {
  const shares = weightShares(resolved.weights);
  return defs.map((def) => {
    const baseThreshold = base ? base.thresholds[def.id] : resolved.thresholds[def.id];
    const baseWeight = base ? base.weights[def.id] : resolved.weights[def.id];
    const relaxed = relaxations.find((r) => r.criterion === def.id) ?? null;
    return {
      def,
      threshold: resolved.thresholds[def.id],
      baseThreshold,
      weight: resolved.weights[def.id],
      baseWeight,
      share: shares[def.id],
      changed: resolved.thresholds[def.id] !== baseThreshold || resolved.weights[def.id] !== baseWeight,
      relaxed,
      relaxedText: relaxed ? `Relaxed from ${relaxed.from === null ? 'no limit' : limitShort(def, relaxed.from)}` : null,
    };
  });
}

/** One sentence per relaxed safety limit, for every result that used it. */
export function relaxationSentences(defs: readonly CriterionUi[], relaxations: readonly Relaxation[]): string[] {
  return relaxations.map((r) => {
    const def = defOf(defs, r.criterion);
    const from = r.from === null ? 'no limit' : `${direction(def)} ${limitText(r.from, def.unit)}`;
    return r.to === null
      ? `Safety limit removed: ${noun(def)} (the profile asks for ${from}).`
      : `Safety limit relaxed: ${noun(def)} ${direction(def)} ${limitText(r.to, def.unit)} instead of ${from}.`;
  });
}

// ---------- the ranking ----------

export type Section = 'ranked' | 'unknown' | 'infeasible';

/** One criterion of one site: the verdict as a mark and a word, the value, and the engine's reason. */
export interface Badge {
  id: CriterionId;
  label: string;
  verdict: Verdict;
  /** ✓ pass, ✗ fail, ? unknown: a shape as well as a colour. */
  mark: string;
  value: string;
  /** The engine's sentence, then why a value is missing when it says so separately. */
  reason: string;
  /** "Score 0.62, weight 25 %": what the criterion adds to the utility, for a feasible site. */
  scoreText: string | null;
  /** The profile sets a threshold for it, so it can decide feasibility (T-77: one without a threshold never does). */
  thresholded: boolean;
}

const MARK: Record<Verdict, string> = { pass: '✓', fail: '✗', unknown: '?' };

export function badgeOf(defs: readonly CriterionUi[], c: CriterionResult): Badge {
  const def = defOf(defs, c.id);
  const missing = c.measured.value === null && c.measured.missingReason && !c.reason.includes(c.measured.missingReason) ? ` ${c.measured.missingReason}` : '';
  return {
    id: c.id,
    label: def.label,
    verdict: c.verdict,
    mark: MARK[c.verdict],
    value: measuredText(c.measured, true),
    reason: `${c.reason}${missing}`,
    scoreText: c.score === null ? null : `Score ${c.score.toFixed(2)}, weight ${pct0(c.weight)}`,
    thresholded: c.threshold !== null,
  };
}

/** One candidate as a row of the tab. */
export interface SiteRow {
  id: string;
  name: string;
  site: SiteRef;
  section: Section;
  /** 1 = best; null outside the ranked section. */
  rank: number | null;
  utility: number | null;
  utilityText: string;
  pareto: boolean;
  /** One per criterion, in the fixed order; empty when the tools sent no evaluation for the row. */
  badges: Badge[];
  /**
   * Why it is not ranked: the reasons of the failing criteria (infeasible), or of the unknown
   * criteria that have a threshold (unknown; T-77: only those decide feasibility).
   */
  deciding: string[];
}

function rowOf(defs: readonly CriterionUi[], e: SiteEvaluation, section: Section, ranked?: RankedSite): SiteRow {
  const byId = new Map(e.criteria.map((c) => [c.id, c]));
  const badges = CRITERIA.filter((id) => byId.has(id)).map((id) => badgeOf(defs, byId.get(id)!));
  const decidingVerdict: Verdict | null = section === 'infeasible' ? 'fail' : section === 'unknown' ? 'unknown' : null;
  const decidingBadges = decidingVerdict ? badges.filter((b) => b.verdict === decidingVerdict) : [];
  const thresholded = decidingBadges.filter((b) => b.thresholded);
  return {
    id: e.site.id,
    name: ranked?.name ?? e.site.name,
    site: e.site,
    section,
    rank: ranked?.rank ?? null,
    utility: section === 'ranked' ? (ranked?.utility ?? e.utility) : null,
    utilityText: section === 'ranked' ? utilityText(ranked?.utility ?? e.utility) : '—',
    pareto: ranked?.pareto ?? false,
    badges,
    deciding: (thresholded.length ? thresholded : decidingBadges).map((b) => b.reason),
  };
}

const byName = (a: SiteRow, b: SiteRow) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en');

/**
 * The three sections in the order the tab lists them. Ranked: by the engine's rank (then utility,
 * then id). Unknown: fewest deciding unknowns first. Infeasible: fewest failing criteria first
 * (the near misses), then fewest unknown. Ties by name.
 */
export function sortRows(rows: readonly SiteRow[]): { ranked: SiteRow[]; unknown: SiteRow[]; infeasible: SiteRow[] } {
  const n = (r: SiteRow, v: Verdict) => r.badges.filter((b) => b.verdict === v).length;
  const ranked = rows
    .filter((r) => r.section === 'ranked')
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.utility ?? -Infinity) - (a.utility ?? -Infinity) || a.id.localeCompare(b.id, 'en'));
  const unknown = rows.filter((r) => r.section === 'unknown').sort((a, b) => a.deciding.length - b.deciding.length || n(a, 'unknown') - n(b, 'unknown') || byName(a, b));
  const infeasible = rows.filter((r) => r.section === 'infeasible').sort((a, b) => n(a, 'fail') - n(b, 'fail') || n(a, 'unknown') - n(b, 'unknown') || byName(a, b));
  return { ranked, unknown, infeasible };
}

/** What the figures rest on, once per distinct basis. */
export interface BasisLine {
  labels: string[];
  text: string;
}

export interface RankingView {
  profileId: string;
  profileName: string;
  ranked: SiteRow[];
  unknown: SiteRow[];
  infeasible: SiteRow[];
  counts: Ranking['counts'];
  /** "28 candidates: 12 feasible, 9 unknown, 7 infeasible." */
  countsText: string;
  paretoCount: number;
  /** Feasible sites the tools ranked but did not list (beyond the requested number). */
  notListed: number;
  relaxations: string[];
  explanation: string[];
  /** "Weights used: sunlight 25 %, …" */
  weightsText: string;
  basis: BasisLine[];
  provenance: string[];
  note: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function countsSentence(c: Ranking['counts']): string {
  return `${plural(c.candidates, 'candidate')}: ${c.feasible} feasible, ${c.unknown} unknown, ${c.infeasible} infeasible.`;
}

/** The weights a result used, as shares: what the engine applied to a feasible site, else the profile's weights normalised. */
export function weightsSentence(defs: readonly CriterionUi[], profile: MissionProfile, applied?: readonly CriterionResult[]): string {
  const shares = applied?.length ? Object.fromEntries(applied.map((c) => [c.id, c.weight])) as Record<CriterionId, number> : weightShares(profile.weights);
  return `Weights used: ${defs.map((d) => `${noun(d)} ${pct0(shares[d.id] ?? 0)}`).join(', ')}.`;
}

export function rankingView(defs: readonly CriterionUi[], r: Ranking): RankingView {
  const evalById = new Map(r.evaluations.map((e) => [e.site.id, e]));
  const rows: SiteRow[] = [];
  const listed = new Set<string>();
  for (const rs of r.ranked) {
    const e = evalById.get(rs.siteId);
    listed.add(rs.siteId);
    if (e) rows.push(rowOf(defs, e, 'ranked', rs));
    else rows.push({ id: rs.siteId, name: rs.name, site: { id: rs.siteId, name: rs.name, kind: 'landing', lat: NaN, lon: NaN }, section: 'ranked', rank: rs.rank, utility: rs.utility, utilityText: utilityText(rs.utility), pareto: rs.pareto, badges: [], deciding: [] });
  }
  for (const e of r.evaluations) {
    if (listed.has(e.site.id) || e.feasibility === 'feasible') continue;
    rows.push(rowOf(defs, e, e.feasibility === 'unknown' ? 'unknown' : 'infeasible'));
  }
  const sorted = sortRows(rows);
  const firstFeasible = r.evaluations.find((e) => e.feasibility === 'feasible' && listed.has(e.site.id));
  const basis: BasisLine[] = [];
  for (const e of r.evaluations) {
    for (const c of e.criteria) {
      const text = c.measured.basis?.trim();
      if (!text) continue;
      const label = defOf(defs, c.id).label;
      const line = basis.find((b) => b.text === text);
      if (!line) basis.push({ labels: [label], text });
      else if (!line.labels.includes(label)) line.labels.push(label);
    }
  }
  const provenance = [...new Set(r.evaluations.flatMap((e) => e.metrics?.provenance ?? []))];
  return {
    profileId: r.profile.id,
    profileName: r.profile.name,
    ...sorted,
    counts: r.counts,
    countsText: countsSentence(r.counts),
    paretoCount: r.paretoFront.length,
    notListed: Math.max(0, r.counts.feasible - sorted.ranked.length),
    relaxations: relaxationSentences(defs, r.relaxations),
    explanation: r.explanation.filter((s) => s !== UTILITY_NOTE),
    weightsText: weightsSentence(defs, r.profile, firstFeasible?.criteria),
    basis,
    provenance,
    note: UTILITY_NOTE,
  };
}

// ---------- picking two rows ----------

/** The rows picked for a comparison, oldest first, at most two: a third pick lets the oldest go. */
export function togglePick(picks: readonly string[], id: string, on: boolean): string[] {
  const rest = picks.filter((p) => p !== id);
  return on ? [...rest, id].slice(-2) : rest;
}

export interface PairRow {
  id: CriterionId;
  label: string;
  a: string;
  b: string;
  better: CriterionDeltaBetter;
  /** "A", "B", "Tie" or "Unknown". */
  betterText: string;
  note: string;
}
type CriterionDeltaBetter = PairComparison['perCriterion'][number]['better'];

export interface PairView {
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Dominance in one sentence. */
  headline: string;
  rows: PairRow[];
  sentences: string[];
}

const BETTER_TEXT: Record<CriterionDeltaBetter, string> = { a: 'A', b: 'B', tie: 'Tie', unknown: 'Unknown' };

export function dominanceSentence(c: Pick<PairComparison, 'dominance'>, a: string, b: string): string {
  switch (c.dominance) {
    case 'a-dominates':
      return `${a} (A) dominates ${b} (B): at least as good on every criterion with a value on both sides, and better on at least one.`;
    case 'b-dominates':
      return `${b} (B) dominates ${a} (A): at least as good on every criterion with a value on both sides, and better on at least one.`;
    case 'tradeoff':
      return `A trade-off: ${a} (A) and ${b} (B) are each better on some criteria.`;
    case 'equal':
      return `${a} (A) and ${b} (B) are equal on every criterion with a value on both sides.`;
    default:
      return `${a} (A) and ${b} (B) cannot be compared as a whole: too much is unknown.`;
  }
}

export function pairView(defs: readonly CriterionUi[], c: PairComparison): PairView {
  const byId = new Map(c.perCriterion.map((d) => [d.id, d]));
  const unitOf = (id: CriterionId, side: SiteEvaluation) => side.criteria.find((x) => x.id === id)?.measured;
  const rows = CRITERIA.filter((id) => byId.has(id)).map((id): PairRow => {
    const d = byId.get(id)!;
    const def = defOf(defs, id);
    const ma = unitOf(id, c.a), mb = unitOf(id, c.b);
    return {
      id,
      label: def.label,
      a: ma ? measuredText(ma) : valueText(d.a, def.unit),
      b: mb ? measuredText(mb) : valueText(d.b, def.unit),
      better: d.better,
      betterText: BETTER_TEXT[d.better],
      note: d.note,
    };
  });
  return {
    a: { id: c.a.site.id, name: c.a.site.name },
    b: { id: c.b.site.id, name: c.b.site.name },
    headline: dominanceSentence(c, c.a.site.name, c.b.site.name),
    rows,
    sentences: c.sentences,
  };
}

// ---------- candidates and row actions ----------

export type SourceKind = 'catalogue' | 'nearby' | 'sites';

/** A site as the decision tools take it (always an object: the schemas have no unions): a landing by id, anything else by its coordinates. */
export function siteArg(site: Pick<SiteRef, 'id' | 'kind' | 'lat' | 'lon'>): { landing: string } | { lat: number; lon: number } {
  return site.kind === 'landing' ? { landing: site.id } : { lat: site.lat, lon: site.lon };
}

/**
 * Overrides as the tools' parameters take them: thresholds are numbers only, and a removed one
 * (null in ProfileOverrides) goes in `removeThresholds`, in the fixed criterion order.
 */
export function overridesParam(o: ProfileOverrides): Record<string, unknown> {
  const { thresholds, ...rest } = o;
  const out: Record<string, unknown> = { ...rest };
  if (thresholds) {
    const kept = Object.fromEntries(CRITERIA.filter((id) => typeof thresholds[id] === 'number').map((id) => [id, thresholds[id]]));
    const removed = CRITERIA.filter((id) => thresholds[id] === null);
    if (Object.keys(kept).length) out.thresholds = kept;
    if (removed.length) out.removeThresholds = removed;
  }
  return out;
}

/** The sites in comparison slots A and B, once each. */
export function savedSites(a: Scenario | null, b: Scenario | null): SiteRef[] {
  const out: SiteRef[] = [];
  for (const sc of [a, b]) if (sc && !out.some((s) => s.id === sc.site.id)) out.push(sc.site);
  return out;
}

/**
 * The tab draws whole evaluations (every criterion with its reason and basis), so it asks
 * findBestSites and compareSites for detail "full"; their default, "summary", is cut down for a
 * language model's reply (F-12). Added only when the action's schema has `detail`, so the tab
 * also works with a build of the tools from before F-12.
 */
export function withFullDetail<P extends Record<string, unknown>>(params: P, schema: Pick<ObjectSchema, 'properties'> | undefined): P | (P & { detail: 'full' }) {
  const d = schema?.properties.detail;
  return d && d.type === 'string' && d.enum?.includes('full') ? { ...params, detail: 'full' } : params;
}

export type CandidateChoice = { ok: true; candidates: Record<string, unknown>; what: string } | { ok: false; why: string };

/** The `candidates` argument of findBestSites for a source, or why that source cannot be used now. */
export function candidatesFor(kind: SourceKind, s: { site: SiteRef | null; compareA: Scenario | null; compareB: Scenario | null }, nearby: { radiusM: number | null; spacingM: number | null }): CandidateChoice {
  if (kind === 'catalogue') return { ok: true, candidates: { from: 'catalogue' }, what: 'the catalogued landings' };
  if (kind === 'nearby') {
    if (!s.site) return { ok: false, why: 'No site is on screen. Select a landing site or drop a pin, then rank around it.' };
    if (nearby.radiusM === null || nearby.spacingM === null) return { ok: false, why: 'Give the radius and the spacing as numbers.' };
    return { ok: true, candidates: { from: 'nearby', around: siteArg(s.site), radiusM: nearby.radiusM, spacingM: nearby.spacingM }, what: `points around ${s.site.name}` };
  }
  const sites = savedSites(s.compareA, s.compareB);
  if (!sites.length) return { ok: false, why: 'Slots A and B are empty. Save a scenario as A or B first (the A and B tab, or "As A" / "As B" in a row).' };
  return { ok: true, candidates: { from: 'sites', sites: sites.map(siteArg) }, what: sites.length === 1 ? `the site in A and B, ${sites[0].name}` : `the sites in A and B, ${sites.map((x) => x.name).join(' and ')}` };
}

/** A registered action and its parameters. */
export interface Step {
  name: string;
  params: Record<string, unknown>;
}

/** "Open" for a catalogued landing (selectSite: the globe flies there and the site card opens); "Pin" for any other point (dropPin). */
export function openStep(site: Pick<SiteRef, 'id' | 'kind' | 'lat' | 'lon'>): Step & { label: 'Open' | 'Pin' } {
  return site.kind === 'landing'
    ? { label: 'Open', name: 'selectSite', params: { site: site.id } }
    : { label: 'Pin', name: 'dropPin', params: { lat: site.lat, lon: site.lon, fly: true } };
}

/** "As A" / "As B": the site becomes the one on screen (camera kept), then saveScenario puts the scenario on screen in the slot. */
export function slotSteps(site: Pick<SiteRef, 'id' | 'kind' | 'lat' | 'lon'>, slot: 'A' | 'B'): Step[] {
  const select: Step = site.kind === 'landing' ? { name: 'selectSite', params: { site: site.id, fly: false } } : { name: 'dropPin', params: { lat: site.lat, lon: site.lon } };
  return [select, { name: 'saveScenario', params: { slot } }];
}

/**
 * A slot holds the app's own mission window and mast; say so when the ranking's profile used
 * others, so A and B are not read as the ranking's figures. Null when they agree.
 */
export function slotConditionsNote(profile: Pick<MissionProfile, 'window' | 'mastHeightM'>, app: { mastHeightM: number; windowStartMs: number; windowDurationH: number; delayH: number }): string | null {
  const diffs: string[] = [];
  if (profile.window.durationH !== app.windowDurationH) diffs.push(`a ${spanText(app.windowDurationH, true)} window instead of the profile's ${spanText(profile.window.durationH)}`);
  if (profile.window.startUtc !== 'current' && Date.parse(profile.window.startUtc) !== app.windowStartMs + app.delayH * 3_600_000) diffs.push("the app's arrival time instead of the profile's");
  if (profile.mastHeightM !== app.mastHeightM) diffs.push(`a ${plain(app.mastHeightM, 2)} m mast instead of the profile's ${plain(profile.mastHeightM, 2)} m`);
  return diffs.length ? `A and B use the app's mission settings: ${diffs.join(', ')}.` : null;
}

/** True when two profiles ask for the same thing (a start of 'current' matches any start). */
export function sameProfile(a: MissionProfile, b: MissionProfile): boolean {
  const sameStart = a.window.startUtc === 'current' || b.window.startUtc === 'current' || Date.parse(a.window.startUtc) === Date.parse(b.window.startUtc);
  return (
    a.id === b.id &&
    sameStart &&
    a.window.durationH === b.window.durationH &&
    a.mastHeightM === b.mastHeightM &&
    a.landingRadiusM === b.landingRadiusM &&
    CRITERIA.every((id) => a.thresholds[id] === b.thresholds[id] && a.weights[id] === b.weights[id])
  );
}

/** What a running tool is doing, in its own words ("Measuring Apollo 15 (4 of 28)"), or a count, or what was asked for. */
export function progressText(p: { running: boolean; done: number; total: number; label: string } | null, what: string): string {
  if (p?.running && p.label) return `${p.label}…`;
  if (p?.running && p.total > 0) return `Measured ${Math.min(p.done, p.total)} of ${p.total} candidates…`;
  return `Measuring ${what}…`;
}

/** Where a ranking's candidates came from, as findBestSites reports it (its `candidates`, `cap` and `dropped`). */
export interface RankingSource {
  from: 'catalogue' | 'sites' | 'nearby';
  considered: number;
  total?: number;
  around?: { name: string };
  radiusM?: number;
  spacingM?: number;
  scanned?: number;
  removedBySlopePrefilter?: number;
  withoutData?: number;
  prefilter?: string;
}

/** One sentence: what was measured, and what the cap left out. */
export function sourceSentence(src: RankingSource | null, cap: number | null, dropped: number): string {
  if (!src) return '';
  const over = dropped > 0 ? ` ${dropped} more ${dropped === 1 ? 'was' : 'were'} over the cap of ${cap ?? '?'} and not measured.` : '';
  if (src.from === 'catalogue') return `Measured ${src.considered}${src.total !== undefined ? ` of the ${src.total}` : ''} catalogued landings.${over}`;
  if (src.from === 'sites') return `Measured the ${plural(src.considered, 'site')} given.${over}`;
  const grid = src.radiusM !== undefined && src.spacingM !== undefined ? ` within ${plain(src.radiusM, 0)} m every ${plain(src.spacingM, 0)} m` : '';
  const out = [src.removedBySlopePrefilter ? `${src.removedBySlopePrefilter} left out by the slope pre-filter` : '', src.withoutData ? `${src.withoutData} without elevation data` : ''].filter(Boolean);
  return `Scanned ${plural(src.scanned ?? 0, 'point')} around ${src.around?.name ?? 'the site'}${grid}${out.length ? ` (${out.join(', ')})` : ''}; the best by the scan's own score were measured fully: ${src.considered}, the site itself included.${over}`;
}

/** The profile's mission settings in a line: window, mast and landing radius. */
export function profileSettingsText(p: Pick<MissionProfile, 'window' | 'mastHeightM' | 'landingRadiusM'>): string {
  const start = p.window.startUtc === 'current' ? "from the app's mission window start" : `from ${p.window.startUtc}`;
  return `${spanText(p.window.durationH, true)} window ${start} · ${plain(p.mastHeightM, 2)} m mast · slope and roughness over ${plain(p.landingRadiusM, 1)} m around each site`;
}
