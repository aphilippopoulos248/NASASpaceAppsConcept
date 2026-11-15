import { describe, expect, it } from 'vitest';
import type { SkyEvent, SkyTransition } from '../analysis/types';
import { eclipseSpans, eclipseText, edgeLabel, EVENT_INFO, EVENT_TYPES, eventDefinitions, eventInstant, findEvent, findInstant, nextInstantOfType, spanReport } from './skyEvents';

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

describe('both ends of a passage (D-8, science core T-31)', () => {
  const at = (text: string) => Date.parse(text);
  const instant = (text: string, inWindow = true) => ({ timeMs: at(text), azDeg: 264.6, inWindow });
  const set = (body: 'sun' | 'earth', from: string, to: string, kind: SkyTransition['kind'] = 'set'): SkyTransition => ({
    body,
    kind,
    start: { ...instant(from), edge: kind === 'rise' || kind === 'peek' ? 'first-limb' : 'first-cut' },
    end: { ...instant(to), edge: kind === 'rise' || kind === 'graze' ? 'whole-clear' : 'last-limb' },
    hours: (at(to) - at(from)) / 3_600_000,
    centre: [],
    minVisibleFraction: NaN,
    maxVisibleFraction: NaN,
    limitDays: 60,
  });
  // Blue Ghost at 2 m, 16 March 2025: first cut 18:23, last limb (the sunset event) 19:30 UTC.
  const sunsetPass = set('sun', '2025-03-16T18:23:36Z', '2025-03-16T19:30:00Z');
  const sunset: SkyEvent = { type: 'sunset', timeMs: sunsetPass.end.timeMs, azDeg: 264.6, span: sunsetPass };
  const risePass = set('sun', '2025-03-30T10:00:00Z', '2025-03-30T11:10:00Z', 'rise');
  const sunrise: SkyEvent = { type: 'sunrise', timeMs: risePass.start.timeMs, azDeg: 95, span: risePass };

  it('names each end in the words of the contract, and grazes and peeks as neither set nor rise', () => {
    expect([edgeLabel(sunsetPass, 'start'), edgeLabel(sunsetPass, 'end')]).toEqual(['Sun starts setting', 'Sun fully set']);
    expect([edgeLabel(risePass, 'start'), edgeLabel(risePass, 'end')]).toEqual(['Sun starts rising', 'Sun fully risen']);
    const graze = set('earth', '2025-03-18T06:25:00Z', '2025-03-18T09:00:00Z', 'graze');
    expect([edgeLabel(graze, 'start'), edgeLabel(graze, 'end')]).toEqual(['Earth partly hidden', "Earth's whole disc clear again"]);
    const unresolved: SkyTransition = { ...sunsetPass, kind: 'unresolved', end: { ...sunsetPass.end, edge: 'unresolved', inWindow: false } };
    expect(edgeLabel(unresolved, 'end')).toBeNull();
  });

  it('reports a passage as plain JSON with both ends and the D-8 sentence', () => {
    const r = spanReport(sunsetPass);
    expect(r).toMatchObject({
      body: 'sun',
      kind: 'set',
      start: { edge: 'first-cut', label: 'Sun starts setting', timeUtc: '2025-03-16T18:23Z', inWindow: true },
      end: { edge: 'last-limb', label: 'Sun fully set', timeUtc: '2025-03-16T19:30Z', inWindow: true },
      hours: 1.11,
      summary: 'starts setting 2025-03-16 18:23, fully set 19:30 UTC',
    });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    // An end that was not found has no time.
    const open: SkyTransition = { ...sunsetPass, kind: 'unresolved', end: { ...sunsetPass.end, edge: 'unresolved', inWindow: false } };
    expect(spanReport(open).end).toEqual({ edge: 'unresolved', label: null, timeUtc: null, inWindow: false });
  });

  it('finds the start, the end or the event itself, next or previous', () => {
    const events = [sunset, sunrise];
    const t = at('2025-03-16T12:00:00Z');
    expect(findInstant(events, 'sunset', 'start', 'next', t)).toMatchObject({ choice: 'start', label: 'Sun starts setting', timeMs: at('2025-03-16T18:23:36Z') });
    expect(findInstant(events, 'sunset', 'event', 'next', t)).toMatchObject({ choice: 'event', label: 'Sun fully set', timeMs: at('2025-03-16T19:30:00Z') });
    expect(findInstant(events, 'sunset', 'end', 'next', t)?.timeMs).toBe(at('2025-03-16T19:30:00Z'));
    expect(findInstant(events, 'sunrise', 'end', 'next', t)).toMatchObject({ label: 'Sun fully risen', timeMs: at('2025-03-30T11:10:00Z') });
    // Between the two ends of the sunset, the previous start and the next end.
    const mid = at('2025-03-16T19:00:00Z');
    expect(findInstant(events, 'sunset', 'start', 'previous', mid)?.timeMs).toBe(at('2025-03-16T18:23:36Z'));
    expect(findInstant(events, 'sunset', 'start', 'next', mid)).toBeNull();
    // An event without a passage has no start or end to go to.
    expect(eventInstant({ type: 'sunset', timeMs: 0, azDeg: 0 }, 'start')).toBeNull();
  });

  it('the jump buttons go to each end in turn', () => {
    const events = [sunset, sunrise];
    let t = at('2025-03-16T12:00:00Z');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const x = nextInstantOfType(events, 'sunset', t);
      if (!x) break;
      seen.push(`${x.label} ${new Date(x.timeMs).toISOString().slice(11, 16)}`);
      t = x.timeMs;
    }
    expect(seen).toEqual(['Sun starts setting 18:23', 'Sun fully set 19:30']);
    expect(nextInstantOfType(events, 'sunrise', at('2025-03-20T00:00Z'))).toMatchObject({ choice: 'event', label: 'Sun starts rising' });
    expect(nextInstantOfType(events, 'sunrise', at('2025-03-30T10:30Z'))).toMatchObject({ choice: 'end', label: 'Sun fully risen' });
  });
});
