// Intro / main-menu overlay: skipped under reduced motion (the e2e default) and destination
// deep links; with motion allowed it shows over the live globe and Enter reveals the HUD.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeBrowser, openApp, SLOW, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

let srv;
before(async () => {
  srv = await servers();
}, SLOW);
after(async () => {
  await closeBrowser();
  await srv?.stop();
});

describe('intro presentation phase', () => {
  test('reduced motion (e2e default) lands on the app HUD with no intro dialog', SLOW, async () => {
    const app = await openApp(srv.deterministic);
    try {
      const page = app.page;
      assert.equal(await page.evaluate(() => document.body.dataset.phase), 'app');
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'globe');
      assert.equal(await page.locator('.intro:not([hidden])').count(), 0);
      assert.equal(await page.locator('#shell').getAttribute('inert'), null);
      assert.ok(await page.locator('.filters-panel').isVisible());
    } finally {
      await app.close();
    }
  });

  test('a destination deep link skips the intro even with motion on', SLOW, async () => {
    const app = await openApp(srv.deterministic, { reducedMotion: 'no-preference', query: '?site=apollo-11' });
    try {
      const page = app.page;
      assert.equal(await page.evaluate(() => document.body.dataset.phase), 'app');
      assert.equal(await page.locator('.intro:not([hidden])').count(), 0);
      const site = await page.evaluate(() => window.lunyx.store.get().site?.id);
      assert.equal(site, 'apollo-11');
    } finally {
      await app.close();
    }
  });

  test('with motion on, Enter the Moon crossfades into the globe HUD', SLOW, async () => {
    const app = await openApp(srv.deterministic, { reducedMotion: 'no-preference' });
    try {
      const page = app.page;
      await until(page, () => document.body.dataset.phase === 'intro' && Boolean(document.querySelector('.intro-enter')));
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'globe');
      assert.equal(await page.locator('#shell').getAttribute('inert'), '');
      await until(page, () => Boolean(window.lunyx.scene.globe.introStation));
      assert.equal(await page.evaluate(() => window.lunyx.scene.globe.introStation.visible), true);
      assert.equal(await page.evaluate(() => window.lunyx.scene.globe.markers.root.visible), false);
      assert.equal(await page.evaluate(() => window.lunyx.scene.globe.markers.revealProgress), 0);
      await page.locator('.intro-enter').click();
      await until(page, () => document.body.dataset.phase === 'app');
      await until(page, () => window.lunyx.scene.globe.markers.revealProgress > 0);
      assert.equal(await page.evaluate(() => window.lunyx.scene.globe.introStation.visible), false);
      assert.equal(await page.evaluate(() => window.lunyx.scene.globe.markers.root.visible), true);
      await until(page, () => window.lunyx.scene.globe.markers.revealProgress === Infinity);
      await until(page, () => window.lunyx.scene.globe.flags?.revealProgress > 0);
      await until(page, () => window.lunyx.scene.globe.flags?.revealProgress === Infinity);
      assert.equal(await page.locator('.intro:not([hidden])').count(), 0);
      assert.equal(await page.locator('#shell').getAttribute('inert'), null);
      assert.ok(await page.locator('.filters-panel').isVisible());
      assert.equal(await page.evaluate(() => document.body.dataset.view), 'globe');
    } finally {
      await app.close();
    }
  });
});
