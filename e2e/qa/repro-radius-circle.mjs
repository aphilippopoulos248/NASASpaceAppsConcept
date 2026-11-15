// Run against npm run dev: the default south-pole search is a full radius circle.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.lunyx && document.querySelector('#loading.done'), null, { timeout: 60000 });
  if (await page.locator('.intro-enter').isVisible()) {
    await page.locator('.intro-enter').click();
    await page.waitForFunction(() => document.body.dataset.phase === 'app' && window.lunyx.scene.globe.introPresentation === 'done');
  }
  const panel = page.locator('.filters-panel');
  assert.equal(await panel.getByLabel('Latitude', { exact: true }).inputValue(), '-90.00');
  assert.equal(await panel.getByLabel('Longitude', { exact: true }).inputValue(), '39.09');
  await panel.getByLabel('Search radius', { exact: true }).fill('2000');
  await panel.getByLabel('Sample spacing', { exact: true }).fill('600');
  await panel.getByRole('button', { name: 'Find best landing sites', exact: true }).click();
  await page.evaluate(() => window.lunyx.scene.globe.arrived());
  await page.waitForFunction(() => window.lunyx.scene.globe.landingSearch.ring?.geometry.getAttribute('position')?.count === 120);
  const circle = await page.evaluate(() => {
    const markers = window.lunyx.scene.globe.landingSearch;
    const geometry = markers.ring.geometry.getAttribute('position');
    const vertices = Array.from({ length: geometry.count }, (_, i) => [geometry.getX(i), geometry.getY(i), geometry.getZ(i)]);
    // Check actual rendered vertices, independent of the destination calculation.
    const unit = vertices.map(p => p.map(x => x / Math.hypot(...p)));
    const radii = unit.map(p => Math.atan2(Math.hypot(p[0], p[2]), -p[1]) * 1737400);
    const edges = unit.map((p, i) => Math.hypot(...p.map((x, j) => x - unit[(i + 1) % unit.length][j])) * 1737400);
    return {
      visible: markers.ring.visible && markers.root.visible,
      uniqueVertices: new Set(vertices.map(p => p.map(x => x.toFixed(8)).join(','))).size,
      minRadiusM: Math.min(...radii), maxRadiusM: Math.max(...radii),
      minEdgeM: Math.min(...edges), maxEdgeM: Math.max(...edges),
    };
  });
  assert(circle.visible);
  assert.equal(circle.uniqueVertices, 120);
  assert(Math.abs(circle.minRadiusM - 2000) < 0.01);
  assert(Math.abs(circle.maxRadiusM - 2000) < 0.01);
  assert(circle.maxEdgeM - circle.minEdgeM < 0.01);
  await page.waitForFunction(() => document.querySelector('.fp-landing-search')?.getAttribute('aria-busy') === 'false', null, { timeout: 180000 });
  const status = await panel.locator('.fp-search-status').textContent();
  assert.equal(status, '');
  const points = await page.evaluate(() => window.lunyx.scene.globe.landingSearch.badges.map(({ point }) => point));
  assert(points.length > 0);
  for (const { evaluation: { site } } of points) {
    assert((90 + site.lat) * Math.PI / 180 * 1737400 <= 2000 + 0.01);
  }
  await page.screenshot({ path: 'scripts/.cache/radius-circle.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ circle, status, resultMarkers: points.length, errors }));
} finally { await browser.close(); }
