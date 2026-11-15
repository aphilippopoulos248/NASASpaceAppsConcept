// What the edge easing of the 3 m site models (src/terrain/api.ts, T-32) changes in the results:
// the skyline and the sunrise / sunset times computed by the app's own analysis code, once on
// the stack the app uses (the grids as stored, decision D-10) and once on the stack eased on
// request ({ easeEdges: true }).
//
//   node scripts/terrain-seams-skyline.mjs [--sites a,b] [--mast 2] [--az 1440] [--days 30] [--json OUT.json]
//       For each site with a 3 m model: largest and RMS skyline change, share of azimuths moved by
//       more than 0.01 deg, share of the skyline formed on the model's edge before and after, and
//       every sunrise / sunset (last limb) in the `days` after the landing that moves; and how far
//       the two stacks can move a sunrise or a sunset on any date: the largest skyline change over
//       the azimuths where the Sun can rise (90 deg) or set (270 deg), give or take 2 deg over the
//       cosine of the latitude, divided by the Sun's fastest climb there. That is the effect of
//       the rejected easing, not an uncertainty (decision D-10: the eased stack lies outside
//       both products).
//   node scripts/terrain-seams-skyline.mjs --sunset blue-ghost-1 --from 2025-03-16T16:00:00Z --hours 6 [--masts 2,3.5]
//       One-minute samples of the visible part of the Sun's disc: when the skyline starts to cut
//       the Sun and when the last limb is gone, stored against eased, for each observer height.
//
// "On the model's edge" is the independent check's definition (T-26, check0b_layer_seams.py): the
// terrain that forms the skyline lies within 6 m of the edge of the model's square.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const index = JSON.parse(await readFile(join(ROOT, 'public', 'terrain', 'index.json'), 'utf8'));
const catalogue = JSON.parse(await readFile(join(ROOT, 'public', 'data', 'landings.json'), 'utf8'));
const landings = Array.isArray(catalogue) ? catalogue : catalogue.landings;
const landing = (id) => {
  const entry = index.sites[id];
  if (!entry) throw new Error(`"${id}" is not a catalogued site (see public/terrain/index.json)`);
  return { id, name: id, kind: 'landing', lat: entry.lat, lon: entry.lon };
};
const landedMs = (id) => {
  const l = landings.find((x) => x.id === id);
  if (!l) throw new Error(`"${id}" is not in public/data/landings.json`);
  return Date.parse(`${l.date}T${l.time ?? '00:00'}:00Z`);
};
const iso = (t) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const isoS = (t) => `${new Date(t).toISOString().slice(0, 19).replace('T', ' ')} UTC`;

const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const { loadTerrainFor } = await vite.ssrLoadModule('/src/terrain/api.ts');
  const { computeHorizon } = await vite.ssrLoadModule('/src/analysis/horizon.ts');
  const { analyseWith } = await vite.ssrLoadModule('/src/analysis/window.ts');
  const { siteEphemeris } = await vite.ssrLoadModule('/src/analysis/engine.ts');
  const { findBundledTable } = await vite.ssrLoadModule('/src/analysis/sky.ts');

  const stacks = async (site) => ({ stored: await loadTerrainFor(site, { remote: false }), eased: await loadTerrainFor(site, { remote: false, easeEdges: true }) });
  const analyse = async (site, stack, startMs, durationH, stepMin, mastHeightM) => {
    const scenario = { id: `${site.id}|${startMs}|${durationH}|${stepMin}|${mastHeightM}`, label: site.name, site, mastHeightM, startMs, durationH, stepMin };
    const table = await findBundledTable(site, startMs, startMs + durationH * 3_600_000);
    return analyseWith(scenario, stack, siteEphemeris(scenario, stack, table));
  };

  if (args.includes('--sunset')) {
    const site = landing(opt('--sunset'));
    const fromMs = Date.parse(opt('--from'));
    const hours = Number(opt('--hours', '6'));
    const masts = opt('--masts', '2').split(',').map(Number);
    const { stored, eased } = await stacks(site);
    console.log(`${site.id}: one-minute samples of the visible part of the Sun's disc from ${iso(fromMs)} for ${hours} h.`);
    console.log(`${'observer'.padEnd(10)}${'stack'.padEnd(11)}${'skyline starts to cut the Sun'.padEnd(32)}${'last limb gone (sample)'.padEnd(27)}${'sunset event (last limb)'.padEnd(27)}ephemeris`);
    for (const mast of masts) {
      for (const [name, stack] of [['as stored', stored], ['eased', eased]]) {
        const a = await analyse(site, stack, fromMs, hours, 1, mast);
        const v = a.series.sunVisible;
        let cut = -1, gone = -1;
        for (let k = 1; k < a.series.n; k++) {
          if (cut < 0 && v[k] < 1 && v[k - 1] >= 1) cut = k;
          if (cut >= 0 && gone < 0 && v[k] <= 0) gone = k;
        }
        const at = (k) => (k < 0 ? 'not in the window' : `${iso(a.series.startMs + k * a.series.stepMs)}, Sun az ${a.series.sunAz[k].toFixed(2)}`);
        const sunset = a.events.find((e) => e.type === 'sunset');
        console.log(`${`${mast} m up`.padEnd(10)}${name.padEnd(11)}${at(cut).padEnd(32)}${at(gone).padEnd(27)}${(sunset ? `${isoS(sunset.timeMs)}, az ${sunset.azDeg.toFixed(2)}` : 'none').padEnd(27)}${a.series.source}`);
      }
    }
  } else {
    const mast = Number(opt('--mast', '2'));
    const nAz = Number(opt('--az', '1440'));
    const days = Number(opt('--days', '30'));
    const ids = opt('--sites') ? opt('--sites').split(',') : Object.keys(index.sites).filter((id) => index.sites[id].fine);
    const rows = [];
    console.log(`Skyline of an observer ${mast} m up, ${nAz} azimuths: the stack eased on request (3 m model eased onto the 60 m window) minus the stack in use (the grids as stored).`);
    console.log(`Sunrise and sunset (last limb) in the ${days} days after each landing, with the analysis as the app runs it.\n`);
    console.log(`${'site'.padEnd(14)}${'largest change'.padStart(15)}${'at az'.padStart(8)}${'RMS'.padStart(8)}${'moved > 0.01 deg'.padStart(18)}${'on the edge: before'.padStart(21)}${'after'.padStart(8)}   sunrise / sunset`);
    for (const id of ids) {
      const site = landing(id);
      const { stored, eased } = await stacks(site);
      const fine = stored.sources[0].descriptor;
      if (fine.kind !== 'local') throw new Error(`${id}: the first source is not a site grid`);
      const half = ((fine.n - 1) / 2) * fine.spacingM;
      const before = computeHorizon(stored, site, mast, { azStepDeg: 360 / nAz });
      const after = computeHorizon(eased, site, mast, { azStepDeg: 360 / nAz });
      let worst = 0, worstAt = 0, worstI = 0, sum2 = 0, moved = 0, edgeBefore = 0, edgeAfter = 0;
      for (let i = 0; i < nAz; i++) {
        const change = after.elevDeg[i] - before.elevDeg[i];
        if (Math.abs(change) > Math.abs(worst)) { worst = change; worstAt = i * before.azStepDeg; worstI = i; }
        sum2 += change * change;
        if (Math.abs(change) > 0.01) moved++;
        const az = (i * before.azStepDeg * Math.PI) / 180;
        const edge = half / Math.max(Math.abs(Math.cos(az)), Math.abs(Math.sin(az)));
        if (Math.abs(before.distM[i] - edge) < 6) edgeBefore++;
        if (Math.abs(after.distM[i] - edge) < 6) edgeAfter++;
      }
      // Events over the days after the landing, as the app computes them (its own azimuth step and sampling).
      const startMs = landedMs(id);
      const a = await analyse(site, stored, startMs, days * 24, 10, mast);
      const b = await analyse(site, eased, startMs, days * 24, 10, mast);
      const sunEvents = (x) => x.events.filter((e) => e.type === 'sunrise' || e.type === 'sunset');
      const ea = sunEvents(a), eb = sunEvents(b);
      const events = [];
      let eventNote;
      if (ea.length !== eb.length || ea.some((e, k) => e.type !== eb[k].type)) eventNote = `event lists differ: ${ea.map((e) => `${e.type} ${iso(e.timeMs)}`).join(', ')} -> ${eb.map((e) => `${e.type} ${iso(e.timeMs)}`).join(', ')}`;
      else {
        ea.forEach((e, k) => events.push({ type: e.type, storedMs: e.timeMs, easedMs: eb[k].timeMs, shiftMin: (eb[k].timeMs - e.timeMs) / 60000 }));
        const shifted = events.filter((e) => Math.abs(e.shiftMin) >= 0.05);
        eventNote = shifted.length ? shifted.map((e) => `${e.type} ${iso(e.storedMs)} -> ${iso(e.easedMs)} (${e.shiftMin > 0 ? '+' : ''}${e.shiftMin.toFixed(1)} min)`).join('; ') : `unchanged (${events.length} events)`;
      }
      // On any date: the largest skyline change where the Sun can rise or set, in minutes of its fastest climb.
      const cos = Math.cos((site.lat * Math.PI) / 180), rate = (360 / (29.530589 * 1440)) * cos;
      let riseMin = 0, setMin = 0;
      for (let i = 0; i < nAz; i++) {
        const az = i * before.azStepDeg, m = Math.abs(after.elevDeg[i] - before.elevDeg[i]) / rate;
        if (Math.abs(az - 90) <= 2 / cos) riseMin = Math.max(riseMin, m);
        if (Math.abs(az - 270) <= 2 / cos) setMin = Math.max(setMin, m);
      }
      // What forms the skyline at that azimuth, before and after: distance, height and grid.
      const former = (h, i) => ({ elevDeg: h.elevDeg[i], distM: h.distM[i], heightM: h.heightM[i], layer: h.layers[h.skylineLayer[i]]?.name ?? null });
      const row = {
        site: id, mastM: mast, azimuths: nAz, largestChangeDeg: worst, atAzDeg: worstAt, formedBy: { stored: former(before, worstI), eased: former(after, worstI) }, rmsChangeDeg: Math.sqrt(sum2 / nAz), movedOver001Share: moved / nAz, onEdgeStoredShare: edgeBefore / nAz, onEdgeEasedShare: edgeAfter / nAz,
        ephemeris: a.series.source, events, eventNote, anyDate: { sunriseUpToMin: riseMin, sunsetUpToMin: setMin },
        stored: { elevDeg: Array.from(before.elevDeg, (v) => Math.round(v * 1e5) / 1e5), distM: Array.from(before.distM, (v) => Math.round(v * 10) / 10) },
        eased: { elevDeg: Array.from(after.elevDeg, (v) => Math.round(v * 1e5) / 1e5), distM: Array.from(after.distM, (v) => Math.round(v * 10) / 10) },
      };
      rows.push(row);
      const pct = (v) => `${(100 * v).toFixed(1)} %`;
      const short = (f) => `${f.elevDeg.toFixed(3)} deg at ${Math.round(f.distM)} m on the ${/NAC/.test(f.layer ?? '') ? '3 m model' : /, (\d+) m site window/.exec(f.layer ?? '')?.[1] ? `${/, (\d+) m site window/.exec(f.layer)[1]} m window` : f.layer}`;
      console.log(`${id.padEnd(14)}${`${worst >= 0 ? '+' : ''}${worst.toFixed(3)} deg`.padStart(15)}${worstAt.toFixed(2).padStart(8)}${row.rmsChangeDeg.toFixed(3).padStart(8)}${pct(row.movedOver001Share).padStart(18)}${pct(row.onEdgeStoredShare).padStart(21)}${pct(row.onEdgeEasedShare).padStart(8)}   ${eventNote}`);
      console.log(`${''.padEnd(14)}at az ${worstAt.toFixed(2)}: as stored ${short(row.formedBy.stored)}; eased ${short(row.formedBy.eased)}`);
      console.log(`${''.padEnd(14)}on any date: sunrises up to ${riseMin.toFixed(1)} min, sunsets up to ${setMin.toFixed(1)} min apart`);
    }
    if (opt('--json')) await writeFile(resolve(opt('--json')), JSON.stringify(rows) + '\n');
  }
} finally {
  await vite.close();
}
