// Where the grids of a site's terrain stack hand over to each other: the height mismatch
// along each edge in the grids as stored, and in the stack the app uses, in which each site
// grid is eased onto the grid that continues outside it (src/terrain/api.ts, loadTerrainFor).
//
// It also answers "what height does the app use at these points?", so that a check with its
// own reader of the bundled files can be repeated on the ground the analysis really stands on:
// the files in public/terrain are not changed by the easing, which happens when they are loaded.
//
//   node scripts/terrain-seams.mjs                    the sites with a 3 m model: its edge, stored and in use
//   node scripts/terrain-seams.mjs --all              every catalogued site, every hand-over
//   node scripts/terrain-seams.mjs [--all] --json     the same as JSON
//   node scripts/terrain-seams.mjs --heights IN.json [--out OUT.json]
//       IN.json:  { "site": "apollo-17" | { "lat": -84.79, "lon": 29.2 }, "points": [[latDeg, lonDegEast], ...] }
//       OUT.json: { site, heights: [{ inUse, stored, source }] }, metres above the 1737.4 km sphere;
//                 "inUse" is the stack as the app uses it, "stored" the same stack without easing,
//                 "source" the grid that answered (the finest with data at the point)
//
// Heights are metres; a difference is "the grid that continues outside minus the grid that ends".
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const index = JSON.parse(await readFile(join(ROOT, 'public', 'terrain', 'index.json'), 'utf8'));
const landing = (id) => {
  const entry = index.sites[id];
  if (!entry) throw new Error(`"${id}" is not a catalogued site (see public/terrain/index.json)`);
  return { id, name: id, kind: 'landing', lat: entry.lat, lon: entry.lon };
};

// The app's own TypeScript, loaded through Vite: the code the site runs, reading public/ from disk.
const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const { loadTerrainFor } = await vite.ssrLoadModule('/src/terrain/api.ts');

  if (args.includes('--heights')) {
    const input = JSON.parse(await readFile(resolve(opt('--heights')), 'utf8'));
    const site = typeof input.site === 'string' ? landing(input.site) : { id: `pin:${input.site.lat.toFixed(5)},${input.site.lon.toFixed(5)}`, name: 'pin', kind: 'custom', lat: input.site.lat, lon: input.site.lon };
    const inUse = await loadTerrainFor(site, { remote: false });
    const stored = await loadTerrainFor(site, { remote: false, easeEdges: false });
    const at = (stack, lat, lon) => {
      for (const source of stack.sources) {
        const h = source.sample(lat, lon);
        if (!Number.isNaN(h)) return { h, name: source.name };
      }
      return { h: null, name: null };
    };
    const heights = input.points.map(([lat, lon]) => {
      const a = at(inUse, lat, lon);
      return { inUse: a.h, stored: at(stored, lat, lon).h, source: a.name };
    });
    const text = JSON.stringify({ site, sources: inUse.sources.map((s) => ({ name: s.name, resolutionM: s.resolutionM, processing: s.provenance?.processing ?? null })), seams: inUse.seams ?? [], heights }, null, 1) + '\n';
    if (opt('--out')) {
      await writeFile(resolve(opt('--out')), text);
      console.log(`${heights.length} points at ${site.id} -> ${opt('--out')}`);
    } else process.stdout.write(text);
  } else {
    const all = args.includes('--all');
    const rows = [];
    for (const id of Object.keys(index.sites)) {
      if (!all && !index.sites[id].fine) continue;
      const stack = await loadTerrainFor(landing(id));
      for (const seam of stack.seams ?? []) {
        if (!all && seam.inner !== '3 m model') continue;
        rows.push({ site: id, inner: seam.inner, outer: seam.outer, distanceM: seam.distanceM, stored: seam.eased ?? { minM: seam.minM, maxM: seam.maxM, rmsM: seam.rmsM }, inUse: { minM: seam.minM, maxM: seam.maxM, rmsM: seam.rmsM }, easedOverM: seam.eased?.overM ?? null, degPerMetre: seam.degPerMetre });
      }
    }
    if (args.includes('--json')) process.stdout.write(JSON.stringify(rows, null, 1) + '\n');
    else {
      const m = (v) => (v > 0 ? '+' : v < 0 ? '-' : ' ') + Math.abs(v).toFixed(1);
      const three = (x) => `${m(x.minM).padStart(7)} ${m(x.maxM).padStart(7)} ${x.rmsM.toFixed(1).padStart(6)}`;
      console.log(all ? 'Every hand-over between the grids of each catalogued site.' : "The 3 m model against the 60 m window along the model's edge, 768 m from the site.");
      console.log('Metres, the grid that continues outside minus the grid that ends; lowest, highest and RMS along the edge.\n');
      console.log(`${'site'.padEnd(14)}${all ? 'hand-over'.padEnd(38) + 'at'.padStart(8) + '  ' : ''}${'as stored'.padStart(22)}  ${'in the stack'.padStart(22)}   eased over`);
      console.log(`${''.padEnd(14)}${all ? ''.padEnd(48) : ''}${' lowest highest    RMS'.padStart(22)}  ${' lowest highest    RMS'.padStart(22)}`);
      for (const r of rows) {
        const what = all ? `${r.inner} -> ${r.outer}`.padEnd(38) + `${(r.distanceM / 1000).toFixed(2)} km`.padStart(8) + '  ' : '';
        console.log(`${r.site.padEnd(14)}${what}${three(r.stored)}  ${three(r.inUse)}   ${r.easedOverM === null ? 'not eased' : `${r.easedOverM} m`}`);
      }
      console.log(`\n${rows.length} hand-overs at ${new Set(rows.map((r) => r.site)).size} sites. One metre of height is 0.075 deg of skyline at 0.77 km, 0.015 deg at 3.84 km and 0.002 deg at 30.72 km.`);
    }
  }
} finally {
  await vite.close();
}
