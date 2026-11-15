// The compare panel's actions (decision D-1): every control in the panel runs one of these
// through runAction, and the assistant gets the same list as tools. Each result is a small
// JSON object read back from real state, and resolves when what it describes is on screen:
// the panel redraws from the same stores, synchronously, before a waiting action continues.
import { DEFAULT_NEARBY_OPTIONS, outlook as realOutlook } from '../../analysis/api';
import type { Outlook, OutlookOptions } from '../../analysis/types';
import { candidateOffsets } from '../../analysis/nearby';
import { ActionError, defineAction, type ActionDef } from '../../core/actions';
import { reportComparison, scenarioFacts } from '../../core/analysisReport';
import type { AnalysisStore, NearbyStatus } from '../../core/analysisStore';
import { emitCommand } from '../../core/bus';
import { SITE_ALTITUDE_KM } from '../../core/coreActions';
import { describeScenario, hasAutoLabel, labelPair, scenarioFromState, scenarioKey, spanText } from '../../core/scenario';
import { MAX_TIME_MS, MIN_TIME_MS, type Store } from '../../core/store';
import { isoUtc } from '../../core/time';
import type { AppState, Scenario, SiteRef } from '../../core/types';
import { SCIENCE, type Science } from './model';
import { nearbyRow, nearbyView } from './nearbyView';
import { outlookResult } from './outlookView';
import { COMPARE_TABS, TABLE_SLOTS, type CompareTab, type PanelStore, type TableSlot } from './state';
import { exportFilename, passageRows, spellRows, toCsv, toJson, type ExportSide } from './windowTable';
import { MAX_NAME_LENGTH, MAX_SAVED, type CompareStorage, type SavedComparison } from './storage';

export interface CompareContext {
  store: Store;
  analysis: AnalysisStore;
  panel: PanelStore;
  storage: CompareStorage;
  /** Wall clock for the "saved" and "exported" stamps; replaceable in tests. */
  now?: () => number;
  /** Hands a finished file to the browser (a download); replaceable in tests. Without it exportResults says it cannot. */
  download?: (filename: string, mimeType: string, text: string) => void;
  /** The science core's instant lookups (the Sun's elevation at the clock for the export's requirements). */
  science?: Science;
  /** The seasonal outlook of the science core; replaceable in tests. */
  outlook?: (scenario: Scenario, options: OutlookOptions) => Promise<Outlook>;
}

/** Longest outlook the science core computes, lunar months. */
export const MAX_OUTLOOK_MONTHS = 60;

const HOUR_MS = 3_600_000;
/** The science core refuses a scan of more points than this. */
export const MAX_NEARBY_CANDIDATES = 2000;
/** Rows of the ranked list put into an action result (the panel lists more). */
const NEARBY_RESULT_ROWS = 10;
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

/** Points a scan would analyse (the site itself included): the same grid the science core uses, counted without building it when it is far too large. */
export function nearbyPointCount(radiusM: number, spacingM: number): number {
  if (!(spacingM > 0) || !(radiusM >= 0)) return NaN;
  const perSide = 2 * Math.floor(radiusM / spacingM) + 1;
  return perSide * perSide > 4 * MAX_NEARBY_CANDIDATES ? perSide * perSide : candidateOffsets(radiusM, spacingM).length;
}

export function createCompareActions(ctx: CompareContext): ActionDef<any, any>[] {
  const { store, analysis, panel, storage } = ctx;
  const state = () => store.get();
  const now = ctx.now ?? Date.now;

  const labels = () => ({ A: state().compareA?.label ?? null, B: state().compareB?.label ?? null });

  /** What the panel shows now, without waiting. */
  const panelResult = () => {
    const c = analysis.comparison();
    const tab = panel.get().tab;
    return {
      open: state().comparing, tab, ...labels(), comparison: c.state, ...(c.state === 'idle' && { emptySlots: c.missing }),
      ...(tab === 'windows' && { table: panel.get().tableSlot }),
    };
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

  let outlookToken = 0;

  const flyTo = (site: SiteRef) => {
    const delivered = emitCommand('flyTo', { lat: site.lat, lon: site.lon, altitudeKm: SITE_ALTITUDE_KM });
    // Nothing is rendering the globe (tests, headless): record where it would point.
    if (!delivered) store.set({ globeCenter: { lat: site.lat, lon: site.lon, altitudeKm: SITE_ALTITUDE_KM } });
  };

  /** The rankNearby result: the scanned site, the best alternatives, and what was left out and why. */
  const nearbyResult = (st: Extract<NearbyStatus, { state: 'ready' }>) => {
    const view = nearbyView(st.value);
    const o = st.options;
    return {
      scenario: scenarioFacts(st.scenario),
      options: o ? { radiusM: o.radiusM, spacingM: o.spacingM, slopeLimitDeg: o.slopeLimitDeg } : null,
      scanned: view.total,
      rankedCount: view.alternatives.length,
      reference: view.reference ? { ...nearbyRow(view.reference, 0), isReference: true, overSlopeLimit: view.referenceOverSlopeLimit } : null,
      betterThanReference: view.betterThanReference,
      candidates: view.alternatives.slice(0, NEARBY_RESULT_ROWS).map((a) => nearbyRow(a.candidate, a.rank)),
      rejected: view.rejected,
      ranking: 'score = mean of illuminationPct and earthVisiblePct over the mission window; rank 1 is the highest score',
      basis: view.basis,
    };
  };

  return [
    defineAction<{ tab?: CompareTab; table?: TableSlot }, unknown>({
      name: 'openCompare',
      title: 'Open the compare panel',
      description:
        'Opens the compare panel, or switches its tab, without changing any scenario. Tab "compare" shows the scenarios saved in slots A and B side by side with the differences B minus A; "nearby" the scan of nearby alternative sites (rankNearby); ' +
        '"windows" the mission-window table: every sunlit and dark spell and every spell with Earth\'s centre in view or hidden, with UTC start, end and duration, of the scenario on screen or of slot A or B (`table`; giving `table` alone opens this tab). ' +
        '"rank" the decision engine\'s "Rank sites" tab: the mission profile with its thresholds and weights, and the last ranking (findBestSites) and comparison of two sites (compareSites). ' +
        'Returns at once with what the panel shows; use `compare` to wait for the finished comparison and exportResults for the table as a file. Close the panel with stopCompare.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          tab: { type: 'string', description: 'Tab to show (default: the one shown last).', enum: COMPARE_TABS },
          table: { type: 'string', description: 'Whose mission window the window table shows: the scenario on screen ("current"), or slot "A" or "B".', enum: TABLE_SLOTS },
        },
      },
      run: ({ tab, table }) => {
        if (table) panel.set({ tableSlot: table });
        if (tab ?? (table && 'windows')) panel.set({ tab: tab ?? 'windows' });
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

    // ---------- the mission-window table as a file ----------
    defineAction<{ format: 'csv' | 'json'; slot?: TableSlot | 'AB' }, unknown>({
      name: 'exportResults',
      title: 'Download the mission-window results',
      description:
        'Downloads the mission-window results as a file. "csv": the window table, one row per spell (sunlit, dark, Earth in front of the Sun, Earth\'s centre in view, hidden) with UTC start and end, duration, the part inside the window and a note; a spell that runs past an edge of the window is given in full. Then one row per rise or set of the Sun and Earth with both ends, each named in start_instant / end_instant (for example "Sun starts setting" and "Sun fully set"), and Earth\'s centre crossings. ' +
        '"json": everything behind it: scenario, metrics (Earth by its centre and by any part of its disc), events with which instant each is and their passage, every spell, every rise and set with both ends, the requirements checked, elevation data, ephemeris, assumptions and warnings, and the differences B minus A when both slots are exported. ' +
        '`slot`: "current" (the scenario on screen), "A", "B", or "AB" for both in one file; default: the scenario the window table shows (normally the one on screen). Waits for the analyses. Returns the file name and size.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          format: { type: 'string', description: 'File format.', enum: ['csv', 'json'] },
          slot: { type: 'string', description: 'Which results: the scenario on screen, a comparison slot, or "AB" for A and B together.', enum: [...TABLE_SLOTS, 'AB'] },
        },
        required: ['format'],
      },
      run: async ({ format, slot }) => {
        if (!ctx.download) throw new ActionError('Files cannot be downloaded in this session.');
        const which = slot ?? panel.get().tableSlot;
        const slots: TableSlot[] = which === 'AB' ? ['A', 'B'] : [which];
        const sides: ExportSide[] = [];
        for (const k of slots) {
          const st = await analysis.settled(k);
          if (st.state === 'idle') throw new ActionError(k === 'current' ? 'No site is selected. Select a landing site or drop a pin first.' : `Comparison slot ${k} is empty. Save a scenario there first (saveScenario).`);
          if (st.state === 'error') throw new ActionError(`The analysis of ${k === 'current' ? 'the scenario on screen' : `slot ${k} (${st.scenario.label})`} is not available: ${st.error}`);
          if (st.state !== 'ready') throw new ActionError('The analysis has not finished. Ask again in a moment.');
          sides.push({ slot: k, analysis: st.value });
        }
        let diff = null;
        if (which === 'AB') {
          const c = await analysis.settledComparison();
          diff = c.state === 'ready' ? c.diff : null;
        }
        const science = ctx.science ?? SCIENCE;
        const t = state().timeMs;
        const text = format === 'csv' ? toCsv(sides) : toJson(sides, state(), (a) => science.blockageAt(a, 'sun', t).bodyElDeg, diff, now());
        const filename = exportFilename(sides, format);
        const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
        ctx.download(filename, mimeType, text);
        return {
          format,
          filename,
          mimeType,
          bytes: new TextEncoder().encode(text).length,
          scenarios: sides.map((x) => ({ slot: x.slot, label: x.analysis.scenario.label })),
          spells: sides.reduce((n, x) => n + spellRows(x.analysis).length, 0),
          // Rises and sets with both ends (D-8): one row each in the CSV, `passages` in the JSON.
          passages: sides.reduce((n, x) => n + passageRows(x.analysis).length, 0),
          downloaded: true,
        };
      },
    }),

    // ---------- the seasonal outlook ----------
    defineAction<{ months?: number; slot?: TableSlot }, unknown>({
      name: 'showOutlook',
      title: 'Show the seasonal outlook',
      description:
        'The long view for the site of the scenario on screen (or of slot A or B), at its mast height: sunlight % and Earth\'s centre in view % for each lunar day over the coming `months` lunar months (default 12) from its arrival, the longest darkness and Earth gap in that span, and for a mission of the scenario\'s length the planned arrival, the best and the worst arrival in the span (by score: mean of sunlight % and Earth\'s centre in view %, arrivals every 2 h) and what a slip of 1, 3, 7, 14 or 28 days changes. ' +
        'Opens the "outlook" tab of the compare panel with the chart and its table, and waits for the computation (a few seconds). Uses the in-app Sun/Earth model and one skyline throughout; no statement about power or temperature.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          months: { type: 'integer', description: 'Span, lunar months of 29.53 days (default 12).', minimum: 1, maximum: MAX_OUTLOOK_MONTHS },
          slot: { type: 'string', description: 'Whose scenario: the one on screen ("current", default), or slot "A" or "B".', enum: TABLE_SLOTS },
        },
      },
      run: async ({ months, slot }) => {
        const which = slot ?? panel.get().outlookSlot;
        const span = months ?? panel.get().outlookMonths;
        const sc = analysis.wanted(which);
        if (!sc) throw new ActionError(which === 'current' ? 'No site is selected. Select a landing site or drop a pin first.' : `Comparison slot ${which} is empty. Save a scenario there first (saveScenario).`);
        const end = sc.startMs + span * 29.530589 * 24 * HOUR_MS + sc.durationH * HOUR_MS;
        if (end > MAX_TIME_MS) throw new ActionError(`An outlook of ${span} lunar months from ${isoUtc(sc.startMs)} would run past ${isoUtc(MAX_TIME_MS)}, the end of the span the ephemeris is validated for. Ask for fewer months.`);
        const token = ++outlookToken;
        panel.set({ tab: 'outlook', outlookSlot: which, outlookMonths: span, outlook: { state: 'loading', scenario: sc, months: span } });
        store.set({ comparing: true });
        let value: Outlook;
        try {
          value = await (ctx.outlook ?? realOutlook)(sc, { months: span });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          if (token === outlookToken) panel.set({ outlook: { state: 'error', scenario: sc, months: span, error } });
          throw new ActionError(`The outlook is not available: ${error}`);
        }
        if (token === outlookToken) panel.set({ outlook: { state: 'ready', scenario: sc, months: span, value } });
        return { slot: which, ...outlookResult(value), ...(token !== outlookToken && { replacedByNewerOutlook: true }) };
      },
    }),

    // ---------- nearby alternatives ----------
    defineAction<{ radiusM?: number; spacingM?: number; slopeLimitDeg?: number }, unknown>({
      name: 'rankNearby',
      title: 'Rank nearby alternative sites',
      description:
        'Scans a square grid of candidate points around the selected site (out to `radiusM`, every `spacingM`), leaves out those steeper than the slope limit or without elevation data, analyses each of the others over the same mission window and mast height (its own skyline, sunlight and Earth line of sight), and ranks them by score: the mean of sunlight % and Earth-in-view %. ' +
        'Opens the "nearby" tab of the compare panel, shows progress, and waits for the scan (seconds; more for a wide or dense grid). Returns the site itself (`reference`), the best alternatives (`candidates`, rank 1 first, at most 10 of `rankedCount`), how many were left out and why, and what the figures rest on (`basis`: the scan is coarser than the full analysis). Follow with selectCandidate. Earth figures are geometric line of sight, not a radio link.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          radiusM: { type: 'number', description: `Search radius around the site, metres (default ${DEFAULT_NEARBY_OPTIONS.radiusM}).`, minimum: 50, maximum: 50_000 },
          spacingM: { type: 'number', description: `Spacing between candidate points, metres (default ${DEFAULT_NEARBY_OPTIONS.spacingM}).`, minimum: 10, maximum: 10_000 },
          slopeLimitDeg: { type: 'number', description: 'Steepest acceptable ground slope, degrees. Also sets the app\'s slope limit. Default: the current slope limit.', minimum: 0, maximum: 45 },
        },
      },
      run: async ({ radiusM = DEFAULT_NEARBY_OPTIONS.radiusM, spacingM = DEFAULT_NEARBY_OPTIONS.spacingM, slopeLimitDeg }) => {
        if (!state().site) throw new ActionError('No site is selected. Select a landing site or drop a pin first, then scan around it.');
        const points = nearbyPointCount(radiusM, spacingM);
        if (points > MAX_NEARBY_CANDIDATES) throw new ActionError(`A ${spacingM} m grid out to ${radiusM} m has ${points.toLocaleString('en-US')} points; a scan takes at most ${MAX_NEARBY_CANDIDATES.toLocaleString('en-US')}. Widen the spacing or shorten the radius.`);
        if (points < 2) throw new ActionError(`A ${spacingM} m grid out to ${radiusM} m holds only the site itself. Shorten the spacing or widen the radius.`);
        if (slopeLimitDeg !== undefined) store.set({ slopeLimitDeg });
        panel.set({ tab: 'nearby', nearbyRadiusM: radiusM, nearbySpacingM: spacingM });
        store.set({ comparing: true });
        const st = await analysis.requestNearby({ ...DEFAULT_NEARBY_OPTIONS, radiusM, spacingM, slopeLimitDeg: state().slopeLimitDeg });
        if (st.state === 'error') throw new ActionError(`The scan is not available: ${st.error}`);
        if (st.state !== 'ready') throw new ActionError('No site is selected. Select a landing site or drop a pin first, then scan around it.');
        // A newer scan may have replaced this one on screen while it ran: say so rather than describe a list that is not shown.
        const shown = analysis.nearby();
        const superseded = !(shown.state === 'ready' && shown.value === st.value);
        return { ...nearbyResult(st), ...(superseded && { replacedByNewerScan: true }) };
      },
    }),

    defineAction<{ rank?: number; id?: string; asB?: boolean }, unknown>({
      name: 'selectCandidate',
      title: 'Choose a nearby candidate',
      description:
        'Pins one of the alternatives of the last rankNearby scan as the site under study, by `rank` (1 = best) or by `id`, and flies the globe to it. ' +
        'With `asB: true` it is also loaded into comparison slot B over the scanned mission window and mast height (the scanned site becomes A when slot A is empty) and the comparison opens; the action then waits for both analyses and adds what `compare` returns. ' +
        'A pinned candidate gets the full analysis, which is finer than the scan, so its figures can differ slightly from the ranked list.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          rank: { type: 'integer', description: 'Rank in the last scan, 1 = best.', minimum: 1 },
          id: { type: 'string', description: 'Candidate id from the rankNearby result.' },
          asB: { type: 'boolean', description: 'Also load it as scenario B and open the comparison.' },
        },
      },
      run: async ({ rank, id, asB }) => {
        if ((rank === undefined) === (id === undefined)) throw new ActionError('Give exactly one of `rank` or `id`.');
        const st = analysis.nearby();
        if (st.state === 'loading') throw new ActionError('The scan of nearby sites is still running. Wait for rankNearby to finish.');
        if (st.state !== 'ready') throw new ActionError('There is no ranked list of nearby sites yet. Run rankNearby first.');
        const view = nearbyView(st.value);
        const hit = view.alternatives.find((a) => (rank !== undefined ? a.rank === rank : a.candidate.site.id === id));
        if (!hit) {
          if (id !== undefined && view.reference?.site.id === id) throw new ActionError('That id is the scanned site itself, not an alternative.');
          throw new ActionError(
            rank !== undefined
              ? `There is no candidate ranked ${rank}: the last scan (around ${st.scenario.site.name}) ranked ${view.alternatives.length}.`
              : `No ranked candidate of the last scan (around ${st.scenario.site.name}) has the id "${id}".`,
          );
        }
        const site = hit.candidate.site;
        if (state().view === 'surface' && state().site?.id !== site.id) store.set({ view: 'globe' });
        store.set({ site });
        flyTo(site);
        const chosen = {
          view: state().view,
          site: { id: site.id, name: site.name, kind: site.kind, latDeg: site.lat, lonDegEast: site.lon },
          candidate: nearbyRow(hit.candidate, hit.rank),
          scannedAround: st.scenario.site.name,
        };
        if (!asB) return chosen;
        // B is the candidate over the window and mast that were scanned; A stays, or is the scanned site.
        const core = { site, mastHeightM: st.scenario.mastHeightM, startMs: st.scenario.startMs, durationH: st.scenario.durationH, stepMin: st.scenario.stepMin };
        const b: Scenario = { ...core, id: scenarioKey(core), label: describeScenario(core) };
        const [la, lb] = labelPair(state().compareA ?? st.scenario, b);
        showPair(la!, lb!);
        return { ...chosen, ...(await compareResult()) };
      },
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
