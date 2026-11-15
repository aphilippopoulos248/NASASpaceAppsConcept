// DRAFT (checkpoint 2026-11-15): three placeholders wait for the T-10 / T-11 panels; see docs/lunyx/handover/T-16-T-17-checkpoint.md
// The main journey through the built app, with bundled data only:
//   open -> pin custom coordinates -> open a bundled landing on the surface -> scrub time ->
//   delay the arrival by 24 h -> compare on time against late -> ask the assistant.
// Assertions are on values, not on the presence of elements: what the screen shows must be
// what the analysis returned.
//
// Steps that need panels which are not built yet (the compare panel and the nearby
// alternatives list, T-11; the surface key metrics, T-10) are marked todo at the end.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ask, closeBrowser, lastSeq, log, openApp, openAssistant, result, setField, SLOW, state, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

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

const filters = () => page.locator('.filters-panel');
const card = () => page.locator('.site-card');
const fieldFor = async (label) => `#${await filters().getByText(label, { exact: true }).getAttribute('for')}`;

/** The site card's facts as { label: text }. */
function cardFacts() {
  return page.evaluate(() => {
    const out = {};
    for (const dt of document.querySelectorAll('.site-card dt')) {
      const dd = dt.nextElementSibling;
      if (dd && !dt.hidden && dd.textContent) out[dt.textContent.trim()] = dd.textContent.trim();
    }
    return out;
  });
}

/**
 * Where a landing's marker is on screen: the globe view has no public way to ask, so try the
 * centre first and then points around it until the pointer becomes a hand over a marker.
 */
async function markerOnScreen(siteId) {
  for (const [dx, dy] of [[0, 0], [0, -6], [0, 6], [-6, 0], [6, 0], [0, -12], [0, 12], [-12, 0], [12, 0], [-8, -8], [8, 8], [-8, 8], [8, -8], [0, -18], [0, 18], [-18, 0], [18, 0]]) {
    await page.mouse.move(640 + dx, 360 + dy);
    await page.waitForTimeout(150);
    if (await page.evaluate(() => document.getElementById('scene').style.cursor === 'pointer')) return { x: 640 + dx, y: 360 + dy };
  }
  throw new Error(`no marker found near the centre of view for ${siteId}`);
}

const firstNumber = (text) => Number(/-?\d+(?:\.\d+)?/.exec(text.replace('−', '-'))?.[0]);
/** Equal within what one displayed decimal can show. */
const close = (shown, value, what) => assert.ok(Math.abs(shown - value) <= 0.06, `${what}: the screen shows ${shown}, the analysis says ${value}`);

/** Waits for the card's mission-window numbers and returns them with the analysis they must match. */
async function cardAndAnalysis() {
  const a = await result(page, 'getAnalysis');
  assert.equal(a.state, 'ready', a.error);
  await until(page, () => /% of the window/.test(document.querySelector('.site-card .sc-window')?.textContent ?? ''));
  return { a, facts: await cardFacts() };
}

/** Waits until the globe camera has stopped moving and returns the centre of view. */
async function cameraSettled() {
  let last = '';
  for (let i = 0; i < 80; i++) {
    const c = (await state(page)).globeCenter;
    const now = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altitudeKm.toFixed(0)}`;
    if (now === last) return c;
    last = now;
    await page.waitForTimeout(500);
  }
  return (await state(page)).globeCenter;
}

describe('flow: from a pin to a comparison, on bundled data', () => {
  let typedCentre = null;

  test('a pin at typed coordinates is analysed, and the card shows the analysis values', SLOW, async () => {
    // A point near the south pole, inside the bundled 40 m elevation layer.
    await setField(page, await fieldFor('Latitude'), -88);
    await cameraSettled();
    await setField(page, await fieldFor('Longitude'), 136.7);
    typedCentre = await cameraSettled();
    assert.ok(Math.abs(typedCentre.lat - -88) < 0.1 && Math.abs(typedCentre.lon - 136.7) < 0.1, `the view went to ${JSON.stringify(typedCentre)}`);
    await filters().getByRole('button', { name: 'Drop pin at centre' }).click();
    await until(page, () => window.lunyx.store.get().site?.kind === 'custom');
    const site = (await state(page)).site;
    // The pin is the centre of view, to the 5 decimals the action takes.
    assert.ok(Math.abs(site.lat - typedCentre.lat) < 2e-5 && Math.abs(site.lon - typedCentre.lon) < 2e-5, `${JSON.stringify(site)} vs ${JSON.stringify(typedCentre)}`);
    assert.match(site.id, /^pin:-8[78]\.\d+,136\.\d+$/);

    const { a, facts } = await cardAndAnalysis();
    close(firstNumber(facts.Sunlight), a.metrics.illuminationPct, 'sunlight');
    close(firstNumber(facts['Earth in view']), a.metrics.earthVisiblePct, 'Earth in view');
    close(firstNumber(facts.Slope), a.slope.slopeDeg, 'slope');
    // The result names the elevation data it rests on, and it is a bundled polar grid (no network was available).
    assert.ok(a.provenance.elevationData.length > 0);
    assert.ok(a.provenance.elevationData[0].resolutionM <= 160, JSON.stringify(a.provenance.elevationData[0]));
    // The elevation line arrives a moment after the numbers (the card loads the terrain itself).
    await until(page, () => [...document.querySelectorAll('.site-card dt')].some((dt) => dt.textContent.trim() === 'Elevation data' && /\d+(\.\d+)? k?m grid/.test(dt.nextElementSibling?.textContent ?? '')));
    assert.match((await cardFacts())['Elevation data'], /\d+(\.\d+)? k?m grid/);
    assert.match(await card().locator('.sc-winnote').textContent(), /not a radio link/);
  });

  // Known difference, reported to @globe (finding F-3 in docs/lunyx/actions.md): poleward of
  // about 80 degrees the view stops a little short of the latitude asked for, so a pin dropped
  // "at the centre" after typing coordinates is not exactly at the typed latitude.
  test('typing coordinates centres the view exactly on them', { ...SLOW, todo: 'app bug: the globe camera lands up to 0.06 degrees (1.7 km) off poleward of 80 degrees' }, async () => {
    assert.ok(typedCentre, 'the previous test did not run');
    assert.ok(Math.abs(typedCentre.lat - -88) < 0.001, `typed latitude -88, the view is centred on ${typedCentre.lat.toFixed(4)}`);
  });

  test('clicking a landing marker opens that site on the surface; the close button returns to the globe', SLOW, async () => {
    // Put IM-2 under the screen centre, close enough that its marker is alone there, then click it.
    await result(page, 'setGlobeCamera', { lat: -84.79, lon: 29.2, altitudeKm: 300 });
    await cameraSettled();
    const from = await lastSeq(page);
    // The marker sits at the site; the centre of view is slightly off it near the pole (F-3), so find it on screen.
    const at = await markerOnScreen('im-2');
    await page.mouse.click(at.x, at.y);
    await until(page, () => window.lunyx.store.get().site?.id === 'im-2' && document.body.dataset.view === 'surface');
    assert.ok((await log(page, from)).some((e) => e.name === 'selectSite' && e.origin === 'ui' && e.ok));
    assert.match(await page.locator('.surface-hud').textContent(), /Surface view/);
    assert.match(page.url(), /site=im-2/);
    assert.match(page.url(), /view=surface/);
    await page.locator('.close-surface').click();
    await until(page, () => document.body.dataset.view === 'globe');
    assert.equal((await state(page)).site.id, 'im-2');
    assert.equal(await card().locator('.sc-title').textContent(), 'IM-2 Athena');
  });

  test('"At landing time" and the time slider: the clock, the window and the sky readout stay in step', SLOW, async () => {
    await card().getByRole('button', { name: /^At landing time/ }).click();
    await until(page, () => window.lunyx.store.get().timeMs === Date.UTC(2025, 2, 6, 17, 28));
    let s = await state(page);
    assert.equal(s.windowStartMs, Date.UTC(2025, 2, 6, 17, 28));
    const slider = page.locator('.time-scrubber').getByLabel('Time within the mission window');
    await slider.focus();
    for (let i = 0; i < 4; i++) await slider.press('ArrowRight');
    await until(page, () => window.lunyx.store.get().timeMs > Date.UTC(2025, 2, 6, 17, 28));
    s = await state(page);
    assert.ok(s.timeMs <= s.windowStartMs + s.windowDurationH * 3_600_000, 'the slider must stay inside the mission window');
    assert.equal(s.windowStartMs, Date.UTC(2025, 2, 6, 17, 28), 'scrubbing must not move the window');
    // The card's sky heading names the same instant the store holds.
    const iso = new Date(s.timeMs).toISOString();
    const heading = `Sky at ${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
    await until(page, (h) => [...document.querySelectorAll('.site-card .ly-section-title')].some((e) => e.textContent === h), heading);
    // Sun and Earth on the card are the analysis' values for that instant.
    const a = await result(page, 'getAnalysis');
    const facts = await cardFacts();
    for (const [body, label] of [['sun', 'Sun'], ['earth', 'Earth']]) {
      const shown = [...facts[label].replace(/−/g, '-').matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      assert.ok(shown.some((v) => Math.abs(v - Math.abs(a.now[body].clearanceDeg)) <= 0.06 || Math.abs(v - a.now[body].elDeg) <= 0.06), `${label} on the card (${facts[label]}) does not show the analysis value (clearance ${a.now[body].clearanceDeg}, elevation ${a.now[body].elDeg})`);
    }
  });

  test('a 24 h arrival delay moves the analysed window, and the card follows the new analysis', SLOW, async () => {
    const before = await cardAndAnalysis();
    await setField(page, filters().getByLabel('Arrival delay'), 24);
    await until(page, () => window.lunyx.store.get().delayH === 24);
    await until(page, () => /2025-03-07 17:28 UTC/.test(document.querySelector('.site-card .sc-winwhen')?.textContent ?? ''));
    const after = await cardAndAnalysis();
    assert.equal(after.a.scenario.startUtc, '2025-03-07T17:28Z');
    assert.equal(before.a.scenario.startUtc, '2025-03-06T17:28Z');
    close(firstNumber(after.facts.Sunlight), after.a.metrics.illuminationPct, 'sunlight after the delay');
    close(firstNumber(after.facts['Earth in view']), after.a.metrics.earthVisiblePct, 'Earth in view after the delay');
    assert.match(await filters().locator('.fp-datenote').textContent(), /With the 24 h delay the mission window starts 2025-03-07 17:28 UTC/);
  });

  test('comparing on time against 24 h late: what the assistant reports is what the comparison returned', SLOW, async () => {
    await openAssistant(page);
    const reply = await ask(page, 'compare with a 24 h delay');
    assert.equal(reply.shownLabel, 'Deterministic mode: no language model');
    const compare = reply.actions.find((x) => x.name === 'compare');
    assert.ok(compare?.ok, JSON.stringify(reply.actions.map((x) => [x.name, x.ok, x.error])));
    const r = compare.result;
    assert.equal(r.analysisA.state, 'ready');
    assert.equal(r.analysisB.state, 'ready');
    const f1 = (v) => v.toFixed(1);
    for (const [tag, side] of [['A', r.analysisA], ['B', r.analysisB]]) {
      assert.ok(reply.text.includes(`${tag}: ${r[tag]}: illumination ${f1(side.illuminationPct)} %, longest darkness ${f1(side.longestDarknessH)} h, Earth line of sight ${f1(side.earthVisiblePct)} %, longest Earth gap ${f1(side.longestEarthGapH)} h, slope ${f1(side.slopeDeg)}°.`), `${tag} side not reported as returned:\n${reply.text}`);
    }
    const signed = (v) => `${v > 0 ? '+' : ''}${f1(v)}`;
    assert.ok(reply.text.includes(`B minus A: illumination ${signed(r.diff.illuminationPct)} percentage points, longest darkness ${signed(r.diff.longestDarknessH)} h`), reply.text);
    // Same site and same window length on both sides; B starts 24 h later.
    assert.equal(r.scenarioA.site.id, 'im-2');
    assert.equal(r.scenarioB.site.id, 'im-2');
    assert.equal(Date.parse(r.scenarioB.startUtc) - Date.parse(r.scenarioA.startUtc), 24 * 3_600_000);
    assert.equal(r.scenarioA.durationH, r.scenarioB.durationH);
    const s = await state(page);
    assert.equal(s.comparing, true);
    assert.deepEqual(reply.actions.map((x) => x.name), ['setDelay', 'saveScenario', 'setDelay', 'saveScenario', 'compare']);
  });

  test('asking where Earth is: the answer is the analysis at the simulated time', SLOW, async () => {
    const reply = await ask(page, 'where is the earth?');
    const a = await result(page, 'getAnalysis');
    const e = a.now.earth;
    assert.ok(reply.text.includes(`azimuth ${e.azDeg.toFixed(1)}°, elevation ${e.elDeg.toFixed(1)}°`), reply.text);
    assert.ok(reply.text.includes(`${Math.abs(e.clearanceDeg).toFixed(2)}° ${e.clearanceDeg >= 0 ? 'above' : 'below'} the terrain skyline`), reply.text);
    assert.match(reply.text, /not a guarantee of a working radio link/);
  });

  test('the journey raised no page errors', SLOW, async () => {
    assert.deepEqual(app.problems, []);
  });

  test('compare panel shows both sides and their differences (T-11)', { todo: 'the compare panel is not built yet' }, () => {});
  test('nearby alternatives are ranked and one is chosen from the list (T-11)', { todo: 'the nearby panel and its actions are not built yet' }, () => {});
  test('surface key metrics equal the analysis (T-10)', { todo: 'the surface HUD is not built yet' }, () => {});
});
