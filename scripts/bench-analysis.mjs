// Runtime check of the science core, kept out of the default test run because wall-clock
// limits fail on a busy machine for reasons that have nothing to do with the code (task T-28).
//
// Measures, on real bundled terrain: one skyline profile, analyse() for a 14-day window and the
// default nearby scan, each as the best of a few repetitions on one thread, and compares them
// with the budgets below. Exits 1 when a budget is exceeded.
//
// Run on an otherwise idle machine:   node scripts/bench-analysis.mjs
//   --report-only   print the numbers, never fail
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportOnly = process.argv.includes('--report-only');

/** Budgets, milliseconds, for one thread of this project's reference machine when idle. */
const BUDGET = { profileMs: 500, analyse14dMs: 1500, nearbyMs: 10_000 };

// Load the app's own TypeScript through Vite, so this measures the code the site runs.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const api = await vite.ssrLoadModule('/src/analysis/api.ts');
const { computeHorizon } = await vite.ssrLoadModule('/src/analysis/horizon.ts');
const { setBundleReader } = await vite.ssrLoadModule('/src/analysis/sky.ts');
const { loadTerrainFor } = await vite.ssrLoadModule('/src/terrain/api.ts');
setBundleReader(async (p) => readFileSync(join(ROOT, 'public', p), 'utf8'));

const SITES = [
  { site: { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 }, start: '2025-03-06T17:28:00Z' },
  { site: { id: 'apollo-15', name: 'Apollo 15', kind: 'landing', lat: 26.13239, lon: 3.6333 }, start: '1971-07-30T22:16:00Z' },
  { site: { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', kind: 'landing', lat: 18.562, lon: 61.81 }, start: '2025-03-02T08:34:00Z' },
];

const best = async (reps, f) => {
  let b = Infinity;
  for (let k = 0; k < reps; k++) {
    const t0 = performance.now();
    await f();
    b = Math.min(b, performance.now() - t0);
  }
  return b;
};

const load = os.loadavg()[0];
console.log(`load average ${load.toFixed(2)} on ${os.cpus().length} cores${load > 1.5 ? ' (busy: the numbers below are upper bounds, not the code\'s speed)' : ''}`);
console.log('site                    skyline profile   analyse 14 d   nearby scan (default)');
let worst = { profileMs: 0, analyse14dMs: 0, nearbyMs: 0 };
for (const { site, start } of SITES) {
  const stack = await loadTerrainFor(site);
  const scenario = { id: site.id, label: site.name, site, mastHeightM: 2, startMs: Date.parse(start), durationH: 14 * 24, stepMin: 10 };
  computeHorizon(stack, site, 2); // warm-up
  const profileMs = await best(8, () => computeHorizon(stack, site, 2));
  const analyse14dMs = await best(4, () => api.analyseStack(scenario, stack));
  const nearbyMs = await best(2, () => api.rankNearbyStack(scenario, stack, { ...api.DEFAULT_NEARBY_OPTIONS }));
  console.log(`${site.name.padEnd(22)} ${profileMs.toFixed(0).padStart(10)} ms ${analyse14dMs.toFixed(0).padStart(11)} ms ${nearbyMs.toFixed(0).padStart(14)} ms`);
  worst = { profileMs: Math.max(worst.profileMs, profileMs), analyse14dMs: Math.max(worst.analyse14dMs, analyse14dMs), nearbyMs: Math.max(worst.nearbyMs, nearbyMs) };
}
await vite.close();

console.log(`budget                 ${String(BUDGET.profileMs).padStart(10)} ms ${String(BUDGET.analyse14dMs).padStart(11)} ms ${String(BUDGET.nearbyMs).padStart(14)} ms`);
const over = Object.keys(BUDGET).filter((k) => worst[k] > BUDGET[k]);
if (over.length === 0) {
  console.log('within budget');
} else {
  console.log(`OVER BUDGET: ${over.join(', ')}${load > 1.5 ? ' (the machine was busy; run again when it is idle before concluding anything)' : ''}`);
  if (!reportOnly) process.exit(1);
}
