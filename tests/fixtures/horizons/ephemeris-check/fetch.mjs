// Builds the Horizons sky fixture: asks JPL Horizons where the Sun and Earth are in the sky of
// each site in sets.json (airless, topocentric), plus the Moon's sub-Earth / sub-solar points,
// and writes data/<set>.json, raw/<...>.txt (the unmodified replies) and index.json.
//
//   node tests/fixtures/horizons/ephemeris-check/fetch.mjs            fetch what is missing, rebuild JSON
//   node tests/fixtures/horizons/ephemeris-check/fetch.mjs --refresh  ask Horizons again for everything
//   node tests/fixtures/horizons/ephemeris-check/fetch.mjs --only <set-id>
//
// Standalone on purpose: Node built-ins only, and it imports nothing from src/ or scripts/, so the
// reference data cannot inherit a mistake from the code it is used to check.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, assertMoonHeader, assertSiteHeader, parseHorizonsTable, rowsFromTables, serialiseSet } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const args = process.argv.slice(2);
const REFRESH = args.includes('--refresh');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const spec = await readJson(join(HERE, 'sets.json'));
const { landings } = await readJson(join(ROOT, 'public/data/landings.json'));
const terrain = await readJson(join(ROOT, 'public/terrain/index.json'));
if (terrain.radius !== 1737400) throw new Error(`terrain heights are not relative to 1737.4 km (radius ${terrain.radius})`);

// ---------- sites ----------
function resolveSite(id) {
  const s = spec.sites[id];
  if (!s) throw new Error(`unknown site ${id}`);
  if (!s.landing) return { id, name: s.name, kind: 'synthetic', lat: s.lat, lon: s.lon, altKm: s.altKm, altSource: 'none: on the reference sphere', ...(s.note ? { note: s.note } : {}) };
  const l = landings.find((x) => x.id === s.landing);
  const t = terrain.sites[s.landing];
  if (!l || !t || !Number.isFinite(t.height)) throw new Error(`no pin or terrain height for ${s.landing}`);
  return {
    id, name: l.name, kind: 'landing', lat: l.lat, lon: l.lon, altKm: t.height / 1000,
    altSource: `public/terrain/index.json: ${t.height} m above the 1737.4 km sphere (${t.source})`,
    pinSource: 'public/data/landings.json',
  };
}

// ---------- queries ----------
const hTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 19)}`; // 2025-03-02T09:00:00Z -> 2025-03-02 09:00:00
function timeSpec(set) {
  if (set.range) {
    const { start, stop, stepMinutes } = set.range;
    const utc = [];
    for (let t = Date.parse(start); t <= Date.parse(stop); t += stepMinutes * 60000) utc.push(new Date(t).toISOString().replace('.000Z', 'Z'));
    return {
      key: set.id.split('.').slice(1).join('.'), utc,
      params: { START_TIME: `'${hTime(start)}'`, STOP_TIME: `'${hTime(stop)}'`, STEP_SIZE: `'${stepMinutes} m'` },
      describe: { scale: 'UTC', start, stop, stepMinutes, count: utc.length },
    };
  }
  const list = spec.timeLists[set.list];
  if (!list) throw new Error(`unknown time list ${set.list}`);
  return {
    key: set.list, utc: list.utc,
    params: { TLIST: list.utc.map((u) => `'${hTime(u)}'`).join(' ') },
    describe: { scale: 'UTC', list: set.list, start: list.utc[0], stop: list.utc.at(-1), count: list.utc.length, note: list.note },
  };
}

const COMMON = {
  format: 'text', MAKE_EPHEM: "'YES'", OBJ_DATA: "'NO'", EPHEM_TYPE: "'OBSERVER'",
  TIME_TYPE: "'UT'", TIME_DIGITS: "'FRACSEC'", CAL_FORMAT: "'BOTH'", ANG_FORMAT: "'DEG'",
  APPARENT: "'AIRLESS'", RANGE_UNITS: "'KM'", EXTRA_PREC: "'YES'", CSV_FORMAT: "'YES'",
};
/** Sun (10) or Earth (399) seen from a site on the Moon: az/el, illuminated %, angular diameter, range, Sun elongation, phase angle. */
const siteQuery = (body, site, time) => ({
  ...COMMON, COMMAND: `'${body}'`, CENTER: "'coord@301'", COORD_TYPE: "'GEODETIC'",
  SITE_COORD: `'${site.lon},${site.lat},${site.altKm}'`, QUANTITIES: "'4,10,13,20,23,24'", ...time.params,
});
/** The Moon seen from Earth's centre: sub-observer (= sub-Earth) and sub-solar longitude/latitude. */
const moonQuery = (time) => ({ ...COMMON, COMMAND: "'301'", CENTER: "'500@399'", QUANTITIES: "'14,15'", ...time.params });
const urlOf = (params) => `${API}?${new URLSearchParams(params)}`;

const logPath = join(HERE, 'raw/retrieval-log.json');
let log = {};
try { log = await readJson(logPath); } catch { /* first run */ }
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Returns the reply text for a query, from raw/ when already fetched (unless --refresh). */
async function reply(rawName, params) {
  const url = urlOf(params);
  const rawPath = join(HERE, 'raw', rawName);
  const known = log[rawName];
  if (!REFRESH && known && known.url === url) {
    const text = await readFile(rawPath, 'utf8').catch(() => null);
    if (text !== null && sha256(text) === known.sha256) return { text, ...known, raw: `raw/${rawName}` };
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok || !text.includes('$$SOE')) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      const entry = { url, retrievedUtc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), sha256: sha256(text) };
      await writeFile(rawPath, text);
      log[rawName] = entry;
      await writeFile(logPath, JSON.stringify(log, null, 1) + '\n');
      await new Promise((r) => setTimeout(r, 400)); // one request at a time, politely
      return { text, ...entry, raw: `raw/${rawName}` };
    } catch (e) {
      if (attempt >= 4) throw new Error(`${rawName}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

// ---------- build ----------
await mkdir(join(HERE, 'raw'), { recursive: true });
await mkdir(join(HERE, 'data'), { recursive: true });
const index = [];
for (const set of spec.sets) {
  if (ONLY && set.id !== ONLY) continue;
  const site = resolveSite(set.site);
  const time = timeSpec(set);
  const sun = await reply(`${set.id}.sun.txt`, siteQuery(10, site, time));
  const earth = await reply(`${set.id}.earth.txt`, siteQuery(399, site, time));
  const moon = await reply(`moon-subpoints.${time.key}.txt`, moonQuery(time));

  const tables = { sun: parseHorizonsTable(sun.text), earth: parseHorizonsTable(earth.text), moon: parseHorizonsTable(moon.text) };
  // Each of these throws if Horizons answered something other than what was asked.
  const head = assertSiteHeader(sun.text, 'sun', site);
  assertSiteHeader(earth.text, 'earth', site);
  assertMoonHeader(moon.text);
  const rows = rowsFromTables(tables, time.utc);
  const q = ({ url, raw, sha256: hash, retrievedUtc }) => ({ url, raw, sha256: hash, retrievedUtc });
  const doc = {
    schema: SCHEMA,
    id: set.id,
    title: set.title,
    site,
    time: time.describe,
    source: {
      service: 'NASA/JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api)',
      apiVersion: head.apiVersion,
      ephemeris: head.ephemeris,
      moonFrame: head.centerFrame,
      moonRadiiKm: head.centerRadii,
      refraction: head.refraction,
      retrievedUtc: [sun.retrievedUtc, earth.retrievedUtc, moon.retrievedUtc].sort()[0],
    },
    units: 'utc: ISO 8601 UTC. az, el: deg, airless apparent, of the body centre (az clockwise from north; el above the local horizontal of the 1737.4 km sphere). angDiamArcsec: arcsec. rangeKm: km from the site. illumPct: % of the disc sunlit. sunElongDeg: deg between Sun and Earth centres in the site sky. subEarth, subSolar: deg, lat north+, lon east+ in -180..180 (Moon ME frame).',
    query: { sun: q(sun), earth: q(earth), moon: q(moon) },
    rows,
  };
  await writeFile(join(HERE, 'data', `${set.id}.json`), serialiseSet(doc));
  index.push({ id: set.id, file: `data/${set.id}.json`, title: set.title, site, time: (({ note, ...t }) => t)(time.describe) });
  console.log(`${set.id.padEnd(36)} ${String(rows.length).padStart(4)} rows  (${site.lat}, ${site.lon}, ${site.altKm} km)`);
}

if (!ONLY) {
  const total = index.reduce((n, s) => n + s.time.count, 0);
  const out = {
    schema: `${SCHEMA}:index`,
    description: 'JPL Horizons reference values for the Sun and Earth in the sky of sites on the Moon (airless, topocentric), with the Moon sub-Earth / sub-solar points. One file per site and time set; format and conventions in README.md.',
    conventions: spec.conventions,
    fields: spec.fields,
    tolerance: spec.tolerance,
    rows: total,
    sets: index,
  };
  await writeFile(join(HERE, 'index.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`\n${index.length} sets, ${total} rows`);
}
