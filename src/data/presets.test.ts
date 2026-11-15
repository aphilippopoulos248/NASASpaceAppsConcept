/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBundledTable, setBundleReader } from '../analysis/sky';
import { formatUtc } from '../core/time';
import { landingDate, type Landing } from './landings';
import { parsePresets } from './presets';

const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', path), 'utf8'));
setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));

const HOUR_MS = 3_600_000;
const landings = (read('data/landings.json') as { landings: Landing[] }).landings;
const presets = parsePresets(read('data/presets.json'));

describe('the packaged mission presets', () => {
  it('are the three the app offers, each with a description and its sources', () => {
    expect(presets.map((p) => p.id)).toEqual(['blue-ghost-landing', 'im-2-landing', 'eclipse-2025-03-14']);
    for (const p of presets) {
      expect(p.title.length).toBeGreaterThan(5);
      expect(p.description).toMatch(/\.$/);
      expect(p.description).not.toContain('\n');
      expect(p.sources.length).toBeGreaterThanOrEqual(2);
      expect(p.sources.join(' ')).toContain('JPL Horizons');
    }
  });

  it('use sites from the landing catalogue', () => {
    for (const p of presets) expect(landings.some((l) => l.id === p.siteId), `${p.id}: ${p.siteId}`).toBe(true);
  });

  it('lie inside a bundled JPL Horizons table for their site, so they play without a network', async () => {
    for (const p of presets) {
      const l = landings.find((x) => x.id === p.siteId)!;
      const table = await findBundledTable({ lat: l.lat, lon: l.lon }, p.windowStartMs, p.windowStartMs + p.windowDurationH * HOUR_MS);
      expect(table, `${p.id}: no bundled table covers ${formatUtc(p.windowStartMs)} + ${p.windowDurationH} h`).not.toBeNull();
      expect(table!.siteId).toBe(p.siteId);
    }
  });

  it('start the two landings at the catalogue\'s touchdown time, for 14 days', () => {
    for (const p of presets.filter((x) => x.id.endsWith('-landing'))) {
      const l = landings.find((x) => x.id === p.siteId)!;
      expect(p.windowStartMs).toBe(landingDate(l).getTime());
      expect(p.clockMs).toBe(p.windowStartMs);
      expect(p.windowDurationH).toBe(14 * 24);
      // The date and time in the sentence are the catalogue's.
      expect(p.description).toContain(`${l.time} UTC`);
    }
  });

  it('play in well under a minute and open in the surface view', () => {
    for (const p of presets) {
      const seconds = (p.windowStartMs + p.windowDurationH * HOUR_MS - p.clockMs) / 1000 / p.rate;
      expect(seconds).toBeGreaterThan(10);
      expect(seconds).toBeLessThan(45);
      expect(p.view).toBe('surface');
      expect(p.play).toBe(true);
    }
  });

  it('the eclipse opens a few minutes before the Sun is first covered, facing Earth with the Sun beside it, and its sentence quotes its own times', () => {
    const e = presets.find((p) => p.id === 'eclipse-2025-03-14')!;
    const t = e.sunBehindEarth!;
    const lead = (t.partlyCoveredFromMs - e.clockMs) / 60_000;
    expect(lead).toBeGreaterThanOrEqual(3);
    expect(lead).toBeLessThanOrEqual(15);
    // Earth hardly moves in the lunar sky; the Sun passes behind it. Aimed a little under
    // Earth's centre so that both stand clear of the panels along the bottom of the screen.
    expect(e.look).toEqual({ towards: 'earth', fovDeg: 12, elOffsetDeg: -1.5 });
    // Everything it describes happens inside the window.
    expect(t.partlyCoveredFromMs).toBeGreaterThan(e.windowStartMs);
    expect(t.clearAgainMs).toBeLessThan(e.windowStartMs + e.windowDurationH * HOUR_MS);
    for (const ms of [t.partlyCoveredFromMs, t.entirelyHiddenFromMs, t.entirelyHiddenUntilMs, t.clearAgainMs]) expect(e.description).toContain(formatUtc(ms).slice(11, 16));
    expect(t.reported).toContain('KUT');
  });
});

describe('reading a presets file', () => {
  const good = () => structuredClone(read('data/presets.json')) as { presets: Record<string, any>[] };
  const failure = (change: (file: { presets: Record<string, any>[] }) => void): string => {
    const file = good();
    change(file);
    try {
      parsePresets(file);
    } catch (err) {
      return (err as Error).message;
    }
    return 'accepted';
  };

  it('refuses a broken preset with a sentence that names it and the field', () => {
    expect(failure((f) => (f.presets[2].clockUtc = '2025-03-14T03:00Z'))).toBe('presets.json, preset "eclipse-2025-03-14": "clockUtc" must lie inside the mission window.');
    expect(failure((f) => (f.presets[0].windowStartUtc = 'last March'))).toBe('presets.json, preset "blue-ghost-landing": "windowStartUtc" must be a UTC time such as 2025-03-14T04:52Z.');
    expect(failure((f) => (f.presets[1].id = 'blue-ghost-landing'))).toBe('presets.json, preset "blue-ghost-landing": this id is used twice.');
    expect(failure((f) => (f.presets[1].id = 'IM 2'))).toContain('"id" may hold lower-case letters, digits and hyphens only');
    expect(failure((f) => (f.presets[0].view = 'orbit'))).toContain('"view" must be "globe" or "surface"');
    expect(failure((f) => (f.presets[0].sources = []))).toContain('"sources" must list at least one sentence');
    expect(failure((f) => (f.presets[0].rateSecondsPerSecond = 0))).toContain('"rateSecondsPerSecond" must be a number from 1 to');
    expect(failure((f) => (f.presets[2].look.fovDeg = 2))).toContain('"look.fovDeg" must be a number from 4 to 100');
    expect(failure((f) => (f.presets[2].sunBehindEarth.clearAgainUtc = '2025-03-14T05:30Z'))).toContain('the four "sunBehindEarth" times must be in order');
    expect(failure((f) => delete f.presets[0].title)).toContain('"title" must be text');
    expect(() => parsePresets({})).toThrow('"presets" must be a list');
  });

  it('a globe preset cannot carry a look direction', () => {
    expect(failure((f) => (f.presets[2].view = 'globe'))).toContain('"look" is for the surface view only');
  });
});
