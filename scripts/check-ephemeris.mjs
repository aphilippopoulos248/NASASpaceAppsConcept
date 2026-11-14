// Compares src/astro/ephemeris.ts against the saved JPL Horizons values, and
// prints the Sun's elevation at each landing site at touchdown.
// Run with: npm run check-ephemeris
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Load the app's own TypeScript module through Vite, so this tests the code the site runs.
const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { moonGeometry, elevation } = await vite.ssrLoadModule('/src/astro/ephemeris.ts');
await vite.close();

const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));
const { points } = JSON.parse(await readFile(join(ROOT, 'public/data/horizons-check.json'), 'utf8'));

// Great-circle separation between two lat/lon points, degrees.
const sep = (a, b) => {
  const r = Math.PI / 180;
  const c = Math.sin(a.lat * r) * Math.sin(b.lat * r) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.cos((a.lon - b.lon) * r);
  return Math.acos(Math.min(1, c)) / r;
};

let worstSun = 0, worstEarth = 0;
console.log('site            sun err   earth err   sun elevation at touchdown');
for (const p of points) {
  const l = landings.find((x) => x.id === p.id);
  const g = moonGeometry(new Date(p.utc));
  const eSun = sep(g.subSolar, p.subSolar);
  const eEarth = sep(g.subEarth, p.subEarth);
  worstSun = Math.max(worstSun, eSun);
  worstEarth = Math.max(worstEarth, eEarth);
  console.log(`${p.id.padEnd(14)} ${eSun.toFixed(3).padStart(7)}°  ${eEarth.toFixed(3).padStart(7)}°   ${elevation(l.lat, l.lon, g.sunDir).toFixed(1).padStart(6)}°`);
}
console.log(`\nworst sub-solar error ${worstSun.toFixed(3)}°, worst sub-Earth error ${worstEarth.toFixed(3)}°`);
if (worstSun > 0.2 || worstEarth > 0.2) {
  console.error('FAIL: disagreement with Horizons exceeds 0.2°');
  process.exit(1);
}
