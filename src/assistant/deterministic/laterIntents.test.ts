// Deterministic mode and the actions added after its first grammar: globe drawing, site
// science, the surface view's own actions, the catalogue and the compare panel. Against the
// stand-in app, which registers them with the real names, parameters and result shapes.
import { beforeEach, describe, expect, it } from 'vitest';
import { actionLog } from '../../core/actions';
import { ALL_ACTIONS, ICE_TARGETS, installFakeApp, metricsFor, type FakeAppOptions, type FakeState } from '../testing/fakeApp';
import { DeterministicEngine } from './engine';
import { EXAMPLES } from './examples';

const noWait = () => Promise.resolve();
const engine = () => new DeterministicEngine(undefined, { wait: noWait, now: () => Date.UTC(2026, 10, 14, 9, 30) });
/** The assistant's actions since log entry `from`, in order. */
const ranSince = (from: number) => actionLog().filter((e) => e.origin === 'assistant' && e.seq > from).map((e) => ({ name: e.name, ok: e.ok, params: e.params as Record<string, unknown>, error: e.error }));
const lastSeq = () => actionLog().at(-1)?.seq ?? 0;
const names = (from = 0) => ranSince(from).map((e) => e.name);

describe('deterministic mode reaches every action by a phrase', () => {
  it('has one example per action, none twice', () => {
    const seen = EXAMPLES.map((e) => e.action);
    expect(new Set(seen).size).toBe(seen.length);
  });

  for (const ex of EXAMPLES) {
    it(`"${ex.say}" runs ${ex.action}`, async () => {
      installFakeApp(ALL_ACTIONS);
      const e = engine();
      for (const g of ex.given ?? []) {
        const r = await e.reply(g);
        expect(r.understood, `setup "${g}": ${r.text}`).toBe(true);
      }
      const from = lastSeq();
      const r = await e.reply(ex.say);
      expect(r.understood, r.text).toBe(true);
      const run = ranSince(from);
      const hit = run.find((x) => x.name === ex.action);
      expect(hit, `ran ${JSON.stringify(run.map((x) => x.name))}; reply: ${r.text}`).toBeDefined();
      expect(hit!.ok, hit!.error).toBe(true);
    });
  }
});

describe('deterministic mode: how the globe is drawn', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('sets the explored areas\' drawn size apart from the relief, without calling the factor a width multiple (T-64: setTerritoryScale)', async () => {
    const e = engine();
    const cases: [string, number][] = [
      ['territory size x25', 25],
      ['draw the explored areas 10 times wider', 10],
      ['territory size exaggeration 50', 50],
      ['territories at true size', 1],
    ];
    for (const [say, factor] of cases) {
      const r = await e.reply(say);
      expect(r.understood, say).toBe(true);
      expect(state.territoryScale, say).toBe(factor);
    }
    // "Exaggeration" alone is still the relief: the territory words decide.
    expect(state.reliefFactor).toBe(10);
    // The factor is a display setting, not a width multiple: the reply never says "N times wider".
    const said = (await e.reply('territory size x25')).text;
    expect(said).toBe('Territory size exaggeration set to ×25, as the Filters setting of that name: it only changes how large the explored areas are drawn on the globe, not their real size on the site card.');
    expect(said).not.toMatch(/times wider/);
    const tooMuch = await e.reply('territory size x500');
    expect(tooMuch.text).toContain('params.factor must be at most 100');
    expect(state.territoryScale).toBe(25);
  });

  it('sets the relief exaggeration from several phrasings, and says what the factor means', async () => {
    const e = engine();
    const cases: [string, number][] = [
      ['relief x5', 5],
      ['set the relief exaggeration to 20', 20],
      ['exaggerate the relief 2 times', 2],
      ['relief 3x', 3],
      ['true scale relief', 1],
      ['turn off the exaggeration', 1],
      ['relief off', 0],
      ['show the moon as a smooth sphere', 0],
    ];
    for (const [say, factor] of cases) {
      const r = await e.reply(say);
      expect(r.understood, say).toBe(true);
      expect(state.reliefFactor, say).toBe(factor);
    }
    expect((await e.reply('relief x10')).text).toBe('Relief exaggeration set to ×10; drawn at ×10 at the present camera altitude. The chosen factor applies above 1,000 km camera altitude and eases to true scale (1) below 100 km. The analysis never uses the exaggeration.');
    expect((await e.reply('relief off')).text).toContain('smooth sphere');
    // Beyond what the action takes: its own refusal, nothing changed.
    const tooMuch = await e.reply('relief x50');
    expect(tooMuch.text).toContain('params.factor must be at most 30');
    expect(state.reliefFactor).toBe(0);
  });

  it('shows and hides the coverage outlines and the ice-target outlines', async () => {
    const e = engine();
    await e.reply('show the elevation data coverage');
    expect(state.coverage).toBe(true);
    await e.reply('coverage off');
    expect(state.coverage).toBe(false);
    const ice = await e.reply('show the ice targets');
    expect(state.iceTargets).toBe(true);
    expect(ice.text).toContain('not confirmed deposits');
    await e.reply('hide ice outlines');
    expect(state.iceTargets).toBe(false);
    expect(names()).toEqual(['showCoverage', 'showCoverage', 'showIceTargets', 'showIceTargets']);
  });
});

describe('deterministic mode: site science', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('reads the DSN stations from the result and says it is geometry only', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('which dsn stations can see the site?');
    expect(names().slice(1)).toEqual(['getSiteScience']);
    expect(r.text).toContain('Deep Space Network stations over the mission window 2026-03-01 12:00 UTC to 2026-03-02 12:00 UTC');
    expect(r.text).toContain("the site above the station's 10° limit");
    expect(r.text).toContain('- Goldstone DSS-14 (Goldstone, USA): in view 59.1 % of the window, longest gap 9 h 48 min');
    expect(r.text).toContain('- any station: in view 100.0 % of the window, longest gap none');
    expect(r.text).toContain('Geometric line of sight only: not a link budget, not a schedule, not antenna availability.');
  });

  it('lists the nearest ice targets, and "ice near here" is not a nearby-site scan', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('what ice targets are near here?');
    expect(names().slice(1)).toEqual(['nearestIceTargets']);
    expect(r.text).toContain('Nearest mapped ice targets from latitude -84.7906°, longitude 29.1957° (east-positive):');
    expect(r.text).toContain(`1. ${ICE_TARGETS[0].label}: 6.6 km, bearing south-west (212°).`);
    expect(r.text).toContain('Straight-line distance over a 1737.4 km sphere');
    expect(r.text).toContain('Source: Lemelin et al. 2021');
    const from = lastSeq();
    await e.reply('list the 2 nearest ice targets');
    expect(ranSince(from)[0].params).toEqual({ count: 2 });
  });

  it('says where the readouts have no data, in the words of the result', async () => {
    const e = engine();
    await e.reply('go to Apollo 11');
    const r = await e.reply('site science');
    expect(r.text).toContain('Long-term averages: No published average map covers this point: the maps cover the polar regions only.');
    expect(r.text).toContain('Nearest mapped ice targets: No mapped region lies within 500 km: the database covers the south polar region only.');
    expect(r.text).toContain('Surface temperature (LRO Diviner): The Diviner polar maps cover only latitudes poleward of 80 degrees.');
    expect(r.text).toContain('ShadowCam: none of the 26 controlled mosaics in the index covers this point.');
  });

  it('reads Diviner temperatures as annual values, and says so on a build without them', async () => {
    let e = engine();
    await e.reply('go to IM-2');
    let r = await e.reply('what is the temperature here?');
    expect(r.text).toContain('annual maximum 226 K, annual mean 127 K');
    expect(r.text).toContain('not the temperature at the simulated date');
    installFakeApp({ ...ALL_ACTIONS, scienceActions: true });
    e = engine();
    await e.reply('go to IM-2');
    r = await e.reply('how cold is it?');
    expect(r.text).toContain('Surface temperature: Diviner seasonal temperatures and ShadowCam imagery are not packaged in this build.');
  });

  it('keeps the long-term averages apart from the overlay of the same data and from the window figures', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const reading = await e.reply('what is the long-term average sunlight here?');
    expect(names().at(-1)).toBe('getSiteScience');
    expect(reading.text).toContain('- any sunlight: 45 % of the time, 120 m cell');
    expect(reading.text).toContain('not the geometry of the simulated date or of the mission window');
    await e.reply('show the average sunlight map');
    expect(names().at(-1)).toBe('setOverlay');
    expect(state.overlay).toBe('avg-illumination');
    // The dated window figure is still the analysis.
    await e.reply('what is the illumination?');
    expect(names().at(-1)).toBe('getState');
    expect(names()).toContain('getAnalysis');
  });
});

describe('deterministic mode: the surface view', () => {
  let state: FakeState;
  beforeEach(async () => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('faces the Sun or Earth with the HUD action and gives the clearance from the analysis', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('face the earth');
    expect(names().slice(1)).toEqual(['getState', 'enterSurface', 'lookAtBody', 'getAnalysis']);
    expect(state).toMatchObject({ view: 'surface', look: { azDeg: 351, elDeg: 5.6 } });
    expect(r.text).toContain('Facing Earth: azimuth 351.0°, elevation 5.6°, its centre 0.80° below the terrain skyline.');
    expect(r.text).toContain('not a guarantee of a working radio link');
  });

  it('uses the field-of-view action and its own range for zooming', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    let from = lastSeq();
    expect((await e.reply('field of view 2')).text).toContain('Field of view: 4.0°');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['setFieldOfView', { fovDeg: 4 }]]);
    await e.reply('field of view 70');
    from = lastSeq();
    await e.reply('zoom in');
    expect(ranSince(from).map((x) => x.name)).toEqual(['getState', 'setFieldOfView']);
    expect(state.look.fovDeg).toBe(49);
  });

  it('falls back to lookAt for zooming on a build without the surface actions', async () => {
    state = installFakeApp({ getAnalysis: true });
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    await e.reply('zoom in');
    expect(names().at(-1)).toBe('lookAt');
    expect(state.look.fovDeg).toBe(49);
  });

  it('walks relative to where the viewer stands, keeps the lift, and walks back like the HUD button', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    let r = await e.reply('walk 200 m north');
    expect(state.position).toEqual({ eastM: 0, northM: 200, liftM: 0 });
    expect(r.text).toContain('Now 0 m east and 200 m north of the site (200 m from it), eye 2.0 m above the ground.');
    expect(r.text).toContain('The Sun, Earth and the mission-window figures stay those of the site.');
    await e.reply('walk 100 m east');
    expect(state.position).toEqual({ eastM: 100, northM: 200, liftM: 0 });
    await e.reply('rise 20 m');
    expect(state.position).toEqual({ eastM: 100, northM: 200, liftM: 20 });
    await e.reply('walk 50 m south');
    expect(state.position).toEqual({ eastM: 100, northM: 150, liftM: 20 });
    await e.reply('come back down');
    expect(state.position.liftM).toBe(0);
    await e.reply('walk to 300 m west and 40 m south');
    expect(state.position).toEqual({ eastM: -300, northM: -40, liftM: 0 });
    r = await e.reply('walk 5 km east');
    expect(state.position.eastM).toBe(2000);
    expect(r.text).toContain('as far as the walkable area goes');
    const from = lastSeq();
    r = await e.reply('return to the site');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['walkTo', { eastM: 0, northM: 0 }]]);
    expect(r.text).toContain('Now at the site');
  });

  it('does not read "go back" or "move 30 m back" as walking', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    expect((await e.reply('go back')).understood).toBe(false);
    const from = lastSeq();
    await e.reply('go back 30 min');
    expect(ranSince(from).map((x) => x.name)).toEqual(['setTime']);
  });

  it('refuses to walk on the globe, with the reason', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('walk 200 m north');
    expect(r.text).toContain('Walking works in the surface view');
    expect(names().slice(1)).toEqual(['getSurfaceView']);
  });

  it('switches the sky paths like the HUD button, or the labels alone', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    let r = await e.reply('hide the sky paths');
    expect(state.annotations).toEqual({ tracks: false, labels: false });
    expect(r.text).toBe('Sun and Earth tracks hidden, labels hidden.');
    r = await e.reply('show the labels');
    expect(state.annotations).toEqual({ tracks: false, labels: true });
    r = await e.reply('show the sky paths');
    expect(r.text).toContain('One mark per 1 h 00 min for the Sun and per 2 h 00 min for Earth');
  });

  it('describes what the surface view is built from', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    await e.reply('walk 100 m east');
    const r = await e.reply('what is the ground made of?');
    expect(r.text).toContain('standing 100 m east and 0 m north of the site, eye 2.0 m above the ground');
    expect(r.text).toContain('Ground: LOLA 40 m polar grid to 30 km, whole-Moon grid beyond.');
    expect(r.text).toContain('- 0 m to 30.00 km: LOLA 40 m polar grid (40 m)');
    expect(r.text).toContain('Generated, not measured: Rocks, craters a few metres across');
    expect(r.text).toContain('Earth: azimuth 351.00°, elevation 5.60°, 48 % lit, centre behind the terrain as drawn');
  });
});

describe('deterministic mode: the catalogue and the compare panel', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('lists the catalogued landings, oldest first', async () => {
    const r = await engine().reply('list the landing sites');
    expect(r.text).toContain('3 catalogued landings, oldest first:');
    expect(r.text.indexOf('Apollo 11')).toBeLessThan(r.text.indexOf('Chandrayaan-3'));
    expect(r.text).toContain('- Apollo 11 (Apollo, USA, 1969-07-20, crewed)');
  });

  it('compares a later arrival with the panel action and leaves the scenario on screen alone', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare with a 24 h delay');
    expect(names().slice(1)).toEqual(['compareDelayedArrival']);
    expect(state.delayH).toBe(0);
    expect(state).toMatchObject({ comparing: true, panelTab: 'compare' });
    expect(r.text).toContain('Comparing the scenario on screen (A, arriving 2026-03-01 12:00 UTC) with the same arriving 24.0 h later (B, 2026-03-02 12:00 UTC).');
    const site = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, latDeg: -84.7906, lonDegEast: 29.1957 };
    expect(r.text).toContain(`B minus A: illumination ${(metricsFor(site, 2, 24).illuminationPct - metricsFor(site, 2, 0).illuminationPct).toFixed(1)} percentage points`);
  });

  it('compares two masts with the panel action and leaves the mast on screen alone', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const r = await e.reply('compare mast 2 m and 10 m');
    expect(names().slice(1)).toEqual(['compareMastHeights']);
    expect(state.mastHeightM).toBe(2);
    expect(r.text).toContain('Comparing mast heights 2 m (A) and 10 m (B)');
  });

  it('after a nearby scan, comparing shows the A/B view again (the panel follows compare)', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    await e.reply('find a flatter nearby site with a shorter blackout');
    expect(state.panelTab).toBe('nearby');
    await e.reply('compare it against this pin');
    expect(state).toMatchObject({ comparing: true, panelTab: 'compare', site: { id: 'cand-2' } });
    expect(names().at(-1)).toBe('compare');
  });

  it('saves, lists, loads and deletes comparisons by name, and swaps and empties the slots', async () => {
    const e = engine();
    await e.reply('go to IM-2 then save as A then mast 10 m then save as B');
    let r = await e.reply('Save this comparison as Night Test');
    expect(r.text).toContain('Saved the comparison as "Night Test" (1 saved comparison now)');
    r = await e.reply('list saved comparisons');
    expect(r.text).toContain('1 saved comparison (kept in this browser), newest first:');
    expect(r.text).toContain('- "Night Test", saved 2026-03-01 12:00 UTC');
    r = await e.reply('swap A and B');
    expect(state.compareA?.label).toContain('mast 10 m');
    expect(r.text).toContain('Swapped A and B');
    await e.reply('clear slot B');
    expect(state.compareB).toBeNull();
    r = await e.reply('load comparison Night Test');
    expect(state.compareA?.label).toContain('mast 2 m');
    expect(r.text).toContain('Loaded "Night Test"');
    r = await e.reply('delete comparison Night Test');
    expect(r.text).toContain('Deleted the saved comparison "Night Test"; 0 saved comparisons left.');
    r = await e.reply('load comparison Night Test');
    expect(r.text).toContain('No saved comparison is called "Night Test".');
  });

  it('opens the panel on a tab', async () => {
    const e = engine();
    const r = await e.reply('show the nearby sites tab');
    expect(state.panelTab).toBe('nearby');
    expect(r.text).toContain('The compare panel is open on its "Nearby sites" tab.');
  });
});

describe('deterministic mode: the site science section of the card', () => {
  it('folds and opens the section with showPanel, and still reads the science for "site science"', async () => {
    installFakeApp(ALL_ACTIONS);
    const e = engine();
    await e.reply('go to IM-2');
    let from = lastSeq();
    expect((await e.reply('fold the site science')).text).toBe('The site science section is folded away.');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['showPanel', { panel: 'site-science', open: false }]]);
    from = lastSeq();
    expect((await e.reply('show the site science section')).text).toBe('The site science section is open.');
    expect(ranSince(from).map((x) => x.name)).toEqual(['showPanel']);
    from = lastSeq();
    await e.reply('site science');
    expect(ranSince(from).map((x) => x.name)).toEqual(['getSiteScience']);
  });
});

describe('deterministic mode: the surface HUD', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('drives the skyline chart like its buttons, one field at a time', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    const steps: [string, Partial<FakeState['hud']>][] = [
      ['expand the skyline chart', { chart: 'expanded' }],
      ['chart against time', { mode: 'time' }],
      ['show the chart as a table', { table: true }],
      ['skyline mode chart', { mode: 'skyline' }],
      ['chart tracks only', { azimuthRange: 'tracks' }],
      ['shrink the chart', { chart: 'compact' }],
      ['hide the chart', { chart: 'hidden' }],
      ['show the skyline chart', { chart: 'compact' }],
    ];
    for (const [say, want] of steps) {
      const r = await e.reply(say);
      expect(r.understood, say).toBe(true);
      expect(state.hud, say).toMatchObject(want);
    }
    expect((await e.reply('hide the chart')).text).toBe('The skyline chart is hidden.');
  });

  it('folds and opens the key metrics, and closes the explanation', async () => {
    const e = engine();
    await e.reply('go to IM-2 then enter the surface');
    expect((await e.reply('fold the key metrics')).text).toBe('The key metrics are folded: only their title shows.');
    expect(state.hud.metricsOpen).toBe(false);
    await e.reply('show the key metrics');
    expect(state.hud.metricsOpen).toBe(true);
    state.hud.explanation = true;
    expect((await e.reply('close the explanation')).text).toBe('The blockage explanation is closed.');
    expect(state.hud.explanation).toBe(false);
  });
});

describe('deterministic mode: the outlook, the window table and the export', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('shows the seasonal outlook and reports planned, best and worst arrival from the result', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const from = lastSeq();
    const r = await e.reply('show the seasonal outlook for 3 months');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['showOutlook', { months: 3 }]]);
    expect(state).toMatchObject({ comparing: true, panelTab: 'outlook' });
    expect(r.text).toContain('over 3 lunar months');
    expect(r.text).toContain("- best arrival 2026-03-10 12:00 UTC: score 75.5, sunlight 70.5 %, Earth's centre in view 80.5 %");
    expect(r.text).toContain('Slips: 1 d: score 1 (sunlight 0.5 points');
    expect(r.text).toContain('Scoring: score = mean of illuminationPct and earthVisiblePct');
  });

  it('opens the window table and the outlook tab, and downloads the results', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    await e.reply('show the window table');
    expect(state.panelTab).toBe('windows');
    await e.reply('open the outlook tab');
    expect(state.panelTab).toBe('outlook');
    const r = await e.reply('export the results as json');
    expect(r.text).toBe('Downloaded the mission-window results as JSON: lunyx-im-2-window.json (2048 bytes, 6 spells).');
  });
});

describe('deterministic mode: mission presets, flags, the real "now"', () => {
  let state: FakeState;
  beforeEach(() => {
    state = installFakeApp(ALL_ACTIONS);
  });

  it('lists the presets and replays one by a word of its id or title', async () => {
    const e = engine();
    const list = await e.reply('which missions can i replay?');
    expect(list.text).toContain('3 missions can be replayed from bundled data:');
    expect(list.text).toContain('- Eclipse of 14 March 2025 at the Blue Ghost site (say "replay eclipse-2025-03-14")');
    let r = await e.reply('replay the eclipse');
    expect(state.preset).toBe('eclipse-2025-03-14');
    expect(r.text).toContain('Replaying Eclipse of 14 March 2025 at the Blue Ghost site');
    r = await e.reply('replay im-2 landing');
    expect(state.preset).toBe('im-2-landing');
    // "Blue Ghost" names one preset by id and another by title: the id decides.
    await e.reply('replay blue ghost');
    expect(state.preset).toBe('blue-ghost-landing');
    r = await e.reply('replay apollo 11');
    expect(r.text).toContain('No preset matches "apollo 11"');
  });

  it('shows and hides the flags', async () => {
    const e = engine();
    await e.reply('show country flags');
    expect(state.flags).toBe(true);
    await e.reply('hide the flags');
    expect(state.flags).toBe(false);
  });

  it('starts the mission window at the real time like the "Now" button, and at the simulated time otherwise', async () => {
    const e = engine();
    let from = lastSeq();
    await e.reply('start the mission window now in real time');
    expect(ranSince(from).map((x) => [x.name, x.params, x.ok])).toEqual([['setMissionWindow', { startUtc: 'real-now', moveClock: true }, true]]);
    expect(state.windowStartMs).toBe(Date.UTC(2026, 10, 15, 4, 0));
    expect(state.timeMs).toBe(Date.UTC(2026, 10, 15, 4, 0));
    from = lastSeq();
    await e.reply('mission window starts now');
    expect(ranSince(from).map((x) => [x.name, x.params])).toEqual([['setMissionWindow', { startUtc: 'now' }]]);
  });
});

describe('deterministic mode: rise and set times name their instant (D-8)', () => {
  beforeEach(() => {
    installFakeApp(ALL_ACTIONS);
  });

  it('puts the label before the time and the instant after it, from the results', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    const jump = await e.reply('jump to next sunset');
    expect(jump.text).toContain("Moved the clock to the next sunset: Sun fully set 2026-03-02 08:00 UTC (the last part of the Sun's disc goes behind the terrain skyline), at azimuth 268.9°.");
    await e.reply('set time to 2026-03-01 12:00');
    const when = await e.reply('when is the next earthset?');
    expect(when.text).toContain("The next Earthset: Earth's centre sets 2026-03-01 21:00 UTC (the centre of Earth's disc goes behind the terrain skyline), azimuth 348.4°");
    const ridge = await e.reply('show me the ridge at earthset');
    expect(ridge.text).toContain("Moved the clock to the next Earthset: Earth's centre sets 2026-03-01 21:00 UTC (the centre of Earth's disc goes behind the terrain skyline).");
  });

  it('never quotes a bare "sunset HH:MM"', async () => {
    const e = engine();
    await e.reply('go to IM-2');
    for (const say of ['jump to next sunset', 'when is the next sunrise?', 'jump to previous sunrise']) {
      const r = await e.reply(say);
      expect(r.text).not.toMatch(/\b(sunset|sunrise|earthset|earthrise)(:| at| is at)? \d{4}-\d{2}-\d{2} \d{2}:\d{2}/i);
    }
  });
});

describe('deterministic mode: help follows the build', () => {
  const help = async (options: FakeAppOptions) => {
    installFakeApp(options);
    return (await engine().reply('help')).text;
  };

  it('lists the later groups only where the build has their actions', async () => {
    const full = await help(ALL_ACTIONS);
    for (const line of ['Globe drawing:', 'Site science:', 'Ice targets:', 'Walking (surface):', 'Surface view:', 'Catalogue:', 'Saved comparisons:']) expect(full).toContain(line);
    const old = await help({});
    for (const line of ['Globe drawing:', 'Site science:', 'Walking (surface):', 'Saved comparisons:']) expect(old).not.toContain(line);
  });
});
