// Fetches JPL Horizons topocentric airless Sun and Earth tables for a few real
// mission windows and writes them to public/data/horizons/ so those sites play
// with no network. The app uses a table when a scenario lies inside its window.
// Run with: node scripts/build-horizons-bundle.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, topoParams, fetchCached, parseRows, jdToMs } from './horizons-lib.mjs';

const OUT = join(ROOT, 'public', 'data', 'horizons');
const STEP_MIN = 10;
// Heights: terrain at the site from public/terrain/index.json (metres above 1737.4 km).
const WINDOWS = [
  {
    id: 'blue-ghost-1-2025-03',
    label: 'Blue Ghost Mission 1, Mare Crisium: 2025-03-01 to 2025-04-01 (landing 2025-03-02, the 2025-03-14 eclipse of the Sun by Earth, end of operations)',
    siteId: 'blue-ghost-1', lat: 18.562, lon: 61.81, heightM: -3652,
    start: '2025-03-01 00:00', stop: '2025-04-01 00:00',
  },
  {
    id: 'im-2-2025-03',
    label: 'IM-2 Athena, Mons Mouton (south polar region): 2025-03-05 to 2025-04-05 (landing 2025-03-06)',
    siteId: 'im-2', lat: -84.79, lon: 29.2, heightM: 5321,
    start: '2025-03-05 00:00', stop: '2025-04-05 00:00',
  },
];

await mkdir(OUT, { recursive: true });
const index = [];
for (const w of WINDOWS) {
  const site = { lat: w.lat, lon: w.lon, altKm: w.heightM / 1000 };
  const out = { id: w.id, label: w.label, siteId: w.siteId, site: { lat: w.lat, lon: w.lon, heightM: w.heightM } };
  for (const [body, target] of [['sun', '10'], ['earth', '399']]) {
    const params = topoParams(target, site, { start: w.start, stop: w.stop, step: `${STEP_MIN} m` });
    const rows = parseRows(await fetchCached(params));
    const t0 = Math.round(jdToMs(rows[0].jd) / 1000) * 1000;
    out.startMs = t0;
    out.stepMs = STEP_MIN * 60000;
    out.n = rows.length;
    out[body] = {
      az: rows.map((r) => Math.round(r.az * 1e4) / 1e4),
      el: rows.map((r) => Math.round(r.el * 1e4) / 1e4),
      // Range changes slowly: every 6th row (hourly) is plenty.
      distKmHourly: rows.filter((_, i) => i % 6 === 0).map((r) => Math.round(r.deltaAu * 149597870.7)),
    };
    // Sanity: rows are evenly spaced.
    rows.forEach((r, i) => {
      if (Math.abs(jdToMs(r.jd) - (t0 + i * out.stepMs)) > 1000) throw new Error(`${w.id}: uneven step at row ${i}`);
    });
  }
  out.query = {
    service: 'JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api), DE441',
    CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${w.lon},${w.lat},${w.heightM / 1000}`,
    QUANTITIES: '4,20', APPARENT: 'AIRLESS', START_TIME: w.start, STOP_TIME: w.stop, STEP_SIZE: `${STEP_MIN} m`,
    fetched: new Date().toISOString().slice(0, 10),
  };
  const json = JSON.stringify(out);
  await writeFile(join(OUT, `${w.id}.json`), json + '\n');
  index.push({ id: w.id, label: w.label, siteId: w.siteId, site: out.site, startMs: out.startMs, stepMs: out.stepMs, n: out.n, file: `${w.id}.json`, bytes: json.length + 1 });
  console.log(`${w.id}: ${out.n} rows, ${(json.length / 1024).toFixed(0)} KB`);
}
await writeFile(join(OUT, 'index.json'), JSON.stringify({ windows: index }, null, 1) + '\n');
