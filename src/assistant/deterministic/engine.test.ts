import { beforeEach, describe, expect, it } from 'vitest';
import { actionLog, resetActions } from '../../core/actions';
import { installFakeApp, metricsFor, NEARBY, T0, type FakeState } from '../testing/fakeApp';
import { DeterministicEngine } from './engine';

const noWait = () => Promise.resolve();
const engine = () => new DeterministicEngine(undefined, { wait: noWait, now: () => Date.UTC(2026, 10, 14, 9, 30) });
/** Names of the actions the assistant ran, in order. */
const ran = () => actionLog().filter((e) => e.origin === 'assistant').map((e) => e.name);

describe('deterministic mode: single commands', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp();
  });

  it('selects sites by name and reports the action result', async () => {
    const r = await engine().reply('Go to Apollo 11');
    expect(r.understood).toBe(true);
    expect(state.site?.id).toBe('apollo-11');
    expect(r.text).toContain('Apollo 11');
    expect(r.text).toContain('latitude 0.6741°, longitude 23.4730° (east-positive)');
    expect(ran()).toEqual(['selectSite']);
  });

  it('passes an unknown site name to the action and repeats its error instead of guessing', async () => {
    const r = await engine().reply('go to Tranquility Base Hotel');
    expect(r.text).toContain('No catalogued landing matches');
    expect(state.site).toBeNull();
  });

  it('drops pins from several coordinate notations', async () => {
    const e = engine();
    await e.reply('drop a pin at 89.45 S, 137.2 W');
    expect(state.site).toMatchObject({ kind: 'custom', latDeg: -89.45, lonDegEast: -137.2 });
    await e.reply('go to lat -85.3 lon 31.2');
    expect(state.site).toMatchObject({ latDeg: -85.3, lonDegEast: 31.2 });
    const r = await e.reply('pin -84.79, 29.2');
    expect(state.site).toMatchObject({ latDeg: -84.79, lonDegEast: 29.2 });
    expect(r.text).toContain('latitude -84.7900°, longitude 29.2000° (east-positive)');
  });

  it('enters and leaves the surface view, and explains when it cannot', async () => {
    const e = engine();
    const refused = await e.reply('enter the surface');
    expect(refused.text).toContain('No site is selected');
    expect(state.view).toBe('globe');
    await e.reply('select IM-2 then enter the surface');
    expect(state.view).toBe('surface');
    await e.reply('back to the globe');
    expect(state.view).toBe('globe');
    expect(state.site?.id).toBe('im-2');
    await e.reply('show Apollo 11 from the surface');
    expect(state).toMatchObject({ view: 'surface', site: { id: 'apollo-11' } });
  });

  it('sets absolute and relative times in UTC', async () => {
    const e = engine();
    let r = await e.reply('set time to 2026-03-05 18:30');
    expect(state.timeMs).toBe(Date.UTC(2026, 2, 5, 18, 30));
    expect(r.text).toContain('2026-03-05 18:30 UTC');
    await e.reply('forward 6 hours');
    expect(state.timeMs).toBe(Date.UTC(2026, 2, 6, 0, 30));
    await e.reply('back 2 days');
    expect(state.timeMs).toBe(Date.UTC(2026, 2, 4, 0, 30));
    await e.reply('+90 min');
    expect(state.timeMs).toBe(Date.UTC(2026, 2, 4, 2, 0));
    r = await e.reply('14 March 2025 06:00');
    expect(state.timeMs).toBe(Date.UTC(2025, 2, 14, 6, 0));
    r = await e.reply('set the time to now');
    expect(state.timeMs).toBe(Date.UTC(2026, 10, 14, 9, 30));
    expect(r.text).toContain('2026-11-14 09:30 UTC');
  });

  it('plays, pauses and changes speed', async () => {
    const e = engine();
    await e.reply('play');
    expect(state.playing).toBe(true);
    await e.reply('pause the clock');
    expect(state.playing).toBe(false);
    await e.reply('speed 12 hours per second');
    expect(state.rate).toBe(43200);
    await e.reply('slower');
    expect(state.rate).toBe(21600);
  });

  it('jumps to events through the registered action', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('jump to next earthset');
    expect(state.timeMs).toBe(T0 + 9 * 3_600_000);
    expect(r.text).toContain('2026-03-01 21:00 UTC');
    expect(r.text).toContain('348.4°');
    const none = await e.reply('previous sunset');
    expect(none.text).toContain('No previous sunset inside the analysed mission window');
  });

  it('sets delay, mast, window and requirements', async () => {
    const e = engine();
    await e.reply('delay arrival by 24 h');
    expect(state.delayH).toBe(24);
    await e.reply('what if we land a day and a half late'.replace('a day and a half', '36 hours'));
    expect(state.delayH).toBe(36);
    await e.reply('no delay');
    expect(state.delayH).toBe(0);
    await e.reply('mast 10 m');
    expect(state.mastHeightM).toBe(10);
    await e.reply('mission window 14 days');
    expect(state.windowDurationH).toBe(336);
    await e.reply('window starts 2026-01-05 00:00 for 3 days');
    expect(state).toMatchObject({ windowStartMs: Date.UTC(2026, 0, 5), windowDurationH: 72 });
    await e.reply('slope limit 8');
    expect(state.slopeLimitDeg).toBe(8);
    await e.reply('maximum earth gap 12 h');
    expect(state.maxEarthGapH).toBe(12);
    await e.reply('no earth gap limit');
    expect(state.maxEarthGapH).toBeNull();
    await e.reply('sun elevation between 5 and 60 degrees');
    expect(state.sunBand).toEqual({ min: 5, max: 60 });
  });

  it('switches overlays, markers, filters and lighting', async () => {
    const e = engine();
    let r = await e.reply('show the average illumination map');
    expect(state.overlay).toBe('avg-illumination');
    expect(r.text).toContain('multi-year average');
    await e.reply('show the sun band overlay');
    expect(state.overlay).toBe('sun-band');
    await e.reply('hide overlay');
    expect(state.overlay).toBe('off');
    await e.reply('hide missions');
    expect(state.showMissions).toBe(false);
    r = await e.reply('only Apollo');
    expect(state.filter.programs).toEqual(['Apollo']);
    expect(r.text).toContain('Showing 1 of 3');
    r = await e.reply('only India');
    expect(state.filter.countries).toEqual(['India']);
    r = await e.reply('only Narnia');
    expect(r.text).toContain('Unknown program "narnia"');
    await e.reply('missions from 2020 to 2026');
    expect(state.filter).toMatchObject({ fromYear: 2020, toYear: 2026 });
    await e.reply('only crewed');
    expect(state.filter.type).toBe('crewed');
    await e.reply('reset filters');
    expect(state.filter).toMatchObject({ programs: null, type: 'all', fromYear: null });
    await e.reply('even lighting');
    expect(state.lightMode).toBe('even');
  });

  it('looks around in the surface view', async () => {
    const e = engine();
    const refused = await e.reply('look north');
    expect(refused.text).toContain('Enter the surface view first');
    await e.reply('go to IM-2 on the surface');
    await e.reply('look south-east');
    expect(state.look.azDeg).toBe(135);
    await e.reply('turn right');
    expect(state.look.azDeg).toBe(180);
    await e.reply('look up');
    expect(state.look.elDeg).toBe(15);
    await e.reply('look at azimuth 300 elevation 5');
    expect(state.look).toMatchObject({ azDeg: 300, elDeg: 5 });
    await e.reply('zoom in');
    expect(state.look.fovDeg).toBeCloseTo(49);
  });

  it('moves the globe camera without dropping a pin', async () => {
    const e = engine();
    await e.reply('show the south pole');
    expect(state.globeCenter).toMatchObject({ latDeg: -90, lonDegEast: 0 });
    await e.reply('turn the globe to 10 N 45 E');
    expect(state.globeCenter).toMatchObject({ latDeg: 10, lonDegEast: 45 });
    expect(state.site).toBeNull();
    await e.reply('show the whole moon');
    expect(state.globeCenter.altitudeKm).toBeCloseTo(4169.76);
    await e.reply('zoom in');
    expect(state.globeCenter.altitudeKm).toBeCloseTo(2084.88);
  });

  it('answers questions from getState only', async () => {
    const e = engine();
    expect((await e.reply('what time is it?')).text).toContain('2026-03-01 12:00 UTC');
    expect((await e.reply('status')).text).toContain('No site is selected');
    await e.reply('go to IM-2');
    const r = await e.reply('what is the illumination?');
    const m = metricsFor({ id: 'im-2', name: 'IM-2 Athena', kind: 'landing', latDeg: -84.7906, lonDegEast: 29.1957 }, 2, 0);
    expect(r.text).toContain(`illumination ${m.illuminationPct.toFixed(1)} %`);
    expect(r.text).toContain(`longest darkness ${m.longestDarknessH.toFixed(1)} h`);
    expect(r.text).toContain(`slope ${m.slopeDeg.toFixed(1)}°`);
    expect(r.text).toContain('not a guarantee of a working radio link');
    // Questions change nothing.
    expect(ran().filter((n) => !['getState', 'selectSite'].includes(n))).toEqual([]);
  });

  it('waits for a running analysis instead of reporting stale or missing numbers', async () => {
    state = installFakeApp({ analysisLoadingPolls: 3 });
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('metrics');
    expect(r.text).toContain('illumination');
    expect(r.text).not.toContain('unavailable');
  });
});

describe('deterministic mode: refusing to guess', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp();
  });

  it('says what it did not understand and runs nothing, even when another part was clear', async () => {
    const r = await engine().reply('go to Apollo 11, then make it look nice');
    expect(r.understood).toBe(false);
    expect(r.text).toContain('I did not understand "make it look nice"');
    expect(r.text).toContain('I did understand: select the site "apollo 11"');
    expect(r.text).toContain('Nothing was changed');
    expect(state.site).toBeNull();
    expect(ran()).toEqual([]);
  });

  it('does not treat free-form questions as commands', async () => {
    for (const text of ['why is the sky black?', 'tell me a joke', 'what should I have for lunch', 'is this a good place for a base']) {
      const r = await engine().reply(text);
      expect(r.understood, text).toBe(false);
    }
    expect(ran()).toEqual([]);
  });

  it('stops a chain at the first failing action and says what was not run', async () => {
    const r = await engine().reply('enter the surface then look north then pause');
    expect(r.text).toContain('No site is selected');
    expect(r.text).toContain('2 later steps were not run');
    expect(ran()).toEqual(['enterSurface']);
  });

  it('reports actions this build does not have instead of approximating them', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('rank nearby sites');
    expect(r.text).toContain('has no "rankNearby" action');
    const b = await e.reply('what blocks the earth');
    expect(b.text).toContain('not available in this build');
  });

  it('asks which body is meant when "the ridge" is ambiguous', async () => {
    const r = await engine().reply('show me the ridge');
    expect(r.text).toContain('Do you mean the Sun or the Earth?');
    expect(ran()).toEqual([]);
  });
});

describe('deterministic mode: every action is reachable by name', () => {
  beforeEach(() => {
    installFakeApp();
  });

  it('lists the registry and runs any action with JSON parameters', async () => {
    const e = engine();
    const list = await e.reply('/actions');
    expect(list.text).toContain('/setOverlay {mode}: Set globe overlay');
    expect(list.text).toContain('/getState: Current state');
    const r = await e.reply('/setOverlay {"mode":"sun-band"}');
    expect(r.text).toContain('{"overlay":"sun-band"}');
    const bad = await e.reply('/setOverlay {"mode":"purple"}');
    expect(bad.text).toContain('params.mode must be one of');
    const unknown = await e.reply('/launchRocket');
    expect(unknown.text).toContain('There is no action named "launchRocket"');
    const json = await e.reply('/setOverlay {mode: off}');
    expect(json.text).toContain('not valid JSON');
  });

  it('help lists only what the build can do', async () => {
    const r = await engine().reply('help');
    expect(r.text).toContain('go to Apollo 11');
    expect(r.text).not.toContain('rank nearby');
    resetActions();
    installFakeApp({ analysisActions: true });
    expect((await engine().reply('help')).text).toContain('rank nearby');
  });
});

describe('deterministic mode: comparison and nearby alternatives', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp({ analysisActions: true });
  });

  it('compares an on-time arrival with a delayed one and quotes both sides', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare with a 24 h delay');
    const site = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, latDeg: -84.7906, lonDegEast: 29.1957 };
    const a = metricsFor(site, 2, 0), b = metricsFor(site, 2, 24);
    expect(state.comparing).toBe(true);
    expect(r.text).toContain(`A: IM-2 Athena, from 2026-03-01T12:00Z for 24 h, mast 2 m: illumination ${a.illuminationPct.toFixed(1)} %`);
    expect(r.text).toContain(`illumination ${b.illuminationPct.toFixed(1)} %`);
    expect(r.text).toContain(`B minus A: illumination ${(b.illuminationPct - a.illuminationPct).toFixed(1)} percentage points, longest darkness +${(b.longestDarknessH - a.longestDarknessH).toFixed(1)} h`);
    expect(ran()).toEqual(['selectSite', 'setDelay', 'saveScenario', 'setDelay', 'saveScenario', 'compare']);
  });

  it('waits while the app has not started, or not finished, analysing the saved scenarios', async () => {
    state = installFakeApp({ analysisActions: true, compareSettleCalls: 3 });
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare with a 24 h delay');
    expect(r.text).not.toContain('no analysis available');
    expect(r.text).not.toContain('still being analysed');
    expect(r.text).toContain('B minus A: illumination -6.0 percentage points');
    // The waiting is silent: one compare in the action log.
    expect(ran().filter((n) => n === 'compare')).toHaveLength(1);
  });

  it('compares two mast heights', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare mast 2 m and 10 m');
    expect(state.mastHeightM).toBe(10);
    expect(r.text).toContain('mast 2 m');
    expect(r.text).toContain('mast 10 m');
    expect(r.text).toContain('B minus A: illumination +4.0 percentage points');
  });

  it('saves scenarios, opens and closes the comparison', async () => {
    const e = engine();
    const early = await e.reply('compare');
    expect(early.text).toContain('Save a scenario in slot A and B first');
    await e.reply('go to IM-2 then save as A');
    await e.reply('go to Apollo 11 then save as B');
    const r = await e.reply('compare A and B');
    expect(r.text).toContain('A: IM-2 Athena');
    expect(r.text).toContain('B: Apollo 11');
    await e.reply('close comparison');
    expect(state.comparing).toBe(false);
  });

  it('ranks nearby alternatives and reports the top rows with the basis', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('rank nearby sites within 2 km');
    expect(r.text).toContain('Ranked 3 alternatives near IM-2 Athena');
    expect(r.text).toContain("1. Candidate 1 (640 m to the south-east (152°)): slope 6.8°, illumination 71.5 %, longest darkness 31.0 h, Earth's centre in view 64.0 %");
    expect(r.text).toContain('Basis: Slope and skyline from the 60 m grid');
    await e.reply('go there');
    expect(state.site?.id).toBe('cand-1');
  });

  it('applies "flatter" and "shorter blackout" against the pin and remembers the pick', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const pinMetrics = metricsFor(state.site!, 2, 0);
    const r = await e.reply('Find a flatter nearby site with a shorter blackout');
    // Candidate 1 is steeper than the pin (6.8 vs 3.75), candidate 2 is flatter and darker for less time.
    expect(pinMetrics.slopeDeg).toBe(3.75);
    expect(r.text).toContain('Found a site with flatter and a shorter blackout: Candidate 2');
    expect(r.text).toContain(`slope 2.1° (this pin: ${pinMetrics.slopeDeg.toFixed(1)}°)`);
    expect(r.text).toContain(`longest darkness 38.5 h (this pin: ${pinMetrics.longestDarknessH.toFixed(1)} h)`);
    expect(e.memory.candidate).toMatchObject({ id: 'cand-2', rank: 2 });
    expect(e.memory.reference).toMatchObject({ id: 'im-2' });
    // Finding does not move the pin.
    expect(state.site?.id).toBe('im-2');
  });

  it('says so when no alternative meets the conditions', async () => {
    state = installFakeApp({ analysisActions: true, nearby: [NEARBY[0], NEARBY[2]] });
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('find a flatter nearby site');
    expect(r.text).toContain('None of the 2 ranked alternatives has flatter than this pin (slope 3.8°). The best-ranked alternative is Candidate 1');
    expect(e.memory.candidate).toBeUndefined();
  });

  it('runs the full scenario as a chain and leaves comparison, site, time and camera in place', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset.');
    expect(r.understood).toBe(true);
    expect(ran().slice(1)).toEqual(['getState', 'rankNearby', 'getState', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'getState', 'jumpToEvent', 'explainBlockage', 'getState', 'enterSurface', 'lookAt']);
    expect(state.comparing).toBe(true);
    expect(state.compareA?.label).toContain('IM-2 Athena');
    expect(state.compareB?.label).toContain('Candidate 2');
    expect(state.site?.id).toBe('cand-2');
    expect(state.timeMs).toBe(T0 + 9 * 3_600_000);
    expect(state.view).toBe('surface');
    expect(state.look).toMatchObject({ azDeg: 348.4, elDeg: 2.31 });
    // Same mission window on both sides.
    expect(state.compareA?.label).toContain('from 2026-03-01T12:00Z for 24 h');
    expect(state.compareB?.label).toContain('from 2026-03-01T12:00Z for 24 h');
    expect(r.text).toContain('Moved the clock to the next Earthset: 2026-03-01 21:00 UTC');
    expect(r.text).toContain('Earth is hidden by a ridge 4.20 km away');
    expect(r.text).toContain('Ridge: 4.20 km away, 1385 m above the reference sphere; clearance -0.47°. Elevation data: LOLA 60 m polar grid (60 m).');
  });

  it('needs an earlier search before "compare it against this pin"', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare it against this pin');
    expect(r.text).toContain('I do not know which site "it" is yet');
  });
});

describe('deterministic mode: on a build with the awaiting core actions and no dedicated blockage action', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp({ getAnalysis: true, landingActions: true });
  });

  it('goes to a landing at its touchdown time in one step', async () => {
    const e = engine();
    const r = await e.reply('show IM-2 at its landing time');
    expect(state).toMatchObject({ site: { id: 'im-2' }, timeMs: Date.UTC(2025, 2, 6, 17, 28), windowStartMs: Date.UTC(2025, 2, 6, 17, 28), delayH: 0 });
    expect(r.text).toContain('The clock and the mission window start at touchdown, 2025-03-06 17:28 UTC.');
    expect(ran()).toEqual(['selectSite']);
    await e.reply('go to Apollo 11 at landing on the surface');
    expect(state).toMatchObject({ site: { id: 'apollo-11' }, view: 'surface', timeMs: Date.UTC(1969, 6, 20, 20, 17) });
    await e.reply('set time to 2026-01-01 then mission window starts at landing');
    expect(state.windowStartMs).toBe(Date.UTC(1969, 6, 20, 20, 17));
    expect(state.timeMs).toBe(Date.UTC(2026, 0, 1));
  });

  it('shows the ridge at Earthset from the analysis readout', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('show me the ridge at Earthset');
    expect(ran().slice(1)).toEqual(['jumpToEvent', 'getAnalysis', 'getState', 'enterSurface', 'lookAt']);
    expect(state).toMatchObject({ timeMs: T0 + 9 * 3_600_000, view: 'surface', look: { azDeg: 351, elDeg: 6.4 } });
    expect(r.text).toContain('Moved the clock to the next Earthset: 2026-03-01 21:00 UTC.');
    expect(r.text).toContain('Earth is hidden by terrain 4.20 km away towards azimuth 351.0°');
    expect(r.text).toContain('Ridge: 4.20 km away, 1385 m above the reference sphere; clearance -0.80°. Elevation data: LOLA 60 m polar grid (60 m).');
    expect(r.text).toContain('not a guarantee of a working radio link');
  });

  it('reports unmet requirements and the elevation data with the metrics', async () => {
    const e = engine();
    await e.reply('go to IM-2; sun elevation between 0 and 60; maximum earth gap 12 h');
    const r = await e.reply('metrics');
    expect(r.text).toContain('The Sun leaves the required elevation band (0.0° to 60.0°) during the window: it ranges from -1.2° to 4.6°.');
    expect(r.text).toContain('The longest Earth-centre gap (28.5 h) is longer than the tolerated 12.0 h.');
    expect(r.text).toContain('Elevation data, finest first: LOLA 60 m polar grid (60 m); LOLA whole-Moon grid (1895 m).');
  });

  it('folds and opens panels', async () => {
    const e = engine();
    expect((await e.reply('hide the site details')).text).toBe('The site details are folded away.');
    expect((await e.reply('open the filters panel')).text).toBe('The filters panel is open.');
    expect(ran()).toEqual(['showPanel', 'showPanel']);
  });
});

describe('deterministic mode: on an older build', () => {
  beforeEach(() => {
    installFakeApp();
  });

  it('says that the one-step landing date is not available instead of selecting without it', async () => {
    const r = await engine().reply('show IM-2 at its landing time');
    expect(r.text).toContain('cannot go to a landing and its date in one step');
    expect(ran()).toEqual([]);
  });
});

describe('deterministic mode: with the analysis readout action', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp({ analysisActions: true, getAnalysis: true });
  });

  it('reads Sun and Earth positions and event times without moving the clock', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const sun = await e.reply('where is the sun?');
    expect(sun.text).toContain("The Sun's centre at 2026-03-01 12:00 UTC: azimuth 143.2°, elevation 3.4°, 1.10° above the terrain skyline (visible)");
    const earth = await e.reply('is the earth visible');
    expect(earth.text).toContain('0.80° below the terrain skyline (hidden)');
    expect(earth.text).toContain('not a guarantee of a working radio link');
    const when = await e.reply('when is the next sunset?');
    expect(when.text).toContain('The next sunset: 2026-03-02 08:00 UTC, azimuth 268.9°');
    expect(state.timeMs).toBe(T0);
    await e.reply('look at the earth');
    expect(state).toMatchObject({ view: 'surface', look: { azDeg: 351, elDeg: 5.6 } });
  });
});
