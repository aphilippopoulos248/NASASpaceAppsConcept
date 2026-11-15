// Following a spell beyond the edge of the analysed window.
//
// A darkness (or a spell without Earth in view) that touches a window edge is only known to
// last "at least" what the window shows of it. Here it is followed outward, with the in-app
// model, until the state really changes or a search limit is reached.
import { refine } from './intervals';
import type { FullSpan, Interval } from './types';

/** How far beyond a window edge a spell is followed, days. */
export const EXTEND_LIMIT_DAYS = 60;
const DAY = 86_400_000;

/**
 * Going outward from `fromMs` (dir +1 = later, -1 = earlier) through an "off" spell, finds where
 * the indicator (positive = on) first turns positive: the spell's real end (or start), refined to
 * 10 s. Gives up after `limitMs`.
 */
export function followOff(g: (t: number) => number, fromMs: number, dir: 1 | -1, limitMs: number, stepMs: number): { timeMs: number; found: boolean } {
  let prev = fromMs;
  const steps = Math.ceil(limitMs / stepMs - 1e-9);
  for (let k = 1; k <= steps; k++) {
    const t = fromMs + dir * Math.min(k * stepMs, limitMs);
    if (g(t) > 0) {
      // The state changes between prev (off) and t (on).
      return { timeMs: dir > 0 ? refine(g, prev, t, true) : refine(g, t, prev, false), found: true };
    }
    prev = t;
  }
  return { timeMs: fromMs + dir * limitMs, found: false };
}

/**
 * The "off" spans of a window measured in full. `off` are the spans as the window shows them
 * (sorted; the first may be open at the window's start, the last at its end); `indicator` must be
 * valid outside the window. Returns one FullSpan per input span.
 */
export function fullSpans(off: Interval[], indicator: (t: number) => number, stepMs: number, limitDays = EXTEND_LIMIT_DAYS): FullSpan[] {
  return off.map((iv) => {
    let startMs = iv.startMs, endMs = iv.endMs, startFound = true, endFound = true;
    if (iv.openStart) {
      const r = followOff(indicator, iv.startMs, -1, limitDays * DAY, stepMs);
      startMs = r.timeMs;
      startFound = r.found;
    }
    if (iv.openEnd) {
      const r = followOff(indicator, iv.endMs, 1, limitDays * DAY, stepMs);
      endMs = r.timeMs;
      endFound = r.found;
    }
    return { startMs, endMs, hours: (endMs - startMs) / 3_600_000, startFound, endFound, limitDays };
  });
}

/** The longest of a list of full spans (null for an empty list). A span whose end was not found counts with what is known of it. */
export function longestFull(spans: FullSpan[]): FullSpan | null {
  let best: FullSpan | null = null;
  for (const s of spans) if (!best || s.hours > best.hours) best = s;
  return best;
}
