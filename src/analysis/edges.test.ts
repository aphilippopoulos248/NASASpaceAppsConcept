import { describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { analyseStack } from './api';
import { edgeSpells } from './edges';
import { fnSource, radialSource, stackOf } from './testing';

const scenario = (label: string, startIso: string, durationH: number, lat = 0, lon = 0): Scenario => ({
  id: label, label, site: { id: `pin:${lat},${lon}`, name: label, kind: 'custom', lat, lon }, mastHeightM: 2, startMs: Date.parse(startIso), durationH, stepMin: 10,
});
const smooth = stackOf(fnSource('smooth sphere', 60, () => 0));
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16);

describe('spells that run past the window edges, followed to their real ends', () => {
  it('a lunar day seen through a 3-day window: the sunlit spell in full, Earth in view beyond the search limit', async () => {
    // 0 N 0 E on a smooth Moon, 10-13 March 2025: the Sun is up the whole window.
    const a = await analyseStack(scenario('day', '2025-03-10T00:00:00Z', 72), smooth);
    const spells = edgeSpells(a);
    expect(spells.map((s) => s.list)).toEqual(['sunlit', 'earth']);
    const sun = spells[0].full;
    expect(sun.startFound && sun.endFound).toBe(true);
    // From sunrise on 7 March to the start of totality of the eclipse of 14 March (Earth in front of the Sun):
    // "sunlit" means some of the Sun shines, so the eclipse ends the spell.
    expect(iso(sun.startMs)).toBe('2025-03-07T02:09');
    expect(iso(sun.endMs)).toBe('2025-03-14T05:44');
    expect(sun.hours).toBeCloseTo(171.57, 1);
    // Earth never sets at the centre of the near side: no end within 60 days either way, "at least" 2952 h.
    const earth = spells[1].full;
    expect(earth).toMatchObject({ startFound: false, endFound: false, limitDays: 60 });
    expect(earth.hours).toBeCloseTo(60 * 24 * 2 + 72, 6);
    // Asked again: the same objects (cached per analysis).
    expect(edgeSpells(a)).toBe(spells);
  });

  it('the same instants whichever window a spell is seen from, and the night equals analyse()\'s own full darkness', async () => {
    const day = await analyseStack(scenario('day', '2025-03-10T00:00:00Z', 72), smooth);
    const eclipse = await analyseStack(scenario('eclipse', '2025-03-13T00:00:00Z', 48), smooth);
    const dusk = await analyseStack(scenario('dusk', '2025-03-20T00:00:00Z', 72), smooth);
    // The eclipse window holds the totality as a dark spell, between two sunlit spells that run past its edges.
    const [totality] = eclipse.metrics.darkIntervals;
    const [before, after] = edgeSpells(eclipse).filter((s) => s.list === 'sunlit').map((s) => s.full);
    expect(before.endMs).toBe(totality.startMs);
    expect(after.startMs).toBe(totality.endMs);
    // Followed from the other windows, the same spells end and begin within 20 s (the refinement is 10 s).
    expect(Math.abs(edgeSpells(day)[0].full.startMs - before.startMs)).toBeLessThan(20_000);
    expect(Math.abs(edgeSpells(day)[0].full.endMs - totality.startMs)).toBeLessThan(20_000);
    const [sunlit, dark] = edgeSpells(dusk);
    expect(sunlit.list).toBe('sunlit');
    expect(Math.abs(sunlit.full.startMs - totality.endMs)).toBeLessThan(20_000);
    expect(sunlit.full.endMs).toBe(dusk.metrics.sunIntervals[0].endMs); // the sunset is inside the dusk window
    // The night runs on past the window end; analyse() measured the same spell as the longest darkness.
    expect(dark.list).toBe('dark');
    expect(dark.full).toEqual(dusk.metrics.longestDarknessFull);
    expect(iso(dark.full.endMs)).toBe('2025-04-05T15:17');
  });

  it('a spell inside the window is not listed; a crater floor stays dark beyond the search limit both ways', async () => {
    // 30 days at 0 N 0 E: the spells inside the window (the eclipse, a night) are not followed, only those at the edges.
    const month = await analyseStack(scenario('month', '2025-03-01T00:00:00Z', 24 * 30), smooth);
    const spells = edgeSpells(month);
    expect(month.metrics.darkIntervals.filter((iv) => !iv.openStart && !iv.openEnd).length).toBeGreaterThan(0);
    expect(spells.length).toBeLessThanOrEqual(4);
    for (const s of spells) {
      const list = { sunlit: month.metrics.sunIntervals, dark: month.metrics.darkIntervals, earth: month.metrics.earthIntervals, earthGap: month.metrics.earthGapIntervals }[s.list];
      const iv = list[s.index];
      expect(iv.openStart || iv.openEnd).toBe(true);
      expect(s.full.startMs).toBeLessThanOrEqual(iv.startMs);
      expect(s.full.endMs).toBeGreaterThanOrEqual(iv.endMs);
    }

    // A pit 3 km deep and 4 km wide near the south pole: the Sun never clears its walls.
    const site = { lat: -89.9, lon: 0 };
    const pit = stackOf(radialSource('pit', 20, site.lat, site.lon, (d) => (d < 2000 ? -3000 : d < 4000 ? -3000 + 3000 * ((d - 2000) / 2000) : 0)));
    const floor = await analyseStack(scenario('floor', '2025-03-10T00:00:00Z', 48, site.lat, site.lon), pit);
    expect(floor.metrics.sunAnyPct).toBe(0);
    const dark = edgeSpells(floor, 5).find((s) => s.list === 'dark')!;
    expect(dark.full).toMatchObject({ startFound: false, endFound: false, limitDays: 5 });
    expect(dark.full.hours).toBeCloseTo(48 + 2 * 5 * 24, 6);
  });

  it('no elevation data at the site: nothing to follow', async () => {
    const none = await analyseStack(scenario('nowhere', '2025-03-10T00:00:00Z', 24), stackOf(fnSource('none', 60, () => 0, () => false)));
    expect(edgeSpells(none)).toEqual([]);
  });
});
