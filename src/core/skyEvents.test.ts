import { describe, expect, it } from 'vitest';
import type { SkyEvent } from '../analysis/types';
import { EVENT_INFO, EVENT_TYPES, eventDefinitions, findEvent } from './skyEvents';

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

describe('which instant an event is (D-8)', () => {
  it('names every event by its instant, never by the bare word', () => {
    for (const type of EVENT_TYPES) {
      const info = EVENT_INFO[type];
      // "Sunset" alone does not say whether the Sun starts to set or is gone.
      expect(info.label.toLowerCase()).not.toBe(info.name.toLowerCase());
      expect(info.label).toMatch(info.body === 'sun' ? /^Sun (starts rising|fully set)$/ : /^Earth's centre (rises|sets)$/);
      expect(info.instant).toContain('terrain skyline');
      expect(info.rising).toBe(type.endsWith('rise'));
    }
  });

  it('agrees with how the science core defines them', () => {
    // src/analysis/window.ts: sunrise / sunset are the first / last moment any part of the Sun
    // stands above the skyline; Earthrise / Earthset are Earth's centre crossing it.
    expect(EVENT_INFO.sunrise.instant).toContain('first part of the Sun');
    expect(EVENT_INFO.sunset.instant).toContain('last part of the Sun');
    expect(EVENT_INFO.earthrise.instant).toContain('centre of Earth');
    expect(EVENT_INFO.earthset.instant).toContain('centre of Earth');
    expect(eventDefinitions()).toEqual({
      sunrise: "Sun starts rising: the first part of the Sun's disc appears above the terrain skyline.",
      sunset: "Sun fully set: the last part of the Sun's disc goes behind the terrain skyline.",
      earthrise: "Earth's centre rises: the centre of Earth's disc comes above the terrain skyline.",
      earthset: "Earth's centre sets: the centre of Earth's disc goes behind the terrain skyline.",
    });
  });
});
