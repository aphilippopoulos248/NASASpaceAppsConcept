import { describe, expect, it } from 'vitest';
import { advanceClock } from './clock';
import { MAX_TIME_MS } from './store';

const H = 3_600_000;
const T0 = Date.UTC(2025, 2, 14, 4, 30);
const state = (timeMs: number, rate = 600, delayH = 0) => ({ timeMs, rate, windowStartMs: T0, delayH, windowDurationH: 6 });

describe('the playing clock', () => {
  it('advances by real time multiplied by the rate', () => {
    expect(advanceClock(state(T0), 0.5)).toEqual({ timeMs: T0 + 300_000, playing: true });
  });

  it('stops exactly at the end of the mission window', () => {
    const end = T0 + 6 * H;
    expect(advanceClock(state(end - 1000), 0.1)).toEqual({ timeMs: end, playing: false, stopped: 'window-end' });
    // A step that would land exactly on the end stops there too.
    expect(advanceClock(state(end - 60_000), 0.1)).toEqual({ timeMs: end, playing: false, stopped: 'window-end' });
  });

  it('runs on when started at or after the end (play pressed again)', () => {
    const end = T0 + 6 * H;
    expect(advanceClock(state(end), 0.1)).toEqual({ timeMs: end + 60_000, playing: true });
    expect(advanceClock(state(end + H), 0.1)).toMatchObject({ playing: true });
  });

  it('counts the arrival delay into the end of the window', () => {
    const end = T0 + (6 + 24) * H;
    expect(advanceClock(state(T0 + 6 * H - 1000, 600, 24), 0.1)).toMatchObject({ playing: true });
    expect(advanceClock(state(end - 1000, 600, 24), 0.1)).toEqual({ timeMs: end, playing: false, stopped: 'window-end' });
  });

  it('runs freely before the window starts, until it enters it and reaches the end', () => {
    expect(advanceClock(state(T0 - 2 * H), 0.1)).toMatchObject({ playing: true });
    // One huge step from before the window to beyond it still stops at the end.
    expect(advanceClock(state(T0 - H, 31_536_000), 0.1)).toEqual({ timeMs: T0 + 6 * H, playing: false, stopped: 'window-end' });
  });

  it('stops at the last instant the ephemeris is validated for', () => {
    expect(advanceClock({ timeMs: MAX_TIME_MS - 1000, rate: 3600, windowStartMs: T0, delayH: 0, windowDurationH: 6 }, 0.1)).toEqual({ timeMs: MAX_TIME_MS, playing: false, stopped: 'time-limit' });
  });
});
