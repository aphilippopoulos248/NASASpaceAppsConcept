// Reproduction for the coordinate-entry defects in Filters > "Centre of view" (desktop, 1280x720),
// recorded in docs/lunyx/qa-findings.md as Q-1, Q-2 and Q-3:
//
//   Q-1  Latitude, Tab, longitude, Enter (the natural keyboard order): when the latitude field
//        loses focus it is refilled with the centre of the camera, which is still flying, and the
//        longitude commit then sends that in-flight latitude instead of the typed one.
//   Q-2  Type both, then press "Drop pin at centre" without waiting: the pin goes wherever the
//        camera is at the moment of the click, not to the typed coordinates.
//   Q-3  Poleward of 80.06 degrees the fly-to clamps the camera direction (|y| <= 0.985, then
//        normalised), so the view never centres on the typed latitude, and each further commit
//        of either field (which re-sends the displayed, already shifted latitude) moves it again.
//        Even typing both fields carefully, Enter after each and waiting for each flight, drops
//        the pin off the typed point.
//   Q-4  (side observation) The globe auto-rotates after load; its damped momentum keeps turning
//        the camera after the first flight has arrived, so a short first hop ends off in longitude.
//
//   flock /tmp/lunyx-heavy.lock node e2e/qa/repro-centre.mjs [--out <dir>]
//
// Needs a built dist/ (npm run build). Waits for each flight with the app's own promise
// (GlobeView.arrived()) and then for the camera to rest. Writes <out>/repro-centre.json.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, servers } from '../lib/servers.mjs';
import { GL, globeSettled, launch, openPage, rendering, sleep } from './lib.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--out');
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT }).toString().trim();
const sha = git('rev-parse --short HEAD');
const out = i >= 0 ? args[i + 1] : join(ROOT, 'e2e', 'qa', 'out', `repro-centre-${sha}`);
mkdirSync(out, { recursive: true });

const START = { lat: 8.37, lon: -0.06 };
const IM2 = { lat: -84.79, lon: 29.2, latText: '-84.79', lonText: '29.2' };

/** Where the fly-to ends for a requested latitude (globeView.ts flyTo: clamp y to 0.985, then normalise). */
const clampLat = (lat) => {
  const r = Math.PI / 180;
  const y = Math.sin(lat * r);
  if (Math.abs(y) <= 0.985) return lat;
  const c = Math.cos(lat * r);
  return (Math.sign(y) * Math.asin(0.985 / Math.hypot(c, 0.985))) / r;
};
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const kmPerDeg = (1737.4 * Math.PI) / 180;

const report = {
  commit: sha,
  appSourceClean: git('status --porcelain -- src public index.html package.json') === '',
  gl: GL,
  load: { before: execSync('cat /proc/loadavg').toString().trim() },
  startedUtc: new Date().toISOString(),
  flight: null,
  q4FirstFlight: null,
  resetMisses: [],
  q1Typing: [],
  q2DropPinRightAway: [],
  q3Careful: [],
  q3PoleClamp: [],
};
const srv = await servers();
const browser = await launch();
report.glMode = rendering.mode;
report.glRenderer = rendering.renderer;
try {
  const app = await openPage(browser, `${srv.deterministic}/`, '1280x720');
  const { page } = app;
  await page.waitForFunction(() => document.getElementById('loading')?.classList.contains('done') && window.lunyx, null, { timeout: 120_000 });
  report.renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
  });
  report.actions = await page.evaluate(() => window.lunyx.actions.listActions().length);
  const centre = () =>
    page.evaluate(() => {
      const c = window.lunyx.store.get().globeCenter;
      return { lat: Math.round(c.lat * 1e4) / 1e4, lon: Math.round(c.lon * 1e4) / 1e4 };
    });
  const run = (name, params) => page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'test'), [name, params]);
  const off = (c, t) => Math.abs(c.lat - t.lat) > 0.001 || Math.abs(c.lon - t.lon) > 0.001;
  const reset = async () => {
    await run('clearSite', {});
    for (let attempt = 1; ; attempt++) {
      await run('setGlobeCamera', START);
      await globeSettled(page);
      const c = await centre();
      if (!off(c, START)) return;
      report.resetMisses.push({ attempt, ended: c });
      if (attempt === 3) throw new Error(`reset did not reach the start: ${JSON.stringify(c)}`);
    }
  };
  const lat = page.getByLabel('Latitude', { exact: true });
  const lon = page.getByLabel('Longitude', { exact: true });
  const type = async (field, text, delay) => {
    await field.click();
    await field.fill('');
    await field.pressSequentially(text, { delay });
  };

  // Q-4: the first flight after load, a short hop while the globe still auto-rotates, then the
  // same hop again with the auto-rotation stopped.
  await sleep(3000);
  const hop = async () => {
    const from = await centre();
    const target = { lat: r4(from.lat), lon: r4(from.lon + 1) };
    await run('setGlobeCamera', target);
    await page.evaluate(() => window.lunyx.scene.globe.arrived());
    const atArrival = await centre();
    await globeSettled(page, { quietMs: 1500 });
    const settled = await centre();
    return { from, target, atArrival, settled, lonDriftAfterArrivalDeg: r4(settled.lon - atArrival.lon), lonErrorDeg: r4(settled.lon - target.lon) };
  };
  const autoRotating = await page.evaluate(() => window.lunyx.scene.globe.controls.autoRotate);
  report.q4FirstFlight = { autoRotatingBefore: autoRotating, first: await hop(), second: await hop() };

  // How long one flight takes (START to IM-2), for the record.
  await reset();
  let t0 = Date.now();
  await run('setGlobeCamera', { lat: IM2.lat, lon: IM2.lon });
  await page.evaluate(() => window.lunyx.scene.globe.arrived());
  report.flight = { from: START, to: { lat: IM2.lat, lon: IM2.lon }, arrivedMs: Date.now() - t0, ended: await centre(), predictedLat: r4(clampLat(IM2.lat)) };
  await globeSettled(page);

  // Q-1: latitude, Tab, longitude, Enter, at several typing speeds and pauses.
  for (const [keyMs, pauseMs] of [[0, 0], [80, 200], [150, 500], [250, 1200], [250, 4000]]) {
    await reset();
    t0 = Date.now();
    await type(lat, IM2.latText, keyMs);
    await lat.press('Tab');
    const tabAt = Date.now() - t0;
    await sleep(30);
    const latFieldRightAfterTab = await lat.inputValue();
    await sleep(pauseMs);
    await type(lon, IM2.lonText, keyMs);
    const latFieldAtEnter = await lat.inputValue();
    await lon.press('Enter');
    const enterAt = Date.now() - t0;
    await globeSettled(page);
    const ended = await centre();
    report.q1Typing.push({
      keyDelayMs: keyMs,
      pauseMs,
      msFromTabToEnter: enterAt - tabAt,
      typed: { lat: IM2.lat, lon: IM2.lon },
      latFieldRightAfterTab,
      latFieldAtEnter,
      ended,
      fields: { lat: await lat.inputValue(), lon: await lon.inputValue() },
      latErrorDeg: r4(ended.lat - IM2.lat),
      latErrorKm: Math.round(Math.abs(ended.lat - IM2.lat) * kmPerDeg * 10) / 10,
    });
  }

  // Q-2: type both, then press "Drop pin at centre" straight away (no Enter, no waiting).
  for (const keyMs of [0, 120]) {
    await reset();
    await type(lat, IM2.latText, keyMs);
    await lat.press('Tab');
    await type(lon, IM2.lonText, keyMs);
    await page.getByRole('button', { name: 'Drop pin at centre' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().site?.kind === 'custom', null, { timeout: 10_000 });
    const site = await page.evaluate(() => window.lunyx.store.get().site);
    await globeSettled(page);
    report.q2DropPinRightAway.push({ keyDelayMs: keyMs, typed: { lat: IM2.lat, lon: IM2.lon }, pin: { lat: site.lat, lon: site.lon, id: site.id }, centreAfter: await centre(), pinOffKm: Math.round(Math.hypot((site.lat - IM2.lat) * kmPerDeg, (site.lon - IM2.lon) * kmPerDeg * Math.cos((IM2.lat * Math.PI) / 180)) * 10) / 10 });
  }

  // Q-3, careful path: latitude + Enter, wait; longitude + Enter, wait; then the button.
  for (const p of [IM2, { lat: -89.45, lon: -137.2, latText: '-89.45', lonText: '-137.2' }, { lat: -70, lon: 10, latText: '-70', lonText: '10' }]) {
    await reset();
    await type(lat, p.latText, 60);
    await lat.press('Enter');
    await globeSettled(page);
    const afterLat = { centre: await centre(), latField: await lat.inputValue() };
    await type(lon, p.lonText, 60);
    await lon.press('Enter');
    await globeSettled(page);
    const afterLon = { centre: await centre(), latField: await lat.inputValue() };
    await page.getByRole('button', { name: 'Drop pin at centre' }).click();
    await page.waitForFunction(() => window.lunyx.store.get().site?.kind === 'custom', null, { timeout: 10_000 });
    const site = await page.evaluate(() => window.lunyx.store.get().site);
    report.q3Careful.push({
      typed: { lat: p.lat, lon: p.lon },
      afterLat,
      afterLon,
      pin: { lat: site.lat, lon: site.lon, id: site.id },
      pinLatErrorDeg: r4(site.lat - p.lat),
      pinLatErrorKm: Math.round(Math.abs(site.lat - p.lat) * kmPerDeg * 100) / 100,
      predicted: { afterLat: r4(clampLat(p.lat)), afterLon: r4(clampLat(Number(clampLat(p.lat).toFixed(2)))) },
    });
  }

  // Q-3, the clamp itself: ask for the exact point by action, then re-commit the longitude field
  // (unchanged value) three times; each commit re-sends the latitude the field displays.
  for (const [la, lo] of [[-84.79, 29.2], [-89.45, -137.2], [-88, 0], [-80.5, 10], [-79.9, 10], [84.79, 29.2]]) {
    await reset();
    await run('setGlobeCamera', { lat: la, lon: lo });
    await globeSettled(page);
    const steps = [{ after: 'setGlobeCamera (action)', centre: await centre(), latField: await lat.inputValue() }];
    let predicted = clampLat(la);
    const predictions = [r4(predicted)];
    for (let k = 0; k < 3; k++) {
      await type(lon, String(lo), 0);
      await lon.press('Enter');
      await globeSettled(page);
      steps.push({ after: `longitude ${lo} committed again (${k + 1})`, centre: await centre(), latField: await lat.inputValue() });
      predicted = clampLat(Number(predicted.toFixed(2)));
      predictions.push(r4(predicted));
    }
    report.q3PoleClamp.push({ asked: { lat: la, lon: lo }, steps, predictedLat: predictions });
  }
  report.console = app.diag.console;
  report.hosts = [...app.diag.hosts].sort();
  await app.context.close();
} finally {
  report.load.after = execSync('cat /proc/loadavg').toString().trim();
  report.finishedUtc = new Date().toISOString();
  writeFileSync(join(out, 'repro-centre.json'), JSON.stringify(report, null, 1));
  await browser.close().catch(() => {});
  await srv.stop();
}
console.log(JSON.stringify(report, null, 1));
