import { describe, expect, it } from 'vitest';
import { lunarEclipseAt, moonPhaseAt, moonPhaseDetail, moonPhaseText } from './moonPhase';

const at = (text: string) => Date.parse(text);

describe('the Moon\'s phase line', () => {
  it('names the phase and the lit share of the near side', () => {
    expect(moonPhaseAt(at('2025-03-06T17:28Z'))).toEqual({ name: 'First quarter', litFromEarthPct: 51, waxing: true, lunarEclipse: null });
    expect(moonPhaseText(moonPhaseAt(at('2025-03-06T17:28Z')))).toBe('First quarter · 51% lit from Earth');
    expect(moonPhaseAt(at('2025-03-29T11:00Z'))).toMatchObject({ name: 'New Moon', lunarEclipse: null });
    // A full Moon without an eclipse (12 April 2025).
    expect(moonPhaseText(moonPhaseAt(at('2025-04-13T00:22Z')))).toBe('Full Moon · 100% lit from Earth');
  });

  it('says when the full Moon is in Earth\'s shadow: the eclipse of 14 March 2025', () => {
    // Published contacts (F. Espenak, EclipseWise, with the umbra enlarged for Earth's
    // atmosphere): penumbral from 03:57, partial from 05:09, total 06:26 to 07:32, partial
    // until 08:48, penumbral until 10:01 UTC. Geometric discs give the same phases away from
    // the contacts; the instants below keep at least a quarter of an hour from each of them.
    expect(lunarEclipseAt(at('2025-03-14T03:30Z'))).toBeNull();
    expect(lunarEclipseAt(at('2025-03-14T04:30Z'))).toBe('penumbral');
    expect(lunarEclipseAt(at('2025-03-14T05:40Z'))).toBe('partial');
    expect(lunarEclipseAt(at('2025-03-14T07:00Z'))).toBe('total');
    expect(lunarEclipseAt(at('2025-03-14T08:20Z'))).toBe('partial');
    expect(lunarEclipseAt(at('2025-03-14T09:30Z'))).toBe('penumbral');
    expect(lunarEclipseAt(at('2025-03-14T10:30Z'))).toBeNull();
    const p = moonPhaseAt(at('2025-03-14T07:00Z'));
    expect(p).toMatchObject({ name: 'Full Moon', litFromEarthPct: 100, lunarEclipse: 'total' });
    // Not "100% lit from Earth" while the Moon stands in the shadow.
    expect(moonPhaseText(p)).toBe('Full Moon · total lunar eclipse');
    expect(moonPhaseDetail(p)).toContain('the whole Moon is in Earth\'s shadow');
    expect(moonPhaseText(moonPhaseAt(at('2025-03-14T05:40Z')))).toBe('Full Moon · partial lunar eclipse');
  });

  it('finds the contacts of that eclipse within a few minutes of the published ones', () => {
    const first = (from: string, to: string, want: string | null) => {
      for (let t = at(from); t <= at(to); t += 60_000) if (lunarEclipseAt(t) === want) return new Date(t).toISOString().slice(11, 16);
      return 'never';
    };
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    const near = (found: string, published: string, tolMin: number) => expect(Math.abs(minutes(found) - minutes(published)), `${found} vs ${published}`).toBeLessThanOrEqual(tolMin);
    // Without the atmosphere's enlargement the shadow is about 2 % smaller, so the umbral contacts fall a little inside the published ones.
    near(first('2025-03-14T03:00Z', '2025-03-14T05:00Z', 'penumbral'), '03:57', 4);
    near(first('2025-03-14T04:30Z', '2025-03-14T06:00Z', 'partial'), '05:09', 4);
    near(first('2025-03-14T05:30Z', '2025-03-14T07:00Z', 'total'), '06:26', 4);
    near(first('2025-03-14T07:00Z', '2025-03-14T08:30Z', 'partial'), '07:32', 4);
    near(first('2025-03-14T08:00Z', '2025-03-14T09:30Z', 'penumbral'), '08:48', 4);
    near(first('2025-03-14T09:30Z', '2025-03-14T11:00Z', null), '10:01', 4);
  });

  it('reports no eclipse at an ordinary full Moon or away from it', () => {
    for (const t of ['2025-04-13T00:22Z', '2025-02-12T13:53Z', '2025-03-07T12:00Z', '1969-07-20T20:17Z']) expect(lunarEclipseAt(at(t)), t).toBeNull();
    // The other lunar eclipse of 2025, 7 September, total around 18:12 UTC.
    expect(lunarEclipseAt(at('2025-09-07T18:12Z'))).toBe('total');
  });
});
