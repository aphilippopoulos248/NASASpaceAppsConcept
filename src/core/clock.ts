// The simulated clock while it plays.
import { effectiveStartMs } from './scenario';
import { MAX_TIME_MS } from './store';
import type { AppState } from './types';

export interface ClockStep {
  timeMs: number;
  playing: boolean;
  /** Why this step stopped the clock, when it did. */
  stopped?: 'window-end' | 'time-limit';
}

/**
 * One step of the playing clock: `dtSeconds` of real time at the state's rate.
 *
 * A replay ends where the mission window ends: a clock that runs into the end of the window
 * stops exactly there, so a preset or a scrubbed window plays to its last moment and no
 * further. Started at or after the end (play pressed again), it runs on past it.
 */
export function advanceClock(s: Pick<AppState, 'timeMs' | 'rate' | 'windowStartMs' | 'delayH' | 'windowDurationH'>, dtSeconds: number): ClockStep {
  const windowEnd = effectiveStartMs(s) + s.windowDurationH * 3_600_000;
  const next = s.timeMs + dtSeconds * s.rate * 1000;
  if (s.timeMs < windowEnd && next >= windowEnd && windowEnd <= MAX_TIME_MS) return { timeMs: windowEnd, playing: false, stopped: 'window-end' };
  if (next >= MAX_TIME_MS) return { timeMs: MAX_TIME_MS, playing: false, stopped: 'time-limit' };
  return { timeMs: next, playing: true };
}
