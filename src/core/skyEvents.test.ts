import { describe, expect, it } from 'vitest';
import type { SkyEvent } from '../analysis/types';
import { findEvent } from './skyEvents';

const ev = (type: SkyEvent['type'], h: number) => ({ type, timeMs: h * 3_600_000, azDeg: 90 }) as SkyEvent;

describe('findEvent', () => {
  const events = [ev('sunset', 30), ev('sunrise', 10), ev('sunrise', 50), ev('earthset', 20)];
  it('finds the next and previous event of a type, in time order', () => {
    expect(findEvent(events, 'sunrise', 'next', 0)?.timeMs).toBe(10 * 3_600_000);
    expect(findEvent(events, 'sunrise', 'next', 10 * 3_600_000)?.timeMs).toBe(50 * 3_600_000);
    expect(findEvent(events, 'sunrise', 'previous', 49 * 3_600_000)?.timeMs).toBe(10 * 3_600_000);
    expect(findEvent(events, 'earthrise', 'next', 0)).toBeNull();
    expect(findEvent(events, 'sunset', 'next', 31 * 3_600_000)).toBeNull();
  });
});
