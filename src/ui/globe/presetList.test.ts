/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePresets } from '../../data/presets';
import { presetTiming } from './presetList';

const presets = parsePresets(JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'presets.json'), 'utf8')));

describe('Missions to replay', () => {
  it('keeps each preset\'s data sources in presets.json, though the panel no longer lists them', () => {
    for (const p of presets) expect(p.sources.length).toBeGreaterThan(0);
  });

  it('states each preset\'s timing in one line', () => {
    expect(presets.map(presetTiming)).toEqual([
      '14 days from 2025-03-02 08:34 UTC, played in about 28 s',
      '14 days from 2025-03-06 17:28 UTC, played in about 28 s',
      '2025-03-14 04:52 UTC to 10:30 UTC, played in about 34 s',
    ]);
  });
});
