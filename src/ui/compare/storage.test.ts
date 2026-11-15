import { describe, expect, it } from 'vitest';
import { scenarioKey } from '../../core/scenario';
import type { Scenario } from '../../core/types';
import { asScenario, createCompareStorage, MAX_NAME_LENGTH, MAX_SAVED, STORAGE_KEY } from './storage';

/** localStorage as a Map. */
function fakeBackend(initial?: string) {
  const map = new Map<string, string>(initial === undefined ? [] : [[STORAGE_KEY, initial]]);
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}

const scenario = (label: string, over: Partial<Scenario> = {}): Scenario => {
  const core = { site: { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, lat: -84.79, lon: 29.2 }, mastHeightM: 2, startMs: Date.UTC(2025, 2, 6, 17, 28), durationH: 168, stepMin: 10, ...over };
  return { ...core, id: scenarioKey(core), label };
};
const A = scenario('IM-2 Athena (earlier arrival)');
const B = scenario('IM-2 Athena (arrival 24 h later)', { startMs: A.startMs + 86_400_000 });
const REQ = { sunElMinDeg: 2, sunElMaxDeg: 60, maxEarthGapH: 12, slopeLimitDeg: 8 };

describe('saved comparisons', () => {
  it('reloads the working pair and the named pairs exactly from the same backend', () => {
    const backend = fakeBackend();
    const first = createCompareStorage(backend);
    expect(first.persistent).toBe(true);
    expect(first.current()).toEqual({ a: null, b: null });
    first.setCurrent(A, B);
    first.save({ name: '  Delay study  ', a: A, b: B, clockMs: A.startMs + 3_600_000, requirements: REQ }, Date.UTC(2026, 0, 2, 3, 4, 5));

    // A new page: everything comes back from the stored text alone.
    const second = createCompareStorage(backend);
    expect(second.current()).toEqual({ a: A, b: B });
    expect(second.list()).toEqual([{ name: 'Delay study', savedUtc: '2026-01-02T03:04:05.000Z', a: A, b: B, clockMs: A.startMs + 3_600_000, requirements: REQ }]);
    expect(second.get(' Delay study ')).toEqual(second.list()[0]);
    expect(second.get('delay study')).toBeUndefined(); // names are exact
  });

  it('replaces a pair saved under the same name and keeps the newest first', () => {
    const s = createCompareStorage(fakeBackend());
    s.save({ name: 'one', a: A, b: B }, 1000);
    s.save({ name: 'two', a: B, b: A }, 2000);
    const list = s.save({ name: 'one', a: B, b: A }, 3000);
    expect(list.map((c) => c.name)).toEqual(['one', 'two']);
    expect(list[0].a).toEqual(B);
    expect(s.remove('two')).toBe(true);
    expect(s.remove('two')).toBe(false);
    expect(s.list().map((c) => c.name)).toEqual(['one']);
  });

  it('keeps a limited number of pairs and limits the length of a name', () => {
    const backend = fakeBackend();
    const s = createCompareStorage(backend);
    for (let i = 0; i < MAX_SAVED + 3; i++) s.save({ name: `pair ${i}`, a: A, b: B }, i);
    expect(s.list()).toHaveLength(MAX_SAVED);
    expect(s.list()[0].name).toBe(`pair ${MAX_SAVED + 2}`);
    expect(s.get('pair 0')).toBeUndefined();
    expect(s.save({ name: 'x'.repeat(200), a: A, b: B })[0].name).toHaveLength(MAX_NAME_LENGTH);
    expect(() => s.save({ name: '   ', a: A, b: B })).toThrow(/needs a name/);
    expect(createCompareStorage(backend).list()).toHaveLength(MAX_SAVED);
  });

  it('ignores what it cannot read instead of trusting it', () => {
    expect(createCompareStorage(fakeBackend('not json')).list()).toEqual([]);
    expect(createCompareStorage(fakeBackend('null')).current()).toEqual({ a: null, b: null });
    expect(createCompareStorage(fakeBackend('{"current":7,"saved":"x"}')).list()).toEqual([]);
    const stored = JSON.stringify({
      current: { a: { ...A, site: { ...A.site, lat: 123 } }, b: B },
      saved: [
        { name: 'good', savedUtc: 's', a: A, b: B, clockMs: 'soon', requirements: { ...REQ, sunElMinDeg: 80 } },
        { name: 'half', a: A, b: { ...B, durationH: -1 } },
        { name: '', a: A, b: B },
        { a: A, b: B },
        7,
      ],
    });
    const s = createCompareStorage(fakeBackend(stored));
    expect(s.current()).toEqual({ a: null, b: B }); // a latitude of 123 is not a site
    // The good pair is kept, without the clock and requirements that do not hold up (band 80..60).
    expect(s.list()).toEqual([{ name: 'good', savedUtc: 's', a: A, b: B }]);
  });

  it('works the identity of a stored scenario out from its contents', () => {
    const tampered = { ...A, id: 'something else', extra: 'ignored' };
    const back = asScenario(JSON.parse(JSON.stringify(tampered)))!;
    expect(back).toEqual(A);
    expect(back.id).toBe(scenarioKey(A));
    expect(asScenario({ ...A, site: { ...A.site, kind: 'crater' } })).toBeNull();
    expect(asScenario({ ...A, stepMin: 0 })).toBeNull();
    expect(asScenario({ ...A, label: 5 })).toBeNull();
    expect(asScenario(null)).toBeNull();
  });

  it('keeps working from memory, and says so, when the browser gives no storage', () => {
    const none = createCompareStorage(null);
    expect(none.persistent).toBe(false);
    none.setCurrent(A, null);
    none.save({ name: 'kept for now', a: A, b: B });
    expect(none.current()).toEqual({ a: A, b: null });
    expect(none.list()).toHaveLength(1);

    const blocked = createCompareStorage({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(blocked.persistent).toBe(false);
    blocked.save({ name: 'kept for now', a: A, b: B });
    expect(blocked.list()).toHaveLength(1);

    // Storage that reads but is full: the first failed write shows it.
    const full = createCompareStorage({ getItem: () => null, setItem: () => { throw new Error('quota'); } });
    expect(full.persistent).toBe(true);
    full.setCurrent(A, B);
    expect(full.persistent).toBe(false);
    expect(full.current()).toEqual({ a: A, b: B });
  });
});
