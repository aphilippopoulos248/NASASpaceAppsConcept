/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePresets } from '../../data/presets';
import { presetTiming, sourcesLabel } from './presetList';

const presets = parsePresets(JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'presets.json'), 'utf8')));

describe('Missions to replay', () => {
  it('names each "Timing and data sources" disclosure after its preset (A-6)', () => {
    const names = presets.map(sourcesLabel);
    expect(names).toEqual([
      'Timing and data sources of Blue Ghost Mission 1, Mare Crisium',
      'Timing and data sources of IM-2 Athena, Mons Mouton',
      'Timing and data sources of Eclipse of 14 March 2025 at the Blue Ghost site',
    ]);
    // Distinct, and each starts with the visible text so speech input still finds it.
    expect(new Set(names).size).toBe(presets.length);
    for (const n of names) expect(n.startsWith('Timing and data sources')).toBe(true);
  });

  it('states each preset\'s timing in one line', () => {
    expect(presets.map(presetTiming)).toEqual([
      '14 days from 2025-03-02 08:34 UTC, played in about 28 s',
      '14 days from 2025-03-06 17:28 UTC, played in about 28 s',
      '2025-03-14 04:52 UTC to 10:30 UTC, played in about 34 s',
    ]);
  });
});
