// Calls the app's skyAt() for a list of places and instants and writes the answers as JSON.
//   node tests/fixtures/validation/ephemeris-check/app_skyat.mjs --in FILE.json --out FILE.json [--root DIR]
// Input: [{ id, lat, lon, elevationM, utc }]
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = resolve(opt('--root') ?? join(HERE, '../../../..'));
const rows = JSON.parse(await readFile(resolve(opt('--in')), 'utf8'));
let commit = null;
try { commit = (await readFile(join(ROOT, 'COMMIT'), 'utf8')).trim(); } catch { /* a git checkout */ }
if (!commit) { try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { commit = 'unknown'; } }
const { createServer } = await import('vite');
const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
let out;
try {
  const api = await vite.ssrLoadModule('/src/analysis/api.ts');
  out = rows.map((r) => {
    const s = api.skyAt({ lat: r.lat, lon: r.lon }, r.elevationM, Date.parse(r.utc));
    return { ...r, sun: { az: s.sun.azDeg, el: s.sun.elDeg }, earth: { az: s.earth.azDeg, el: s.earth.elDeg }, subEarth: s.subEarth, subSolar: s.subSolar, source: s.source };
  });
} finally {
  await vite.close();
}
await writeFile(resolve(opt('--out')), JSON.stringify({ app: { commit }, rows: out }, null, 1) + '\n');
console.log(`app ${commit}: ${out.length} instants -> ${opt('--out')}`);
