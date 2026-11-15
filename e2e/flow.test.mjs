// The main journey through the built app on the desktop website, with bundled data only:
//   open -> pin at typed coordinates -> search criteria -> save A -> scan nearby sites ->
//   a ranked alternative as B, compared through the panel -> a bundled landing on the surface ->
//   surface key metrics -> scrub time -> +24 h arrival delay -> "Compare arrivals" in the
//   panel -> ask the assistant.
// Assertions are on values, not on the presence of elements: what the screen shows must be
// what the analysis returned (e2e/lib/read.mjs reads the panels).
//
// The functional tests use reduced motion (camera flights end at once). The last block runs
// with motion, as a person sees the app, for the coordinate-entry findings Q-1 and Q-2
// (docs/lunyx/qa-findings.md); those tests are marked todo while the defects exist.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { ask, closeBrowser, lastSeq, log, openApp, openAssistant, result, setField, SLOW, state, until } from './lib/app.mjs';
import { compareRowsAgainst, failures, keyMetricsAgainst, nearbyRank1Against, publishedNearby, readCompare, readKeyMetrics, readNearby, requirementLinesAgainst, settledComparison } from './lib/read.mjs';
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
const sheet = () => page.locator('.cmp-sheet');
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
async function cameraSettled(p = page) {
  let last = '';
  for (let i = 0; i < 80; i++) {
    const c = (await state(p)).globeCenter;
    const now = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altitudeKm.toFixed(0)}`;
    if (now === last) return c;
    last = now;
    await p.waitForTimeout(500);
  }
  return (await state(p)).globeCenter;
}

async function openComparePanel() {
  if (await sheet().isHidden()) {
    await page.locator('.cmp-launcher').click();
    await until(page, () => !document.querySelector('.cmp-sheet')?.hidden);
  }
}

async function closeComparePanel() {
  await sheet().focus();
  await page.keyboard.press('Escape');
  await until(page, () => document.querySelector('.cmp-sheet')?.hidden);
}

/** Waits until the compare table shows figures for both sides (it redraws after the analyses publish). */
const compareTableFilled = () =>
  until(page, () => {
    const row = [...document.querySelectorAll('.cmp-sheet [role="table"] .cmp-row')].find((r) => r.querySelector('.cmp-th')?.textContent.trim() === 'Sunlight');
    const cells = row ? [...row.querySelectorAll('.cmp-td')].slice(0, 2).map((c) => c.textContent) : [];
    return cells.length === 2 && cells.every((t) => /\d/.test(t));
  });

const LIMITS = { slopeLimitDeg: 8, maxEarthGapH: 48 };

describe('flow: from a pin to a nearby alternative and a comparison, on bundled data', () => {
  let typedCentre = null;
  let pinId = null;

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
    pinId = site.id;
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

  // Finding Q-3 (docs/lunyx/qa-findings.md; F-3 of the legacy notes), owner @globe: poleward of
  // 80.06 degrees the fly-to clamps the camera direction, so the view stops short of the latitude
  // asked for, and a pin dropped "at the centre" is not at the typed latitude.
  test('typing coordinates centres the view exactly on them', { ...SLOW, todo: 'Q-3 (@globe): poleward of 80.06° the globe camera stops up to 0.06° (1.7 km) short of the typed latitude' }, async () => {
    assert.ok(typedCentre, 'the previous test did not run');
    assert.ok(Math.abs(typedCentre.lat - -88) < 0.001, `typed latitude -88, the view is centred on ${typedCentre.lat.toFixed(4)}`);
  });

  test('search criteria in the compare panel reach the app state, and the pin is saved as A', SLOW, async () => {
    await openComparePanel();
    const req = page.getByRole('group', { name: 'Requirements the two scenarios are checked against' });
    await setField(page, req.getByLabel('Slope at most'), LIMITS.slopeLimitDeg);
    await setField(page, req.getByLabel('Earth gap at most'), LIMITS.maxEarthGapH);
    await until(page, ([s, g]) => window.lunyx.store.get().slopeLimitDeg === s && window.lunyx.store.get().maxEarthGapH === g, [LIMITS.slopeLimitDeg, LIMITS.maxEarthGapH]);
    const from = await lastSeq(page);
    await sheet().getByRole('button', { name: 'Save the scenario on screen as A' }).click();
    await until(page, () => Boolean(window.lunyx.store.get().compareA));
    const s = await state(page);
    assert.equal(s.compareA.site.id, pinId);
    assert.equal(s.compareA.durationH, s.windowDurationH);
    assert.ok((await log(page, from)).some((e) => e.name === 'saveScenario' && e.origin === 'ui' && e.ok));
  });

  test('nearby sites: the scan from the "Nearby sites" tab is listed as the analysis ranked it', SLOW, async () => {
    await sheet().getByRole('tab', { name: 'Nearby sites' }).click();
    const scanSettings = page.getByRole('group', { name: 'Scan settings' });
    // A small grid keeps the test short: 600 m around the pin, every 200 m.
    await setField(page, scanSettings.getByLabel('Radius'), 600);
    await setField(page, scanSettings.getByLabel('Spacing'), 200);
    const from = await lastSeq(page);
    await scanSettings.getByRole('button', { name: 'Scan nearby sites' }).click();
    await until(page, () => ['ready', 'error'].includes(window.lunyx.analysis.nearby().state), undefined, 5 * 120_000);
    const scan = await publishedNearby(page);
    assert.equal(scan.state, 'ready', scan.error);
    const entry = (await log(page, from)).find((e) => e.name === 'rankNearby');
    assert.ok(entry?.ok && entry.origin === 'ui', JSON.stringify(entry));
    assert.deepEqual([scan.options.radiusM, scan.options.spacingM, scan.options.slopeLimitDeg], [600, 200, LIMITS.slopeLimitDeg]);
    await until(page, () => document.querySelector('[role="table"][aria-label="Ranked nearby alternatives"] .cmp-nrow:not(.cmp-nhead)'));
    const view = await readNearby(page);
    const problems = failures(nearbyRank1Against(view, scan));
    assert.equal(problems, '', problems);
    // Nothing steeper than the limit is ranked.
    for (const r of view.rows.filter((x) => /^\d+$/.test(x.Rank ?? ''))) assert.ok(firstNumber(r.Slope) <= LIMITS.slopeLimitDeg + 0.05, `ranked ${r.Rank} has slope ${r.Slope}`);
  });

  test('"Compare as B" on rank 1: the compare table equals the two analyses, with the requirements checked', SLOW, async () => {
    const from = await lastSeq(page);
    await page.getByRole('button', { name: /^Pin candidate 1, .* and load it as scenario B$/ }).click();
    const pub = await settledComparison(page);
    assert.equal(pub.state, 'ready', pub.error);
    const s = await state(page);
    assert.equal(s.compareA.site.id, pinId, 'A stays the pin');
    assert.equal(s.compareB.site.id, s.site.id, 'B is the candidate, now the site on screen');
    assert.notEqual(s.compareB.site.id, pinId);
    assert.ok((await log(page, from)).some((e) => e.name === 'selectCandidate' && e.origin === 'ui' && e.ok && e.params?.asB === true));
    await compareTableFilled();
    const view = await readCompare(page);
    assert.ok(view.open, 'the compare panel is open');
    const problems = failures([...compareRowsAgainst(view, pub), ...requirementLinesAgainst(view, pub, LIMITS)]);
    assert.equal(problems, '', problems);
    await closeComparePanel();
    assert.equal((await state(page)).comparing, false);
  });

  test('clicking a landing marker opens that site on the surface; the close button returns to the globe', SLOW, async () => {
    // Put IM-2 under the screen centre, close enough that its marker is alone there, then click it.
    await result(page, 'setGlobeCamera', { lat: -84.79, lon: 29.2, altitudeKm: 300 });
    await cameraSettled();
    const from = await lastSeq(page);
    // The marker sits at the site; the centre of view is slightly off it near the pole (Q-3), so find it on screen.
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

  test('surface key metrics equal the analysis: Sun and Earth now, the countdowns, the mission window', SLOW, async () => {
    await card().getByRole('button', { name: 'Enter surface view' }).click();
    await until(page, () => document.body.dataset.view === 'surface' && document.querySelector('.km .km-now tbody tr th'));
    const a = await result(page, 'getAnalysis');
    assert.equal(a.state, 'ready', a.error);
    // The panel refreshes at most five times a second.
    await page.waitForTimeout(400);
    const km = await readKeyMetrics(page);
    assert.ok(km?.open, 'the Key metrics panel is open');
    const problems = failures(keyMetricsAgainst(km, a));
    assert.equal(problems, '', problems);
    // A countdown is a control: it moves the shared clock to its event.
    const next = a.nextEvents.sunset ?? a.nextEvents.sunrise;
    if (next) {
      const k = a.nextEvents.sunset ? 0 : 1;
      await page.locator('.km .km-count-btn').nth(k).click();
      await until(page, (t) => Math.abs(window.lunyx.store.get().timeMs - t) <= 60_000, Date.parse(next.timeUtc));
    }
    await page.locator('.close-surface').click();
    await until(page, () => document.body.dataset.view === 'globe');
  });

  test('a 24 h arrival delay moves the analysed window, and the card follows the new analysis', SLOW, async () => {
    await card().getByRole('button', { name: /^At landing time/ }).click();
    await until(page, () => window.lunyx.store.get().timeMs === Date.UTC(2025, 2, 6, 17, 28));
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
    await setField(page, filters().getByLabel('Arrival delay'), 0);
    await until(page, () => window.lunyx.store.get().delayH === 0);
  });

  test('"Compare arrivals" in the compare panel: B is A 24 h later, and the table equals the two analyses', SLOW, async () => {
    await openComparePanel();
    await sheet().getByRole('tab', { name: 'A and B' }).click();
    await sheet().getByRole('button', { name: 'Save the scenario on screen as A' }).click();
    await until(page, () => window.lunyx.store.get().compareA?.site.id === 'im-2');
    const from = await lastSeq(page);
    await setField(page, sheet().getByLabel('B arrives later than A by'), 24);
    await sheet().getByRole('button', { name: 'Compare arrivals' }).click();
    const pub = await settledComparison(page);
    assert.equal(pub.state, 'ready', pub.error);
    const s = await state(page);
    assert.equal(s.compareA.site.id, 'im-2');
    assert.equal(s.compareB.site.id, 'im-2');
    assert.equal(s.compareB.startMs - s.compareA.startMs, 24 * 3_600_000);
    assert.equal(s.compareB.durationH, s.compareA.durationH);
    assert.ok((await log(page, from)).some((e) => e.name === 'compareDelayedArrival' && e.origin === 'ui' && e.ok));
    await compareTableFilled();
    const view = await readCompare(page);
    const problems = failures([...compareRowsAgainst(view, pub), ...requirementLinesAgainst(view, pub, LIMITS)]);
    assert.equal(problems, '', problems);
    await closeComparePanel();
  });

  test('comparing on time against 24 h late: what the assistant reports is what the comparison returned', SLOW, async () => {
    await openAssistant(page);
    const reply = await ask(page, 'compare with a 24 h delay');
    assert.equal(reply.shownLabel, 'Deterministic mode: no language model');
    // The comparison comes from `compare` (older builds of the assistant) or from the compare
    // panel's own `compareDelayedArrival` (newer ones); both return the same compare result.
    const done = reply.actions.find((x) => (x.name === 'compare' || x.name === 'compareDelayedArrival') && x.ok);
    assert.ok(done, JSON.stringify(reply.actions.map((x) => [x.name, x.ok, x.error])));
    const r = done.result;
    assert.equal(r.analysisA.state, 'ready');
    assert.equal(r.analysisB.state, 'ready');
    const f1 = (v) => v.toFixed(1);
    for (const [tag, side] of [['A', r.analysisA], ['B', r.analysisB]]) {
      const line = reply.text.split('\n').find((l) => l.startsWith(`${tag}: `)) ?? '';
      assert.ok(line.includes(`illumination ${f1(side.illuminationPct)} %`), `${tag}: illumination not reported as returned:\n${reply.text}`);
      assert.ok(line.includes(`longest darkness ${f1(side.longestDarknessH)} h`), `${tag}: longest darkness not reported as returned:\n${reply.text}`);
      assert.ok(line.includes(`Earth line of sight ${f1(side.earthVisiblePct)} %`) || line.includes(`Earth's centre in view ${f1(side.earthVisiblePct)} %`), `${tag}: Earth in view not reported as returned:\n${reply.text}`);
      assert.ok(line.includes(`slope ${f1(side.slopeDeg)}°`), `${tag}: slope not reported as returned:\n${reply.text}`);
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
    const names = reply.actions.map((x) => x.name).join(',');
    assert.ok(['setDelay,saveScenario,setDelay,saveScenario,compare', 'compareDelayedArrival,openCompare'].includes(names), names);
  });

  test('asking where Earth is: the answer is the analysis at the simulated time', SLOW, async () => {
    const reply = await ask(page, 'where is the earth?');
    const a = await result(page, 'getAnalysis');
    const e = a.now.earth;
    assert.ok(reply.text.includes(`azimuth ${e.azDeg.toFixed(1)}°, elevation ${e.elDeg.toFixed(1)}°`), reply.text);
    assert.ok(reply.text.includes(`${Math.abs(e.clearanceDeg).toFixed(2)}° ${e.clearanceDeg >= 0 ? 'above' : 'below'} the terrain skyline`), reply.text);
    assert.match(reply.text, /not a guarantee of a working radio link|not a radio link/);
  });

  test('the journey raised no page errors', SLOW, async () => {
    assert.deepEqual(app.problems, []);
  });
});

// Typing coordinates with motion on, as a person sees the app (findings Q-1 and Q-2, owner @globe).
describe('flow: typing the centre of view while the globe flies (motion on)', () => {
  let moving, mp;
  before(async () => {
    moving = await openApp(srv.deterministic, { reducedMotion: 'no-preference' });
    mp = moving.page;
  }, SLOW);
  after(async () => {
    await moving?.close();
  });

  const field = (label) => mp.locator('.filters-panel').getByLabel(label, { exact: true });
  const startAt = async () => {
    await result(mp, 'clearSite');
    await result(mp, 'setGlobeCamera', { lat: 8.37, lon: -0.06 });
    await cameraSettled(mp);
  };

  test('latitude, Tab, longitude, Enter centres the view on the typed point', { ...SLOW, todo: 'Q-1 (@globe): on Tab the latitude field is refilled with the in-flight centre and the longitude commit sends that latitude' }, async () => {
    await startAt();
    await field('Latitude').click();
    await field('Latitude').fill('-84.79');
    await field('Latitude').press('Tab');
    await field('Longitude').fill('29.2');
    await field('Longitude').press('Enter');
    const c = await cameraSettled(mp);
    assert.ok(Math.abs(c.lat - -84.79) < 0.1 && Math.abs(c.lon - 29.2) < 0.1, `typed -84.79, 29.2; the view went to ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`);
  });

  test('"Drop pin at centre" right after typing pins the typed point', { ...SLOW, todo: 'Q-2 (@globe): the button pins the in-flight centre of the camera, not the typed coordinates' }, async () => {
    await startAt();
    await field('Latitude').click();
    await field('Latitude').fill('-84.79');
    await field('Latitude').press('Tab');
    await field('Longitude').fill('29.2');
    await mp.locator('.filters-panel').getByRole('button', { name: 'Drop pin at centre' }).click();
    await until(mp, () => window.lunyx.store.get().site?.kind === 'custom');
    const site = (await state(mp)).site;
    assert.ok(Math.abs(site.lat - -84.79) < 0.1 && Math.abs(site.lon - 29.2) < 0.1, `typed -84.79, 29.2; the pin is at ${site.lat}, ${site.lon}`);
  });
});
