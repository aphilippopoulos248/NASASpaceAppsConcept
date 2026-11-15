// Fetches the JPL Horizons tables of check 7 (dsn/queries.json): a point on the Moon seen from a
// DSN station, and that station seen from the point on the Moon. Airless apparent azimuth,
// elevation and range. Writes dsn/horizons/<id>.json and the unmodified replies (gzip) in dsn/raw/.
//
//   node tests/fixtures/validation/ephemeris-check/fetch_horizons_pairs.mjs [--refresh]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { horizonsTimeToIso, parseHorizonsTable, readHeader } from '../../horizons/ephemeris-check/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'dsn');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const REFRESH = process.argv.includes('--refresh');
const spec = JSON.parse(await readFile(join(DIR, 'queries.json'), 'utf8'));
await mkdir(join(DIR, 'raw'), { recursive: true });
await mkdir(join(DIR, 'horizons'), { recursive: true });
const logPath = join(DIR, 'raw', 'retrieval-log.json');
let log = {};
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch { /* first run */ }
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const hTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
const grab = (text, re) => (re.exec(text)?.[1] ?? '').trim();

async function reply(name, params) {
  const url = `${API}?${new URLSearchParams(params)}`;
  const path = join(DIR, 'raw', name);
  const known = log[name];
  if (!REFRESH && known && known.url === url) {
    try {
      const text = gunzipSync(await readFile(path)).toString('utf8');
      if (sha256(text) === known.sha256) return { text, ...known };
    } catch { /* fetch again */ }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok || !text.includes('$$SOE')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const entry = { url, retrievedUtc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), sha256: sha256(text) };
      await writeFile(path, gzipSync(text, { level: 9 }));
      log[name] = entry;
      await writeFile(logPath, JSON.stringify(log, null, 1) + '\n');
      await new Promise((r) => setTimeout(r, 400));
      return { text, ...entry };
    } catch (e) {
      if (attempt >= 4) throw new Error(`${name}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

const stationGeodetic = {}; // as Horizons states it in the header of a station-sees-site reply
for (const pass of ['station-sees-site', 'site-sees-station']) {
  for (const q of spec.queries.filter((x) => x.direction === pass)) {
    const command = q.command === 'STATION' ? `g: ${stationGeodetic[q.station].join(', ')} @ 399` : q.command;
    const params = {
      format: 'text', MAKE_EPHEM: "'YES'", OBJ_DATA: "'NO'", EPHEM_TYPE: "'OBSERVER'", TIME_TYPE: "'UT'", TIME_DIGITS: "'FRACSEC'", CAL_FORMAT: "'BOTH'",
      ANG_FORMAT: "'DEG'", APPARENT: "'AIRLESS'", RANGE_UNITS: "'KM'", EXTRA_PREC: "'YES'", CSV_FORMAT: "'YES'", QUANTITIES: "'4,20'",
      COMMAND: `'${command}'`, CENTER: `'${q.center}'`, ...(q.siteCoord ? { COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${q.siteCoord}'` } : {}),
      START_TIME: `'${hTime(q.start)}'`, STOP_TIME: `'${hTime(q.stop)}'`, STEP_SIZE: `'${q.stepMinutes} m'`,
    };
    const r = await reply(`${q.id}.txt.gz`, params);
    const head = readHeader(r.text);
    if (head.refraction !== 'NO (AIRLESS)') throw new Error(`${q.id}: refraction is ${head.refraction}`);
    const centerGeodetic = head.centerGeodetic;
    const targetGeodetic = grab(r.text, /^Target geodetic\s*:\s*(.+?)\s*\{/m).split(',').map(Number);
    if (pass === 'station-sees-site') stationGeodetic[q.station] = centerGeodetic;
    const rows = parseHorizonsTable(r.text);
    const count = Math.round((Date.parse(q.stop) - Date.parse(q.start)) / (q.stepMinutes * 60000)) + 1;
    if (rows.length !== count) throw new Error(`${q.id}: ${rows.length} rows, expected ${count}`);
    rows.forEach((row, i) => {
      const want = new Date(Date.parse(q.start) + i * q.stepMinutes * 60000).toISOString().replace('.000Z', 'Z');
      if (horizonsTimeToIso(row['Date__(UT)__HR:MN:SC.fff']) !== want) throw new Error(`${q.id} row ${i}: got ${row['Date__(UT)__HR:MN:SC.fff']}`);
    });
    const out = {
      id: q.id, scenario: q.scenario, station: q.station, direction: q.direction, start: q.start, stop: q.stop, stepMinutes: q.stepMinutes, count,
      horizons: { apiVersion: head.apiVersion, ephemeris: head.ephemeris, centerSite: head.centerSite, centerGeodetic, centerFrame: head.centerFrame, targetGeodetic, targetFrame: head.targetFrame, refraction: head.refraction },
      query: { url: r.url, raw: `raw/${q.id}.txt.gz`, sha256OfUncompressedReply: r.sha256, retrievedUtc: r.retrievedUtc },
      az: rows.map((x) => Number(x['Azimuth_(a-app)'])), el: rows.map((x) => Number(x['Elevation_(a-app)'])), rangeKm: rows.map((x) => Number(Number(x['delta']).toFixed(3))),
    };
    const { az, el, rangeKm, ...headOnly } = out;
    await writeFile(join(DIR, 'horizons', `${q.id}.json`), `${JSON.stringify(headOnly, null, 1).replace(/\n}$/, '')},\n "az": ${JSON.stringify(az)},\n "el": ${JSON.stringify(el)},\n "rangeKm": ${JSON.stringify(rangeKm)}\n}\n`);
    console.log(`${q.id.padEnd(52)} ${String(count).padStart(4)} rows  ${head.centerSite || ''}`);
  }
}
