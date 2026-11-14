// On/off time spans from sampled states, with the crossings refined on a continuous indicator.
// Shared by the window metrics (Sun, Earth) and the ground-station opportunities.
import type { Interval } from './types';

const H = 3_600_000;
/** Crossing times are refined by bisection to this precision. */
export const EVENT_PRECISION_MS = 10_000;

/** Finds where a continuous indicator g(t) changes sign between two instants, to EVENT_PRECISION_MS. `up` = it becomes positive. */
export function refine(g: (t: number) => number, t0: number, t1: number, up: boolean): number {
  let a = t0, b = t1;
  while (b - a > EVENT_PRECISION_MS) {
    const m = (a + b) / 2;
    if ((g(m) > 0) === up) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

export interface Spans {
  on: Interval[];
  off: Interval[];
  crossings: { t: number; up: boolean }[];
}

/**
 * Splits [startMs, endMs] into spans where a state is on and off. The state is known at
 * `count` instants (`timeAt(i)`, increasing, the first at startMs and the last at endMs);
 * between two instants that differ, the crossing is refined on the continuous indicator g
 * (positive = on). Spans touching the window's ends are flagged open: the state continues
 * beyond the window.
 */
export function intervalsOf(stateAt: (i: number) => boolean, g: (t: number) => number, timeAt: (i: number) => number, count: number, startMs: number, endMs: number): Spans {
  const on: Interval[] = [];
  const off: Interval[] = [];
  const crossings: { t: number; up: boolean }[] = [];
  let cur = stateAt(0);
  let segStart = startMs;
  let openStart = true;
  const close = (end: number, openEnd: boolean) => {
    if (!(end > segStart)) return; // zero-length span (a crossing refined onto a window edge)
    const iv: Interval = { startMs: segStart, endMs: end };
    if (openStart) iv.openStart = true;
    if (openEnd) iv.openEnd = true;
    (cur ? on : off).push(iv);
  };
  for (let i = 1; i < count; i++) {
    const s = stateAt(i);
    if (s !== cur) {
      const t = refine(g, timeAt(i - 1), timeAt(i), s);
      close(t, false);
      crossings.push({ t, up: s });
      cur = s;
      segStart = t;
      openStart = false;
    }
  }
  close(endMs, true);
  return { on, off, crossings };
}

export const hours = (iv: Interval) => (iv.endMs - iv.startMs) / H;
export const totalHours = (list: Interval[]) => list.reduce((a, iv) => a + hours(iv), 0);

/** The longest span of a list, and whether it runs into a window edge (then it is a lower bound). */
export function longest(list: Interval[]): { h: number; open: boolean } {
  let best: Interval | null = null;
  for (const iv of list) if (!best || hours(iv) > hours(best)) best = iv;
  return best ? { h: hours(best), open: !!(best.openStart || best.openEnd) } : { h: 0, open: false };
}
