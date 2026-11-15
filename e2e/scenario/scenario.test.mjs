// The three-step request of the brief (original T-1 / T-16, team task T-6), in Chromium against
// the built app, on bundled data only:
//
//   "Find a flatter nearby site with a shorter blackout, compare it against this pin for the
//    same dates, then show me the ridge at Earthset."
//
// The pin is a south-polar point inside the bundled 40 m elevation layer (88.0° S, 136.7° E).
// Each step is sent as a follow-up that has to use what the previous one left (the candidate,
// the same mission window); deterministic mode also gets the whole sentence at once. Every
// value the assistant reports is compared with the result of the action that produced it, and
// the end state (comparison, site, time, camera) is checked on screen.
//
// Two paths, reported separately:
//   - deterministic mode (no language model);
//   - the scripted test model with LUNYX_LLM_SCRIPT=scenario (not a language model: a fixed
//     policy that plays the steps from tool results through the real /api/assistant route).
// A real language model is not part of this file: see e2e/scenario/README.md for the command.
//
//   node --test e2e/scenario/scenario.test.mjs                 (after `npm run build`)
//   E2E_GPU=1 flock /tmp/lunyx-gpu.lock node --test e2e/scenario/scenario.test.mjs
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { renderer } from './gpu.mjs';
import { closeBrowser, lastSeq, openApp, SLOW, TIMEOUT, until } from '../lib/app.mjs';
import { servers, startPreview } from '../lib/servers.mjs';
import { PIN, SENTENCE, STEPS, WINDOW } from './setup.mjs';

const [STEP1, STEP2, STEP3] = STEPS;

const f1 = (v) => Number(v).toFixed(1);
const f2 = (v) => Number(v).toFixed(2);
/** As deterministic mode writes a distance. */
const distanceText = (m) => (Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const isoToText = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/** Sends a message through the drawer and waits for the turn to end; returns the reply and the assistant's log entries with results. */
async function send(page, text) {
  const from = await lastSeq(page);
  await page.locator('#assistant-input').fill(text);
  await page.locator('#assistant-input').press('Enter');
  await until(page, () => !window.lunyxAssistant.session.busy, undefined, 10 * TIMEOUT);
  return page.evaluate((from) => {
    const s = window.lunyxAssistant.session;
    const m = s.messages.filter((x) => x.role === 'assistant').at(-1);
    return {
      text: m?.text ?? '',
      source: m?.source ?? null,
      label: [...document.querySelectorAll('.am--assistant .am-source')].at(-1)?.textContent ?? '',
      entries: window.lunyx.actions.actionLog().filter((e) => e.seq > from).map(({ name, params, origin, ok, error, result }) => ({ name, params, origin, ok, error: error ?? null, result: result === undefined ? null : JSON.parse(JSON.stringify(result)) })),
    };
  }, from);
}

const run = (page, name, params = {}) => page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'test'), [name, params]);
const has = (page, name) => page.evaluate((n) => Boolean(window.lunyx.actions.getAction(n)), name);
const store = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.lunyx.store.get())));

/** The comparison, the site card, the clock and the camera as the screen shows them. */
function screen(page) {
  return page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const visible = (e) => Boolean(e && !e.hidden && e.offsetParent !== null);
    const sheet = q('.cmp-sheet');
    const panel = sheet ? [...sheet.querySelectorAll('[role="tabpanel"]')].find((p) => !p.hidden) : null;
    return {
      view: document.body.dataset.view,
      compare: sheet ? { open: !sheet.hidden, onScreen: visible(sheet), tab: [...sheet.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim() ?? null, text: panel?.textContent ?? '' } : null,
      card: visible(q('.site-card')) ? q('.site-card .sc-title')?.textContent : null,
      scrubberDate: q('.time-scrubber .ts-date')?.value ?? null,
      hud: q('.surface-hud .sh-status')?.textContent ?? '',
      explain: q('.skc .skc-explain') ? { shown: !q('.skc .skc-explain').hidden, text: q('.skc .skc-explain').textContent } : null,
    };
  });
}

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
    if (Date.now() > end) assert.fail(`${what}: not on screen. Last reading: ${JSON.stringify(last).slice(0, 1500)}`);
    await page.waitForTimeout(300);
  }
}

/** The pin and the window, set as a user would before asking (origin "test"). */
async function setUp(page) {
  for (const [name, params] of [['setAssistantOpen', { open: true }], ['stopCompare'], ['clearComparison'], ['exitSurface'], ['clearSite'], ['pause'], ['setDelay', { hours: 0 }], ['setMastHeight', { metres: 2 }]]) if (await has(page, name)) await run(page, name, params ?? {});
  assert.ok((await run(page, 'dropPin', { ...PIN, fly: true })).ok);
  assert.ok((await run(page, 'setMissionWindow', { ...WINDOW, moveClock: true })).ok);
  await until(page, () => document.getElementById('assistant-drawer')?.classList.contains('is-open') && !document.querySelector('.ad-mode')?.textContent.includes('Checking'));
  const s = await store(page);
  return { pinId: s.site.id, startMs: s.windowStartMs };
}

/** The candidate the request asks for, from the scan's own result. */
function expectedPick(scan) {
  const ref = scan.reference;
  return scan.candidates.find((c) => c.slopeDeg < ref.slopeDeg && c.longestDarknessH < ref.longestDarknessH) ?? null;
}

const named = (entries, name) => entries.find((e) => e.name === name && e.origin === 'assistant');

// ---------------------------------------------------------------- checks shared by both paths

async function checkStep1(page, r, pinId) {
  const scanEntry = named(r.entries, 'rankNearby');
  assert.ok(scanEntry?.ok, `rankNearby: ${scanEntry?.error ?? 'not run'}; reply: ${r.text}`);
  const scan = scanEntry.result;
  const pick = expectedPick(scan);
  assert.ok(pick, `no candidate is flatter with a shorter blackout than the pin (slope ${scan.reference.slopeDeg}°, darkness ${scan.reference.longestDarknessH} h); choose another pin or window`);
  assert.equal((await store(page)).site.id, pinId, 'finding a site does not move the pin');
  await shows(page, (s) => s.compare?.open && s.compare.tab === 'Nearby sites', 'the scan on the "Nearby sites" tab');
  return { scan, pick };
}

async function checkStep2(page, r, { pinId, startMs, pick }) {
  const c = named(r.entries, 'compare');
  assert.ok(c?.ok, `compare: ${c?.error ?? 'not run'}; ran ${JSON.stringify(r.entries.map((e) => e.name))}`);
  const cmp = c.result;
  assert.equal(cmp.scenarioA.site.id, pinId, 'A is this pin');
  assert.equal(cmp.scenarioB.site.id, pick.id, 'B is the candidate from step 1');
  assert.equal(cmp.scenarioA.startUtc, cmp.scenarioB.startUtc, 'the same dates on both sides');
  assert.equal(Date.parse(cmp.scenarioA.startUtc), startMs, 'the dates of the mission window on screen');
  assert.equal(cmp.scenarioA.durationH, cmp.scenarioB.durationH);
  assert.equal(cmp.analysisA.state, 'ready');
  assert.equal(cmp.analysisB.state, 'ready');
  const s = await store(page);
  assert.equal(s.site.id, pick.id, 'the candidate is the selected site');
  assert.equal(s.comparing, true);
  await shows(page, (x) => x.compare?.tab === 'A and B' && x.compare.text.includes(cmp.A) && x.compare.text.includes(cmp.B), 'the A/B comparison on screen with both labels');
  // The panel shows the same figures (to one decimal; the result is rounded to two, so either neighbour of a .x5 is accepted).
  const forms = (v, f) => [...new Set([v - 0.005, v, v + 0.005].map(f))];
  const pct = (v) => `${v.toFixed(1).replace('-', '−')} %`;
  const signed = (v) => (Number(v.toFixed(1)) === 0 ? '0.0' : `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`);
  const want = [forms(cmp.analysisA.illuminationPct, pct), forms(cmp.analysisB.illuminationPct, pct), forms(cmp.analysisA.earthVisiblePct, pct), forms(cmp.analysisB.earthVisiblePct, pct), forms(cmp.diff.illuminationPct, (v) => `${signed(v)} points`)];
  await shows(page, (x) => want.every((alts) => alts.some((w) => x.compare.text.includes(w))), `the panel shows the reported figures ${JSON.stringify(want)}`);
  return cmp;
}

async function checkStep3(page, r, { pick, cmp }) {
  const j = named(r.entries, 'jumpToEvent');
  assert.ok(j?.ok, `jumpToEvent: ${j?.error ?? 'not run'}`);
  assert.equal(j.params.type, 'earthset');
  const jump = j.result;
  const b = named(r.entries, 'explainBlockage');
  assert.ok(b?.ok, `explainBlockage: ${b?.error ?? 'not run'}; ran ${JSON.stringify(r.entries.map((e) => e.name))}`);
  assert.equal(b.params.body, 'earth');
  const ridge = b.result;
  const look = named(r.entries, 'lookAt');
  assert.ok(look?.ok, `lookAt: ${look?.error ?? 'not run'}`);
  const s = await store(page);
  assert.equal(s.view, 'surface');
  assert.equal(s.site.id, pick.id, 'still the candidate');
  assert.equal(new Date(s.timeMs).toISOString().slice(0, 16), jump.timeUtc.slice(0, 16), 'the clock at the Earthset');
  assert.ok(Math.abs(((s.look.azDeg - ridge.bodyAzDeg + 540) % 360) - 180) < 0.6, `the camera faces Earth's azimuth: ${s.look.azDeg} vs ${ridge.bodyAzDeg}`);
  assert.equal(s.comparing, true, 'the comparison is still open');
  assert.equal(s.compareB.site.id, cmp.scenarioB.site.id);
  const shown = await shows(page, (x) => x.view === 'surface' && x.scrubberDate === jump.timeUtc.slice(0, 16) && x.explain?.shown && x.explain.text.includes(ridge.explanation), 'surface view at the Earthset, with the explanation on screen');
  return { jump, ridge, shown };
}

// ---------------------------------------------------------------- deterministic mode

describe('scenario: deterministic mode', () => {
  let srv, app, page, skip = null;
  before(async () => {
    srv = await servers();
    app = await openApp(srv.deterministic);
    page = app.page;
    const missing = [];
    for (const n of ['rankNearby', 'selectCandidate', 'compare', 'jumpToEvent', 'explainBlockage', 'lookAt']) if (!(await has(page, n))) missing.push(n);
    if (missing.length) skip = `this build has no ${missing.join(', ')}`;
  }, SLOW);
  after(async () => {
    await app?.close();
    await closeBrowser();
    await srv?.stop();
  });

  const ctx = {};
  test('renderer', SLOW, async (t) => t.diagnostic(`WebGL renderer: ${await renderer(page)}`));

  test('step 1: finds a flatter nearby site with a shorter blackout, and says so with the scan\'s numbers', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    Object.assign(ctx, await setUp(page));
    const r = await send(page, STEP1);
    assert.equal(r.label, 'Deterministic mode: no language model');
    Object.assign(ctx, await checkStep1(page, r, ctx.pinId));
    const { pick, scan } = ctx;
    const ref = scan.reference;
    t.diagnostic(`window ${WINDOW.startUtc} + ${WINDOW.durationH} h; pin slope ${ref.slopeDeg}°, longest darkness ${ref.longestDarknessH} h, sunlight ${ref.illuminationPct} %; ${scan.rankedCount} ranked of ${scan.scanned}; pick rank ${pick.rank} ${pick.name}: slope ${pick.slopeDeg}°, darkness ${pick.longestDarknessH} h, sunlight ${pick.illuminationPct} %, Earth's centre ${pick.earthVisiblePct} %`);
    assert.ok(r.text.includes(`Found a site with flatter and a shorter blackout: ${pick.name}`), r.text);
    assert.ok(r.text.includes(`slope ${f1(pick.slopeDeg)}° (this pin: ${f1(ref.slopeDeg)}°)`), r.text);
    assert.ok(r.text.includes(`longest darkness ${f1(pick.longestDarknessH)} h (this pin: ${f1(ref.longestDarknessH)} h)`), r.text);
    assert.ok(r.text.includes(`illumination ${f1(pick.illuminationPct)} %`) && r.text.includes(`Earth's centre in view ${f1(pick.earthVisiblePct)} %`), r.text);
    if (scan.basis) assert.ok(r.text.includes(scan.basis), 'the reply states what the scan rests on');
  });

  test('step 2: compares that site against this pin over the same mission window', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    assert.ok(ctx.pick, 'step 1 did not run');
    const r = await send(page, STEP2);
    assert.deepEqual(r.entries.filter((e) => e.origin === 'assistant').map((e) => e.name), ['getState', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare']);
    const cmp = (ctx.cmp = await checkStep2(page, r, ctx));
    t.diagnostic(`A ${cmp.A}: sunlight ${cmp.analysisA.illuminationPct} %, darkness ${cmp.analysisA.longestDarknessH} h; B ${cmp.B}: sunlight ${cmp.analysisB.illuminationPct} %, darkness ${cmp.analysisB.longestDarknessH} h; B minus A sunlight ${cmp.diff.illuminationPct} points`);
    for (const [tag, side] of [['A', cmp.analysisA], ['B', cmp.analysisB]]) {
      assert.ok(r.text.includes(`${tag}: ${cmp[tag]}: illumination ${f1(side.illuminationPct)} %, longest darkness ${f1(side.longestDarknessH)} h, Earth's centre in view ${f1(side.earthVisiblePct)} %, longest Earth-centre gap ${f1(side.longestEarthGapH)} h, slope ${f1(side.slopeDeg)}°.`), `${tag}: ${r.text}`);
    }
    const sg = (v) => `${v > 0 ? '+' : ''}${f1(v)}`;
    assert.ok(r.text.includes(`B minus A: illumination ${sg(cmp.diff.illuminationPct)} percentage points, longest darkness ${sg(cmp.diff.longestDarknessH)} h`), r.text);
  });

  test('step 3: moves to the Earthset and shows the ridge, with the explanation\'s numbers', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    assert.ok(ctx.cmp, 'step 2 did not run');
    const r = await send(page, STEP3);
    const { jump, ridge } = await checkStep3(page, r, ctx);
    t.diagnostic(`Earthset ${jump.timeUtc} (${jump.label}); ridge ${ridge.ridgeDistanceM} m away, ${ridge.ridgeHeightM} m, ${ridge.demName} ${ridge.demResolutionM} m; Earth ${ridge.bodyElDeg}° vs skyline ${ridge.skylineElDeg}°`);
    assert.ok(r.text.includes(`Moved the clock to the next Earthset: ${jump.label ? `${jump.label} ` : ''}${isoToText(jump.timeUtc)}`), r.text);
    assert.ok(r.text.includes(ridge.explanation), r.text);
    assert.ok(r.text.includes(`Ridge: ${distanceText(ridge.ridgeDistanceM)} away, ${Math.round(ridge.ridgeHeightM)} m above the reference sphere; clearance ${f2(ridge.clearanceDeg)}°.`), r.text);
    assert.ok(r.text.includes(`Elevation data: ${ridge.demName} (${ridge.demResolutionM} m).`), r.text);
    assert.match(r.text, /not a guarantee of a working radio link/);
  });

  test('the comparison stays visible in the surface view', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    const s = await screen(page);
    assert.ok(s.compare?.open && s.compare.onScreen, `the compare panel is ${s.compare?.open ? 'open but not on screen' : 'closed'} in the surface view`);
  });

  test('the whole sentence at once does the same', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    assert.ok(ctx.pick, 'the follow-ups did not run');
    const at = await setUp(page);
    const r = await send(page, SENTENCE);
    assert.deepEqual(r.entries.filter((e) => e.origin === 'assistant').map((e) => e.name), ['getState', 'rankNearby', 'getState', 'saveScenario', 'selectCandidate', 'saveScenario', 'compare', 'jumpToEvent', 'explainBlockage', 'getState', 'enterSurface', 'lookAt']);
    const scan = named(r.entries, 'rankNearby').result;
    const pick = expectedPick(scan);
    assert.equal(pick?.id, ctx.pick.id, 'the same candidate as the follow-ups chose');
    // The end state: what steps 2 and 3 leave on screen.
    const cmp = await checkStep2(page, r, { ...at, pick });
    await checkStep3(page, r, { pick, cmp });
  });

  test('the page raised no errors', SLOW, () => assert.deepEqual(app.problems, []));
});

// ---------------------------------------------------------------- scripted test model

describe('scenario: scripted test model through /api/assistant (LUNYX_LLM_SCRIPT=scenario)', () => {
  let srv, app, page, skip = null;
  before(async () => {
    srv = await startPreview({ LUNYX_LLM_PROVIDER: 'scripted', LUNYX_LLM_SCRIPT: 'scenario' });
    app = await openApp(srv.base);
    page = app.page;
    const missing = [];
    for (const n of ['rankNearby', 'selectCandidate', 'compare', 'jumpToEvent', 'explainBlockage', 'lookAt']) if (!(await has(page, n))) missing.push(n);
    if (missing.length) skip = `this build has no ${missing.join(', ')}`;
  }, SLOW);
  after(async () => {
    await app?.close();
    await closeBrowser();
    await srv?.stop();
  });

  const ctx = {};
  test('step 1 through the model route', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    Object.assign(ctx, await setUp(page));
    const r = await send(page, STEP1);
    assert.deepEqual(r.source, { kind: 'model', label: 'Scripted test model (not a language model)', provider: 'scripted' });
    Object.assign(ctx, await checkStep1(page, r, ctx.pinId));
    const { pick, scan } = ctx;
    for (const v of [pick.rank, pick.slopeDeg, scan.reference.slopeDeg, pick.longestDarknessH, scan.reference.longestDarknessH, pick.illuminationPct, pick.earthVisiblePct]) assert.ok(r.text.includes(String(v)), `${v} not in: ${r.text}`);
  });

  test('step 2: a follow-up that uses the candidate of step 1', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    assert.ok(ctx.pick, 'step 1 did not run');
    const r = await send(page, STEP2);
    assert.deepEqual(r.entries.filter((e) => e.origin === 'assistant').map((e) => e.name), ['saveScenario', 'selectCandidate', 'saveScenario', 'compare']);
    assert.equal(named(r.entries, 'selectCandidate').params.rank, ctx.pick.rank);
    const cmp = (ctx.cmp = await checkStep2(page, r, ctx));
    for (const v of [cmp.A, cmp.B, cmp.diff.illuminationPct, cmp.diff.longestDarknessH, cmp.diff.earthVisiblePct, cmp.analysisA.illuminationPct, cmp.analysisB.illuminationPct]) assert.ok(r.text.includes(String(v)), `${v} not in: ${r.text}`);
  });

  test('step 3: a follow-up at the candidate, ridge from explainBlockage', SLOW, async (t) => {
    if (skip) return t.skip(skip);
    assert.ok(ctx.cmp, 'step 2 did not run');
    const r = await send(page, STEP3);
    const { jump, ridge } = await checkStep3(page, r, ctx);
    for (const v of [jump.timeUtc, ridge.ridgeDistanceM, ridge.ridgeHeightM, ridge.demName, ridge.demResolutionM, ridge.bodyElDeg, ridge.skylineElDeg, ridge.clearanceDeg]) assert.ok(r.text.includes(String(v)), `${v} not in: ${r.text}`);
  });

  test('the page raised no errors', SLOW, () => assert.deepEqual(app.problems, []));
});
