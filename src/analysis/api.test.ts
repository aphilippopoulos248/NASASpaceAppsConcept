/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Scenario } from '../core/types';
import { readSiteTerrain } from './testing';
import { setBundleReader } from './sky';

const loads: string[] = [];
vi.mock('../terrain/api', () => ({
  loadTerrainFor: async (site: { id: string }) => {
    loads.push(site.id);
    return readSiteTerrain(site.id);
  },
  sourceFromDescriptor: () => { throw new Error('not in tests'); },
}));
setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
const { analyse, blockageAt, compareAnalyses, nextEvents, scenarioKey } = await import('./api');

const bg = (startIso: string, durationH: number, label = 'Blue Ghost 1', mast = 2): Scenario => ({
  id: label, label, site: { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', kind: 'landing', lat: 18.562, lon: 61.81 },
  mastHeightM: mast, startMs: Date.parse(startIso), durationH, stepMin: 10,
});

describe('analyse() entry point', () => {
  it('loads terrain, uses the bundled Horizons table, caches per scenario', async () => {
    const s = bg('2025-03-02T08:34:00Z', 14 * 24);
    const a = await analyse(s);
    expect(a.series.source).toBe('horizons');
    expect(a.provenance.dem.length).toBeGreaterThan(0);
    expect(a.provenance.assumptions.join(' ')).toMatch(/line of sight only/);
    const again = await analyse({ ...s, label: 'same, relabelled' });
    expect(again.scenario.label).toBe('same, relabelled');
    expect(again.series).toBe(a.series);
    expect(loads.length).toBe(1);
    expect(scenarioKey(s)).toBe(scenarioKey({ ...s, label: 'x' }));
  });
  it('+24 h delayed arrival and two mast heights compare cleanly', async () => {
    const a = await analyse(bg('2025-03-02T08:34:00Z', 14 * 24, 'On time'));
    const b = await analyse(bg('2025-03-03T08:34:00Z', 14 * 24, '+24 h'));
    const d = compareAnalyses(a, b);
    console.log('delay:', d.highlights.join(' | '));
    expect(d.highlights.length).toBeGreaterThan(0);
    const m = compareAnalyses(await analyse(bg('2025-03-02T08:34:00Z', 48, 'mast 2 m', 2)), await analyse(bg('2025-03-02T08:34:00Z', 48, 'mast 20 m', 20)));
    expect(Number.isFinite(m.illuminationPct)).toBe(true);
  });
  it('falls back to the model outside the bundled window; 60-day window timing', async () => {
    const t0 = performance.now();
    const a = await analyse(bg('2025-06-01T00:00:00Z', 60 * 24));
    const ms = performance.now() - t0;
    console.log(`60-day window (model): ${ms.toFixed(0)} ms, ${a.series.n} samples, ${a.events.length} events`);
    expect(a.series.source).toBe('model');
    expect(a.events.filter((e) => e.type === 'sunrise').length).toBeGreaterThanOrEqual(2);
    expect(ms).toBeLessThan(5000);
    const n = nextEvents(a, a.scenario.startMs);
    expect(n.sunrise && n.sunset).toBeTruthy();
    const blk = blockageAt(a, 'sun', n.sunset!.timeMs + 60_000);
    expect(blk.blocked).toBe(true);
    expect(blk.explanation.length).toBeGreaterThan(40);
  });
  it('rejects an invalid window', async () => {
    await expect(analyse({ ...bg('2025-03-02T08:34:00Z', 0) })).rejects.toThrow(RangeError);
  });
});
