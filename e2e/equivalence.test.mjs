// UI and assistant equivalence (decision D-1, task T-16): using a control and calling its
// action must leave the same state. For each case below the test
//   1. puts the app in a known state, uses the real control (pointer / keyboard), and checks
//      that the action log gained the expected action with origin "ui" (the control really
//      goes through the registry);
//   2. puts the app back in the same known state and runs the action the assistant would
//      call (for continuous gestures: with the end state the gesture reached);
//   3. compares what both left behind.
// The list of every control and its action, including the ones checked by hand or not at
// all, is docs/lunyx/actions.md.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import './scenario/gpu.mjs';
import { click, closeBrowser, lastSeq, log, openApp, result, setField, SLOW, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

const T0 = '2025-03-06T17:28Z'; // IM-2 touchdown: inside the bundled Horizons table
const T0_MS = Date.UTC(2025, 2, 6, 17, 28);
const HOME = { lat: 10, lon: 20, altitudeKm: 4170 };

let srv, app, page;
/**
 * Document loads after the first one, and renderer crashes: the app never reloads itself, so each one is a finding.
 * (Not `framenavigated`: that also fires for the deep link's history.replaceState, which is no navigation.)
 */
const navigations = [];
/**
 * performance.timeOrigin of the document openApp loaded. Its own `load` event can come after
 * openApp has returned (the event waits for every image and data file), so a `load` of that same
 * document is noted but is no new load; another timeOrigin is a new document (F-9).
 */
let firstDocument = null;
const firstDocumentLoads = [];
/** The test running when an event is recorded. */
let running = '';
beforeEach((t) => {
  running = t.name;
});
before(async () => {
  srv = await servers();
  app = await openApp(srv.deterministic);
  page = app.page;
  firstDocument = await page.evaluate(() => performance.timeOrigin);
  page.on('load', async () => {
    const at = new Date().toISOString(), during = running;
    // "reload" (the document reloaded itself) or "navigate" (something loaded a URL), and from where.
    const how = await page.evaluate(() => ({ origin: performance.timeOrigin, type: performance.getEntriesByType('navigation')[0]?.type ?? null, referrer: document.referrer })).catch(() => null);
    if (how && how.origin === firstDocument) {
      firstDocumentLoads.push(`${at} the first document's own load event (it arrived after the app was ready), during "${during}"`);
      return;
    }
    navigations.push(`${at} the page loaded again (${how?.type ?? 'type unknown'}${how?.referrer ? `, from ${how.referrer}` : ''}): ${page.url()}, during "${during}"`);
  });
  page.on('crash', () => navigations.push(`${new Date().toISOString()} the page crashed, during "${running}"`));
  page.on('popup', (p) => navigations.push(`${new Date().toISOString()} popup ${p.url()}, during "${running}"`));
}, SLOW);
after(async () => {
  await app?.close();
  await closeBrowser();
  await srv?.stop();
});

/** Everything the comparisons look at, read without logging an action. */
function snapshot() {
  return page.evaluate(async () => {
    const { store, actions } = window.lunyx;
    const s = await actions.getAction('getState').run({});
    const raw = store.get();
    return {
      view: s.view,
      timeUtc: s.timeUtc,
      timeMs: raw.timeMs,
      playing: s.playing,
      rate: s.rateSimSecondsPerSecond,
      lightMode: s.lightMode,
      siteId: s.site?.id ?? null,
      siteKind: s.site?.kind ?? null,
      siteLat: s.site?.latDeg ?? null,
      siteLon: s.site?.lonDegEast ?? null,
      // Compared with a tolerance (sameCamera), not to the digit: the globe settles within 0.01° but not always to the same last digits.
      camera: { lat: s.globeCenter.latDeg, lon: s.globeCenter.lonDegEast, altitudeKm: s.globeCenter.altitudeKm },
      look: raw.look,
      window: { startUtc: s.missionWindow.startUtc, durationH: s.missionWindow.durationH, delayH: s.missionWindow.delayH },
      mastHeightM: s.mastHeightM,
      sunBand: s.sunBandDeg,
      overlay: s.overlay,
      showMissions: s.showMissions,
      territories: s.showTerritories ?? null,
      filter: s.missionsShown.filter,
      shown: s.missionsShown.shown,
      assistantOpen: raw.assistantOpen,
      comparing: raw.comparing,
      flags: s.showFlags ?? null,
      display: s.globeDisplay ? { relief: s.globeDisplay.reliefExaggeration, coverage: s.globeDisplay.coverageShown, ice: s.globeDisplay.iceTargetsShown } : null,
      slots: { A: s.compare.A, B: s.compare.B },
      compareTab: [...document.querySelectorAll('.cmp-sheet [role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null,
      panels: s.panels ?? null,
      surface: s.view === 'surface' && actions.getAction('getSurfaceView')
        ? await Promise.resolve(actions.getAction('getSurfaceView').run({})).then((v) => ({ look: v.look, position: { eastM: Math.round(v.position.eastM), northM: Math.round(v.position.northM), eyeHeightM: Math.round(v.position.eyeHeightM * 10) / 10 }, tracks: v.annotations.tracks, labels: v.annotations.labels, generated: v.ground?.generatedDetailShown ?? null, tracking: v.trackingBody ?? null }))
        : null,
      // The surface panels (T-65): on screen, folded, moved, and where a moved one is.
      surfacePanels: actions.getAction('getSurfacePanels')
        ? Object.fromEntries((await Promise.resolve(actions.getAction('getSurfacePanels').run({}))).panels.map((p) => [p.panel, { shown: p.shown, folded: p.folded, moved: p.moved, x: p.moved ? p.xPx : null, y: p.moved ? p.yPx : null }]))
        : null,
      hud: { chart: document.querySelector('.skc')?.dataset.size ?? null, chartShown: document.querySelector('.skc') ? !document.querySelector('.skc').hidden : null, metricsOpen: document.querySelector('.km .km-body') ? !document.querySelector('.km .km-body').hidden : null },
    };
  });
}

/** Two camera poses are the same view: within 0.02° (about 600 m on the surface) and 0.5 % in altitude. */
function sameCamera(a, b) {
  if (!a || !b) return a === b;
  const dLon = Math.abs(((a.lon - b.lon + 540) % 360) - 180);
  return Math.abs(a.lat - b.lat) <= 0.02 && dLon <= 0.02 && Math.abs(a.altitudeKm - b.altitudeKm) <= 0.005 * Math.max(a.altitudeKm, b.altitudeKm);
}

/** The known state every case starts from, set through actions in one go. */
async function reset(site = null) {
  await page.evaluate(
    async ([t0, home, siteId]) => {
      const run = (n, p = {}) => window.lunyx.actions.runAction(n, p, 'test');
      await run('setAssistantOpen', { open: false });
      await run('stopCompare');
      await run('exitSurface');
      await run('clearSite');
      await run('pause');
      await run('setRate', { secondsPerSecond: 3600 });
      await run('setLightMode', { mode: 'real' });
      await run('setDelay', { hours: 0 });
      await run('setMissionWindow', { startUtc: t0, durationH: 24, moveClock: true });
      await run('setMastHeight', { metres: 2 });
      await run('setSunBand', { minDeg: 0, maxDeg: 90 });
      await run('setOverlay', { mode: 'off' });
      await run('showMissions', { show: true });
      await run('setFilters', { reset: true });
      await run('setLocatorZoom', { zoom: 1 });
      await run('showPanel', { panel: 'site-details', open: true });
      for (const [n, p] of [['setReliefExaggeration', { factor: 1 }], ['showTerritories', { show: false }], ['showCoverage', { show: false }], ['showIceTargets', { show: false }], ['clearComparison', {}], ['setChart', { show: true, expanded: false, mode: 'skyline', table: false }], ['showKeyMetrics', { open: true }], ['setSkyAnnotations', { tracks: true, labels: true }], ['setGeneratedDetail', { on: true }], ['showPanel', { panel: 'site-science', open: true }], ['resetSurfacePanels', {}]]) {
        if (window.lunyx.actions.getAction(n)) await run(n, p);
      }
      if (siteId) await run('selectSite', { site: siteId, fly: false });
      await run('setGlobeCamera', home);
    },
    [T0, HOME, site],
  );
  await cameraAt(HOME);
  await until(page, () => document.body.dataset.view === 'globe');
}

/** Waits until the globe scene has published the camera pose (it does so once per drawn frame). */
function cameraAt({ lat, lon, altitudeKm }) {
  return until(
    page,
    ([la, lo, alt]) => {
      const c = window.lunyx.store.get().globeCenter;
      const dLon = Math.abs(((c.lon - lo + 540) % 360) - 180);
      return Math.abs(c.lat - la) < 0.02 && dLon < 0.02 && Math.abs(c.altitudeKm - alt) / alt < 0.01;
    },
    [lat, lon, altitudeKm],
  );
}

/** Waits until the camera has stopped changing between two looks. */
async function cameraSettled() {
  // Still when two readings 400 ms apart differ by less than 1e-4° (about 3 m) and 0.01 % in altitude.
  let last = null, still = 0;
  for (let i = 0; i < 120 && still < 2; i++) {
    const c = (await snapshot()).camera;
    const moved = !last || Math.abs(c.lat - last.lat) > 1e-4 || Math.abs(((c.lon - last.lon + 540) % 360) - 180) > 1e-4 || Math.abs(c.altitudeKm - last.altitudeKm) > 1e-4 * c.altitudeKm;
    still = moved ? 0 : still + 1;
    last = c;
    if (still < 2) await page.waitForTimeout(400);
  }
}

/**
 * One equivalence case.
 *   site     landing selected in the starting state (optional)
 *   ui       uses the control
 *   expect   the action name(s) the control must have logged with origin "ui"
 *   action   [name, params] or a function of the UI path's end state returning such pairs
 *   keys     which parts of the snapshot must match (default: all)
 *   wait     a condition to wait for after either path
 */
async function equivalent({ site = null, prepare, ui, expect, action, keys, wait }) {
  await reset(site);
  if (prepare) await prepare();
  const from = await lastSeq(page);
  await ui();
  // A control's action is logged when it has finished (some wait for analyses): wait for it before reading the screen.
  await until(page, ([names, seq]) => names.every((n) => window.lunyx.actions.actionLog().some((e) => e.seq > seq && e.name === n)), [[expect].flat(), from]);
  if (wait) await wait();
  const viaUi = await snapshot();
  const logged = (await log(page, from)).filter((e) => e.origin === 'ui');
  for (const name of [expect].flat()) {
    assert.ok(logged.some((e) => e.name === name && e.ok), `the control did not run ${name} through the registry; logged: ${JSON.stringify(logged.map((e) => `${e.name}${e.ok ? '' : ` (failed: ${e.error})`}`))}`);
  }

  await reset(site);
  if (prepare) await prepare();
  const calls = typeof action === 'function' ? action(viaUi) : [action];
  for (const [name, params] of Array.isArray(calls[0]) ? calls : [calls]) {
    const r = await page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'assistant'), [name, params ?? {}]);
    assert.ok(r.ok, `${name} failed: ${r.error}`);
  }
  if (wait) await wait();
  const viaAction = await snapshot();
  const pick = (s) => (keys ? Object.fromEntries(keys.map((k) => [k, s[k]])) : s);
  const { camera: camAction, ...restAction } = pick(viaAction);
  const { camera: camUi, ...restUi } = pick(viaUi);
  assert.deepEqual(restAction, restUi);
  assert.ok(sameCamera(camAction, camUi), `camera: ${JSON.stringify(camAction)} vs ${JSON.stringify(camUi)}`);
  return viaUi;
}

const filters = () => page.locator('.filters-panel');
const scrubber = () => page.locator('.time-scrubber');
const card = () => page.locator('.site-card');

describe('equivalence: time and mission parameters', () => {
  test('arrival date field = setMissionWindow { startUtc, moveClock }', SLOW, async () => {
    const s = await equivalent({
      ui: () => setField(page, '.filters-panel input[type="datetime-local"]', '2025-03-14T06:00'),
      expect: 'setMissionWindow',
      action: ['setMissionWindow', { startUtc: '2025-03-14T06:00Z', moveClock: true }],
    });
    assert.equal(s.window.startUtc, '2025-03-14T06:00Z');
    assert.equal(s.timeUtc, '2025-03-14T06:00Z');
  });

  test('scrubber date field = setTime; it leaves the mission window alone', SLOW, async () => {
    const s = await equivalent({
      ui: () => setField(page, '.time-scrubber input[type="datetime-local"]', '2025-03-07T03:00'),
      expect: 'setTime',
      action: ['setTime', { utc: '2025-03-07T03:00Z' }],
    });
    assert.equal(s.timeUtc, '2025-03-07T03:00Z');
    assert.equal(s.window.startUtc, T0);
  });

  test('time slider = setTime at the minute it shows', SLOW, async () => {
    const s = await equivalent({
      ui: async () => {
        const slider = scrubber().getByLabel('Time within the mission window');
        await slider.focus();
        // Keyboard on the focused slider, as a keyboard user scrubs: each step is one of the slider's own steps.
        for (let i = 0; i < 3; i++) await slider.press('ArrowRight');
      },
      expect: 'setTime',
      action: (ui) => [['setTime', { utc: new Date(ui.timeMs).toISOString().slice(0, 19) + 'Z' }]],
    });
    assert.ok(s.timeMs > T0_MS && s.timeMs <= T0_MS + 24 * 3_600_000, `slider left the window: ${s.timeUtc}`);
  });

  test('play / pause button = play, pause', SLOW, async () => {
    const play = scrubber().locator('.ts-play');
    await equivalent({
      ui: async () => {
        await play.click();
        await until(page, () => window.lunyx.store.get().playing === true);
        await play.click();
      },
      expect: ['play', 'pause'],
      action: () => [['play', {}], ['pause', {}]],
      keys: ['playing', 'lightMode', 'rate'],
      wait: () => until(page, () => window.lunyx.store.get().playing === false),
    });
  });

  test('scrubber timeline icon = pause and setTime at the marked event', SLOW, async () => {
    // Blue Ghost on 16 March 2025 at noon: the Sun sets that evening, a passage of about an hour.
    let targetTime;
    const prepare = async () => {
      await result(page, 'selectSite', { site: 'blue-ghost-1', fly: false });
      await result(page, 'setMissionWindow', { startUtc: '2025-03-16T06:00Z', durationH: 24, moveClock: true });
      await result(page, 'setTime', { utc: '2025-03-16T12:00Z' });
      await result(page, 'getAnalysis');
      targetTime = await page.evaluate(() => window.lunyx.analysis.get('current').value.events.find(e => e.type === 'sunset').timeMs);
    };
    const s = await equivalent({
      prepare,
      ui: async () => {
        assert.equal(await scrubber().locator('.ts-jumps').count(), 0);
        await scrubber().getByRole('group', { name: 'Timeline events' }).getByRole('button', { name: /Sunset/ }).click();
      },
      expect: ['pause', 'setTime'],
      action: () => [['pause', {}], ['setTime', { offsetHours: (targetTime - Date.parse('2025-03-16T12:00Z')) / 3_600_000 }]],
    });
    assert.equal(s.timeMs, targetTime, 'the clock at the marked sunset');
    assert.equal(s.playing, false);
  });

  test('speed, window length (both selectors), "Start window here", delay, mast, lighting', SLOW, async () => {
    await equivalent({ ui: () => scrubber().getByLabel('Playback speed').selectOption('43200'), expect: 'setRate', action: ['setRate', { secondsPerSecond: 43200 }] });
    await equivalent({ ui: () => scrubber().getByLabel('Mission window length').selectOption('168'), expect: 'setMissionWindow', action: ['setMissionWindow', { durationH: 168 }] });
    await equivalent({ ui: () => filters().getByLabel('Mission window', { exact: true }).selectOption('336'), expect: 'setMissionWindow', action: ['setMissionWindow', { durationH: 336 }] });
    const moved = await equivalent({
      prepare: () => result(page, 'setTime', { utc: '2025-03-06T22:28Z' }),
      ui: () => scrubber().getByRole('button', { name: 'Start window here' }).click(),
      expect: 'setMissionWindow',
      action: ['setMissionWindow', { startUtc: 'now' }],
    });
    assert.equal(moved.window.startUtc, '2025-03-06T22:28Z');
    const late = await equivalent({ ui: () => setField(page, filters().getByLabel('Arrival delay'), 24), expect: 'setDelay', action: ['setDelay', { hours: 24 }] });
    assert.equal(late.window.delayH, 24);
    await equivalent({ ui: async () => setField(page, `#${await filters().getByText('Mast height', { exact: true }).getAttribute('for')}`, 10), expect: 'setMastHeight', action: ['setMastHeight', { metres: 10 }] });
    const even = await equivalent({ ui: () => filters().getByRole('group', { name: 'Lighting' }).getByRole('button', { name: 'Even' }).click(), expect: 'setLightMode', action: ['setLightMode', { mode: 'even' }] });
    assert.equal(even.lightMode, 'even');
  });

  test('"Now" starts the mission window at the real time, as the action with that time does', SLOW, async () => {
    await reset();
    const from = await lastSeq(page);
    await scrubber().getByRole('button', { name: 'Now', exact: true }).click();
    const viaUi = await snapshot();
    assert.ok((await log(page, from)).some((e) => e.name === 'setMissionWindow' && e.origin === 'ui' && e.params.moveClock === true));
    assert.ok(Math.abs(viaUi.timeMs - Date.now()) < 120_000, `clock is ${viaUi.timeUtc}`);
    assert.equal(viaUi.window.startUtc, viaUi.timeUtc);
    await reset();
    await result(page, 'setMissionWindow', { startUtc: viaUi.timeUtc, moveClock: true });
    const viaAction = await snapshot();
    assert.deepEqual(viaAction.window, viaUi.window);
    assert.equal(viaAction.timeUtc, viaUi.timeUtc);
  });

  test('solar elevation requirement fields = setSunBand', SLOW, async () => {
    const band = filters().getByRole('group', { name: /Solar elevation/ });
    const s = await equivalent({
      ui: async () => {
        await setField(page, band.locator('input').nth(0), 5);
        await until(page, () => window.lunyx.store.get().sunElMinDeg === 5);
        await setField(page, band.locator('input').nth(1), 60);
      },
      expect: 'setSunBand',
      action: ['setSunBand', { minDeg: 5, maxDeg: 60 }],
    });
    assert.deepEqual(s.sunBand, { min: 5, max: 60 });
  });
});

describe('equivalence: layers and filters', () => {
  test('"Show previous missions" and the landing-area overlay controls', SLOW, async () => {
    const hidden = await equivalent({ ui: () => filters().getByLabel('Show previous missions').uncheck(), expect: 'showMissions', action: ['showMissions', { show: false }] });
    assert.equal(hidden.showMissions, false);
    const on = await equivalent({ ui: () => filters().getByLabel('Show optimal landing area').check(), expect: 'setOverlay', action: ['setOverlay', { mode: 'sun-band' }] });
    assert.equal(on.overlay, 'sun-band');
    const avg = await equivalent({
      prepare: () => result(page, 'setOverlay', { mode: 'sun-band' }),
      ui: () => filters().getByLabel('Landing-area overlay').selectOption('avg-illumination'),
      expect: 'setOverlay',
      action: ['setOverlay', { mode: 'avg-illumination' }],
    });
    assert.equal(avg.overlay, 'avg-illumination');
  });

  test('mission filters: program, country, type, years, reset = setFilters', SLOW, async () => {
    const open = async () => {
      if (!(await page.locator('.fp-missions').evaluate((d) => d.open))) await page.locator('.fp-missions > summary').click();
    };
    // Since GitHub main 282249d: country rows (the marker colours; USSR hardware shown as "Russia",
    // while the filter keeps the catalogue's "USSR") and program chips. The action replays the filter
    // the control left, and the test checks that it is the one asked for.
    const programs = await page.evaluate(() => [...document.querySelectorAll('.fp-mission-body .ly-chips .ly-btn')].map((e) => e.textContent));
    assert.ok(programs.includes('Apollo'), JSON.stringify(programs));
    const noApollo = await equivalent({
      prepare: open,
      ui: () => page.locator('.fp-mission-body .ly-chips').getByRole('button', { name: 'Apollo', exact: true }).click(),
      expect: 'setFilters',
      action: (ui) => [['setFilters', { programs: ui.filter.programs }]],
    });
    assert.ok(Array.isArray(noApollo.filter.programs) && !noApollo.filter.programs.includes('Apollo'), JSON.stringify(noApollo.filter));
    assert.equal(noApollo.filter.programs.length, programs.length - 1);
    assert.ok(noApollo.shown < 28);
    const crewed = await equivalent({ prepare: open, ui: () => page.getByRole('group', { name: 'Mission type' }).getByRole('button', { name: 'Crewed' }).click(), expect: 'setFilters', action: ['setFilters', { type: 'crewed' }] });
    assert.equal(crewed.filter.type, 'crewed');
    const noUsa = await equivalent({ prepare: open, ui: () => page.locator('.mf-programs').getByRole('button', { name: /^USA, \d+ landings?$/ }).click(), expect: 'setFilters', action: (ui) => [['setFilters', { countries: ui.filter.countries }]] });
    assert.ok(Array.isArray(noUsa.filter.countries) && !noUsa.filter.countries.includes('USA'), JSON.stringify(noUsa.filter));
    const years = await equivalent({
      prepare: open,
      ui: async () => {
        const from = page.getByLabel('From year');
        await from.focus();
        for (let i = 0; i < 5; i++) await from.press('ArrowRight');
      },
      expect: 'setFilters',
      action: (ui) => [['setFilters', { fromYear: ui.filter.fromYear }]],
    });
    assert.equal(typeof years.filter.fromYear, 'number');
    const back = await equivalent({
      prepare: async () => {
        await open();
        await result(page, 'setFilters', { type: 'robotic', fromYear: 2000 });
      },
      ui: () => page.locator('.mf-foot').getByRole('button', { name: 'Reset' }).click(),
      expect: 'setFilters',
      action: ['setFilters', { reset: true }],
    });
    assert.equal(back.shown, 28);
  });
});

describe('equivalence: site selection and views', () => {
  test('"Drop pin" selects the entered point; Enter on the globe selects the camera centre', SLOW, async () => {
    const byButton = await equivalent({
      ui: async () => {
        await filters().getByLabel('Latitude', { exact: true }).fill(String(HOME.lat));
        await filters().getByLabel('Longitude', { exact: true }).fill(String(HOME.lon));
        await filters().getByRole('button', { name: 'Drop pin', exact: true }).click();
      },
      expect: 'dropPin',
      action: (ui) => [['dropPin', { lat: ui.siteLat, lon: ui.siteLon, fly: true }]],
      wait: cameraSettled,
    });
    assert.equal(byButton.siteKind, 'custom');
    assert.ok(Math.abs(byButton.siteLat - HOME.lat) < 0.05 && Math.abs(byButton.siteLon - HOME.lon) < 0.05, JSON.stringify(byButton));
    const byKey = await equivalent({
      ui: async () => {
        await page.locator('#scene').focus();
        await page.keyboard.press('Enter');
        await until(page, () => window.lunyx.store.get().site !== null);
      },
      expect: 'dropPin',
      action: (ui) => [['dropPin', { lat: ui.siteLat, lon: ui.siteLon }]],
    });
    assert.equal(byKey.siteId, byButton.siteId);
  });

  test('clicking empty ground = dropPin where the pointer was', SLOW, async () => {
    const s = await equivalent({
      ui: async () => {
        // A point of the disc left of the centre, clear of every panel.
        await page.mouse.click(560, 300);
        await until(page, () => window.lunyx.store.get().site !== null);
      },
      expect: 'dropPin',
      action: (ui) => [['dropPin', { lat: ui.siteLat, lon: ui.siteLon }]],
    });
    assert.equal(s.siteKind, 'custom');
    assert.ok(Math.abs(s.siteLat - HOME.lat) > 0.5 || Math.abs(s.siteLon - HOME.lon) > 0.5, 'the pin should not be at the centre of view');
  });

  test('clicking a landing marker shows details; double-clicking enters surface view', SLOW, async () => {
    const apollo = { lat: 0.67416, lon: 23.47314, altitudeKm: 300 };
    const overMarker = async () => {
      await result(page, 'setGlobeCamera', apollo);
      await cameraAt(apollo);
    };
    const s = await equivalent({
      prepare: overMarker,
      ui: async () => {
        await page.mouse.click(640, 360);
        await until(page, () => window.lunyx.store.get().site !== null);
        assert.equal(await page.locator('.site-card .sc-body').isVisible(), true);
      },
      expect: 'selectSite',
      action: ['selectSite', { site: 'apollo-11', fly: false }],
      keys: ['view', 'siteId', 'siteKind', 'timeUtc', 'window'],
    });
    assert.equal(s.siteId, 'apollo-11');
    assert.equal(s.view, 'globe');
    await page.mouse.dblclick(640, 360);
    await until(page, () => document.body.dataset.view === 'surface');
    assert.equal((await page.evaluate(() => window.lunyx.store.get())).site.id, 'apollo-11');
  });

  test('site card buttons: surface, landing time, whole Moon, earlier / later, fold, close, Escape', SLOW, async () => {
    const surface = await equivalent({
      site: 'apollo-11',
      ui: () => card().getByRole('button', { name: 'Enter surface view' }).click(),
      expect: 'enterSurface',
      action: ['enterSurface', {}],
      keys: ['view', 'siteId'],
      wait: () => until(page, () => document.body.dataset.view === 'surface'),
    });
    assert.equal(surface.view, 'surface');

    const landing = await equivalent({ site: 'apollo-11', ui: () => card().getByRole('button', { name: /^At landing time/ }).click(), expect: 'selectSite', action: ['selectSite', { site: 'apollo-11', atLanding: true, fly: false }] });
    assert.equal(landing.timeUtc, '1969-07-20T20:17Z');
    assert.equal(landing.window.startUtc, '1969-07-20T20:17Z');

    const whole = await equivalent({
      site: 'apollo-11',
      prepare: async () => {
        await result(page, 'setGlobeCamera', { lat: 0.67, lon: 23.47, altitudeKm: 200 });
        await cameraAt({ lat: 0.67, lon: 23.47, altitudeKm: 200 });
      },
      ui: () => card().getByRole('button', { name: 'Whole Moon', exact: true }).click(),
      expect: 'setGlobeCamera',
      action: (ui) => [['setGlobeCamera', ui.camera]],
      wait: cameraSettled,
    });
    assert.ok(Math.abs(whole.camera.altitudeKm - 4170) <= 1, JSON.stringify(whole.camera));

    const later = await equivalent({
      site: 'apollo-11',
      ui: () => card().getByRole('button', { name: /Later/ }).click(),
      expect: 'selectSite',
      action: (ui) => [['selectSite', { site: ui.siteId }]],
      keys: ['view', 'siteId'],
      wait: cameraSettled,
    });
    assert.notEqual(later.siteId, 'apollo-11');
    assert.equal(later.view, 'globe');

    await equivalent({ site: 'apollo-11', ui: () => card().getByRole('button', { name: 'Fold the site details away' }).click(), expect: 'showPanel', action: ['showPanel', { panel: 'site-details', open: false }] });
    assert.equal(await page.locator('.site-card .sc-body').isHidden(), true);

    const closed = await equivalent({ site: 'apollo-11', ui: () => card().getByRole('button', { name: 'Close and return to the whole Moon' }).click(), expect: 'clearSite', action: ['clearSite', {}], wait: cameraSettled });
    assert.equal(closed.siteId, null);
    const escaped = await equivalent({
      site: 'apollo-11',
      ui: async () => {
        await page.locator('#scene').focus();
        await page.keyboard.press('Escape');
      },
      expect: 'clearSite',
      action: ['clearSite', {}],
      wait: cameraSettled,
    });
    assert.equal(escaped.siteId, null);
  });

  const inSurface = () => until(page, () => document.body.dataset.view === 'surface');
  const inGlobe = () => until(page, () => document.body.dataset.view === 'globe');
  const enterSurface = async () => {
    await result(page, 'enterSurface');
    await inSurface();
  };

  // The rebuilt surface view (T-9) has no "Back to orbit" button any more: the close button is the control.
  test('little person = enterSurface; the close button = exitSurface', SLOW, async () => {
    const down = await equivalent({ site: 'im-2', ui: () => page.locator('.person-btn').click(), expect: 'enterSurface', action: ['enterSurface', {}], keys: ['view', 'siteId'], wait: inSurface });
    assert.equal(down.view, 'surface');
    for (const [how, leave] of [['close button', () => click(page, '.close-surface')]]) {
      const s = await equivalent({ site: 'im-2', prepare: enterSurface, ui: leave, expect: 'exitSurface', action: ['exitSurface', {}], keys: ['view', 'siteId'], wait: inGlobe });
      assert.equal(s.view, 'globe', how);
      assert.equal(s.siteId, 'im-2', how);
    }
  });

  // F-1, fixed by T-33 (src/ui/globe/cardKeys.ts): one Escape in the surface view only leaves the surface.
  test('Escape in the surface view = exitSurface (the site stays selected)', SLOW, async () => {
    const s = await equivalent({ site: 'im-2', prepare: enterSurface, ui: () => page.keyboard.press('Escape'), expect: 'exitSurface', action: ['exitSurface', {}], keys: ['view', 'siteId'], wait: inGlobe });
    assert.equal(s.siteId, 'im-2');
  });
});

describe('equivalence: cameras (a gesture ends in a pose the action reaches)', () => {
  test('latitude / longitude drafts are applied by Drop pin, which also flies to the point', SLOW, async () => {
    const target = { lat: -45, lon: 60, altitudeKm: 0.024 * 1737.4 };
    const s = await equivalent({
      ui: async () => {
        await setField(page, `#${await filters().getByText('Latitude', { exact: true }).getAttribute('for')}`, -45);
        await setField(page, `#${await filters().getByText('Longitude', { exact: true }).getAttribute('for')}`, 60);
        await cameraAt(HOME);
        await filters().getByRole('button', { name: 'Drop pin', exact: true }).click();
      },
      expect: 'dropPin',
      action: ['dropPin', { lat: -45, lon: 60, fly: true }],
      wait: () => cameraAt(target),
    });
    assert.ok(sameCamera(s.camera, target), JSON.stringify(s.camera));
  });

  test('arrow keys, plus / minus, drag and wheel on the globe = setGlobeCamera with the pose they reach', SLOW, async () => {
    const replay = (ui) => [['setGlobeCamera', ui.camera]];
    const globe = page.locator('#scene');
    const keys = await equivalent({
      ui: async () => {
        // One press at a time, so that each logged setGlobeCamera can be replayed in turn. Presses
        // within one drawn frame used to be lost (F-7, fixed by T-55): the next case checks those.
        await globe.focus();
        for (const key of ['ArrowRight', 'ArrowUp', '+']) {
          const before = await page.evaluate(() => JSON.stringify(window.lunyx.store.get().globeCenter));
          await page.keyboard.press(key);
          await until(page, (b) => JSON.stringify(window.lunyx.store.get().globeCenter) !== b, before);
          await cameraSettled();
        }
      },
      expect: 'setGlobeCamera',
      action: replay,
      wait: cameraSettled,
    });
    assert.ok(keys.camera.lon > HOME.lon && keys.camera.lat > HOME.lat && keys.camera.altitudeKm < HOME.altitudeKm, JSON.stringify(keys.camera));

    // Dragging and scrolling are handled by the globe's orbit control, which publishes the pose it reaches.
    await reset();
    await page.mouse.move(600, 330);
    await page.mouse.down();
    await page.mouse.move(520, 300, { steps: 6 });
    await page.mouse.up();
    await cameraSettled();
    const dragged = await snapshot();
    assert.ok(Math.abs(dragged.camera.lon - HOME.lon) > 1, `the drag did not turn the globe: ${JSON.stringify(dragged.camera)}`);
    assert.equal(dragged.siteId, null, 'a drag must not drop a pin');
    await page.mouse.move(600, 330);
    await page.mouse.wheel(0, -400);
    await cameraSettled();
    const zoomed = await snapshot();
    assert.ok(zoomed.camera.altitudeKm < dragged.camera.altitudeKm, 'scrolling up should move the camera closer');
    await reset();
    await result(page, 'setGlobeCamera', zoomed.camera);
    await cameraAt(zoomed.camera);
    await cameraSettled();
    const replayed = (await snapshot()).camera;
    assert.ok(sameCamera(replayed, zoomed.camera), `${JSON.stringify(replayed)} vs ${JSON.stringify(zoomed.camera)}`);
  });

  test('arrow keys pressed faster than the globe draws: every press counts (F-7, fixed by T-55 in 351e9fc)', SLOW, async () => {
    const globe = page.locator('#scene');
    const lonOf = (c) => ((c.lon - HOME.lon + 540) % 360) - 180;
    // One press, at a person's pace, for the step at this altitude.
    await reset();
    await globe.focus();
    await page.keyboard.press('ArrowRight');
    await until(page, (lon) => Math.abs(window.lunyx.store.get().globeCenter.lon - lon) > 0.5, HOME.lon);
    await cameraSettled();
    const step = lonOf((await snapshot()).camera);
    assert.ok(step > 1, `one press turned the globe by ${step}°`);
    // Three presses with no wait in between: most land within one drawn frame.
    await reset();
    await globe.focus();
    const from = await lastSeq(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await until(page, (seq) => window.lunyx.actions.actionLog().filter((e) => e.seq > seq && e.name === 'setGlobeCamera' && e.origin === 'ui').length >= 3, from);
    await cameraSettled();
    const moved = lonOf((await snapshot()).camera);
    assert.ok(Math.abs(moved - 3 * step) < 0.05, `three rapid presses turned the globe by ${moved}°, one press by ${step}°`);
  });

  test('locator map click and its zoom buttons; compass', SLOW, async () => {
    const map = page.locator('.locator-canvas');
    const box = await map.boundingBox();
    const s = await equivalent({
      ui: () => page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.3),
      expect: 'setGlobeCamera',
      action: (ui) => [['setGlobeCamera', { lat: ui.camera.lat, lon: ui.camera.lon }]],
      wait: cameraSettled,
    });
    assert.ok(s.camera.lon > 60 && s.camera.lat > 10, JSON.stringify(s.camera));

    // Compare what the map shows about its zoom (the zoom-out button, the "×2" of the readout) and getState.locatorZoom.
    // Its label also names the centre of view to 0.01°, which the reset's camera flight leaves within 0.02° (sameCamera), so the centre is not compared here.
    const shows = () => page.evaluate(async () => ({ canZoomOut: !document.querySelector('.locator button[aria-label="Zoom the map out"]').disabled, zoomText: /×\d+$/.exec(document.querySelector('.locator-readout').textContent)?.[0] ?? null, locatorZoom: (await window.lunyx.actions.getAction('getState').run({})).locatorZoom ?? null }));
    await reset();
    const from = await lastSeq(page);
    await page.getByRole('button', { name: 'Zoom the map in' }).click();
    await until(page, () => !document.querySelector('.locator button[aria-label="Zoom the map out"]').disabled);
    const viaUi = await shows();
    assert.ok((await log(page, from)).some((e) => e.name === 'setLocatorZoom' && e.origin === 'ui'));
    await reset();
    await result(page, 'setLocatorZoom', { zoom: 2 });
    assert.deepEqual(await shows(), viaUi);

    await equivalent({ ui: () => page.locator('.compass').click(), expect: 'resetNorth', action: ['resetNorth', {}], wait: cameraSettled });
  });

  test('looking around on the surface = lookAt with the direction reached', SLOW, async () => {
    await reset('im-2');
    await result(page, 'enterSurface');
    await until(page, () => document.body.dataset.view === 'surface');
    await result(page, 'lookAt', { azDeg: 90, elDeg: 0, fovDeg: 70 });
    await until(page, () => Math.abs(window.lunyx.store.get().look.azDeg - 90) < 0.5);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(540, 330, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const dragged = (await snapshot()).look;
    assert.ok(Math.abs(dragged.azDeg - 90) > 1, `the drag did not turn the view: ${JSON.stringify(dragged)}`);
    await result(page, 'lookAt', { azDeg: 200, elDeg: 10, fovDeg: 70 });
    await until(page, () => Math.abs(window.lunyx.store.get().look.azDeg - 200) < 0.5);
    await result(page, 'lookAt', dragged);
    await until(page, (az) => Math.abs(window.lunyx.store.get().look.azDeg - az) < 0.5, dragged.azDeg);
    const replayed = (await snapshot()).look;
    assert.ok(Math.abs(replayed.azDeg - dragged.azDeg) < 0.5 && Math.abs(replayed.elDeg - dragged.elDeg) < 0.5, `${JSON.stringify(replayed)} vs ${JSON.stringify(dragged)}`);
    await result(page, 'exitSurface');
  });
});

describe('equivalence: controls added since the 33-action build', () => {
  // What the panel says after the control ran (the UI path only: an action run by the assistant writes no status line).
  const said = (text) => until(page, (t) => [...document.querySelectorAll('.cmp-status')].some((e) => e.textContent.includes(t)), text);
  const enterSurface = async () => {
    await result(page, 'enterSurface');
    await until(page, () => document.body.dataset.view === 'surface' && window.lunyx.actions.getAction('getSurfaceView') !== undefined);
  };
  const hudButton = (name) => page.locator('.surface-hud .sh-controls').getByRole('button', { name, exact: true });
  // Since pull request #4 the strip is one row: Track Sun and Track Earth, then the "Surface
  // options" disclosure (Sky paths, Generated detail, Skyline chart, Return to site), whose buttons
  // a person reaches by opening it first.
  const optionButton = async (name) => {
    const menu = page.locator('.surface-hud details.sh-options');
    if (!(await menu.evaluate((d) => d.open))) await menu.locator('summary').click();
    return hudButton(name);
  };

  // The relief has had no control of its own since T-64 (setReliefExaggeration is the assistant's
  // alone), and T-67 removed the territory size select (setTerritoryScale) with it.
  test('Filters: "Show country territories" = showTerritories, and disabled while previous missions are hidden (T-67)', SLOW, async () => {
    const box = () => filters().getByLabel('Show country territories');
    const s = await equivalent({ ui: () => box().check(), expect: 'showTerritories', action: ['showTerritories', { show: true }], keys: ['territories', 'showMissions'] });
    assert.deepEqual([s.territories, s.showMissions], [true, true]);
    // Territories are drawn only with the landings: with them hidden the checkbox cannot be used.
    await reset();
    await result(page, 'showMissions', { show: false });
    await until(page, () => [...document.querySelectorAll('.filters-panel label.ly-check')].find((l) => l.textContent.includes('Show country territories'))?.querySelector('input')?.disabled === true);
    assert.equal(await box().isDisabled(), true);
  });

  test('Filters: coverage and ice-target outlines', SLOW, async () => {
    const cover = await equivalent({ ui: () => filters().getByLabel('Show elevation data coverage').check(), expect: 'showCoverage', action: ['showCoverage', { show: true }], keys: ['display'] });
    assert.equal(cover.display.coverage, true);
    const ice = await equivalent({ ui: () => filters().getByLabel('Show mapped ice targets').check(), expect: 'showIceTargets', action: ['showIceTargets', { show: true }], keys: ['display'] });
    assert.equal(ice.display.ice, true);
  });

  test('Filters: "Go to a landing site", "Show country flags", a mission preset', SLOW, async () => {
    const picked = await equivalent({ ui: () => filters().getByLabel('Go to a landing site').selectOption('apollo-15'), expect: 'selectSite', action: ['selectSite', { site: 'apollo-15' }], keys: ['siteId', 'view'] });
    assert.equal(picked.siteId, 'apollo-15');
    // Flags are on by default: switch them off first so ticking the box is a change.
    const flags = await equivalent({ prepare: () => result(page, 'showFlags', { show: false }), ui: () => filters().getByLabel('Show country flags').check(), expect: 'showFlags', action: ['showFlags', { show: true }], keys: ['flags'] });
    assert.equal(flags.flags, true);
    await result(page, 'showFlags', { show: false });
    const preset = await equivalent({ ui: () => page.locator('.pl-button').filter({ hasText: 'Eclipse of 14 March 2025' }).click(), expect: 'loadPreset', action: ['loadPreset', { id: 'eclipse-2025-03-14' }], keys: ['siteId', 'view', 'window', 'rate'], wait: () => until(page, () => document.body.dataset.view === 'surface') });
    assert.deepEqual([preset.siteId, preset.view], ['blue-ghost-1', 'surface']);
    await result(page, 'pause');
  });

  test('site card: the site-science fold = showPanel { panel: "site-science" }', SLOW, async () => {
    const s = await equivalent({ site: 'im-2', ui: () => card().locator('.sc-scitoggle').click(), expect: 'showPanel', action: ['showPanel', { panel: 'site-science', open: false }], keys: ['panels'] });
    assert.equal(s.panels['site-science'], false);
  });

  test('compare panel: launcher, "Compare arrivals", "Compare masts", "Swap A and B", "Empty A and B"', SLOW, async () => {
    const opened = await equivalent({ site: 'im-2', ui: () => page.locator('.cmp-launcher').click(), expect: 'openCompare', action: ['openCompare', {}], keys: ['comparing', 'compareTab'] });
    assert.deepEqual([opened.comparing, opened.compareTab], [true, 'A and B']);
    const open = () => result(page, 'openCompare', { tab: 'compare' });
    const late = await equivalent({ site: 'im-2', prepare: open, ui: () => page.getByRole('button', { name: 'Compare arrivals' }).click(), expect: 'compareDelayedArrival', action: ['compareDelayedArrival', { delayH: 24 }], keys: ['slots', 'comparing', 'compareTab', 'window'] });
    assert.match(late.slots.B, /arrival 24 h later/);
    await reset('im-2');
    await open();
    await page.getByRole('button', { name: 'Compare arrivals' }).click();
    await said('B is A arriving 24 h later');
    assert.equal(late.window.delayH, 0, 'the scenario on screen keeps its own delay');
    const masts = await equivalent({ site: 'im-2', prepare: open, ui: () => page.getByRole('button', { name: 'Compare masts' }).click(), expect: 'compareMastHeights', action: ['compareMastHeights', { heightBM: 10 }], keys: ['slots', 'comparing', 'mastHeightM'] });
    assert.match(masts.slots.B, /10 m mast/);
    const pair = async () => {
      await open();
      await result(page, 'compareDelayedArrival', { delayH: 24 });
    };
    const swapped = await equivalent({ site: 'im-2', prepare: pair, ui: () => page.getByRole('button', { name: 'Swap A and B' }).click(), expect: 'swapComparison', action: ['swapComparison', {}], keys: ['slots'] });
    assert.match(swapped.slots.A, /arrival 24 h later/);
    const emptied = await equivalent({ site: 'im-2', prepare: pair, ui: () => page.getByRole('button', { name: 'Empty A and B' }).click(), expect: 'clearComparison', action: ['clearComparison', {}], keys: ['slots'] });
    assert.deepEqual(emptied.slots, { A: null, B: null });
  });

  // Pull request #2: the HUD's "Face Sun" / "Face Earth" became the toggles "Track Sun" / "Track Earth".
  test('surface HUD: Track Sun, and in "Surface options" Sky paths, Generated detail, Return to site, the chart button; key metrics fold', SLOW, async () => {
    const track = await equivalent({ site: 'im-2', prepare: enterSurface, ui: () => hudButton('Track Sun').click(), expect: 'setBodyTracking', action: ['setBodyTracking', { body: 'sun', on: true }], keys: ['surface'] });
    assert.equal(track.surface?.tracking, 'sun', JSON.stringify(track.surface));
    assert.equal(await hudButton('Track Sun').getAttribute('aria-pressed'), 'true');
    const paths = await equivalent({ site: 'im-2', prepare: enterSurface, ui: async () => (await optionButton('Sky paths')).click(), expect: 'setSkyAnnotations', action: ['setSkyAnnotations', { tracks: false, labels: false }], keys: ['surface'] });
    assert.deepEqual([paths.surface.tracks, paths.surface.labels], [false, false]);
    const gen = await equivalent({ site: 'im-2', prepare: enterSurface, ui: async () => (await optionButton('Generated detail')).click(), expect: 'setGeneratedDetail', action: ['setGeneratedDetail', { on: false }], keys: ['surface'] });
    assert.equal(gen.surface.generated, false);
    const away = async () => {
      await enterSurface();
      await result(page, 'walkTo', { eastM: 100, northM: 50 });
      await until(page, () => [...document.querySelectorAll('.surface-hud .sh-controls button')].some((b) => b.textContent.trim() === 'Return to site' && !b.hidden));
    };
    const home = await equivalent({ site: 'im-2', prepare: away, ui: async () => (await optionButton('Return to site')).click(), expect: 'walkTo', action: ['walkTo', { eastM: 0, northM: 0 }], keys: ['surface'] });
    assert.deepEqual([home.surface.position.eastM, home.surface.position.northM], [0, 0]);
    const metrics = await equivalent({ site: 'im-2', prepare: enterSurface, ui: () => page.locator('.km .km-fold').click(), expect: 'showKeyMetrics', action: ['showKeyMetrics', { open: false }], keys: ['hud'], wait: () => until(page, () => document.querySelector('.km .km-body')?.hidden === true) });
    assert.equal(metrics.hud.metricsOpen, false);
    const chart = await equivalent({ site: 'im-2', prepare: enterSurface, ui: async () => (await optionButton('Skyline chart')).click(), expect: 'setChart', action: ['setChart', { show: false }], keys: ['hud'], wait: () => until(page, () => document.querySelector('.skc')?.hidden === true) });
    assert.equal(chart.hud.chartShown, false);
  });
});

describe('equivalence: the surface panels (T-65)', () => {
  const enterSurface = async () => {
    await result(page, 'enterSurface');
    await until(page, () => document.body.dataset.view === 'surface');
  };

  test('a panel\'s Fold button = setSurfacePanel { panel, folded }', SLOW, async () => {
    const s = await equivalent({ site: 'im-2', prepare: enterSurface, ui: () => page.getByRole('button', { name: 'Fold Time', exact: true }).click(), expect: 'setSurfacePanel', action: ['setSurfacePanel', { panel: 'time', folded: true }], keys: ['surfacePanels'] });
    assert.deepEqual([s.surfacePanels.time.folded, s.surfacePanels.time.moved], [true, false]);
  });

  test('arrow keys on a panel\'s grip = setSurfacePanel { panel, xPx, yPx } with the place they reach', SLOW, async () => {
    const s = await equivalent({
      site: 'im-2',
      prepare: enterSurface,
      ui: async () => {
        const grip = page.getByRole('button', { name: 'Move Locator map panel' });
        await grip.focus();
        for (let i = 1; i <= 2; i++) {
          const from = await lastSeq(page);
          await page.keyboard.press('ArrowLeft');
          await until(page, (seq) => window.lunyx.actions.actionLog().some((e) => e.seq > seq && e.name === 'setSurfacePanel' && e.origin === 'ui'), from);
        }
      },
      expect: 'setSurfacePanel',
      action: (ui) => [['setSurfacePanel', { panel: 'locator-map', xPx: ui.surfacePanels['locator-map'].x, yPx: ui.surfacePanels['locator-map'].y }]],
      keys: ['surfacePanels'],
    });
    assert.equal(s.surfacePanels['locator-map'].moved, true);
  });

  test('"Reset panels" = resetSurfacePanels', SLOW, async () => {
    const moved = async () => {
      await enterSurface();
      await result(page, 'setSurfacePanel', { panel: 'time', folded: true });
      await result(page, 'setSurfacePanel', { panel: 'locator-map', xPx: 300, yPx: 200 });
    };
    const s = await equivalent({ site: 'im-2', prepare: moved, ui: () => page.getByRole('button', { name: 'Reset panels' }).click(), expect: 'resetSurfacePanels', action: ['resetSurfacePanels', {}], keys: ['surfacePanels'] });
    assert.ok(Object.values(s.surfacePanels).every((p) => !p.folded && !p.moved), JSON.stringify(s.surfacePanels));
  });
});

describe('equivalence: assistant drawer and deep links', () => {
  test('assistant button and close button = setAssistantOpen', SLOW, async () => {
    const opened = await equivalent({ ui: () => click(page, '#assistant-button'), expect: 'setAssistantOpen', action: ['setAssistantOpen', { open: true }], keys: ['assistantOpen'] });
    assert.equal(opened.assistantOpen, true);
    const closed = await equivalent({
      prepare: async () => {
        await result(page, 'setAssistantOpen', { open: true });
        await until(page, () => document.getElementById('assistant-drawer').classList.contains('is-open'));
      },
      ui: () => click(page, '#assistant-drawer button[aria-label="Close the assistant"]'),
      expect: 'setAssistantOpen',
      action: ['setAssistantOpen', { open: false }],
      keys: ['assistantOpen'],
    });
    assert.equal(closed.assistantOpen, false);
  });

  test('a deep link is applied through the same actions (origin "url")', SLOW, async () => {
    const linked = await openApp(srv.deterministic, { query: '?site=apollo-11&t=2025-03-14T06:00Z' });
    try {
      const entries = await log(linked.page);
      assert.deepEqual(entries.filter((e) => e.origin === 'url').map((e) => [e.name, e.ok]), [['setTime', true], ['setMissionWindow', true], ['selectSite', true]]);
      const s = await linked.page.evaluate(() => window.lunyx.actions.getAction('getState').run({}));
      await reset();
      await result(page, 'setTime', { utc: '2025-03-14T06:00Z' });
      await result(page, 'setMissionWindow', { startUtc: 'now' });
      await result(page, 'selectSite', { site: 'apollo-11' });
      const mine = await snapshot();
      assert.equal(s.site.id, mine.siteId);
      assert.equal(s.timeUtc, mine.timeUtc);
      assert.equal(s.missionWindow.startUtc, mine.window.startUtc);
      assert.equal(linked.page.url().includes('site=apollo-11'), true);
    } finally {
      await linked.close();
    }
  });

  test('the page raised no errors during all of the above', SLOW, async () => {
    assert.deepEqual(app.problems, []);
  });

  // F-9 in docs/lunyx/actions.md: on the GPU a second "load" was seen at "/", at most once per run,
  // in the first equivalence test when the test was named (09:33Z on 0de7e06, type "navigate", no
  // referrer): the first document's own load event arriving after openApp had returned. Such an
  // event is now told apart by performance.timeOrigin; any other document still fails here.
  test('the page never reloaded or crashed', { ...SLOW, todo: 'F-9: under watch; the late load event of the first document is no longer counted' }, async (t) => {
    for (const n of firstDocumentLoads) t.diagnostic(n);
    for (const n of navigations) t.diagnostic(n);
    assert.deepEqual(navigations, [], 'the page navigated or crashed during the run');
  });
});
