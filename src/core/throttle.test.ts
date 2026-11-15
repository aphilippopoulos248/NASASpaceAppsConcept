import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());
  const now = () => Date.now();

  it('runs the first request at once', () => {
    const run = vi.fn();
    const t = throttle(run, 250, now);
    t();
    expect(run).toHaveBeenCalledTimes(1);
    expect(t.pending).toBe(false);
  });

  it('draws the last value: a request inside the interval runs once when the interval ends', () => {
    // The bug this replaces: two quick clock changes left the first time on screen.
    let clock = 0;
    const drawn: number[] = [];
    const t = throttle(() => drawn.push(clock), 250, now);
    clock = 1;
    t();
    vi.advanceTimersByTime(40);
    clock = 2;
    t();
    vi.advanceTimersByTime(40);
    clock = 3;
    t();
    expect(drawn).toEqual([1]);
    expect(t.pending).toBe(true);
    vi.advanceTimersByTime(169);
    expect(drawn).toEqual([1]);
    vi.advanceTimersByTime(1);
    // One trailing run, with the value as it is when it runs.
    expect(drawn).toEqual([1, 3]);
    expect(t.pending).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(drawn).toEqual([1, 3]);
  });

  it('keeps to the interval while requests keep coming (a running clock)', () => {
    const run = vi.fn();
    const t = throttle(run, 250, now);
    for (let ms = 0; ms < 1000; ms += 16) {
      t();
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(250);
    // About four a second, and never more than one per interval.
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(run.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('runs at once again after a quiet spell', () => {
    const run = vi.fn();
    const t = throttle(run, 250, now);
    t();
    vi.advanceTimersByTime(251);
    t();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the waiting run', () => {
    const run = vi.fn();
    const t = throttle(run, 250, now);
    t();
    t();
    t.cancel();
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(t.pending).toBe(false);
  });
});
