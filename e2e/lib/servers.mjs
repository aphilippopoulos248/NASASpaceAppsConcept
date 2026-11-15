// Starts `vite preview` for the browser tests: the real built app with its /api routes.
//
// Two servers, so both assistant paths are exercised without any API key:
//   deterministic: LUNYX_LLM_PROVIDER=off       -> the assistant answers in deterministic mode
//   scripted:      LUNYX_LLM_PROVIDER=scripted  -> the scripted test model (not a language model)
// Both ignore any real key in the environment or in .env.local, so a test run never calls
// a paid API. (A real-model run is separate: see e2e/README.md.)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.unref();
    s.on('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function waitFor(url, child, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`vite preview exited with code ${child.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`The preview server did not answer at ${url} within ${timeoutMs / 1000} s (${last})`);
}

/**
 * One preview server. `env` is added to a copy of the environment from which every model
 * credential has been removed.
 */
export async function startPreview(env = {}) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first (npm run e2e does it for you).');
  const port = await freePort();
  const clean = { ...process.env };
  // Tests must never call a paid API. The guard is the provider each server is started with
  // (LUNYX_LLM_PROVIDER=off or scripted), which keeps the SDK unused: a stored `ant auth login`
  // profile is not an environment variable. The credentials and model settings are removed too.
  for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'TYPESAFE_API_KEY', 'LUNYX_ENV_FILE', 'LUNYX_LLM_ROUTER', 'LUNYX_LLM_MODEL']) delete clean[key];
  let log = '';
  const child = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT,
    env: { ...clean, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/assistant`, child);
  } catch (err) {
    child.kill('SIGTERM');
    throw new Error(`${err.message}\n${log.slice(-2000)}`);
  }
  return {
    base,
    log: () => log,
    stop: () =>
      new Promise((ok) => {
        if (child.exitCode !== null) return ok();
        child.once('exit', () => ok());
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref();
      }),
  };
}

let own = null;

/**
 * The base URLs of the two servers. `npm run e2e` starts them once and passes them in the
 * environment; a test file run on its own starts (and later stops) its own pair.
 */
export async function servers() {
  if (process.env.E2E_BASE_DETERMINISTIC && process.env.E2E_BASE_SCRIPTED) {
    return { deterministic: process.env.E2E_BASE_DETERMINISTIC, scripted: process.env.E2E_BASE_SCRIPTED, stop: async () => undefined };
  }
  if (!own) {
    const [deterministic, scripted] = await Promise.all([startPreview({ LUNYX_LLM_PROVIDER: 'off' }), startPreview({ LUNYX_LLM_PROVIDER: 'scripted' })]);
    own = {
      deterministic: deterministic.base,
      scripted: scripted.base,
      stop: async () => {
        await Promise.all([deterministic.stop(), scripted.stop()]);
        own = null;
      },
    };
  }
  return own;
}
