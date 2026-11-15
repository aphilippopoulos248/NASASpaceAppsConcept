// Accessibility checks that a machine can make, on the built app:
//   - every control has an accessible name (from the browser's accessibility tree);
//   - the Tab key reaches every control once, never lands in a hidden region, and focus is visible;
//   - text in the panels has enough contrast (WCAG AA) whatever part of the Moon is behind them;
//   - with "reduce motion" set, panels and view changes do not animate.
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
      return {
        key: `${el.tagName.toLowerCase()}#${el.id}.${typeof el.className === 'string' ? el.className : ''}|${label}`,
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
    assert.equal(new Set(stops.map((s) => s.key)).size, stops.length, 'a control was focused twice in one round');
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

  test('the surface view: names, and Escape leaves it', SLOW, async () => {
    await result(page, 'enterSurface');
    await until(page, () => document.body.dataset.view === 'surface');
    assert.deepEqual(await unnamedControls(page), []);
    assert.deepEqual(await lowContrast(page, '.surface-hud, .time-scrubber, .locator'), []);
    await page.locator('#scene').focus();
    await page.keyboard.press('Escape');
    await until(page, () => document.body.dataset.view === 'globe');
  });
});

describe('accessibility: phone width (390 x 844)', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.deterministic, { viewport: { width: 390, height: 844 } });
    page = app.page;
  }, SLOW);
  after(() => app?.close());

  test('controls are named, the Filters sheet opens from its button, and nothing is wider than the screen', SLOW, async () => {
    assert.deepEqual(await unnamedControls(page), []);
    const toggle = page.locator('#left-toggle');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    await until(page, () => document.body.classList.contains('left-open'));
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.deepEqual(await unnamedControls(page), []);
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll('.ly-panel, .assistant-drawer.is-open, .region-wordmark')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 1 || e.getBoundingClientRect().left < -1)
        .map((e) => `${e.className}: ${Math.round(e.getBoundingClientRect().left)}..${Math.round(e.getBoundingClientRect().right)} of ${innerWidth}`),
    );
    assert.deepEqual(overflow, []);
    await toggle.click();
    await until(page, () => !document.body.classList.contains('left-open'));
  });

  test('the assistant drawer covers the width and its controls are at least 24 px tall', SLOW, async () => {
    await page.locator('#assistant-button').click();
    await until(page, () => document.getElementById('assistant-drawer').classList.contains('is-open'));
    const box = await page.locator('#assistant-drawer').boundingBox();
    assert.equal(Math.round(box.width), 390);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('#assistant-drawer button, #assistant-drawer textarea')]
        .filter((e) => !e.hidden && e.getBoundingClientRect().width > 0)
        .filter((e) => e.getBoundingClientRect().height < 24 || e.getBoundingClientRect().width < 24)
        .map((e) => `${e.getAttribute('aria-label') || e.textContent.trim()}: ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`),
    );
    assert.deepEqual(small, []);
  });
});
