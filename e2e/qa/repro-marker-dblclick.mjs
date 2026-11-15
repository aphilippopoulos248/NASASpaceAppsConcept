// Q-9 reproduction (docs/lunyx/qa-findings.md): since the original T-64 a click on a landing marker
// shows its details and a double-click opens its surface view, and repeated slower clicks on
// overlapping markers take turns. So where two landings overlap (Apollo 11 and Surveyor 5 seen
// from 3,000 km), "click Apollo 11, read its card, then double-click it" opens Surveyor 5: the first
// click of the double-click counts as a slower click and moves on to the next landing.
//
//   npm run build
//   flock /tmp/lunyx-gpu.lock node e2e/qa/repro-marker-dblclick.mjs
//
// Desktop, 1280x720, bundled data. Prints the timeline; writes
// e2e/qa/out/repro-marker-dblclick-<sha>/result.json. Exits 1 while the double-click opens another
// landing than the one whose details were shown, 0 once it opens the same one.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, servers } from '../lib/servers.mjs';
import { globeSettled, launch, openPage, sleep, surfaceReady } from './lib.mjs';

const A11 = { id: 'apollo-11', lat: 0.6741, lon: 23.473 };
const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
const out = { commit: sha, appSourceClean: execSync('git status --porcelain -- src public index.html package.json', { cwd: ROOT }).toString() === '', startedUtc: new Date().toISOString(), timeline: [] };

const srv = await servers();
const browser = await launch();
try {
  const { page } = await openPage(browser, `${srv.deterministic}/`, '1280x720');
  await page.waitForFunction(() => window.lunyx && document.getElementById('loading')?.classList.contains('done'), null, { timeout: 120_000 });
  const snap = async (what) =>
    out.timeline.push({
      what,
      ...(await page.evaluate(() => {
        const s = window.lunyx.store.get();
        return { view: s.view, site: s.site?.id ?? null, card: document.querySelector('.site-card .sc-title')?.textContent.trim() ?? '' };
      })),
    });
  // Apollo 11 at the centre of view from 3,000 km, where its marker and Surveyor 5's overlap.
  await page.evaluate((a) => window.lunyx.actions.runAction('setGlobeCamera', { lat: a.lat, lon: a.lon, altitudeKm: 3000 }, 'test'), A11);
  await globeSettled(page);
  const p = await page.evaluate((siteId) => {
    const g = window.lunyx.scene.globe;
    const r = g.canvas.getBoundingClientRect();
    const at = (m) => {
      const v = m.group.position.clone().project(g.camera);
      return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
    };
    const target = at(g.markers.items.find((m) => m.landing.id === siteId));
    const near = g.markers.items.filter((m) => m.landing.id !== siteId && m.group.visible).map((m) => ({ id: m.landing.id, d: Math.round(Math.hypot(at(m).x - target.x, at(m).y - target.y)) })).filter((m) => m.d < 30);
    return { x: Math.round(target.x), y: Math.round(target.y), near };
  }, A11.id);
  out.marker = p;
  // 1. A click: the details of the landing under the pointer.
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => Boolean(window.lunyx.store.get().site), null, { timeout: 20_000 });
  await sleep(1200);
  await snap('1. click on the Apollo 11 marker');
  // 2. A double-click on the same spot, as the hint says ("Double-click for surface view").
  await page.mouse.dblclick(p.x, p.y);
  await page.waitForFunction(() => window.lunyx.store.get().view === 'surface', null, { timeout: 20_000 });
  await surfaceReady(page);
  await snap('2. double-click on the same spot');
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
}
const [shown, opened] = [out.timeline[0]?.site, out.timeline[1]?.site];
out.wrongSite = Boolean(shown && opened && shown !== opened);
out.finishedUtc = new Date().toISOString();
const dir = join(ROOT, 'e2e', 'qa', 'out', `repro-marker-dblclick-${sha}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(out.wrongSite ? `Q-9 reproduced: the card showed ${shown}, the double-click opened ${opened}.` : `Q-9 not reproduced: the double-click opened ${opened}, the landing shown.`);
process.exit(out.wrongSite ? 1 : 0);
