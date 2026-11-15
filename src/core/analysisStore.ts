// Runs the science core for the scenario under study and for the comparison slots A/B,
// and publishes idle / loading / ready / error, so every panel and the assistant read the
// same results and nothing is computed twice.
//
// Reading:  get(slot), comparison(), nearby()      what is published now (may be "loading")
// Waiting:  settled(slot), settledComparison()     resolve with the finished result of what
//                                                  the app state asks for at that moment
// A failure is published as the error state with its reason; it never turns into numbers.
import { analyse as realAnalyse, compareAnalyses as realCompare, NotImplemented, rankNearby as realRankNearby } from '../analysis/api';
import type { ComparisonDiff, NearbyCandidate, NearbyOptions, SiteAnalysis } from '../analysis/types';
import { scenarioFromState } from './scenario';
import { store as appStore, type StateKey, type Store } from './store';
import type { Scenario } from './types';

export type AnalysisSlot = 'current' | 'A' | 'B';

export type Status<T> =
  | { state: 'idle' }
  | { state: 'loading'; scenario: Scenario }
  | { state: 'ready'; scenario: Scenario; value: T }
  | { state: 'error'; scenario: Scenario; error: string; notAvailable: boolean };

export type AnalysisStatus = Status<SiteAnalysis>;
export type NearbyStatus = Status<NearbyCandidate[]> & { options?: NearbyOptions; progress?: { done: number; total: number } };

/** Both comparison slots together. `diff` is B minus A, from the science core's compareAnalyses(). */
export type ComparisonStatus =
  | { state: 'idle'; missing: ('A' | 'B')[] }
  | { state: 'loading' }
  | { state: 'error'; error: string }
  | { state: 'ready'; a: SiteAnalysis; b: SiteAnalysis; diff: ComparisonDiff };

/** Shown when a science function reports that it does not exist in this build (see NotImplemented). */
export const NOT_AVAILABLE_TEXT = 'This analysis is not part of this build of Lunyx.';

export interface AnalysisFns {
  analyse: (s: Scenario) => Promise<SiteAnalysis>;
  rankNearby: (s: Scenario, o: NearbyOptions, onProgress?: (done: number, total: number) => void) => Promise<NearbyCandidate[]>;
  compare?: (a: SiteAnalysis, b: SiteAnalysis) => ComparisonDiff;
}

const SCENARIO_KEYS: StateKey[] = ['site', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH', 'compareA', 'compareB'];
const SLOTS: readonly AnalysisSlot[] = ['current', 'A', 'B'];
/** settled() gives up after this many rounds of "the scenario changed while I was waiting". */
const MAX_ROUNDS = 40;

function describeError(err: unknown): { error: string; notAvailable: boolean } {
  if (err instanceof NotImplemented || (err instanceof Error && err.name === 'NotImplemented')) return { error: NOT_AVAILABLE_TEXT, notAvailable: true };
  return { error: err instanceof Error ? err.message : String(err), notAvailable: false };
}

/** Rounds for display in action results; null when the value does not exist (NaN). */
export function rounded(value: number, digits = 2): number | null {
  if (!Number.isFinite(value)) return null;
  const k = 10 ** digits;
  return Math.round(value * k) / k;
}

export class AnalysisStore {
  private readonly slots: Record<AnalysisSlot, AnalysisStatus> = { current: { state: 'idle' }, A: { state: 'idle' }, B: { state: 'idle' } };
  private readonly running: Partial<Record<AnalysisSlot, Promise<void>>> = {};
  private nearbyStatus: NearbyStatus = { state: 'idle' };
  private readonly tokens: Record<AnalysisSlot | 'nearby', number> = { current: 0, A: 0, B: 0, nearby: 0 };
  private readonly listeners = new Set<(slot: AnalysisSlot | 'nearby') => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private diffCache: { a: SiteAnalysis; b: SiteAnalysis; diff: ComparisonDiff } | null = null;

  constructor(
    private readonly store: Store,
    private readonly fns: AnalysisFns = { analyse: realAnalyse, rankNearby: realRankNearby, compare: realCompare },
    /** Wait this long after the last change before analysing (sliders send many changes). */
    private readonly debounceMs = 0,
  ) {}

  /** Starts following the store. Returns a promise that settles when the first refresh is done. */
  start(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = this.store.subscribe(SCENARIO_KEYS, () => this.schedule());
    return this.refresh();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** What is published for a slot right now. For up to the debounce time after a change this is still the previous scenario's result. */
  get(slot: AnalysisSlot): AnalysisStatus {
    return this.slots[slot];
  }

  nearby(): NearbyStatus {
    return this.nearbyStatus;
  }

  subscribe(fn: (slot: AnalysisSlot | 'nearby') => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The scenario the app state asks for in a slot, or null when the slot is empty. */
  wanted(slot: AnalysisSlot): Scenario | null {
    const s = this.store.get();
    return slot === 'current' ? scenarioFromState(s) : slot === 'A' ? s.compareA : s.compareB;
  }

  private schedule(): void {
    if (this.debounceMs <= 0) {
      void this.refresh();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, this.debounceMs);
  }

  /** Brings every slot in line with the app state and resolves when the analyses this starts (or joins) have finished. */
  async refresh(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await Promise.all(SLOTS.map((slot) => this.run(slot, this.wanted(slot))));
  }

  /**
   * The finished status of what the app state asks for in a slot: ready, error, or idle when
   * the slot is empty. Never "loading": it skips the debounce, waits for the analysis, and
   * starts over if the scenario changes while it waits.
   */
  async settled(slot: AnalysisSlot): Promise<AnalysisStatus> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await this.refresh();
      const want = this.wanted(slot);
      const st = this.slots[slot];
      if (!want && st.state === 'idle') return st;
      if (want && (st.state === 'ready' || st.state === 'error') && st.scenario.id === want.id) return st;
    }
    const want = this.wanted(slot);
    return want ? { state: 'error', scenario: want, error: 'The scenario kept changing, so its analysis never finished. Pause the changes and ask again.', notAvailable: false } : { state: 'idle' };
  }

  /** What is published for the pair A/B right now. */
  comparison(): ComparisonStatus {
    const missing = (['A', 'B'] as const).filter((k) => !this.wanted(k));
    if (missing.length) return { state: 'idle', missing };
    const a = this.slots.A, b = this.slots.B;
    const current = (st: AnalysisStatus, k: 'A' | 'B') => st.state !== 'idle' && st.scenario.id === this.wanted(k)!.id;
    // A slot that still shows the scenario it held before counts as loading: its analysis starts after the debounce.
    if (!current(a, 'A') || !current(b, 'B') || a.state === 'loading' || b.state === 'loading') return { state: 'loading' };
    const failed = ([['A', a], ['B', b]] as const).flatMap(([k, st]) => (st.state === 'error' ? [`${k} (${st.scenario.label}): ${st.error}`] : []));
    if (failed.length) return { state: 'error', error: failed.join(' ') };
    if (a.state !== 'ready' || b.state !== 'ready') return { state: 'loading' };
    if (!this.diffCache || this.diffCache.a !== a.value || this.diffCache.b !== b.value) {
      try {
        this.diffCache = { a: a.value, b: b.value, diff: (this.fns.compare ?? realCompare)(a.value, b.value) };
      } catch (err) {
        return { state: 'error', error: describeError(err).error };
      }
    }
    return { state: 'ready', a: a.value, b: b.value, diff: this.diffCache.diff };
  }

  /** The finished comparison: waits for both slots. Never "loading". */
  async settledComparison(): Promise<ComparisonStatus> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await Promise.all([this.settled('A'), this.settled('B')]);
      const c = this.comparison();
      if (c.state !== 'loading') return c;
    }
    return { state: 'error', error: 'The scenarios kept changing, so the comparison never finished. Pause the changes and ask again.' };
  }

  private emit(slot: AnalysisSlot | 'nearby'): void {
    for (const fn of [...this.listeners]) fn(slot);
  }

  private run(slot: AnalysisSlot, scenario: Scenario | null): Promise<void> {
    const prev = this.slots[slot];
    if (!scenario) {
      if (prev.state !== 'idle') {
        this.tokens[slot]++;
        this.slots[slot] = { state: 'idle' };
        this.emit(slot);
      }
      return Promise.resolve();
    }
    if (prev.state !== 'idle' && prev.scenario.id === scenario.id) {
      // Same analysis; only the scenario's label can differ. Keep results and names in step.
      if (prev.scenario !== scenario && prev.scenario.label !== scenario.label) {
        this.slots[slot] = prev.state === 'ready' ? { state: 'ready', scenario, value: { ...prev.value, scenario } } : { ...prev, scenario };
        this.emit(slot);
      }
      return (prev.state === 'loading' && this.running[slot]) || Promise.resolve();
    }
    const token = ++this.tokens[slot];
    this.slots[slot] = { state: 'loading', scenario };
    this.emit(slot);
    const done = (async () => {
      let next: AnalysisStatus;
      try {
        const value = await this.fns.analyse(scenario);
        next = { state: 'ready', scenario, value };
      } catch (err) {
        next = { state: 'error', scenario, ...describeError(err) };
      }
      if (token !== this.tokens[slot]) return; // superseded by a newer scenario
      // The label may have been rewritten while the analysis ran.
      const now = this.slots[slot];
      const named = now.state !== 'idle' ? now.scenario : scenario;
      this.slots[slot] = next.state === 'ready' ? { state: 'ready', scenario: named, value: next.value.scenario === named ? next.value : { ...next.value, scenario: named } } : { ...next, scenario: named };
      this.emit(slot);
    })();
    this.running[slot] = done;
    return done;
  }

  /** Ranks alternatives near the current site. Resolves with the final status; progress is published while it runs. */
  async requestNearby(options: NearbyOptions): Promise<NearbyStatus> {
    const scenario = scenarioFromState(this.store.get());
    const token = ++this.tokens.nearby;
    if (!scenario) {
      this.nearbyStatus = { state: 'idle' };
      this.emit('nearby');
      return this.nearbyStatus;
    }
    this.nearbyStatus = { state: 'loading', scenario, options };
    this.emit('nearby');
    let lastEmit = 0;
    const onProgress = (done: number, total: number) => {
      if (token !== this.tokens.nearby) return;
      this.nearbyStatus = { state: 'loading', scenario, options, progress: { done, total } };
      const t = Date.now();
      if (t - lastEmit < 100 && done < total) return;
      lastEmit = t;
      this.emit('nearby');
    };
    let next: NearbyStatus;
    try {
      next = { state: 'ready', scenario, value: await this.fns.rankNearby(scenario, options, onProgress), options };
    } catch (err) {
      next = { state: 'error', scenario, ...describeError(err), options };
    }
    if (token === this.tokens.nearby) {
      this.nearbyStatus = next;
      this.emit('nearby');
    }
    return next;
  }

  /** A small JSON summary for action results: state, scenario label, and headline metrics when ready. */
  summary(slot: AnalysisSlot): Record<string, unknown> {
    const st = this.slots[slot];
    if (st.state === 'idle') return { state: 'idle' };
    const base = { state: st.state, scenario: st.scenario.label };
    if (st.state === 'loading') return base;
    if (st.state === 'error') return { ...base, error: st.error };
    const m = st.value.metrics;
    return {
      ...base,
      illuminationPct: rounded(m.illuminationPct),
      longestDarknessH: rounded(m.longestDarknessH),
      earthVisiblePct: rounded(m.earthVisiblePct),
      longestEarthGapH: rounded(m.longestEarthGapH),
      slopeDeg: rounded(st.value.slope.slopeDeg),
      warnings: st.value.warnings,
    };
  }
}

/** The app's analysis store. Started by main.ts; panels and the assistant read from it. */
export const analysis = new AnalysisStore(appStore, undefined, 200);
