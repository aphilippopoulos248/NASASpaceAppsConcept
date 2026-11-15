// Sunrise, sunset, Earthrise and Earthset events of an analysis: picking one for the scrubber
// and jumpToEvent, and saying which instant each of them is (decision D-8).
//
// Each event is one instant of a passage of the disc through the terrain skyline (`span`, from
// the science core: docs/lunyx/handover/T-31-event-spans.md): a sunset is the last limb of a
// passage that began with the first cut. The helpers below name both ends, never a bare
// "sunset" with a time.
import { TRANSITION_WORDS, transitionSummary } from '../analysis/api';
import type { SkyEvent, SkyTransition } from '../analysis/types';
import { formatUtc, isoUtc } from './time';

export type EventType = SkyEvent['type'];

export interface EventInfo {
  /** The everyday name of the event: "Sunset". Never shown with a time on its own. */
  name: string;
  /** The instant in a few words, for buttons, marks and countdowns: "Sun fully set". */
  label: string;
  /** The same as a clause for sentences: "the last part of the Sun's disc goes behind the terrain skyline". */
  instant: string;
  body: 'sun' | 'earth';
  rising: boolean;
}

/**
 * Which instant each event of the analysis is (decision D-8). A rise or a set is not one
 * moment: the Sun takes about an hour to cross the skyline at mid latitudes and far longer near
 * the poles, so a time is never shown without saying which end of the crossing it is.
 *
 * As the science core defines them (src/analysis/window.ts): sunrise is the first moment any
 * part of the Sun's disc stands above the terrain skyline, sunset the last such moment;
 * Earthrise and Earthset are Earth's centre crossing the skyline.
 */
export const EVENT_INFO: Record<EventType, EventInfo> = {
  sunrise: { name: 'Sunrise', label: 'Sun starts rising', instant: "the first part of the Sun's disc appears above the terrain skyline", body: 'sun', rising: true },
  sunset: { name: 'Sunset', label: 'Sun fully set', instant: "the last part of the Sun's disc goes behind the terrain skyline", body: 'sun', rising: false },
  earthrise: { name: 'Earthrise', label: "Earth's centre rises", instant: "the centre of Earth's disc comes above the terrain skyline", body: 'earth', rising: true },
  earthset: { name: 'Earthset', label: "Earth's centre sets", instant: "the centre of Earth's disc goes behind the terrain skyline", body: 'earth', rising: false },
};

export const EVENT_TYPES = ['sunrise', 'sunset', 'earthrise', 'earthset'] as const satisfies readonly EventType[];

/** The four definitions as sentences, for results the assistant reads. */
export function eventDefinitions(): Record<EventType, string> {
  const out = {} as Record<EventType, string>;
  for (const type of EVENT_TYPES) out[type] = `${EVENT_INFO[type].label}: ${EVENT_INFO[type].instant}.`;
  return out;
}

// ---------- both ends of a passage ----------

const BODY = { sun: 'Sun', earth: 'Earth' } as const;
const round = (v: number, digits: number) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);

/**
 * The name of one end of a passage, for buttons, marks and results: "Sun starts setting", "Sun
 * fully set", "Earth fully risen". A graze or a peek is not a set or a rise (contract rule 3):
 * "Sun partly hidden" ... "Sun's whole disc clear again". Null for an end that was not found.
 */
export function edgeLabel(tr: SkyTransition, end: 'start' | 'end'): string | null {
  const x = end === 'start' ? tr.start : tr.end;
  if (x.edge === 'unresolved') return null;
  const Body = BODY[tr.body];
  if (tr.kind === 'graze') return end === 'start' ? `${Body} partly hidden` : `${Body}'s whole disc clear again`;
  if (tr.kind === 'peek') return end === 'start' ? `${Body} partly visible` : `${Body} gone again`;
  return TRANSITION_WORDS[tr.body][x.edge].label;
}

/** The same end as a clause for sentences: "the terrain skyline starts to cut into the Sun's disc". */
export function edgeInstant(tr: SkyTransition, end: 'start' | 'end'): string | null {
  const x = end === 'start' ? tr.start : tr.end;
  return x.edge === 'unresolved' ? null : TRANSITION_WORDS[tr.body][x.edge].instant;
}

/**
 * A passage as plain JSON for action results: its kind, both ends named with their times (UTC,
 * null for an end that was not found) and whether they lie in the analysed window, Earth's centre
 * crossings, and the D-8 sentence ("starts setting 2025-03-16 18:23, fully set 19:30 UTC").
 */
export function spanReport(tr: SkyTransition) {
  const end = (which: 'start' | 'end') => {
    const x = which === 'start' ? tr.start : tr.end;
    return x.edge === 'unresolved'
      ? { edge: 'unresolved' as const, label: null, timeUtc: null, inWindow: x.inWindow }
      : { edge: x.edge, label: edgeLabel(tr, which), timeUtc: isoUtc(x.timeMs), azDeg: round(x.azDeg, 1), inWindow: x.inWindow };
  };
  return {
    body: tr.body,
    /** 'set', 'rise', 'graze' (partly hidden, never fully set), 'peek' (partly visible, never fully risen) or 'unresolved'. */
    kind: tr.kind,
    start: end('start'),
    end: end('end'),
    /** End minus start (a lower bound when an end was not found). */
    hours: round(tr.hours, 2),
    ...(tr.centre.length > 0 && {
      centre: tr.centre.map((c) => ({ label: `${BODY[tr.body]}'s centre ${c.up ? 'rises' : 'sets'}`, timeUtc: isoUtc(c.timeMs), inWindow: c.inWindow })),
    }),
    summary: transitionSummary(tr),
  };
}

/** Which instant of an event to go to: the event itself, or the start or the end of its passage. */
export type InstantChoice = 'event' | 'start' | 'end';
export const INSTANT_CHOICES = ['event', 'start', 'end'] as const satisfies readonly InstantChoice[];

export interface EventInstant {
  event: SkyEvent;
  choice: InstantChoice;
  timeMs: number;
  azDeg: number;
  /** "Sun starts setting". */
  label: string;
  /** "the terrain skyline starts to cut into the Sun's disc". */
  instant: string;
  /** False when the instant lies outside the analysed window (followed with the model). */
  inWindow: boolean;
}

/** One instant of an event: the event itself, or an end of its passage (null when it has no passage or that end was not found). */
export function eventInstant(e: SkyEvent, choice: InstantChoice): EventInstant | null {
  if (choice === 'event') return { event: e, choice, timeMs: e.timeMs, azDeg: e.azDeg, label: EVENT_INFO[e.type].label, instant: EVENT_INFO[e.type].instant, inWindow: true };
  const tr = e.span;
  if (!tr) return null;
  const x = choice === 'start' ? tr.start : tr.end;
  const label = edgeLabel(tr, choice), instant = edgeInstant(tr, choice);
  if (label === null || instant === null) return null;
  return { event: e, choice, timeMs: x.timeMs, azDeg: x.azDeg, label, instant, inWindow: x.inWindow };
}

/** The next (or previous) instant of a kind relative to `timeMs` (e.g. the next start of a sunset), ignoring instants within 30 s of it. */
export function findInstant(events: readonly SkyEvent[], type: EventType, choice: InstantChoice, which: 'next' | 'previous', timeMs: number): EventInstant | null {
  const list = events
    .filter((e) => e.type === type)
    .map((e) => eventInstant(e, choice))
    .filter((x): x is EventInstant => x !== null)
    .sort((a, b) => a.timeMs - b.timeMs);
  const hit = which === 'next' ? list.find((x) => x.timeMs > timeMs + 30_000) : [...list].reverse().find((x) => x.timeMs < timeMs - 30_000);
  return hit ?? null;
}

/**
 * For the scrubber's jump buttons: the next instant of any end of the passages of a type after
 * `timeMs`, in time order (a sunset button goes to "Sun starts setting", then to "Sun fully set",
 * then to the next sunset's start). An end that is the event itself counts once.
 */
export function nextInstantOfType(events: readonly SkyEvent[], type: EventType, timeMs: number): EventInstant | null {
  const all: EventInstant[] = [];
  for (const e of events) {
    if (e.type !== type) continue;
    const own = eventInstant(e, 'event')!;
    all.push(own);
    for (const choice of ['start', 'end'] as const) {
      const x = eventInstant(e, choice);
      if (x && Math.abs(x.timeMs - own.timeMs) > 1000) all.push(x);
    }
  }
  all.sort((a, b) => a.timeMs - b.timeMs);
  return all.find((x) => x.timeMs > timeMs + 30_000) ?? null;
}

/** The next (or previous) event of a type relative to `timeMs`, ignoring events within 30 s of it. */
export function findEvent(events: readonly SkyEvent[], type: SkyEvent['type'], which: 'next' | 'previous', timeMs: number): SkyEvent | null {
  const list = events.filter((e) => e.type === type).sort((a, b) => a.timeMs - b.timeMs);
  const hit = which === 'next' ? list.find((e) => e.timeMs > timeMs + 30_000) : [...list].reverse().find((e) => e.timeMs < timeMs - 30_000);
  return hit ?? null;
}

interface Span {
  startMs: number;
  endMs: number;
}

/** Earth in front of the Sun during the window: each passage, and the part of it with the Sun entirely hidden. */
export function eclipseSpans(a: { metrics: { eclipseIntervals?: readonly Span[]; darkIntervals: readonly Span[] } }): { startMs: number; endMs: number; hidden: { startMs: number; endMs: number }[] }[] {
  return (a.metrics.eclipseIntervals ?? []).map((iv) => ({
    startMs: iv.startMs,
    endMs: iv.endMs,
    hidden: a.metrics.darkIntervals.map((d) => ({ startMs: Math.max(d.startMs, iv.startMs), endMs: Math.min(d.endMs, iv.endMs) })).filter((d) => d.endMs > d.startMs),
  }));
}

/** "05:00 to 09:51 UTC", with the date on the second time only when it differs. */
const spanUtc = (startMs: number, endMs: number): string => {
  const a = formatUtc(startMs), b = formatUtc(endMs);
  return a.slice(0, 10) === b.slice(0, 10) ? `${a.slice(0, 16)} to ${b.slice(11)}` : `${a} to ${b}`;
};

/** In words: "Earth passes in front of the Sun 2025-03-14 05:00 to 09:51 UTC; the Sun is entirely hidden 06:17 to 08:34 UTC." */
export function eclipseText(spans: ReturnType<typeof eclipseSpans>): string {
  return spans
    .map((e) => `Earth passes in front of the Sun ${spanUtc(e.startMs, e.endMs)}${e.hidden.length ? `; the Sun is entirely hidden ${e.hidden.map((h) => spanUtc(h.startMs, h.endMs).slice(11)).join(' and ')}` : ''}.`)
    .join(' ');
}
