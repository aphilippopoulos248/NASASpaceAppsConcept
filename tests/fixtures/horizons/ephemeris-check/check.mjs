// Independent check of the Horizons sky fixture and of the code it is meant to test.
// No network. Run from the repository root (after `npm ci` for parts 3 and 4):
//
//   node tests/fixtures/horizons/ephemeris-check/check.mjs              everything
//   node tests/fixtures/horizons/ephemeris-check/check.mjs --data-only  parts 1-2 (needs no node_modules)
//   node tests/fixtures/horizons/ephemeris-check/check.mjs --root DIR   test the code of another checkout
//   node tests/fixtures/horizons/ephemeris-check/check.mjs --json FILE  also write the numbers as JSON
//
// 1. Integrity   every row is re-derived from the stored raw Horizons reply (SHA-256 verified),
//                and the reply headers must state the site, frame, sphere and "AIRLESS".
// 2. Geometry    the values must agree with each other and with this file's own maths:
//                Sun-Earth separation from the two az/el pairs = Horizons' S-O-T, angular
//                diameter = 2 asin(R / range), and az/el rebuilt from the Moon-centre sub-points.
// 3. Baseline    src/astro/ephemeris.ts moonGeometry() (Moon-centre directions), as it is and
//                with the site parallax added here.
// 4. Sky model   src/analysis/api.ts skyAt(), when it is implemented.
//
// Exit code 1 if the fixture is inconsistent or a model is outside the tolerance in index.json.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  D2R, MOON_RADIUS_KM, SCHEMA, arc, assertMoonHeader, assertSiteHeader, azEl, dot, fromLatLon,
  parseHorizonsTable, rowsFromTables, separation, skyError,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = resolve(opt('--root') ?? join(HERE, '../../../..'));
const DATA_ONLY = args.includes('--data-only');
const JSON_OUT = opt('--json');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const index = await readJson(join(HERE, 'index.json'));
const spec = await readJson(join(HERE, 'sets.json'));
const tol = index.tolerance;
const report = { fixture: { sets: index.sets.length, rows: 0 }, problems: [], geometry: {}, baseline: null, skyAt: null };
const fail = (msg) => { report.problems.push(msg); console.log(`  FAIL  ${msg}`); };
const max = (a, b) => (Math.abs(b) > Math.abs(a) ? b : a);
const f4 = (x) => (Number.isFinite(x) ? Math.abs(x).toFixed(4) : '   n/a');

// ---------------------------------------------------------------- 1. integrity
console.log('1. Integrity: rows re-derived from the raw Horizons replies');
const sets = [];
if (index.sets.length !== spec.sets.length) fail(`index.json lists ${index.sets.length} sets, sets.json ${spec.sets.length}`);
for (const entry of index.sets) {
  const doc = await readJson(join(HERE, entry.file));
  sets.push(doc);
  const where = doc.id;
  try {
    if (doc.schema !== SCHEMA) throw new Error(`schema is ${doc.schema}`);
    if (JSON.stringify(doc.site) !== JSON.stringify(entry.site)) throw new Error('site differs from index.json');
    const { site } = doc;
    if (!(Math.abs(site.lat) <= 90 && site.lon > -180 && site.lon <= 180 && Number.isFinite(site.altKm))) throw new Error(`site out of range: ${site.lat}, ${site.lon}, ${site.altKm}`);
    const texts = {};
    for (const body of ['sun', 'earth', 'moon']) {
      const q = doc.query[body];
      const text = await readFile(join(HERE, q.raw), 'utf8');
      if (createHash('sha256').update(text).digest('hex') !== q.sha256) throw new Error(`${q.raw} does not match its recorded SHA-256`);
      // The stored URL must be the request that the reply answers.
      const p = new URL(q.url).searchParams;
      if (body !== 'moon') {
        if (p.get('CENTER') !== "'coord@301'" || p.get('COORD_TYPE') !== "'GEODETIC'" || p.get('APPARENT') !== "'AIRLESS'") throw new Error(`${body} query is not an airless coord@301 site query`);
        if (p.get('SITE_COORD') !== `'${site.lon},${site.lat},${site.altKm}'`) throw new Error(`${body} query SITE_COORD ${p.get('SITE_COORD')} is not the file's site`);
        if (p.get('COMMAND') !== (body === 'sun' ? "'10'" : "'399'")) throw new Error(`${body} query targets ${p.get('COMMAND')}`);
        assertSiteHeader(text, body, site);
      } else {
        if (p.get('COMMAND') !== "'301'" || p.get('CENTER') !== "'500@399'") throw new Error('moon query is not the Moon seen from the geocentre');
        assertMoonHeader(text);
      }
      if (p.get('TIME_TYPE') !== "'UT'") throw new Error(`${body} query is not in UT`);
      texts[body] = text;
    }
    const utc = doc.rows.map((r) => r.utc);
    if (utc.length !== doc.time.count) throw new Error(`${utc.length} rows, time.count says ${doc.time.count}`);
    utc.forEach((u, i) => {
      if (new Date(Date.parse(u)).toISOString().replace('.000Z', 'Z') !== u) throw new Error(`row ${i}: "${u}" is not a canonical UTC instant`);
      if (i && Date.parse(u) <= Date.parse(utc[i - 1])) throw new Error(`row ${i}: instants are not ascending`);
      if (doc.time.stepMinutes && Date.parse(u) !== Date.parse(doc.time.start) + i * doc.time.stepMinutes * 60000) throw new Error(`row ${i}: off the ${doc.time.stepMinutes}-minute grid`);
    });
    if (utc[0] !== doc.time.start || utc.at(-1) !== doc.time.stop) throw new Error('first/last instant differ from time.start/stop');
    const rebuilt = rowsFromTables({ sun: parseHorizonsTable(texts.sun), earth: parseHorizonsTable(texts.earth), moon: parseHorizonsTable(texts.moon) }, utc);
    if (JSON.stringify(rebuilt) !== JSON.stringify(doc.rows)) throw new Error('rows differ from what the raw replies contain');
    for (const r of doc.rows) {
      for (const b of [r.sun, r.earth]) {
        if (!(b.az >= 0 && b.az < 360 && Math.abs(b.el) <= 90 && b.angDiamArcsec > 0 && b.rangeKm > 0)) throw new Error(`${r.utc}: value out of range`);
      }
      if (!(r.earth.illumPct >= 0 && r.earth.illumPct <= 100 && r.earth.sunElongDeg >= 0 && r.earth.sunElongDeg <= 180)) throw new Error(`${r.utc}: Earth phase value out of range`);
    }
    report.fixture.rows += doc.rows.length;
  } catch (e) {
    fail(`${where}: ${e.message}`);
  }
}
if (report.fixture.rows !== index.rows) fail(`index.json says ${index.rows} rows, files hold ${report.fixture.rows}`);
// Nothing unaccounted for: every file in data/ and raw/ belongs to a set.
{
  const dataFiles = new Set(index.sets.map((s) => s.file.slice(5)));
  const rawFiles = new Set(['retrieval-log.json', ...sets.flatMap((d) => Object.values(d.query).map((q) => q.raw.slice(4)))]);
  for (const name of await readdir(join(HERE, 'data'))) if (!dataFiles.has(name)) fail(`data/${name} is not listed in index.json`);
  for (const name of await readdir(join(HERE, 'raw'))) if (!rawFiles.has(name)) fail(`raw/${name} is not referenced by any set`);
  const ids = spec.sets.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(index.sets.map((s) => s.id))) fail('index.json and sets.json list different sets');
}
// Landing pins and heights are copied from the app's data at fetch time: say so if they have moved since.
try {
  const { landings } = await readJson(join(ROOT, 'public/data/landings.json'));
  const terrain = await readJson(join(ROOT, 'public/terrain/index.json'));
  for (const s of new Map(sets.filter((d) => d.site.kind === 'landing').map((d) => [d.site.id, d.site])).values()) {
    const l = landings.find((x) => x.id === s.id);
    const h = terrain.sites?.[s.id]?.height;
    if (!l || l.lat !== s.lat || l.lon !== s.lon || h !== Math.round(s.altKm * 1000)) {
      console.log(`  NOTE  ${s.id}: app data now has (${l?.lat}, ${l?.lon}, ${h} m); the fixture stays valid for its own (${s.lat}, ${s.lon}, ${s.altKm} km)`);
    }
  }
} catch (e) {
  console.log(`  NOTE  could not compare pins with ${ROOT}/public: ${e.message}`);
}
console.log(`  ${report.fixture.sets} sets, ${report.fixture.rows} rows${report.problems.length ? '' : ': all rows match their raw replies, headers and checksums'}`);

// ---------------------------------------------------------------- 2. geometry
console.log('\n2. Geometry: Horizons values against each other and against this file\'s own maths');
const R_SUN = 695700, R_EARTH = 6378.137;
/** Direction of a body from the site, rebuilt from its Moon-centre sub-point and its range from the site. */
function fromSubPoint(site, sub, rangeKm) {
  const r = MOON_RADIUS_KM + site.altKm;
  const s = fromLatLon(site.lat, site.lon).map((c) => c * r);
  const u = fromLatLon(sub.lat, sub.lon);
  const su = dot(s, u);
  const dist = su + Math.sqrt(rangeKm * rangeKm - r * r + su * su); // from the Moon's centre
  return azEl(site.lat, site.lon, [u[0] * dist - s[0], u[1] * dist - s[1], u[2] * dist - s[2]]);
}
const geo = { sepVsSOT: 0, sunDiam: 0, earthDiam: 0, sunFromSubSolar: 0, earthFromSubEarth: 0 };
for (const doc of sets) {
  for (const r of doc.rows) {
    geo.sepVsSOT = max(geo.sepVsSOT, separation(r.sun, r.earth) - r.earth.sunElongDeg);
    geo.sunDiam = max(geo.sunDiam, (2 * Math.asin(R_SUN / r.sun.rangeKm)) / D2R * 3600 - r.sun.angDiamArcsec);
    geo.earthDiam = max(geo.earthDiam, (2 * Math.asin(R_EARTH / r.earth.rangeKm)) / D2R * 3600 - r.earth.angDiamArcsec);
    geo.sunFromSubSolar = max(geo.sunFromSubSolar, skyError(fromSubPoint(doc.site, r.subSolar, r.sun.rangeKm), r.sun).sep);
    geo.earthFromSubEarth = max(geo.earthFromSubEarth, skyError(fromSubPoint(doc.site, r.subEarth, r.earth.rangeKm), r.earth).sep);
  }
}
report.geometry = geo;
const geoLimits = {
  sepVsSOT: [1.5e-4, 'deg   Sun-Earth separation from az/el minus S-O-T (printed to 1e-4)'],
  sunDiam: [2e-3, 'arcsec  Sun diameter minus 2 asin(695700 km / range)'],
  earthDiam: [2e-3, 'arcsec  Earth diameter minus 2 asin(6378.137 km / range)'],
  sunFromSubSolar: [5e-4, 'deg   Sun az/el rebuilt from subSolar + range (sub-points printed to 1e-6)'],
  earthFromSubEarth: [6.5e-3, 'deg   Earth az/el rebuilt from subEarth + range (20 arcsec light-time convention, see README)'],
};
for (const [k, [limit, text]] of Object.entries(geoLimits)) {
  const ok = Math.abs(geo[k]) <= limit;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  worst ${Math.abs(geo[k]).toExponential(2)} (limit ${limit})  ${text}`);
  if (!ok) report.problems.push(`geometry: ${k} = ${geo[k]}`);
}

// ---------------------------------------------------------------- 3 + 4. code under test
function newStats() { return { n: 0, sunEl: 0, sunAz: 0, earthEl: 0, earthAz: 0, worst: {} }; }
function addSky(st, id, row, got) {
  st.n++;
  for (const body of ['sun', 'earth']) {
    const e = skyError(got[body], row[body]);
    for (const [key, v] of [[`${body}El`, e.dEl], [`${body}Az`, e.dAzArc]]) {
      if (Math.abs(v) > Math.abs(st[key])) { st[key] = v; st.worst[key] = `${id} ${row.utc}`; }
    }
  }
}
function printTable(title, perSet, total, limits) {
  console.log(`\n${title}`);
  console.log('  set                                 rows   sun el   sun az*  earth el earth az*   (worst |difference|, deg; az* = azimuth arc)');
  for (const [id, st] of perSet) console.log(`  ${id.padEnd(35)} ${String(st.n).padStart(4)}  ${f4(st.sunEl)}   ${f4(st.sunAz)}   ${f4(st.earthEl)}   ${f4(st.earthAz)}`);
  console.log(`  ${'ALL'.padEnd(35)} ${String(total.n).padStart(4)}  ${f4(total.sunEl)}   ${f4(total.sunAz)}   ${f4(total.earthEl)}   ${f4(total.earthAz)}`);
  for (const k of ['sunEl', 'sunAz', 'earthEl', 'earthAz']) console.log(`    worst ${k.padEnd(7)} ${total[k] >= 0 ? '+' : '-'}${f4(total[k])} at ${total.worst[k]}`);
  const ok = Math.abs(total.sunEl) <= limits.sunEl && Math.abs(total.sunAz) <= limits.sunAz && Math.abs(total.earthEl) <= limits.earthEl && Math.abs(total.earthAz) <= limits.earthAz;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  tolerance: sun ${limits.sunEl} / ${limits.sunAz}, earth ${limits.earthEl} / ${limits.earthAz} deg`);
  return ok;
}
function merge(total, st) {
  total.n += st.n;
  for (const k of ['sunEl', 'sunAz', 'earthEl', 'earthAz']) if (Math.abs(st[k]) > Math.abs(total[k])) { total[k] = st[k]; total.worst[k] = st.worst[k]; }
}
const plain = (st) => ({ rows: st.n, sunElDeg: st.sunEl, sunAzArcDeg: st.sunAz, earthElDeg: st.earthEl, earthAzArcDeg: st.earthAz, worstAt: st.worst });

if (!DATA_ONLY) {
  if (!existsSync(join(ROOT, 'node_modules'))) {
    console.log(`\n3-4. Skipped: ${ROOT} has no node_modules (run npm ci, or pass --data-only).`);
    report.problems.push('code checks not run: no node_modules');
  } else {
    // Load the app's own TypeScript through Vite, with no project config: only the science modules are wanted.
    const { createServer } = await import('vite');
    const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
    try {
      // ---- 3. baseline: Moon-centre directions
      const eph = await vite.ssrLoadModule('/src/astro/ephemeris.ts');
      const totals = { centre: newStats(), topo: newStats() };
      const per = { centre: [], topo: [] };
      let subE = 0, subS = 0;
      for (const doc of sets) {
        const st = { centre: newStats(), topo: newStats() };
        const { site } = doc;
        const r = MOON_RADIUS_KM + site.altKm;
        const s = fromLatLon(site.lat, site.lon).map((c) => c * r);
        for (const row of doc.rows) {
          const g = eph.moonGeometry(new Date(row.utc));
          addSky(st.centre, doc.id, row, { sun: azEl(site.lat, site.lon, g.sunDir), earth: azEl(site.lat, site.lon, g.earthDir) });
          // Same directions, moved from the Moon's centre to the site by this checker (not app code).
          const earthTopo = g.earthDir.map((c, i) => c * g.earthDistanceKm - s[i]);
          const sunTopo = g.sunDir.map((c, i) => c * row.sun.rangeKm - s[i]); // 0.0007 deg at most
          addSky(st.topo, doc.id, row, { sun: azEl(site.lat, site.lon, sunTopo), earth: azEl(site.lat, site.lon, earthTopo) });
          subE = Math.max(subE, arc(g.subEarth, row.subEarth));
          subS = Math.max(subS, arc(g.subSolar, row.subSolar));
        }
        for (const k of ['centre', 'topo']) { per[k].push([doc.id, st[k]]); merge(totals[k], st[k]); }
      }
      const m = tol.moonCentreDirections, t = tol.topocentricModel;
      const okCentre = printTable('3a. Baseline src/astro/ephemeris.ts moonGeometry(): Moon-centre directions used as they are', per.centre, totals.centre, { sunEl: m.sunElDeg, sunAz: m.sunAzArcDeg, earthEl: m.earthElDeg, earthAz: m.earthAzArcDeg });
      const okTopo = printTable('3b. The same directions with the site parallax added by this checker', per.topo, totals.topo, { sunEl: t.elDeg, sunAz: t.azArcDeg, earthEl: t.elDeg, earthAz: t.azArcDeg });
      console.log(`\n  sub-points: worst subEarth ${subE.toFixed(4)} deg, subSolar ${subS.toFixed(4)} deg (tolerance ${tol.subPoints.arcDeg})`);
      report.baseline = { centre: plain(totals.centre), withParallax: plain(totals.topo), subEarthArcDeg: subE, subSolarArcDeg: subS, pass: okCentre && okTopo };
      if (!okCentre || !okTopo || subE > tol.subPoints.arcDeg || subS > tol.subPoints.arcDeg) report.problems.push('baseline moonGeometry() outside tolerance');

      // ---- 4. skyAt
      const apiPath = '/src/analysis/api.ts';
      if (!existsSync(join(ROOT, apiPath))) {
        console.log('\n4. skyAt(): src/analysis/api.ts does not exist in this checkout.');
      } else {
        const api = await vite.ssrLoadModule(apiPath);
        const total = newStats();
        const perSet = [];
        const extra = { sunRadius: 0, earthRadius: 0, sunRange: 0, earthRange: 0, lit: 0, subEarth: 0, subSolar: 0 };
        const sources = {};
        let notImplemented = null;
        outer: for (const doc of sets) {
          const st = newStats();
          for (const row of doc.rows) {
            let sky;
            try {
              sky = api.skyAt({ lat: doc.site.lat, lon: doc.site.lon }, doc.site.altKm * 1000, Date.parse(row.utc));
            } catch (e) {
              if (e?.name === 'NotImplemented') { notImplemented = e.message; break outer; }
              throw new Error(`skyAt threw at ${doc.id} ${row.utc}: ${e.message}`);
            }
            sources[sky.source] = (sources[sky.source] ?? 0) + 1;
            addSky(st, doc.id, row, { sun: { az: sky.sun.azDeg, el: sky.sun.elDeg }, earth: { az: sky.earth.azDeg, el: sky.earth.elDeg } });
            extra.sunRadius = max(extra.sunRadius, sky.sun.angularRadiusDeg / (row.sun.angDiamArcsec / 7200) - 1);
            extra.earthRadius = max(extra.earthRadius, sky.earth.angularRadiusDeg / (row.earth.angDiamArcsec / 7200) - 1);
            extra.sunRange = max(extra.sunRange, sky.sun.distanceKm / row.sun.rangeKm - 1);
            extra.earthRange = max(extra.earthRange, sky.earth.distanceKm / row.earth.rangeKm - 1);
            extra.lit = max(extra.lit, sky.earthLitFraction * 100 - row.earth.illumPct);
            extra.subEarth = Math.max(extra.subEarth, arc(sky.subEarth, row.subEarth));
            extra.subSolar = Math.max(extra.subSolar, arc(sky.subSolar, row.subSolar));
          }
          perSet.push([doc.id, st]);
          merge(total, st);
        }
        if (notImplemented) {
          console.log(`\n4. skyAt(): ${notImplemented} in this checkout; nothing to compare.`);
          report.skyAt = { implemented: false };
        } else {
          const ok = printTable('4. src/analysis/api.ts skyAt(site, altKm * 1000, utc)', perSet, total, { sunEl: t.elDeg, sunAz: t.azArcDeg, earthEl: t.elDeg, earthAz: t.azArcDeg });
          const lim = { sunRadius: tol.angularDiameter.relative, earthRadius: tol.angularDiameter.relative, sunRange: tol.range.relative, earthRange: tol.range.relative, lit: tol.illumPct.absolute, subEarth: tol.subPoints.arcDeg, subSolar: tol.subPoints.arcDeg };
          const label = { sunRadius: 'Sun angular radius, relative', earthRadius: 'Earth angular radius, relative', sunRange: 'Sun distance, relative', earthRange: 'Earth distance, relative', lit: 'Earth lit fraction, percentage points', subEarth: 'subEarth, deg', subSolar: 'subSolar, deg' };
          let okExtra = true;
          for (const k of Object.keys(lim)) {
            const good = Math.abs(extra[k]) <= lim[k];
            okExtra &&= good;
            console.log(`  ${good ? 'ok  ' : 'FAIL'}  worst ${Math.abs(extra[k]).toExponential(2)} (limit ${lim[k]})  ${label[k]}`);
          }
          console.log(`  source reported by skyAt: ${Object.entries(sources).map(([k, v]) => `${k} x${v}`).join(', ')}`);
          report.skyAt = { implemented: true, ...plain(total), extra, sources, perSet: Object.fromEntries(perSet.map(([id, st]) => [id, plain(st)])), pass: ok && okExtra };
          if (!ok || !okExtra) report.problems.push('skyAt() outside tolerance');
        }
      }
    } finally {
      await vite.close();
    }
  }
}

if (JSON_OUT) await writeFile(resolve(JSON_OUT), JSON.stringify(report, null, 1) + '\n');
console.log(report.problems.length ? `\nFAIL (${report.problems.length}): ${report.problems.join('; ')}` : '\nPASS');
process.exit(report.problems.length ? 1 : 0);
