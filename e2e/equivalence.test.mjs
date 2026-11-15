// DRAFT (checkpoint 2026-11-15): two camera cases fail and the controls added since 4f007f1 have no case yet; see docs/lunyx/handover/T-16-T-17-checkpoint.md
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
import { after, before, describe, test } from 'node:test';
import { click, closeBrowser, lastSeq, log, openApp, result, setField, SLOW, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

const T0 = '2025-03-06T17:28Z'; // IM-2 touchdown: inside the bundled Horizons table
const T0_MS = Date.UTC(2025, 2, 6, 17, 28);
const HOME = { lat: 10, lon: 20, altitudeKm: 4170 };

let srv, app, page;
before(async () => {
  srv = await servers();
  app = await openApp(srv.deterministic);
  page = app.page;
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
      camera: { lat: Math.round(s.globeCenter.latDeg * 50) / 50, lon: Math.round(s.globeCenter.lonDegEast * 50) / 50, altitudeKm: Math.round(s.globeCenter.altitudeKm) },
      look: raw.look,
      window: { startUtc: s.missionWindow.startUtc, durationH: s.missionWindow.durationH, delayH: s.missionWindow.delayH },
      mastHeightM: s.mastHeightM,
      sunBand: s.sunBandDeg,
      overlay: s.overlay,
      showMissions: s.showMissions,
      filter: s.missionsShown.filter,
      shown: s.missionsShown.shown,
      assistantOpen: raw.assistantOpen,
      comparing: raw.comparing,
    };
  });
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
  let last = '';
  for (let i = 0; i < 80; i++) {
    const now = JSON.stringify((await snapshot()).camera);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(400);
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
  assert.deepEqual(pick(viaAction), pick(viaUi));
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
    const programs = await page.evaluate(() => [...document.querySelectorAll('.mf-programs .mf-label')].map((e) => e.textContent));
    assert.ok(programs.includes('Apollo'));
    const noApollo = await equivalent({
      prepare: open,
      ui: () => page.getByRole('button', { name: /^Apollo, \d+ landings$/ }).click(),
      expect: 'setFilters',
      action: ['setFilters', { programs: programs.filter((p) => p !== 'Apollo') }],
    });
    assert.ok(!noApollo.filter.programs.includes('Apollo'));
    assert.ok(noApollo.shown < 28);
    const crewed = await equivalent({ prepare: open, ui: () => page.getByRole('group', { name: 'Mission type' }).getByRole('button', { name: 'Crewed' }).click(), expect: 'setFilters', action: ['setFilters', { type: 'crewed' }] });
    assert.equal(crewed.filter.type, 'crewed');
    const countries = await page.evaluate(() => [...document.querySelectorAll('.fp-mission-body .ly-chips .ly-btn')].map((e) => e.textContent));
    await equivalent({ prepare: open, ui: () => page.locator('.fp-mission-body .ly-chips').getByRole('button', { name: countries[0], exact: true }).click(), expect: 'setFilters', action: ['setFilters', { countries: countries.slice(1) }] });
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
  test('"Drop pin at centre" and Enter on the focused globe = dropPin at the centre of view', SLOW, async () => {
    const byButton = await equivalent({ ui: () => filters().getByRole('button', { name: 'Drop pin at centre' }).click(), expect: 'dropPin', action: (ui) => [['dropPin', { lat: ui.siteLat, lon: ui.siteLon }]] });
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

  test('clicking a landing marker = selectSite { site, surface: true }', SLOW, async () => {
    const apollo = { lat: 0.67416, lon: 23.47314, altitudeKm: 300 };
    const overMarker = async () => {
      await result(page, 'setGlobeCamera', apollo);
      await cameraAt(apollo);
    };
    const s = await equivalent({
      prepare: overMarker,
      ui: async () => {
        await page.mouse.click(640, 360);
        await until(page, () => window.lunyx.store.get().site !== null && document.body.dataset.view === 'surface');
      },
      expect: 'selectSite',
      action: ['selectSite', { site: 'apollo-11', surface: true }],
      keys: ['view', 'siteId', 'siteKind', 'timeUtc', 'window'],
      wait: () => until(page, () => document.body.dataset.view === 'surface'),
    });
    assert.equal(s.siteId, 'apollo-11');
    assert.equal(s.view, 'surface');
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
      action: (ui) => [['selectSite', { site: ui.siteId, surface: true }]],
      keys: ['view', 'siteId'],
      wait: () => until(page, () => document.body.dataset.view === 'surface'),
    });
    assert.notEqual(later.siteId, 'apollo-11');

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

  test('little person = enterSurface; close button and "Back to orbit" = exitSurface', SLOW, async () => {
    const down = await equivalent({ site: 'im-2', ui: () => page.locator('.person-btn').click(), expect: 'enterSurface', action: ['enterSurface', {}], keys: ['view', 'siteId'], wait: inSurface });
    assert.equal(down.view, 'surface');
    for (const [how, leave] of [
      ['close button', () => click(page, '.close-surface')],
      ['"Back to orbit"', () => page.getByRole('button', { name: 'Back to orbit' }).click()],
    ]) {
      const s = await equivalent({ site: 'im-2', prepare: enterSurface, ui: leave, expect: 'exitSurface', action: ['exitSurface', {}], keys: ['view', 'siteId'], wait: inGlobe });
      assert.equal(s.view, 'globe', how);
      assert.equal(s.siteId, 'im-2', how);
    }
  });

  // Known difference, reported to @globe and @surface: the surface view's Escape handler and
  // the site card's Escape handler both act on the same key press, so Escape leaves the
  // surface AND deselects the site. exitSurface (and the two buttons) keep the site.
  test('Escape in the surface view = exitSurface (the site stays selected)', { ...SLOW, todo: 'app bug: Escape in the surface view also runs clearSite' }, async () => {
    const s = await equivalent({ site: 'im-2', prepare: enterSurface, ui: () => page.keyboard.press('Escape'), expect: 'exitSurface', action: ['exitSurface', {}], keys: ['view', 'siteId'], wait: inGlobe });
    assert.equal(s.siteId, 'im-2');
  });
});

describe('equivalence: cameras (a gesture ends in a pose the action reaches)', () => {
  test('latitude / longitude fields = setGlobeCamera', SLOW, async () => {
    const target = { lat: -45, lon: 60, altitudeKm: HOME.altitudeKm };
    const s = await equivalent({
      ui: async () => {
        await setField(page, `#${await filters().getByText('Latitude', { exact: true }).getAttribute('for')}`, -45);
        await cameraAt({ ...HOME, lat: -45 });
        await setField(page, `#${await filters().getByText('Longitude', { exact: true }).getAttribute('for')}`, 60);
      },
      expect: 'setGlobeCamera',
      action: ['setGlobeCamera', { lat: -45, lon: 60 }],
      wait: () => cameraAt(target),
    });
    assert.deepEqual(s.camera, { lat: -45, lon: 60, altitudeKm: 4170 });
  });

  test('arrow keys, plus / minus, drag and wheel on the globe = setGlobeCamera with the pose they reach', SLOW, async () => {
    const replay = (ui) => [['setGlobeCamera', ui.camera]];
    const globe = page.locator('#scene');
    const keys = await equivalent({
      ui: async () => {
        await globe.focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('+');
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
    assert.deepEqual((await snapshot()).camera, zoomed.camera);
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

    // The map's zoom is not part of the shared state: compare what the map shows (its zoom-out button and its label).
    const shows = () => page.evaluate(() => ({ canZoomOut: !document.querySelector('.locator button[aria-label="Zoom the map out"]').disabled, label: document.querySelector('.locator-canvas').getAttribute('aria-label') }));
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
});
