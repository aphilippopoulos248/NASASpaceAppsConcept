// The six criteria of the decision engine (decision D-17): what each measures, which way is
// better, whether it is a safety limit, and the two values its utility score is scaled between.
// Also the number formats every sentence of the engine uses, so the same value always reads the same.

import { CRITERIA, type CriterionDef, type CriterionId, type MeasuredValue } from './types';

export const CRITERION_DEFS: readonly CriterionDef[] = Object.freeze([
  {
    id: 'sunlight', label: 'Sunlight', unit: '%', sense: 'higher-is-better', safety: false, ideal: 100, worst: 0,
    definition: "Time-averaged visible fraction of the Sun's disc over the mission window, against the terrain skyline; Earth passing in front of the Sun counts as shade.",
  },
  {
    id: 'darkness', label: 'Longest darkness', unit: 'h', sense: 'lower-is-better', safety: false, ideal: 0, worst: 'window',
    definition: "Longest unbroken spell inside the mission window with the Sun's disc wholly hidden (by the terrain or by Earth); a lower bound when it runs into an edge of the window.",
  },
  {
    id: 'earthVisibility', label: 'Earth line of sight', unit: '%', sense: 'higher-is-better', safety: false, ideal: 100, worst: 0,
    definition: "Share of the mission window with a geometric line of sight to Earth's centre over the terrain skyline: direct-to-Earth geometry, not a radio link budget.",
  },
  {
    id: 'commBlackout', label: 'Longest blackout', unit: 'h', sense: 'lower-is-better', safety: false, ideal: 0, worst: 'window',
    definition: "Longest unbroken spell inside the mission window without that line of sight to Earth's centre; a lower bound when it runs into an edge of the window. Geometry only, not a link budget.",
  },
  {
    id: 'slope', label: 'Slope', unit: 'deg', sense: 'lower-is-better', safety: true, ideal: 0, worst: 30,
    definition: 'Ground slope over the landing region, from the finest elevation grid that covers it (src/terrain/region.ts); features smaller than the grid spacing are not seen. Without a maximum, utility runs from 0° (best) to a reference 30° (worst).',
  },
  {
    id: 'roughness', label: 'Roughness', unit: 'm', sense: 'lower-is-better', safety: true, ideal: 0, worst: 5,
    definition: 'Roughness of the landing region in metres, a hazard proxy measured on the finest elevation grid that covers it (src/terrain/region.ts); not available where that grid is too coarse to say anything about it. Without a maximum, utility runs from 0 m (best) to a reference 5 m (worst).',
  },
] satisfies CriterionDef[]);

export const DEF: Readonly<Record<CriterionId, CriterionDef>> = Object.freeze(
  Object.fromEntries(CRITERION_DEFS.map((d) => [d.id, d])) as Record<CriterionId, CriterionDef>,
);

if (CRITERION_DEFS.length !== CRITERIA.length || CRITERIA.some((id) => !DEF[id])) throw new Error('criterion definitions do not match CRITERIA');

// ---------- words and numbers ----------

const DIGITS: Record<CriterionDef['unit'], number> = { '%': 1, h: 1, deg: 1, m: 2 };
const SUFFIX: Record<CriterionDef['unit'], string> = { '%': ' %', h: ' h', deg: '°', m: ' m' };
/** How a difference is written: "5.2 points", "12.4 h", "2.1°", "0.12 m". */
const DIFF_SUFFIX: Record<CriterionDef['unit'], string> = { '%': ' points', h: ' h', deg: '°', m: ' m' };

/** A number with its unit, at the precision every sentence uses: "87.1 %", "18.4 h", "6.0°", "0.35 m" (`extra` more digits where that precision would hide a difference). */
export function fmt(v: number, unit: CriterionDef['unit'], extra = 0): string {
  return `${v.toFixed(DIGITS[unit] + extra)}${SUFFIX[unit]}`;
}

/** A difference with its unit: "5.2 points", "12.4 h". */
export function fmtDiff(v: number, unit: CriterionDef['unit'], extra = 0): string {
  return `${Math.abs(v).toFixed(DIGITS[unit] + extra)}${DIFF_SUFFIX[unit]}`;
}

/** A measured value as read: "18.4 h or more" for a lower bound, "not available" when missing. */
export function fmtMeasured(m: MeasuredValue, extra = 0): string {
  if (m.value === null) return 'not available';
  const text = fmt(m.value, m.unit, extra);
  return m.bound === 'lower' ? `${text} or more` : m.bound === 'upper' ? `${text} or less` : text;
}

/** What a threshold is called for this criterion: "the minimum of 60.0 %" or "the maximum of 24.0 h". */
export function thresholdText(id: CriterionId, threshold: number): string {
  const d = DEF[id];
  return `the ${d.sense === 'higher-is-better' ? 'minimum' : 'maximum'} of ${fmt(threshold, d.unit)}`;
}

/** The criterion as a noun inside a sentence: "sunlight", "longest darkness", "Earth line of sight". */
export function noun(id: CriterionId): string {
  const label = DEF[id].label;
  return id === 'earthVisibility' ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** "a", "a and b", "a, b and c". */
export function list(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Plural helper: "1 candidate", "3 candidates". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Strict, deterministic order of ids (no locale rules). */
export function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
