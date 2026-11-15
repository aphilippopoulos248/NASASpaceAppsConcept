// Q-8 reproduction (docs/lunyx/qa-findings.md): the status line of Compare > "Nearby sites"
// keeps the outcome of an earlier "Compare as B" after another scan has replaced the list, here
// one the assistant ran around a new pin. The tab then reads "Candidate 1 is pinned and loaded
// as B, against A: <the first pin>." above a list whose candidate 1 is another site, which is
// not loaded as B.
//
//   npm run build
//   flock /tmp/lunyx-gpu.lock node e2e/qa/repro-nearby-status.mjs
//
// Desktop, 1280x720, bundled data (the e2e set-up: deterministic assistant, no network).
// Prints what the tab shows at each stage; writes e2e/qa/out/repro-nearby-status-<sha>/result.json.
// Exits 1 while the line is stale after the assistant's scan, 0 once it is not.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, servers } from '../lib/servers.mjs';
import { act, ask, closeBrowser, openApp, openAssistant, rendering, until } from '../lib/app.mjs';

const P1 = { lat: -89.45, lon: -137.2 };
const P2 = { lat: -88, lon: 136.7 };
const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
const out = { commit: sha, appSourceClean: execSync('git status --porcelain -- src public index.html package.json', { cwd: ROOT }).toString() === '', startedUtc: new Date().toISOString(), stages: [] };

const srv = await servers();
let stale = null;
try {
  const { page, close } = await openApp(srv.deterministic, { viewport: { width: 1280, height: 720 }, scale: 1 });
  out.renderer = rendering.renderer;
  const settled = () =>
    until(page, () => {
      const a = window.lunyx.analysis;
      const st = a.get('current');
      const want = a.wanted('current');
      return Boolean(want) && (st.state === 'ready' || st.state === 'error') && st.scenario.id === want.id;
    }, undefined, 300_000);
  const scanned = (around) => until(page, (name) => window.lunyx.analysis.nearby().state === 'ready' && window.lunyx.analysis.nearby().scenario.site.name === name, around, 300_000);
  const sheetOpen = () => page.evaluate(() => !document.querySelector('.cmp-sheet').hidden);
  const openNearby = async () => {
    if (!(await sheetOpen())) {
      await page.locator('.cmp-launcher').click();
      await until(page, () => !document.querySelector('.cmp-sheet').hidden);
    }
    await page.locator('.cmp-sheet').getByRole('tab', { name: 'Nearby sites' }).click();
    await until(page, () => [...document.querySelectorAll('.cmp-sheet [role="tabpanel"]')].some((p) => !p.hidden && p.querySelector('.cmp-onscreen')));
  };
  const closeSheet = async () => {
    await page.locator('.cmp-sheet').focus();
    await page.keyboard.press('Escape');
    await until(page, () => document.querySelector('.cmp-sheet').hidden);
  };
  /** What the "Nearby sites" tab shows, and what is really in slots A and B. */
  const read = (stage) =>
    page.evaluate((stage) => {
      // The "Nearby sites" tab, shown or not ("Compare as B" switches to "A and B").
      const panel = document.querySelector('.cmp-sheet .cmp-scan')?.closest('[role="tabpanel"]');
      const first = panel?.querySelector('.cmp-nrow:not(.cmp-nhead):not(.is-reference)');
      const s = window.lunyx.store.get();
      const rank1 = first ? { name: first.querySelector('.cmp-nwhere')?.textContent ?? '', coords: first.querySelector('.cmp-nwhere + .ly-note')?.textContent ?? '' } : null;
      const b = s.compareB?.site ?? null;
      return {
        stage,
        tabShown: [...document.querySelectorAll('.cmp-sheet [role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? '',
        around: panel?.querySelector('.cmp-onscreen')?.textContent ?? '',
        status: panel?.querySelector('.cmp-status')?.textContent ?? '',
        summary: (panel?.querySelector('.cmp-nearbysummary')?.textContent ?? '').slice(0, 220),
        rank1,
        slotA: s.compareA?.site?.name ?? null,
        slotB: b?.name ?? null,
        slotBCoords: b ? [b.lat, b.lon] : null,
      };
    }, stage);

  // 1. Pin P1, save it as A, scan from the tab and take rank 1 as B, all through the panel's controls.
  await act(page, 'dropPin', { ...P1, fly: true }, 'test');
  await settled();
  await openNearby();
  await page.locator('.cmp-sheet').getByRole('tab', { name: 'A and B' }).click();
  await page.locator('.cmp-sheet').getByRole('button', { name: 'Save the scenario on screen as A' }).click();
  await until(page, () => window.lunyx.store.get().compareA !== null);
  await openNearby();
  await page.locator('.cmp-sheet').getByRole('button', { name: 'Scan nearby sites' }).click();
  await scanned('Pin 89.450° S, 137.200° W');
  const asB = page.locator('.cmp-sheet').getByRole('button', { name: /^Pin candidate 1, .*load it as scenario B$/ });
  await asB.click();
  await until(page, () => /loaded as B/.test(document.querySelector('.cmp-sheet .cmp-status:not(:empty)')?.textContent ?? '') && window.lunyx.store.get().compareB !== null);
  out.stages.push(await read('1. after "Compare as B" on rank 1 of the scan around P1'));
  await closeSheet();

  // 2. A new pin P2; the assistant scans around it.
  await act(page, 'dropPin', { ...P2, fly: true }, 'test');
  await settled();
  await openAssistant(page);
  const reply = await ask(page, 'find a flatter nearby site with a shorter blackout');
  out.reply = { actions: reply.actions.map((a) => `${a.name}${a.ok ? '' : ' (failed)'}`), text: reply.text.slice(0, 300) };
  await scanned('Pin 88.000° S, 136.700° E');
  await page.locator('#assistant-input').focus();
  await page.keyboard.press('Escape');
  await openNearby();
  const after = await read('2. after the assistant scanned around P2 (panel reopened on "Nearby sites")');
  out.stages.push(after);
  stale = /loaded as B/.test(after.status) && after.rank1 !== null && !after.slotB?.includes(after.rank1.name);

  // 3. Control: a scan started from the tab itself rewrites the line.
  await page.locator('.cmp-sheet').getByRole('button', { name: 'Scan nearby sites' }).click();
  await until(page, () => /^Scanned /.test(document.querySelector('.cmp-sheet [role="tabpanel"]:not([hidden]) .cmp-status')?.textContent ?? ''), undefined, 300_000);
  out.stages.push(await read('3. control: "Scan nearby sites" pressed in the tab'));
  await close();
} finally {
  await closeBrowser().catch(() => {});
  await srv.stop();
}
out.stale = stale;
out.finishedUtc = new Date().toISOString();
const dir = join(ROOT, 'e2e', 'qa', 'out', `repro-nearby-status-${sha}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'result.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(stale ? 'Q-8 reproduced: the status line still describes the earlier scan.' : 'Q-8 not reproduced: the status line follows the list.');
process.exit(stale ? 1 : 0);
