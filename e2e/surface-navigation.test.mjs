import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { closeBrowser, openApp, result, SLOW, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

let srv, app, page;
before(async () => {
  srv = await servers();
  app = await openApp(srv.deterministic);
  page = app.page;
}, SLOW);
after(async () => { await app?.close(); await closeBrowser(); await srv?.stop(); });

async function checkDropdowns() {
  const colours = await page.locator('select').evaluateAll((selects) => selects.map((select) => {
    const style = getComputedStyle(select);
    const options = [...select.querySelectorAll('option, optgroup')].map((option) => {
      const s = getComputedStyle(option);
      return [s.color, s.backgroundColor, s.colorScheme];
    });
    return { label: select.getAttribute('aria-label') || select.id, control: [style.color, style.backgroundColor, style.colorScheme], options };
  }));
  assert.ok(colours.length > 5, 'Check all dropdowns, including comparison and ranking controls');
  for (const select of colours) {
    assert.deepEqual(select.control, ['rgb(0, 0, 0)', 'rgb(255, 255, 255)', 'light'], select.label);
    for (const option of select.options) assert.deepEqual(option, select.control, `${select.label} option`);
  }
}

test('dropdowns use black on white and the 29.5-day default survives surface entry', SLOW, async () => {
  assert.equal(await page.locator('.ts-window').inputValue(), '708');
  await result(page, 'selectSite', { site: 'apollo-15', surface: true, atLanding: true });
  assert.equal(await page.locator('.ts-window').inputValue(), '708');
  await result(page, 'openCompare', { tab: 'rank' });
  await checkDropdowns();
  await result(page, 'stopCompare');
  await page.locator('.ts-window').selectOption('72');
  await result(page, 'exitSurface');
  await result(page, 'enterSurface');
  assert.equal(await page.locator('.ts-window').inputValue(), '72', 'Keep the chosen window on re-entry');
});

test('the yellow map dot follows WASD, direct moves and Return to site without moving the landing', SLOW, async () => {
  // Record the actual drawn dot, rather than just verifying that the position model changes.
  await page.evaluate(() => {
    const original = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function(x, y, radius, ...args) {
      if (this.canvas.classList.contains('locator-canvas') && radius === 3) window.locatorDot = { x, y };
      return original.call(this, x, y, radius, ...args);
    };
  });
  await result(page, 'walkTo', { eastM: 0, northM: 0 });
  await result(page, 'setLocatorZoom', { zoom: 16 });
  const dot = () => page.evaluate(() => window.locatorDot);
  const origin = await dot();
  const site = await page.evaluate(() => window.lunyx.store.get().site);
  await result(page, 'lookAt', { azDeg: 0, elDeg: 0 });
  await page.locator('#scene').focus();
  const before = await page.evaluate(() => window.lunyx.scene.surface.view.position);
  await page.keyboard.down('w');
  try {
    await until(page, (north) => window.lunyx.scene.surface.view.position.northM > north + 2, before.northM);
  } finally { await page.keyboard.up('w'); }
  await until(page, (y) => window.locatorDot.y < y - 1, origin.y);
  const moved = await dot();
  await page.keyboard.down('d');
  try {
    await until(page, (x) => window.locatorDot.x > x + 1, moved.x);
  } finally { await page.keyboard.up('d'); }
  await result(page, 'walkTo', { eastM: -100, northM: -100 });
  assert.notDeepEqual(await dot(), origin);
  await result(page, 'walkTo', { eastM: 0, northM: 0 });
  await until(page, (p) => Math.abs(window.locatorDot.x - p.x) < 0.1 && Math.abs(window.locatorDot.y - p.y) < 0.1, origin);
  assert.deepEqual(await page.evaluate(() => window.lunyx.store.get().site), site);
  assert.match(await page.locator('.locator-readout').textContent(), /^You /);
  assert.deepEqual(app.problems, []);
  await page.screenshot({ path: 'e2e/artifacts/surface-navigation.png' });
});
