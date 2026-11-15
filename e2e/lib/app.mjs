// Browser helpers for the end-to-end tests: one headless Chromium, pages that can only
// reach the local preview server (the app must work from bundled data), and small helpers
// to read the app's own state and results so assertions compare the screen with them.
//
// Headless Chromium draws WebGL in software, and this machine is often busy, so frames can
// take a second or more. Helpers therefore wait on conditions with timers (not on animation
// frames) and all timeouts are generous.
import { chromium } from 'playwright';

export const TIMEOUT = Number(process.env.E2E_TIMEOUT_MS ?? 180_000);
/** node:test options for a test that drives the browser. */
export const SLOW = { timeout: 6 * TIMEOUT };

let browserPromise = null;

export function browser() {
  browserPromise ??= chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

/**
 * A page with the app loaded.
 *   viewport      default 1280x720
 *   scale         device pixel ratio. Functional tests use 0.5: a quarter of the pixels to
 *                 shade, which keeps software rendering usable. Screenshots use 1.
 *   reducedMotion default 'reduce': the app then skips camera flights and fades, so the
 *                 end state of an action is there at once.
 *   offline       default true: every request that does not go to the preview server is
 *                 refused, and so are the two API routes that fetch from the internet
 *                 (/api/terrain, /api/horizons). What the tests see is bundled data only.
 */
export async function openApp(base, { viewport = { width: 1280, height: 720 }, scale = 0.5, reducedMotion = 'reduce', offline = true, query = '' } = {}) {
  const b = await browser();
  const context = await b.newContext({ viewport, deviceScaleFactor: scale, reducedMotion });
  context.setDefaultTimeout(TIMEOUT);
  const blocked = [];
  if (offline) {
    const origin = new URL(base).origin;
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local = url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:';
      if (local && !/^\/api\/(terrain|horizons)\b/.test(url.pathname)) return route.continue();
      blocked.push(route.request().url());
      return route.abort('internetdisconnected');
    });
  }
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|net::ERR_INTERNET_DISCONNECTED|GL Driver Message/.test(m.text())) problems.push(`console error: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${base}/${query}`, { waitUntil: 'domcontentloaded' });
  await until(page, () => Boolean(document.getElementById('loading')?.classList.contains('done') && window.lunyx && window.lunyxAssistant));
  return { page, context, problems, blocked, close: () => context.close() };
}

/** Waits until `fn` (run in the page) returns something truthy, checking on a timer. Returns that value. */
export async function until(page, fn, arg, timeout = TIMEOUT) {
  const handle = await page.waitForFunction(fn, arg, { polling: 150, timeout });
  return handle.jsonValue();
}

/** Runs an action in the page through the registry, as the UI and the assistant do. */
export function act(page, name, params = {}, origin = 'test') {
  return page.evaluate(([n, p, o]) => window.lunyx.actions.runAction(n, p, o), [name, params, origin]);
}

/** The result of a successful action; throws with the action's own message otherwise. */
export async function result(page, name, params = {}) {
  const r = await act(page, name, params);
  if (!r.ok) throw new Error(`${name} failed: ${r.error}`);
  return r.result;
}

/** The serialisable part of the app state. */
export function state(page) {
  return page.evaluate(() => {
    const s = window.lunyx.store.get();
    return JSON.parse(JSON.stringify(s));
  });
}

/** Entries of the action log added since `fromSeq`, without results (they can be large). */
export function log(page, fromSeq = 0) {
  return page.evaluate((from) => window.lunyx.actions.actionLog().filter((e) => e.seq > from).map(({ seq, name, params, origin, ok, error }) => ({ seq, name, params, origin, ok, error })), fromSeq);
}

export function lastSeq(page) {
  return page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
}

/**
 * Clicks like a user: Playwright scrolls to the element, checks that it is visible and not
 * covered, and sends real pointer events. `opts.force` skips the wait for the element to stop
 * moving, which needs two animation frames and is slow when frames take seconds.
 */
export async function click(page, selector, opts = {}) {
  await page.locator(selector).first().click({ timeout: TIMEOUT, ...opts });
}

/** Types into a field and commits it the way a person does (change fires on blur / Enter). */
export async function setField(page, selector, value) {
  const field = page.locator(selector).first();
  await field.fill(String(value));
  await field.dispatchEvent('change');
}

// ---------------------------------------------------------------- assistant drawer

export async function openAssistant(page) {
  if (!(await page.evaluate(() => window.lunyx.store.get().assistantOpen))) await click(page, '#assistant-button');
  await until(page, () => document.getElementById('assistant-drawer')?.classList.contains('is-open') && !document.querySelector('.ad-mode')?.textContent.includes('Checking'));
}

/** Sends a message through the drawer's text box and waits for the reply to finish. */
export async function ask(page, text) {
  const before = await page.evaluate(() => window.lunyxAssistant.session.messages.length);
  await page.locator('#assistant-input').fill(text);
  await page.locator('#assistant-input').press('Enter');
  await until(page, (n) => window.lunyxAssistant.session.messages.length >= n + 2 && !window.lunyxAssistant.session.busy, before);
  return page.evaluate(() => {
    const s = window.lunyxAssistant.session;
    const m = s.messages.filter((x) => x.role === 'assistant').at(-1);
    const shown = [...document.querySelectorAll('.am--assistant')].at(-1);
    return {
      text: m.text,
      source: m.source,
      note: m.note ?? null,
      failed: Boolean(m.failed),
      actions: m.actions.map((a) => ({ name: a.name, params: a.params, ok: a.ok, origin: a.origin, error: a.error ?? null, result: a.result ?? null })),
      // What the drawer actually shows for this reply.
      shownLabel: shown?.querySelector('.am-source')?.textContent ?? '',
      shownText: shown?.querySelector('.am-text')?.textContent ?? '',
      shownActions: [...(shown?.querySelectorAll('.am-action-title') ?? [])].map((e) => e.textContent),
    };
  });
}

/** Every number in a text, as written (sign and decimals kept). */
export function numbersIn(text) {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => m[0]);
}
