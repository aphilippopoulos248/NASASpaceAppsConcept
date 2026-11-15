// The assistant in the real built app, driven through its drawer.
//
// Two servers, no API key: deterministic mode (no model) and the scripted test model, which
// goes through the same /api/assistant route, streaming and tool loop a language model
// would use. Nothing in this file talks to a real language model.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { act, ask, click, closeBrowser, log, lastSeq, openApp, openAssistant, result, SLOW, state, until } from './lib/app.mjs';
import { servers } from './lib/servers.mjs';

const DETERMINISTIC_LABEL = 'Deterministic mode: no language model';
const SCRIPTED_LABEL = 'Scripted test model (not a language model)';

let srv;
before(async () => {
  srv = await servers();
}, SLOW);
after(async () => {
  await closeBrowser();
  await srv?.stop();
});

describe('assistant: deterministic mode (server without a model)', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.deterministic);
    page = app.page;
  }, SLOW);
  after(() => app?.close());

  test('the status endpoint reports no model and exposes nothing else', SLOW, async () => {
    const res = await fetch(`${srv.deterministic}/api/assistant`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['available', 'model', 'reason', 'router']);
    assert.equal(body.available, false);
    assert.equal(body.model, null);
    const step = await fetch(`${srv.deterministic}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'hi' }], tools: [] }) });
    assert.equal(step.status, 503);
    assert.equal((await step.json()).error.kind, 'no_model');
  });

  test('the button opens the drawer, the mode is stated, and focus lands in the message box', SLOW, async () => {
    const button = page.locator('#assistant-button');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    assert.match(await button.getAttribute('aria-label'), /Open the assistant/);
    assert.equal(await page.locator('#assistant-drawer').getAttribute('inert'), '');
    await openAssistant(page);
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.match(await page.locator('.ad-mode').textContent(), new RegExp(`^${DETERMINISTIC_LABEL}`));
    await until(page, () => document.activeElement?.id === 'assistant-input');
    assert.equal(await page.locator('#assistant-drawer').getAttribute('inert'), null);
  });

  test('the drawer says where answers come from and that NASA is not responsible for them (T-10)', SLOW, async () => {
    const note = page.locator('#assistant-disclaimer');
    assert.equal(await note.textContent(), "Answers are worked out from Lunyx's own results, without an AI model. NASA is not responsible for their accuracy and has not reviewed them.");
    // Under the conversation, inside the drawer, on screen at 1280x720: it never covers a reply.
    const [n, conversation, drawer] = await Promise.all([note.boundingBox(), page.locator('.ad-log').boundingBox(), page.locator('#assistant-drawer').boundingBox()]);
    assert.ok(n && conversation && drawer, 'not laid out');
    assert.ok(n.y >= conversation.y + conversation.height - 1, `the note (${n.y}) overlaps the conversation (ends ${conversation.y + conversation.height})`);
    assert.ok(n.y + n.height <= Math.min(720, drawer.y + drawer.height) + 1, `the note is cut off: ${JSON.stringify(n)}`);
  });

  test('a typed command runs through the action registry and the reply is labelled', SLOW, async () => {
    const from = await lastSeq(page);
    const reply = await ask(page, 'go to IM-2');
    assert.deepEqual(reply.source, { kind: 'deterministic' });
    assert.equal(reply.shownLabel, DETERMINISTIC_LABEL);
    assert.equal((await state(page)).site.id, 'im-2');
    // What the drawer lists is what the action log recorded, with origin "assistant".
    const entries = (await log(page, from)).filter((e) => e.origin === 'assistant');
    assert.deepEqual(entries.map((e) => [e.name, e.ok]), [['selectSite', true]]);
    assert.deepEqual(reply.shownActions, ['Select landing site']);
    assert.match(reply.shownText, /Selected IM-2 Athena \(latitude -84\.7900°, longitude 29\.2000° \(east-positive\)/);
  });

  test('numbers in a reply are the numbers the app computed', SLOW, async () => {
    await ask(page, 'show IM-2 at its landing time');
    const reply = await ask(page, 'what is the illumination?');
    const a = await result(page, 'getAnalysis');
    assert.equal(a.state, 'ready');
    const f1 = (v) => v.toFixed(1);
    assert.ok(reply.text.includes(`illumination ${f1(a.metrics.illuminationPct)} %`), reply.text);
    assert.ok(reply.text.includes(`longest darkness ${f1(a.metrics.longestDarknessH)} h`), reply.text);
    assert.ok(reply.text.includes(`Earth's centre in view ${f1(a.metrics.earthVisiblePct)} %`), reply.text);
    assert.ok(reply.text.includes(`longest Earth-centre gap ${f1(a.metrics.longestEarthGapH)} h`), reply.text);
    assert.ok(reply.text.includes(`slope ${f1(a.slope.slopeDeg)}°`), reply.text);
    assert.match(reply.text, /not a guarantee of a working radio link/);
    assert.equal(reply.shownLabel, DETERMINISTIC_LABEL);
    // The question changed nothing: only queries ran.
    assert.ok(reply.actions.every((x) => x.name === 'getAnalysis' || x.name === 'getState'), JSON.stringify(reply.actions.map((x) => x.name)));
  });

  test('it says what it did not understand and changes nothing', SLOW, async () => {
    const before = await state(page);
    const from = await lastSeq(page);
    const reply = await ask(page, 'go to Apollo 11, then make it look nice');
    assert.match(reply.text, /I did not understand "make it look nice"/);
    assert.match(reply.text, /Nothing was changed/);
    assert.equal(reply.shownLabel, DETERMINISTIC_LABEL);
    assert.deepEqual(await log(page, from), []);
    const now = await state(page);
    assert.equal(now.site.id, before.site.id);
    assert.equal(now.timeMs, before.timeMs);
  });

  test('"/actions" lists exactly the registered actions', SLOW, async () => {
    const reply = await ask(page, '/actions');
    const names = await page.evaluate(() => window.lunyx.actions.listActions().map((a) => a.name));
    const listed = [...reply.text.matchAll(/^\/([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    assert.deepEqual(listed.sort(), [...names].sort());
    assert.ok(names.length >= 30, `only ${names.length} actions registered`);
    // The tool list a model would receive is the same registry.
    const tools = await page.evaluate(() => window.lunyx.actions.toolDefinitions().map((t) => t.name));
    assert.deepEqual([...tools].sort(), [...names].sort());
  });

  test('keyboard: Shift+Enter adds a line, Escape closes the drawer and gives focus back', SLOW, async () => {
    const input = page.locator('#assistant-input');
    await input.fill('line one');
    await input.press('Shift+Enter');
    await input.pressSequentially('line two');
    assert.equal(await input.inputValue(), 'line one\nline two');
    await input.fill('');
    const view = (await state(page)).view;
    await input.press('Escape');
    await until(page, () => !window.lunyx.store.get().assistantOpen);
    await until(page, () => document.activeElement?.id === 'assistant-button');
    assert.equal(await page.locator('#assistant-drawer').getAttribute('inert'), '');
    // Escape in the drawer is not passed on to the view's own Escape shortcut.
    assert.equal((await state(page)).view, view);
    assert.equal((await state(page)).site.id, 'im-2');
  });

  test('"New chat" clears the conversation and leaves the app alone', SLOW, async () => {
    await openAssistant(page);
    assert.ok((await page.locator('.am').count()) > 0);
    await click(page, '#assistant-drawer button[aria-label="Start a new conversation"]');
    await until(page, () => window.lunyxAssistant.session.messages.length === 0);
    assert.equal(await page.locator('.am').count(), 0);
    assert.equal((await state(page)).site.id, 'im-2');
  });

  test('the page raised no errors, and worked with every outside request refused', SLOW, async () => {
    assert.deepEqual(app.problems, []);
    // The only thing the app reaches for outside its own server is optional close-up imagery
    // (NASA Moon Trek tiles around a selected site). Everything above ran without it.
    const hosts = [...new Set(app.blocked.map((u) => new URL(u).host))].filter((h) => h !== new URL(srv.deterministic).host);
    assert.deepEqual(hosts.filter((h) => h !== 'trek.nasa.gov'), []);
  });
});

describe('assistant: scripted test model through the real /api/assistant route', () => {
  let app, page;
  before(async () => {
    app = await openApp(srv.scripted);
    page = app.page;
    await openAssistant(page);
  }, SLOW);
  after(() => app?.close());

  test('the drawer names the model that is answering', SLOW, async () => {
    assert.equal(await page.locator('.ad-mode').textContent(), `Language model: ${SCRIPTED_LABEL}`);
    // The scripted test model is not a language model: no "AI-generated" mark, and the standing note says so.
    assert.equal(await page.locator('#assistant-disclaimer').textContent(), "Answers are worked out from Lunyx's own results, without an AI model. NASA is not responsible for their accuracy and has not reviewed them.");
    const status = await (await fetch(`${srv.scripted}/api/assistant`)).json();
    assert.deepEqual(status, { available: true, model: { provider: 'scripted', model: 'script:default', label: SCRIPTED_LABEL }, router: 'direct' });
  });

  test('a chain of tool calls changes the app and every result returns to the model', SLOW, async () => {
    const reply = await ask(page, 'call selectSite {"site":"Apollo 11"}; call setTime {"utc":"1969-07-20T20:17Z"}; call setMastHeight {"metres":5}');
    assert.deepEqual(reply.source, { kind: 'model', label: SCRIPTED_LABEL, provider: 'scripted' });
    assert.equal(reply.shownLabel, SCRIPTED_LABEL);
    assert.doesNotMatch(reply.shownLabel, /AI-generated/);
    assert.deepEqual(reply.actions.map((a) => [a.name, a.ok, a.origin]), [['selectSite', true, 'assistant'], ['setTime', true, 'assistant'], ['setMastHeight', true, 'assistant']]);
    const s = await state(page);
    assert.equal(s.site.id, 'apollo-11');
    assert.equal(s.timeMs, Date.UTC(1969, 6, 20, 20, 17));
    assert.equal(s.mastHeightM, 5);
    // The model's final text quotes the results it was sent back.
    assert.match(reply.text, /2\. setTime: \{"timeUtc":"1969-07-20T20:17Z"/);
    assert.match(reply.text, /3\. setMastHeight: \{"mastHeightM":5\}/);
    assert.deepEqual(reply.shownActions, ['Select landing site', 'Set time', 'Set mast height']);
  });

  test('unknown actions, bad arguments and failing actions come back as errors the model can read', SLOW, async () => {
    await act(page, 'clearSite');
    const reply = await ask(page, 'call warpDrive {"factor":9}; call setOverlay {"mode":"purple"}; call enterSurface; call setOverlay {"mode":"sun-band"}');
    assert.deepEqual(reply.actions.map((a) => [a.name, a.ok]), [['warpDrive', false], ['setOverlay', false], ['enterSurface', false], ['setOverlay', true]]);
    assert.match(reply.text, /1\. warpDrive: failed: Unknown action "warpDrive"/);
    assert.match(reply.text, /2\. setOverlay: failed: params\.mode must be one of/);
    assert.match(reply.text, /3\. enterSurface: failed: No site is selected/);
    assert.equal((await state(page)).overlay, 'sun-band');
    assert.equal(reply.failed, false);
  });

  test('a follow-up is answered against the current state', SLOW, async () => {
    await ask(page, 'call selectSite {"site":"IM-2"}');
    const reply = await ask(page, 'what is on screen?');
    assert.match(reply.text, /"site":\{"id":"im-2"/);
    assert.deepEqual(reply.actions.map((a) => a.name), ['getState']);
  });

  test('nothing the assistant route sends, and nothing the browser keeps, looks like a credential', SLOW, async () => {
    // The raw bytes of a streamed step, fetched outside the browser.
    const tools = await page.evaluate(() => window.lunyx.actions.toolDefinitions());
    const res = await fetch(`${srv.scripted}/api/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'call getState' }], tools }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/x-ndjson/);
    const raw = await res.text();
    const events = raw.trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(events[0].type, 'meta');
    assert.equal(events.at(-1).type, 'done');
    assert.deepEqual(events.at(-1).message.toolCalls.map((c) => c.name), ['getState']);
    // What the browser holds after the conversation above: the visible messages and the history it would send next.
    const kept = await page.evaluate(() => JSON.stringify([window.lunyxAssistant.session.messages, window.lunyxAssistant.session.history()]));
    for (const text of [raw, kept, JSON.stringify(await (await fetch(`${srv.scripted}/api/assistant`)).json())]) {
      assert.doesNotMatch(text, /sk-ant-|ANTHROPIC_API_KEY=|TYPESAFE|Bearer /);
    }
    assert.deepEqual(app.problems, []);
  });
});
