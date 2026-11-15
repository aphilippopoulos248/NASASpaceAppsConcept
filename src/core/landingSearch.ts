import type { Ranking, SiteEvaluation } from '../analysis/decision/types';
import type { LatLon } from './types';

export interface LandingSearchPoint {
  label: string;
  evaluation: SiteEvaluation;
}
export interface LandingSearchMap {
  centre: LatLon;
  radiusM: number;
  points: LandingSearchPoint[];
}

/** Only feasible points get rank numbers. Other outcomes remain visibly unranked. */
export function landingSearchPoints(ranking: Ranking): LandingSearchPoint[] {
  const byId = new Map(ranking.evaluations.map(e => [e.site.id, e]));
  const ranked = ranking.ranked.flatMap(r => {
    const evaluation = byId.get(r.siteId);
    return evaluation?.feasibility === 'feasible' ? [{ label: String(r.rank), evaluation }] : [];
  });
  if (ranked.length) return ranked.slice(0, 5);
  return ranking.evaluations.filter(e => e.feasibility !== 'feasible').slice().sort((a, b) =>
    a.criteria.filter(c => c.verdict === 'fail').length - b.criteria.filter(c => c.verdict === 'fail').length || a.site.id.localeCompare(b.site.id),
  ).slice(0, 5).map((evaluation, i) => ({ label: `${evaluation.feasibility === 'unknown' ? 'U' : 'X'}${i + 1}`, evaluation }));
}

let value: LandingSearchMap | null = null;
const listeners = new Set<(value: LandingSearchMap | null) => void>();
export const landingSearchMap = () => value;
export function setLandingSearchMap(next: LandingSearchMap | null): void {
  value = next;
  for (const fn of listeners) fn(next);
}
export function onLandingSearchMap(fn: (value: LandingSearchMap | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
