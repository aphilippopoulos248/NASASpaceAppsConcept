// Fetches the hourly JPL Horizons series listed in horizons/queries.json (Sun and Earth seen
// from a site on the Moon, airless, topocentric) and writes horizons/<id>.json plus the
// unmodified replies, gzip-compressed, in horizons/raw/. Same query as the T-18 sky fixture
// (tests/fixtures/horizons/ephemeris-check), whose table reader and header checks are reused.
//
//   node tests/fixtures/validation/ephemeris-check/fetch_horizons_series.mjs [--refresh]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { assertSiteHeader, horizonsTimeToIso, parseHorizonsTable, readHeader } from '../../horizons/ephemeris-check/lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'horizons');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const REFRESH = process.argv.includes('--refresh');
const spec = JSON.parse(await readFile(join(DIR, 'queries.json'), 'utf8'));
await mkdir(join(DIR, 'raw'), { recursive: true });
const logPath = join(DIR, 'raw', 'retrieval-log.json');
let log = {};
try { log = JSON.parse(await readFile(logPath, 'utf8')); } catch { /* first run */ }
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const hTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;

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

for (const s of spec.series) {
  const count = Math.round((Date.parse(s.stop) - Date.parse(s.start)) / (s.stepMinutes * 60000)) + 1;
  const out = { id: s.id, site: s.site, start: s.start, stop: s.stop, stepMinutes: s.stepMinutes, count, source: null, query: {} };
  for (const [body, command] of [['sun', 10], ['earth', 399]]) {
    const r = await reply(`${s.id}.${body}.txt.gz`, {
      format: 'text', MAKE_EPHEM: "'YES'", OBJ_DATA: "'NO'", EPHEM_TYPE: "'OBSERVER'", TIME_TYPE: "'UT'", TIME_DIGITS: "'FRACSEC'", CAL_FORMAT: "'BOTH'",
      ANG_FORMAT: "'DEG'", APPARENT: "'AIRLESS'", RANGE_UNITS: "'KM'", EXTRA_PREC: "'YES'", CSV_FORMAT: "'YES'",
      COMMAND: `'${command}'`, CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'", SITE_COORD: `'${s.site.lon},${s.site.lat},${s.site.altKm}'`,
      QUANTITIES: "'4,10,13,20,23,24'", START_TIME: `'${hTime(s.start)}'`, STOP_TIME: `'${hTime(s.stop)}'`, STEP_SIZE: `'${s.stepMinutes} m'`,
    });
    const head = assertSiteHeader(r.text, body, s.site);
    const rows = parseHorizonsTable(r.text);
    if (rows.length !== count) throw new Error(`${s.id} ${body}: ${rows.length} rows, expected ${count}`);
    rows.forEach((row, i) => {
      const want = new Date(Date.parse(s.start) + i * s.stepMinutes * 60000).toISOString().replace('.000Z', 'Z');
      if (horizonsTimeToIso(row['Date__(UT)__HR:MN:SC.fff']) !== want) throw new Error(`${s.id} ${body} row ${i}: got ${row['Date__(UT)__HR:MN:SC.fff']}, wanted ${want}`);
    });
    out.source = { service: 'NASA/JPL Horizons API', apiVersion: readHeader(r.text).apiVersion, ephemeris: head.ephemeris, moonFrame: head.centerFrame, refraction: head.refraction };
    out.query[body] = { url: r.url, raw: `raw/${s.id}.${body}.txt.gz`, sha256OfUncompressedReply: r.sha256, retrievedUtc: r.retrievedUtc };
    out[body] = {
      az: rows.map((x) => Number(x['Azimuth_(a-app)'])), el: rows.map((x) => Number(x['Elevation_(a-app)'])),
      angDiamArcsec: rows.map((x) => Number(x['Ang-diam'])),
      ...(body === 'earth' ? { sunElongDeg: rows.map((x) => Number(x['S-O-T'])) } : {}),
    };
  }
  const { sun, earth, ...head } = out;
  const arr = (o) => `{${Object.entries(o).map(([k, v]) => `\n   ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',')}\n  }`;
  await writeFile(join(DIR, `${s.id}.json`), `${JSON.stringify(head, null, 1).replace(/\n}$/, '')},\n "sun": ${arr(sun)},\n "earth": ${arr(earth)}\n}\n`);
  console.log(`${s.id.padEnd(30)} ${String(count).padStart(5)} rows`);
}
