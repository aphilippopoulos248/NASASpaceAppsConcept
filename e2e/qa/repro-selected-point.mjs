// Run against npm run dev: selected coordinates stay fixed; Drop pin applies both fields.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.lunyx && document.querySelector('#loading.done'), null, { timeout: 60000 });
  const panel = page.locator('.filters-panel');
  const lat = panel.getByLabel('Latitude', { exact: true });
  const lon = panel.getByLabel('Longitude', { exact: true });
  const drop = panel.getByRole('button', { name: 'Drop pin', exact: true });
  const selected = () => page.evaluate(() => window.lunyx.store.get().site);
  const fields = async () => [await lat.inputValue(), await lon.inputValue()];
  const defaultPin = await selected();
  assert.equal(defaultPin.lat, -90);
  assert(Math.abs(defaultPin.lon - 39.09) < 1e-9);
  assert.deepEqual(await fields(), ['-90.00', '39.09']);

  // Exercise real OrbitControls events: both gestures used to overwrite the fields.
  const before = await page.evaluate(() => window.lunyx.store.get().globeCenter);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(alt => window.lunyx.store.get().globeCenter.altitudeKm < alt - 1, before.altitudeKm);
  await page.mouse.down();
  await page.mouse.move(840, 520, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(lat => Math.abs(window.lunyx.store.get().globeCenter.lat - lat) > 0.01, before.lat);
  assert.deepEqual(await selected(), defaultPin);
  assert.deepEqual(await fields(), ['-90.00', '39.09']);

  // Typing, tabbing out, camera flights and other filters must all preserve a coordinate draft.
  const target = { lat: -85.12345, lon: 39.09023 };
  await lat.fill(String(target.lat));
  await lat.press('Tab');
  await lon.fill(String(target.lon));
  await lon.press('Tab');
  await page.evaluate(async () => {
    await window.lunyx.actions.runAction('setGlobeCamera', { lat: -40, lon: 80, altitudeKm: 1000 });
    await window.lunyx.actions.runAction('setSunBand', { minDeg: 5, maxDeg: 80 });
    await window.lunyx.scene.globe.arrived();
  });
  assert.deepEqual(await selected(), defaultPin);
  assert.deepEqual(await fields(), [String(target.lat), String(target.lon)]);

  await drop.click();
  await page.evaluate(() => window.lunyx.scene.globe.arrived());
  await page.waitForFunction(({ lat, lon }) => {
    const s = window.lunyx.store.get();
    return Math.abs(s.globeCenter.lat - lat) < 0.001 && Math.abs(s.globeCenter.lon - lon) < 0.001 && s.globeCenter.altitudeKm < 42 && window.lunyx.scene.globe.pin.visible;
  }, target);
  const pinned = await selected();
  assert.equal(pinned.lat, target.lat);
  assert(Math.abs(pinned.lon - target.lon) < 1e-9);
  assert.deepEqual(await fields(), ['-85.12', '39.09']);
  // Clicking again preserves the stored precision behind the two-decimal display.
  await drop.click();
  await page.evaluate(() => window.lunyx.scene.globe.arrived());
  assert.deepEqual(await selected(), pinned);

  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => window.lunyx.store.get().globeCenter.altitudeKm > 45);
  assert.deepEqual(await selected(), pinned);
  assert.deepEqual(await fields(), ['-85.12', '39.09']);

  // An actual point selection updates the fields even if the camera does not move.
  await page.mouse.click(780, 430);
  await page.waitForFunction(id => window.lunyx.store.get().site.id !== id, pinned.id);
  const picked = await selected();
  assert.deepEqual(await fields(), [picked.lat.toFixed(2), picked.lon.toFixed(2)]);
  await lat.fill('91');
  await drop.click();
  assert.equal(await lat.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(await selected(), picked);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ defaultSurvivesZoomAndDrag: true, draftsSurviveCameraAndFocusChanges: true, dropPinUsesBothFields: true, cameraShowsPin: true, precisionPreserved: true, newSelectionUpdatesFields: true, invalidPointRejected: true, errors }));
} finally { await browser.close(); }
