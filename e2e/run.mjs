// `npm run e2e`: the browser tests against the real built app.
//
//   1. installs dependencies if they are missing and builds (`npm run build`), unless
//      --no-build is given or E2E_NO_BUILD=1 is set;
//   2. finds out whether headless Chromium gets the GPU here (E2E_GL, see e2e/lib/app.mjs) and
//      prints the renderer; with --lock it then waits for the shared lock that matches
//      (/tmp/lunyx-gpu.lock for the GPU, /tmp/lunyx-heavy.lock for software rendering);
//   3. starts two `vite preview` servers on free ports (no model, scripted test model);
//   4. runs e2e/*.test.mjs and e2e/scenario/*.test.mjs with node:test, one file at a time;
//   5. stops the servers, prints the duration and the load, and exits with the tests' status.
//
// Arguments after the flags select test files by substring:  npm run e2e -- assistant
// and --grep=<text> selects tests by name:                    npm run e2e -- flow --grep=delay
// The tests need no network and no API key: see e2e/lib/app.mjs and e2e/lib/servers.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChromium } from './lib/app.mjs';
import { ROOT, startPreview } from './lib/servers.mjs';

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build') || process.env.E2E_NO_BUILD === '1';
const filters = args.filter((a) => !a.startsWith('--'));
// --grep=<text> runs only the tests whose name matches (node's --test-name-pattern).
const grep = args.find((a) => a.startsWith('--grep='))?.slice('--grep='.length);
// --lock: run the browser part under the shared lock for its renderer (a shared build machine).
const lock = args.includes('--lock') && !process.env.E2E_LOCKED;
const load = () => (existsSync('/proc/loadavg') ? readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ') : 'n/a');
const t0 = Date.now();

let current = null;

function run(command, commandArgs, env = process.env) {
  return new Promise((ok) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, env, stdio: 'inherit' });
    current = child;
    child.on('error', (err) => {
      current = null;
      console.error(`e2e: could not run ${command}: ${err.message}`);
      ok(127);
    });
    child.on('exit', (code, signal) => {
      current = null;
      ok(code ?? (signal ? 1 : 0));
    });
  });
}

// Ctrl-C or a kill stops the tests first; the servers are then stopped below as usual.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => current?.kill('SIGTERM'));

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!noBuild) {
  console.log('e2e: building the app (npm run build)');
  const code = await run(npm, ['run', 'build']);
  if (code !== 0) {
    console.error('e2e: the build failed, so no browser test was run.');
    process.exit(code);
  }
}

// Which renderer the tests get. The test files are told the outcome, so they all use the same one.
const probe = await launchChromium();
await probe.browser.close();
console.log(`e2e: Chromium renders with ${probe.renderer ?? 'no WebGL'} (${probe.mode === 'gpu' ? 'GPU' : 'SwiftShader, software'})`);

if (lock) {
  const lockFile = probe.mode === 'gpu' ? '/tmp/lunyx-gpu.lock' : '/tmp/lunyx-heavy.lock';
  console.log(`e2e: waiting for ${lockFile}, load ${load()}`);
  const code = await run('flock', [lockFile, process.execPath, join('e2e', 'run.mjs'), '--no-build', ...args.filter((a) => a !== '--lock' && a !== '--no-build')], { ...process.env, E2E_LOCKED: '1', E2E_GL: probe.mode });
  process.exit(code);
}

// e2e/*.test.mjs and e2e/scenario/*.test.mjs (the assistant's browser scenarios).
const testsIn = (dir) => (existsSync(join(ROOT, dir)) ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.test.mjs')).map((f) => join(dir, f)) : []);
const files = [...testsIn('e2e'), ...testsIn(join('e2e', 'scenario'))]
  .filter((f) => !filters.length || filters.some((s) => f.includes(s)))
  .sort();
if (!files.length) {
  console.error(`e2e: no test file matches ${filters.join(', ')}`);
  process.exit(1);
}

console.log(`e2e: starting the preview servers, load ${load()}`);
const started = await Promise.allSettled([startPreview({ LUNYX_LLM_PROVIDER: 'off' }), startPreview({ LUNYX_LLM_PROVIDER: 'scripted' })]);
const stopAll = () => Promise.all(started.map((s) => (s.status === 'fulfilled' ? s.value.stop() : undefined)));
const failed = started.find((s) => s.status === 'rejected');
if (failed) {
  console.error(`e2e: ${failed.reason?.message ?? failed.reason}`);
  await stopAll();
  process.exit(1);
}
const [deterministic, scripted] = started.map((s) => s.value);
console.log(`e2e: deterministic mode at ${deterministic.base}, scripted test model at ${scripted.base}`);

let code = 1;
try {
  // The readable report goes to the terminal; a TAP copy with each failure's details is
  // written as the tests finish, so a long run can be inspected while it is still going.
  const artifacts = join(ROOT, 'e2e', 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const reporters = ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=tap', `--test-reporter-destination=${join(artifacts, 'last-run.tap')}`];
  code = await run(process.execPath, ['--test', '--test-concurrency=1', ...(grep ? [`--test-name-pattern=${grep}`] : []), ...reporters, ...files], {
    ...process.env,
    E2E_BASE_DETERMINISTIC: deterministic.base,
    E2E_BASE_SCRIPTED: scripted.base,
    E2E_GL: probe.mode,
  });
} finally {
  await stopAll();
}
const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
console.log(`e2e: ${files.length} file${files.length === 1 ? '' : 's'} in ${minutes} min with ${probe.mode === 'gpu' ? 'the GPU' : 'SwiftShader'}, load at the end ${load()}.`);
console.log(code === 0 ? 'e2e: all browser tests passed.' : `e2e: browser tests failed (exit code ${code}).`);
process.exit(code);
