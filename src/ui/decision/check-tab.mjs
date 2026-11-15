// Browser check of the "Rank sites" tab (T-74) at the two desktop sizes (D-9): the built app,
// the real decision tools, driven through the tab's own controls. It saves screenshots and fails
// on page errors, unnamed controls, text below WCAG AA contrast in the tab, or a control that ran
// anything other than a registered action.
//
//   npm run build
//   flock /tmp/lunyx-gpu.lock node src/ui/decision/check-tab.mjs [out-dir]     (GPU, D-11)
//
// E2E_GL=gpu insists on the GPU (see e2e/lib/app.mjs). Default out-dir: scripts/.cache/decision-ui
// (git-ignored). Not part of npm test: it needs the build and a browser.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, closeBrowser, openApp, rendering, until } from '../../../e2e/lib/app.mjs';
import { ROOT, startPreview } from '../../../e2e/lib/servers.mjs';

const args = process.argv.slice(2);
const fakeAt = args.indexOf('--fake');
// --fake <file>: a stand-in for the tools, only to look at the layout before they exist. Never for a hand-over.
const fake = fakeAt >= 0 ? args.splice(fakeAt, 2)[1] : null;
const OUT = args[0] ?? join(ROOT, 'scripts', '.cache', 'decision-ui');
const SIZES = [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }];
const LONG = 15 * 60_000;
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

/** Controls in the accessibility tree of the sheet without a name (as e2e/a11y.test.mjs checks). */
async function unnamedControls(page) {
  const roles = new Set(['button', 'link', 'textbox', 'combobox', 'slider', 'checkbox', 'spinbutton', 'switch', 'listbox', 'searchbox', 'radio', 'menuitem', 'tab']);
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  await cdp.detach();
  return nodes.filter((n) => !n.ignored && roles.has(n.role?.value) && !(n.name?.value ?? '').trim()).map((n) => `${n.role.value} #${n.backendDOMNodeId}`);
}

/** Visible text in `selector` below WCAG AA against the sheet over black space and over bright Moon (as e2e/a11y.test.mjs checks). */
function lowContrast(page, selector) {
  return page.evaluate((sel) => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const lum = ({ r, g, b }) => [r, g, b].map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const background = (el, backdrop) => {
      const layers = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (c && c.a === 1) break;
      }
      return layers.reverse().reduce((acc, l) => over(l, acc), backdrop);
    };
    const out = [];
    for (const root of document.querySelectorAll(sel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!n.textContent.trim() || !el) continue;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"], :disabled, .ly-visually-hidden')) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        let alpha = fg.a;
        for (let e = el; e; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
        const need = parseFloat(cs.fontSize) >= 24 ? 3 : 4.5;
        const worst = Math.min(...[{ r: 0, g: 0, b: 0, a: 1 }, { r: 235, g: 235, b: 235, a: 1 }].map((bd) => {
          const bg = background(el, bd);
          return ratio(over({ ...fg, a: alpha }, bg), bg);
        }));
        if (worst < need) out.push(`${worst.toFixed(2)}:1 "${n.textContent.trim().slice(0, 40)}" <${el.tagName.toLowerCase()} class="${el.className}">`);
      }
    }
    return [...new Set(out)];
  }, selector);
}

const shot = async (page, dir, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir, `${name}.jpg`), type: 'jpeg', quality: 82 });
  console.log(`     saved ${join(dir, `${name}.jpg`)}`);
};
const scrollTo = (page, selector) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), selector);
const tab = (page) => page.locator('.cmp-tabpanel:not([hidden])');

async function run(base, size) {
  const dir = join(OUT, `${size.width}x${size.height}`);
  mkdirSync(dir, { recursive: true });
  console.log(`\n== ${size.width}x${size.height}`);
  const app = await openApp(base, { viewport: size, scale: 1 });
  const { page } = app;
  try {
    if (fake) {
      await page.addScriptTag({ path: fake });
      await page.evaluate(() => window.__decisionFake());
    }
    const startSeq = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
    const r = await act(page, 'selectSite', { site: 'im-2', fly: false });
    check(r.ok, `IM-2 is the site on screen (${r.ok ? 'selectSite' : r.error})`);

    // Into the panel and the tab the way a person goes: the launcher, then the tab.
    await page.locator('.cmp-launcher').click();
    await page.locator('.cmp-sheet').getByRole('tab', { name: 'Rank sites' }).click();
    await until(page, () => document.querySelectorAll('.cmp-tabpanel:not([hidden]) .dec-select option').length > 0 && !document.querySelector('.cmp-tabpanel:not([hidden]) .dec-req input').disabled);
    const profiles = await tab(page).locator('.dec-select option').allTextContents();
    check(profiles.length >= 1, `the profile picker lists ${profiles.length} profile(s): ${profiles.join(' | ')}`);
    await shot(page, dir, '01-profile-and-candidates');

    // The catalogue, ranked from the tab's button.
    await tab(page).getByRole('button', { name: 'Rank sites' }).click();
    await until(page, () => Boolean(document.querySelector('.cmp-tabpanel:not([hidden]) .cmp-progress:not([hidden])')) || Boolean(document.querySelector('.cmp-tabpanel:not([hidden]) .dec-results:not([hidden])')), undefined, 60_000);
    if (await tab(page).locator('.cmp-progress:not([hidden])').count()) await shot(page, dir, '02-progress');
    const t0 = Date.now();
    await until(page, () => document.querySelector('.cmp-tabpanel:not([hidden]) .dec-results:not([hidden])') && document.querySelector('.cmp-tabpanel:not([hidden]) .cmp-progress').hidden, undefined, LONG);
    const summary = await tab(page).locator('.dec-summary').textContent();
    check(Boolean(summary?.trim()), `catalogue ranked in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${summary}`);
    const rows = await tab(page).locator('.dec-table--ranked tbody tr').count();
    const note = await tab(page).locator('.dec-utilitynote').textContent();
    check(/not a probability/i.test(note ?? ''), `the utility note is under the table: ${note}`);
    await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-results');
    await shot(page, dir, '03-ranking');

    // The reason of a badge, by keyboard.
    const firstBadge = tab(page).locator('.dec-badge').first();
    if (await firstBadge.count()) {
      await firstBadge.focus();
      await page.keyboard.press('ArrowRight');
      const tip = await page.evaluate(() => !document.querySelector('.cmp-tabpanel:not([hidden]) .dec-tip').hidden && document.activeElement?.classList.contains('dec-badge'));
      check(tip, 'a focused badge shows its reason; arrow keys move between badges');
      await shot(page, dir, '04-badge-reason');
    }

    // Two rows compared.
    const boxes = tab(page).locator('.dec-pickbox');
    if ((await boxes.count()) >= 2) {
      await boxes.nth(0).check();
      await boxes.nth(1).check();
      await until(page, () => document.querySelector('.cmp-tabpanel:not([hidden]) .dec-compare:not([hidden]) .dec-pairtable'), undefined, LONG);
      const head = await tab(page).locator('.dec-comparehead').textContent();
      check(Boolean(head?.trim()), `two picked rows compared: ${head}`);
      await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-compare');
      await shot(page, dir, '05-two-compared');
    } else check(rows >= 0, `fewer than two rows to pick (${await boxes.count()})`);

    // Unknown and infeasible sites with their reasons.
    const other = tab(page).locator('.dec-other:not([hidden])');
    if (await other.count()) {
      await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-other:not([hidden])');
      await shot(page, dir, '06-unknown-infeasible');
    }
    check(true, `${rows} ranked row(s), ${await tab(page).locator('.dec-other:not([hidden]) tbody tr').count()} unknown or infeasible row(s)`);

    // Loosening the slope limit asks first, then shows the relaxation everywhere.
    const slope = tab(page).getByRole('spinbutton', { name: /^Slope at most/ });
    const was = Number(await slope.inputValue());
    if (Number.isFinite(was) && was > 0) {
      await slope.fill(String(was + 5));
      await slope.dispatchEvent('change');
      await until(page, () => !document.querySelector('.cmp-tabpanel:not([hidden]) .dec-prompt').hidden);
      await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-section');
      await shot(page, dir, '07-safety-prompt');
      await tab(page).locator('.dec-prompt .dec-relax').click();
      await until(page, () => !document.querySelector('.cmp-tabpanel:not([hidden]) .dec-req.is-relaxed .dec-relaxed').hidden);
      const relaxed = await tab(page).locator('.dec-req.is-relaxed .dec-relaxed').textContent();
      const state = await page.evaluate(() => window.lunyx.store.get().decisionOverrides);
      check(state.allowSafetyRelaxation === true && state.thresholds?.slope === was + 5, `slope relaxed after the confirmation: "${relaxed}", overrides ${JSON.stringify(state)}`);
      await tab(page).getByRole('button', { name: 'Rank sites' }).click();
      await until(page, () => document.querySelector('.cmp-tabpanel:not([hidden]) .cmp-progress').hidden && document.querySelector('.cmp-tabpanel:not([hidden]) .dec-relaxations li'), undefined, LONG);
      await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-results');
      await shot(page, dir, '08-relaxed-ranking');
      await tab(page).getByRole('button', { name: "Use the profile's values" }).click();
      await until(page, () => Object.keys(window.lunyx.store.get().decisionOverrides).length === 0);
    }

    // Around the site on screen.
    await tab(page).getByRole('radio', { name: /Around the site on screen/ }).check();
    await tab(page).getByRole('spinbutton', { name: /^Radius/ }).fill('1000');
    await tab(page).getByRole('spinbutton', { name: /^Spacing/ }).fill('250');
    const before = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
    await tab(page).getByRole('button', { name: 'Rank sites' }).click();
    const t1 = Date.now();
    await until(page, (from) => window.lunyx.actions.actionLog().some((e) => e.seq > from && e.name === 'findBestSites'), before, LONG);
    const took = ((Date.now() - t1) / 1000).toFixed(1);
    await until(page, () => document.querySelector('.cmp-tabpanel:not([hidden]) .cmp-progress').hidden, undefined, LONG);
    const nearby = await tab(page).locator('.dec-summary').textContent();
    const errors = tab(page).locator('.cmp-status.is-error');
    const err = (await errors.count()) ? await errors.textContent() : '';
    check(!err, `nearby ranking around IM-2 in ${took} s: ${nearby}${err ? ` / error: ${err}` : ''}`);
    await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-results');
    await shot(page, dir, '09-nearby');

    // The buttons of a row run the existing actions: Pin (dropPin) or Open (selectSite), then As A / As B (saveScenario).
    const rowsNow = tab(page).locator('.dec-table--ranked tbody tr');
    if ((await rowsNow.count()) >= 2) {
      const [id1, id2] = [await rowsNow.nth(0).getAttribute('data-site'), await rowsNow.nth(1).getAttribute('data-site')];
      await rowsNow.nth(0).getByRole('button', { name: /^(Open|Pin) / }).click();
      await until(page, (id) => window.lunyx.store.get().site?.id === id, id1);
      check(true, `"Open"/"Pin" made row 1 the site on screen (${id1})`);
      await rowsNow.nth(0).getByRole('button', { name: /as scenario A$/ }).click();
      await until(page, (id) => window.lunyx.store.get().compareA?.site.id === id, id1);
      await rowsNow.nth(1).getByRole('button', { name: /as scenario B$/ }).click();
      await until(page, (id) => window.lunyx.store.get().compareB?.site.id === id && document.querySelector('.cmp-sheet [role="tab"][aria-selected="true"]')?.textContent === 'A and B', id2);
      check(true, `"As A" and "As B" filled the slots (${id1}, ${id2}) and opened the A and B tab`);
      await shot(page, dir, '10-as-a-and-b');
      await page.locator('.cmp-sheet').getByRole('tab', { name: 'Rank sites' }).click();
      await until(page, () => document.querySelector('.cmp-sheet [role="tab"][aria-selected="true"]')?.textContent === 'Rank sites');
    }

    // Beside the assistant drawer, the sheet is narrower.
    if ((await act(page, 'setAssistantOpen', { open: true })).ok) {
      await page.waitForTimeout(600);
      await scrollTo(page, '.cmp-tabpanel:not([hidden]) .dec-results');
      await shot(page, dir, '11-beside-the-assistant');
      const low2 = await lowContrast(page, '.cmp-tabpanel:not([hidden])');
      check(low2.length === 0, `contrast AA beside the drawer (${low2.join('; ') || 'all pass'})`);
      await act(page, 'setAssistantOpen', { open: false });
    }

    // Accessibility and D-3.
    check((await unnamedControls(page)).length === 0, `no unnamed controls (${(await unnamedControls(page)).join(', ') || 'none'})`);
    const low = await lowContrast(page, '.cmp-tabpanel:not([hidden])');
    check(low.length === 0, `contrast AA in the tab (${low.join('; ') || 'all pass'})`);
    const log = await page.evaluate((from) => window.lunyx.actions.actionLog().filter((e) => e.seq > from).map((e) => ({ name: e.name, origin: e.origin, ok: e.ok, registered: Boolean(window.lunyx.actions.getAction(e.name)), error: e.error, detail: e.params?.detail })), startSeq);
    const ui = log.filter((e) => e.origin === 'ui');
    check(ui.length > 0 && ui.every((e) => e.registered), `every control ran a registered action: ${[...new Set(ui.map((e) => e.name))].join(', ')}`);
    // F-12: the tab asks for whole evaluations when the tools offer a summary.
    const wanted = await page.evaluate(() => ['findBestSites', 'compareSites'].filter((n) => window.lunyx.actions.getAction(n)?.params.properties.detail));
    const asked = log.filter((e) => e.origin === 'ui' && wanted.includes(e.name));
    check(asked.every((e) => e.detail === 'full'), wanted.length ? `${wanted.join(' and ')} asked with detail "full" (${asked.length} calls)` : 'the tools have no detail parameter in this build (before F-12): none sent');
    const failed = ui.filter((e) => !e.ok);
    check(failed.length === 0, `no action from the tab failed${failed.length ? `: ${failed.map((e) => `${e.name}: ${e.error}`).join('; ')}` : ''}`);
    check(app.problems.length === 0, `no page or console errors${app.problems.length ? `: ${app.problems.join(' | ')}` : ''}`);
  } finally {
    await app.close();
  }
}

const srv = await startPreview({ LUNYX_LLM_PROVIDER: 'off' });
try {
  for (const size of SIZES) await run(srv.base, size);
} finally {
  console.log(`\nrenderer: ${rendering.renderer ?? 'unknown'} (${rendering.mode ?? '?'})${fake ? ' -- FAKE TOOLS: layout only' : ''}`);
  await closeBrowser();
  await srv.stop();
}
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
