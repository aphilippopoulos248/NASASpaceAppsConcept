import { describe, expect, it } from 'vitest';
import { describeScenario, effectiveStartMs, hasAutoLabel, labelPair, scenarioFromState, spanText } from './scenario';
import { initialState } from './store';
import type { Scenario, SiteRef } from './types';

const IM2: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 };
const T = Date.UTC(2025, 2, 6, 17, 28);
const H = 3_600_000;

const scenario = (over: Partial<Scenario> = {}, site: SiteRef = IM2): Scenario => {
  const s = { ...initialState(T), site, ...('startMs' in over ? { windowStartMs: over.startMs! } : {}), ...('mastHeightM' in over ? { mastHeightM: over.mastHeightM! } : {}), ...('durationH' in over ? { windowDurationH: over.durationH! } : {}) };
  return scenarioFromState(s, over.label)!;
};

describe('scenario from state', () => {
  it('starts at the planned start plus the delay and describes itself in full', () => {
    const s = { ...initialState(T), site: IM2, delayH: 24 };
    expect(effectiveStartMs(s)).toBe(T + 24 * H);
    const sc = scenarioFromState(s)!;
    expect(sc).toMatchObject({ startMs: T + 24 * H, durationH: 24, mastHeightM: 2, stepMin: 10, id: `im-2|2|${T + 24 * H}|24|10` });
    expect(sc.label).toBe('IM-2 Athena, arrival 2025-03-07 17:28 UTC, 24 h window, 2 m mast');
    expect(describeScenario(sc)).toBe(sc.label);
    expect(scenarioFromState(initialState(T))).toBeNull();
    expect(scenarioFromState(s, '  late  ')!.label).toBe('late');
  });

  it('writes spans of time the way a person would', () => {
    expect([0.5, 1, 24, 37.5, 48, 72, 100, 708].map((h) => spanText(h))).toEqual(['30 min', '1 h', '24 h', '37.5 h', '2 days', '3 days', '100 h', '29.5 days']);
    expect(spanText(-24)).toBe('24 h');
    expect([24, 72].map((h) => spanText(h, true))).toEqual(['24 h', '3-day']);
  });
});

describe('comparison labels', () => {
  it('names different sites by their names', () => {
    const pin: SiteRef = { id: 'pin:-84.80000,29.50000', name: 'Pin 84.800° S, 29.500° E', kind: 'custom', lat: -84.8, lon: 29.5 };
    const [a, b] = labelPair(scenario(), scenario({}, pin));
    expect([a!.label, b!.label]).toEqual(['IM-2 Athena', 'Pin 84.800° S, 29.500° E']);
  });

  it('says what differs when the site is the same: arrival, mast, window', () => {
    const names = (x: Scenario, y: Scenario) => labelPair(x, y).map((s) => s!.label);
    expect(names(scenario(), scenario({ startMs: T + 24 * H }))).toEqual(['IM-2 Athena (earlier arrival)', 'IM-2 Athena (arrival 24 h later)']);
    expect(names(scenario({ startMs: T + 72 * H }), scenario())).toEqual(['IM-2 Athena (arrival 3 days later)', 'IM-2 Athena (earlier arrival)']);
    expect(names(scenario(), scenario({ mastHeightM: 10 }))).toEqual(['IM-2 Athena (2 m mast)', 'IM-2 Athena (10 m mast)']);
    expect(names(scenario(), scenario({ durationH: 72 }))).toEqual(['IM-2 Athena (24 h window)', 'IM-2 Athena (3-day window)']);
    expect(names(scenario(), scenario({ startMs: T + 12 * H, mastHeightM: 10 }))).toEqual(['IM-2 Athena (earlier arrival, 2 m mast)', 'IM-2 Athena (arrival 12 h later, 10 m mast)']);
    expect(names(scenario(), scenario())).toEqual(['IM-2 Athena (A)', 'IM-2 Athena (B)']);
  });

  it('tells two pins with the same rounded name apart by their coordinates', () => {
    const p1: SiteRef = { id: 'pin:-89.45001,136.70000', name: 'Pin 89.450° S, 136.700° E', kind: 'custom', lat: -89.45001, lon: 136.7 };
    const p2: SiteRef = { id: 'pin:-89.45032,136.70000', name: 'Pin 89.450° S, 136.700° E', kind: 'custom', lat: -89.45032, lon: 136.7 };
    const [a, b] = labelPair(scenario({}, p1), scenario({}, p2));
    expect(a!.label).toBe('Pin 89.450° S, 136.700° E (89.45001° S, 136.70000° E)');
    expect(b!.label).toBe('Pin 89.450° S, 136.700° E (89.45032° S, 136.70000° E)');
  });

  it('keeps typed labels, renames automatic ones again when the other side changes, and is stable', () => {
    const late = scenario({ startMs: T + 24 * H, label: 'late' });
    const [a, b] = labelPair(scenario(), late);
    expect([a!.label, b!.label]).toEqual(['IM-2 Athena', 'late']);
    expect(b).toBe(late); // untouched objects are returned as they are
    expect(hasAutoLabel(a!)).toBe(true);
    expect(hasAutoLabel(b!)).toBe(false);

    const [a1, b1] = labelPair(scenario(), scenario({ startMs: T + 24 * H }));
    const again = labelPair(a1, b1);
    expect(again[0]).toBe(a1);
    expect(again[1]).toBe(b1);
    // B is replaced by a taller mast at the original time: A's name follows.
    const [a2, b2] = labelPair(a1, scenario({ mastHeightM: 10 }));
    expect([a2!.label, b2!.label]).toEqual(['IM-2 Athena (2 m mast)', 'IM-2 Athena (10 m mast)']);
    // The same typed label on both sides still has to be told apart.
    const twins = labelPair(scenario({ label: 'plan' }), scenario({ startMs: T + 24 * H, label: 'plan' }));
    expect(twins.map((s) => s!.label)).toEqual(['plan (earlier arrival)', 'plan (arrival 24 h later)']);
  });

  it('names a single filled slot after its site', () => {
    const [a, b] = labelPair(scenario(), null);
    expect(a!.label).toBe('IM-2 Athena');
    expect(b).toBeNull();
    expect(labelPair(null, null)).toEqual([null, null]);
  });
});
