// Mission profiles for the decision engine (decision D-17): the presets in
// public/data/mission-profiles.json, read once and checked, and the overrides a user or the
// assistant applies on top of one. Loosening a safety limit (slope, roughness) needs the explicit
// relaxation flag; every relaxation is listed. Everything here is pure except reading the file.

import { siteUrl } from '../../terrain/reader';
import { DEF, fmt, noun } from './criteria';
import { CRITERIA, type CriterionId, type MissionProfile, type ProfileOverrides, type Relaxation, type ResolvedProfile, type Thresholds, type Weights } from './types';

export const PROFILES_PATH = 'data/mission-profiles.json';

/** The ranges a setting may take; a value outside is refused with the reason. */
export const LIMITS = {
  durationH: { min: 1, max: 8760 },
  mastHeightM: { min: 0, max: 100 },
  landingRadiusM: { min: 10, max: 5000 },
  weight: { min: 0, max: 100 },
  threshold: { '%': { min: 0, max: 100 }, h: { min: 0, max: 8760 }, deg: { min: 0, max: 90 }, m: { min: 0, max: 100 } },
} as const;

const OVERRIDE_KEYS = new Set(['window', 'mastHeightM', 'landingRadiusM', 'thresholds', 'weights', 'allowSafetyRelaxation']);
const WINDOW_KEYS = new Set(['startUtc', 'durationH']);
const isCriterion = (k: string): k is CriterionId => (CRITERIA as readonly string[]).includes(k);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const inRange = (v: unknown, r: { min: number; max: number }): v is number => typeof v === 'number' && Number.isFinite(v) && v >= r.min && v <= r.max;
const rangeText = (r: { min: number; max: number }, unit = '') => `${r.min}${unit} to ${r.max}${unit}`;

/** 'current' or a UTC date and time the app understands ("2025-03-06T17:28Z", seconds allowed), between 1950 and 2100. */
function validStart(v: unknown): v is string {
  if (v === 'current') return true;
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?Z$/.test(v)) return false;
  const t = Date.parse(v);
  return Number.isFinite(t) && t >= Date.UTC(1950, 0, 1) && t < Date.UTC(2101, 0, 1);
}

function thresholdProblem(id: CriterionId, v: unknown): string | null {
  if (v === null) return null;
  const r = LIMITS.threshold[DEF[id].unit];
  return inRange(v, r) ? null : `The ${noun(id)} threshold must be a number from ${rangeText(r, ` ${DEF[id].unit}`)}, or null for no requirement (got ${JSON.stringify(v)}).`;
}

const isLoosening = (id: CriterionId, from: number | null, to: number | null) =>
  from !== null && (to === null || (DEF[id].sense === 'higher-is-better' ? to < from : to > from));

/**
 * Applies overrides to a base profile. Loosening a safety threshold (or removing it) beyond the
 * base value is refused unless overrides.allowSafetyRelaxation is true; when allowed, it is listed
 * in relaxations. Tightening is always allowed. Out-of-range values are refused with a reason.
 * Any refusal refuses the whole set: the profile is then the base.
 */
export function resolveProfile(base: MissionProfile, overrides: ProfileOverrides): ResolvedProfile {
  const refused: string[] = [];
  const relaxations: Relaxation[] = [];
  const changed: string[] = [];
  const o = (overrides ?? {}) as Record<string, unknown>;
  if (!isObject(o)) return { profile: base, relaxations: [], refused: ['The overrides must be an object.'] };
  for (const k of Object.keys(o)) if (!OVERRIDE_KEYS.has(k)) refused.push(`Unknown setting "${k}".`);
  if (o.allowSafetyRelaxation !== undefined && typeof o.allowSafetyRelaxation !== 'boolean') refused.push('allowSafetyRelaxation must be true or false.');
  const allowRelax = o.allowSafetyRelaxation === true;

  const window = { ...base.window };
  if (o.window !== undefined) {
    if (!isObject(o.window)) refused.push('window must be an object with startUtc and/or durationH.');
    else {
      for (const k of Object.keys(o.window)) if (!WINDOW_KEYS.has(k)) refused.push(`Unknown window setting "${k}".`);
      const { startUtc, durationH } = o.window;
      if (startUtc !== undefined) {
        if (!validStart(startUtc)) refused.push(`window.startUtc must be "current" or a UTC time such as "2025-03-06T17:28Z" between 1950 and 2100 (got ${JSON.stringify(startUtc)}).`);
        else if (startUtc !== window.startUtc) { window.startUtc = startUtc; changed.push(`window start ${startUtc}`); }
      }
      if (durationH !== undefined) {
        if (!inRange(durationH, LIMITS.durationH)) refused.push(`window.durationH must be a number of hours from ${rangeText(LIMITS.durationH)} (got ${JSON.stringify(durationH)}).`);
        else if (durationH !== window.durationH) { window.durationH = durationH; changed.push(`window ${durationH} h`); }
      }
    }
  }

  let mastHeightM = base.mastHeightM;
  if (o.mastHeightM !== undefined) {
    if (!inRange(o.mastHeightM, LIMITS.mastHeightM)) refused.push(`mastHeightM must be a number of metres from ${rangeText(LIMITS.mastHeightM)} (got ${JSON.stringify(o.mastHeightM)}).`);
    else if (o.mastHeightM !== mastHeightM) { mastHeightM = o.mastHeightM; changed.push(`mast ${mastHeightM} m`); }
  }
  let landingRadiusM = base.landingRadiusM;
  if (o.landingRadiusM !== undefined) {
    if (!inRange(o.landingRadiusM, LIMITS.landingRadiusM)) refused.push(`landingRadiusM must be a number of metres from ${rangeText(LIMITS.landingRadiusM)} (got ${JSON.stringify(o.landingRadiusM)}).`);
    else if (o.landingRadiusM !== landingRadiusM) { landingRadiusM = o.landingRadiusM; changed.push(`landing region radius ${landingRadiusM} m`); }
  }

  const thresholds: Thresholds = { ...base.thresholds };
  if (o.thresholds !== undefined) {
    if (!isObject(o.thresholds)) refused.push('thresholds must be an object keyed by criterion.');
    else {
      for (const [k, v] of Object.entries(o.thresholds)) {
        if (!isCriterion(k)) { refused.push(`Unknown criterion "${k}" in thresholds (known: ${CRITERIA.join(', ')}).`); continue; }
        if (v === undefined) continue;
        const problem = thresholdProblem(k, v);
        if (problem) { refused.push(problem); continue; }
        const from = base.thresholds[k] ?? null, to = v as number | null;
        if (to === from) continue;
        if (DEF[k].safety && isLoosening(k, from, to)) {
          if (!allowRelax) {
            refused.push(
              `${to === null ? `Removing the ${noun(k)} limit (${fmt(from!, DEF[k].unit)})` : `Loosening the ${noun(k)} ${DEF[k].sense === 'higher-is-better' ? 'minimum' : 'maximum'} from ${fmt(from!, DEF[k].unit)} to ${fmt(to, DEF[k].unit)}`} is a safety relaxation: it needs allowSafetyRelaxation, which may be set only when the user explicitly asks to relax this limit.`,
            );
            continue;
          }
          relaxations.push({ criterion: k, from, to });
        }
        thresholds[k] = to;
        changed.push(`${noun(k)} ${to === null ? 'no requirement' : `${DEF[k].sense === 'higher-is-better' ? 'at least' : 'at most'} ${fmt(to, DEF[k].unit)}`}`);
      }
    }
  }

  const weights: Weights = { ...base.weights };
  if (o.weights !== undefined) {
    if (!isObject(o.weights)) refused.push('weights must be an object keyed by criterion.');
    else {
      for (const [k, v] of Object.entries(o.weights)) {
        if (!isCriterion(k)) { refused.push(`Unknown criterion "${k}" in weights (known: ${CRITERIA.join(', ')}).`); continue; }
        if (v === undefined) continue;
        if (!inRange(v, LIMITS.weight)) { refused.push(`The ${noun(k)} weight must be a number from ${rangeText(LIMITS.weight)} (got ${JSON.stringify(v)}).`); continue; }
        if (v !== weights[k]) { weights[k] = v; changed.push(`${noun(k)} weight ${v}`); }
      }
      if (CRITERIA.every((id) => !(weights[id] > 0))) refused.push('At least one weight must be above zero.');
    }
  }

  if (refused.length) return { profile: base, relaxations: [], refused };
  if (!changed.length) return { profile: base, relaxations: [], refused: [] };
  const profile: MissionProfile = {
    ...base,
    window,
    mastHeightM,
    landingRadiusM,
    thresholds,
    weights,
    sources: [...base.sources, `Changed on request for this evaluation: ${changed.join('; ')}.`],
  };
  return { profile, relaxations, refused: [] };
}

// ---------- the bundled presets ----------

/** Checks the bundled file and returns its profiles; throws with the path of the first problem. */
export function parseMissionProfiles(json: unknown): MissionProfile[] {
  const fail = (where: string, what: string): never => {
    throw new Error(`mission-profiles.json: ${where}: ${what}`);
  };
  if (!isObject(json) || !Array.isArray(json.profiles) || json.profiles.length === 0) fail('root', 'expected { "profiles": [ ... ] } with at least one profile');
  const seen = new Set<string>();
  return (json as { profiles: unknown[] }).profiles.map((p, i) => {
    const at = `profiles[${i}]`;
    if (!isObject(p)) return fail(at, 'not an object');
    for (const k of ['id', 'name', 'description'] as const) if (typeof p[k] !== 'string' || !(p[k] as string).trim()) fail(`${at}.${k}`, 'a non-empty string is required');
    const id = p.id as string;
    if (id === 'custom' || seen.has(id)) fail(`${at}.id`, `"${id}" is reserved or used twice`);
    seen.add(id);
    const w = p.window;
    if (!isObject(w) || !validStart(w.startUtc) || !inRange(w.durationH, LIMITS.durationH)) fail(`${at}.window`, 'needs startUtc ("current" or a UTC time) and durationH in hours');
    if (!inRange(p.mastHeightM, LIMITS.mastHeightM)) fail(`${at}.mastHeightM`, `a number from ${rangeText(LIMITS.mastHeightM)}`);
    if (!inRange(p.landingRadiusM, LIMITS.landingRadiusM)) fail(`${at}.landingRadiusM`, `a number from ${rangeText(LIMITS.landingRadiusM)}`);
    const t = p.thresholds, wt = p.weights;
    if (!isObject(t) || !isObject(wt)) return fail(at, 'thresholds and weights are required');
    for (const k of Object.keys(t)) if (!isCriterion(k)) fail(`${at}.thresholds.${k}`, 'unknown criterion');
    for (const k of Object.keys(wt)) if (!isCriterion(k)) fail(`${at}.weights.${k}`, 'unknown criterion');
    for (const c of CRITERIA) {
      if (!(c in t)) fail(`${at}.thresholds.${c}`, 'missing (null means no requirement)');
      const problem = thresholdProblem(c, t[c]);
      if (problem) fail(`${at}.thresholds.${c}`, problem);
      if (!inRange(wt[c], LIMITS.weight)) fail(`${at}.weights.${c}`, `a number from ${rangeText(LIMITS.weight)}`);
    }
    if (CRITERIA.every((c) => !((wt[c] as number) > 0))) fail(`${at}.weights`, 'at least one weight must be above zero');
    if (!Array.isArray(p.sources) || !p.sources.length || p.sources.some((s) => typeof s !== 'string' || !s.trim())) fail(`${at}.sources`, 'a non-empty list of sentences is required');
    return {
      id,
      name: p.name as string,
      description: p.description as string,
      window: { startUtc: (w as Record<string, unknown>).startUtc as string, durationH: (w as Record<string, unknown>).durationH as number },
      mastHeightM: p.mastHeightM as number,
      landingRadiusM: p.landingRadiusM as number,
      thresholds: Object.fromEntries(CRITERIA.map((c) => [c, t[c] as number | null])) as Thresholds,
      weights: Object.fromEntries(CRITERIA.map((c) => [c, wt[c] as number])) as Weights,
      sources: [...(p.sources as string[])],
    };
  });
}

async function readProfilesFile(): Promise<unknown> {
  // Vite turns import.meta.env.SSR into false in the browser build, which drops the Node branch.
  if (import.meta.env.SSR) {
    const { readPublicFile } = await import('../../terrain/nodeReader');
    return JSON.parse(new TextDecoder().decode(await readPublicFile(PROFILES_PATH)));
  }
  const res = await fetch(siteUrl(PROFILES_PATH));
  if (!res.ok) throw new Error(`${PROFILES_PATH}: HTTP ${res.status}`);
  return res.json();
}

let loaded: Promise<MissionProfile[]> | null = null;

/** Mission profiles from public/data/mission-profiles.json, loaded once. The first is the default. A failed read is tried again next time. */
export function loadMissionProfiles(): Promise<MissionProfile[]> {
  loaded ??= readProfilesFile()
    .then(parseMissionProfiles)
    .catch((e: unknown) => {
      loaded = null;
      throw e;
    });
  return loaded;
}
