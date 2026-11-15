import { describe, expect, it } from 'vitest';
import { analyse } from '../api';
import type { Scenario, SiteRef } from '../../core/types';
import { compareEvaluations, criterionDefs, evaluateMetrics, loadMissionProfiles, rankEvaluations, resolveProfile, siteMetrics } from './api';
import { verdictOf } from './evaluate';
import { parseMissionProfiles } from './profiles';
import { CRITERIA, UTILITY_NOTE, type CriterionId, type MeasuredValue, type MissionProfile, type RegionTerrain, type SiteMetrics } from './types';

// ---------- hand-built candidates ----------

const UNITS: Record<CriterionId, MeasuredValue['unit']> = { sunlight: '%', darkness: 'h', earthVisibility: '%', commBlackout: 'h', slope: 'deg', roughness: 'm' };
const TYPICAL: Record<CriterionId, number> = { sunlight: 80, darkness: 10, earthVisibility: 90, commBlackout: 5, slope: 3, roughness: 0.2 };
type Given = number | null | [number, 'lower' | 'upper'];

function candidate(id: string, given: Partial<Record<CriterionId, Given>> = {}, name = id, durationH = 240): SiteMetrics {
  const site: SiteRef = { id, name, kind: 'custom', lat: -85, lon: 30 };
  const values = Object.fromEntries(
    CRITERIA.map((c) => {
      const x = c in given ? given[c]! : TYPICAL[c];
      const [value, bound] = Array.isArray(x) ? x : [x, undefined];
      const m: MeasuredValue = { value, unit: UNITS[c], basis: 'hand-built for the test', ...(bound && { bound }), ...(value === null && { missingReason: 'not measured in this test' }) };
      return [c, m];
    }),
  ) as Record<CriterionId, MeasuredValue>;
  return { site, window: { startUtc: '2025-03-06T17:28Z', durationH }, mastHeightM: 2, values, provenance: ['test'] };
}

const PROFILE: MissionProfile = {
  id: 'test', name: 'Test profile', description: 'For the tests.',
  window: { startUtc: 'current', durationH: 240 }, mastHeightM: 2, landingRadiusM: 100,
  thresholds: { sunlight: 60, darkness: 24, earthVisibility: 50, commBlackout: 48, slope: 10, roughness: 1 },
  weights: { sunlight: 1, darkness: 1, earthVisibility: 1, commBlackout: 1, slope: 1, roughness: 1 },
  sources: ['test'],
};
const withProfile = (over: Partial<MissionProfile>): MissionProfile => ({ ...PROFILE, ...over });
const score = (e: ReturnType<typeof evaluateMetrics>, id: CriterionId) => e.criteria.find((c) => c.id === id)!;

describe('criteria', () => {
  it('six, in the contract order, with slope and roughness the only safety limits', () => {
    const defs = criterionDefs();
    expect(defs.map((d) => d.id)).toEqual(CRITERIA);
    expect(defs.filter((d) => d.safety).map((d) => d.id)).toEqual(['slope', 'roughness']);
    expect(defs.map((d) => [d.id, d.sense, d.ideal, d.worst])).toEqual([
      ['sunlight', 'higher-is-better', 100, 0], ['darkness', 'lower-is-better', 0, 'window'], ['earthVisibility', 'higher-is-better', 100, 0],
      ['commBlackout', 'lower-is-better', 0, 'window'], ['slope', 'lower-is-better', 0, 30], ['roughness', 'lower-is-better', 0, 5],
    ]);
    expect(defs.find((d) => d.id === 'earthVisibility')!.definition).toMatch(/not a radio link budget/);
  });
});

describe('constraints: pass, fail, unknown and bounds', () => {
  const v = (value: number | null, bound?: 'lower' | 'upper'): MeasuredValue => ({ value, unit: 'h', basis: '', ...(bound && { bound }) });
  it('a minimum (higher is better)', () => {
    const at = (m: MeasuredValue) => verdictOf('higher-is-better', m, 60);
    expect([at(v(60)), at(v(59.9)), at(v(null))]).toEqual(['pass', 'fail', 'unknown']);
    // A lower bound at or over the minimum settles it; under it, it cannot.
    expect([at(v(70, 'lower')), at(v(50, 'lower'))]).toEqual(['pass', 'unknown']);
    // An upper bound under the minimum fails; over it, it cannot say.
    expect([at(v(50, 'upper')), at(v(70, 'upper'))]).toEqual(['fail', 'unknown']);
  });
  it('a maximum (lower is better)', () => {
    const at = (m: MeasuredValue) => verdictOf('lower-is-better', m, 24);
    expect([at(v(24)), at(v(24.1)), at(v(null))]).toEqual(['pass', 'fail', 'unknown']);
    // A lower bound that already breaks the maximum fails; one within it cannot say.
    expect([at(v(30, 'lower')), at(v(20, 'lower'))]).toEqual(['fail', 'unknown']);
    expect([at(v(20, 'upper')), at(v(30, 'upper'))]).toEqual(['pass', 'unknown']);
  });
  it('no threshold: nothing to check', () => {
    expect(verdictOf('lower-is-better', v(null), null)).toBe('pass');
    expect(verdictOf('higher-is-better', v(5, 'lower'), null)).toBe('pass');
  });
});

describe('evaluation: feasibility, utility and sentences', () => {
  it('utility is the weighted mean of scores between the ideal and the threshold', () => {
    const e = evaluateMetrics(candidate('a'), PROFILE);
    expect(e.feasibility).toBe('feasible');
    // (80-60)/(100-60), (10-24)/(0-24), (90-50)/(100-50), (5-48)/(0-48), (3-10)/(0-10), (0.2-1)/(0-1)
    const scores = [0.5, 14 / 24, 0.8, 43 / 48, 0.7, 0.8];
    CRITERIA.forEach((id, i) => expect(score(e, id).score).toBeCloseTo(scores[i], 12));
    expect(e.utility).toBeCloseTo(scores.reduce((s, x) => s + x, 0) / 6, 12);
    expect(e.criteria.every((c) => c.weight === 1 / 6)).toBe(true);
    expect(score(e, 'sunlight').reason).toBe('Sunlight 80.0 % meets the minimum of 60.0 %.');
    expect(score(e, 'earthVisibility').reason).toBe('Earth line of sight 90.0 % meets the minimum of 50.0 % (geometry, not a link budget).');
    expect(e.summary[0]).toBe('a: feasible: every criterion meets the profile "Test profile".');
    expect(e.summary).toContain(UTILITY_NOTE);
  });

  it('without a threshold the reference worst value is used, the window length for hours; weights are normalised', () => {
    const p = withProfile({ thresholds: { ...PROFILE.thresholds, darkness: null, slope: null }, weights: { ...PROFILE.weights, sunlight: 3 } });
    const e = evaluateMetrics(candidate('a'), p);
    expect(score(e, 'darkness').score).toBeCloseTo((10 - 240) / (0 - 240), 12);
    expect(score(e, 'slope').score).toBeCloseTo((3 - 30) / (0 - 30), 12);
    expect(score(e, 'sunlight').weight).toBeCloseTo(3 / 8, 12);
    expect(score(e, 'roughness').weight).toBeCloseTo(1 / 8, 12);
    expect(score(e, 'darkness').reason).toBe('Longest darkness 10.0 h; no requirement in this profile.');
    // A value worse than the threshold's side still scores in 0..1.
    expect(evaluateMetrics(candidate('b', { slope: 45 }), p).criteria.find((c) => c.id === 'slope')!.score).toBe(0);
  });

  it('a value not measured and not required is left out of the utility, which says so', () => {
    const p = withProfile({ thresholds: { ...PROFILE.thresholds, roughness: null } });
    const e = evaluateMetrics(candidate('a', { roughness: null }), p);
    expect(e.feasibility).toBe('feasible');
    expect(score(e, 'roughness')).toMatchObject({ verdict: 'pass', score: null, weight: 0 });
    expect(score(e, 'sunlight').weight).toBeCloseTo(1 / 5, 12);
    expect(e.summary).toContain('Not in the utility: roughness (not measured here, and not required by the profile).');
  });

  it('a failure makes a site infeasible; an unknown is never counted as a pass; neither gets a utility', () => {
    const steep = evaluateMetrics(candidate('steep', { slope: 12 }), PROFILE);
    expect(steep).toMatchObject({ feasibility: 'infeasible', utility: null });
    expect(steep.summary.slice(0, 2)).toEqual(['steep: infeasible: it fails slope.', 'Slope 12.0° exceeds the maximum of 10.0°.']);
    const open = evaluateMetrics(candidate('open', { darkness: [20, 'lower'], roughness: null }), PROFILE);
    expect(open).toMatchObject({ feasibility: 'unknown', utility: null });
    expect(open.summary).toEqual([
      'open: undecided: nothing fails, but longest darkness and roughness could not be checked.',
      'Longest darkness 20.0 h or more cannot be checked against the maximum of 24.0 h: the value is only a lower bound.',
      'Roughness not available (not measured in this test), so it cannot be checked against the maximum of 1.00 m.',
    ]);
    // A lower bound already over the maximum is a failure, not an unknown.
    expect(evaluateMetrics(candidate('night', { darkness: [30, 'lower'] }), PROFILE).feasibility).toBe('infeasible');
  });
});

describe('ranking, Pareto frontier and explanations', () => {
  // A beats B everywhere; C trades sunlight for slope; D equals A; E would beat all but is too rough; F is undecided.
  const sites = [
    candidate('b', { sunlight: 80, darkness: 10, earthVisibility: 90, commBlackout: 5, slope: 3, roughness: 0.2 }, 'Site B'),
    candidate('a', { sunlight: 90, darkness: 5, earthVisibility: 95, commBlackout: 2, slope: 2, roughness: 0.1 }, 'Site A'),
    candidate('c', { sunlight: 95, darkness: 5, earthVisibility: 95, commBlackout: 2, slope: 8, roughness: 0.1 }, 'Site C'),
    candidate('d', { sunlight: 90, darkness: 5, earthVisibility: 95, commBlackout: 2, slope: 2, roughness: 0.1 }, 'Site D'),
    candidate('e', { sunlight: 99, darkness: 0, earthVisibility: 100, commBlackout: 0, slope: 1, roughness: 2 }, 'Site E'),
    candidate('f', { darkness: [20, 'lower'] }, 'Site F'),
    candidate('g', { sunlight: 40, slope: 15 }, 'Site G'),
  ];
  const evals = sites.map((s) => evaluateMetrics(s, PROFILE));
  const ranking = rankEvaluations(evals, PROFILE, []);

  it('feasible sites by utility, ties by site id, then undecided, then infeasible (fewest failures first)', () => {
    expect(ranking.evaluations.map((e) => e.site.id)).toEqual(['a', 'd', 'c', 'b', 'f', 'e', 'g']);
    expect(ranking.ranked.map((r) => [r.siteId, r.rank, r.pareto])).toEqual([['a', 1, true], ['d', 2, true], ['c', 3, true], ['b', 4, false]]);
    expect(ranking.ranked[0].utility).toBe(ranking.ranked[1].utility);
    expect(ranking.counts).toEqual({ candidates: 7, feasible: 4, unknown: 1, infeasible: 2 });
    // The infeasible site that would beat everyone stays off the frontier.
    expect(ranking.paretoFront).toEqual(['a', 'd', 'c']);
  });

  it('explains the order in fixed sentences', () => {
    expect(ranking.explanation[0]).toBe('7 candidates under "Test profile": 4 feasible, 1 undecided, 2 infeasible.');
    expect(ranking.explanation[1]).toBe(`Site A and Site D have the same utility (${ranking.ranked[0].utility.toFixed(2)}); Site A is listed first by site id.`);
    expect(ranking.explanation).toContain('Constraints that removed the most candidates: sunlight (at least 60.0 %) 1 of 7, slope (at most 10.0°) 1 of 7 and roughness (at most 1.00 m) 1 of 7.');
    expect(ranking.explanation).toContain('Could not be decided for 1 candidate, because a value is missing or only a bound: longest darkness at 1.');
    expect(ranking.explanation).toContain('3 of the 4 feasible sites are on the Pareto frontier (no other feasible site is at least as good on every criterion and better on one): Site A, Site D and Site C.');
    expect(ranking.explanation.at(-1)).toBe(UTILITY_NOTE);
    expect(ranking.explanation.join(' ')).toMatch(/not a radio link budget/);
  });

  it('why the first beats the second names the largest weighted differences', () => {
    const r = rankEvaluations([evaluateMetrics(sites[0], PROFILE), evaluateMetrics(sites[2], PROFILE)], PROFILE, []);
    expect(r.ranked.map((x) => x.siteId)).toEqual(['c', 'b']);
    expect(r.explanation[1]).toMatch(/^Site C ranks first \(utility 0\.\d\d\) ahead of Site B \(0\.\d\d\): its weighted scores are higher on sunlight \(\+0\.\d{3}\) and longest darkness \(\+0\.\d{3}\); Site B is better on slope \(0\.\d{3}\)\.$/);
  });

  it('is deterministic: the same candidates in another order give the same result', () => {
    const again = rankEvaluations([...evals].reverse(), PROFILE, []);
    expect(again).toEqual(ranking);
    expect(JSON.stringify(rankEvaluations(evals, PROFILE, []))).toBe(JSON.stringify(ranking));
  });

  it('lists relaxations and says when nothing is feasible', () => {
    const r = rankEvaluations([evaluateMetrics(sites[6], PROFILE)], PROFILE, [{ criterion: 'slope', from: 10, to: 15 }, { criterion: 'roughness', from: 1, to: null }]);
    expect(r.relaxations).toEqual([{ criterion: 'slope', from: 10, to: 15 }, { criterion: 'roughness', from: 1, to: null }]);
    expect(r.explanation[1]).toBe('Safety limits relaxed on request: slope maximum 10.0° → 15.0° and roughness limit removed (was 1.00 m).');
    expect(r.explanation[2]).toBe('No candidate meets every constraint of "Test profile".');
    expect(r.ranked).toEqual([]);
    expect(r.paretoFront).toEqual([]);
  });
});

describe('two candidates', () => {
  const ev = (id: string, given: Partial<Record<CriterionId, Given>>) => evaluateMetrics(candidate(id, given, 'Pin'), PROFILE);

  it('words each difference with both values', () => {
    const c = compareEvaluations(ev('a', { darkness: 43.4 }), ev('b', { darkness: 31 }));
    expect(c.perCriterion.find((x) => x.id === 'darkness')).toEqual({ id: 'darkness', a: 43.4, b: 31, better: 'b', note: 'B has 12.4 h less longest darkness (31.0 h against 43.4 h).' });
    expect(c.perCriterion.find((x) => x.id === 'sunlight')!.better).toBe('tie');
    expect(c.dominance).toBe('b-dominates');
    expect(c.sentences[0]).toBe('B dominates A: at least as good on every criterion and better on longest darkness.');
  });

  it('dominance, trade-off, equality and too much unknown', () => {
    expect(compareEvaluations(ev('a', { sunlight: 90 }), ev('b', {})).dominance).toBe('a-dominates');
    const t = compareEvaluations(ev('a', { sunlight: 90 }), ev('b', { slope: 1 }));
    expect(t.dominance).toBe('tradeoff');
    expect(t.sentences[0]).toBe('Trade-off: A is better on sunlight; B is better on slope.');
    expect(t.perCriterion.find((x) => x.id === 'sunlight')!.note).toBe('A has 10.0 points more sunlight (90.0 % against 80.0 %).');
    expect(compareEvaluations(ev('a', {}), ev('b', {})).dominance).toBe('equal');
    const missing = compareEvaluations(ev('a', { slope: null }), ev('b', {}));
    expect(missing.dominance).toBe('incomparable');
    expect(missing.perCriterion.find((x) => x.id === 'slope')).toMatchObject({ better: 'unknown', note: 'Slope cannot be compared: not available for A (not measured in this test).' });
  });

  it('a bound decides only when it settles the question', () => {
    const open = compareEvaluations(ev('a', { darkness: [10, 'lower'] }), ev('b', { darkness: 12 }));
    expect(open.perCriterion.find((x) => x.id === 'darkness')!.better).toBe('unknown');
    const settled = compareEvaluations(ev('a', { darkness: [13, 'lower'] }), ev('b', { darkness: 12 }));
    expect(settled.perCriterion.find((x) => x.id === 'darkness')).toMatchObject({ better: 'b', note: 'B has less longest darkness (12.0 h against 13.0 h or more).' });
  });
});

describe('profiles and overrides', () => {
  it('tightening is allowed and recorded in the sources', () => {
    const r = resolveProfile(PROFILE, { thresholds: { slope: 8, sunlight: 70 } });
    expect(r.refused).toEqual([]);
    expect(r.relaxations).toEqual([]);
    expect(r.profile.thresholds).toMatchObject({ slope: 8, sunlight: 70 });
    expect(r.profile.sources.at(-1)).toBe('Changed on request for this evaluation: slope at most 8.0°; sunlight at least 70.0 %.');
    // Loosening a limit that is not a safety limit needs no flag.
    expect(resolveProfile(PROFILE, { thresholds: { darkness: 48 } })).toMatchObject({ refused: [], relaxations: [] });
  });

  it('a safety relaxation is refused without the flag and listed with it', () => {
    const refused = resolveProfile(PROFILE, { thresholds: { slope: 15 } });
    expect(refused.profile).toBe(PROFILE);
    expect(refused.refused).toEqual(['Loosening the slope maximum from 10.0° to 15.0° is a safety relaxation: it needs allowSafetyRelaxation, which may be set only when the user explicitly asks to relax this limit.']);
    const allowed = resolveProfile(PROFILE, { thresholds: { slope: 15 }, allowSafetyRelaxation: true });
    expect(allowed).toMatchObject({ refused: [], relaxations: [{ criterion: 'slope', from: 10, to: 15 }] });
    expect(allowed.profile.thresholds.slope).toBe(15);
    // Removing a safety limit is a relaxation too; adding one where there was none is not.
    expect(resolveProfile(PROFILE, { thresholds: { roughness: null } }).refused[0]).toMatch(/^Removing the roughness limit \(1\.00 m\) is a safety relaxation/);
    expect(resolveProfile(PROFILE, { thresholds: { roughness: null }, allowSafetyRelaxation: true }).relaxations).toEqual([{ criterion: 'roughness', from: 1, to: null }]);
    expect(resolveProfile(withProfile({ thresholds: { ...PROFILE.thresholds, roughness: null } }), { thresholds: { roughness: 0.5 } })).toMatchObject({ refused: [], relaxations: [] });
  });

  it('out-of-range values and unknown keys are refused with reasons, and one refusal refuses the whole set', () => {
    const r = resolveProfile(PROFILE, {
      thresholds: { slope: 8, sunlight: 120, temperature: 5 } as never,
      weights: { darkness: -1 },
      window: { durationH: 0, startUtc: 'tomorrow' },
      foo: 1,
    } as never);
    expect(r.profile).toBe(PROFILE);
    expect(r.refused).toEqual([
      'Unknown setting "foo".',
      'window.startUtc must be "current" or a UTC time such as "2025-03-06T17:28Z" between 1950 and 2100 (got "tomorrow").',
      'window.durationH must be a number of hours from 1 to 8760 (got 0).',
      'The sunlight threshold must be a number from 0 % to 100 %, or null for no requirement (got 120).',
      'Unknown criterion "temperature" in thresholds (known: sunlight, darkness, earthVisibility, commBlackout, slope, roughness).',
      'The longest darkness weight must be a number from 0 to 100 (got -1).',
    ]);
    expect(resolveProfile(PROFILE, { weights: { sunlight: 0, darkness: 0, earthVisibility: 0, commBlackout: 0, slope: 0, roughness: 0 } }).refused).toEqual(['At least one weight must be above zero.']);
    expect(resolveProfile(PROFILE, { window: { startUtc: '2025-03-06T17:28Z', durationH: 336 }, mastHeightM: 5, landingRadiusM: 250 }).profile).toMatchObject({ window: { startUtc: '2025-03-06T17:28Z', durationH: 336 }, mastHeightM: 5, landingRadiusM: 250 });
  });

  it('the bundled presets load, are checked, and every number is sourced or labelled', async () => {
    const profiles = await loadMissionProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    expect(profiles.length).toBeLessThanOrEqual(4);
    expect(new Set(profiles.map((p) => p.id)).size).toBe(profiles.length);
    expect(await loadMissionProfiles()).toBe(profiles); // loaded once
    for (const p of profiles) {
      const text = p.sources.join(' ');
      expect(text).toMatch(/illustrative default/);
      expect(text).toContain(String(p.window.durationH));
      for (const id of CRITERIA) {
        const t = p.thresholds[id];
        if (t !== null) expect(text, `${p.id} ${id}`).toContain(String(t));
        expect(text, `${p.id} weight ${id}`).toContain(String(p.weights[id]));
      }
      // A safety criterion without a limit says why.
      if (p.thresholds.roughness === null) expect(text).toMatch(/Roughness: no requirement/);
    }
    // Each preset resolves against itself unchanged.
    expect(resolveProfile(profiles[0], {})).toEqual({ profile: profiles[0], relaxations: [], refused: [] });
  });

  it('a malformed file is refused with the place of the problem', () => {
    const good = { id: 'x', name: 'X', description: 'x', window: { startUtc: 'current', durationH: 24 }, mastHeightM: 2, landingRadiusM: 100, thresholds: PROFILE.thresholds, weights: PROFILE.weights, sources: ['illustrative default'] };
    expect(parseMissionProfiles({ profiles: [good] })).toHaveLength(1);
    const noSlope = Object.fromEntries(Object.entries(PROFILE.thresholds).filter(([k]) => k !== 'slope'));
    expect(() => parseMissionProfiles({ profiles: [{ ...good, thresholds: noSlope }] })).toThrow(/profiles\[0\]\.thresholds\.slope: missing/);
    expect(() => parseMissionProfiles({ profiles: [{ ...good, thresholds: { ...PROFILE.thresholds, slope: 95 } }] })).toThrow(/thresholds\.slope: The slope threshold must be a number from 0 deg to 90 deg/);
    expect(() => parseMissionProfiles({ profiles: [good, good] })).toThrow(/used twice/);
    expect(() => parseMissionProfiles({ profiles: [{ ...good, sources: [] }] })).toThrow(/sources/);
    expect(() => parseMissionProfiles({})).toThrow(/root/);
  });
});

describe('measurements from a real analysis (IM-2, 10 days from touchdown, 2 m)', () => {
  const site: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.7906, lon: 29.19567 };
  const scenario: Scenario = { id: 'decision-im2', label: 'IM-2 for the decision engine', site, mastHeightM: 2, startMs: Date.parse('2025-03-06T17:28:00Z'), durationH: 240, stepMin: 10 };
  const window = { startUtc: '2025-03-06T17:28Z', durationH: 240 };

  it('takes the window metrics as they are, with bounds and their basis; never fills a gap', async () => {
    const a = await analyse(scenario);
    const provenance = [`Ephemeris: ${a.provenance.ephemeris}.`, `Elevation data: ${a.provenance.dem.map((d) => d.name).join('; ')}.`];
    const region: RegionTerrain = { lat: site.lat, lon: site.lon, radiusM: 100, demName: 'test grid', gridSpacingM: 5, samples: 1257, slopeDeg: 4.2, roughnessM: null, notes: ['Roughness is not measured on this grid in the test.'] };
    const m = siteMetrics({ site, window, mastHeightM: 2, metrics: a.metrics, region, provenance });
    expect(m.values.sunlight.value).toBe(a.metrics.illuminationPct);
    expect(m.values.earthVisibility.value).toBe(a.metrics.earthVisiblePct);
    expect(m.values.darkness.value).toBe(a.metrics.longestDarknessH);
    expect(m.values.commBlackout.value).toBe(a.metrics.longestEarthGapH);
    expect(m.values.darkness.bound).toBe(a.metrics.darknessOpenEnded && a.metrics.longestDarknessH > 0 ? 'lower' : undefined);
    expect(m.values.commBlackout.bound).toBe(a.metrics.earthGapOpenEnded && a.metrics.longestEarthGapH > 0 ? 'lower' : undefined);
    expect(m.values.sunlight.basis).toContain('mission window from 2025-03-06T17:28Z for 240 h, observer 2 m above the ground');
    expect(m.values.sunlight.basis).toContain(provenance[1]);
    expect(m.values.slope).toMatchObject({ value: 4.2, unit: 'deg' });
    expect(m.values.slope.basis).toBe('Ground slope over the landing region of 100 m radius around 84.7906° S, 29.1957° E, from test grid (5 m grid, 1257 samples). Roughness is not measured on this grid in the test.');
    expect(m.values.roughness).toMatchObject({ value: null, missingReason: 'Roughness is not measured on this grid in the test.' });
    expect(m.provenance.at(-1)).toBe('Landing region: 100 m around 84.7906° S, 29.1957° E, measured on test grid (5 m grid, 1257 samples).');
    // Under a profile that requires roughness the site cannot be feasible: unknown is never a pass.
    const e = evaluateMetrics(m, PROFILE);
    expect(e.feasibility).not.toBe('feasible');
    expect(e.criteria.find((c) => c.id === 'roughness')!.verdict).toBe('unknown');
  });

  it('without a skyline or a region every value is null, with the reason', () => {
    const m = siteMetrics({ site, window, mastHeightM: 2, metrics: null, region: null, provenance: [] });
    for (const id of CRITERIA) expect(m.values[id].value).toBeNull();
    expect(m.values.sunlight.missingReason).toMatch(/^No terrain skyline could be computed/);
    expect(m.values.slope.missingReason).toBe('No landing-region terrain was measured for this site.');
    expect(evaluateMetrics(m, PROFILE).feasibility).toBe('unknown');
  });
});
