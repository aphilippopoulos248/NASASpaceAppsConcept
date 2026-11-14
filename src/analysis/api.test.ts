/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Scenario } from '../core/types';
import { analyse, blockageAt, clearAnalysisCache, compareAnalyses, DEFAULT_NEARBY_OPTIONS, nextEvents, rankNearby, scenarioKey } from './api';
import { setBundleReader } from './sky';

// Real terrain through the terrain module's loader (under Node it reads public/); no Web Worker here, so the
// work runs on the calling thread. The browser path differs only in where the same functions run.
setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
beforeEach(() => clearAnalysisCache());

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
    expect(a.scenario).toBe(s);
    const again = await analyse({ ...s, label: 'same, relabelled' });
    expect(again.scenario.label).toBe('same, relabelled');
    expect(again.series).toBe(a.series); // same numbers, not recomputed
    expect(scenarioKey(s)).toBe(scenarioKey({ ...s, label: 'x' }));
    // A pin at the same coordinates is a different request: it gets different terrain data.
    expect(scenarioKey(s)).not.toBe(scenarioKey({ ...s, site: { ...s.site, kind: 'custom', id: 'pin:18.56200,61.81000' } }));
  });
  it('+24 h delayed arrival and two mast heights compare cleanly', async () => {
    const a = await analyse(bg('2025-03-02T08:34:00Z', 14 * 24, 'Blue Ghost 1'));
    const b = await analyse(bg('2025-03-03T08:34:00Z', 14 * 24, 'Blue Ghost 1'));
    const d = compareAnalyses(a, b);
    console.log('delay:', d.highlights.join(' | '));
    expect(d.names).toEqual({ a: 'the earlier arrival', b: 'the arrival 24 h later' });
    expect(d.highlights.length).toBeGreaterThan(0);
    expect(d.illuminationPct).toBeLessThan(0); // the later window runs into the night of 16 March
    const m = compareAnalyses(await analyse(bg('2025-03-02T08:34:00Z', 48, 'x', 2)), await analyse(bg('2025-03-02T08:34:00Z', 48, 'x', 20)));
    expect(Number.isFinite(m.illuminationPct)).toBe(true);
    expect(m.names).toEqual({ a: 'the 2 m mast', b: 'the 20 m mast' });
  });
  it('falls back to the model outside the bundled window; 60-day window', async () => {
    const t0 = performance.now();
    const a = await analyse(bg('2025-06-01T00:00:00Z', 60 * 24));
    const ms = performance.now() - t0;
    console.log(`60-day window (model): ${ms.toFixed(0)} ms, ${a.series.n} samples, ${a.events.length} events`);
    expect(a.series.source).toBe('model');
    expect(a.series.n).toBe(8641);
    expect(a.events.filter((e) => e.type === 'sunrise').length).toBeGreaterThanOrEqual(2);
    const n = nextEvents(a, a.scenario.startMs);
    expect(n.sunrise && n.sunset).toBeTruthy();
    const blk = blockageAt(a, 'sun', n.sunset!.timeMs + 60_000);
    expect(blk.blocked).toBe(true);
    expect(blk.explanation.length).toBeGreaterThan(40);
    expect(ms).toBeLessThan(60_000);
  }, 120_000);
  it('rejects an invalid window or site with the reason', async () => {
    await expect(analyse(bg('2025-03-02T08:34:00Z', 0))).rejects.toThrow(RangeError);
    await expect(analyse({ ...bg('2025-03-02T08:34:00Z', 24), stepMin: 0 })).rejects.toThrow(/positive step/);
    await expect(analyse({ ...bg('2025-03-02T08:34:00Z', 24), site: { id: 'x', name: 'x', kind: 'custom', lat: 95, lon: 0 } })).rejects.toThrow(/latitude/);
    await expect(analyse({ ...bg('2025-03-02T08:34:00Z', 24 * 365 * 5), stepMin: 1 })).rejects.toThrow(/time samples/);
  });
  it('a custom pin without a surveyed window still gets an answer, with the coarse data named in the warnings', async () => {
    // Far side, nowhere near a catalogued site; under Node no elevation server is asked.
    const s: Scenario = { id: 'pin', label: 'Far-side pin', site: { id: 'pin:-20.00000,150.00000', name: 'Far-side pin', kind: 'custom', lat: -20, lon: 150 }, mastHeightM: 2, startMs: Date.parse('2026-01-01T00:00:00Z'), durationH: 72, stepMin: 30 };
    const a = await analyse(s);
    expect(a.metrics.earthVisiblePct).toBe(0);
    expect(Number.isFinite(a.metrics.illuminationPct)).toBe(true);
    expect(a.horizon.layers.length).toBe(1);
    expect(a.horizon.layers[0].resolutionM).toBeGreaterThan(1800);
    expect(a.warnings.join(' ')).toMatch(/Only 1895 m elevation data within 30 km/);
    expect(a.slope.baselineM).toBeGreaterThan(3000);
  });
});

describe('rankNearby() entry point', () => {
  it('scans in slices with progress, includes the reference, and remembers the result', async () => {
    const s = bg('2025-03-02T08:34:00Z', 72);
    const seen: number[] = [];
    const opts = { ...DEFAULT_NEARBY_OPTIONS, radiusM: 600, spacingM: 300 };
    const rows = await rankNearby(s, opts, (done, total) => { seen.push(done); expect(total).toBe(13); });
    expect(rows.length).toBe(13);
    expect(rows.filter((r) => r.isReference).length).toBe(1);
    expect(seen[seen.length - 1]).toBe(13);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
    // Same request again: the remembered rows, and progress still completes.
    let last = 0;
    const again = await rankNearby(s, { ...opts }, (done) => { last = done; });
    expect(again).toBe(rows);
    await Promise.resolve();
    expect(last).toBe(13);
    // Different options: a new scan.
    const other = await rankNearby(s, { ...opts, slopeLimitDeg: 0.01 });
    expect(other).not.toBe(rows);
    expect(other.filter((r) => r.rank > 0).length).toBeLessThan(rows.filter((r) => r.rank > 0).length);
  }, 120_000);
  it('rejects an invalid request with the reason', async () => {
    await expect(rankNearby(bg('2025-03-02T08:34:00Z', 0), DEFAULT_NEARBY_OPTIONS)).rejects.toThrow(RangeError);
    await expect(rankNearby(bg('2025-03-02T08:34:00Z', 24), { ...DEFAULT_NEARBY_OPTIONS, spacingM: -1 })).rejects.toThrow(/spacing/);
  });
});
