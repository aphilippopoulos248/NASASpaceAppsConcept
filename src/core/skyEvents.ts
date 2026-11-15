// Sunrise, sunset, Earthrise and Earthset events of an analysis: picking one for the scrubber
// and jumpToEvent, and saying which instant each of them is.
import type { SkyEvent } from '../analysis/types';
import { formatUtc } from './time';

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
