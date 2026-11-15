import { describe, expect, it } from 'vitest';
import type { MissionProfile } from '../../analysis/decision/types';
import { readComparison, readProfiles, readRanking, readRankingExtras, readSettings } from './results';

const PROFILE: MissionProfile = {
  id: 'polar-short',
  name: 'Polar lander, short stay',
  description: '',
  window: { startUtc: 'current', durationH: 336 },
  mastHeightM: 2,
  landingRadiusM: 100,
  thresholds: { sunlight: 50, darkness: 50, earthVisibility: null, commBlackout: null, slope: 10, roughness: 0.5 },
  weights: { sunlight: 1, darkness: 1, earthVisibility: 1, commBlackout: 1, slope: 1, roughness: 1 },
  sources: [],
};
const EVAL = { site: { id: 'im-2', name: 'IM-2', kind: 'landing', lat: -84.79, lon: 29.2 }, criteria: [], feasibility: 'feasible', utility: 0.8, summary: [], metrics: null };

describe('reading the decision tools results', () => {
  it('reads the profiles as a list or under `profiles`, and refuses anything else', () => {
    expect(readProfiles([PROFILE])).toEqual([PROFILE]);
    expect(readProfiles({ profiles: [PROFILE], utilityNote: 'x' })).toEqual([PROFILE]);
    expect(readProfiles({ profiles: [] })).toBeNull();
    expect(readProfiles({ profiles: [{ id: 'x' }] })).toBeNull();
    expect(readProfiles('nope')).toBeNull();
  });

  it('reads the setting, with defaults for what is left out', () => {
    // getDecisionSettings as T-73 gives it: the first preset's id with isDefaultProfile when AppState says ''.
    expect(readSettings({ profileId: 'polar-short', isDefaultProfile: true, overrides: { thresholds: { slope: 8 } }, profile: PROFILE, relaxations: [{ criterion: 'slope', from: 10, to: 15 }, 'bad'], refused: ['No.'] })).toEqual({
      profileId: 'polar-short', isDefault: true, refused: ['No.'], overrides: { thresholds: { slope: 8 } }, profile: PROFILE, relaxations: [{ criterion: 'slope', from: 10, to: 15 }],
    });
    expect(readSettings({ profile: PROFILE })).toEqual({ profileId: 'polar-short', isDefault: false, refused: [], overrides: {}, profile: PROFILE, relaxations: [] });
    expect(readSettings({ profileId: 'x' })).toBeNull();
  });

  it('reads a ranking given bare or under `ranking`, keeping only rows of the right shape', () => {
    const bare = { profile: PROFILE, relaxations: [], evaluations: [EVAL, { site: 'bad' }], ranked: [{ siteId: 'im-2', name: 'IM-2', rank: 1, utility: 0.8, pareto: true }, { rank: 2 }], counts: { candidates: 3, feasible: 1, unknown: 1, infeasible: 1 }, explanation: ['Why.', 7] };
    const r = readRanking(bare)!;
    expect(r.evaluations).toHaveLength(1);
    expect(r.ranked.map((x) => x.siteId)).toEqual(['im-2']);
    expect(r.paretoFront).toEqual(['im-2']); // derived from the ranked rows when not given
    expect(r.explanation).toEqual(['Why.']);
    const wrapped = readRanking({ profile: PROFILE, relaxations: [{ criterion: 'slope', from: 10, to: 15 }], ranking: { ...bare, profile: undefined, relaxations: undefined, paretoFront: ['im-2', 'x'] } })!;
    expect(wrapped.profile).toEqual(PROFILE);
    expect(wrapped.relaxations).toEqual([{ criterion: 'slope', from: 10, to: 15 }]);
    expect(wrapped.paretoFront).toEqual(['im-2', 'x']);
    expect(readRanking({ ranking: { ranked: [] } })).toBeNull();
    expect(readRanking(null)).toBeNull();
  });

  it('reads where the candidates came from, the cap and what it dropped', () => {
    expect(readRankingExtras({ cap: 40, dropped: 0, candidates: { from: 'catalogue', considered: 28, total: 28 } })).toEqual({ source: { from: 'catalogue', considered: 28, total: 28 }, cap: 40, dropped: 0 });
    expect(readRankingExtras({ candidates: { from: 'elsewhere', considered: 1 } })).toEqual({ source: null, cap: null, dropped: 0 });
    expect(readRankingExtras(null)).toEqual({ source: null, cap: null, dropped: 0 });
  });

  it('reads a pair comparison given bare or under `comparison`', () => {
    const c = { a: EVAL, b: { ...EVAL, site: { ...EVAL.site, id: 'apollo-11' } }, perCriterion: [{ id: 'sunlight', a: 1, b: 2, better: 'b', note: 'n' }, null], dominance: 'b-dominates', sentences: ['s'] };
    expect(readComparison({ profile: PROFILE, comparison: c })).toMatchObject({ dominance: 'b-dominates', perCriterion: [{ id: 'sunlight' }], sentences: ['s'] });
    expect(readComparison(c)?.b.site.id).toBe('apollo-11');
    expect(readComparison({ comparison: { a: EVAL } })).toBeNull();
  });
});
