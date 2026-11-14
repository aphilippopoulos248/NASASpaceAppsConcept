import { beforeEach, describe, expect, it } from 'vitest';
import { ActionError, actionLog, defineAction, listActions, registerActions, resetActions, runAction, toolDefinitions, validateParams } from './actions';
import { Store, initialState } from './store';
import { formatDuration, formatUtc, isoUtc, parseUtc } from './time';

describe('action registry', () => {
  beforeEach(() => resetActions());

  const setHeight = (store: Store) =>
    defineAction<{ metres: number }, { mastHeightM: number }>({
      name: 'setMastHeight',
      title: 'Set mast height',
      description: 'Sets the observer height above the terrain, in metres.',
      effect: 'command',
      params: { type: 'object', properties: { metres: { type: 'number', description: 'Height in metres', minimum: 0, maximum: 100 } }, required: ['metres'] },
      run: ({ metres }) => {
        store.set({ mastHeightM: metres });
        return { mastHeightM: store.get().mastHeightM };
      },
    });

  it('runs a registered action the same way for UI and assistant, and logs both', async () => {
    const store = new Store(initialState(0));
    registerActions([setHeight(store)]);
    const fromUi = await runAction('setMastHeight', { metres: 10 }, 'ui');
    const uiState = store.get().mastHeightM;
    store.set({ mastHeightM: 2 });
    const fromAssistant = await runAction('setMastHeight', { metres: 10 }, 'assistant');
    expect(fromUi).toEqual({ ok: true, result: { mastHeightM: 10 } });
    expect(fromAssistant).toEqual(fromUi);
    expect(store.get().mastHeightM).toBe(uiState);
    expect(actionLog().map((e) => [e.name, e.origin, e.ok])).toEqual([
      ['setMastHeight', 'ui', true],
      ['setMastHeight', 'assistant', true],
    ]);
  });

  it('rejects bad parameters and unknown actions without throwing', async () => {
    const store = new Store(initialState(0));
    registerActions([setHeight(store)]);
    expect(await runAction('setMastHeight', { metres: 500 })).toEqual({ ok: false, error: 'params.metres must be at most 100' });
    expect(await runAction('setMastHeight', {})).toEqual({ ok: false, error: 'params.metres is required' });
    expect(await runAction('setMastHeight', { metres: 5, colour: 'red' })).toEqual({ ok: false, error: 'params.colour is not a known parameter' });
    expect(await runAction('nope')).toEqual({ ok: false, error: 'Unknown action "nope"' });
    expect(store.get().mastHeightM).toBe(2);
  });

  it('reports ActionError messages to the caller', async () => {
    registerActions([
      defineAction({ name: 'fail', title: 'Fail', description: 'Always fails.', effect: 'command', params: { type: 'object', properties: {} }, run: () => { throw new ActionError('No site is pinned yet.'); } }),
    ]);
    expect(await runAction('fail')).toEqual({ ok: false, error: 'No site is pinned yet.' });
  });

  it('exposes every action as a tool definition', () => {
    const store = new Store(initialState(0));
    registerActions([setHeight(store)]);
    expect(toolDefinitions().map((t) => t.name)).toEqual(listActions().map((a) => a.name));
    expect(toolDefinitions()[0].input_schema.required).toEqual(['metres']);
  });

  it('refuses duplicate and malformed names', () => {
    const store = new Store(initialState(0));
    registerActions([setHeight(store)]);
    expect(() => registerActions([setHeight(store)])).toThrow(/already registered/);
    expect(() => registerActions([{ ...setHeight(store), name: 'set.height' }])).toThrow(/Invalid action name/);
  });

  it('validates nested values', () => {
    const schema = { type: 'object', properties: { ids: { type: 'array', description: 'ids', items: { type: 'string', description: 'id', enum: ['a', 'b'] }, minItems: 1 } } } as const;
    expect(validateParams(schema, { ids: ['a', 'c'] })).toEqual(['params.ids[1] must be one of: a, b']);
    expect(validateParams(schema, { ids: [] })).toEqual(['params.ids needs at least 1 item(s)']);
    expect(validateParams(schema, { ids: ['b'] })).toEqual([]);
  });
});

describe('store', () => {
  it('notifies only listeners of keys that really changed', () => {
    const store = new Store(initialState(1000));
    const seen: string[] = [];
    store.subscribe(['timeMs'], (_s, changed) => seen.push(`time:${[...changed].join(',')}`));
    store.subscribe(['site'], () => seen.push('site'));
    store.subscribe(null, (_s, changed) => seen.push(`any:${[...changed].join(',')}`));
    store.set({ timeMs: 1000 });
    store.set({ timeMs: 2000, playing: false });
    expect(seen).toEqual(['time:timeMs', 'any:timeMs']);
    expect(store.get().timeMs).toBe(2000);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new Store(initialState(0));
    let calls = 0;
    const off = store.subscribe(['rate'], () => calls++);
    store.set({ rate: 60 });
    off();
    store.set({ rate: 120 });
    expect(calls).toBe(1);
  });
});

describe('UTC helpers', () => {
  it('parses only unambiguous UTC forms', () => {
    expect(parseUtc('2025-03-06T17:28Z')).toBe(Date.UTC(2025, 2, 6, 17, 28));
    expect(parseUtc('2025-03-06 17:28')).toBe(Date.UTC(2025, 2, 6, 17, 28));
    expect(parseUtc('2025-03-06')).toBe(Date.UTC(2025, 2, 6));
    expect(parseUtc('1969-07-20T20:17:40Z')).toBe(Date.UTC(1969, 6, 20, 20, 17, 40));
    expect(() => parseUtc('2025-02-30')).toThrow();
    expect(() => parseUtc('2025-03-06T17:28+02:00')).toThrow();
    expect(() => parseUtc('next tuesday')).toThrow();
  });

  it('formats times and durations with units', () => {
    const t = Date.UTC(2025, 2, 6, 17, 28, 5);
    expect(formatUtc(t)).toBe('2025-03-06 17:28 UTC');
    expect(formatUtc(t, true)).toBe('2025-03-06 17:28:05 UTC');
    expect(isoUtc(t)).toBe('2025-03-06T17:28Z');
    expect(formatDuration(76.2)).toBe('3 d 04 h');
    expect(formatDuration(5.2)).toBe('5 h 12 min');
    expect(formatDuration(0.13)).toBe('8 min');
    expect(formatDuration(NaN)).toBe('n/a');
  });
});
