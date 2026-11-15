import { describe, expect, it } from 'vitest';
import { CRITERIA, UTILITY_NOTE, type CriterionDef, type CriterionId, type CriterionResult, type MissionProfile, type PairComparison, type Ranking, type SiteEvaluation, type Verdict } from '../../analysis/decision/types';
import type { Scenario, SiteRef } from '../../core/types';
import {
  badgeOf,
  candidatesFor,
  criteriaUi,
  dominanceSentence,
  measuredText,
  openStep,
  pairView,
  progressText,
  rankingView,
  relaxationPrompt,
  relaxationSentences,
  requirementViews,
  sameProfile,
  savedSites,
  slotConditionsNote,
  slotSteps,
  sortRows,
  thresholdChange,
  thresholdEdit,
  togglePick,
  valueText,
  weightEdit,
  weightShares,
  weightsSentence,
  type SiteRow,
} from './view';

// Synthetic fixtures in the shape of the contract (src/analysis/decision/types.ts). The numbers
// are made up for the tests; the tab itself only ever shows what the decision tools return.
const DEFS = criteriaUi(() => {
  throw new Error('engine not in this build');
});

const PROFILE: MissionProfile = {
  id: 'polar-short',
  name: 'Polar lander, short stay',
  description: 'Test profile.',
  window: { startUtc: 'current', durationH: 336 },
  mastHeightM: 2,
  landingRadiusM: 100,
  thresholds: { sunlight: 50, darkness: 50, earthVisibility: null, commBlackout: null, slope: 10, roughness: 0.5 },
  weights: { sunlight: 3, darkness: 2, earthVisibility: 2, commBlackout: 1, slope: 1, roughness: 1 },
  sources: ['Every number: illustrative default.'],
};

const UNIT: Record<CriterionId, CriterionResult['measured']['unit']> = { sunlight: '%', darkness: 'h', earthVisibility: '%', commBlackout: 'h', slope: 'deg', roughness: 'm' };

function crit(id: CriterionId, value: number | null, verdict: Verdict, extra: Partial<CriterionResult> = {}): CriterionResult {
  return {
    id,
    measured: { value, unit: UNIT[id], basis: id === 'slope' || id === 'roughness' ? 'LOLA 60 m grid over 100 m' : 'Skyline every 1 deg, 336 h window', ...(value === null && { missingReason: `No ${id} data here.` }) },
    threshold: PROFILE.thresholds[id],
    verdict,
    score: verdict === 'pass' ? 0.5 : null,
    weight: 1 / 6,
    reason: `${id} reason (${verdict}).`,
    ...extra,
  };
}

const site = (id: string, name: string, kind: SiteRef['kind'] = 'landing'): SiteRef => ({ id, name, kind, lat: -84.79, lon: 29.2 });

function evaluation(id: string, name: string, verdicts: Partial<Record<CriterionId, [number | null, Verdict]>>, utility: number | null = null, kind: SiteRef['kind'] = 'landing'): SiteEvaluation {
  const criteria = CRITERIA.map((c) => {
    const [v, verdict] = verdicts[c] ?? [1, 'pass'];
    return crit(c, v, verdict);
  });
  const feasibility = criteria.some((c) => c.verdict === 'fail') ? 'infeasible' : criteria.some((c) => c.verdict === 'unknown') ? 'unknown' : 'feasible';
  const s = site(id, name, kind);
  return {
    site: s,
    metrics: { site: s, window: { startUtc: '2026-11-15T00:00Z', durationH: 336 }, mastHeightM: 2, values: Object.fromEntries(criteria.map((c) => [c.id, c.measured])) as SiteEvaluation['metrics']['values'], provenance: ['Ephemeris: JPL Horizons.'] },
    criteria,
    feasibility,
    utility,
    summary: [],
  };
}

const RANKING: Ranking = {
  profile: PROFILE,
  relaxations: [],
  evaluations: [
    evaluation('im-2', 'IM-2 Athena', {}, 0.81),
    evaluation('chandrayaan-3', 'Chandrayaan-3', {}, 0.74),
    evaluation('apollo-11', 'Apollo 11', { sunlight: [20, 'fail'], darkness: [300, 'fail'] }),
    evaluation('luna-9', 'Luna 9', { slope: [12, 'fail'] }),
    evaluation('zond', 'Beta unknown', { roughness: [null, 'unknown'], slope: [null, 'unknown'] }),
    evaluation('alpha', 'Alpha unknown', { roughness: [null, 'unknown'] }),
  ],
  ranked: [
    { siteId: 'chandrayaan-3', name: 'Chandrayaan-3', rank: 2, utility: 0.74, pareto: true },
    { siteId: 'im-2', name: 'IM-2 Athena', rank: 1, utility: 0.81, pareto: true },
  ],
  paretoFront: ['im-2', 'chandrayaan-3'],
  counts: { candidates: 9, feasible: 5, unknown: 2, infeasible: 2 },
  explanation: ['IM-2 Athena beats Chandrayaan-3 mainly on sunlight.', UTILITY_NOTE],
};

describe('criteria and numbers in words', () => {
  it('takes the engine definitions, or the design note list while the engine is not there', () => {
    expect(DEFS.map((d) => d.id)).toEqual([...CRITERIA]);
    expect(DEFS.filter((d) => d.safety).map((d) => d.id)).toEqual(['slope', 'roughness']);
    const engine: CriterionDef[] = CRITERIA.map((id) => ({ id, label: `L-${id}`, unit: UNIT[id], sense: 'lower-is-better', safety: id === 'slope', ideal: 0, worst: 'window', definition: `def ${id}` }));
    const ui = criteriaUi(() => engine);
    expect(ui[0]).toEqual({ id: 'sunlight', label: 'L-sunlight', unit: '%', sense: 'lower-is-better', safety: false, definition: 'def sunlight' });
  });

  it('writes values with their unit, a bound when there is one, and "unknown" without a value', () => {
    expect(valueText(87.06, '%')).toBe('87.1 %');
    expect(valueText(43.42, 'h')).toBe('43.4 h');
    expect(valueText(0, 'h')).toBe('none');
    expect(valueText(379.8, 'h')).toBe('379.8 h (15.8 d)');
    expect(valueText(379.8, 'h', true)).toBe('379.8 h');
    expect(valueText(0.01, 'h', true)).toBe('none');
    expect(valueText(2.46, 'deg')).toBe('2.5°');
    expect(valueText(0.4234, 'm')).toBe('0.42 m');
    expect(valueText(12.34, 'm')).toBe('12.3 m');
    expect(valueText(null, '%')).toBe('unknown');
    expect(measuredText({ value: 43.4, unit: 'h', bound: 'lower' })).toBe('≥ 43.4 h');
    expect(measuredText({ value: 1.5, unit: 'deg', bound: 'upper' })).toBe('≤ 1.5°');
    expect(measuredText({ value: null, unit: 'h', bound: 'lower' })).toBe('unknown');
    expect(measuredText({ value: 236.3, unit: 'h', bound: 'lower' }, true)).toBe('≥ 236.3 h');
  });

  it('gives a badge the verdict as a shape, the value and the engine reason with the missing reason', () => {
    expect(badgeOf(DEFS, crit('sunlight', 87.06, 'pass'))).toMatchObject({ mark: '✓', value: '87.1 %', verdict: 'pass', reason: 'sunlight reason (pass).', scoreText: 'Score 0.50, weight 17 %' });
    expect(badgeOf(DEFS, crit('slope', 12, 'fail'))).toMatchObject({ mark: '✗', value: '12.0°', scoreText: null });
    expect(badgeOf(DEFS, crit('roughness', null, 'unknown'))).toMatchObject({ mark: '?', value: 'unknown', reason: 'roughness reason (unknown). No roughness data here.' });
    // A reason that already says why is not repeated.
    expect(badgeOf(DEFS, crit('roughness', null, 'unknown', { reason: 'Roughness unknown: No roughness data here.' })).reason).toBe('Roughness unknown: No roughness data here.');
  });
});

describe('thresholds, weights and the safety confirmation', () => {
  const slope = DEFS.find((d) => d.id === 'slope')!, sunlight = DEFS.find((d) => d.id === 'sunlight')!;

  it('tells a tighter threshold from a looser one for minimums and maximums', () => {
    expect(thresholdChange(slope, 10, 8)).toBe('tighter');
    expect(thresholdChange(slope, 10, 15)).toBe('looser');
    expect(thresholdChange(slope, 10, null)).toBe('looser');
    expect(thresholdChange(slope, null, 8)).toBe('tighter');
    expect(thresholdChange(slope, 10, 10)).toBe('same');
    expect(thresholdChange(sunlight, 50, 70)).toBe('tighter');
    expect(thresholdChange(sunlight, 50, 30)).toBe('looser');
  });

  it('asks only before loosening a safety limit', () => {
    expect(relaxationPrompt(sunlight, 50, 30)).toBeNull();
    expect(relaxationPrompt(slope, 10, 8)).toBeNull();
    expect(relaxationPrompt(slope, 10, 15)).toMatchObject({ criterion: 'slope', from: 10, to: 15, confirm: 'Relax slope to 15°', cancel: 'Keep 10°' });
    expect(relaxationPrompt(slope, 10, 15)!.text).toBe("Slope is a safety limit. The profile asks for at most 10°; at most 15° is looser. Every ranking made with it will list the relaxation.");
    expect(relaxationPrompt(slope, 10, null)).toMatchObject({ to: null, confirm: 'Remove the slope limit' });
  });

  it('tightening applies at once; loosening a safety limit needs a confirmation and then carries the flag', () => {
    expect(thresholdEdit(DEFS, PROFILE, {}, 'slope', 8)).toEqual({ kind: 'apply', overrides: { thresholds: { slope: 8 } } });
    const loose = thresholdEdit(DEFS, PROFILE, {}, 'slope', 15);
    expect(loose.kind).toBe('confirm');
    expect(loose.kind === 'confirm' && loose.overrides).toEqual({ thresholds: { slope: 15 }, allowSafetyRelaxation: true });
    const removed = thresholdEdit(DEFS, PROFILE, {}, 'roughness', null);
    expect(removed).toMatchObject({ kind: 'confirm', overrides: { thresholds: { roughness: null }, allowSafetyRelaxation: true } });
    // Loosening a limit that is not a safety limit needs no confirmation.
    expect(thresholdEdit(DEFS, PROFILE, {}, 'sunlight', null)).toEqual({ kind: 'apply', overrides: { thresholds: { sunlight: null } } });
    expect(thresholdEdit(DEFS, PROFILE, {}, 'slope', 10)).toEqual({ kind: 'none' });
  });

  it('keeps the flag exactly while a safety limit is looser than the profile, and asks again only to go further', () => {
    const relaxed = { thresholds: { slope: 15 }, allowSafetyRelaxation: true };
    // Part of the way back: still relaxed, no new question.
    expect(thresholdEdit(DEFS, PROFILE, relaxed, 'slope', 12)).toEqual({ kind: 'apply', overrides: { thresholds: { slope: 12 }, allowSafetyRelaxation: true } });
    // Further: asked again.
    expect(thresholdEdit(DEFS, PROFILE, relaxed, 'slope', 20).kind).toBe('confirm');
    // Back to the profile's value: the override and the flag go.
    expect(thresholdEdit(DEFS, PROFILE, relaxed, 'slope', 10)).toEqual({ kind: 'apply', overrides: {} });
    // Another field edited while slope stays relaxed: the flag stays.
    expect(thresholdEdit(DEFS, PROFILE, relaxed, 'sunlight', 70)).toEqual({ kind: 'apply', overrides: { thresholds: { slope: 15, sunlight: 70 }, allowSafetyRelaxation: true } });
    // A stray flag with nothing relaxed is dropped on the next edit.
    expect(thresholdEdit(DEFS, PROFILE, { allowSafetyRelaxation: true }, 'sunlight', 70)).toEqual({ kind: 'apply', overrides: { thresholds: { sunlight: 70 } } });
  });

  it('edits weights, dropping one that is back to the profile value, and states each share', () => {
    expect(weightEdit(PROFILE, {}, 'slope', 3)).toEqual({ kind: 'apply', overrides: { weights: { slope: 3 } } });
    expect(weightEdit(PROFILE, { weights: { slope: 3 }, thresholds: { sunlight: 70 } }, 'slope', 1)).toEqual({ kind: 'apply', overrides: { thresholds: { sunlight: 70 } } });
    expect(weightEdit(PROFILE, {}, 'slope', 1)).toEqual({ kind: 'none' });
    const shares = weightShares(PROFILE.weights);
    expect(shares.sunlight).toBeCloseTo(0.3);
    expect(CRITERIA.reduce((s, id) => s + shares[id], 0)).toBeCloseTo(1);
    expect(Object.values(weightShares({ sunlight: 0, darkness: 0, earthVisibility: 0, commBlackout: 0, slope: 0, roughness: 0 }))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('marks changed and relaxed requirements against the preset, and words each relaxation', () => {
    const resolved: MissionProfile = { ...PROFILE, thresholds: { ...PROFILE.thresholds, slope: 15, sunlight: 70 }, weights: { ...PROFILE.weights, darkness: 4 } };
    const views = requirementViews(DEFS, resolved, PROFILE, [{ criterion: 'slope', from: 10, to: 15 }]);
    const by = (id: CriterionId) => views.find((v) => v.def.id === id)!;
    expect(by('slope')).toMatchObject({ threshold: 15, baseThreshold: 10, changed: true, relaxedText: 'Relaxed from ≤ 10°' });
    expect(by('sunlight')).toMatchObject({ threshold: 70, changed: true, relaxed: null, relaxedText: null });
    expect(by('darkness')).toMatchObject({ weight: 4, baseWeight: 2, changed: true });
    expect(by('roughness')).toMatchObject({ changed: false });
    expect(by('darkness').share).toBeCloseTo(4 / 12);
    expect(relaxationSentences(DEFS, [{ criterion: 'slope', from: 10, to: 15 }, { criterion: 'roughness', from: 0.5, to: null }])).toEqual([
      'Safety limit relaxed: slope at most 15° instead of at most 10°.',
      'Safety limit removed: roughness (the profile asks for at most 0.5 m).',
    ]);
  });
});

describe('the ranking as the tab lists it', () => {
  const v = rankingView(DEFS, RANKING);

  it('puts every candidate in its section: ranked by rank, unknown and infeasible with what decided it', () => {
    expect(v.ranked.map((r) => [r.rank, r.id, r.utilityText, r.pareto])).toEqual([[1, 'im-2', '0.81', true], [2, 'chandrayaan-3', '0.74', true]]);
    expect(v.unknown.map((r) => r.id)).toEqual(['alpha', 'zond']); // fewest unknown criteria first
    expect(v.infeasible.map((r) => r.id)).toEqual(['luna-9', 'apollo-11']); // the near miss first
    expect(v.infeasible[1].deciding).toEqual(['sunlight reason (fail).', 'darkness reason (fail).']);
    expect(v.unknown[1].deciding).toEqual(['slope reason (unknown). No slope data here.', 'roughness reason (unknown). No roughness data here.']);
    expect(v.ranked[0].deciding).toEqual([]);
    expect(v.ranked[0].badges.map((b) => b.id)).toEqual([...CRITERIA]);
    expect(v.unknown.every((r) => r.utility === null && r.utilityText === '—' && r.rank === null)).toBe(true);
  });

  it('says the counts, what is ranked but not listed, the weights used and the utility caveat', () => {
    expect(v.countsText).toBe('9 candidates: 5 feasible, 2 unknown, 2 infeasible.');
    expect(v.notListed).toBe(3);
    expect(v.paretoCount).toBe(2);
    expect(v.weightsText).toBe('Weights used: sunlight 17 %, longest darkness 17 %, earth in view 17 %, longest earth gap 17 %, slope 17 %, roughness 17 %.');
    expect(v.explanation).toEqual(['IM-2 Athena beats Chandrayaan-3 mainly on sunlight.']);
    expect(v.note).toBe(UTILITY_NOTE);
    expect(v.basis).toEqual([
      { labels: ['Sunlight', 'Longest darkness', 'Earth in view', 'Longest Earth gap'], text: 'Skyline every 1 deg, 336 h window' },
      { labels: ['Slope', 'Roughness'], text: 'LOLA 60 m grid over 100 m' },
    ]);
    expect(v.provenance).toEqual(['Ephemeris: JPL Horizons.']);
    // Without an evaluation to read the applied weights from: the profile's weights, normalised.
    expect(weightsSentence(DEFS, PROFILE)).toBe('Weights used: sunlight 30 %, longest darkness 20 %, earth in view 20 %, longest earth gap 10 %, slope 10 %, roughness 10 %.');
  });

  it('lists the relaxations a ranking used and still draws a ranked site the tools sent without its evaluation', () => {
    const r = rankingView(DEFS, { ...RANKING, relaxations: [{ criterion: 'slope', from: 10, to: 15 }], ranked: [...RANKING.ranked, { siteId: 'x', name: 'X', rank: 3, utility: 0.5, pareto: false }] });
    expect(r.relaxations).toEqual(['Safety limit relaxed: slope at most 15° instead of at most 10°.']);
    expect(r.ranked.map((x) => x.id)).toEqual(['im-2', 'chandrayaan-3', 'x']);
    expect(r.ranked[2]).toMatchObject({ badges: [], utilityText: '0.50' });
  });

  it('sorts ties by name and keeps the engine rank before utility', () => {
    const row = (id: string, name: string, section: SiteRow['section'], rank: number | null, fails = 0): SiteRow => ({
      id, name, site: site(id, name), section, rank, utility: rank === null ? null : 1 / rank, utilityText: '', pareto: false, deciding: [],
      badges: Array.from({ length: fails }, () => ({ id: 'slope' as const, label: 'Slope', verdict: 'fail' as const, mark: '✗', value: '', reason: '', scoreText: null })),
    });
    const s = sortRows([row('b', 'Bravo', 'infeasible', null, 1), row('a', 'Alpha', 'infeasible', null, 1), row('c', 'Charlie', 'infeasible', null, 0), row('r2', 'R2', 'ranked', 2), row('r1', 'R1', 'ranked', 1)]);
    expect(s.ranked.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(s.infeasible.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('two rows compared', () => {
  it('keeps at most two picks, letting the oldest go', () => {
    expect(togglePick([], 'a', true)).toEqual(['a']);
    expect(togglePick(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(togglePick(['a', 'b'], 'c', true)).toEqual(['b', 'c']);
    expect(togglePick(['a', 'b'], 'a', false)).toEqual(['b']);
    expect(togglePick(['a'], 'a', true)).toEqual(['a']);
  });

  it('gives deltas per criterion, who is better, and the dominance in words', () => {
    const a = RANKING.evaluations[0], b = RANKING.evaluations[2];
    const c: PairComparison = {
      a, b,
      perCriterion: [
        { id: 'sunlight', a: 1, b: 20, better: 'b', note: 'B has more sunlight.' },
        { id: 'darkness', a: 1, b: 300, better: 'a', note: 'A has less darkness.' },
        { id: 'slope', a: 1, b: 1, better: 'tie', note: 'Same slope.' },
        { id: 'roughness', a: null, b: 1, better: 'unknown', note: 'A has no roughness.' },
      ],
      dominance: 'tradeoff',
      sentences: ['A trade-off.'],
    };
    const p = pairView(DEFS, c);
    expect(p.headline).toBe('A trade-off: IM-2 Athena (A) and Apollo 11 (B) are each better on some criteria.');
    expect(p.rows.map((r) => [r.id, r.a, r.b, r.betterText])).toEqual([
      ['sunlight', '1.0 %', '20.0 %', 'B'],
      ['darkness', '1.0 h', '300.0 h (12.5 d)', 'A'],
      ['slope', '1.0°', '1.0°', 'Tie'],
      ['roughness', '1.00 m', '1.00 m', 'Unknown'],
    ]);
    expect(p.sentences).toEqual(['A trade-off.']);
    expect(dominanceSentence({ dominance: 'a-dominates' }, 'X', 'Y')).toMatch(/^X \(A\) dominates Y \(B\)/);
    expect(dominanceSentence({ dominance: 'b-dominates' }, 'X', 'Y')).toMatch(/^Y \(B\) dominates X \(A\)/);
    expect(dominanceSentence({ dominance: 'equal' }, 'X', 'Y')).toMatch(/equal on every criterion/);
    expect(dominanceSentence({ dominance: 'incomparable' }, 'X', 'Y')).toMatch(/too much is unknown/);
  });
});

describe('candidates and the buttons of a row', () => {
  const scenario = (s: SiteRef): Scenario => ({ id: s.id, label: s.name, site: s, mastHeightM: 2, startMs: 0, durationH: 336, stepMin: 10 });
  const im2 = site('im-2', 'IM-2 Athena'), pin = { ...site('pin:-84.70000,29.10000', 'Pin', 'custom'), lat: -84.7, lon: 29.1 };

  it('builds the candidates argument of findBestSites, or says why a source cannot be used', () => {
    const none = { site: null, compareA: null, compareB: null };
    expect(candidatesFor('catalogue', none, { radiusM: null, spacingM: null })).toMatchObject({ ok: true, candidates: { from: 'catalogue' } });
    expect(candidatesFor('nearby', none, { radiusM: 2000, spacingM: 300 })).toMatchObject({ ok: false });
    expect(candidatesFor('nearby', { ...none, site: im2 }, { radiusM: null, spacingM: 300 })).toMatchObject({ ok: false, why: 'Give the radius and the spacing as numbers.' });
    expect(candidatesFor('nearby', { ...none, site: im2 }, { radiusM: 2000, spacingM: 300 })).toMatchObject({ ok: true, candidates: { from: 'nearby', around: 'im-2', radiusM: 2000, spacingM: 300 } });
    expect(candidatesFor('nearby', { ...none, site: pin }, { radiusM: 2000, spacingM: 300 })).toMatchObject({ ok: true, candidates: { around: { lat: -84.7, lon: 29.1 } } });
    expect(candidatesFor('sites', none, { radiusM: null, spacingM: null })).toMatchObject({ ok: false });
    // The same site in both slots (another arrival, say) is ranked once.
    expect(savedSites(scenario(im2), scenario(im2)).map((s) => s.id)).toEqual(['im-2']);
    expect(candidatesFor('sites', { site: null, compareA: scenario(im2), compareB: scenario(pin) }, { radiusM: null, spacingM: null })).toMatchObject({ ok: true, candidates: { from: 'sites', sites: ['im-2', { lat: -84.7, lon: 29.1 }] } });
  });

  it('opens a landing with selectSite and pins any other point with dropPin; As A / As B save the slot after that', () => {
    expect(openStep(im2)).toEqual({ label: 'Open', name: 'selectSite', params: { site: 'im-2' } });
    expect(openStep(pin)).toEqual({ label: 'Pin', name: 'dropPin', params: { lat: -84.7, lon: 29.1, fly: true } });
    expect(slotSteps(im2, 'A')).toEqual([{ name: 'selectSite', params: { site: 'im-2', fly: false } }, { name: 'saveScenario', params: { slot: 'A' } }]);
    expect(slotSteps(pin, 'B')).toEqual([{ name: 'dropPin', params: { lat: -84.7, lon: 29.1 } }, { name: 'saveScenario', params: { slot: 'B' } }]);
  });

  it("says when A and B will not use the ranking's window or mast", () => {
    const app = { mastHeightM: 2, windowStartMs: Date.parse('2026-11-15T00:00Z'), windowDurationH: 336, delayH: 0 };
    expect(slotConditionsNote(PROFILE, app)).toBeNull();
    expect(slotConditionsNote(PROFILE, { ...app, mastHeightM: 10, windowDurationH: 72 })).toBe("A and B use the app's mission settings: a 3-day window instead of the profile's 14 days, a 10 m mast instead of the profile's 2 m.");
    expect(slotConditionsNote({ ...PROFILE, window: { startUtc: '2026-11-15T00:00Z', durationH: 336 } }, app)).toBeNull();
    expect(slotConditionsNote({ ...PROFILE, window: { startUtc: '2026-11-15T00:00Z', durationH: 336 } }, { ...app, delayH: 24 })).toMatch(/arrival time/);
  });

  it('tells a ranking made under other settings, and words the progress', () => {
    expect(sameProfile(PROFILE, { ...PROFILE })).toBe(true);
    expect(sameProfile(PROFILE, { ...PROFILE, window: { startUtc: '2026-11-15T00:00Z', durationH: 336 } })).toBe(true);
    expect(sameProfile(PROFILE, { ...PROFILE, thresholds: { ...PROFILE.thresholds, slope: 15 } })).toBe(false);
    expect(sameProfile(PROFILE, { ...PROFILE, weights: { ...PROFILE.weights, slope: 2 } })).toBe(false);
    expect(sameProfile(PROFILE, { ...PROFILE, mastHeightM: 3 })).toBe(false);
    expect(progressText(null, 'the catalogued landings')).toBe('Measuring the catalogued landings…');
    expect(progressText({ done: 12, total: 28 }, 'x')).toBe('Measured 12 of 28 candidates…');
  });
});
