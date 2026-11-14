import { describe, expect, it } from 'vitest';
import { AutoResolution, MIN_RESOLUTION_SCALE } from './autoResolution';

/** Runs `frames` frames of `dt` seconds each, starting at `startMs`; returns the time afterwards. */
function run(r: AutoResolution, frames: number, dt: number, startMs: number): number {
  let now = startMs;
  for (let i = 0; i < frames; i++) {
    now += dt * 1000;
    r.tune(dt, now);
  }
  return now;
}

describe('automatic resolution', () => {
  it('stays at full resolution while frames are fast', () => {
    const r = new AutoResolution();
    const applied: number[] = [];
    r.attach((s) => applied.push(s));
    run(r, 600, 1 / 60, 0);
    expect(r.scale).toBe(1);
    expect(applied).toEqual([]);
    expect(r.statusText).toBe('60 fps');
  });

  it('steps down while frames are slow, but never below the floor', () => {
    const r = new AutoResolution();
    const applied: number[] = [];
    r.attach((s) => applied.push(s));
    run(r, 3000, 1 / 30, 0);
    expect(r.scale).toBe(MIN_RESOLUTION_SCALE);
    expect(applied[0]).toBeCloseTo(0.9, 10);
    expect(applied[applied.length - 1]).toBe(MIN_RESOLUTION_SCALE);
    expect(Math.min(...applied)).toBe(MIN_RESOLUTION_SCALE);
    expect(r.statusText).toBe('30 fps, 60% resolution');
  });

  it('waits five seconds after a step down before climbing back, then climbs in small steps', () => {
    const r = new AutoResolution();
    // Two checks (one every 30 frames), each a step down; the second is on the last frame.
    let now = run(r, 60, 1 / 30, 0);
    const low = r.scale;
    expect(low).toBeCloseTo(0.8, 10);
    const loweredAt = now;
    // Fast again: nothing may change inside the hold.
    while (now - loweredAt < 4900) {
      now = run(r, 30, 1 / 120, now);
      if (now - loweredAt < 4900) expect(r.scale).toBe(low);
    }
    now = run(r, 60, 1 / 120, now);
    expect(r.scale).toBeGreaterThan(low);
    expect(r.scale).toBeLessThan(low + 0.11);
    run(r, 6000, 1 / 120, now);
    expect(r.scale).toBe(1);
  });

  it('ignores stalled frames (the frame loop caps them at 0.1 s)', () => {
    const r = new AutoResolution();
    run(r, 600, 0.1, 0);
    expect(r.scale).toBe(1);
    expect(r.frameTime).toBeCloseTo(1 / 60, 10);
  });

  it('returns to full resolution on reset and tells the renderer', () => {
    const r = new AutoResolution();
    const applied: number[] = [];
    r.attach((s) => applied.push(s));
    run(r, 300, 1 / 30, 0);
    expect(r.scale).toBeLessThan(1);
    r.reset();
    expect(r.scale).toBe(1);
    expect(applied[applied.length - 1]).toBe(1);
  });
});
