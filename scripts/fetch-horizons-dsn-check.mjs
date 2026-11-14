// Fetches JPL Horizons reference values for the DSN geometry (src/astro/groundStation.ts,
// src/analysis/dsn.ts): a point on the Moon's surface as seen from each 70 m DSN station
// (apparent airless azimuth and elevation, station coordinates as Horizons holds them), and
// writes src/analysis/__fixtures__/horizons-dsn-check.json for the offline tests.
// Run with: node scripts/fetch-horizons-dsn-check.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, fetchCached } from './horizons-lib.mjs';

const STATIONS = [
  { id: 'DSS-14', center: '-14@399' },
  { id: 'DSS-43', center: '-43@399' },
  { id: 'DSS-63', center: '-63@399' },
];
// Lunar sites: longitude E, latitude, height km (heights from public/terrain/index.json).
const SITES = [
  { id: 'blue-ghost-1', lat: 18.562, lon: 61.81, altKm: -3.652 },
  { id: 'im-2', lat: -84.79, lon: 29.2, altKm: 5.321 },
  { id: 'limb-west', lat: -35, lon: -88, altKm: 0 },
];
// Hourly for two days (several rises and sets at every station), plus one day at 1 min for rise/set times.
const SPANS = [
  { name: 'hourly', start: '2025-03-06 00:00', stop: '2025-03-08 00:00', step: '60 m' },
  { name: 'minute', start: '2025-03-13 00:00', stop: '2025-03-14 00:00', step: '1 m' },
  { name: 'hourly-1971', start: '1971-07-31 00:00', stop: '1971-08-01 00:00', step: '60 m' },
  { name: 'hourly-2034', start: '2034-09-10 00:00', stop: '2034-09-11 00:00', step: '60 m' },
];
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

const sets = [];
for (const st of STATIONS) {
  for (const site of SITES) {
    for (const span of SPANS) {
      if (span.name !== 'hourly' && span.name !== 'minute' && site.id !== 'blue-ghost-1') continue;
      if (span.name === 'minute' && site.id === 'limb-west') continue;
      const params = new URLSearchParams({
        format: 'text',
        COMMAND: `'g: ${site.lon}, ${site.lat}, ${site.altKm} @ 301'`,
        CENTER: `'${st.center}'`,
        EPHEM_TYPE: "'OBSERVER'",
        QUANTITIES: "'4,20'",
        START_TIME: `'${span.start}'`,
        STOP_TIME: `'${span.stop}'`,
        STEP_SIZE: `'${span.step}'`,
        APPARENT: "'AIRLESS'",
        ANG_FORMAT: "'DEG'",
        CSV_FORMAT: "'YES'",
        EXTRA_PREC: "'YES'",
        OBJ_DATA: "'NO'",
        TIME_DIGITS: "'SECONDS'",
      });
      const text = await fetchCached(params);
      const header = (key) => (text.split('\n').find((l) => l.startsWith(key)) ?? '').slice(key.length).trim();
      const body = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
      const rows = body.map((line) => {
        const f = line.split(',').map((s) => s.trim());
        const m = /^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(f[0]);
        const t = Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5], +m[6]);
        // date, solar presence, lunar presence, (two more flags for a surface target), az, el, delta AU, deldot
        const nums = f.slice(1).filter((x) => /^-?\d/.test(x)).map(Number);
        return [t, nums[0], nums[1], Math.round(nums[2] * 149597870.7 * 1000) / 1000];
      });
      // The 1 min sets exist for the rise and set times through the elevation limits: keep only the rows around them.
      const kept = span.name === 'minute' ? rows.filter((r) => r[2] >= 4 && r[2] <= 13) : rows;
      sets.push({
        station: st.id, site, span: span.name, stepMs: rows.length > 1 ? rows[1][0] - rows[0][0] : 0,
        centerGeodetic: header('Center geodetic :').split('{')[0].trim(),
        centerName: header('Center-site name:'),
        targetGeodetic: header('Target geodetic :').split('{')[0].trim(),
        targetFrame: header('Target pole/equ :').split('{')[0].trim(),
        rows: kept,
      });
      console.log(`${st.id} ${site.id} ${span.name}: ${kept.length} rows`);
      await new Promise((r) => setTimeout(r, 600));
    }
  }
}
const dir = join(ROOT, 'src', 'analysis', '__fixtures__');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'horizons-dsn-check.json'), JSON.stringify({
  source: "JPL Horizons API (DE441). Target: a point on the Moon's surface, COMMAND='g: lonE, lat, alt_km @ 301' (MEAN_ME). Observer: DSN stations -14@399, -43@399, -63@399 (ITRF93). QUANTITIES='4,20', APPARENT='AIRLESS'. rows: [UTC ms, azimuth deg, elevation deg, range km].",
  fetched: new Date().toISOString().slice(0, 10),
  sets,
}) + '\n');
console.log(`${sets.length} sets, ${sets.reduce((a, s) => a + s.rows.length, 0)} rows`);
