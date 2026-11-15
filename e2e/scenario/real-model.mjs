// The T-6 scenario with a REAL language model: one command, run by hand, never part of a test
// run (it costs money and needs credentials). It has not been run: there are no credentials on
// the build machine.
//
//   ant auth login                          # authenticate with your Claude subscription (once)
//   npm run build
//   node e2e/scenario/real-model.mjs
//   E2E_GPU=1 flock /tmp/lunyx-gpu.lock node e2e/scenario/real-model.mjs   (on this machine, D-7)
//
// What it does: starts `vite preview` with the server's own environment (so the server finds
// the credentials; the browser never sees them), opens the app with every outside request from the page
// refused, sets the pin and the mission window of e2e/scenario/scenario.test.mjs, and sends the
// three requests through the drawer as follow-ups. It writes the transcript (each reply, the
// model that served it, every action with its parameters and result) to
// e2e/artifacts/real-model-<time>.json (git-ignored), and prints, per reply, every number that
// does not appear in any action result of that turn: candidates for a value the model did not
// take from the app. That list is for a person to read: a number can be legitimate (a count,
// a rounded value), so nothing here passes or fails the model.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { renderer } from './gpu.mjs';
import { closeBrowser, openApp, TIMEOUT, until } from '../lib/app.mjs';
import { ROOT } from '../lib/servers.mjs';
import { PIN, STEPS, WINDOW } from './setup.mjs';

const port = await new Promise((ok, fail) => {
  const s = createServer();
  s.on('error', fail);
  s.listen(0, '127.0.0.1', () => {
    const { port } = s.address();
    s.close(() => ok(port));
  });
});
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, LUNYX_LLM_PROVIDER: process.env.LUNYX_LLM_PROVIDER ?? 'anthropic' };
const server = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
const stop = () => new Promise((ok) => (server.exitCode !== null ? ok() : (server.once('exit', ok), server.kill('SIGTERM'))));

try {
  let status = null;
  for (let i = 0; i < 240 && !status; i++) {
    try {
      const res = await fetch(`${base}/api/assistant`);
      if (res.ok) status = await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!status) throw new Error(`the preview server did not answer:\n${serverLog.slice(-1500)}`);
  if (!status.available || status.model?.provider === 'scripted') {
    console.error(`No language model is available on this server: ${status.reason ?? JSON.stringify(status.model)}. Run \`ant auth login\` first (see the header of this file). Nothing was run.`);
    process.exitCode = 2;
  } else {
    console.log(`Model: ${status.model.label} (${status.model.provider}, ${status.model.model}); router: ${status.router}`);
    const app = await openApp(base);
    const page = app.page;
    console.log(`WebGL renderer: ${await renderer(page)}`);
    const act = (n, p = {}) => page.evaluate(([n, p]) => window.lunyx.actions.runAction(n, p, 'test'), [n, p]);
    await act('setAssistantOpen', { open: true });
    await act('dropPin', { ...PIN, fly: true });
    await act('setMissionWindow', { ...WINDOW, moveClock: true });
    await until(page, () => window.lunyxAssistant.session.mode.kind === 'model' || document.querySelector('.ad-mode')?.textContent.startsWith('Language model'));
    const transcript = { ranAt: new Date().toISOString(), model: status.model, router: status.router, pin: PIN, window: WINDOW, steps: [] };
    for (const text of STEPS) {
      const from = await page.evaluate(() => window.lunyx.actions.actionLog().at(-1)?.seq ?? 0);
      const t0 = Date.now();
      await page.locator('#assistant-input').fill(text);
      await page.locator('#assistant-input').press('Enter');
      await until(page, () => !window.lunyxAssistant.session.busy, undefined, 20 * TIMEOUT);
      const turn = await page.evaluate((from) => {
        const m = window.lunyxAssistant.session.messages.filter((x) => x.role === 'assistant').at(-1);
        return {
          reply: m?.text ?? '',
          source: m?.source ?? null,
          note: m?.note ?? null,
          shownLabel: [...document.querySelectorAll('.am--assistant .am-source')].at(-1)?.textContent ?? '',
          actions: window.lunyx.actions.actionLog().filter((e) => e.seq > from).map(({ name, params, origin, ok, error, result }) => ({ name, params, origin, ok, error, result })),
          state: JSON.parse(JSON.stringify(window.lunyx.store.get())),
        };
      }, from);
      const seen = JSON.stringify(turn.actions.map((a) => a.result ?? a.error));
      const unmatched = [...new Set([...turn.reply.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => m[0]))].filter((n) => !seen.includes(n));
      transcript.steps.push({ request: text, seconds: (Date.now() - t0) / 1000, ...turn, numbersNotInAnyResult: unmatched });
      console.log(`\n> ${text}\n${turn.shownLabel}\n${turn.reply}\nactions: ${turn.actions.map((a) => `${a.name}${a.ok ? '' : ' (failed)'}`).join(', ')}\nnumbers not found in this turn's results: ${unmatched.join(', ') || 'none'}`);
    }
    transcript.problems = app.problems;
    const dir = join(ROOT, 'e2e', 'artifacts');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `real-model-${transcript.ranAt.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify(transcript, null, 1));
    console.log(`\nTranscript: ${file}`);
    await app.close();
  }
} finally {
  await closeBrowser();
  await stop();
}
