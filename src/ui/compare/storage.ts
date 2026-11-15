// Saved comparisons: the working pair A/B (restored when the page is reloaded) and a short
// list of named pairs. Kept in localStorage as the scenarios themselves, so a saved
// comparison reloads exactly: same site reference, window, mast height, step and labels,
// with the shared clock and the requirements it was checked against.
// Anything unreadable in storage is ignored rather than trusted.
import { scenarioKey } from '../../core/scenario';
import type { Scenario, SiteRef } from '../../core/types';

/** The requirements a comparison is flagged against (AppState's names and units). */
export interface SavedRequirements {
  sunElMinDeg: number;
  sunElMaxDeg: number;
  /** Hours; null = no limit. */
  maxEarthGapH: number | null;
  slopeLimitDeg: number;
}

export interface SavedComparison {
  name: string;
  /** When it was saved, UTC ISO. */
  savedUtc: string;
  a: Scenario;
  b: Scenario;
  /** The shared clock when it was saved, UTC ms. */
  clockMs?: number;
  requirements?: SavedRequirements;
}

export type NewComparison = Omit<SavedComparison, 'savedUtc'>;

export interface CompareStorage {
  /** False when the browser gives no storage: saved comparisons then last only as long as the page. */
  readonly persistent: boolean;
  current(): { a: Scenario | null; b: Scenario | null };
  setCurrent(a: Scenario | null, b: Scenario | null): void;
  list(): SavedComparison[];
  get(name: string): SavedComparison | undefined;
  /** Saves (or replaces) a named pair and returns the list, newest first. */
  save(entry: NewComparison, nowMs?: number): SavedComparison[];
  remove(name: string): boolean;
}

export const STORAGE_KEY = 'lunyx.compare.v1';
export const MAX_SAVED = 20;
export const MAX_NAME_LENGTH = 80;

type Backend = Pick<Storage, 'getItem' | 'setItem'>;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function asSite(v: unknown): SiteRef | null {
  const s = v as Partial<SiteRef> | null;
  if (!s || typeof s !== 'object') return null;
  if (typeof s.id !== 'string' || typeof s.name !== 'string' || !isNum(s.lat) || !isNum(s.lon)) return null;
  if (s.kind !== 'landing' && s.kind !== 'custom' && s.kind !== 'candidate') return null;
  if (Math.abs(s.lat) > 90 || Math.abs(s.lon) > 360) return null;
  return { id: s.id, name: s.name, kind: s.kind, lat: s.lat, lon: s.lon };
}

/** A scenario read back from storage, or null when it is not one. Its id is worked out again from its contents. */
export function asScenario(v: unknown): Scenario | null {
  const s = v as Partial<Scenario> | null;
  if (!s || typeof s !== 'object') return null;
  const site = asSite(s.site);
  if (!site || typeof s.label !== 'string') return null;
  if (!isNum(s.mastHeightM) || s.mastHeightM < 0 || !isNum(s.startMs) || !isNum(s.durationH) || s.durationH <= 0 || !isNum(s.stepMin) || s.stepMin <= 0) return null;
  const core = { site, mastHeightM: s.mastHeightM, startMs: s.startMs, durationH: s.durationH, stepMin: s.stepMin };
  return { ...core, id: scenarioKey(core), label: s.label };
}

function asRequirements(v: unknown): SavedRequirements | undefined {
  const r = v as Partial<SavedRequirements> | null;
  if (!r || typeof r !== 'object') return undefined;
  if (!isNum(r.sunElMinDeg) || !isNum(r.sunElMaxDeg) || !(r.sunElMinDeg < r.sunElMaxDeg) || !isNum(r.slopeLimitDeg) || r.slopeLimitDeg < 0) return undefined;
  if (r.maxEarthGapH !== null && (!isNum(r.maxEarthGapH) || r.maxEarthGapH < 0)) return undefined;
  return { sunElMinDeg: r.sunElMinDeg, sunElMaxDeg: r.sunElMaxDeg, maxEarthGapH: r.maxEarthGapH, slopeLimitDeg: r.slopeLimitDeg };
}

function asSaved(v: unknown): SavedComparison | null {
  const s = v as Partial<SavedComparison> | null;
  if (!s || typeof s !== 'object' || typeof s.name !== 'string' || !s.name.trim()) return null;
  const a = asScenario(s.a), b = asScenario(s.b);
  if (!a || !b) return null;
  const requirements = asRequirements(s.requirements);
  return {
    name: s.name.trim().slice(0, MAX_NAME_LENGTH),
    savedUtc: typeof s.savedUtc === 'string' ? s.savedUtc : '',
    a,
    b,
    ...(isNum(s.clockMs) && { clockMs: s.clockMs }),
    ...(requirements && { requirements }),
  };
}

interface Stored {
  current: { a: Scenario | null; b: Scenario | null };
  saved: SavedComparison[];
}

/** `backend` is localStorage in the app; null (or one that throws) gives a store that lives in memory. */
export function createCompareStorage(backend: Backend | null): CompareStorage {
  let persistent = backend !== null;
  let data: Stored = { current: { a: null, b: null }, saved: [] };

  if (backend) {
    try {
      const raw = backend.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { current?: { a?: unknown; b?: unknown }; saved?: unknown } | null;
        data = {
          current: { a: asScenario(parsed?.current?.a), b: asScenario(parsed?.current?.b) },
          saved: (Array.isArray(parsed?.saved) ? parsed.saved : []).map(asSaved).filter((s): s is SavedComparison => s !== null).slice(0, MAX_SAVED),
        };
      }
    } catch {
      // Unreadable or blocked storage: start empty, and say so through `persistent`.
      persistent = false;
    }
  }

  const write = () => {
    if (!backend) return;
    try {
      backend.setItem(STORAGE_KEY, JSON.stringify(data));
      persistent = true;
    } catch {
      // Quota or privacy mode: keep working from memory.
      persistent = false;
    }
  };

  return {
    get persistent() {
      return persistent;
    },
    current: () => ({ ...data.current }),
    setCurrent(a, b) {
      if (data.current.a === a && data.current.b === b) return;
      data = { ...data, current: { a, b } };
      write();
    },
    list: () => [...data.saved],
    get: (name) => data.saved.find((s) => s.name === name.trim()),
    save(entry, nowMs = Date.now()) {
      const name = entry.name.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) throw new Error('A saved comparison needs a name.');
      const saved: SavedComparison = { ...entry, name, savedUtc: new Date(nowMs).toISOString() };
      data = { ...data, saved: [saved, ...data.saved.filter((s) => s.name !== name)].slice(0, MAX_SAVED) };
      write();
      return [...data.saved];
    },
    remove(name) {
      const before = data.saved.length;
      data = { ...data, saved: data.saved.filter((s) => s.name !== name.trim()) };
      if (data.saved.length === before) return false;
      write();
      return true;
    },
  };
}
