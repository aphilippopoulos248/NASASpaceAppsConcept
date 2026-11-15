// Accessibility checks that a machine can make, on the built app (desktop website, decision D-4):
//   - every control has an accessible name (from the browser's accessibility tree);
//   - the Tab key reaches every control once, never lands in a hidden region, and focus is visible;
//   - text in the panels has enough contrast (WCAG AA) whatever part of the Moon is behind them;
//   - with "reduce motion" set, panels and view changes do not animate;
//   - the compare panel (a dialog) takes the focus, names its controls and gives it back on Escape;
//   - the surface view's Key metrics and skyline chart are named and readable.
// What needs a person (does the order make sense, are the names good, screen-reader wording)
// is written up in docs/lunyx/accessibility.md.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { closeBrowser, openApp, result, SLOW, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

let srv;
before(async () => {
  srv = await servers();
}, SLOW);
after(async () => {
  await closeBrowser();
  await srv?.stop();
});

const CONTROL_ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'slider', 'checkbox', 'spinbutton', 'switch', 'listbox', 'searchbox', 'radio', 'menuitem', 'tab']);

/** Controls in the accessibility tree that have no name. */
async function unnamedControls(page) {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const out = [];
  for (const n of nodes) {
    if (n.ignored || !CONTROL_ROLES.has(n.role?.value)) continue;
    if ((n.name?.value ?? '').trim()) continue;
    let hint = '';
    try {
      const { node } = await cdp.send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId });
      const attrs = {};
      for (let i = 0; i < (node.attributes?.length ?? 0); i += 2) attrs[node.attributes[i]] = node.attributes[i + 1];
      hint = `<${node.localName}${attrs.id ? ` id="${attrs.id}"` : ''}${attrs.class ? ` class="${attrs.class}"` : ''}${attrs.type ? ` type="${attrs.type}"` : ''}>`;
    } catch {
      hint = '(node gone)';
    }
    out.push(`${n.role.value} ${hint}`);
  }
  await cdp.detach();
  return out;
}

/** Presses Tab until focus returns to where it started; describes every stop. */
async function tabStops(page, max = 120) {
  await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  const stops = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent?.trim().slice(0, 40) || el.id || el.className;
      const hiddenBy = el.closest('[inert], [hidden], [aria-hidden="true"]');
      // Which element this is, not only what it is called: two controls can share a name.
      if (el.dataset.a11yStop === undefined) el.dataset.a11yStop = String((window.__a11yCount = (window.__a11yCount ?? 0) + 1));
      return {
        key: `${el.tagName.toLowerCase()}#${el.id}.${typeof el.className === 'string' ? el.className : ''}|${label}|${el.dataset.a11yStop}`,
        name: `${el.tagName.toLowerCase()}|${label}`,
        label: `${el.tagName.toLowerCase()} "${label}"`,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
        inHiddenRegion: Boolean(hiddenBy),
        // A visible focus indicator: an outline, or a box shadow used as a ring.
        ring: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) || cs.boxShadow !== 'none',
      };
    });
    if (!stop) continue; // focus went to the browser chrome and comes back on the next Tab
    // A date-time field takes several Tab presses (day, month, year, ...): one stop.
    if (stops.length && stop.key === stops.at(-1).key) continue;
    if (stops.length && stop.key === stops[0].key) break;
    stops.push(stop);
  }
  return stops;
}

/** Text elements whose contrast with their background is below WCAG AA, for the worst backdrop. */
function lowContrast(page, rootSelector) {
  return page.evaluate((selector) => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    /** The element's background as painted over a backdrop colour (panels are translucent over the scene). */
    const background = (el, backdrop) => {
      const layers = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c.a > 0) layers.push(c);
        if (c && c.a === 1) break;
      }
      return layers.reverse().reduce((acc, layer) => over(layer, acc), backdrop);
    };
    const findings = [];
    const seen = new Set();
    for (const root of document.querySelectorAll(selector)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent.trim();
        const el = n.parentElement;
        if (!text || !el || seen.has(el)) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.closest('[hidden], [inert], [aria-hidden="true"], :disabled, .ly-visually-hidden')) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const need = large ? 3 : 4.5;
        // Opacity of ancestors dims the text too.
        let alpha = fg.a;
        for (let e = el; e; e = e.parentElement) alpha *= Number(getComputedStyle(e).opacity);
        let worst = Infinity;
        // The scene behind a panel is black space or sunlit Moon: check both ends.
        for (const backdrop of [{ r: 0, g: 0, b: 0, a: 1 }, { r: 235, g: 235, b: 235, a: 1 }]) {
          const bg = background(el, backdrop);
          worst = Math.min(worst, ratio(over({ ...fg, a: alpha }, bg), bg));
        }
        if (worst < need) findings.push(`${worst.toFixed(2)}:1 (needs ${need}) "${text.slice(0, 40)}" <${el.tagName.toLowerCase()} class="${el.className}"> ${Math.round(size)}px`);
      }
    }
    return findings;
  }, rootSelector);
}

/**
 * Presses Tab (or Shift+Tab) until the focused element matches `want` (a description built in
 * the page: role, name, id and classes), at most `max` times. Returns how many presses it took;
 * throws if the element was never reached, which means it is not in the keyboard path.
 */
async function tabTo(page, want, { max = 150, back = false } = {}) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    const here = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return '';
      const name = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || '';
      return `${el.tagName.toLowerCase()}#${el.id}.${typeof el.className === 'string' ? el.className.replace(/\s+/g, '.') : ''}|${el.getAttribute('role') ?? ''}|${name.trim().replace(/\s+/g, ' ').slice(0, 80)}`;
    });
    if (want.test(here)) return i;
  }
  throw new Error(`Tab never reached ${want} in ${max} presses`);
}

describe('accessibility: a keyboard-only walk of the main journey (desktop)', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.deterministic);
    page = app.page;
  }, SLOW);
  after(() => app?.close());

  test('typed coordinates and "Drop pin at centre", by keyboard only', SLOW, async () => {
    await page.evaluate(() => document.activeElement?.blur?.());
    await tabTo(page, /\|Latitude/);
    await page.keyboard.type('-88');
    await page.keyboard.press('Enter');
    await tabTo(page, /\|Longitude/);
    await page.keyboard.type('136.7');
    await page.keyboard.press('Enter');
    await tabTo(page, /\|Drop pin at centre$/);
    await page.keyboard.press('Enter');
    await until(page, () => window.lunyx.store.get().site?.kind === 'custom');
    await until(page, () => /% of the window/.test(document.querySelector('.site-card .sc-window')?.textContent ?? ''));
  });

  test('A-2: enter the surface view, look around with the arrow keys from wherever the focus is, leave with Escape', SLOW, async () => {
    await tabTo(page, /\|Enter surface view$/);
    await page.keyboard.press('Enter');
    await until(page, () => document.body.dataset.view === 'surface');
    // Focus arrives on the scene (T-37), which is announced as an application.
    await until(page, () => document.activeElement?.id === 'scene');
    assert.equal(await page.evaluate(() => document.getElementById('scene').getAttribute('role')), 'application');
    const az0 = await page.evaluate(() => window.lunyx.store.get().look.azDeg);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await until(page, (a) => Math.abs(((window.lunyx.store.get().look.azDeg - a + 540) % 360) - 180) > 1, az0);
    // From a HUD button too (not a field): the arrows still turn the view.
    await tabTo(page, /\|(Face Sun|Fold|Open)$/);
    const az1 = await page.evaluate(() => window.lunyx.store.get().look.azDeg);
    await page.keyboard.press('ArrowLeft');
    await until(page, (a) => Math.abs(((window.lunyx.store.get().look.azDeg - a + 540) % 360) - 180) > 0.5, az1);
    const el0 = await page.evaluate(() => window.lunyx.store.get().look.elDeg);
    await page.keyboard.press('ArrowUp');
    await until(page, (e) => window.lunyx.store.get().look.elDeg > e, el0);
    const site = await page.evaluate(() => window.lunyx.store.get().site.id);
    await page.keyboard.press('Escape');
    await until(page, () => document.body.dataset.view === 'globe');
    assert.equal(await page.evaluate(() => window.lunyx.store.get().site?.id), site, 'Escape must leave the surface and keep the site (F-1)');
  });

  test('the compare panel by keyboard: open, save A, scan nearby sites, take rank 1 as B, close', SLOW, async () => {
    await tabTo(page, /cmp-launcher/);
    await page.keyboard.press('Enter');
    await until(page, () => !document.querySelector('.cmp-sheet').hidden && document.querySelector('.cmp-sheet').contains(document.activeElement));
    await tabTo(page, /\|Save the scenario on screen as A$/, { max: 40 });
    await page.keyboard.press('Enter');
    await until(page, () => Boolean(window.lunyx.store.get().compareA));
    await tabTo(page, /\|tab\|A and B$/, { max: 60, back: true });
    await page.keyboard.press('ArrowRight');
    await until(page, () => document.activeElement?.getAttribute('role') === 'tab' && /Nearby sites/.test(document.activeElement.textContent));
    await tabTo(page, /\|Radius/, { max: 20 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('600');
    await tabTo(page, /\|Spacing/, { max: 5 });
    await page.keyboard.press('Control+A');
    await page.keyboard.type('200');
    await tabTo(page, /\|Scan nearby sites$/, { max: 10 });
    await page.keyboard.press('Enter');
    await until(page, () => window.lunyx.analysis.nearby().state === 'ready', undefined, 600_000);
    await tabTo(page, /\|Pin candidate 1, .* and load it as scenario B$/, { max: 60 });
    await page.keyboard.press('Enter');
    await until(page, () => window.lunyx.analysis.comparison().state === 'ready', undefined, 300_000);
    // Where the focus is now is checked by the next test (Q-4); close the panel from inside it.
    await page.locator('.cmp-sheet').focus();
    await page.keyboard.press('Escape');
    await until(page, () => document.querySelector('.cmp-sheet').hidden);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cmp-launcher')), true, 'focus did not return to the launcher');
  });

  // Finding Q-4 (docs/lunyx/qa-findings.md), owner @analysis: "Compare as B" switches the panel to
  // its "A and B" tab, which hides the button that had the focus, so the focus falls to the page;
  // the next Escape then closes the panel without giving the focus back to the launcher.
  test('after "Compare as B" the focus stays in the compare dialog, and Escape returns it to the launcher', { ...SLOW, todo: 'Q-4 (@analysis): the focus falls out of the dialog when "Compare as B" switches the tab' }, async () => {
    await tabTo(page, /cmp-launcher/);
    await page.keyboard.press('Enter');
    await until(page, () => !document.querySelector('.cmp-sheet').hidden && document.querySelector('.cmp-sheet').contains(document.activeElement));
    await tabTo(page, /\|tab\|A and B$/, { max: 60 });
    await page.keyboard.press('ArrowRight');
    await until(page, () => document.activeElement?.getAttribute('role') === 'tab' && /Nearby sites/.test(document.activeElement.textContent));
    await until(page, () => window.lunyx.analysis.nearby().state === 'ready' && document.querySelector('[aria-label="Ranked nearby alternatives"] .cmp-nrow:not(.cmp-nhead)'), undefined, 300_000);
    await tabTo(page, /\|Pin candidate 2, .* and load it as scenario B$/, { max: 80 });
    await page.keyboard.press('Enter');
    await until(page, () => window.lunyx.analysis.comparison().state === 'ready', undefined, 300_000);
    await page.waitForTimeout(300);
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      return { inDialog: Boolean(el && document.querySelector('.cmp-sheet').contains(el)), what: el === document.body ? 'body' : `${el?.tagName.toLowerCase()} "${(el?.getAttribute('aria-label') || el?.textContent || '').trim().slice(0, 60)}"` };
    });
    assert.ok(where.inDialog, `after "Compare as B" the focus is on ${where.what}, outside the dialog`);
    await page.keyboard.press('Escape');
    await until(page, () => document.querySelector('.cmp-sheet').hidden);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cmp-launcher')), true, 'focus did not return to the launcher');
  });

  test('the assistant by keyboard: open, ask, close with Escape', SLOW, async () => {
    await tabTo(page, /#assistant-button/);
    await page.keyboard.press('Enter');
    await until(page, () => document.activeElement?.id === 'assistant-input');
    await page.keyboard.type('what is the illumination?');
    const before = await page.evaluate(() => window.lunyxAssistant.session.messages.length);
    await page.keyboard.press('Enter');
    await until(page, (n) => window.lunyxAssistant.session.messages.length >= n + 2 && !window.lunyxAssistant.session.busy, before);
    await page.keyboard.press('Escape');
    await until(page, () => !window.lunyx.store.get().assistantOpen && document.activeElement?.id === 'assistant-button');
  });
});

describe('accessibility: globe view, site card, scrubber and the assistant drawer', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.deterministic);
    page = app.page;
    // A realistic screen: a site selected with its analysis shown.
    await result(page, 'selectSite', { site: 'im-2', atLanding: true, fly: false });
    await result(page, 'getAnalysis');
    await until(page, () => /% of the window/.test(document.querySelector('.site-card .sc-window')?.textContent ?? ''));
  }, SLOW);
  after(() => app?.close());

  test('every control has an accessible name (globe view, drawer closed and open)', SLOW, async () => {
    assert.deepEqual(await unnamedControls(page), []);
    await result(page, 'setAssistantOpen', { open: true });
    await until(page, () => document.getElementById('assistant-drawer').classList.contains('is-open'));
    assert.deepEqual(await unnamedControls(page), []);
    await result(page, 'setAssistantOpen', { open: false });
    await until(page, () => !document.getElementById('assistant-drawer').classList.contains('is-open'));
  });

  test('Tab reaches the controls once each, only visible ones, and each shows a focus ring', SLOW, async () => {
    const stops = await tabStops(page);
    assert.ok(stops.length >= 25, `only ${stops.length} tab stops`);
    assert.ok(stops.length < 80, 'Tab did not come back to the start: focus is trapped or the list is endless');
    const seen = new Map();
    for (const [i, st] of stops.entries()) seen.set(st.key, [...(seen.get(st.key) ?? []), i + 1]);
    const twice = [...seen].filter(([, at]) => at.length > 1).map(([key, at]) => `${key} at stops ${at.join(', ')}`);
    assert.deepEqual(twice, [], `a control was focused twice in one round:\n${twice.join('\n')}\nall stops: ${stops.map((x) => x.label).join(' | ')}`);
    assert.deepEqual(stops.filter((s) => s.inHiddenRegion).map((s) => s.label), [], 'focus entered a hidden region');
    assert.deepEqual(stops.filter((s) => !s.visible).map((s) => s.label), [], 'focus landed on something that is not on screen');
    assert.deepEqual(stops.filter((s) => !s.ring).map((s) => s.label), [], 'no visible focus indicator');
    const labels = stops.map((s) => s.label);
    for (const expected of ['canvas', 'Arrival date and time (UTC)', 'Drop pin at centre', 'Enter surface view', 'Open the assistant']) {
      assert.ok(labels.some((l) => l.includes(expected)), `Tab never reached "${expected}"; stops: ${labels.join(' | ')}`);
    }
    // The closed drawer is out of the tab order.
    assert.ok(!labels.some((l) => l.includes('Close the assistant') || l.includes('Message to the assistant')), 'the closed drawer is in the tab order');
  });

  // Finding A-5 (docs/lunyx/accessibility.md): the site-science section has two disclosures both
  // named "Source and limits" (long-term averages and Diviner temperatures).
  test('controls in one round of Tab have distinct names', { ...SLOW, todo: 'A-5 (site science, T-30): two disclosures are both named "Source and limits"' }, async () => {
    const stops = await tabStops(page);
    const byName = new Map();
    for (const st of stops) byName.set(st.name, (byName.get(st.name) ?? 0) + 1);
    const same = [...byName].filter(([, n]) => n > 1).map(([name, n]) => `${name} x${n}`);
    assert.deepEqual(same, []);
  });

  test('text contrast in the panels meets WCAG AA over black space and over sunlit ground', SLOW, async () => {
    assert.deepEqual(await lowContrast(page, '.filters-panel, .site-card, .time-scrubber, .locator, .region-wordmark'), []);
  });

  test('text contrast in the assistant drawer meets WCAG AA', SLOW, async () => {
    await result(page, 'setAssistantOpen', { open: true });
    await until(page, () => document.getElementById('assistant-drawer').classList.contains('is-open') && !document.querySelector('.ad-mode').textContent.includes('Checking'));
    await page.evaluate(() => window.lunyxAssistant.session.send('go to IM-2 then make it nicer'));
    await page.evaluate(() => window.lunyxAssistant.session.send('status'));
    await until(page, () => !window.lunyxAssistant.session.busy && window.lunyxAssistant.session.messages.length >= 4);
    assert.deepEqual(await lowContrast(page, '.assistant-drawer'), []);
    await result(page, 'setAssistantOpen', { open: false });
  });

  test('with reduced motion, the drawer and the view change do not animate', SLOW, async () => {
    const durations = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return { fast: root.getPropertyValue('--dur-fast').trim(), normal: root.getPropertyValue('--dur').trim(), slow: root.getPropertyValue('--dur-slow').trim(), drawer: getComputedStyle(document.getElementById('assistant-drawer')).transitionDuration };
    });
    for (const value of [durations.fast, durations.normal, durations.slow, ...durations.drawer.split(',')]) assert.equal(parseFloat(value), 0, `a transition still takes ${value.trim()}`);
    // The view switches at once (the full-screen fade is skipped).
    await result(page, 'enterSurface');
    assert.equal(await page.evaluate(() => document.body.dataset.view), 'surface');
    await result(page, 'exitSurface');
    assert.equal(await page.evaluate(() => document.body.dataset.view), 'globe');
  });

  test('the surface view: names, contrast of the HUD, Key metrics and chart, and Escape leaves it', SLOW, async () => {
    await result(page, 'enterSurface');
    await until(page, () => document.body.dataset.view === 'surface' && document.querySelector('.km .km-now tbody tr th'));
    assert.deepEqual(await unnamedControls(page), []);
    assert.deepEqual(await lowContrast(page, '.surface-hud, .km, .skc, .time-scrubber, .locator'), []);
    // The chart is a named group with its keys described, and its data is also offered as a table.
    const plot = await page.evaluate(() => document.querySelector('.skc .skc-plot')?.getAttribute('aria-label') ?? '');
    assert.match(plot, /arrows move the clock/i);
    await page.locator('.skc').getByRole('button', { name: 'Table', exact: true }).click();
    await until(page, () => document.querySelector('.skc-data caption')?.textContent.length > 20);
    assert.deepEqual(await lowContrast(page, '.skc'), []);
    // The same button now reads "Chart" and is pressed.
    const back = page.locator('.skc').getByRole('button', { name: 'Chart', exact: true });
    assert.equal(await back.getAttribute('aria-pressed'), 'true');
    await back.click();
    await page.locator('#scene').focus();
    await page.keyboard.press('Escape');
    await until(page, () => document.body.dataset.view === 'globe');
  });

  test('the compare panel: the launcher moves focus into the dialog, its controls are named, Escape gives focus back', SLOW, async () => {
    const launcher = page.locator('.cmp-launcher');
    await launcher.focus();
    await page.keyboard.press('Enter');
    await until(page, () => !document.querySelector('.cmp-sheet').hidden);
    await until(page, () => document.querySelector('.cmp-sheet').contains(document.activeElement));
    assert.equal(await page.locator('.cmp-sheet').getAttribute('role'), 'dialog');
    assert.ok((await page.locator('.cmp-sheet').getAttribute('aria-labelledby'))?.length > 0, 'the dialog has no name');
    assert.deepEqual(await unnamedControls(page), []);
    assert.deepEqual(await lowContrast(page, '.cmp-sheet'), []);
    // The tabs are a tablist: the arrow keys move between them.
    await page.locator('.cmp-sheet [role="tab"]').first().focus();
    await page.keyboard.press('ArrowRight');
    await until(page, () => document.activeElement?.getAttribute('role') === 'tab' && document.activeElement.getAttribute('aria-selected') === 'true' && document.activeElement !== document.querySelector('.cmp-sheet [role="tab"]'));
    assert.deepEqual(await unnamedControls(page), []);
    assert.deepEqual(await lowContrast(page, '.cmp-sheet'), []);
    await page.keyboard.press('Escape');
    await until(page, () => document.querySelector('.cmp-sheet').hidden);
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('cmp-launcher')), true, 'focus did not return to the launcher');
  });
});
