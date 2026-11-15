/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePresets } from '../../data/presets';
import { loadedText, presetCaveats, presetTiming } from './presetList';

const presets = parsePresets(JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'presets.json'), 'utf8')));

describe('Missions to replay', () => {
  it('keeps each preset\'s data sources in presets.json, though the panel no longer lists them', () => {
    for (const p of presets) expect(p.sources.length).toBeGreaterThan(0);
  });

  it('says on screen that a preset loaded, and what in it is uncertain or computed (lunyx-experience batch 16)', () => {
    const byId = new Map(presets.map((p) => [p.id, p]));
    const bg = byId.get('blue-ghost-landing')!, im2 = byId.get('im-2-landing')!, ecl = byId.get('eclipse-2025-03-14')!;
    expect(loadedText(bg, { playing: true })).toBe('Playing "Blue Ghost Mission 1, Mare Crisium". It stops at the end of the window; pause or scrub at any time.');
    expect(loadedText(bg, { playing: false })).toBe('"Blue Ghost Mission 1, Mare Crisium" is loaded.');
    expect(loadedText(im2, { playing: true })).toMatch(/^Playing "IM-2 Athena, Mons Mouton"\. .* The touchdown minute is not confirmed by an official source \(NASA: about 11:30 a\.m\. CST, 17:30 UTC\)\.$/);
    expect(loadedText(ecl, { playing: true })).toMatch(/computed by this app from geometric discs .* Reported for the lander \(KUT Radio/);
    // A note from loadPreset (the clock was not started) comes first, the caveats still follow.
    expect(loadedText(im2, { playing: false, note: 'Not started.' })).toMatch(/^Not started\. The touchdown minute/);
    // Each caveat is also in its source sentences: nothing new is claimed.
    expect(presetCaveats(bg)).toEqual([]);
    expect(im2.sources.join(' ')).toContain('the touchdown minute is not confirmed by an official source (NASA: about 11:30 a.m. CST, 17:30 UTC)');
    expect(ecl.sources.join(' ')).toContain('computed by the app from geometric discs');
  });

  it('states each preset\'s timing in one line', () => {
    expect(presets.map(presetTiming)).toEqual([
      '14 days from 2025-03-02 08:34 UTC, played in about 28 s',
      '14 days from 2025-03-06 17:28 UTC, played in about 28 s',
      '2025-03-14 04:52 UTC to 10:30 UTC, played in about 34 s',
    ]);
  });
});
