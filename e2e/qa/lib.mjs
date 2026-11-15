// Helpers for the QA walkthrough (tasks T-2 and T-8): a Chromium that can use this machine's GPU,
// the two desktop profiles (decision D-4: the desktop website only), screenshots as JPEG, and a
// step runner that records what each step did, how long it took, which actions it caused and
// what the page logged meanwhile.
//
// The waiting and action helpers of the legacy harness (e2e/lib/app.mjs) are reused as is.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import sharp from 'sharp';
import { launchChromium } from '../lib/app.mjs';

/** E2E_GL as in e2e/lib/app.mjs: auto (default: the GPU when Chromium gets one), gpu or swiftshader. */
export const GL = process.env.E2E_GL || 'auto';
/** What the browser renders with, once launch() has run: { mode: 'gpu' | 'swiftshader', renderer }. */
export const rendering = { mode: null, renderer: null };

/** Headless Chromium through the e2e harness's launcher; the renderer is recorded in `rendering`. */
export async function launch() {
  const { browser, mode, renderer } = await launchChromium(GL);
  Object.assign(rendering, { mode, renderer });
  console.log(`qa: Chromium renders with ${renderer ?? 'no WebGL'} (${mode}); run GPU runs under /tmp/lunyx-gpu.lock and software runs under /tmp/lunyx-heavy.lock (D-7)`);
  return browser;
}

/**
 * Desktop profiles (D-4). Each runs in a different time zone so that any use of local time in
 * the app would show up as a wrong date or hour (the app is meant to be UTC throughout).
 */
export const PROFILES = {
  '1280x720': { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, timezoneId: 'America/New_York' },
  '1920x1080': { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, timezoneId: 'Europe/Berlin' },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A page on `url` with diagnostics collected from the start. */
export async function openPage(browser, url, profileName, { reducedMotion = 'no-preference' } = {}) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile ${profileName}: use ${Object.keys(PROFILES).join(' or ')}`);
  const context = await browser.newContext({ ...profile, locale: 'en-US', reducedMotion });
  context.setDefaultTimeout(60_000);
  const page = await context.newPage();
  const diag = { console: [], hosts: new Set(), failed: [], http: [] };
  const t0 = Date.now();
  const stamp = () => Date.now() - t0;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') diag.console.push({ at: stamp(), type: m.type(), text: m.text().slice(0, 600) });
  });
  page.on('pageerror', (e) => diag.console.push({ at: stamp(), type: 'pageerror', text: String(e.stack ?? e.message).slice(0, 900) }));
  page.on('requestfailed', (r) => diag.failed.push({ at: stamp(), url: r.url().slice(0, 200), error: r.failure()?.errorText ?? '' }));
  page.on('response', (r) => {
    if (r.status() >= 400) diag.http.push({ at: stamp(), status: r.status(), url: r.url().slice(0, 200) });
  });
  page.on('request', (r) => {
    try {
      diag.hosts.add(new URL(r.url()).host);
    } catch {
      /* data: and blob: URLs */
    }
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, context, diag, stamp };
}

/** Screenshot of the whole viewport as JPEG (optionally scaled to `width`). */
export async function shot(page, file, { width } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const t0 = Date.now();
  const png = await page.screenshot({ type: 'png', timeout: 180_000 });
  let img = sharp(png);
  if (width) img = img.resize({ width });
  const info = await img.jpeg({ quality: 80, mozjpeg: true }).toFile(file);
  return { file, ms: Date.now() - t0, bytes: info.size, width: info.width, height: info.height };
}

/** A mouse drag with intermediate moves. */
export async function mouseDrag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/**
 * Resolves once the globe camera has arrived and then not moved for `quietMs`.
 *
 * First waits for the flight the app itself is making (GlobeView.arrived(), which resolves on
 * arrival or interruption), then for the camera to rest. The "at rest since" record is reset on
 * every call: an earlier version kept it between calls, so a call made right after a
 * setGlobeCamera, before the first frame of the flight, returned at once with the old position.
 */
export async function globeSettled(page, { quietMs = 700, timeout = 45_000 } = {}) {
  await page.evaluate(() => {
    window.__qaGlobeKey = undefined;
    return window.lunyx.scene.globe.arrived?.();
  });
  await page.waitForFunction(
    (quiet) => {
      const w = window;
      const c = w.lunyx.store.get().globeCenter;
      const key = `${c.lat.toFixed(4)},${c.lon.toFixed(4)},${c.altitudeKm.toFixed(1)}`;
      const now = performance.now();
      if (w.__qaGlobeKey !== key) {
        w.__qaGlobeKey = key;
        w.__qaGlobeSince = now;
        return false;
      }
      return now - w.__qaGlobeSince >= quiet;
    },
    quietMs,
    { polling: 100, timeout },
  );
}

/** Resolves when the analysis of what the app state asks for (slot) is ready or failed. */
export async function analysisSettled(page, slot = 'current', timeout = 180_000) {
  await page.waitForFunction(
    (s) => {
      const a = window.lunyx.analysis;
      const st = a.get(s);
      const want = a.wanted(s);
      return Boolean(want) && (st.state === 'ready' || st.state === 'error') && st.scenario.id === want.id;
    },
    slot,
    { polling: 200, timeout },
  );
}

/** Resolves when the surface view is on screen with its ground loaded and a few frames drawn. */
export async function surfaceReady(page, timeout = 120_000) {
  await page.waitForFunction(
    () => {
      const w = window;
      const s = w.lunyx.scene.surface;
      if (w.lunyx.store.get().view !== 'surface' || !s.active || !s.view.ground) {
        w.__qaSurfaceSince = undefined;
        return false;
      }
      w.__qaSurfaceSince ??= performance.now();
      return performance.now() - w.__qaSurfaceSince > 1500;
    },
    null,
    { polling: 150, timeout },
  );
}

/** Frames per second measured in the page over `ms`. */
export function fps(page, ms = 2000) {
  return page.evaluate(
    (span) =>
      new Promise((ok) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          const dt = performance.now() - t0;
          if (dt >= span) ok(Math.round((n / dt) * 10000) / 10);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );
}

/** Parses a duration as the app writes it ("3 d 04 h", "5 h 12 min", "8 min", "none") into hours. */
export function parseDurationH(text) {
  if (/^none\b/.test(text)) return 0;
  const d = /(\d+)\s*d\b/.exec(text), h = /(\d+)\s*h\b/.exec(text), m = /(\d+)\s*min\b/.exec(text);
  if (!d && !h && !m) return NaN;
  return (d ? Number(d[1]) * 24 : 0) + (h ? Number(h[1]) : 0) + (m ? Number(m[1]) / 60 : 0);
}

/** First number in a text, with the typographic minus read as a minus. */
export function firstNumber(text) {
  const m = /[-−]?\d+(?:\.\d+)?/.exec(String(text).replace(/,(?=\d{3})/g, ''));
  return m ? Number(m[0].replace('−', '-')) : NaN;
}

/** All numbers in a text, typographic minus included. */
export function numbers(text) {
  return [...String(text).replace(/,(?=\d{3})/g, '').matchAll(/[-−]?\d+(?:\.\d+)?/g)].map((m) => Number(m[0].replace('−', '-')));
}

/**
 * Runs one walkthrough step with its own time limit and records it: how the step was done
 * ("control", "keyboard", "assistant", "action"), its checks, the actions it caused
 * (from the app's action log, with their origin), console output during the step and the
 * screenshot.
 */
export function makeStepper({ app, report, shotDir, shotWidth, log }) {
  let n = 0;
  return async function step(name, how, fn, { timeout = 120_000, shot: shotName = null } = {}) {
    const rec = { n: ++n, name, how, ok: false, ms: 0, checks: [], notes: [], actions: [], console: [] };
    const t0 = Date.now();
    const consoleFrom = app.diag.console.length;
    const seqFrom = await app.page.evaluate(() => window.lunyx?.actions.actionLog().at(-1)?.seq ?? 0).catch(() => 0);
    const check = (what, shown, computed, pass, extra = {}) => {
      rec.checks.push({ what, shown, computed, pass: Boolean(pass), ...extra });
      return pass;
    };
    const note = (text) => rec.notes.push(text);
    let timer;
    try {
      await Promise.race([
        fn({ check, note, rec }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`step timed out after ${timeout} ms`)), timeout);
        }),
      ]);
      rec.ok = true;
    } catch (err) {
      rec.error = String(err?.message ?? err).split('\n').slice(0, 3).join(' | ').slice(0, 700);
    } finally {
      clearTimeout(timer);
    }
    rec.ms = Date.now() - t0;
    rec.actions = await app.page
      .evaluate((from) => window.lunyx.actions.actionLog().filter((e) => e.seq > from).map((e) => ({ name: e.name, origin: e.origin, ok: e.ok, ...(e.ok ? {} : { error: e.error }) })), seqFrom)
      .catch(() => []);
    rec.console = app.diag.console.slice(consoleFrom);
    if (shotName) {
      try {
        rec.shot = await shot(app.page, `${shotDir}/${String(rec.n).padStart(2, '0')}-${shotName}.jpg`, { width: shotWidth });
      } catch (err) {
        rec.shotError = String(err?.message ?? err).split('\n')[0];
      }
    }
    report.steps.push(rec);
    const failed = rec.checks.filter((c) => !c.pass).length;
    log(`  ${rec.ok ? 'ok  ' : 'FAIL'} ${String(rec.n).padStart(2)} ${name} [${how}] ${rec.ms} ms${rec.checks.length ? `, checks ${rec.checks.length - failed}/${rec.checks.length}` : ''}${rec.error ? ` :: ${rec.error}` : ''}${rec.console.length ? `, console ${rec.console.length}` : ''}`);
    return rec;
  };
}
