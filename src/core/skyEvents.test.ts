import { describe, expect, it } from 'vitest';
import type { SkyEvent } from '../analysis/types';
import { eclipseSpans, eclipseText, EVENT_INFO, EVENT_TYPES, eventDefinitions, findEvent } from './skyEvents';

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

describe('Earth in front of the Sun, for the scrubber', () => {
  const at = (text: string) => Date.parse(text);
  const iv = (a: string, b: string) => ({ startMs: at(a), endMs: at(b), openStart: false, openEnd: false });

  it('pairs each passage with the time the Sun is entirely hidden, and says both in words', () => {
    // Blue Ghost, 14 March 2025, as the analysis reports it.
    const spans = eclipseSpans({ metrics: { eclipseIntervals: [iv('2025-03-14T05:00:38Z', '2025-03-14T09:51:06Z')], darkIntervals: [iv('2025-03-14T06:17:21Z', '2025-03-14T08:34:23Z')] } });
    expect(spans).toEqual([{ startMs: at('2025-03-14T05:00:38Z'), endMs: at('2025-03-14T09:51:06Z'), hidden: [{ startMs: at('2025-03-14T06:17:21Z'), endMs: at('2025-03-14T08:34:23Z') }] }]);
    expect(eclipseText(spans)).toBe('Earth passes in front of the Sun 2025-03-14 05:00 to 09:51 UTC; the Sun is entirely hidden 06:17 to 08:34 UTC.');
  });

  it('counts darkness only where it lies inside the passage, and copes with none', () => {
    // A night that began before the eclipse and ends inside it: only the overlap belongs to the passage.
    const spans = eclipseSpans({ metrics: { eclipseIntervals: [iv('2025-03-14T05:00Z', '2025-03-14T09:00Z')], darkIntervals: [iv('2025-03-13T20:00Z', '2025-03-14T06:00Z'), iv('2025-03-15T01:00Z', '2025-03-15T02:00Z')] } });
    expect(spans[0].hidden).toEqual([{ startMs: at('2025-03-14T05:00Z'), endMs: at('2025-03-14T06:00Z') }]);
    // A partial passage: the Sun is never entirely hidden.
    const partial = eclipseSpans({ metrics: { eclipseIntervals: [iv('2025-03-14T23:30Z', '2025-03-15T00:40Z')], darkIntervals: [] } });
    expect(eclipseText(partial)).toBe('Earth passes in front of the Sun 2025-03-14 23:30 UTC to 2025-03-15 00:40 UTC.');
    expect(eclipseSpans({ metrics: { darkIntervals: [] } })).toEqual([]);
    expect(eclipseText([])).toBe('');
  });
});
