// Run against npm run dev. Nearby real Sun/Earth events must remain individually clickable.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://localhost:5173/?site=pin:-90,39.09&t=2026-11-15T12:00Z', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.lunyx && document.querySelector('#loading.done'), null, { timeout: 60000 });
  const events = await page.evaluate(async () => {
    const st = await window.lunyx.analysis.settled('current');
    if (st.state !== 'ready') throw new Error(st.error || st.state);
    return st.value.events;
  });
  assert(events.length >= 4, 'fixture needs the nearby Earthrise and sunset');
  const marks = page.locator('.ts-marks button');
  assert.equal(await marks.count(), events.length);
  const separated = () => page.evaluate(() => {
    const track = document.querySelector('.ts-marks').getBoundingClientRect();
    const boxes = [...document.querySelectorAll('.ts-marks button')].map(m => m.getBoundingClientRect());
    return boxes.every((a, i) => a.left >= track.left - 0.1 && a.right <= track.right + 0.1 && boxes.every((b, j) => i === j || a.right + 3.9 <= b.left || b.right + 3.9 <= a.left || a.bottom <= b.top || b.bottom <= a.top));
  });
  for (const width of [1280, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => {
      const track = document.querySelector('.ts-marks').getBoundingClientRect();
      const boxes = [...document.querySelectorAll('.ts-marks button')].map(m => m.getBoundingClientRect());
      return boxes.every((a, i) => a.left >= track.left - 0.1 && a.right <= track.right + 0.1 && boxes.every((b, j) => i === j || a.right + 3.9 <= b.left || b.right + 3.9 <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    });
    assert(await separated(), `icons overlap at ${width}px`);
  }
  // Each displaced icon must still take the clock to its own original event, not its visual x coordinate.
  for (let i = 0; i < events.length; i++) {
    await marks.nth(i).click();
    await page.waitForFunction(t => !window.lunyx.store.get().playing && Math.abs(window.lunyx.store.get().timeMs - t) < 1, events[i].timeMs);
  }
  await page.locator('.time-scrubber').screenshot({ path: 'scripts/.cache/timeline-separated-icons.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ events: events.length, iconsSeparatedAtWidths: [1280, 390, 1440], exactEventTimesOnClick: true, errors }));
} finally { await browser.close(); }
