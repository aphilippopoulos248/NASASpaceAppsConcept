// Run against npm run dev. Checks panel scroll, pinch isolation and canvas zoom.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.lunyx && document.querySelector('#loading.done'), null, { timeout: 60000 });
  await page.locator('#assistant-button').click();
  await page.locator('.assistant-drawer.is-open').waitFor();
  await page.locator('.ad-log').evaluate(log => {
    const text = document.createElement('p');
    text.style.flexShrink = '0';
    text.textContent = 'Scrollable conversation text. '.repeat(500);
    log.append(text);
    log.scrollTop = 0;
  });
  const radius = () => page.evaluate(() => window.lunyx.scene.globe.camera.position.length());
  const initial = await radius();
  const box = await page.locator('.ad-log').boundingBox();
  const overPanel = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(overPanel.x, overPanel.y);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector('.ad-log').scrollTop > 0);
  assert(Math.abs(await radius() - initial) < 1e-8, 'Conversation scroll must not zoom the globe');

  const dispatch = (selector, at, ctrlKey) => page.evaluate(({ selector, at, ctrlKey }) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, deltaY: -120, ctrlKey });
    document.querySelector(selector).dispatchEvent(event);
    return event.defaultPrevented;
  }, { selector, at, ctrlKey });
  assert(await dispatch('.ad-log p', overPanel, true), 'Trackpad pinch over assistant text must be cancelled');
  const inputBox = await page.locator('.ad-input').boundingBox();
  assert(await dispatch('.ad-input', { x: inputBox.x + 10, y: inputBox.y + 10 }, true), 'Pinch over the composer must be cancelled');
  assert(await dispatch('#scene', overPanel, false), 'A wheel gesture latched to the canvas must stop over the panel');
  assert(Math.abs(await radius() - initial) < 1e-8);

  // The same guard follows the popup after it is moved.
  const grip = await page.getByRole('button', { name: 'Move Assistant panel', exact: true }).boundingBox();
  await page.mouse.move(grip.x + 40, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(600, 110, { steps: 5 });
  await page.mouse.up();
  const moved = await page.locator('.ad-log').boundingBox();
  assert(await dispatch('#scene', { x: moved.x + 50, y: moved.y + 50 }, true));
  assert(Math.abs(await radius() - initial) < 1e-8);

  const viewportBefore = await page.evaluate(() => ({ width: innerWidth, scale: visualViewport.scale }));
  await page.mouse.move(moved.x + 50, moved.y + 50);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, scale: visualViewport.scale })), viewportBefore);

  await page.locator('.assistant-drawer').getByRole('button', { name: 'Close the assistant', exact: true }).click();
  await page.mouse.move(640, 400);
  assert.equal(await page.evaluate(() => document.elementFromPoint(640, 400)?.id), 'scene');
  await page.mouse.wheel(0, -300);
  await page.waitForFunction(before => window.lunyx.scene.globe.camera.position.length() < before - 1e-4, initial);
  const afterWheel = await radius();
  await dispatch('#scene', { x: 640, y: 400 }, true);
  assert(await radius() < afterWheel, 'Trackpad pinch still zooms the 3D scene');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ panelScroll: 'works', panelPinch: 'blocked', movedPanel: 'isolated', latchedWheel: 'blocked', browserZoomOverPanel: 'blocked', canvasWheelAndPinch: 'work', errors }));
} finally {
  await browser.close();
}
