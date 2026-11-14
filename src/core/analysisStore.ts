// Runs the science core for the scenario under study and for the comparison slots A/B,
// and publishes idle / loading / ready / error, so every panel and the assistant read the
// same results and nothing is computed twice.
//
// Until the science core is merged, analyse() throws NotImplemented: that shows up as the
// error state with notAvailable = true ("analysis not available yet"), never as numbers.
import { analyse as realAnalyse, NotImplemented, rankNearby as realRankNearby } from '../analysis/api';
import type { NearbyCandidate, NearbyOptions, SiteAnalysis } from '../analysis/types';
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
export type NearbyStatus = Status<NearbyCandidate[]> & { options?: NearbyOptions };

export const NOT_AVAILABLE_TEXT = 'Analysis not available yet: the science core is still being built.';

export interface AnalysisFns {
  analyse: (s: Scenario) => Promise<SiteAnalysis>;
  rankNearby: (s: Scenario, o: NearbyOptions) => Promise<NearbyCandidate[]>;
}

const SCENARIO_KEYS: StateKey[] = ['site', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH', 'compareA', 'compareB'];

function describeError(err: unknown): { error: string; notAvailable: boolean } {
  if (err instanceof NotImplemented || (err instanceof Error && err.name === 'NotImplemented')) return { error: NOT_AVAILABLE_TEXT, notAvailable: true };
  return { error: err instanceof Error ? err.message : String(err), notAvailable: false };
}

export class AnalysisStore {
  private readonly slots: Record<AnalysisSlot, AnalysisStatus> = { current: { state: 'idle' }, A: { state: 'idle' }, B: { state: 'idle' } };
  private nearbyStatus: NearbyStatus = { state: 'idle' };
  private readonly tokens: Record<AnalysisSlot | 'nearby', number> = { current: 0, A: 0, B: 0, nearby: 0 };
  private readonly listeners = new Set<(slot: AnalysisSlot | 'nearby') => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly fns: AnalysisFns = { analyse: realAnalyse, rankNearby: realRankNearby },
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
  }

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

  /** Re-analyses every slot whose scenario changed. */
  async refresh(): Promise<void> {
    const s = this.store.get();
    await Promise.all([
      this.run('current', scenarioFromState(s)),
      this.run('A', s.compareA),
      this.run('B', s.compareB),
    ]);
  }

  private emit(slot: AnalysisSlot | 'nearby'): void {
    for (const fn of [...this.listeners]) fn(slot);
  }

  private async run(slot: AnalysisSlot, scenario: Scenario | null): Promise<void> {
    const prev = this.slots[slot];
    if (!scenario) {
      if (prev.state !== 'idle') {
        this.tokens[slot]++;
        this.slots[slot] = { state: 'idle' };
        this.emit(slot);
      }
      return;
    }
    if (prev.state !== 'idle' && prev.scenario.id === scenario.id) return;
    const token = ++this.tokens[slot];
    this.slots[slot] = { state: 'loading', scenario };
    this.emit(slot);
    try {
      const value = await this.fns.analyse(scenario);
      if (token !== this.tokens[slot]) return;
      this.slots[slot] = { state: 'ready', scenario, value };
    } catch (err) {
      if (token !== this.tokens[slot]) return;
      this.slots[slot] = { state: 'error', scenario, ...describeError(err) };
    }
    this.emit(slot);
  }

  /** Ranks alternatives near the current site. Resolves with the final status. */
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
    let next: NearbyStatus;
    try {
      next = { state: 'ready', scenario, value: await this.fns.rankNearby(scenario, options), options };
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
      illuminationPct: m.illuminationPct,
      longestDarknessH: m.longestDarknessH,
      earthVisiblePct: m.earthVisiblePct,
      longestEarthGapH: m.longestEarthGapH,
      slopeDeg: st.value.slope.slopeDeg,
      warnings: st.value.warnings,
    };
  }
}

/** The app's analysis store. Started by main.ts; panels and the assistant read from it. */
export const analysis = new AnalysisStore(appStore, undefined, 200);
