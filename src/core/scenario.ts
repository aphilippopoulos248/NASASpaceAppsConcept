// Turning app state into the Scenario the science core analyses, and naming scenarios so
// that two of them can be told apart in a comparison.
import type { AppState, Scenario } from './types';
import { formatUtc } from './time';

/** Sampling step of the analysed time series, minutes. */
export const SCENARIO_STEP_MIN = 10;

const HOUR_MS = 3_600_000;

/** The mission window's real start: the planned start plus the arrival delay being explored. */
export function effectiveStartMs(s: Pick<AppState, 'windowStartMs' | 'delayH'>): number {
  return s.windowStartMs + s.delayH * HOUR_MS;
}

export function scenarioKey(sc: Omit<Scenario, 'id' | 'label'>): string {
  return `${sc.site.id}|${sc.mastHeightM}|${sc.startMs}|${sc.durationH}|${sc.stepMin}`;
}

/**
 * A span of time for labels: "45 min", "24 h", "37.5 h", "3 days". Input in hours; the sign is
 * ignored. `before` gives the form that goes in front of a noun: "3-day (window)".
 */
export function spanText(hours: number, before = false): string {
  const h = Math.abs(hours);
  if (!Number.isFinite(h)) return 'an unknown time';
  if (h < 1) return `${Math.round(h * 60)} min`;
  // Whole and half days read better as days ("29.5 days" is one lunar day).
  if (h >= 48 && Number.isInteger(h / 12)) return before ? `${h / 24}-day` : `${h / 24} days`;
  return `${Number(h.toFixed(2))} h`;
}

/** Everything that defines a scenario, in words: for headings, tooltips and the assistant. */
export function describeScenario(sc: Pick<Scenario, 'site' | 'startMs' | 'durationH' | 'mastHeightM'>): string {
  return `${sc.site.name}, arrival ${formatUtc(sc.startMs)}, ${spanText(sc.durationH, true)} window, ${sc.mastHeightM} m mast`;
}

/**
 * The scenario under study now, or null when no site is pinned. Without a label of its own it
 * carries the full description; labelPair() shortens that when it goes into a comparison slot.
 */
export function scenarioFromState(s: Readonly<AppState>, label?: string): Scenario | null {
  if (!s.site) return null;
  const base = { site: s.site, mastHeightM: s.mastHeightM, startMs: effectiveStartMs(s), durationH: s.windowDurationH, stepMin: SCENARIO_STEP_MIN };
  return { ...base, id: scenarioKey(base), label: label?.trim() || describeScenario(base) };
}

/** True when the label was written by this module (not typed by a person or the assistant), so it may be rewritten. */
export function hasAutoLabel(sc: Scenario): boolean {
  const label = sc.label.trim(), name = sc.site.name;
  return label === '' || label === name || label === describeScenario(sc) || (label.startsWith(`${name} (`) && label.endsWith(')'));
}

const coordText = (sc: Scenario) =>
  `${Math.abs(sc.site.lat).toFixed(5)}° ${sc.site.lat >= 0 ? 'N' : 'S'}, ${Math.abs(sc.site.lon).toFixed(5)}° ${sc.site.lon >= 0 ? 'E' : 'W'}`;

/** What sets two scenarios apart, as a short phrase for each: place, arrival, mast height, window length. */
function differences(a: Scenario, b: Scenario): [string, string] {
  const qa: string[] = [], qb: string[] = [];
  const samePlace = a.site.id === b.site.id || (a.site.lat === b.site.lat && a.site.lon === b.site.lon);
  if (!samePlace && coordText(a) !== coordText(b)) {
    qa.push(coordText(a));
    qb.push(coordText(b));
  }
  if (a.startMs !== b.startMs) {
    const later = `arrival ${spanText((b.startMs - a.startMs) / HOUR_MS)} later`;
    qa.push(a.startMs < b.startMs ? 'earlier arrival' : later);
    qb.push(a.startMs < b.startMs ? later : 'earlier arrival');
  }
  if (a.mastHeightM !== b.mastHeightM) {
    qa.push(`${a.mastHeightM} m mast`);
    qb.push(`${b.mastHeightM} m mast`);
  }
  if (a.durationH !== b.durationH) {
    qa.push(`${spanText(a.durationH, true)} window`);
    qb.push(`${spanText(b.durationH, true)} window`);
  }
  return qa.length ? [qa.join(', '), qb.join(', ')] : ['A', 'B'];
}

/**
 * Names for the two comparison slots that tell them apart, because comparison sentences are
 * built from them ("B gets 3 percentage points more sunlight than A").
 *
 * A label somebody typed is kept. An automatic label is the site name; when both sides would
 * read the same (same site, or the same typed label) each gets what differs in brackets:
 * "IM-2 Athena (earlier arrival)" and "IM-2 Athena (arrival 24 h later)", "(2 m mast)" and
 * "(10 m mast)". Returns the same objects when nothing needs renaming.
 */
export function labelPair(a: Scenario | null, b: Scenario | null): [Scenario | null, Scenario | null] {
  const named = (sc: Scenario, label: string): Scenario => (sc.label === label ? sc : { ...sc, label });
  const base = (sc: Scenario) => (hasAutoLabel(sc) ? sc.site.name : sc.label.trim());
  if (!a || !b) return [a && named(a, base(a)), b && named(b, base(b))];
  let la = base(a), lb = base(b);
  if (la === lb) {
    const [qa, qb] = differences(a, b);
    la = `${la} (${qa})`;
    lb = `${lb} (${qb})`;
  }
  return [named(a, la), named(b, lb)];
}
