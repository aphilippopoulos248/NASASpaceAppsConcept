// Local UI regressions: use E2E_BASE_DETERMINISTIC to reuse a running preview.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { act, closeBrowser, openApp, SLOW, until } from './lib/app.mjs';

let app, page;
before(async () => {
  assert.ok(process.env.E2E_BASE_DETERMINISTIC, 'Set E2E_BASE_DETERMINISTIC to the local preview URL');
  app = await openApp(process.env.E2E_BASE_DETERMINISTIC);
  page = app.page;
  assert.equal((await act(page, 'selectSite', { site: 'apollo-15', surface: true })).ok, true);
}, SLOW);
after(async () => { await app?.close(); await closeBrowser(); });

test('every surface panel folds, moves with pointer and keyboard, and stays reachable after resizing', SLOW, async () => {
  const panels = [
    ['.km', 'Key metrics'], ['.skc', 'Skyline chart'], ['.surface-hud', 'Surface controls'],
    ['.time-scrubber', 'Time'], ['.locator', 'Locator map'],
    ['.cmp-sheet', 'Compare'], ['.assistant-drawer', 'Assistant'],
  ];
  for (const [selector, title] of panels) {
    if (title === 'Compare') await act(page, 'openCompare');
    if (title === 'Assistant') await act(page, 'setAssistantOpen', { open: true });
    const panel = page.locator(selector);
    const grip = panel.getByRole('button', { name: `Move ${title} panel`, exact: true });
    await grip.focus();
    await page.keyboard.press('ArrowRight'); // Raise above panels moved earlier.
    const fold = title === 'Key metrics' ? panel.locator('.km-head button:not(.sp-grip)') : panel.locator('.sp-fold');
    await fold.click();
    assert.equal(await fold.getAttribute('aria-expanded'), 'false', title);
    assert.ok((await panel.boundingBox()).height < 90, `${title} should collapse to its header`);
    const start = await grip.boundingBox();
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(650, 150, { steps: 4 });
    await page.mouse.up();
    assert.ok(await panel.evaluate(e => e.classList.contains('sp-positioned')), title);
    await grip.focus();
    const before = await panel.boundingBox();
    await page.keyboard.press('ArrowDown');
    const moved = await panel.boundingBox();
    assert.ok(moved.y >= before.y + 9, `${title} keyboard move`);
    await fold.click();
    assert.equal(await fold.getAttribute('aria-expanded'), 'true', title);
    if (title === 'Compare') await act(page, 'stopCompare');
    if (title === 'Assistant') await act(page, 'setAssistantOpen', { open: false });
  }
  await page.setViewportSize({ width: 820, height: 600 });
  await until(page, () => [...document.querySelectorAll('.sp-positioned')].every(e => {
    const r = e.getBoundingClientRect();
    if (!r.height || e.getAttribute('aria-hidden') === 'true') return true;
    return r.x >= 7 && r.y >= 7 && r.right <= innerWidth - 7 && r.bottom <= innerHeight - 7;
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
});

test('leaving surface restores globe layout and reset unfolds and restores surface panels', SLOW, async () => {
  await act(page, 'exitSurface');
  assert.equal(await page.locator('.time-scrubber').evaluate(e => getComputedStyle(e).position), 'static');
  assert.equal(await page.locator('.time-scrubber .sp-toolbar').isVisible(), false);
  await act(page, 'selectSite', { site: 'apollo-15', surface: true });
  await act(page, 'showKeyMetrics', { open: false });
  await page.locator('.sp-reset').click();
  assert.equal(await page.locator('.sp-positioned').count(), 0);
  assert.equal(await page.locator('.sp-folded').count(), 0);
  assert.equal(await page.locator('.km-body').isVisible(), true);
  assert.deepEqual(app.problems, []);
});
