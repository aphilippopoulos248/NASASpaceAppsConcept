// End-to-end control (task T-1, decision D-1): every action of the built app, called the way
// a language model calls it, does what it says and leaves on screen what the UI control
// for it shows. No API key and no network: the scripted test model (not a language model)
// asks for the tool calls through the real /api/assistant route, the browser runs them
// through the registry, and the results go back; deterministic mode is driven through the
// drawer with the phrase listed for each action in src/assistant/deterministic/examples.json.
//
// The list of cases follows the registry of the build under test: an action without a case
// here, or without a phrase in examples.json, fails the run, so a new action is noticed.
//
//   node --test e2e/scenario/control.test.mjs     (needs `npm run build` first; starts its own servers)
//   E2E_GPU=1 flock /tmp/lunyx-gpu.lock node --test e2e/scenario/control.test.mjs    (GPU rendering, D-7)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { GPU, renderer } from './gpu.mjs';
import { closeBrowser, lastSeq, openApp, SLOW, TIMEOUT, until } from '../lib/app.mjs';
import { servers } from '../lib/servers.mjs';

const EXAMPLES = JSON.parse(readFileSync(new URL('../../src/assistant/deterministic/examples.json', import.meta.url), 'utf8')).examples;
const INVENTORY = readFileSync(new URL('../../docs/lunyx/actions.md', import.meta.url), 'utf8');
const SCRIPTED_LABEL = 'Scripted test model (not a language model)';
const DETERMINISTIC_LABEL = 'Deterministic mode: no language model';

// IM-2 touchdown: south-polar site with bundled terrain, inside the bundled Horizons table.
const IM2 = '2025-03-06T17:28Z';
// Blue Ghost Mission 1 on the day of its sunset, 16 March 2025 (bundled terrain and Horizons table).
const BLUE_GHOST_DAY = '2025-03-16T06:00Z';

let srv;
before(async () => {
  srv = await servers();
}, SLOW);
after(async () => {
  await closeBrowser();
  await srv?.stop();
});

/**
 * Types a request into the drawer and waits for the turn to end. Returns the reply as the
 * session holds it and what the action log gained, with results.
 */
async function send(page, text) {
  const from = await lastSeq(page);
  const before = await page.evaluate(() => window.lunyxAssistant.session.messages.filter((m) => m.role === 'assistant').length);
  await page.locator('#assistant-input').fill(text);
  await page.locator('#assistant-input').press('Enter');
  await until(page, () => !window.lunyxAssistant.session.busy);
  return page.evaluate(
    ([from, before]) => {
      const s = window.lunyxAssistant.session;
      const replies = s.messages.filter((m) => m.role === 'assistant');
      const m = replies.length > before ? replies.at(-1) : null;
      const shown = [...document.querySelectorAll('.am--assistant')].at(-1);
      return {
        text: m?.text ?? null,
        source: m?.source ?? null,
        shownLabel: m ? (shown?.querySelector('.am-source')?.textContent ?? '') : null,
        shownActions: m ? [...(shown?.querySelectorAll('.am-action-title') ?? [])].map((e) => e.textContent) : [],
        entries: window.lunyx.actions
          .actionLog()
          .filter((e) => e.seq > from)
          .map(({ name, params, origin, ok, error, result }) => ({ name, params, origin, ok, error: error ?? null, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })),
      };
    },
    [from, before],
  );
}

const run = (page, name, params = {}) => page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'test'), [name, params]);
const has = (page, name) => page.evaluate((n) => Boolean(window.lunyx.actions.getAction(n)), name);
const store = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.lunyx.store.get())));
const registered = (page) => page.evaluate(() => window.lunyx.actions.listActions().map((a) => a.name));

/** What the controls on screen show, read from the DOM (the same things a person reads). */
function screen(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const labelled = (text) => {
      const l = [...document.querySelectorAll('.filters-panel label')].find((x) => x.textContent.trim() === text);
      return l?.htmlFor ? document.getElementById(l.htmlFor) : (l?.querySelector('input') ?? null);
    };
    const check = (text) => [...document.querySelectorAll('.filters-panel label.ly-check')].find((l) => l.textContent.includes(text))?.querySelector('input')?.checked ?? null;
    const pressed = (group, name) => [...(q(`[role="group"][aria-label="${group}"]`)?.querySelectorAll('button') ?? [])].find((b) => b.textContent.trim() === name)?.getAttribute('aria-pressed') ?? null;
    const band = [...(q('.filters-panel [role="group"][aria-label^="Solar elevation"]')?.querySelectorAll('input') ?? [])].map((i) => i.value);
    const hudButton = (name) => [...document.querySelectorAll('.surface-hud .sh-controls button')].find((b) => b.textContent.trim() === name);
    const card = q('.site-card');
    return {
      view: document.body.dataset.view,
      url: location.search,
      scrubber: { playPressed: q('.time-scrubber .ts-play')?.getAttribute('aria-pressed'), date: q('.time-scrubber .ts-date')?.value, rate: q('.time-scrubber .ts-rate')?.value, window: q('.time-scrubber .ts-window')?.value },
      filters: {
        arrival: q('.filters-panel input[type="datetime-local"]')?.value,
        dateNote: q('.filters-panel .fp-datenote')?.textContent ?? '',
        lat: labelled('Latitude')?.value,
        lon: labelled('Longitude')?.value,
        mast: labelled('Mast height')?.value,
        window: labelled('Mission window')?.value,
        delay: labelled('Arrival delay')?.value,
        relief: labelled('Exaggeration')?.value,
        // Since T-64 the relief has no selector: the "Terrain relief" note says what is drawn.
        reliefNote: [...document.querySelectorAll('.filters-panel h3')].find((h) => h.textContent.trim() === 'Terrain relief')?.nextElementSibling?.textContent ?? '',
        territory: labelled('Territory size exaggeration')?.value,
        band,
        coverage: check('Show elevation data coverage'),
        ice: check('Show mapped ice targets'),
        flags: check('Show country flags'),
        missions: check('Show previous missions'),
        overlayOn: check('Show optimal landing area'),
        overlay: q('.filters-panel select[aria-label="Landing-area overlay"]')?.value,
        legend: q('.filters-panel .fp-legend')?.textContent ?? '',
        realPressed: pressed('Lighting', 'Real'),
        evenPressed: pressed('Lighting', 'Even'),
        crewedPressed: pressed('Mission type', 'Crewed'),
        landingCount: q('.mf-years-head .ly-label')?.textContent ?? '',
      },
      card: card && !card.hidden ? { title: q('.site-card .sc-title')?.textContent, where: q('.site-card .sc-where')?.textContent ?? '', bodyHidden: Boolean(q('.site-card .sc-body')?.hidden), foldExpanded: q('.site-card .sc-fold')?.getAttribute('aria-expanded'), text: card.textContent } : null,
      compass: q('.compass')?.getAttribute('aria-label') ?? '',
      locator: { readout: q('.locator-readout')?.textContent ?? '', zoomOutDisabled: Boolean(q('.locator button[aria-label="Zoom the map out"]')?.disabled) },
      hud: { status: q('.surface-hud .sh-status')?.textContent ?? '', ground: q('.surface-hud .sh-ground')?.textContent ?? '', pathsPressed: hudButton('Sky paths')?.getAttribute('aria-pressed') ?? null, generatedPressed: hudButton('Generated detail')?.getAttribute('aria-pressed') ?? null, homeShown: hudButton('Return to site') ? !hudButton('Return to site').hidden : null },
      drawerOpen: Boolean(q('#assistant-drawer')?.classList.contains('is-open')),
      compare: (() => {
        const sheet = q('.cmp-sheet');
        if (!sheet) return null;
        const panel = [...sheet.querySelectorAll('[role="tabpanel"]')].find((p) => !p.hidden);
        return { open: !sheet.hidden, tab: [...sheet.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null, text: panel?.textContent ?? '', loadButtons: [...sheet.querySelectorAll('button[aria-label^="Load the saved comparison "]')].map((b) => b.getAttribute('aria-label').slice('Load the saved comparison '.length)) };
      })(),
      requirements: (() => {
        const field = (text) => {
          const l = [...document.querySelectorAll('.cmp-sheet label')].find((x) => x.textContent.trim() === text);
          return l?.htmlFor ? (document.getElementById(l.htmlFor)?.value ?? null) : null;
        };
        return document.querySelector('.cmp-sheet') ? { slope: field('Slope at most'), gap: field('Earth gap at most') } : null;
      })(),
      metrics: q('.km') ? { bodyHidden: Boolean(q('.km .km-body')?.hidden), foldExpanded: q('.km .km-fold')?.getAttribute('aria-expanded') ?? null } : null,
      chart: q('.skc') ? { hidden: q('.skc').hidden, size: q('.skc').dataset.size ?? null, mode: q('.skc').dataset.mode ?? null, explainShown: !q('.skc .skc-explain')?.hidden, explainText: q('.skc .skc-explain')?.textContent ?? '' } : null,
    };
  });
}

/** Waits until what is on screen passes `ok` (reading the DOM again each time); returns it. Fails with the last reading. */
async function shows(page, ok, what) {
  const end = Date.now() + TIMEOUT;
  let last;
  for (;;) {
    last = await screen(page);
    try {
      if (ok(last) !== false) return last;
    } catch {
      // not yet
    }
    if (Date.now() > end) assert.fail(`${what}: the screen did not show it. Last reading: ${JSON.stringify(last)}`);
    await page.waitForTimeout(300);
  }
}

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

// ---------------------------------------------------------------- the cases, one per action

/**
 * Each case: the parameters a model would send, an optional preparation (through actions with
 * origin "test"), and a check of the result and of the screen. `needs` names actions that must
 * exist for the preparation. Cases run in this order on one page, each building on the last.
 */
const CASES = [
  // ---- state and time
  { name: 'getState', check: async (r) => assert.equal(r.view, 'globe') },
  { name: 'setMissionWindow', params: { startUtc: IM2, durationH: 24, moveClock: true }, check: async (r, page) => {
    assert.equal(r.windowStartUtc, IM2);
    await shows(page, (s) => s.filters.arrival === '2025-03-06T17:28' && s.scrubber.window === '24' && s.filters.window === '24' && s.scrubber.date === '2025-03-06T17:28', 'arrival field, both window selectors and the scrubber date');
  } },
  { name: 'setTime', params: { utc: '2025-03-06T20:00Z' }, check: async (r, page) => {
    assert.equal(r.timeUtc, '2025-03-06T20:00Z');
    await shows(page, (s) => s.scrubber.date === '2025-03-06T20:00' && s.filters.arrival === '2025-03-06T17:28', 'scrubber date moves, arrival stays');
  } },
  { name: 'setRate', params: { secondsPerSecond: 43200 }, check: async (r, page) => {
    assert.equal(r.rateSimSecondsPerSecond, 43200);
    await shows(page, (s) => s.scrubber.rate === '43200', 'speed selector');
  } },
  { name: 'play', check: async (r, page) => {
    assert.equal(r.playing, true);
    await shows(page, (s) => s.scrubber.playPressed === 'true', 'play button pressed');
  } },
  { name: 'pause', check: async (r, page) => {
    assert.equal(r.playing, false);
    await shows(page, (s) => s.scrubber.playPressed === 'false', 'play button released');
    await run(page, 'setTime', { utc: '2025-03-06T20:00Z' });
  } },
  { name: 'setLightMode', params: { mode: 'even' }, check: async (r, page) => {
    assert.equal(r.lightMode, 'even');
    await shows(page, (s) => s.filters.evenPressed === 'true' && s.filters.realPressed === 'false', 'Lighting: Even pressed');
    await run(page, 'setLightMode', { mode: 'real' });
  } },
  { name: 'setDelay', params: { hours: 24 }, check: async (r, page) => {
    assert.equal(r.effectiveStartUtc, '2025-03-07T17:28Z');
    await shows(page, (s) => s.filters.delay === '24' && /With the 24 h delay the mission window starts 2025-03-07 17:28 UTC/.test(s.filters.dateNote), 'delay field and its note');
    await run(page, 'setDelay', { hours: 0 });
  } },
  { name: 'setMastHeight', params: { metres: 5 }, check: async (r, page) => {
    assert.equal(r.mastHeightM, 5);
    await shows(page, (s) => s.filters.mast === '5', 'mast field');
    await run(page, 'setMastHeight', { metres: 2 });
  } },
  { name: 'setSunBand', params: { minDeg: 5, maxDeg: 60 }, check: async (r, page) => {
    assert.deepEqual([r.sunElMinDeg, r.sunElMaxDeg], [5, 60]);
    await shows(page, (s) => s.filters.band[0] === '5' && s.filters.band[1] === '60', 'solar elevation fields');
  } },
  // Their fields are in the compare panel ("Slope at most", "Earth gap at most"), read when it is open.
  { name: 'setSlopeLimit', prepare: (page) => run(page, 'openCompare', { tab: 'compare' }), params: { degrees: 8 }, check: async (r, page) => {
    assert.equal(r.slopeLimitDeg, 8);
    assert.equal((await store(page)).slopeLimitDeg, 8);
    await shows(page, (s) => s.requirements?.slope === '8', 'the compare panel field "Slope at most"');
  } },
  { name: 'setMaxEarthGap', params: { hours: 12 }, check: async (r, page) => {
    assert.equal(r.maxEarthGapH, 12);
    await shows(page, (s) => s.requirements?.gap === '12', 'the compare panel field "Earth gap at most"');
    await run(page, 'stopCompare');
  } },
  // ---- layers and filters
  { name: 'setOverlay', params: { mode: 'sun-band' }, check: async (r, page) => {
    assert.equal(r.overlay, 'sun-band');
    await shows(page, (s) => s.filters.overlayOn === true && s.filters.overlay === 'sun-band' && /Sun between 5° and 60°/.test(s.filters.legend), 'overlay checkbox, selector and legend');
    await run(page, 'setOverlay', { mode: 'off' });
  } },
  { name: 'showMissions', params: { show: false }, check: async (r, page) => {
    assert.equal(r.showMissions, false);
    await shows(page, (s) => s.filters.missions === false, '"Show previous missions" unticked');
    await run(page, 'showMissions', { show: true });
  } },
  { name: 'setFilters', params: { type: 'crewed' }, check: async (r, page) => {
    assert.equal(r.filter.type, 'crewed');
    await shows(page, (s) => s.filters.crewedPressed === 'true' && s.filters.landingCount === `${r.shown} of ${r.total} landings`, 'Crewed pressed and the landing count');
    await run(page, 'setFilters', { reset: true });
  } },
  { name: 'setReliefExaggeration', prepare: async (page) => {
    page.__relief = (await run(page, 'getState')).result.globeDisplay.reliefExaggeration;
  }, params: { factor: 5 }, check: async (r, page) => {
    assert.equal(r.reliefExaggeration, 5);
    // No selector since T-64 (the assistant's own control); the Filters note gives the factor drawn now.
    // (It names the factor drawn at the camera's altitude, which eases towards true scale close in.)
    await shows(page, (s) => s.filters.reliefNote.includes('Drawn now: ') && s.filters.reliefNote.includes('The stretch applies above'), 'the Terrain relief note says an exaggerated relief is drawn');
    await run(page, 'setReliefExaggeration', { factor: page.__relief });
  } },
  { name: 'setTerritoryScale', prepare: async (page) => {
    page.__territory = (await run(page, 'getState')).result.globeDisplay.territoryScale;
  }, params: { factor: 25 }, check: async (r, page) => {
    assert.equal(r.territoryScale, 25);
    await shows(page, (s) => s.filters.territory === '25', 'the Territory size exaggeration selector');
    await run(page, 'setTerritoryScale', { factor: page.__territory });
  } },
  { name: 'showCoverage', params: { show: true }, check: async (r, page) => {
    assert.equal(r.coverageShown, true);
    await shows(page, (s) => s.filters.coverage === true, 'coverage checkbox');
    await run(page, 'showCoverage', { show: false });
  } },
  { name: 'showFlags', params: { show: true }, check: async (r, page) => {
    assert.equal(r.showFlags, true);
    await shows(page, (s) => s.filters.flags === true, '"Show country flags" ticked');
    await run(page, 'showFlags', { show: false });
  } },
  { name: 'showIceTargets', params: { show: true }, check: async (r, page) => {
    assert.equal(r.iceTargetsShown, true);
    await shows(page, (s) => s.filters.ice === true, 'ice-target checkbox');
    await run(page, 'showIceTargets', { show: false });
  } },
  // ---- globe camera, compass, locator
  { name: 'setGlobeCamera', params: { lat: -45, lon: 60, altitudeKm: 4170 }, check: async (r, page) => {
    assert.deepEqual(r.target, { latDeg: -45, lonDegEast: 60, altitudeKm: 4170 });
    await shows(page, (s) => s.filters.lat === '-45.00' && s.filters.lon === '60.00', 'latitude / longitude fields after the flight');
  } },
  { name: 'resetNorth', check: async (r, page) => {
    assert.ok(Math.abs(r.northAngleDeg) < 1, JSON.stringify(r));
    await shows(page, (s) => /lunar north is up/.test(s.compass), 'compass says north is up');
  } },
  { name: 'setLocatorZoom', params: { zoom: 2 }, check: async (r, page) => {
    assert.equal(r.locatorZoom, 2);
    await shows(page, (s) => /×2$/.test(s.locator.readout) && !s.locator.zoomOutDisabled, 'locator readout ×2 and zoom-out enabled');
    await run(page, 'setLocatorZoom', { zoom: 1 });
  } },
  // ---- sites, the card, site science
  { name: 'listSites', check: async (r, page) => {
    assert.equal(r.total, 28);
    assert.ok(r.sites.some((s) => s.id === 'im-2'));
    for (const s of r.sites.slice(0, 3)) assert.equal((await page.evaluate((n) => window.lunyx.actions.runAction('selectSite', { site: n, fly: false }, 'test'), s.name)).ok, true, `selectSite accepts the listed name "${s.name}"`);
    await run(page, 'clearSite');
  } },
  { name: 'selectSite', params: { site: 'IM-2', atLanding: true }, check: async (r, page) => {
    assert.equal(r.site.id, 'im-2');
    assert.equal(r.timeUtc, IM2);
    await shows(page, (s) => s.card?.title === 'IM-2 Athena' && /site=im-2/.test(s.url) && s.scrubber.date === '2025-03-06T17:28', 'site card, deep link and clock');
  } },
  { name: 'getAnalysis', check: async (r, page) => {
    assert.equal(r.state, 'ready', r.error);
    const s = await shows(page, (x) => /% of the window/.test(x.card?.text ?? ''), 'mission-window figures on the card');
    const card = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.site-card .sc-window dt')].filter((dt) => !dt.hidden).map((dt) => [dt.textContent.trim(), dt.nextElementSibling.textContent.trim()])));
    const first = (t) => Number(/-?\d+(?:\.\d+)?/.exec(t.replace('−', '-'))[0]);
    near(first(card.Sunlight), r.metrics.illuminationPct, 0.051, 'card sunlight vs getAnalysis');
    // Earth by two definitions since T-47, each its own row.
    near(first(card["Earth's centre in view"]), r.metrics.earthVisiblePct, 0.051, "card Earth's centre in view vs getAnalysis");
    near(first(card['Any part of Earth in view']), r.metrics.earthAnyPct, 0.051, 'card any part of Earth in view vs getAnalysis');
    near(first(card.Slope), r.slope.slopeDeg, 0.051, 'card slope vs getAnalysis');
    assert.ok(s.card);
  } },
  { name: 'exportResults', params: { format: 'csv' }, check: async (r) => {
    assert.equal(r.format, 'csv');
    assert.equal(r.downloaded, true);
    assert.match(r.filename, /\.csv$/);
    assert.ok(r.bytes > 0 && r.spells > 0, JSON.stringify(r));
  } },
  { name: 'showOutlook', params: { months: 2 }, check: async (r, page) => {
    assert.equal(r.months, 2);
    assert.ok(r.lunarDays.length >= 2 && r.planned && r.best && r.worst, JSON.stringify({ rows: r.lunarDays.length, planned: r.planned, best: r.best }));
    await shows(page, (s) => s.compare?.open === true && s.compare.tab === 'Outlook' && s.compare.text.length > 0, 'the compare panel on its "Outlook" tab');
    await run(page, 'stopCompare');
  } },
  { name: 'getSiteScience', check: async (r, page) => {
    assert.equal(r.site.id, 'im-2');
    assert.equal(r.dsn.available, true, r.dsn.reason);
    const want = [...r.dsn.stations.map((x) => `${x.receive.pctOfWindow.toFixed(1)} %`), ...(r.longTermAverages.sunlight?.available ? [`${r.longTermAverages.sunlight.pctOfTime} %`] : []), ...r.iceTargets.nearest.slice(0, 3).map((t) => t.label)];
    await shows(page, (s) => want.every((w) => s.card?.text.includes(w)), `the card's site science shows ${want.join(', ')}`);
  } },
  { name: 'nearestIceTargets', params: { count: 3 }, check: async (r, page) => {
    assert.equal(r.available, true);
    assert.equal(r.nearest.length, 3);
    await shows(page, (s) => r.nearest.every((t) => s.card?.text.includes(t.label) && s.card.text.includes(t.distanceText)), 'the card lists the same three ice targets and distances');
  } },
  { name: 'showPanel', params: { panel: 'site-details', open: false }, check: async (r, page) => {
    assert.equal(r.open, false);
    await shows(page, (s) => s.card?.bodyHidden === true && s.card.foldExpanded === 'false', 'card body folded');
    await run(page, 'showPanel', { panel: 'site-details', open: true });
  } },
  { name: 'jumpToEvent', prepare: async (page) => {
    // Blue Ghost on the day of its sunset: the window holds a sunset to jump to.
    await run(page, 'selectSite', { site: 'blue-ghost-1', fly: false });
    await run(page, 'setMissionWindow', { startUtc: BLUE_GHOST_DAY, durationH: 24, moveClock: true });
  }, params: { type: 'sunset' }, check: async (r, page) => {
    assert.equal(r.event, 'sunset');
    assert.ok(r.timeUtc > BLUE_GHOST_DAY && r.timeUtc < '2025-03-17T06:00Z', r.timeUtc);
    const a = (await run(page, 'getAnalysis')).result;
    assert.ok(a.events.some((e) => e.type === 'sunset' && e.timeUtc === r.timeUtc), 'the jump lands on an event of the analysis');
    await shows(page, (s) => s.scrubber.date === r.timeUtc.slice(0, 16) && s.scrubber.playPressed === 'false', 'scrubber date at the event, paused');
    // D-8 (T-47): the sunset is the last limb of a passage that began with the first cut; the result gives both ends.
    assert.equal(r.label, 'Sun fully set');
    assert.equal(r.span?.kind, 'set', JSON.stringify(r.span));
    // Result times are to the minute; the event and its passage's end agree to the second (they may straddle a minute).
    assert.ok(Math.abs(Date.parse(r.span.end.timeUtc) - Date.parse(r.timeUtc)) <= 60_000, `the sunset is the end of its passage: ${r.span.end.timeUtc} vs ${r.timeUtc}`);
    assert.equal(r.span.start.label, 'Sun starts setting');
    assert.ok(r.span.start.timeUtc < r.timeUtc, JSON.stringify(r.span));
    assert.match(r.span.summary, /^starts setting .+, fully set .+ UTC$/);
    // `instant` goes to the other end, as the scrubber's sunset button does before the event.
    const start = (await run(page, 'jumpToEvent', { type: 'sunset', which: 'previous', instant: 'start' })).result;
    assert.deepEqual([start.instantChoice, start.label, start.timeUtc], ['start', 'Sun starts setting', r.span.start.timeUtc]);
    await shows(page, (s) => s.scrubber.date === start.timeUtc.slice(0, 16), 'scrubber date at the start of the sunset');
  } },
  // ---- comparison (no panel in this build: state only)
  { name: 'saveScenario', prepare: async (page) => {
    await run(page, 'selectSite', { site: 'im-2', atLanding: true, fly: false });
  }, params: { slot: 'A' }, check: async (r, page) => {
    assert.equal(r.slot, 'A');
    assert.equal((await store(page)).compareA.site.id, 'im-2');
    await run(page, 'setMastHeight', { metres: 10 });
    await run(page, 'saveScenario', { slot: 'B' });
    await run(page, 'setMastHeight', { metres: 2 });
  } },
  { name: 'compare', check: async (r, page) => {
    assert.equal(r.comparing, true);
    assert.equal(r.analysisA.state, 'ready');
    assert.equal(r.analysisB.state, 'ready');
    assert.ok(r.diff && typeof r.diff.illuminationPct === 'number', JSON.stringify(r.diff));
    const s = await page.evaluate(async () => window.lunyx.actions.getAction('getState').run({}));
    assert.deepEqual(s.compare, { A: r.A, B: r.B, open: true });
  } },
  // ---- the compare panel (T-11)
  { name: 'openCompare', params: { tab: 'compare' }, check: async (r, page) => {
    assert.equal(r.open, true);
    assert.equal(r.tab, 'compare');
    await shows(page, (s) => s.compare?.open === true && s.compare.tab === 'A and B', 'compare panel open on "A and B"');
  } },
  { name: 'compareDelayedArrival', params: { delayH: 24 }, check: async (r, page) => {
    assert.equal(r.analysisA.state, 'ready');
    assert.equal(r.analysisB.state, 'ready');
    assert.equal(Date.parse(r.revisedArrivalUtc) - Date.parse(r.plannedArrivalUtc), 24 * 3_600_000);
    assert.equal((await store(page)).delayH, 0, 'the scenario on screen keeps its own delay');
    await shows(page, (s) => s.compare?.tab === 'A and B' && s.compare.text.includes(r.A) && s.compare.text.includes(r.B), 'the panel names both sides');
  } },
  { name: 'compareMastHeights', params: { heightBM: 10 }, check: async (r, page) => {
    assert.equal(r.mastHeightBM, 10);
    assert.equal((await store(page)).mastHeightM, 2, 'the mast on screen is not changed');
    await shows(page, (s) => s.compare?.text.includes(r.A) && s.compare.text.includes(r.B), 'the panel names both sides');
  } },
  { name: 'swapComparison', prepare: async (page) => {
    const s = await store(page);
    page.__beforeSwap = [s.compareA?.id, s.compareB?.id];
  }, check: async (r, page) => {
    const s = await store(page);
    assert.deepEqual([s.compareB?.id, s.compareA?.id], page.__beforeSwap);
  } },
  { name: 'saveComparison', params: { name: 'Control test' }, check: async (r, page) => {
    assert.equal(r.saved.name, 'Control test');
    await shows(page, (s) => s.compare?.loadButtons.includes('Control test'), 'the saved comparison is listed with its Load button');
  } },
  { name: 'listComparisons', check: async (r) => assert.ok(r.comparisons.some((c) => c.name === 'Control test'), JSON.stringify(r.comparisons)) },
  { name: 'loadComparison', params: { name: 'Control test' }, check: async (r, page) => {
    assert.equal(r.loaded, 'Control test');
    assert.equal(r.analysisA.state, 'ready');
    await shows(page, (s) => s.compare?.open === true && s.compare.tab === 'A and B', 'comparison open on "A and B"');
  } },
  { name: 'deleteComparison', params: { name: 'Control test' }, check: async (r, page) => {
    assert.equal(r.deleted, 'Control test');
    await shows(page, (s) => !s.compare?.loadButtons.includes('Control test'), 'the deleted comparison is gone from the list');
  } },
  { name: 'clearComparison', check: async (r, page) => {
    assert.deepEqual([r.A, r.B], [null, null]);
    const s = await store(page);
    assert.deepEqual([s.compareA, s.compareB], [null, null]);
  } },
  // ---- nearby alternatives (T-11): a south-polar pin in the 40 m layer, in shadow on the day of IM-2's landing
  { name: 'rankNearby', prepare: async (page) => {
    await run(page, 'dropPin', { lat: -88, lon: 136.7 });
    await run(page, 'setMissionWindow', { startUtc: IM2, durationH: 24, moveClock: true });
  }, check: async (r, page) => {
    assert.ok(r.reference && r.reference.isReference, JSON.stringify(r.reference));
    assert.ok(r.candidates.length > 0 && r.rankedCount >= r.candidates.length, `${r.candidates.length} rows of ${r.rankedCount}`);
    assert.equal(r.candidates[0].rank, 1);
    page.__nearby = r;
    await shows(page, (s) => s.compare?.open === true && s.compare.tab === 'Nearby sites', 'the panel shows its "Nearby sites" tab');
  } },
  { name: 'selectCandidate', params: { rank: 1 }, check: async (r, page) => {
    assert.equal(r.site.id, page.__nearby.candidates[0].id);
    assert.equal((await store(page)).site.id, r.site.id);
    // The card names the candidate as the result does (F-6, fixed in dbc6c59), with its coordinates (formatCoords: 3 decimals).
    const where = `${Math.abs(r.site.latDeg).toFixed(3)}° ${r.site.latDeg >= 0 ? 'N' : 'S'}, ${Math.abs(r.site.lonDegEast).toFixed(3)}° ${r.site.lonDegEast >= 0 ? 'E' : 'W'}`;
    await shows(page, (s) => s.card?.title === r.site.name && s.card.where.startsWith(where), `the card shows the chosen candidate "${r.site.name}" at ${where}`);
  } },
  { name: 'stopCompare', check: async (r, page) => {
    assert.equal((await store(page)).comparing, false);
    await shows(page, (s) => s.compare === null || s.compare.open === false, 'compare panel closed');
  } },
  // ---- pins and the surface view
  { name: 'dropPin', params: { lat: -88, lon: 136.7 }, check: async (r, page) => {
    assert.equal(r.site.kind, 'custom');
    await shows(page, (s) => s.card?.title === 'Pinned location' && s.card.where.startsWith('88.000° S, 136.700° E'), 'the card shows the pin and its coordinates');
  } },
  { name: 'enterSurface', prepare: async (page) => {
    await run(page, 'selectSite', { site: 'im-2', fly: false });
  }, check: async (r, page) => {
    assert.equal(r.view, 'surface');
    await shows(page, (s) => s.view === 'surface' && /Facing/.test(s.hud.status), 'surface view with its HUD');
  } },
  { name: 'lookAt', params: { azDeg: 90, elDeg: 5, fovDeg: 60 }, check: async (r, page) => {
    assert.deepEqual(r.look, { azDeg: 90, elDeg: 5, fovDeg: 60 });
    await shows(page, (s) => /^Facing E 90°, \+5°/.test(s.hud.status) && /field of view 60°/.test(s.hud.status), 'HUD facing east, +5°, 60° field of view');
  } },
  { name: 'setFieldOfView', params: { fovDeg: 30 }, check: async (r, page) => {
    assert.equal(r.look.fovDeg, 30);
    await shows(page, (s) => /field of view 30°/.test(s.hud.status), 'HUD field of view 30°');
  } },
  { name: 'lookAtBody', params: { body: 'earth' }, check: async (r, page) => {
    const look = (await store(page)).look;
    near(look.azDeg, r.azDeg, 0.06, 'look azimuth vs Earth azimuth');
    await shows(page, (s) => new RegExp(`^Facing \\w+ ${Math.round(r.azDeg) % 360}°`).test(s.hud.status), `HUD facing ${Math.round(r.azDeg)}°`);
  } },
  { name: 'walkTo', params: { eastM: 100, northM: 50 }, check: async (r, page) => {
    near(r.position.distanceFromSiteM, Math.hypot(100, 50), 0.6, 'distance from the site');
    await shows(page, (s) => /112 m from the site/.test(s.hud.status) && s.hud.homeShown === true, 'HUD 112 m from the site, "Return to site" shown');
  } },
  { name: 'setSkyAnnotations', params: { tracks: false, labels: false }, check: async (r, page) => {
    assert.equal(r.tracks, false);
    await shows(page, (s) => s.hud.pathsPressed === 'false', '"Sky paths" released');
  } },
  { name: 'setGeneratedDetail', params: { on: false }, check: async (r, page) => {
    assert.equal(r.generatedDetail, false);
    await shows(page, (s) => s.hud.generatedPressed === 'false' && /Generated detail is off/.test(s.hud.ground), '"Generated detail" released and the ground line says so');
  } },
  { name: 'getSurfaceView', check: async (r, page) => {
    assert.equal(r.active, true);
    assert.equal(r.site.id, 'im-2');
    near(r.position.eastM, 100, 0.6, 'east');
    near(r.position.northM, 50, 0.6, 'north');
    assert.equal(r.ground.generatedDetailShown, false);
    assert.equal(r.annotations.tracks, false);
    assert.ok(r.ground.bands.length > 0 && r.ground.bands[0].product, JSON.stringify(r.ground.bands[0]));
    await shows(page, (s) => s.hud.ground.includes(r.ground.summary), 'HUD ground line names the same data');
  } },
  // ---- the surface HUD (T-10)
  { name: 'showKeyMetrics', params: { open: false }, check: async (r, page) => {
    assert.equal(r.keyMetricsOpen, false);
    await shows(page, (s) => s.metrics?.bodyHidden === true && s.metrics.foldExpanded === 'false', 'key metrics folded');
    await run(page, 'showKeyMetrics', { open: true });
  } },
  { name: 'setChart', params: { expanded: true, mode: 'time' }, check: async (r, page) => {
    assert.deepEqual([r.chart, r.mode], ['expanded', 'time']);
    await shows(page, (s) => s.chart?.hidden === false && s.chart.size === 'expanded' && s.chart.mode === 'time', 'chart expanded, against time');
    await run(page, 'setChart', { expanded: false, mode: 'skyline' });
  } },
  { name: 'explainBlockage', params: { body: 'earth' }, check: async (r, page) => {
    assert.equal(r.body, 'earth');
    assert.equal(r.shownInHud, true);
    assert.ok(typeof r.explanation === 'string' && r.explanation.length > 20, r.explanation);
    await shows(page, (s) => s.chart?.explainShown === true && s.chart.explainText.includes(r.explanation), 'the explanation is on screen, in the same words');
  } },
  { name: 'dismissBlockageExplanation', check: async (r, page) => {
    assert.equal(r.explanationShown, false);
    await shows(page, (s) => s.chart?.explainShown === false, 'the explanation is closed');
  } },
  { name: 'exitSurface', check: async (r, page) => {
    assert.equal(r.view, 'globe');
    assert.equal(r.site.id, 'im-2');
    await shows(page, (s) => s.view === 'globe' && s.card?.title === 'IM-2 Athena', 'globe view with the site kept');
  } },
  { name: 'clearSite', check: async (r, page) => {
    assert.equal(r.site, null);
    await shows(page, (s) => s.card === null, 'site card closed');
  } },
  // ---- mission presets (T-22)
  { name: 'listPresets', check: async (r) => {
    assert.ok(r.presets.length >= 3, JSON.stringify(r.presets.map((p) => p.id)));
    assert.ok(r.presets.some((p) => p.id === 'eclipse-2025-03-14'));
  } },
  { name: 'loadPreset', params: { id: 'eclipse-2025-03-14', play: false }, check: async (r, page) => {
    assert.equal(r.site.id, 'blue-ghost-1');
    assert.equal(r.view, 'surface');
    assert.equal(r.playing, false);
    await shows(page, (s) => s.view === 'surface' && s.scrubber.date === r.timeUtc.slice(0, 16), 'surface view at the preset\'s clock');
    await run(page, 'exitSurface');
    await run(page, 'clearSite');
  } },
  // ---- the drawer itself (last: they change the drawer the test types into)
  { name: 'setAssistantOpen', params: { open: false }, check: async (r, page) => {
    assert.equal(r.assistantOpen, false);
    await shows(page, (s) => s.drawerOpen === false, 'drawer closed');
    await run(page, 'setAssistantOpen', { open: true });
    await shows(page, (s) => s.drawerOpen === true, 'drawer open again');
  } },
  { name: 'clearConversation', check: async (r, page) => {
    assert.equal(r.cleared, true);
    await until(page, () => window.lunyxAssistant.session.messages.length === 0 && !document.querySelector('.am'));
  } },
];

const caseNames = new Set(CASES.map((c) => c.name));

describe('control: what a model is given', () => {
  let app;
  before(async () => {
    app = await openApp(srv.scripted);
  }, SLOW);
  after(() => app?.close());

  test('the renderer is the one asked for', SLOW, async (t) => {
    const name = await renderer(app.page);
    t.diagnostic(`WebGL renderer: ${name}`);
    if (GPU) assert.doesNotMatch(name, /swiftshader|llvmpipe|software/i, 'E2E_GPU=1 but the page renders in software');
  });

  test('the tool list is the registry, every definition is complete, and the route accepts all of them', SLOW, async () => {
    const { page } = app;
    const [names, tools] = await Promise.all([registered(page), page.evaluate(() => window.lunyx.actions.toolDefinitions())]);
    assert.deepEqual(tools.map((t) => t.name).sort(), [...names].sort());
    const problems = [];
    for (const t of tools) {
      if (t.description.length < 40) problems.push(`${t.name}: description of ${t.description.length} characters`);
      const props = t.input_schema.properties;
      for (const r of t.input_schema.required ?? []) if (!(r in props)) problems.push(`${t.name}: required "${r}" is not a property`);
      for (const [k, p] of Object.entries(props)) {
        if (!p.description || p.description.length < 4) problems.push(`${t.name}.${k}: no description`);
        if (p.enum && !p.enum.length) problems.push(`${t.name}.${k}: empty enum`);
        if ((p.type === 'number' || p.type === 'integer') && (p.minimum === undefined || p.maximum === undefined) && !/(id|rank)$/i.test(k)) problems.push(`${t.name}.${k}: number without both bounds`);
      }
    }
    assert.deepEqual(problems, []);
    // The real route validates the whole list before any model is involved.
    const res = await fetch(`${srv.scripted}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'call getState' }], tools }) });
    assert.equal(res.status, 200, await res.clone().text());
    const events = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events.at(-1).type, 'done');
  });

  test('every registered action has a case below, a phrase in examples.json and a row in actions.md', SLOW, async () => {
    const names = await registered(app.page);
    assert.deepEqual(names.filter((n) => !caseNames.has(n)), [], 'actions without a control case in e2e/scenario/control.test.mjs');
    assert.deepEqual(names.filter((n) => !EXAMPLES.some((e) => e.action === n)), [], 'actions without a phrase in src/assistant/deterministic/examples.json');
    assert.deepEqual(names.filter((n) => !INVENTORY.includes(`\`${n}\``)), [], 'actions missing from the inventory, docs/lunyx/actions.md');
  });
});

describe('control: every action through the scripted model and the real route', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.scripted);
    page = app.page;
    if (!(await page.evaluate(() => window.lunyx.store.get().assistantOpen))) await page.locator('#assistant-button').click();
    await until(page, () => document.getElementById('assistant-drawer')?.classList.contains('is-open') && !document.querySelector('.ad-mode')?.textContent.includes('Checking'));
  }, SLOW);
  after(() => app?.close());

  for (const c of CASES) {
    test(`${c.name}${c.noControl ? ` (no control yet: ${c.noControl})` : ''}`, SLOW, async (t) => {
      if (!(await has(page, c.name))) {
        t.skip(`this build has no ${c.name} action`);
        return;
      }
      if (c.prepare) await c.prepare(page);
      const reply = await send(page, `call ${c.name}${c.params ? ` ${JSON.stringify(c.params)}` : ''}`);
      // clearConversation empties the drawer once the turn is over, reply included.
      const cleared = c.name === 'clearConversation';
      if (!cleared) assert.deepEqual(reply.source, { kind: 'model', label: SCRIPTED_LABEL, provider: 'scripted' });
      const entry = reply.entries.find((e) => e.name === c.name && e.origin === 'assistant');
      assert.ok(entry, `the model's call did not reach the registry: ${JSON.stringify(reply.entries.map((e) => e.name))}`);
      assert.ok(entry.ok, `${c.name} failed: ${entry.error}`);
      assert.deepEqual(entry.params, c.params ?? {});
      // The model's final answer quotes the result it was sent back.
      if (!cleared) assert.match(reply.text, new RegExp(`1\\. ${c.name}: \\{`));
      await c.check(entry.result, page);
    });
  }

  // F-5 in docs/lunyx/actions.md, fixed in the compare panel (src/ui/compare/panel.ts follows a
  // successful compare): after a scan, the side-by-side that compare reports is on screen.
  test('after a scan, compare shows the A/B tab', SLOW, async (t) => {
    if (!(await has(page, 'rankNearby'))) return t.skip('this build has no rankNearby');
    await run(page, 'dropPin', { lat: -88, lon: 136.7 });
    await run(page, 'setMissionWindow', { startUtc: IM2, durationH: 24, moveClock: true });
    assert.ok((await run(page, 'rankNearby')).ok);
    await run(page, 'saveScenario', { slot: 'A' });
    await run(page, 'selectCandidate', { rank: 1 });
    await run(page, 'saveScenario', { slot: 'B' });
    assert.ok((await run(page, 'compare')).ok);
    const s = await screen(page);
    await run(page, 'stopCompare');
    assert.equal(s.compare?.tab, 'A and B', `the panel shows "${s.compare?.tab}"`);
  });

  test('the page raised no errors', SLOW, async () => {
    assert.deepEqual(app.problems, []);
  });
});

describe('control: every action through deterministic mode, by its phrase', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.deterministic);
    page = app.page;
  }, SLOW);
  after(() => app?.close());

  /** A known starting point between examples, set through actions (origin "test"). */
  async function reset() {
    const steps = [
      ['setAssistantOpen', { open: true }], ['stopCompare'], ['clearComparison'], ['exitSurface'], ['clearSite'], ['pause'], ['setLightMode', { mode: 'real' }],
      ['setDelay', { hours: 0 }], ['setMissionWindow', { startUtc: IM2, durationH: 24, moveClock: true }], ['setMastHeight', { metres: 2 }], ['setSunBand', { minDeg: 0, maxDeg: 90 }],
      ['setOverlay', { mode: 'off' }], ['showMissions', { show: true }], ['setFilters', { reset: true }], ['setReliefExaggeration', { factor: 10 }], ['showCoverage', { show: false }],
      ['showIceTargets', { show: false }], ['setLocatorZoom', { zoom: 1 }], ['showPanel', { panel: 'site-details', open: true }],
    ];
    for (const [name, params] of steps) if (await has(page, name)) await run(page, name, params ?? {});
    await until(page, () => document.getElementById('assistant-drawer')?.classList.contains('is-open') && !document.querySelector('.ad-mode')?.textContent.includes('Checking'));
  }

  for (const ex of EXAMPLES) {
    test(`"${ex.say}" runs ${ex.action}`, SLOW, async (t) => {
      if (!(await has(page, ex.action))) {
        t.skip(`this build has no ${ex.action} action`);
        return;
      }
      await reset();
      for (const g of ex.given ?? []) {
        const r = await send(page, g);
        assert.ok(r.entries.every((e) => e.ok), `setup "${g}" failed: ${r.text}`);
      }
      const r = await send(page, ex.say);
      if (ex.action !== 'clearConversation') assert.equal(r.shownLabel, DETERMINISTIC_LABEL);
      const hit = r.entries.find((e) => e.name === ex.action && e.origin === 'assistant');
      assert.ok(hit, `"${ex.say}" ran ${JSON.stringify(r.entries.map((e) => e.name))}; reply: ${r.text}`);
      assert.ok(hit.ok, `${ex.action} failed: ${hit.error}; reply: ${r.text}`);
      // Only the assistant acted, and the drawer lists what it ran.
      assert.ok(r.entries.every((e) => e.origin === 'assistant'), JSON.stringify(r.entries.map((e) => [e.name, e.origin])));
      if (ex.action !== 'clearConversation' && ex.action !== 'setAssistantOpen') {
        const title = await page.evaluate((n) => window.lunyx.actions.getAction(n).title, ex.action);
        assert.ok(r.shownActions.includes(title), `the drawer lists ${JSON.stringify(r.shownActions)}, not "${title}"`);
      }
    });
  }

  test('the page raised no errors', SLOW, async () => {
    assert.deepEqual(app.problems, []);
  });
});
