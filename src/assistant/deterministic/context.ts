// What a deterministic plan works with: the action registry (and nothing else), a small
// memory for follow-up requests, and helpers that wait for analyses to finish.
import { getAction, listActions, runAction, type ActionDef, type ActionOutcome } from '../../core/actions';
import { isObject, type Json } from './format';

/** The registry, as deterministic mode uses it. Tests pass a fake. */
export interface ActionApi {
  def(name: string): ActionDef<any, any> | undefined;
  list(): ActionDef<any, any>[];
  run(name: string, params: unknown): Promise<ActionOutcome>;
}

export const registryApi: ActionApi = {
  def: (name) => getAction(name),
  list: () => listActions(),
  run: (name, params) => runAction(name, params, 'assistant'),
};

/** Ends a plan with a sentence for the user (an action failed, something is missing, a question back). */
export class Halt extends Error {}

export interface SiteMemo {
  id: string;
  name: string;
  latDeg: number;
  lonDegEast: number;
}

export interface CandidateMemo {
  rank?: number;
  id?: string;
  name?: string;
  latDeg: number;
  lonDegEast: number;
}

/** What "it", "there" and "this pin" refer to in follow-up requests. */
export interface Memory {
  /** The site that was selected when alternatives were last ranked. */
  reference?: SiteMemo;
  /** The alternative last found or chosen. */
  candidate?: CandidateMemo;
}

/** How long to wait for a site analysis before giving up, and how often to look. */
const ANALYSIS_POLL_MS = 400;
const ANALYSIS_POLLS = 90;
/** How many polls an analysis may stay "idle" after a change before that is taken as final. */
const IDLE_POLLS = 6;

export class Ctx {
  constructor(
    readonly api: ActionApi,
    readonly memory: Memory,
    private readonly wait: (ms: number) => Promise<void>,
    readonly now: () => number,
  ) {}

  has(name: string): boolean {
    return Boolean(this.api.def(name));
  }

  /** Runs a registered action. Ends the plan with the action's own sentence when it fails. */
  async run(name: string, params: Json = {}): Promise<Json> {
    if (!this.has(name)) throw new Halt(`This build of Lunyx has no "${name}" action, so that is not available here.`);
    const outcome = await this.api.run(name, params);
    if (!outcome.ok) throw new Halt(outcome.error);
    return isObject(outcome.result) ? outcome.result : { value: outcome.result };
  }

  /** Reads a query action without adding to the action log. Used only while waiting. */
  private async peek(name: string, params: Json = {}): Promise<Json | null> {
    const def = this.api.def(name);
    if (!def) return null;
    try {
      const r = await def.run(params);
      return isObject(r) ? r : null;
    } catch {
      return null;
    }
  }

  state(): Promise<Json> {
    return this.run('getState');
  }

  /**
   * The finished analysis of the scenario on screen (or of comparison slot A/B).
   * Uses the `getAnalysis` query when the build has it; otherwise waits for the status
   * that `getState` reports. Ends the plan with the app's reason when there is none.
   */
  async analysis(slot: 'current' | 'A' | 'B' = 'current'): Promise<Json> {
    if (this.has('getAnalysis')) {
      const r = await this.run('getAnalysis', slot === 'current' ? {} : { slot });
      const state = r.state;
      if (state === 'error' || state === 'idle') throw new Halt(typeof r.error === 'string' ? r.error : 'No analysis is available for that scenario.');
      return r;
    }
    if (slot !== 'current') throw new Halt('Reading the analysis of a comparison slot is not available in this build.');
    // The app starts an analysis a moment after a change (it debounces), so for a short while the
    // status can still be idle, or be the finished analysis of the previous scenario. Wait that out.
    await this.wait(ANALYSIS_POLL_MS);
    for (let i = 0; i < ANALYSIS_POLLS; i++) {
      const s = await this.peek('getState');
      const a = s?.analysis;
      if (!isObject(a)) break;
      const siteName = isObject(s?.site) && typeof s.site.name === 'string' ? s.site.name : undefined;
      const stale = a.state === 'ready' && siteName !== undefined && typeof a.scenario === 'string' && !a.scenario.startsWith(siteName);
      const notStarted = a.state === 'idle' && siteName !== undefined && i < IDLE_POLLS;
      if (a.state !== 'loading' && !stale && !notStarted) break;
      await this.wait(ANALYSIS_POLL_MS);
    }
    const st = await this.state();
    const a = st.analysis;
    if (!isObject(a) || a.state === 'idle') throw new Halt('No site is selected. Select a landing site or drop a pin first.');
    if (a.state === 'loading') throw new Halt('The site analysis is still running. Ask again in a moment.');
    if (a.state === 'error') throw new Halt(typeof a.error === 'string' ? a.error : 'The site analysis is not available.');
    return a;
  }

  /**
   * Runs `compare` (or another action that opens a comparison and returns what `compare`
   * returns, such as compareDelayedArrival) and waits until both sides have finished
   * analysing. The compare panel shows its A/B tab for each of them itself.
   */
  async comparison(action = 'compare', params: Json = {}): Promise<Json> {
    let r = await this.run(action, params);
    const pending = (v: Json, allowIdle: boolean) =>
      (['A', 'B'] as const).some((tag) => {
        const a = v[`analysis${tag}`];
        if (!isObject(a)) return false;
        if (a.state === 'loading') return true;
        // Just saved: the analysis has not started yet (the app debounces).
        if (a.state === 'idle') return allowIdle;
        // A finished analysis of the scenario that was in this slot before is not the answer.
        return a.state === 'ready' && typeof v[tag] === 'string' && typeof a.scenario === 'string' && a.scenario !== v[tag];
      });
    for (let i = 0; i < ANALYSIS_POLLS && pending(r, i < IDLE_POLLS); i++) {
      await this.wait(ANALYSIS_POLL_MS);
      const again = await this.peek('compare');
      // Keep what the first action added (planned arrival, mast heights) beside the settled sides.
      r = again ? { ...r, ...again } : r;
    }
    return r;
  }
}
