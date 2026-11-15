// The judge's walkthrough of the built app on the desktop website (tasks T-2 and T-8; decision
// D-4: desktop only), at 1280x720 and 1920x1080, in three parts:
//
//   search     site search and comparison: open, type coordinates in Filters > Centre of view,
//              drop a pin, the pin's card against the analysis, search criteria (mission
//              window, slope and Earth-gap limits), save A, scan nearby sites with a typed
//              radius and spacing that must survive a change of the slope limit (Q-7, T-16),
//              a ranked alternative as B (or, in a build without the scan, B = A arriving 24 h
//              later), and the compare table against the analysis.
//   surface    IM-2 from its globe marker, looking around, its card and surface view at the
//              landing time, Track Earth / Track Sun / sky paths, the 29.5-day window, scrubbing
//              and event jumps, Escape; Apollo 11 at its landing time. On a GPU the surface is
//              drawn at full settings (the app picks low-power settings only for a software
//              renderer); the shots pair with the software-rendered ones in docs/lunyx/handover.
//   assistant  the drawer in deterministic mode: requests whose numbers are checked against
//              the analysis and the panels.
//   scenario   (T-8 item 3) the T-6 request in three follow-ups through the drawer, with the
//              panels open: reply, Nearby list, compare table, Key metrics and the explanation
//              against the actions' results and the analysis.
//   extras     (T-8) a mission preset played to its end, a zoomed Earth, the window table with
//              its CSV and JSON downloads against the analysis, the outlook, the Country filter,
//              country flags and territories, ownership rows and the explored area on the card.
//
// Every step is done through the real controls (mouse and keyboard) unless the build has no
// control for it; such steps say so and run through the action registry. Values on screen
// are read from the DOM and checked against the app's own analysis output.
//
//   flock /tmp/lunyx-heavy.lock node e2e/qa/walkthrough.mjs [--profiles 1280x720,1920x1080]
//        [--parts search,surface,assistant] [--profile-parts 1920x1080=surface] [--out <dir>] [--label <text>]
//
// Needs a built dist/ (npm run build). Starts its own preview servers with every model
// credential removed (deterministic assistant); the page may reach the network as a judge's
// browser would, and the report lists every host it contacted. E2E_GL=swiftshader forces
// software rendering. Writes <out>/report.json, <out>/log.txt, <out>/shots/<profile>/NN-<name>.jpg.
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask } from '../lib/app.mjs';
import { compareRowsAgainst, firstNumber, keyMetricsAgainst, requirementLinesAgainst } from '../lib/read.mjs';
import { PIN as SCENARIO_PIN, STEPS as SCENARIO_STEPS, WINDOW as SCENARIO_WINDOW } from '../scenario/setup.mjs';
import { ROOT, servers } from '../lib/servers.mjs';
import { analysisSettled, fps, GL, globeSettled, launch, makeStepper, mouseDrag, numbers, openPage, parseDurationH, PROFILES, rendering, shot, sleep, surfaceReady } from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const profiles = opt('profiles', Object.keys(PROFILES).join(',')).split(',');
const parts = new Set(opt('parts', 'search,surface,assistant').split(','));
// --profile-parts 1920x1080=surface;1280x720=search,surface: other parts for some profiles.
const profileParts = Object.fromEntries((opt('profile-parts', '') || '').split(';').filter(Boolean).map((x) => x.split('=')).map(([k, v]) => [k, new Set(v.split(','))]));
const partsFor = (profile) => profileParts[profile] ?? parts;
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();
const sha = git('rev-parse --short HEAD');
const out = opt('out', join(ROOT, 'e2e', 'qa', 'out', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${sha}`));
mkdirSync(out, { recursive: true });
const logFile = join(out, 'log.txt');
const log = (line) => {
  console.log(line);
  appendFileSync(logFile, `${line}\n`);
};

const IM2 = { id: 'im-2', name: 'IM-2 Athena', lat: -84.79, lon: 29.2, landingUtc: Date.UTC(2025, 2, 6, 17, 28) };
const APOLLO11 = { id: 'apollo-11', lat: 0.6741, lon: 23.4730, landingUtc: Date.UTC(1969, 6, 20, 20, 17) };
const PIN = { lat: -89.45, lon: -137.2, latText: '-89.45', lonText: '-137.2' };
const CRITERIA = { windowH: 168, slopeLimitDeg: 8, maxEarthGapH: 48 };
// The nearby scan as the operator checked Q-7: a typed radius and spacing, then the slope limit
// changed (to the detour value and back), which redraws the tab; the scan must cover what was typed.
const SCAN = { radiusM: 900, spacingM: 150, slopeDetourDeg: 10 };
const kmPerDeg = (1737.4 * Math.PI) / 180;

// ------------------------------------------------------------------ reading the app

const run = (page, name, params = {}) => page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'test'), [name, params]);
async function getAnalysis(page, slot = 'current') {
  const r = await run(page, 'getAnalysis', { slot });
  if (!r.ok) throw new Error(`getAnalysis failed: ${r.error}`);
  return r.result;
}
const appState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.lunyx.store.get())));
async function surfaceView(page) {
  const r = await run(page, 'getSurfaceView');
  if (!r.ok) throw new Error(`getSurfaceView failed: ${r.error}`);
  return r.result;
}
const hasAction = (page, name) => page.evaluate((n) => window.lunyx.actions.listActions().some((a) => a.name === n), name);

/** The site card as a person sees it: label -> text for each visible row. */
function readCard(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.site-card');
    if (!card || card.hidden) return null;
    const rows = (sel) => {
      const dl = card.querySelector(sel);
      if (!dl) return {};
      return Object.fromEntries([...dl.querySelectorAll('dt')].filter((dt) => !dt.hidden).map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim() ?? '']));
    };
    const r = card.getBoundingClientRect();
    return {
      title: card.querySelector('.sc-title')?.textContent.trim(),
      where: card.querySelector('.sc-where')?.textContent.trim(),
      folded: card.classList.contains('folded'),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      facts: rows('.sc-facts'),
      skyTitle: card.querySelector('.sc-sky')?.previousElementSibling?.textContent.trim(),
      sky: rows('.sc-sky'),
      skyNote: card.querySelector('.sc-skynote')?.textContent.trim(),
      winWhen: card.querySelector('.sc-winwhen')?.textContent.trim(),
      winStatus: card.querySelector('.sc-winstatus')?.textContent.trim(),
      window: rows('.sc-window'),
    };
  });
}

/** The time scrubber's labels, marks and jump buttons. */
function readScrubber(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.time-scrubber');
    return {
      scale: [...bar.querySelectorAll('.ts-scale span')].map((s) => s.textContent.trim()),
      outside: bar.classList.contains('outside'),
      marks: [...bar.querySelectorAll('.ts-mark')].map((m) => m.title),
      jumpsShown: !bar.querySelector('.ts-jumps')?.hidden,
      jumps: [...bar.querySelectorAll('.ts-jump')].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled, label: b.getAttribute('aria-label') })),
      startHereShown: [...bar.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start window here' && !b.hidden),
    };
  });
}

/** The compare panel as a person sees it: the table rows by label, the sentences and the requirement lines. */
function readCompare(page) {
  return page.evaluate(() => {
    const sheet = document.querySelector('.cmp-sheet');
    if (!sheet || sheet.hidden) return { open: false };
    const table = sheet.querySelector('[role="table"][aria-label^="Scenarios A and B"]');
    const rows = {};
    for (const tr of table?.querySelectorAll('.cmp-row:not(.cmp-headrow):not(.cmp-grouprow)') ?? []) {
      const [th, a, b, d] = [...tr.children];
      rows[th.textContent.trim()] = { a: a?.textContent.trim(), b: b?.textContent.trim(), delta: d?.firstChild?.textContent?.trim() ?? '', tone: [...(d?.classList ?? [])].find((c) => c.startsWith('tone-')) };
    }
    const heads = [...(table?.querySelectorAll('.cmp-headrow .cmp-side') ?? [])].map((h) => h.textContent.trim().replace(/\s+/g, ' '));
    return {
      open: true,
      tabs: [...sheet.querySelectorAll('.cmp-tab')].map((t) => ({ text: t.textContent.trim(), selected: t.getAttribute('aria-selected') })),
      heads,
      rows,
      state: sheet.querySelector('.cmp-state')?.textContent.trim(),
      highlights: [...sheet.querySelectorAll('.cmp-highlights li')].map((li) => li.textContent.trim()),
      flags: [...sheet.querySelectorAll('.cmp-flags li')].map((li) => li.textContent.trim()),
      status: [...sheet.querySelectorAll('.cmp-status')].map((s) => s.textContent.trim()).filter(Boolean),
    };
  });
}

/** The ranked list of the "Nearby sites" tab (a build with the T-11 slice 2 panel). */
function readNearby(page) {
  return page.evaluate(() => {
    const table = document.querySelector('[role="table"][aria-label="Ranked nearby alternatives"]');
    if (!table) return null;
    const rows = [...table.querySelectorAll('.cmp-nrow:not(.cmp-nhead)')].map((tr) => Object.fromEntries([...tr.children].map((c) => [c.dataset.label, c.textContent.trim().replace(/\s+/g, ' ')])));
    return { summary: document.querySelector('.cmp-nearbysummary')?.textContent.trim(), rows };
  });
}

/** The surface "Key metrics" panel as a person sees it. */
function readKeyMetrics(page) {
  return page.evaluate(() => {
    const p = document.querySelector('.km');
    if (!p) return null;
    const now = {};
    for (const tr of p.querySelectorAll('.km-now tbody tr:not(.km-state)')) {
      if (tr.hidden) continue;
      const [az, el, clear] = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
      now[tr.querySelector('th')?.textContent.trim()] = { az, el, clear };
    }
    return {
      open: !p.querySelector('.km-body')?.hidden,
      site: p.querySelector('.km-site')?.textContent.trim(),
      source: p.querySelector('.km-source')?.textContent.trim(),
      nowTitle: [...p.querySelectorAll('.km-body h3')].map((h) => h.textContent.trim()),
      now,
      states: [...p.querySelectorAll('.km-now tr.km-state')].filter((t) => !t.hidden).map((t) => t.textContent.trim().replace(/\s+/g, ' ')),
      counts: [...p.querySelectorAll('.km-count li')].map((li) => ({ label: li.querySelector('.km-count-label')?.textContent.trim(), when: li.querySelector('.km-count-in')?.textContent.trim(), at: li.querySelector('.km-count-at')?.textContent.trim(), disabled: li.querySelector('button')?.disabled })),
      win: Object.fromEntries([...p.querySelectorAll('.km-win dt')].map((dt) => [dt.textContent.trim(), dt.nextElementSibling?.textContent.trim()])),
      flags: [...p.querySelectorAll('.km-flags li')].map((li) => li.textContent.trim()),
      warnings: [...p.querySelectorAll('.km-warnings li')].map((li) => li.textContent.trim()),
    };
  });
}

/** The skyline chart's data table (its "Table" view) and the analysis series it is drawn from. */
function readChartTable(page) {
  return page.evaluate(() => {
    const t = document.querySelector('.skc-data');
    const st = window.lunyx.analysis.get('current');
    if (!t || st.state !== 'ready') return null;
    const s = st.value.series;
    const rows = [...t.querySelectorAll('tbody tr')].slice(0, 400).map((tr) => [tr.querySelector('th').textContent.trim(), ...[...tr.querySelectorAll('td')].map((td) => td.textContent.trim())]);
    const parse = (text) => Date.parse(`${text.replace(' ', 'T')}:00Z`);
    const pick = [0, Math.floor(rows.length / 2), rows.length - 1].filter((k, i, a) => k >= 0 && a.indexOf(k) === i);
    return {
      caption: t.querySelector('caption')?.textContent.trim(),
      count: rows.length,
      samples: pick.map((k) => {
        const r = rows[k];
        const ms = parse(r[0]);
        const i = Math.round((ms - s.startMs) / s.stepMs);
        const exact = i >= 0 && i < s.n && s.startMs + i * s.stepMs === ms;
        return { row: r, index: i, exact, series: exact ? { sunAz: s.sunAz[i], sunEl: s.sunEl[i], sunClearance: s.sunClearance[i], earthAz: s.earthAz[i], earthEl: s.earthEl[i], earthClearance: s.earthClearance[i] } : null };
      }),
    };
  });
}

const fmtUtc = (ms) => `${new Date(ms).toISOString().slice(0, 10)} ${new Date(ms).toISOString().slice(11, 16)} UTC`;
const close = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;
const durTol = (h) => (h >= 24 ? 0.051 : h < 0.05 ? 0.05 : 0.051);
/** "18.2 h", "379.8 h (15.8 d)", "none", "18.2 h or more" -> hours. */
/** As the assistant writes hours: "none" below 0.05 h, else one decimal and "h". */
const hoursText = (h) => (h < 0.05 ? 'none' : `${h.toFixed(1)} h`);
const hoursOf = (text) => (/^none\b/.test(text ?? '') ? 0 : firstNumber(text ?? ''));

/** One body on the card, "2.5° elevation, azimuth 66°; 1.2° above the skyline", as numbers. */
function parseBody(text) {
  const [el, az, clear] = numbers(text);
  const below = /below the skyline/.test(text);
  return { elDeg: el, azDeg: az, clearanceDeg: clear === undefined ? NaN : below ? -Math.abs(clear) : clear };
}

/** Card values against getAnalysis for the same scenario and instant. */
function checkCard(check, card, a, st) {
  const m = a.metrics;
  const tolH = (h) => (h >= 24 ? 0.51 : h < 0.05 ? 0.05 : 0.02);
  check('Card: sky heading time = simulated time', card.skyTitle, `Sky at ${fmtUtc(st.timeMs)}`, card.skyTitle === `Sky at ${fmtUtc(st.timeMs)}`);
  check('Card: Sunlight % vs metrics.illuminationPct', card.window.Sunlight, m.illuminationPct, close(firstNumber(card.window.Sunlight), m.illuminationPct, 0.051));
  check('Card: Longest darkness vs metrics.longestDarknessH', card.window['Longest darkness'], m.longestDarknessH, close(parseDurationH(card.window['Longest darkness'] ?? ''), m.longestDarknessH, tolH(m.longestDarknessH)));
  const earthIn = card.window["Earth's centre in view"] ?? card.window['Earth in view'];
  const earthGap = card.window["Longest gap, Earth's centre"] ?? card.window['Longest Earth gap'];
  check("Card: Earth's centre in view % vs metrics.earthVisiblePct", earthIn, m.earthVisiblePct, close(firstNumber(earthIn), m.earthVisiblePct, 0.051));
  if (card.window['Any part of Earth in view'] && Number.isFinite(m.earthAnyPct)) check('Card: any part of Earth in view % vs metrics.earthAnyPct', card.window['Any part of Earth in view'], m.earthAnyPct, close(firstNumber(card.window['Any part of Earth in view']), m.earthAnyPct, 0.051));
  check("Card: longest gap, Earth's centre vs metrics.longestEarthGapH", earthGap, m.longestEarthGapH, close(parseDurationH(earthGap ?? ''), m.longestEarthGapH, tolH(m.longestEarthGapH)));
  check('Card: Slope vs slope.slopeDeg', card.window.Slope, a.slope.slopeDeg, close(firstNumber(card.window.Slope), a.slope.slopeDeg, 0.051));
  for (const [key, body] of [['Sun', 'sun'], ['Earth', 'earth']]) {
    const shown = parseBody(card.sky[key] ?? '');
    const now = a.now[body];
    check(`Card: ${key} elevation vs now.${body}.elDeg`, card.sky[key], now.elDeg, close(shown.elDeg, now.elDeg, 0.051));
    check(`Card: ${key} azimuth vs now.${body}.azDeg`, card.sky[key], now.azDeg, close(shown.azDeg, now.azDeg, 0.51) || close(shown.azDeg, now.azDeg - 360, 0.51) || close(shown.azDeg, now.azDeg + 360, 0.51));
    check(`Card: ${key} clearance vs now.${body}.clearanceDeg`, card.sky[key], now.clearanceDeg, close(shown.clearanceDeg, now.clearanceDeg, 0.051));
  }
  check('Card: site elevation vs siteElevationM', card.facts.Elevation, a.siteElevationM, close(firstNumber(card.facts.Elevation ?? ''), a.siteElevationM, 1.01), { note: 'card samples the finest elevation product at the point; the analysis reports the elevation it used' });
}

/** The compare table's figures and the requirement lines, checked with the shared readers (e2e/lib/read.mjs). */
function checkCompareTable(check, view, pub) {
  for (const r of compareRowsAgainst(view, pub)) check(r.what, r.shown, r.expected, r.pass);
}

function checkRequirements(check, view, pub, st) {
  for (const r of requirementLinesAgainst(view, pub, { slopeLimitDeg: st.slopeLimitDeg, maxEarthGapH: st.maxEarthGapH })) check(r.what, r.shown, r.expected, r.pass);
}

async function markerPoint(page, id) {
  return page.evaluate((siteId) => {
    const g = window.lunyx.scene.globe;
    const m = g.markers.items.find((x) => x.landing.id === siteId);
    if (!m) return { found: false };
    if (!m.group.visible) return { found: true, visible: false };
    const v = m.group.position.clone().project(g.camera);
    const r = g.canvas.getBoundingClientRect();
    const x = r.left + (v.x * 0.5 + 0.5) * r.width;
    const y = r.top + (-v.y * 0.5 + 0.5) * r.height;
    const inView = v.z < 1 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const top = inView ? document.elementFromPoint(x, y) : null;
    // Other landings drawn within 30 px: a click there may pick one of them (they cycle on slower clicks).
    const near = g.markers.items
      .filter((o) => o !== m && o.group.visible)
      .map((o) => {
        const w = o.group.position.clone().project(g.camera);
        return { id: o.landing.id, d: w.z < 1 ? Math.hypot(r.left + (w.x * 0.5 + 0.5) * r.width - x, r.top + (-w.y * 0.5 + 0.5) * r.height - y) : Infinity };
      })
      .filter((o) => o.d < 30)
      .map((o) => o.id);
    return { found: true, visible: inView, x: Math.round(x), y: Math.round(y), covered: Boolean(top && top !== g.canvas), coveredBy: top && top !== g.canvas ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}` : null, near };
  }, id);
}

/**
 * The surface strip since GitHub PR #4 is one compact row: Track Sun, Track Earth and two
 * disclosures, "Surface options" (Sky paths, Generated detail, Skyline chart, Return to site) and
 * "About" (the status, ground and owner lines). They open from their summary and close on Escape,
 * an outside click or the focus leaving. Opens one as a person would; false on builds without it,
 * where everything is on the strip.
 */
async function openHudMenu(page, label) {
  const menu = page.locator('.surface-hud details.sh-menu').filter({ has: page.locator('summary', { hasText: label }) });
  if (!(await menu.count())) return false;
  if (!(await menu.evaluate((d) => d.open))) await menu.locator('summary').click();
  await page.waitForFunction((l) => [...document.querySelectorAll('.surface-hud details.sh-menu')].some((d) => d.open && d.querySelector('summary')?.textContent.trim() === l), label, { timeout: 5000 });
  return true;
}

/** Closes a strip disclosure with Escape from its summary. Never pressed when it is closed: Escape would then leave the view. */
async function closeHudMenu(page, label) {
  const menu = page.locator('.surface-hud details.sh-menu').filter({ has: page.locator('summary', { hasText: label }) });
  if (!(await menu.count()) || !(await menu.evaluate((d) => d.open))) return;
  await menu.locator('summary').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction((l) => ![...document.querySelectorAll('.surface-hud details.sh-menu')].some((d) => d.open && d.querySelector('summary')?.textContent.trim() === l), label, { timeout: 5000 });
}

/**
 * Turns the surface view to the Sun or Earth from the HUD. Since GitHub PR #2 the HUD has toggles,
 * "Track Sun" and "Track Earth": pressed, the view turns to the body and follows it as the clock
 * moves; pressed again, it stops. Earlier builds had one-off "Face Sun" / "Face Earth" buttons.
 * A toggle that is already on is left on. Returns which kind the build has.
 */
async function faceBody(page, body) {
  const hud = page.locator('.surface-hud');
  const track = hud.getByRole('button', { name: `Track ${body}`, exact: true });
  if (await track.count()) {
    if ((await track.getAttribute('aria-pressed')) !== 'true') await track.click();
    await page.waitForFunction((b) => [...document.querySelectorAll('.surface-hud button')].some((x) => x.textContent.trim() === `Track ${b}` && x.getAttribute('aria-pressed') === 'true'), body, { timeout: 10_000 });
    return 'track';
  }
  await hud.getByRole('button', { name: `Face ${body}`, exact: true }).click();
  return 'face';
}

/**
 * Opens a landing's surface view from its globe marker. Since the original T-64 a click selects
 * the landing and shows its details on the card while the view stays on the globe, and a
 * double-click opens the surface view. Earlier builds stepped straight down on a click. Both are
 * handled; the step's notes say which one this build does.
 */
async function openFromMarker(page, id, p, { check, note }) {
  // Overlapping landings (Apollo 11 and Surveyor 5 from far out) take turns on slower clicks; since
  // @globe's aaeada2 (Q-9) a double-click still opens the landing whose details are shown.
  if (p.near?.length) note(`Landings drawn next to it: ${p.near.join(', ')} (overlapping markers).`);
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction((siteId) => window.lunyx.store.get().site?.id === siteId, id, { timeout: 20_000 });
  await sleep(1200);
  if ((await appState(page)).view === 'surface') {
    note('A single marker click selected the landing and stepped straight down into its surface view (a build before the original T-64).');
    return;
  }
  const card = await page.evaluate(() => ({ title: document.querySelector('.site-card .sc-title')?.textContent.trim() ?? '', body: Boolean(document.querySelector('.site-card .sc-body')?.getClientRects().length) }));
  const view = (await appState(page)).view;
  check("A marker click shows the landing's details (card open, view stays on the globe)", `${card.title}, details ${card.body ? 'shown' : 'hidden'}, view ${view}`, 'details shown, globe', card.body && view === 'globe');
  // The camera may have moved to the selection: find the marker again.
  const q = await markerPoint(page, id);
  if (!q.visible || q.covered) throw new Error(`Marker not clickable after the click: ${JSON.stringify(q)}`);
  await page.mouse.dblclick(q.x, q.y);
  await page.waitForFunction(() => window.lunyx.store.get().view === 'surface', null, { timeout: 20_000 });
  const opened = (await appState(page)).site?.id;
  check('The double-click opened the landing whose details were shown', opened, id, opened === id, { finding: 'Q-9' });
  if (opened !== id) throw new Error(`The double-click opened ${opened}, not ${id}`);
  note('A click showed the details on the globe; a double-click opened the surface view (original T-64).');
}

/** Types into a number field at a human pace. */
async function typeInto(locator, text) {
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 70 });
}

/** Filters > Centre of view, the careful way: latitude + Enter, wait; longitude + Enter, wait. */
async function typeCentre(page, latText, lonText) {
  const lat = page.getByLabel('Latitude', { exact: true });
  const lon = page.getByLabel('Longitude', { exact: true });
  await typeInto(lat, latText);
  await lat.press('Enter');
  await globeSettled(page);
  const afterLat = await page.evaluate(() => window.lunyx.store.get().globeCenter);
  await typeInto(lon, lonText);
  await lon.press('Enter');
  await globeSettled(page);
  const c = await page.evaluate(() => window.lunyx.store.get().globeCenter);
  return { afterLat, centre: c, fields: { lat: await lat.inputValue(), lon: await lon.inputValue() } };
}

async function openComparePanel(page) {
  const open = await page.evaluate(() => !document.querySelector('.cmp-sheet')?.hidden);
  if (!open) {
    await page.locator('.cmp-launcher').click();
    await page.waitForFunction(() => !document.querySelector('.cmp-sheet')?.hidden, null, { timeout: 10_000 });
  }
}

async function comparisonSettled(page, timeout = 300_000) {
  await page.waitForFunction(() => ['ready', 'error'].includes(window.lunyx.analysis.comparison().state), null, { polling: 250, timeout });
  return page.evaluate(() => {
    const c = window.lunyx.analysis.comparison();
    return c.state === 'ready' ? JSON.parse(JSON.stringify({ state: c.state, a: { metrics: c.a.metrics, slope: c.a.slope, horizon: { siteElevationM: c.a.horizon.siteElevationM } }, b: { metrics: c.b.metrics, slope: c.b.slope, horizon: { siteElevationM: c.b.horizon.siteElevationM } } })) : { state: c.state, error: c.error };
  });
}

const canvasCentre = (app) => ({ x: PROFILES[app.profile].viewport.width / 2, y: PROFILES[app.profile].viewport.height / 2 });

// ------------------------------------------------------------------ part 1: site search and comparison

async function partSearch(app, step) {
  const { page } = app;

  await step('Type the coordinates in Filters > Centre of view (latitude + Enter, wait; longitude + Enter, wait)', 'keyboard', async ({ check, note }) => {
    const r = await typeCentre(page, PIN.latText, PIN.lonText);
    note(`After the latitude: centre ${r.afterLat.lat.toFixed(4)}, ${r.afterLat.lon.toFixed(4)}. Fields now ${r.fields.lat}, ${r.fields.lon}.`);
    check('Globe centre latitude = typed latitude', `${r.centre.lat.toFixed(4)} (field shows ${r.fields.lat})`, PIN.lat, close(r.centre.lat, PIN.lat, 0.005), { finding: 'F-3' });
    check('Globe centre longitude = typed longitude', `${r.centre.lon.toFixed(4)} (field shows ${r.fields.lon})`, PIN.lon, close(r.centre.lon, PIN.lon, 0.005));
    note('The natural order (latitude, Tab, longitude, Enter) and pressing the pin button right after typing are covered by e2e/qa/repro-centre.mjs (findings Q-1, Q-2).');
  });

  await step('Drop pin at centre (button)', 'control', async ({ check, note }) => {
    await page.getByRole('button', { name: 'Drop pin at centre' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().site?.kind === 'custom', null, { timeout: 15_000 });
    const s = await appState(page);
    const offKm = Math.hypot((s.site.lat - PIN.lat) * kmPerDeg, (s.site.lon - PIN.lon) * kmPerDeg * Math.cos((PIN.lat * Math.PI) / 180));
    check('Pin latitude = typed latitude', s.site.lat, PIN.lat, close(s.site.lat, PIN.lat, 0.00001), { finding: 'F-3' });
    check('Pin longitude = typed longitude', s.site.lon, PIN.lon, close(s.site.lon, PIN.lon, 0.00001));
    note(`Pin ${s.site.id}: ${(offKm * 1000).toFixed(0)} m from the typed point.`);
    app.report.pin = { typed: PIN, pin: { lat: s.site.lat, lon: s.site.lon, id: s.site.id }, offM: Math.round(offKm * 1000) };
  });

  await step('Pin: site card values against the analysis', 'control', async ({ check, note }) => {
    await analysisSettled(page);
    // The card loads the terrain under the pin itself, a moment after the analysis.
    await page.waitForFunction(() => [...document.querySelectorAll('.site-card .sc-facts dt')].some((dt) => dt.textContent.trim() === 'Elevation' && /\d m/.test(dt.nextElementSibling?.textContent ?? '')), null, { timeout: 30_000 }).catch(() => note('The card still said "Loading…" for the elevation after 30 s.'));
    const [card, a, st] = [await readCard(page), await getAnalysis(page), await appState(page)];
    const finest = a.provenance?.elevationData?.[0];
    if (finest) check('Card: elevation data = the finest grid the analysis used (T-40 family when not)', card.facts['Elevation data'], finest.name, Boolean(card.facts['Elevation data']?.includes(`${finest.resolutionM} m grid`)));
    app.report.values.push({ profile: app.profile, where: 'pin card', card, analysis: { metrics: a.metrics, slope: a.slope, now: a.now, siteElevationM: a.siteElevationM, provenance: a.provenance?.elevationData } });
    note(`Card: ${card.title} ${card.where}; window "${card.winWhen}"; status "${card.winStatus}".`);
    check('Analysis state', a.state, 'ready', a.state === 'ready');
    if (a.state === 'ready') checkCard(check, card, a, st);
  }, { shot: 'pin-card' });

  await step(`Search criteria: mission window 7 days (Filters), then slope at most ${CRITERIA.slopeLimitDeg}° and Earth gap at most ${CRITERIA.maxEarthGapH} h (compare panel requirements)`, 'control', async ({ check, note }) => {
    await page.getByLabel('Mission window', { exact: true }).selectOption(String(CRITERIA.windowH));
    await page.waitForFunction((h) => window.lunyx.store.get().windowDurationH === h, CRITERIA.windowH, { timeout: 10_000 });
    await openComparePanel(page);
    const req = page.getByRole('group', { name: 'Requirements the two scenarios are checked against' });
    const slope = req.getByLabel('Slope at most');
    await typeInto(slope, String(CRITERIA.slopeLimitDeg));
    await slope.press('Enter');
    const gap = req.getByLabel('Earth gap at most');
    await typeInto(gap, String(CRITERIA.maxEarthGapH));
    await gap.press('Tab');
    await page.waitForFunction(([s, g]) => window.lunyx.store.get().slopeLimitDeg === s && window.lunyx.store.get().maxEarthGapH === g, [CRITERIA.slopeLimitDeg, CRITERIA.maxEarthGapH], { timeout: 10_000 });
    const st = await appState(page);
    check('Mission window in the store', st.windowDurationH, CRITERIA.windowH, st.windowDurationH === CRITERIA.windowH);
    check('Slope limit in the store', st.slopeLimitDeg, CRITERIA.slopeLimitDeg, st.slopeLimitDeg === CRITERIA.slopeLimitDeg);
    check('Earth-gap limit in the store', st.maxEarthGapH, CRITERIA.maxEarthGapH, st.maxEarthGapH === CRITERIA.maxEarthGapH);
    note(`Sun band ${st.sunElMinDeg}° to ${st.sunElMaxDeg}°, mast ${st.mastHeightM} m, delay ${st.delayH} h.`);
  });

  await step('Save the scenario on screen as A (compare panel button)', 'control', async ({ check, note }) => {
    await analysisSettled(page);
    await page.getByRole('button', { name: 'Save the scenario on screen as A' }).click();
    await page.waitForFunction(() => Boolean(window.lunyx.store.get().compareA), null, { timeout: 10_000 });
    const st = await appState(page);
    check('Slot A = the pin over the 7-day window', `${st.compareA.site.id}, ${st.compareA.durationH} h`, `${app.report.pin?.pin.id}, ${CRITERIA.windowH} h`, st.compareA.site.id === app.report.pin?.pin.id && st.compareA.durationH === CRITERIA.windowH);
    note(`A: ${st.compareA.label}`);
  });

  const canScan = await hasAction(page, 'rankNearby');
  app.report.build.scan = canScan;
  if (canScan) {
    await step(`Scan nearby sites (Nearby sites tab): type Radius ${SCAN.radiusM} m and Spacing ${SCAN.spacingM} m, change "Slope at most" to ${SCAN.slopeDetourDeg}° and back to ${CRITERIA.slopeLimitDeg}°, then scan (Q-7)`, 'control', async ({ check, note }) => {
      await page.getByRole('tab', { name: 'Nearby sites' }).click();
      const scan = page.getByRole('button', { name: 'Scan nearby sites' });
      await scan.waitFor({ state: 'visible', timeout: 10_000 });
      const group = page.getByRole('group', { name: 'Scan settings' });
      const [radius, spacing, slope] = [group.getByLabel('Radius'), group.getByLabel('Spacing'), group.getByLabel('Slope at most')];
      const settingsNow = () => page.evaluate(() => [...document.querySelectorAll('[aria-label="Scan settings"] input')].map((i) => `${i.labels?.[0]?.textContent.trim()}=${i.value}`).join(', '));
      note(`Scan settings before: ${await settingsNow()}.`);
      // Typed, then left with Tab (Enter in these fields starts the scan).
      await typeInto(radius, String(SCAN.radiusM));
      await radius.press('Tab');
      await typeInto(spacing, String(SCAN.spacingM));
      await spacing.press('Tab');
      // Each change of the slope limit redraws the tab, which used to put the last scan's radius and spacing back (Q-7).
      for (const v of [SCAN.slopeDetourDeg, CRITERIA.slopeLimitDeg]) {
        await typeInto(slope, String(v));
        await slope.press('Tab');
        await page.waitForFunction((x) => window.lunyx.store.get().slopeLimitDeg === x, v, { timeout: 10_000 });
      }
      const kept = [await radius.inputValue(), await spacing.inputValue()];
      check('Radius keeps the typed value after the slope limit changed twice', kept[0], String(SCAN.radiusM), kept[0] === String(SCAN.radiusM), { finding: 'Q-7' });
      check('Spacing keeps the typed value after the slope limit changed twice', kept[1], String(SCAN.spacingM), kept[1] === String(SCAN.spacingM), { finding: 'Q-7' });
      note(`Scan settings at the scan: ${await settingsNow()}.`);
      const t0 = Date.now();
      await scan.click();
      await page.waitForFunction(() => ['ready', 'error'].includes(window.lunyx.analysis.nearby().state), null, { polling: 250, timeout: 600_000 });
      note(`Scan took ${Date.now() - t0} ms.`);
      const st = await page.evaluate(() => {
        const n = window.lunyx.analysis.nearby();
        return n.state === 'ready' ? JSON.parse(JSON.stringify({ state: n.state, options: n.options, value: n.value.map((c) => ({ id: c.site.id, ref: c.isReference, lat: c.site.lat, lon: c.site.lon, slope: c.slope.slopeDeg, sun: c.metrics?.illuminationPct, earth: c.metrics?.earthVisiblePct, dark: c.metrics?.longestDarknessH, gap: c.metrics?.longestEarthGapH, score: c.score, rejected: c.rejected ?? null })) })) : { state: n.state, error: n.error };
      });
      check('Scan finished', st.state, 'ready', st.state === 'ready');
      const view = await readNearby(page);
      app.report.values.push({ profile: app.profile, where: 'nearby scan', nearby: st, table: view });
      note(`Summary: ${view?.summary}`);
      const grid = `${SCAN.radiusM} / ${SCAN.spacingM} / ${CRITERIA.slopeLimitDeg}`;
      check('The scan ran on the typed grid (options radius / spacing / slope limit)', `${st.options?.radiusM} / ${st.options?.spacingM} / ${st.options?.slopeLimitDeg}`, grid, `${st.options?.radiusM} / ${st.options?.spacingM} / ${st.options?.slopeLimitDeg}` === grid, { finding: 'Q-7' });
      const says = `within ${SCAN.radiusM} m, every ${SCAN.spacingM} m, slope at most ${CRITERIA.slopeLimitDeg}°`;
      check('The summary names the typed grid', view?.summary, says, Boolean(view?.summary?.includes(says)), { finding: 'Q-7' });
      const after = [await radius.inputValue(), await spacing.inputValue()];
      check('After the scan the fields show the grid it covered', after.join(' / '), `${SCAN.radiusM} / ${SCAN.spacingM}`, after.join(' / ') === `${SCAN.radiusM} / ${SCAN.spacingM}`);
      const ranked = (st.value ?? []).filter((c) => !c.ref && Number.isFinite(c.score) && c.slope <= CRITERIA.slopeLimitDeg).sort((a, b) => b.score - a.score);
      const first = view?.rows.find((r) => r.Rank === '1');
      if (first && ranked[0]) {
        check('Rank 1 score = best score of the scan', first.Score, ranked[0].score, close(firstNumber(first.Score), ranked[0].score, 0.051));
        check('Rank 1 sunlight = scan value', first.Sunlight, ranked[0].sun, close(firstNumber(first.Sunlight), ranked[0].sun, 0.051));
        check("Rank 1 Earth's centre in view = scan value", first["Earth's centre in view"], ranked[0].earth, close(firstNumber(first["Earth's centre in view"]), ranked[0].earth, 0.051));
        check('Rank 1 slope within the limit', first.Slope, `<= ${CRITERIA.slopeLimitDeg}°`, firstNumber(first.Slope) <= CRITERIA.slopeLimitDeg + 0.05);
      } else check('A ranked alternative is listed', JSON.stringify(view?.rows?.slice(0, 2)), 'rank 1', false);
    }, { shot: 'nearby-ranked', timeout: 660_000 });

    await step('Compare the rank 1 alternative as B ("Compare as B" in its row)', 'control', async ({ check, note }) => {
      await page.getByRole('button', { name: /^Pin candidate 1, .* and load it as scenario B$/ }).click();
      const pub = await comparisonSettled(page);
      await sleep(300);
      const focus = await page.evaluate(() => {
        const el = document.activeElement;
        return { inDialog: Boolean(el && document.querySelector('.cmp-sheet')?.contains(el)), what: el === document.body ? 'body' : `${el?.tagName.toLowerCase()} "${(el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 60)}"`, tab: document.querySelector('.cmp-tab[aria-selected="true"]')?.textContent.trim() };
      });
      check('Focus stays in the compare dialog after "Compare as B"', `${focus.what} (tab now "${focus.tab}")`, 'inside the dialog', focus.inDialog, { finding: 'Q-4' });
      check('Comparison ready', pub.state, 'ready', pub.state === 'ready');
      await page.waitForFunction(() => !document.querySelector('.cmp-sheet')?.hidden, null, { timeout: 10_000 });
      await sleep(500);
      const view = await readCompare(page);
      const st = await appState(page);
      app.report.values.push({ profile: app.profile, where: 'compare: pin A, rank-1 alternative B', panel: view, published: pub });
      note(`Heads: ${view.heads?.join(' | ')}. ${view.state ?? ''}`);
      check('B is the pinned candidate (site on screen)', `${st.compareB?.site.id} / ${st.site?.id}`, 'same', st.compareB?.site.id === st.site?.id);
      if (pub.state === 'ready') {
        checkCompareTable(check, view, pub);
        checkRequirements(check, view, pub, st);
      }
    }, { shot: 'compare-candidate-as-b', timeout: 360_000 });
  } else {
    await step('Scan nearby sites: look for the control', 'control', async ({ check, note }) => {
      const control = await page.evaluate(() => [...document.querySelectorAll('button, [role="tab"]')].map((b) => b.textContent.trim()).filter((t) => /nearby|scan|alternative/i.test(t)));
      check('A nearby-scan control is on screen', control.join(', ') || 'none', '"Scan nearby sites"', control.length > 0);
      check('A rankNearby action is registered', 'no', 'rankNearby', false);
      note('Not in this build: the nearby-alternatives panel (rankNearby, selectCandidate) is T-11 slice 2, committed on am/lunyx/agent/analysis and not yet in am/lunyx/integration.');
    });

    await step('B = A arriving 24 h later ("B arrives later than A by" 24 h, "Compare arrivals")', 'control', async ({ check, note }) => {
      const field = page.getByLabel('B arrives later than A by');
      await typeInto(field, '24');
      await page.getByRole('button', { name: 'Compare arrivals' }).click();
      const pub = await comparisonSettled(page);
      check('Comparison ready', pub.state, 'ready', pub.state === 'ready');
      await sleep(500);
      const view = await readCompare(page);
      const st = await appState(page);
      app.report.values.push({ profile: app.profile, where: 'compare: pin A, pin +24 h B', panel: view, published: pub });
      note(`Heads: ${view.heads?.join(' | ')}. Status: ${view.status?.join(' / ')}`);
      check('B starts 24 h after A', `${new Date(st.compareB?.startMs).toISOString()} vs ${new Date(st.compareA?.startMs).toISOString()}`, '+24 h', st.compareB?.startMs - st.compareA?.startMs === 24 * 3_600_000);
      if (pub.state === 'ready') {
        checkCompareTable(check, view, pub);
        checkRequirements(check, view, pub, st);
      }
    }, { shot: 'compare-delay24', timeout: 360_000 });
  }

  await step('Close the compare panel (Escape)', 'keyboard', async ({ check }) => {
    await page.locator('.cmp-sheet').focus();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('.cmp-sheet')?.hidden, null, { timeout: 10_000 });
    const st = await appState(page);
    check('Panel closed, A and B kept', `${st.comparing} ${Boolean(st.compareA)} ${Boolean(st.compareB)}`, 'false true true', !st.comparing && st.compareA && st.compareB);
  });
}

// ------------------------------------------------------------------ part 2: the surface view

async function partSurface(app, step) {
  const { page } = app;

  await step('IM-2: its marker on the globe (a click shows the details, a double-click opens the surface view)', 'control', async ({ check, note }) => {
    let p = await markerPoint(page, IM2.id);
    note(`IM-2 marker: ${JSON.stringify(p)}.`);
    if (!p.visible || p.covered) {
      // Bring it into view the way a user would: type its coordinates (approximate is enough here).
      const r = await typeCentre(page, String(IM2.lat), String(IM2.lon));
      p = await markerPoint(page, IM2.id);
      note(`Brought IM-2 to the centre by typing its coordinates (centre ${r.centre.lat.toFixed(3)}, ${r.centre.lon.toFixed(3)}); marker now ${JSON.stringify(p)}.`);
    }
    if (!p.visible) throw new Error('IM-2 marker not visible');
    await openFromMarker(page, IM2.id, p, { check, note });
    await surfaceReady(page);
    const s = await appState(page);
    check('View after opening the marker', s.view, 'surface', s.view === 'surface');
    // First arrival at a site faces the Sun (or Earth when the Sun is down): faceOnArrival in the surface controller.
    await sleep(500);
    const v = await surfaceView(page);
    if (v.sky.sun.elDeg > -1) check('First arrival faces the Sun (azimuth)', v.look.azDeg, v.sky.sun.azDeg, close(v.look.azDeg, v.sky.sun.azDeg, 1) || close(v.look.azDeg, v.sky.sun.azDeg - 360, 1) || close(v.look.azDeg, v.sky.sun.azDeg + 360, 1));
    app.lookBeforeLeaving = null;
  }, { timeout: 180_000 });

  await step('Look around: drag, then arrow keys', 'control', async ({ check, note }) => {
    const c = canvasCentre(app);
    // A horizontal drag on the scene itself: since T-64 movable panels can cover the middle at 1280x720.
    const y = await page.evaluate(({ cx, cy }) => {
      const free = (yy) => [-150, -75, 0, 100, 200].every((dx) => document.elementFromPoint(cx + dx, yy)?.id === 'scene');
      return [0, -0.1, -0.2, 0.1, -0.3, 0.2].map((f) => Math.round(cy + f * cy * 2)).find(free) ?? null;
    }, { cx: c.x, cy: c.y });
    if (y === null) throw new Error('No clear horizontal line on the scene to drag along');
    if (y !== c.y) note(`Dragged along y = ${y}: the middle of the scene is covered by a panel.`);
    const before = (await appState(page)).look;
    await mouseDrag(page, { x: c.x + 200, y }, { x: c.x - 150, y });
    await sleep(600);
    const afterDrag = (await appState(page)).look;
    const turned = Math.abs(((afterDrag.azDeg - before.azDeg + 540) % 360) - 180);
    check('Dragging turns the view (azimuth change, degrees)', turned.toFixed(1), '> 5', turned > 5);
    await page.mouse.click(c.x, y);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await sleep(300);
    const afterKeys = (await appState(page)).look;
    const turnedKeys = Math.abs(((afterKeys.azDeg - afterDrag.azDeg + 540) % 360) - 180);
    check('ArrowRight x3 turns the view (degrees)', turnedKeys.toFixed(1), '> 1', turnedKeys > 1);
    await page.keyboard.press('ArrowUp');
    await sleep(200);
    const up = (await appState(page)).look;
    check('ArrowUp tilts up (elevation, degrees)', `${afterKeys.elDeg} -> ${up.elDeg}`, 'larger', up.elDeg > afterKeys.elDeg);
    // The status line is in the strip's "About" disclosure since PR #4: open it to read it.
    const about = await openHudMenu(page, 'About');
    const hud = await page.locator('.surface-hud .sh-status').textContent();
    const look = (await appState(page)).look;
    check('HUD "Facing" azimuth = store.look.azDeg', hud, look.azDeg, close(numbers(hud)[0], Math.round(look.azDeg) % 360, 1.01));
    if (about) await closeHudMenu(page, 'About');
  });

  await step('Close the surface view (× button), then "At landing time" (card): IM-2 card values', 'control', async ({ check, note }) => {
    app.lookBeforeLeaving = (await appState(page)).look;
    await page.getByRole('button', { name: 'Close the surface view and return to the globe' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().view === 'globe', null, { timeout: 15_000 });
    await page.locator('.site-card').getByRole('button', { name: /^At landing time/ }).click();
    await page.waitForFunction((t) => window.lunyx.store.get().timeMs === t, IM2.landingUtc, { timeout: 15_000 });
    await analysisSettled(page);
    const [card, a, st] = [await readCard(page), await getAnalysis(page), await appState(page)];
    app.report.values.push({ profile: app.profile, where: 'IM-2 card at landing', card, analysis: { metrics: a.metrics, slope: a.slope, now: a.now, siteElevationM: a.siteElevationM, nextEvents: a.nextEvents } });
    check('Card shows IM-2', card?.title, IM2.name, card?.title === IM2.name);
    check('Clock at touchdown', new Date(st.timeMs).toISOString(), '2025-03-06T17:28:00.000Z', st.timeMs === IM2.landingUtc);
    check('Window starts at touchdown, no delay', `${new Date(st.windowStartMs).toISOString()} delay ${st.delayH}`, '2025-03-06T17:28Z delay 0', st.windowStartMs === IM2.landingUtc && st.delayH === 0);
    check('Card: landing date', card.facts.Landed, '6 March 2025, 17:28 UTC', card.facts.Landed === '6 March 2025, 17:28 UTC');
    if (a.state === 'ready') checkCard(check, card, a, st);
    note(`Card text: Sun "${card.sky.Sun}"; Earth "${card.sky.Earth}"; window "${card.winWhen}".`);
  }, { shot: 'im2-card-landing' });

  await step('Enter surface view (card button): IM-2 at touchdown, facing the Sun', 'control', async ({ check, note }) => {
    await page.locator('.site-card').getByRole('button', { name: 'Enter surface view' }).click();
    await surfaceReady(page);
    const [v, a] = [await surfaceView(page), await getAnalysis(page)];
    app.report.values.push({ profile: app.profile, where: 'IM-2 surface at landing', surface: { look: v.look, sky: v.sky, ground: v.ground }, analysisNow: a.now });
    for (const body of ['sun', 'earth']) {
      check(`Surface: ${body} azimuth drawn = analysis now.${body}.azDeg`, v.sky[body].azDeg, a.now[body].azDeg, close(v.sky[body].azDeg, a.now[body].azDeg, 0.02));
      check(`Surface: ${body} elevation drawn = analysis now.${body}.elDeg`, v.sky[body].elDeg, a.now[body].elDeg, close(v.sky[body].elDeg, a.now[body].elDeg, 0.02));
    }
    const ratio = v.sky.earth.angularDiameterDeg / v.sky.sun.angularDiameterDeg;
    check("Earth drawn about 3.6x the Sun's width", ratio.toFixed(2), '3.4 to 3.8', ratio > 3.4 && ratio < 3.8);
    // Coming back to the same site keeps the direction the viewer was looking in (by design).
    const was = app.lookBeforeLeaving;
    if (was) check('Back at the same site, the view keeps its last direction (azimuth)', v.look.azDeg, was.azDeg, close(v.look.azDeg, was.azDeg, 1));
    const settings = await page.evaluate(() => ({ lowPower: window.lunyx.scene.surface.view.lowPower ?? null, pixelRatio: window.lunyx.scene.surface.view.renderer?.getPixelRatio?.() ?? null }));
    note(`Surface settings: ${JSON.stringify(settings)} (the app uses low-power settings only for a software renderer).`);
    const about = await openHudMenu(page, 'About');
    note(`HUD: ${await page.locator('.surface-hud .sh-status').textContent()}`);
    note(`Ground: ${(await page.locator('.surface-hud .sh-ground').textContent().catch(() => '')).slice(0, 400)}`);
    if (about) await closeHudMenu(page, 'About');
    note(`Frame rate ${await fps(page)} fps.`);
  }, { shot: 'im2-surface-landing-sun', timeout: 180_000 });

  await step('Key metrics (HUD) against the analysis: Sun and Earth now, countdowns, mission window', 'control', async ({ check, note }) => {
    await analysisSettled(page);
    await page.waitForFunction(() => document.querySelector('.km .km-now tbody tr th'), null, { timeout: 20_000 });
    await sleep(400);
    const [km, a] = [await readKeyMetrics(page), await getAnalysis(page)];
    app.report.values.push({ profile: app.profile, where: 'IM-2 key metrics at landing', keyMetrics: km, analysis: { now: a.now, nextEvents: a.nextEvents, metrics: a.metrics, slope: a.slope } });
    check('Key metrics panel open', km?.open, true, km?.open === true);
    for (const [row, body] of [['Sun', 'sun'], ['Earth', 'earth']]) {
      const r = km.now[row];
      const n = a.now[body];
      check(`Key metrics: ${row} azimuth = analysis now.${body}.azDeg`, r?.az, n.azDeg, close(firstNumber(r?.az), n.azDeg, 0.06));
      check(`Key metrics: ${row} elevation = analysis now.${body}.elDeg`, r?.el, n.elDeg, close(firstNumber(r?.el), n.elDeg, 0.011));
      check(`Key metrics: ${row} above skyline = analysis now.${body}.clearanceDeg`, r?.clear, n.clearanceDeg, close(firstNumber(r?.clear), n.clearanceDeg, 0.011));
    }
    for (const [k, type] of ['sunset', 'sunrise', 'earthset', 'earthrise'].entries()) {
      const c = km.counts[k], e = a.nextEvents?.[type];
      if (!e) {
        check(`Countdown ${type}: none ahead, button disabled`, `${c?.when} (${c?.disabled ? 'disabled' : 'enabled'})`, 'disabled', c?.disabled === true);
        continue;
      }
      const at = fmtUtc(Date.parse(e.timeUtc));
      check(`Countdown "${c?.label}": instant and time = analysis nextEvents.${type}`, c?.at, `${e.label} · ${at}`, c?.at === `${e.label} · ${at}`);
    }
    for (const c of keyMetricsAgainst(km, a).filter((x) => /Sunlight|darkness|Earth's centre in sight|any part|Earth gap|Slope/.test(x.what))) check(c.what, c.shown, c.expected, c.pass);
    note(`States: ${km.states.join(' | ')}. Flags: ${km.flags.join(' | ') || 'none'}.`);
  }, { shot: 'im2-surface-key-metrics' });

  await step('"why?" on the Sun row of Key metrics: what forms the skyline there', 'control', async ({ check, note }) => {
    const seq = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
    await page.locator('.km .km-why').first().click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="What forms the skyline there"]')?.hidden, null, { timeout: 20_000 });
    const res = await page.evaluate((from) => window.lunyx.actions.actionLog().filter((e) => e.seq > from && e.name === 'explainBlockage').at(-1)?.result ?? null, seq);
    const shown = await page.evaluate(() => {
      const box = document.querySelector('[aria-label="What forms the skyline there"]');
      return { text: box.querySelector('.skc-explain-text')?.textContent.trim(), all: box.textContent.trim().replace(/\s+/g, ' ').slice(0, 700) };
    });
    app.report.values.push({ profile: app.profile, where: 'IM-2 blockage explanation (Sun)', result: res, shown });
    check('Explanation on screen = explainBlockage result', shown.text, res?.explanation, Boolean(res) && shown.text === res.explanation);
    note(`Shown: ${shown.all}`);
  }, { shot: 'im2-surface-why-sun' });

  await step('Skyline chart: "Table" view against the analysis series', 'control', async ({ check, note }) => {
    await page.getByRole('button', { name: 'Table', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.skc-data tbody tr'), null, { timeout: 20_000 });
    const t = await readChartTable(page);
    app.report.values.push({ profile: app.profile, where: 'IM-2 skyline chart table', table: t });
    note(`${t?.count} rows. ${t?.caption}`);
    for (const smp of t?.samples ?? []) {
      const [time, sunAz, sunEl, sunClear, , earthAz, earthEl, earthClear] = smp.row;
      check(`Chart table ${time}: row on a series sample`, smp.index, 'an exact sample', smp.exact);
      if (!smp.exact) continue;
      const v = smp.series;
      check(`Chart table ${time}: Sun az/el/clearance = series`, `${sunAz} / ${sunEl} / ${sunClear}`, `${v.sunAz.toFixed(1)} / ${v.sunEl.toFixed(2)} / ${v.sunClearance.toFixed(2)}`, close(firstNumber(sunAz), v.sunAz, 0.051) && close(firstNumber(sunEl), v.sunEl, 0.006) && close(firstNumber(sunClear), v.sunClearance, 0.006));
      check(`Chart table ${time}: Earth az/el/clearance = series`, `${earthAz} / ${earthEl} / ${earthClear}`, `${v.earthAz.toFixed(1)} / ${v.earthEl.toFixed(2)} / ${v.earthClearance.toFixed(2)}`, close(firstNumber(earthAz), v.earthAz, 0.051) && close(firstNumber(earthEl), v.earthEl, 0.006) && close(firstNumber(earthClear), v.earthClearance, 0.006));
    }
    const back = page.getByRole('button', { name: 'Chart', exact: true });
    const pressed = await back.getAttribute('aria-pressed');
    check('The toggle now reads "Chart" and is pressed', pressed, 'true', pressed === 'true');
    app.extraShots.push(await shot(page, `${app.shotDir}/${String(app.report.steps.length + 1).padStart(2, '0')}-im2-surface-chart-table.jpg`));
    await back.click();
  });

  await step('Turn to Earth from the HUD ("Track Earth"; "Face Earth" before GitHub PR #2)', 'control', async ({ check, note }) => {
    const how = await faceBody(page, 'Earth');
    note(how === 'track' ? '"Track Earth" is pressed: the view follows Earth as the clock moves.' : 'One-off "Face Earth" button (a build before GitHub PR #2).');
    await sleep(800);
    const v = await surfaceView(page);
    check('Look azimuth = Earth azimuth', v.look.azDeg, v.sky.earth.azDeg, close(v.look.azDeg, v.sky.earth.azDeg, 0.2));
    check('Look elevation = Earth elevation', v.look.elDeg, v.sky.earth.elDeg, close(v.look.elDeg, v.sky.earth.elDeg, 0.2));
    check('Earth phase (lit %) shown in the scene', v.sky.earth.litPct, 'a number', Number.isFinite(v.sky.earth.litPct));
  }, { shot: 'im2-surface-earth' });

  await step('Turn to the Sun ("Track Sun") and show sky paths (HUD toggles)', 'control', async ({ check, note }) => {
    const how = await faceBody(page, 'Sun');
    if (how === 'track') {
      const earth = await page.locator('.surface-hud').getByRole('button', { name: 'Track Earth', exact: true }).getAttribute('aria-pressed');
      check('Tracking the Sun replaces tracking Earth', `Track Earth pressed: ${earth}`, 'false', earth === 'false');
    }
    // "Sky paths" is in the strip's "Surface options" disclosure since PR #4.
    const options = await openHudMenu(page, 'Surface options');
    const paths = page.locator('.surface-hud').getByRole('button', { name: 'Sky paths' });
    if ((await paths.getAttribute('aria-pressed')) !== 'true') await paths.click();
    if (options) await closeHudMenu(page, 'Surface options');
    await sleep(800);
    const v = await surfaceView(page);
    check('Sky paths on', v.annotations.tracks, true, v.annotations.tracks === true);
    check('Look azimuth = Sun azimuth', v.look.azDeg, v.sky.sun.azDeg, close(v.look.azDeg, v.sky.sun.azDeg, 0.2));
  }, { shot: 'im2-surface-sun-paths' });

  await step('Scrubber: window 29.5 days (select)', 'control', async ({ check, note }) => {
    await page.getByLabel('Mission window length').selectOption('708');
    await page.waitForFunction(() => window.lunyx.store.get().windowDurationH === 708, null, { timeout: 10_000 });
    const t0 = Date.now();
    await analysisSettled(page, 'current', 300_000);
    note(`29.5-day analysis took ${Date.now() - t0} ms after the change.`);
    await sleep(500);
    const sc = await readScrubber(page);
    const ev = await page.evaluate(() => {
      const st = window.lunyx.analysis.get('current');
      const s = window.lunyx.store.get();
      const start = s.windowStartMs + s.delayH * 3_600_000, end = start + s.windowDurationH * 3_600_000;
      return st.state === 'ready' ? st.value.events.filter((e) => e.timeMs >= start && e.timeMs <= end).map((e) => ({ type: e.type, utc: new Date(e.timeMs).toISOString().slice(0, 16), azDeg: Math.round(e.azDeg * 10) / 10 })) : null;
    });
    app.report.values.push({ profile: app.profile, where: 'IM-2 29.5-day window events', events: ev, scrubber: sc });
    // Since T-47 the marks also carry the passes of Earth in front of the Sun (◐); count the event glyphs.
    const eventMarks = await page.evaluate(() => [...document.querySelectorAll('.time-scrubber .ts-mark')].filter((m) => /^(☀↑|☀↓|⊕↑|⊕↓)$/.test(m.textContent.trim())).length);
    const eclipseMarks = await page.evaluate(() => [...document.querySelectorAll('.time-scrubber .ts-mark')].filter((m) => m.textContent.trim() === '◐').length);
    check('Scrubber event marks = analysis events in the window', eventMarks, ev?.length, ev && eventMarks === ev.length);
    note(`Marks: ${eventMarks} rise and set, ${eclipseMarks} Earth in front of the Sun.`);
    check('Jump buttons shown', sc.jumpsShown, true, sc.jumpsShown);
    note(`Events: ${ev?.map((e) => `${e.type} ${e.utc}`).join('; ')}`);
    note(`Jump buttons: ${sc.jumps.map((j) => `"${j.text}"${j.disabled ? ' (disabled)' : ''}`).join(', ')}`);
  }, { timeout: 360_000 });

  await step('Countdown button for the Sun setting (Key metrics) moves the clock to the instant it names', 'control', async ({ check, note }) => {
    await sleep(400);
    // The button's title says where it goes: '... Clicking moves the clock to "Sun starts setting" (2025-03-19 16:36 UTC).'
    const [at, title] = await page.evaluate(() => [document.querySelector('.km .km-count li .km-count-at')?.textContent.trim() ?? '', document.querySelector('.km .km-count-btn')?.title ?? '']);
    const named = /Clicking moves the clock to "[^"]+" \((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC\)/.exec(title) ?? /(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}) UTC/.exec(at);
    check('The first countdown names where its button goes', title.slice(-90) || at, 'an instant with its time', Boolean(named));
    if (!named) return;
    const s0 = await appState(page);
    await page.locator('.km .km-count-btn').first().click();
    await page.waitForFunction((t) => window.lunyx.store.get().timeMs !== t, s0.timeMs, { timeout: 10_000 });
    const s = await appState(page);
    check('Clock = the instant the countdown names (to the minute)', fmtUtc(s.timeMs), `${named[1]} ${named[2]} UTC`, fmtUtc(s.timeMs) === `${named[1]} ${named[2]} UTC`);
    note(`Countdown: "${at}".`);
  });

  await step('Scrub: click the slider at 40 %', 'control', async ({ check, note }) => {
    const box = await page.locator('.ts-range').boundingBox();
    const s0 = await appState(page);
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
    await page.waitForFunction((t) => window.lunyx.store.get().timeMs !== t, s0.timeMs, { timeout: 10_000 });
    const s = await appState(page);
    const frac = (s.timeMs - s.windowStartMs - s.delayH * 3_600_000) / (s.windowDurationH * 3_600_000);
    check('Clock moved to about 40 % of the window', frac.toFixed(3), '0.37 to 0.43', frac > 0.37 && frac < 0.43);
    const sc = await readScrubber(page);
    check('Scrubber readout = simulated time', sc.scale[1], fmtUtc(s.timeMs), sc.scale[1]?.includes(fmtUtc(s.timeMs)));
    note(`Scrubbed to ${new Date(s.timeMs).toISOString()}.`);
  });

  await step('Scrubber jumps: each press of the Sun-setting and Sun-rising buttons goes to the instant its label names', 'control', async ({ check, note }) => {
    let sunsetShot = false;
    for (const [cls, presses] of [['.ts-jump.ts-sun', 3]]) {
      for (let k = 0; k < presses; k++) {
        await sleep(400); // the labels follow the clock within 250 ms
        const buttons = await page.evaluate((c) => [...document.querySelectorAll(`.time-scrubber ${c}`)].map((b, i) => ({ i, text: b.textContent.trim(), label: b.getAttribute('aria-label') ?? '', disabled: b.disabled })), cls);
        const b = buttons.find((x) => !x.disabled && /setting|set/.test(x.text)) ?? buttons.find((x) => !x.disabled);
        if (!b) break;
        const named = /^Jump to (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC: ([^(]+)\(/.exec(b.label);
        const s0 = await appState(page);
        await page.locator(`.time-scrubber ${cls}`).nth(b.i).click();
        await page.waitForFunction((t) => window.lunyx.store.get().timeMs !== t, s0.timeMs, { timeout: 15_000 });
        const s = await appState(page);
        check(`"${b.text}" lands on the instant its label names`, fmtUtc(s.timeMs), named ? `${named[1]} UTC (${named[2].trim()})` : b.label.slice(0, 80), Boolean(named) && fmtUtc(s.timeMs) === `${named[1]} UTC`);
        if (!sunsetShot && /fully set/i.test(b.text)) {
          sunsetShot = true;
          const a = await getAnalysis(page);
          note(`At "Sun fully set": Sun elevation ${a.now.sun.elDeg}°, skyline ${a.now.sun.skylineElDeg}°, clearance ${a.now.sun.clearanceDeg}°.`);
          await faceBody(page, 'Sun');
          await sleep(800);
          app.extraShots.push(await shot(page, `${app.shotDir}/${String(app.report.steps.length + 1).padStart(2, '0')}-im2-surface-at-sun-fully-set.jpg`));
        }
      }
    }
  });

  await step('Back to the globe (Escape key)', 'keyboard', async ({ check }) => {
    await page.mouse.click(canvasCentre(app).x, canvasCentre(app).y);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.lunyx.store.get().view === 'globe', null, { timeout: 15_000 });
    const s = await appState(page);
    check('View is the globe, IM-2 still selected', `${s.view} ${s.site?.id}`, 'globe im-2', s.view === 'globe' && s.site?.id === IM2.id);
  });

  await step('Apollo 11: open it from its marker, close, "At landing time", "Enter surface view", turn to the Sun', 'control', async ({ check, note }) => {
    await page.locator('.site-card').getByRole('button', { name: 'Whole Moon', exact: true }).click();
    await globeSettled(page);
    let p = await markerPoint(page, APOLLO11.id);
    note(`Apollo 11 marker after "Whole Moon": ${JSON.stringify(p)}.`);
    if (!p.visible || p.covered) {
      const r = await typeCentre(page, String(APOLLO11.lat), String(APOLLO11.lon));
      p = await markerPoint(page, APOLLO11.id);
      note(`Brought Apollo 11 to the centre by typing its coordinates (centre ${r.centre.lat.toFixed(3)}, ${r.centre.lon.toFixed(3)}); marker now ${JSON.stringify(p)}.`);
    }
    if (!p.visible || p.covered) throw new Error(`Apollo 11 marker not clickable: ${JSON.stringify(p)}`);
    await openFromMarker(page, APOLLO11.id, p, { check, note });
    await surfaceReady(page);
    await page.getByRole('button', { name: 'Close the surface view and return to the globe' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().view === 'globe', null, { timeout: 15_000 });
    await page.locator('.site-card').getByRole('button', { name: /^At landing time/ }).click();
    await page.waitForFunction((t) => window.lunyx.store.get().timeMs === t, APOLLO11.landingUtc, { timeout: 15_000 });
    await page.locator('.site-card').getByRole('button', { name: 'Enter surface view' }).click();
    await surfaceReady(page);
    await analysisSettled(page);
    await faceBody(page, 'Sun');
    await sleep(800);
    const [v, a] = [await surfaceView(page), await getAnalysis(page)];
    app.report.values.push({ profile: app.profile, where: 'Apollo 11 surface at landing', surface: { look: v.look, sky: v.sky, ground: v.ground }, analysisNow: a.now });
    for (const body of ['sun', 'earth']) check(`Surface: ${body} position drawn = analysis now.${body}`, `${v.sky[body].azDeg} / ${v.sky[body].elDeg}`, `${a.now[body].azDeg} / ${a.now[body].elDeg}`, close(v.sky[body].azDeg, a.now[body].azDeg, 0.02) && close(v.sky[body].elDeg, a.now[body].elDeg, 0.02));
    note(`Sun az/el ${v.sky.sun.azDeg.toFixed(2)} / ${v.sky.sun.elDeg.toFixed(2)}; Earth ${v.sky.earth.azDeg.toFixed(2)} / ${v.sky.earth.elDeg.toFixed(2)}, ${v.sky.earth.litPct?.toFixed?.(0)} % lit. Frame rate ${await fps(page)} fps.`);
  }, { shot: 'apollo11-surface-landing-sun', timeout: 240_000 });
}

// ------------------------------------------------------------------ part 3: the assistant

async function partAssistant(app, step) {
  const { page } = app;

  await step('Assistant: open the drawer (button)', 'control', async ({ check }) => {
    await page.locator('#assistant-button').click();
    await page.waitForFunction(() => document.getElementById('assistant-drawer')?.classList.contains('is-open') && !document.querySelector('.ad-mode')?.textContent.includes('Checking'), null, { timeout: 30_000 });
    const mode = await page.locator('.ad-mode').textContent();
    check('Mode line says deterministic, no language model', mode, 'Deterministic mode: no language model…', mode.startsWith('Deterministic mode: no language model'));
    await page.waitForFunction(() => document.activeElement?.id === 'assistant-input', null, { timeout: 5000 }).catch(() => {});
    const focus = await page.evaluate(() => document.activeElement?.id);
    check('Focus lands in the message box', focus, 'assistant-input', focus === 'assistant-input');
  }, { shot: 'assistant-open' });

  const askStep = (text, extra, shotName = null) =>
    step(`Assistant: "${text}"`, 'assistant', async (ctx) => {
      const reply = await ask(page, text);
      app.report.replies.push({ profile: app.profile, text, reply: { text: reply.text, label: reply.shownLabel, actions: reply.actions.map((x) => `${x.name}:${x.ok ? 'ok' : `failed (${x.error})`}`) } });
      ctx.check('Reply labelled deterministic', reply.shownLabel, 'Deterministic mode: no language model', reply.shownLabel === 'Deterministic mode: no language model');
      ctx.note(`Reply: ${reply.text.replace(/\s+/g, ' ').slice(0, 900)}`);
      ctx.note(`Actions: ${reply.actions.map((x) => `${x.name} (${x.ok ? 'ok' : `failed: ${x.error}`})`).join(', ') || 'none'}`);
      if (extra) await extra(reply, ctx);
    }, { timeout: 300_000, shot: shotName });

  await askStep('show IM-2 at its landing time', async (reply, { check }) => {
    const s = await appState(page);
    check('Site and clock', `${s.site?.id} ${new Date(s.timeMs).toISOString()}`, 'im-2 2025-03-06T17:28:00.000Z', s.site?.id === IM2.id && s.timeMs === IM2.landingUtc);
  });
  await askStep('what is the illumination?', async (reply, { check }) => {
    await analysisSettled(page);
    const a = await getAnalysis(page);
    const f1 = (v) => v.toFixed(1);
    check('Illumination in the reply = analysis', reply.text.match(/illumination [\d.]+ %/)?.[0], `illumination ${f1(a.metrics.illuminationPct)} %`, reply.text.includes(`illumination ${f1(a.metrics.illuminationPct)} %`));
    check('Longest darkness in the reply = analysis', reply.text.match(/longest darkness [\d.]+ h/)?.[0], `longest darkness ${f1(a.metrics.longestDarknessH)} h`, reply.text.includes(`longest darkness ${f1(a.metrics.longestDarknessH)} h`));
    const earthShown = reply.text.match(/(?:Earth line of sight|Earth's centre in view) ([\d.]+) %/);
    check("Earth in view in the reply = analysis (Earth's centre)", earthShown?.[0], `${f1(a.metrics.earthVisiblePct)} %`, earthShown?.[1] === f1(a.metrics.earthVisiblePct));
    check('Slope in the reply = analysis', reply.text.match(/slope [\d.]+°/)?.[0], `slope ${f1(a.slope.slopeDeg)}°`, reply.text.includes(`slope ${f1(a.slope.slopeDeg)}°`));
    check('Reply says Earth visibility is not a radio link', /not a guarantee of a working radio link|not a radio link/.test(reply.text), true, /not a guarantee of a working radio link|not a radio link/.test(reply.text));
  });
  await askStep('compare with a 24 h delay', async (reply, { check }) => {
    const pub = await comparisonSettled(page);
    await sleep(500);
    const view = await readCompare(page);
    app.report.values.push({ profile: app.profile, where: 'assistant compare +24 h', panel: view, published: pub });
    if (pub.state === 'ready') {
      check('Reply quotes A illumination', `${pub.a.metrics.illuminationPct.toFixed(1)} %`, 'in the reply', reply.text.includes(`${pub.a.metrics.illuminationPct.toFixed(1)} %`));
      check('Reply quotes B illumination', `${pub.b.metrics.illuminationPct.toFixed(1)} %`, 'in the reply', reply.text.includes(`${pub.b.metrics.illuminationPct.toFixed(1)} %`));
      check('Compare panel open with the same pair', `open: ${view.open}`, 'open', view.open);
      if (view.open) checkCompareTable(check, view, pub);
    }
    const claims = /comparison is open on screen/i.test(reply.text);
    check('"The comparison is open on screen" is true', `claimed: ${claims}; panel open: ${view.open}`, 'consistent', !claims || view.open);
  }, 'assistant-compare');
  await askStep('find a flatter nearby site with a shorter blackout', async (reply, { check, note }) => {
    const can = await hasAction(page, 'rankNearby');
    if (!can) {
      check('Reply says the nearby scan is not available here', reply.text.slice(0, 200), 'says not available', /not available|cannot|can't|no .*action|not .*this build/i.test(reply.text));
      return;
    }
    const ranked = reply.actions.find((x) => x.name === 'rankNearby' && x.ok)?.result ?? null;
    const scan = await page.evaluate(() => {
      const n = window.lunyx.analysis.nearby();
      return n.state === 'ready'
        ? { scenario: n.scenario.label, options: n.options, rows: n.value.map((c) => ({ id: c.site.id, name: c.site.name, ref: Boolean(c.isReference), slope: c.slope.slopeDeg, sun: c.metrics?.illuminationPct ?? null, dark: c.metrics?.longestDarknessH ?? null, earth: c.metrics?.earthVisiblePct ?? null, score: c.score })) }
        : { state: n.state };
    });
    app.report.values.push({ profile: app.profile, where: 'assistant nearby request', result: ranked && { scenario: ranked.scenario, options: ranked.options, reference: ranked.reference, candidates: ranked.candidates }, scanOnScreen: scan });
    const found = /Found a site with[^:]*: (.*?)\n/.exec(reply.text);
    if (!ranked || !found) {
      note('No "Found a site" line, or no rankNearby result, to check.');
      return;
    }
    const nums = /slope ([\d.]+)°, illumination ([\d.]+) %, longest darkness (none|[\d.]+ h)/.exec(found[1]);
    const row = nums && ranked.candidates.find((c) => found[1].startsWith(`${c.name} (`));
    check('The site the reply names is a row of the rankNearby result', row?.name ?? found[1].slice(0, 80), 'a candidate', Boolean(row));
    if (row) {
      check('Reply slope = rankNearby row', nums[1], row.slopeDeg, close(Number(nums[1]), row.slopeDeg, 0.051));
      check('Reply illumination = rankNearby row', nums[2], row.illuminationPct, close(Number(nums[2]), row.illuminationPct, 0.051));
      check('Reply longest darkness = rankNearby row', nums[3], row.longestDarknessH, close(hoursOf(nums[3]), row.longestDarknessH, 0.051));
      check('It is flatter than the site and its darkness shorter (rankNearby values)', `${row.slopeDeg}° vs ${ranked.reference?.slopeDeg}°; ${row.longestDarknessH} h vs ${ranked.reference?.longestDarknessH} h`, 'both lower', row.slopeDeg < ranked.reference?.slopeDeg && row.longestDarknessH < ranked.reference?.longestDarknessH);
      const onScreen = scan.rows?.find((c) => c.id === row.id);
      check('The same candidate in the scan on screen, same figures', onScreen ? `${onScreen.slope?.toFixed(2)}°, ${onScreen.sun?.toFixed(2)} %` : 'not in the list on screen', `${row.slopeDeg}°, ${row.illuminationPct} %`, Boolean(onScreen) && close(onScreen.slope, row.slopeDeg, 0.006) && close(onScreen.sun, row.illuminationPct, 0.006));
    }
  });
  await askStep('enter the surface then look at the sun', async (reply, { check }) => {
    await surfaceReady(page).catch(() => {});
    const s = await appState(page);
    check('View after the request', s.view, 'surface', s.view === 'surface');
  }, 'assistant-surface');

  await step('Close the drawer (Escape)', 'keyboard', async ({ check }) => {
    await page.locator('#assistant-input').press('Escape');
    await page.waitForFunction(() => !window.lunyx.store.get().assistantOpen, null, { timeout: 10_000 });
    const s = await appState(page);
    check('Drawer closed, view kept', `${s.assistantOpen} ${s.view}`, 'false surface', !s.assistantOpen && s.view === 'surface');
  });
}

// ------------------------------------------------------------------ part 4: release-candidate extras (T-8)

async function backToGlobe(page) {
  if ((await page.evaluate(() => window.lunyx.store.get().view)) !== 'surface') return;
  await page.getByRole('button', { name: 'Close the surface view and return to the globe' }).click();
  await page.waitForFunction(() => window.lunyx.store.get().view === 'globe', null, { timeout: 15_000 });
}

async function partExtras(app, step) {
  const { page } = app;
  const HOUR = 3_600_000;

  await step('Missions to replay: "IM-2 Athena, Mons Mouton" (Filters) loads and plays to the end of its window', 'control', async ({ check, note }) => {
    await closeCompare(page);
    await backToGlobe(page);
    const preset = await page.evaluate(() => fetch('/data/presets.json').then((r) => r.json()).then((d) => d.presets.find((x) => x.id === 'im-2-landing')));
    await page.locator('.pl-button', { hasText: 'IM-2 Athena' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().site?.id === 'im-2' && window.lunyx.store.get().view === 'surface', null, { timeout: 60_000 });
    const s0 = await appState(page);
    const start = Date.parse(preset.windowStartUtc), end = start + preset.windowDurationH * HOUR;
    check('Preset site, window start and length', `${s0.site.id} ${new Date(s0.windowStartMs).toISOString()} ${s0.windowDurationH} h`, `${preset.siteId} ${new Date(start).toISOString()} ${preset.windowDurationH} h`, s0.site.id === preset.siteId && s0.windowStartMs === start && s0.windowDurationH === preset.windowDurationH);
    await analysisSettled(page);
    // The preset starts playing once its site analysis is ready.
    await page.waitForFunction(() => window.lunyx.store.get().playing, null, { timeout: 60_000 }).catch(() => {});
    const s0b = await appState(page);
    check('Preset plays at its rate', `${s0b.playing || s0b.timeMs > start} ${s0b.rate}`, `true ${preset.rateSecondsPerSecond}`, (s0b.playing || s0b.timeMs > start) && s0b.rate === preset.rateSecondsPerSecond);
    // What the list says after the load. Since main 5972aaf (list at the bottom of Filters, no
    // per-preset disclosures) the status line stayed empty after a successful load (batch 16);
    // @globe's T-67 commit makes it confirm the load, with the preset's caveat (IM-2's touchdown
    // minute is not confirmed) on screen or in the button's tooltip.
    // The line says "Loading …" until the action returns; wait for its final text.
    await page.waitForFunction(() => !/^Loading/.test(document.querySelector('.pl-status')?.textContent.trim() ?? ''), null, { timeout: 30_000 }).catch(() => {});
    const said = await page.evaluate(() => {
      const panel = document.querySelector('.filters-panel');
      const list = document.querySelector('.pl');
      return {
        last: Boolean(panel && list && [...panel.children].filter((c) => !c.matches('hr')).at(-1)?.contains(list)),
        status: document.querySelector('.pl-status')?.textContent.trim() ?? '',
        title: [...document.querySelectorAll('.pl-button')].find((b) => b.textContent.includes('IM-2 Athena'))?.title ?? '',
      };
    });
    note(`"Missions to replay" ${said.last ? 'is the last section of Filters' : 'is not the last section of Filters'}. Status line after the load: "${said.status}". The button's tooltip: "${said.title}".`);
    check('The "Missions to replay" status line confirms the load', said.status || '(empty)', 'a sentence about the loaded preset', !/^Loading/.test(said.status) && /IM-2/.test(said.status) && /playing|loaded/i.test(said.status), { finding: 'batch 16 (T-67)' });
    check("The preset's caveat (IM-2's touchdown minute) is on screen or in the tooltip", `${said.status} | ${said.title}`.slice(0, 220), 'says the touchdown minute is not confirmed', /minute|unconfirmed|not confirmed|approximate|uncertain/i.test(`${said.status} ${said.title}`), { finding: 'batch 16 (T-67)' });
    const eph = (await page.locator('.pl-ephemeris').textContent().catch(() => '')) ?? '';
    const a = await getAnalysis(page);
    note(`Ephemeris line: "${eph.trim()}"; analysis ephemeris: ${a.provenance?.ephemeris}.`);
    check('Sun and Earth from the bundled Horizons table', a.provenance?.ephemeris, 'horizons', a.provenance?.ephemeris === 'horizons');
    const t0 = Date.now();
    await page.waitForFunction(() => !window.lunyx.store.get().playing, null, { timeout: 240_000, polling: 500 });
    const s1 = await appState(page);
    note(`Played for ${Date.now() - t0} ms after the analysis was ready.`);
    check('The clock stops at the end of the window', new Date(s1.timeMs).toISOString(), new Date(end).toISOString(), s1.timeMs === end);
  }, { shot: 'preset-im2-end', timeout: 300_000 });

  await step('Zoomed Earth at IM-2 touchdown (turn to Earth, then + until about 8° field of view)', 'keyboard', async ({ check, note }) => {
    await page.locator('.ts-date').fill('2025-03-06T17:28');
    await page.locator('.ts-date').press('Enter');
    await page.waitForFunction(() => window.lunyx.store.get().timeMs === Date.UTC(2025, 2, 6, 17, 28), null, { timeout: 15_000 }).catch(() => note('The date field did not move the clock to touchdown.'));
    await faceBody(page, 'Earth');
    await page.locator('#scene').focus();
    for (let i = 0; i < 25 && (await appState(page)).look.fovDeg > 8.5; i++) await page.keyboard.press('+');
    await sleep(800);
    const v = await surfaceView(page);
    note(`Field of view ${v.look.fovDeg}°, Earth ${v.sky.earth.litPct} % lit, diameter ${v.sky.earth.angularDiameterDeg}°.`);
    check('Zoomed in by keyboard', v.look.fovDeg, '<= 8.5', v.look.fovDeg <= 8.5);
    // Q-5: with the default solar band (0° to 90°) nothing is required, so Key metrics raises no band flag.
    const st5 = await appState(page);
    const km5 = await readKeyMetrics(page);
    const bandFlags = (km5?.flags ?? []).filter((f) => /required band/i.test(f));
    if (st5.sunElMinDeg === 0 && st5.sunElMaxDeg === 90) check('Q-5: no band flag in Key metrics with the default band', bandFlags.join(' | ') || 'none', 'none', bandFlags.length === 0, { finding: 'Q-5' });
    check('Still facing Earth', `${v.look.azDeg} / ${v.look.elDeg}`, `${v.sky.earth.azDeg} / ${v.sky.earth.elDeg}`, close(v.look.azDeg, v.sky.earth.azDeg, 0.5) && close(v.look.elDeg, v.sky.earth.elDeg, 0.5));
  }, { shot: 'im2-surface-earth-zoomed' });

  await step('Window table and downloads (compare panel): the JSON file equals the analysis, the CSV has one row per spell', 'control', async ({ check, note }) => {
    await page.locator('#scene').focus();
    for (let i = 0; i < 25 && (await appState(page)).look.fovDeg < 69; i++) await page.keyboard.press('-');
    await openComparePanel(page);
    await page.getByRole('tab', { name: 'Window table' }).click();
    await page.getByRole('button', { name: 'The scenario on screen' }).click();
    await page.waitForFunction(() => document.querySelector('[role="table"][aria-label$="spells in the mission window"] .cmp-srow:not(.cmp-shead)'), null, { timeout: 60_000 });
    const shown = await page.evaluate(() => [...document.querySelectorAll('[role="table"][aria-label$="spells in the mission window"] .cmp-srow:not(.cmp-shead)')].length);
    const a = await page.evaluate(() => {
      const st = window.lunyx.analysis.get('current');
      return st.state === 'ready' ? JSON.parse(JSON.stringify({ metrics: st.value.metrics, slope: { slopeDeg: st.value.slope.slopeDeg } })) : null;
    });
    const [dlJson] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Download as JSON' }).click()]);
    const json = JSON.parse(readFileSync(await dlJson.path(), 'utf8'));
    const sc = json.scenarios?.[0];
    const m = sc?.metrics ?? {};
    note(`JSON: ${dlJson.suggestedFilename()}, ${sc?.spells?.length} spells, ${sc?.events?.length} events.`);
    check('JSON illumination = analysis', m.illuminationPct, a.metrics.illuminationPct, close(m.illuminationPct, a.metrics.illuminationPct, 0.0006));
    check("JSON Earth's centre in view = analysis", m.earthCentreVisiblePct, a.metrics.earthVisiblePct, close(m.earthCentreVisiblePct, a.metrics.earthVisiblePct, 0.0006));
    check('JSON longest darkness = analysis', m.longestDarknessH, a.metrics.longestDarknessH, close(m.longestDarknessH, a.metrics.longestDarknessH, 0.0006));
    check('JSON slope = analysis', sc?.slope?.slopeDeg, a.slope.slopeDeg, close(sc?.slope?.slopeDeg, a.slope.slopeDeg, 0.0006));
    check('JSON spells = rows in the table on screen', sc?.spells?.length, shown, sc?.spells?.length === shown);
    const band = sc?.requirements?.sunElevationBand;
    const bandSet = band?.required ?? sc?.requirements?.sunElevationBandSet;
    check('JSON says whether a solar band is required', bandSet, 'a boolean', typeof bandSet === 'boolean');
    if (bandSet === false && band) check('JSON: no verdict on a band nobody set (Q-5)', band.metForWholeWindow, null, band.metForWholeWindow === null, { finding: 'Q-5' });
    const [dlCsv] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Download as CSV' }).click()]);
    const csv = readFileSync(await dlCsv.path(), 'utf8').trim().split(/\r?\n/);
    note(`CSV: ${dlCsv.suggestedFilename()}, ${csv.length} lines; header: ${csv[0].slice(0, 160)}`);
    const rowsExpected = (sc?.spells?.length ?? 0) + (sc?.passages?.length ?? 0);
    check('CSV: one row per spell and per passage after the header', csv.length - 1, rowsExpected, csv.length - 1 === rowsExpected);
  }, { shot: 'window-table', timeout: 180_000 });

  await step('Outlook (compare panel): the table equals what showOutlook returned', 'control', async ({ check, note }) => {
    await page.getByRole('tab', { name: 'Outlook' }).click();
    const seq = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
    await page.getByRole('button', { name: 'Show the outlook' }).click();
    await page.waitForFunction((from) => window.lunyx.actions.actionLog().some((e) => e.seq > from && e.name === 'showOutlook'), seq, { timeout: 240_000, polling: 500 });
    const res = await page.evaluate((from) => window.lunyx.actions.actionLog().filter((e) => e.seq > from && e.name === 'showOutlook').at(-1), seq);
    check('showOutlook succeeded', res?.ok, true, res?.ok === true, res?.ok ? {} : { error: res?.error });
    await sleep(500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('[aria-label="Sunlight and Earth\'s centre in view per lunar day"] tr, [aria-label="Sunlight and Earth\'s centre in view per lunar day"] [role="row"]')].map((r) => r.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean));
    const days = res?.result?.lunarDays ?? [];
    note(`${days.length} lunar days returned; ${rows.length} rows in the table (header included). First day: ${JSON.stringify(days[0]).slice(0, 200)}`);
    check('Table rows = lunar days (plus the header)', rows.length, days.length + 1, rows.length === days.length + 1 || rows.length === days.length);
    if (days[0]) {
      const sun = Object.entries(days[0]).find(([k]) => /sunlight|illumination/i.test(k))?.[1];
      if (Number.isFinite(sun)) check('First lunar day: sunlight in the table = result', rows[1]?.slice(0, 120), sun, rows.slice(1, 3).some((r) => r.includes(sun.toFixed(1))));
    }
  }, { shot: 'outlook', timeout: 300_000 });

  await step('Globe: Country filter (India), country flags, country territories, ownership rows and the explored area on the card', 'control', async ({ check, note }) => {
    await closeCompare(page);
    await backToGlobe(page);
    const missions = page.locator('.fp-missions');
    if (!(await missions.evaluate((d) => d.open))) await missions.locator('summary').click();
    const listed = () => page.evaluate(() => [...(document.querySelector('.lp select')?.options ?? [])].filter((o) => o.value).map((o) => o.value));
    const before = await listed();
    await page.getByRole('button', { name: /^India, \d+ landings?$/ }).click();
    await sleep(500);
    const after = await listed();
    const india = await page.getByRole('button', { name: /^India, \d+ landings?$/ }).getAttribute('aria-pressed');
    note(`"Go to a landing site" lists ${before.length} landings before and ${after.length} after the India toggle (India pressed: ${india}).`);
    check('The Country toggle changes the landings shown', `${before.length} -> ${after.length}`, 'a change', after.length !== before.length);
    await page.getByRole('button', { name: /^India, \d+ landings?$/ }).click();
    await page.getByLabel('Show country flags').check();
    await page.waitForFunction(() => window.lunyx.store.get().showFlags === true, null, { timeout: 10_000 });
    check('Flags on in the store', true, true, true);
    const card = await readCard(page);
    note(`Card of ${card?.title}: Belongs to "${card?.facts['Belongs to']}"; Owner "${card?.facts.Owner}"; Explored "${card?.facts.Explored}".`);
    check('Ownership row on the card', card?.facts['Belongs to'], 'a state', Boolean(card?.facts['Belongs to']));
    // Since T-67 the explored area is no longer drawn on the globe: the row gives its size only.
    check('Explored area says its size', card?.facts.Explored, 'about … across', /about .*across/.test(card?.facts.Explored ?? ''));
    // Country territories (main 5972aaf, T-67): the whole Moon coloured by the country of the
    // nearest landing shown; off by default, and disabled while previous missions are hidden.
    const terrBox = page.getByLabel('Show country territories');
    if (await terrBox.count()) {
      check('"Show country territories" is off by default', String(await terrBox.isChecked()), 'false', !(await terrBox.isChecked()));
      const caption = page.locator('.fp-territory-note');
      check('No territory caption while the colouring is off', String(await caption.isVisible()), 'false', !(await caption.isVisible()));
      await terrBox.check();
      await page.waitForFunction(() => window.lunyx.store.get().showTerritories === true, null, { timeout: 10_000 });
      // What the colours mean, on screen under the checkbox while they are drawn (@globe's ed249f4).
      const meaning = (await caption.isVisible()) ? ((await caption.textContent()) ?? '').trim() : '';
      check('The caption under the checkbox says what the colours mean (the nearest landing, not ownership)', meaning.slice(0, 220) || '(no caption)', 'nearest landing; no ownership', /nearest/i.test(meaning) && /(legal boundary|owns|ownership)/i.test(meaning));
      const terr = () =>
        page.evaluate(() => {
          const g = window.lunyx.scene.globe;
          const u = g.uniforms;
          const n = u.uTerrCount.value;
          return { sites: n, countries: new Set([...Array(n).keys()].map((i) => u.uTerrSite.value[i].w)).size, shown: g.visibleMarkers.length };
        });
      const t1 = await terr();
      check('The territories are drawn for every landing shown', `${t1.sites} sites, ${t1.countries} countries`, `${t1.shown} sites`, t1.sites === t1.shown && t1.sites > 0);
      const india = page.getByRole('button', { name: /^India, \d+ landings?$/ });
      await india.click();
      await page.waitForFunction((n) => window.lunyx.scene.globe.uniforms.uTerrCount.value !== n, t1.sites, { timeout: 10_000 }).catch(() => {});
      const t2 = await terr();
      check('The territories follow the mission filters (India hidden)', `${t2.sites} sites, ${t2.countries} countries`, `${t2.shown} sites, ${t1.countries - 1} countries`, t2.sites === t2.shown && t2.sites < t1.sites && t2.countries === t1.countries - 1);
      await india.click();
      await page.waitForFunction((n) => window.lunyx.scene.globe.uniforms.uTerrCount.value === n, t1.sites, { timeout: 10_000 }).catch(() => {});
      const shownBox = page.getByLabel('Show previous missions');
      await shownBox.uncheck();
      check('"Show country territories" is disabled while previous missions are hidden', String(await terrBox.isDisabled()), 'true', await terrBox.isDisabled());
      await shownBox.check();
      note(`Territories: ${t1.sites} landings in ${t1.countries} countries; ${t2.sites} in ${t2.countries} with India hidden.`);
    } else note('No "Show country territories" in this build (before main 5972aaf).');
    await page.locator('.site-card').getByRole('button', { name: 'Whole Moon', exact: true }).click();
    await globeSettled(page);
  }, { shot: 'globe-flags' });
}

// ------------------------------------------------------------------ part 5: the T-6 scenario with the panels open (T-8 item 3)

async function partScenario(app, step) {
  const { page } = app;
  const replyOf = async (text) => {
    const from = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
    const reply = await ask(page, text);
    const entries = await page.evaluate((f) => window.lunyx.actions.actionLog().filter((e) => e.seq > f && e.origin === 'assistant').map(({ name, ok, result }) => ({ name, ok, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })), from);
    app.report.replies.push({ profile: app.profile, text, reply: { text: reply.text, label: reply.shownLabel, actions: entries.map((e) => `${e.name}:${e.ok ? 'ok' : 'failed'}`) } });
    return { reply, entries, of: (name) => entries.find((e) => e.name === name && e.ok)?.result ?? null };
  };
  let pick = null;

  await step(`Scenario set-up through the controls: arrival ${SCENARIO_WINDOW.startUtc}, window ${SCENARIO_WINDOW.durationH} h, pin at ${SCENARIO_PIN.lat}, ${SCENARIO_PIN.lon}`, 'control', async ({ check }) => {
    await backToGlobe(page);
    await closeCompare(page);
    const date = page.getByLabel('Arrival date and time (UTC)');
    await date.fill(SCENARIO_WINDOW.startUtc.replace('Z', ''));
    await date.press('Enter');
    await page.getByLabel('Mission window', { exact: true }).selectOption(String(SCENARIO_WINDOW.durationH));
    await typeCentre(page, String(SCENARIO_PIN.lat), String(SCENARIO_PIN.lon));
    await page.getByRole('button', { name: 'Drop pin at centre' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().site?.kind === 'custom', null, { timeout: 15_000 });
    const st = await appState(page);
    check('Pin, arrival and window as set', `${st.site.lat}, ${st.site.lon}; ${new Date(st.windowStartMs).toISOString().slice(0, 16)}Z; ${st.windowDurationH} h`, `${SCENARIO_PIN.lat}, ${SCENARIO_PIN.lon}; ${SCENARIO_WINDOW.startUtc}; ${SCENARIO_WINDOW.durationH} h`, close(st.site.lat, SCENARIO_PIN.lat, 1e-5) && close(st.site.lon, SCENARIO_PIN.lon, 1e-5) && st.windowStartMs === Date.parse(SCENARIO_WINDOW.startUtc) && st.windowDurationH === SCENARIO_WINDOW.durationH);
    await analysisSettled(page, 'current', 300_000);
    if (!(await page.evaluate(() => window.lunyx.store.get().assistantOpen))) await page.locator('#assistant-button').click();
  }, { timeout: 360_000 });

  await step(`Assistant: "${SCENARIO_STEPS[0]}": the reply, the Nearby list and the scan agree`, 'assistant', async ({ check, note }) => {
    const r = await replyOf(SCENARIO_STEPS[0]);
    note(`Reply: ${r.reply.text.replace(/\s+/g, ' ').slice(0, 500)}`);
    const scan = r.of('rankNearby');
    check('rankNearby ran', Boolean(scan), true, Boolean(scan));
    if (!scan) return;
    const ref = scan.reference;
    pick = scan.candidates.find((c) => c.slopeDeg < ref.slopeDeg && c.longestDarknessH < ref.longestDarknessH) ?? null;
    check('A flatter candidate with a shorter blackout exists', pick?.name ?? 'none', 'a candidate', Boolean(pick));
    if (!pick) return;
    check('The reply names it with its slope and darkness', r.reply.text.match(/slope [\d.]+°[^.]*?longest darkness (none|[\d.]+ h)/)?.[0], `${pick.name}: slope ${pick.slopeDeg.toFixed(1)}°, darkness ${pick.longestDarknessH.toFixed(1)} h`, r.reply.text.includes(pick.name) && r.reply.text.includes(`slope ${pick.slopeDeg.toFixed(1)}°`) && r.reply.text.includes(`longest darkness ${hoursText(pick.longestDarknessH)}`));
    await page.waitForFunction(() => document.querySelector('[role="table"][aria-label="Ranked nearby alternatives"] .cmp-nrow:not(.cmp-nhead)'), null, { timeout: 60_000 });
    const row = await page.evaluate((id) => {
      const rows = [...document.querySelectorAll('[role="table"][aria-label="Ranked nearby alternatives"] .cmp-nrow:not(.cmp-nhead)')];
      const tr = rows.find((x) => x.textContent.includes(id.split(':')[1]?.split(',')[0] ?? '§'));
      return tr ? Object.fromEntries([...tr.children].map((c) => [c.dataset.label, c.textContent.trim().replace(/\s+/g, ' ')])) : null;
    }, pick.id);
    const listRow = row ?? (await page.evaluate((rank) => {
      const tr = [...document.querySelectorAll('[role="table"][aria-label="Ranked nearby alternatives"] .cmp-nrow:not(.cmp-nhead)')].find((x) => x.firstElementChild?.textContent.trim() === String(rank));
      return tr ? Object.fromEntries([...tr.children].map((c) => [c.dataset.label, c.textContent.trim().replace(/\s+/g, ' ')])) : null;
    }, pick.rank));
    check('The Nearby list shows the same candidate figures', listRow ? `${listRow.Slope}, ${listRow.Sunlight}, ${listRow['Longest darkness']}` : 'not listed', `${pick.slopeDeg}°, ${pick.illuminationPct} %, ${pick.longestDarknessH} h`, Boolean(listRow) && close(firstNumber(listRow.Slope), pick.slopeDeg, 0.051) && close(firstNumber(listRow.Sunlight), pick.illuminationPct, 0.051) && close(hoursOf(listRow['Longest darkness']), pick.longestDarknessH, 0.051));
  }, { shot: 'scenario-1-nearby', timeout: 600_000 });

  await step(`Assistant: "${SCENARIO_STEPS[1]}": the reply, the compare table and the analyses agree`, 'assistant', async ({ check, note }) => {
    const r = await replyOf(SCENARIO_STEPS[1]);
    note(`Reply: ${r.reply.text.replace(/\s+/g, ' ').slice(0, 600)}`);
    const pub = await comparisonSettled(page);
    check('Comparison ready', pub.state, 'ready', pub.state === 'ready');
    if (pub.state !== 'ready') return;
    const st = await appState(page);
    check('B is the candidate of step 1, A the pin, same dates', `${st.compareB?.site.id} / ${st.compareA?.site.kind} / ${st.compareA?.startMs === st.compareB?.startMs}`, `${pick?.id} / custom / true`, st.compareB?.site.id === pick?.id && st.compareA?.site.kind === 'custom' && st.compareA?.startMs === st.compareB?.startMs);
    await sleep(500);
    const view = await readCompare(page);
    checkCompareTable(check, view, pub);
    for (const [tag, x] of [['A', pub.a], ['B', pub.b]]) {
      const line = r.reply.text.split('\n').find((l) => l.startsWith(`${tag}: `)) ?? '';
      check(`Reply ${tag}: illumination = analysis`, line.match(/illumination [\d.]+ %/)?.[0], x.metrics.illuminationPct, line.includes(`illumination ${x.metrics.illuminationPct.toFixed(1)} %`));
      check(`Reply ${tag}: Earth's centre in view = analysis`, line.match(/Earth's centre in view [\d.]+ %/)?.[0], x.metrics.earthVisiblePct, line.includes(`Earth's centre in view ${x.metrics.earthVisiblePct.toFixed(1)} %`));
    }
  }, { shot: 'scenario-2-compare', timeout: 600_000 });

  await step(`Assistant: "${SCENARIO_STEPS[2]}": the clock, Key metrics, the explanation and the reply agree`, 'assistant', async ({ check, note }) => {
    const r = await replyOf(SCENARIO_STEPS[2]);
    note(`Reply: ${r.reply.text.replace(/\s+/g, ' ').slice(0, 600)}`);
    const jump = r.of('jumpToEvent'), ridge = r.of('explainBlockage');
    check('jumpToEvent and explainBlockage ran', `${Boolean(jump)} ${Boolean(ridge)}`, 'true true', Boolean(jump && ridge));
    if (!jump || !ridge) return;
    await surfaceReady(page).catch(() => {});
    const st = await appState(page);
    check('Clock at the Earthset', new Date(st.timeMs).toISOString().slice(0, 16), jump.timeUtc?.slice(0, 16), new Date(st.timeMs).toISOString().slice(0, 16) === jump.timeUtc?.slice(0, 16));
    const shown = await page.evaluate(() => document.querySelector('.skc-explain-text')?.textContent.trim() ?? null);
    check('Explanation on screen = explainBlockage', shown?.slice(0, 160), ridge.explanation?.slice(0, 160), shown === ridge.explanation);
    check('Reply quotes the ridge distance', r.reply.text.match(/[\d.]+ (km|m) away/)?.[0], ridge.ridgeDistanceM, r.reply.text.includes(ridge.ridgeDistanceM >= 1000 ? `${(ridge.ridgeDistanceM / 1000).toFixed(1)} km` : `${ridge.ridgeDistanceM} m`) || r.reply.text.includes(ridge.explanation ?? '§'));
    await page.waitForTimeout(400);
    const [km, a] = [await readKeyMetrics(page), await getAnalysis(page)];
    for (const c of keyMetricsAgainst(km, a).filter((x) => /Earth/.test(x.what))) check(c.what, c.shown, c.expected, c.pass);
  }, { shot: 'scenario-3-earthset', timeout: 600_000 });
}

async function closeCompare(page) {
  if (await page.evaluate(() => document.querySelector('.cmp-sheet')?.hidden !== false)) return;
  await page.locator('.cmp-sheet').focus();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('.cmp-sheet')?.hidden, null, { timeout: 10_000 });
}

// ------------------------------------------------------------------ main

async function openApp(app, step) {
  const { page } = app;
  await step('Open the app', 'control', async ({ check, note }) => {
    await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.lunyx, null, { timeout: 120_000, polling: 100 });
    note(`Ready ${app.stamp()} ms after navigation.`);
    const info = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const s = window.lunyx.store.get();
      return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown', actions: window.lunyx.actions.listActions().map((a) => a.name), timeUtc: new Date(s.timeMs).toISOString(), view: s.view, wordmark: document.querySelector('.wordmark')?.textContent };
    });
    app.report.renderer = info.renderer;
    app.report.build.actions = info.actions.length;
    app.report.build.actionNames = info.actions;
    note(`Renderer: ${info.renderer}. ${info.actions.length} actions registered. Simulated time at start ${info.timeUtc}.`);
    check('Wordmark shows LUNYX', info.wordmark, 'LUNYX', info.wordmark === 'LUNYX');
    check('Starts in the globe view', info.view, 'globe', info.view === 'globe');
  }, { shot: 'open' });
}

const report = {
  commit: sha,
  label: opt('label', ''),
  appSourceClean: git('status --porcelain -- src public index.html package.json') === '',
  startedUtc: new Date().toISOString(),
  gl: GL,
  parts: [...parts],
  load: { before: execSync('cat /proc/loadavg').toString().trim() },
  profiles: {},
  values: [],
  replies: [],
};
log(`walkthrough @ ${sha}${report.label ? ` (${report.label})` : ''}, GL=${GL}, profiles ${profiles.join(', ')}, parts ${[...parts].join(', ')}, out ${out}`);
const srv = await servers();
const browser = await launch();
report.glMode = rendering.mode;
report.glRenderer = rendering.renderer;
try {
  for (const profile of profiles) {
    const t0 = Date.now();
    log(`-- ${profile}`);
    const app = await openPage(browser, `${srv.deterministic}/`, profile);
    app.profile = profile;
    app.shotDir = join(out, 'shots', profile);
    app.extraShots = [];
    const pr = { steps: [], load: execSync('cat /proc/loadavg').toString().trim(), build: {} };
    app.report = { steps: pr.steps, values: report.values, replies: report.replies, build: pr.build };
    const step = makeStepper({ app, report: pr, shotDir: app.shotDir, log });
    try {
      const mine = partsFor(profile);
      pr.parts = [...mine];
      await openApp(app, step);
      if (mine.has('search')) await partSearch(app, step);
      if (mine.has('surface')) await partSurface(app, step);
      if (mine.has('assistant')) await partAssistant(app, step);
      if (mine.has('extras')) await partExtras(app, step);
      if (mine.has('scenario')) await partScenario(app, step);
      await step('Elevation downloads (T-40, Q-6): every .lxg file arrived, nothing "could not be loaded"', 'control', async ({ check, note }) => {
        const failed = app.diag.failed.filter((f) => /\.lxg\b/.test(f.url));
        const said = await app.page.evaluate(() => (document.body.innerText.match(/[^.\n]*could not be loaded[^.\n]*/gi) ?? []).slice(0, 5));
        const logged = app.diag.console.filter((c) => /could not be loaded/i.test(c.text));
        check('No elevation file failed to download', failed.map((f) => `${f.url.split('/').pop()} ${f.error}`).join(', ') || 'none', 'none', failed.length === 0, { finding: 'Q-6' });
        check('Nothing on screen says "could not be loaded"', said.join(' | ') || 'none', 'none', said.length === 0, { finding: 'Q-6' });
        if (logged.length) note(`Console: ${logged.map((c) => c.text).join(' | ').slice(0, 400)}`);
      });
    } catch (err) {
      log(`walk aborted: ${err?.stack ?? err}`);
      pr.aborted = String(err?.message ?? err);
    }
    pr.renderer = app.report.renderer;
    pr.pin = app.report.pin;
    pr.extraShots = app.extraShots;
    pr.ms = Date.now() - t0;
    pr.hosts = [...app.diag.hosts].sort();
    pr.failedRequests = app.diag.failed;
    pr.httpErrors = app.diag.http;
    pr.consoleAll = app.diag.console;
    report.profiles[profile] = pr;
    await app.context.close();
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  }
} finally {
  report.load.after = execSync('cat /proc/loadavg').toString().trim();
  report.finishedUtc = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 1));
  await browser.close().catch(() => {});
  await srv.stop();
}
const all = Object.values(report.profiles).flatMap((p) => p.steps);
const checks = all.flatMap((s) => s.checks);
// A check marked `pending` waits for a fix the owners have announced (named in qa-findings.md): when it
// fails it is counted apart, not as a failure.
const pending = checks.filter((c) => !c.pass && c.pending);
log(`done: ${all.filter((s) => s.ok).length}/${all.length} steps ran, ${checks.filter((c) => c.pass).length}/${checks.length} checks passed${pending.length ? `, ${pending.length} pending (${[...new Set(pending.map((c) => c.what))].join('; ')})` : ''}. ${out}/report.json`);
