// Runs the app's own science entry points (src/analysis/api.ts) for a list of scenarios and
// writes what they return as plain JSON, so that the Python checks can compare it with
// independently computed values. This file only CALLS the app; no reference value comes from it.
//
//   node tests/fixtures/validation/ephemeris-check/app_dump.mjs --scenarios FILE.json --out FILE.json [--root DIR] [--series] [--slim]
//
// --slim keeps only the headline numbers (for multi-year runs, whose interval and event lists run to megabytes).
// --bundle lets the app read its bundled Horizons tables from public/ as it does in the browser (through its own
//          setBundleReader hook); without it, under Node, the app silently uses its model for every window.
//
// Scenario file: [{ id, site: { id, name, kind, lat, lon }, mastHeightM, start: "UTC", durationH, stepMin, blockage?: [{ body, utc }],
//                   dsnAt?: ["UTC", ...], outlook?: { months, ... }, nearby?: { radiusM, spacingM, ... } | true }]
// With `outlook` the app's outlook() is dumped too; with `nearby` its rankNearby() rows; analysis.dsn is dumped whenever the app returns it.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ROOT = resolve(opt('--root') ?? join(HERE, '../../../..'));
const WITH_SERIES = args.includes('--series');
const SLIM = args.includes('--slim');
const BUNDLE = args.includes('--bundle');
const scenarios = JSON.parse(await readFile(resolve(opt('--scenarios')), 'utf8'));

// --commit LABEL names the build under test (e.g. the integration commit when this checkout has later commits of its own).
let commit = opt('--commit');
if (!commit) { try { commit = (await readFile(join(ROOT, 'COMMIT'), 'utf8')).trim(); } catch { /* a git checkout */ } }
if (!commit) { try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { commit = 'unknown'; } }

const { createServer } = await import('vite');
const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const round = (a, digits) => Array.from(a, (v) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null));
const out = { app: { commit, root: opt('--root') ?? '.', bundledTables: BUNDLE }, generatedUtc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), results: [] };
try {
  const api = await vite.ssrLoadModule('/src/analysis/api.ts');
  if (BUNDLE) {
    const sky = await vite.ssrLoadModule('/src/analysis/sky.ts');
    sky.setBundleReader((path) => readFile(join(ROOT, 'public', path), 'utf8'));
  }
  for (const s of scenarios) {
    const scenario = { id: s.id, label: s.id, site: s.site, mastHeightM: s.mastHeightM, startMs: Date.parse(s.start), durationH: s.durationH, stepMin: s.stepMin };
    const t0 = Date.now();
    const a = await api.analyse(scenario);
    const ms = Date.now() - t0;
    const h = a.horizon;
    const r = {
      id: s.id, input: s, runtimeMs: ms,
      horizon: {
        siteElevationM: h.siteElevationM, mastHeightM: h.mastHeightM, azStepDeg: h.azStepDeg, smoothDipDeg: h.smoothDipDeg, maxRangeM: h.maxRangeM,
        layers: h.layers, elevDeg: round(h.elevDeg, 5), distM: round(h.distM, 1), heightM: round(h.heightM, 2),
      },
      metrics: a.metrics, events: a.events, slope: a.slope, provenance: a.provenance, warnings: a.warnings,
      series: { startMs: a.series.startMs, stepMs: a.series.stepMs, n: a.series.n, source: a.series.source },
    };
    if (WITH_SERIES || s.series) {
      for (const k of ['sunAz', 'sunEl', 'earthAz', 'earthEl', 'sunClearance', 'earthClearance', 'sunVisible', 'earthVisible', 'sunEclipsed']) if (a.series[k]) r.series[k] = round(a.series[k], 4);
    }
    if (s.blockage) {
      r.blockage = s.blockage.map((b) => {
        try { return { ...b, result: api.blockageAt(a, b.body, Date.parse(b.utc)) }; } catch (e) { return { ...b, error: String(e.message ?? e) }; }
      });
    }
    if (s.skyAt) r.skyAt = s.skyAt.map((utc) => ({ utc, sky: api.skyAt({ lat: s.site.lat, lon: s.site.lon }, h.siteElevationM + h.mastHeightM, Date.parse(utc)) }));
    if (a.dsn) {
      const contact = (c) => ({ intervals: c.intervals, pct: c.pct, longestGapH: c.longestGapH, gapOpenEnded: c.gapOpenEnded });
      r.dsn = {
        stations: a.dsn.stations.map((st) => ({ station: st.station, receive: contact(st.receive), transmit: contact(st.transmit) })),
        anyReceive: contact(a.dsn.anyReceive), anyTransmit: contact(a.dsn.anyTransmit), assumptions: a.dsn.assumptions,
      };
      if (s.dsnSeries) r.dsn.series = a.dsn.stations.map((st) => ({ id: st.station.id, stationElDeg: round(st.stationElDeg, 4), siteClearanceDeg: round(st.siteClearanceDeg, 4) }));
      if (s.dsnAt && api.dsnAt) r.dsnAt = s.dsnAt.map((utc) => ({ utc, stations: api.dsnAt(a, Date.parse(utc)) }));
    }
    if (s.outlook && api.outlook) {
      const t1 = Date.now();
      const o = await api.outlook(scenario, s.outlook === true ? {} : s.outlook);
      r.outlook = {
        runtimeMs: Date.now() - t1, startMs: o.startMs, endMs: o.endMs, months: o.months, windowDays: o.windowDays, stepMin: o.stepMin, rows: o.rows,
        arrivals: { startMs: o.arrivals.startMs, stepMs: o.arrivals.stepMs, n: o.arrivals.n, missionH: o.arrivals.missionH,
          score: round(o.arrivals.score, 4), illuminationPct: round(o.arrivals.illuminationPct, 4), earthVisiblePct: round(o.arrivals.earthVisiblePct, 4), longestDarknessH: round(o.arrivals.longestDarknessH, 3) },
        planned: o.planned, best: o.best, worst: o.worst, slips: o.slips, longestDarkness: o.longestDarkness, longestEarthGap: o.longestEarthGap,
        highlights: o.highlights, assumptions: o.assumptions, warnings: o.warnings,
      };
    }
    if (s.nearby && api.rankNearby) {
      const t1 = Date.now();
      const options = s.nearby === true ? api.DEFAULT_NEARBY_OPTIONS : { ...api.DEFAULT_NEARBY_OPTIONS, ...s.nearby };
      const rows = await api.rankNearby(scenario, options);
      r.nearby = {
        runtimeMs: Date.now() - t1, options,
        rows: rows.map((c) => ({ id: c.site.id, name: c.site.name, lat: c.site.lat, lon: c.site.lon, eastM: c.eastM, northM: c.northM, distanceM: c.distanceM, elevationM: c.elevationM,
          slope: c.slope, rejected: c.rejected, score: c.score, rank: c.rank, basis: c.basis, isReference: c.isReference,
          metrics: c.metrics ? { illuminationPct: c.metrics.illuminationPct, sunAnyPct: c.metrics.sunAnyPct, earthVisiblePct: c.metrics.earthVisiblePct, longestDarknessH: c.metrics.longestDarknessH } : null })),
      };
    }
    if (SLIM) {
      const m = a.metrics;
      r.horizon = { siteElevationM: h.siteElevationM, mastHeightM: h.mastHeightM, azStepDeg: h.azStepDeg, maxRangeM: h.maxRangeM, layers: h.layers };
      r.metrics = {
        illuminationPct: m.illuminationPct, sunAnyPct: m.sunAnyPct, longestDarknessH: m.longestDarknessH, darknessOpenEnded: m.darknessOpenEnded,
        earthVisiblePct: m.earthVisiblePct, longestEarthGapH: m.longestEarthGapH, earthGapOpenEnded: m.earthGapOpenEnded, maxSunElDeg: m.maxSunElDeg, minSunElDeg: m.minSunElDeg,
        counts: { sunIntervals: m.sunIntervals.length, darkIntervals: m.darkIntervals.length, earthIntervals: m.earthIntervals.length, events: a.events.length },
      };
      delete r.events;
      delete r.provenance;
      r.warnings = a.warnings.map((w) => (w.length > 300 ? `${w.slice(0, 300)}...` : w));
    }
    out.results.push(r);
    console.log(`${s.id.padEnd(40)} ${String(ms).padStart(6)} ms  source ${a.series.source}  n ${a.series.n}`);
  }
} finally {
  await vite.close();
}
await writeFile(resolve(opt('--out')), JSON.stringify(out) + '\n');
console.log(`app ${commit}: ${out.results.length} scenarios -> ${opt('--out')}`);
