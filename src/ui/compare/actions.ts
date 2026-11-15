// The compare panel's actions (decision D-1): every control in the panel runs one of these
// through runAction, and the assistant gets the same list as tools. Each result is a small
// JSON object read back from real state, and resolves when what it describes is on screen:
// the panel redraws from the same stores, synchronously, before a waiting action continues.
import { ActionError, defineAction, type ActionDef } from '../../core/actions';
import { reportComparison, scenarioFacts } from '../../core/analysisReport';
import type { AnalysisStore } from '../../core/analysisStore';
import { describeScenario, hasAutoLabel, labelPair, scenarioFromState, scenarioKey, spanText } from '../../core/scenario';
import { MAX_TIME_MS, MIN_TIME_MS, type Store } from '../../core/store';
import { isoUtc } from '../../core/time';
import type { AppState, Scenario } from '../../core/types';
import { COMPARE_TABS, type CompareTab, type PanelStore } from './state';
import { MAX_NAME_LENGTH, MAX_SAVED, type CompareStorage, type SavedComparison } from './storage';

export interface CompareContext {
  store: Store;
  analysis: AnalysisStore;
  panel: PanelStore;
  storage: CompareStorage;
  /** Wall clock for the "saved" stamp; replaceable in tests. */
  now?: () => number;
}

const HOUR_MS = 3_600_000;
const NO_PARAMS = { type: 'object', properties: {} } as const;
const BASIS = { type: 'string', description: 'Which scenario to start from: "A" = the one saved in slot A, "current" = the scenario on screen (it is saved as A). Default: A when it is saved, otherwise the scenario on screen.', enum: ['A', 'current'] } as const;

/** The same scenario with one thing changed. An automatic label is rewritten; a typed one is kept. */
function derived(base: Scenario, change: { startMs?: number; mastHeightM?: number }): Scenario {
  const core = { site: base.site, mastHeightM: change.mastHeightM ?? base.mastHeightM, startMs: change.startMs ?? base.startMs, durationH: base.durationH, stepMin: base.stepMin };
  return { ...core, id: scenarioKey(core), label: hasAutoLabel(base) ? describeScenario(core) : base.label };
}

/**
 * Labels for A and a B derived from it. labelPair() names two automatic labels by what differs
 * ("IM-2 Athena (earlier arrival)" / "IM-2 Athena (arrival 24 h later)"); when A carries a
 * label somebody typed, B is named after it: "Baseline (arrival 24 h later)".
 */
function labelDerived(a: Scenario, b: Scenario, whatBChanges: string): [Scenario, Scenario] {
  if (!hasAutoLabel(a)) return [a, { ...b, label: `${a.label.trim()} (${whatBChanges})`.slice(0, 120) }];
  const [la, lb] = labelPair(a, { ...b, label: describeScenario(b) });
  return [la!, lb!];
}

export function createCompareActions(ctx: CompareContext): ActionDef<any, any>[] {
  const { store, analysis, panel, storage } = ctx;
  const state = () => store.get();
  const now = ctx.now ?? Date.now;

  const labels = () => ({ A: state().compareA?.label ?? null, B: state().compareB?.label ?? null });

  /** What the panel shows now, without waiting. */
  const panelResult = () => {
    const c = analysis.comparison();
    return { open: state().comparing, tab: panel.get().tab, ...labels(), comparison: c.state, ...(c.state === 'idle' && { emptySlots: c.missing }) };
  };

  /** The finished comparison, in the shape of the `compare` action's result. */
  const compareResult = async () => {
    const outcome = reportComparison(await analysis.settledComparison());
    // Read the state again: the wait can take seconds and the slots may have changed meanwhile.
    const s = state();
    return {
      comparing: s.comparing,
      ...labels(),
      scenarioA: s.compareA ? scenarioFacts(s.compareA) : null,
      scenarioB: s.compareB ? scenarioFacts(s.compareB) : null,
      analysisA: analysis.summary('A'),
      analysisB: analysis.summary('B'),
      ...outcome,
    };
  };

  const baseScenario = (basis?: 'A' | 'current'): { scenario: Scenario; from: 'A' | 'current' } => {
    const s = state();
    if (basis !== 'current' && s.compareA) return { scenario: s.compareA, from: 'A' };
    if (basis === 'A') throw new ActionError('Slot A is empty. Save a scenario there first (saveScenario), or leave `basis` out to start from the scenario on screen.');
    const current = scenarioFromState(s);
    if (!current) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return { scenario: current, from: 'current' };
  };

  const checkWindow = (sc: Scenario) => {
    const end = sc.startMs + sc.durationH * HOUR_MS;
    if (sc.startMs < MIN_TIME_MS || end > MAX_TIME_MS) throw new ActionError(`That mission window would run from ${isoUtc(sc.startMs)} to ${isoUtc(end)}, outside ${isoUtc(MIN_TIME_MS)} to ${isoUtc(MAX_TIME_MS)} (the span the ephemeris is validated for).`);
  };

  /** Puts a pair into the slots and opens the comparison. */
  const showPair = (a: Scenario, b: Scenario, extra: Partial<AppState> = {}) => {
    panel.set({ tab: 'compare' });
    store.set({ ...extra, compareA: a, compareB: b, comparing: true });
  };

  const savedSummary = (c: SavedComparison) => ({
    name: c.name,
    savedUtc: c.savedUtc,
    A: describeScenario(c.a),
    B: describeScenario(c.b),
    ...(c.clockMs !== undefined && { clockUtc: isoUtc(c.clockMs) }),
  });

  const storageNote = () => (storage.persistent ? {} : { note: 'This browser gives the page no storage, so saved comparisons last only until the page is closed.' });

  return [
    defineAction<{ tab?: CompareTab }, unknown>({
      name: 'openCompare',
      title: 'Open the compare panel',
      description:
        'Opens the compare panel, or switches its tab, without changing any scenario. Tab "compare" shows the scenarios saved in slots A and B side by side with the differences B minus A. ' +
        'Returns at once with what the panel shows; use `compare` to wait for the finished comparison. Close the panel with stopCompare.',
      effect: 'command',
      params: { type: 'object', properties: { tab: { type: 'string', description: 'Tab to show (default: the one shown last).', enum: COMPARE_TABS } } },
      run: ({ tab }) => {
        if (tab) panel.set({ tab });
        store.set({ comparing: true });
        return panelResult();
      },
    }),

    defineAction<{ delayH?: number; basis?: 'A' | 'current' }, unknown>({
      name: 'compareDelayedArrival',
      title: 'Compare with a later arrival',
      description:
        'One step for "what if we arrive late": scenario B becomes scenario A arriving `delayH` hours later (default 24) at the same site, with the same window length and mast height, and the comparison opens with the planned schedule (A) next to the revised one (B). ' +
        'A is the scenario saved in slot A; when slot A is empty the scenario on screen is saved as A first. The scenario on screen and its own arrival delay are not changed. ' +
        'Waits for both analyses and returns what `compare` returns, plus the planned and the revised arrival.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          delayH: { type: 'number', description: 'Hours by which B arrives after A (default 24).', minimum: 0.1, maximum: 720 },
          basis: BASIS,
        },
      },
      run: async ({ delayH = 24, basis }) => {
        const base = baseScenario(basis);
        const late = derived(base.scenario, { startMs: base.scenario.startMs + delayH * HOUR_MS });
        checkWindow(late);
        const [a, b] = labelDerived(base.scenario, late, `arrival ${spanText(delayH)} later`);
        showPair(a, b);
        const result = await compareResult();
        return { ...result, basis: base.from, delayH, plannedArrivalUtc: isoUtc(a.startMs), revisedArrivalUtc: isoUtc(b.startMs) };
      },
    }),

    defineAction<{ heightAM?: number; heightBM: number; basis?: 'A' | 'current' }, unknown>({
      name: 'compareMastHeights',
      title: 'Compare two mast heights',
      description:
        'Compares two observer (antenna / solar array) heights above the ground at the same site and over the same mission window: scenario B becomes scenario A with a `heightBM` metre mast, and the comparison opens. ' +
        'With `heightAM`, A is given that height too; otherwise A keeps its own. A is the scenario saved in slot A; when slot A is empty the scenario on screen is saved as A first. The scenario on screen and its mast height are not changed. ' +
        'Waits for both analyses and returns what `compare` returns, plus the two heights.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          heightAM: { type: 'number', description: 'Mast height for A, metres above the ground (default: the height A already has).', minimum: 0, maximum: 100 },
          heightBM: { type: 'number', description: 'Mast height for B, metres above the ground.', minimum: 0, maximum: 100 },
          basis: BASIS,
        },
        required: ['heightBM'],
      },
      run: async ({ heightAM, heightBM, basis }) => {
        const base = baseScenario(basis);
        const low = heightAM === undefined || heightAM === base.scenario.mastHeightM ? base.scenario : derived(base.scenario, { mastHeightM: heightAM });
        if (low.mastHeightM === heightBM) throw new ActionError(`Both sides would have a ${heightBM} m mast. Give two different heights.`);
        const [a, b] = labelDerived(low, derived(low, { mastHeightM: heightBM }), `${heightBM} m mast`);
        showPair(a, b);
        const result = await compareResult();
        return { ...result, basis: base.from, mastHeightAM: a.mastHeightM, mastHeightBM: b.mastHeightM };
      },
    }),

    defineAction({
      name: 'swapComparison',
      title: 'Swap A and B',
      description: 'Exchanges the scenarios in comparison slots A and B, so the differences (B minus A) change sign. Waits for the comparison when both slots are filled and returns what `compare` returns.',
      effect: 'command',
      params: NO_PARAMS,
      run: async () => {
        const s = state();
        if (!s.compareA && !s.compareB) throw new ActionError('Both comparison slots are empty: there is nothing to swap.');
        const [a, b] = labelPair(s.compareB, s.compareA);
        store.set({ compareA: a, compareB: b });
        return a && b ? compareResult() : labels();
      },
    }),

    defineAction<{ slot?: 'A' | 'B' }, unknown>({
      name: 'clearComparison',
      title: 'Empty the comparison slots',
      description: 'Empties comparison slot A or B, or both when `slot` is left out. Saved comparisons (saveComparison) are not touched.',
      effect: 'command',
      params: { type: 'object', properties: { slot: { type: 'string', description: 'Slot to empty (default: both).', enum: ['A', 'B'] } } },
      run: ({ slot }) => {
        const s = state();
        const [a, b] = labelPair(slot === 'B' ? s.compareA : null, slot === 'A' ? s.compareB : null);
        store.set({ compareA: a, compareB: b });
        return labels();
      },
    }),

    defineAction<{ name?: string }, unknown>({
      name: 'saveComparison',
      title: 'Save this comparison',
      description:
        `Keeps the pair in slots A and B under a name in this browser (localStorage), together with the simulated clock and the requirements it is checked against, so loadComparison brings back exactly the same comparison later. Without a name it is called "<A> vs <B>". Saving under an existing name replaces it; at most ${MAX_SAVED} are kept.`,
      effect: 'command',
      params: { type: 'object', properties: { name: { type: 'string', description: `Name, up to ${MAX_NAME_LENGTH} characters.` } } },
      run: ({ name }) => {
        const s = state();
        const missing = [!s.compareA && 'A', !s.compareB && 'B'].filter(Boolean);
        if (!s.compareA || !s.compareB) throw new ActionError(`Slot ${missing.join(' and ')} is empty: a saved comparison holds both A and B.`);
        const clean = (name ?? `${s.compareA.label} vs ${s.compareB.label}`).trim().slice(0, MAX_NAME_LENGTH);
        if (!clean) throw new ActionError('Give the saved comparison a name.');
        const before = storage.list();
        const replaced = before.some((c) => c.name === clean);
        const dropped = !replaced && before.length >= MAX_SAVED ? before[before.length - 1].name : null;
        const list = storage.save(
          {
            name: clean,
            a: s.compareA,
            b: s.compareB,
            clockMs: s.timeMs,
            requirements: { sunElMinDeg: s.sunElMinDeg, sunElMaxDeg: s.sunElMaxDeg, maxEarthGapH: s.maxEarthGapH, slopeLimitDeg: s.slopeLimitDeg },
          },
          now(),
        );
        panel.set({ savedRevision: panel.get().savedRevision + 1 });
        return { saved: savedSummary(list[0]), replaced, ...(dropped && { droppedOldest: dropped }), count: list.length, keptInBrowserStorage: storage.persistent, ...storageNote() };
      },
    }),

    defineAction<{ name: string }, unknown>({
      name: 'loadComparison',
      title: 'Load a saved comparison',
      description:
        'Puts a saved comparison back into slots A and B exactly as it was saved (sites, arrival, window, mast heights, labels), sets the simulated clock and the requirements (solar elevation band, maximum Earth gap, slope limit) to what they were then, and opens the comparison. Waits for both analyses and returns what `compare` returns. Names are listed by listComparisons.',
      effect: 'command',
      params: { type: 'object', properties: { name: { type: 'string', description: 'Name of the saved comparison.' } }, required: ['name'] },
      run: async ({ name }) => {
        const saved = storage.get(name);
        if (!saved) {
          const names = storage.list().map((c) => `"${c.name}"`);
          throw new ActionError(`No saved comparison is called "${name.trim()}". ${names.length ? `Saved: ${names.join(', ')}.` : 'None is saved yet (saveComparison).'}`);
        }
        const clock = saved.clockMs !== undefined && saved.clockMs >= MIN_TIME_MS && saved.clockMs <= MAX_TIME_MS ? saved.clockMs : null;
        showPair(saved.a, saved.b, { ...(clock !== null && { timeMs: clock, playing: false }), ...saved.requirements });
        const result = await compareResult();
        return {
          ...result,
          loaded: saved.name,
          savedUtc: saved.savedUtc,
          restored: { clockUtc: clock !== null ? isoUtc(clock) : null, requirements: saved.requirements ?? null },
        };
      },
    }),

    defineAction<{ name: string }, unknown>({
      name: 'deleteComparison',
      title: 'Delete a saved comparison',
      description: 'Removes a saved comparison from this browser. The scenarios in slots A and B are not touched.',
      effect: 'command',
      params: { type: 'object', properties: { name: { type: 'string', description: 'Name of the saved comparison.' } }, required: ['name'] },
      run: ({ name }) => {
        if (!storage.remove(name)) throw new ActionError(`No saved comparison is called "${name.trim()}".`);
        panel.set({ savedRevision: panel.get().savedRevision + 1 });
        return { deleted: name.trim(), count: storage.list().length };
      },
    }),

    defineAction({
      name: 'listComparisons',
      title: 'List saved comparisons',
      description: 'Lists the comparisons saved in this browser, newest first: name, when it was saved (UTC), and what A and B are.',
      effect: 'query',
      params: NO_PARAMS,
      run: () => ({ comparisons: storage.list().map(savedSummary), keptInBrowserStorage: storage.persistent, ...storageNote() }),
    }),
  ];
}

/**
 * Keeps the working pair in storage: puts the stored pair back into empty slots now (call it
 * before the analysis store starts), then writes every change. Returns the unsubscribe function.
 */
export function bindWorkingPair(store: Store, storage: CompareStorage): () => void {
  const s = store.get();
  if (!s.compareA && !s.compareB) {
    const saved = storage.current();
    if (saved.a || saved.b) store.set({ compareA: saved.a, compareB: saved.b });
  }
  storage.setCurrent(store.get().compareA, store.get().compareB);
  return store.subscribe(['compareA', 'compareB'], (next) => storage.setCurrent(next.compareA, next.compareB));
}
