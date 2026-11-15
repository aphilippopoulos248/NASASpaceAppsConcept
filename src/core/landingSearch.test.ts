import { expect, it } from 'vitest';
import type { Ranking, SiteEvaluation } from '../analysis/decision/types';
import { landingSearchPoints } from './landingSearch';

const site = (id: string, feasibility: SiteEvaluation['feasibility'], failures = 0) => ({
  site: { id, lat: 10, lon: 20 }, feasibility, criteria: Array.from({ length: failures }, () => ({ verdict: 'fail' })),
}) as SiteEvaluation;
const ranking = (evaluations: SiteEvaluation[], ids: string[] = []) => ({
  evaluations, ranked: ids.map((siteId, i) => ({ siteId, rank: i + 1 })),
}) as Ranking;

it('map numbers preserve the decision ranking and show at most five feasible points', () => {
  const sites = Array.from({ length: 7 }, (_, i) => site(String(i), 'feasible'));
  const ids = sites.map(e => e.site.id).reverse();
  const points = landingSearchPoints(ranking([...sites, site('bad', 'infeasible')], ids));
  expect(points.map(p => [p.label, p.evaluation.site.id])).toEqual([['1', '6'], ['2', '5'], ['3', '4'], ['4', '3'], ['5', '2']]);
});

it('without feasible points, unknown and failed points are labelled separately and never ranked', () => {
  const points = landingSearchPoints(ranking([site('many', 'infeasible', 3), site('few', 'infeasible', 1), site('missing', 'unknown')]));
  expect(points.map(p => [p.label, p.evaluation.site.id])).toEqual([['U1', 'missing'], ['X2', 'few'], ['X3', 'many']]);
  expect(landingSearchPoints(ranking([]))).toEqual([]);
});
