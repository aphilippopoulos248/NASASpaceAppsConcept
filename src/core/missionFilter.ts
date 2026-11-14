// Which catalogued landings are shown: program, country, crewed/robotic and year range.
// Kept beside the app store (not in AppState, which is a shared contract) and changed only
// through the setFilters action.
import type { Landing } from '../data/landings';

export type MissionType = 'all' | 'crewed' | 'robotic';

export interface MissionFilter {
  /** Programs shown; null = all. */
  programs: readonly string[] | null;
  /** Countries shown; null = all. */
  countries: readonly string[] | null;
  type: MissionType;
  /** Inclusive year range; null = open. */
  fromYear: number | null;
  toYear: number | null;
}

export const ALL_MISSIONS: MissionFilter = { programs: null, countries: null, type: 'all', fromYear: null, toYear: null };

export const landingYear = (l: Landing): number => Number(l.date.slice(0, 4));

export function matchesFilter(f: MissionFilter, l: Landing): boolean {
  const y = landingYear(l);
  return (
    (f.programs === null || f.programs.includes(l.program)) &&
    (f.countries === null || f.countries.includes(l.country)) &&
    (f.type === 'all' || (f.type === 'crewed') === l.crewed) &&
    (f.fromYear === null || y >= f.fromYear) &&
    (f.toYear === null || y <= f.toYear)
  );
}

export function isDefaultFilter(f: MissionFilter, landings: readonly Landing[]): boolean {
  return landings.every((l) => matchesFilter(f, l)) && f.type === 'all';
}

export class MissionFilterStore {
  private value: MissionFilter = ALL_MISSIONS;
  private readonly listeners = new Set<(f: MissionFilter) => void>();

  get(): MissionFilter {
    return this.value;
  }

  set(next: MissionFilter): void {
    this.value = next;
    for (const fn of [...this.listeners]) fn(next);
  }

  subscribe(fn: (f: MissionFilter) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const missionFilter = new MissionFilterStore();
