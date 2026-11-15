// Option B (T-8), a prototype only: keep each 3 m model exactly as stored and ease the 60 m
// window onto it outside the model's edge. The app does not do this (decision D-7 keeps the
// stored grids); this script measures what it would change, with the app's own analysis code.
//
// The rule. Within W metres outside the model's square, the 60 m window's height moves by the
// step at the nearest point of the model's edge (model minus window there), fading out along a
// smooth step:  h = h60 + s(q) * S(1 - d / W),  S(t) = t*t*(3 - 2t),  d the distance from the
// point to the square, q the nearest point of the square. At the edge the ground is the
// model's; W metres out it is the window's. The model itself is not touched. Built as a ring
// grid at the model's 3 m spacing around the model (a local grid of its own, between the model
// and the 60 m window in the stack), because a band of 129 m is two cells of the 60 m grid.
//
//   node scripts/terrain-seams-option-b.mjs [--sites a,b] [--band 129] [--mast 2] [--az 1440] [--days 30] [--json OUT.json]
//       Per site: the skyline of option B minus the stack in use (the stored grids), largest change,
//       azimuth, what forms the skyline there; every sunrise and sunset in the `days` after the
//       landing that moves; how far B and the stored stack can move a sunrise or sunset on any date;
//       and the surface view: drawn ground and skyline against the analysed ones, under A (the view
//       eases the model onto the 60 m window, src/scene/surface.ts:485) and under B with the view
//       unchanged. Also the time taken to build each ring.
//   node scripts/terrain-seams-option-b.mjs --sunset blue-ghost-1 --from 2025-03-16T16:00:00Z --hours 6 [--masts 2,3.5] [--band 129]
//       One-minute samples of the visible part of the Sun's disc: first cut and last limb, stored
//       against option B (and against the eased stack, easeEdges: true), for each observer height.
//   node scripts/terrain-seams-option-b.mjs --ring blue-ghost-1 --band 129 --out ring.f32
//       Writes the ring grid (float32, row 0 south, east along a row) for an independent check
//       (python3 -I -B scripts/terrain-seams-check.py lola --ring ring.f32 --band 129).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const W = Number(opt('--band', '129'));
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

/** Bilinear height of a site grid at east/north metres (both grids share the site's centre and layout); NaN outside. */
function at(d, e, n) {
  const c = (d.n - 1) / 2;
  const fx = e / d.spacingM + c, fy = n / d.spacingM + c;
  if (!(fx >= -1e-9 && fy >= -1e-9 && fx <= d.n - 1 + 1e-9 && fy <= d.n - 1 + 1e-9)) return NaN;
  const x = Math.min(d.n - 2, Math.max(0, Math.floor(fx))), y = Math.min(d.n - 2, Math.max(0, Math.floor(fy)));
  const a = Math.min(1, Math.max(0, fx - x)), b = Math.min(1, Math.max(0, fy - y)), k = y * d.n + x;
  return (1 - b) * ((1 - a) * d.data[k] + a * d.data[k + 1]) + b * ((1 - a) * d.data[k + d.n] + a * d.data[k + d.n + 1]);
}

/** The option B ring: a grid at the model's spacing reaching W metres beyond its edge; NaN inside the model. */
function ringDescriptor(model, w60, band) {
  const dm = model.descriptor, dw = w60.descriptor;
  const H = ((dm.n - 1) / 2) * dm.spacingM;
  const sp = dm.spacingM;
  const extra = Math.ceil(band / sp);
  const n = dm.n + 2 * extra;
  const c = (n - 1) / 2;
  const data = new Float32Array(n * n).fill(NaN);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const e = (i - c) * sp, nn = (j - c) * sp;
      if (Math.abs(e) < H && Math.abs(nn) < H) continue; // inside the model: the model answers
      const d = Math.hypot(Math.max(0, Math.abs(e) - H), Math.max(0, Math.abs(nn) - H));
      const qe = Math.min(H, Math.max(-H, e)), qn = Math.min(H, Math.max(-H, nn));
      const step = at(dm, qe, qn) - at(dw, qe, qn);
      const t = 1 - d / band;
      data[j * n + i] = at(dw, e, nn) + (t > 0 ? step * t * t * (3 - 2 * t) : 0);
    }
  }
  return { kind: 'local', name: `${model.name}: 60 m window eased onto it over ${band} m outside its edge (option B)`, resolutionM: model.resolutionM, lat0: dm.lat0, lon0: dm.lon0, n, spacingM: sp, data };
}

const vite = await createServer({ root: ROOT, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
try {
  const { loadTerrainFor, sourceFromDescriptor } = await vite.ssrLoadModule('/src/terrain/api.ts');
  const { computeHorizon } = await vite.ssrLoadModule('/src/analysis/horizon.ts');
  const { analyseWith } = await vite.ssrLoadModule('/src/analysis/window.ts');
  const { siteEphemeris } = await vite.ssrLoadModule('/src/analysis/engine.ts');
  const { findBundledTable } = await vite.ssrLoadModule('/src/analysis/sky.ts');

  /** The stack in use (stored), option B, and the stack the view draws under A (= easeEdges: true, to 0.24 mm). */
  const stacks = async (site) => {
    const stored = await loadTerrainFor(site, { remote: false });
    const drawnA = await loadTerrainFor(site, { remote: false, easeEdges: true });
    const [model, w60] = stored.sources;
    const t0 = performance.now();
    const ring = sourceFromDescriptor(ringDescriptor(model, w60, W));
    const buildMs = performance.now() - t0;
    const B = { ...stored, sources: [model, ring, ...stored.sources.slice(1)] };
    return { stored, B, drawnA, ring, buildMs };
  };
  const analyse = async (site, stack, startMs, durationH, stepMin, mastHeightM) => {
    const scenario = { id: `${site.id}|${startMs}|${durationH}|${stepMin}|${mastHeightM}`, label: site.name, site, mastHeightM, startMs, durationH, stepMin };
    const table = await findBundledTable(site, startMs, startMs + durationH * 3_600_000);
    return analyseWith(scenario, stack, siteEphemeris(scenario, stack, table));
  };
  const sunEvents = (x) => x.events.filter((e) => e.type === 'sunrise' || e.type === 'sunset');

  if (args.includes('--ring')) {
    const site = landing(opt('--ring'));
    const { ring } = await stacks(site);
    await writeFile(resolve(opt('--out')), Buffer.from(ring.descriptor.data.buffer));
    console.log(`${site.id}: ring ${ring.descriptor.n} x ${ring.descriptor.n} at ${ring.descriptor.spacingM} m, band ${W} m -> ${opt('--out')}`);
  } else if (args.includes('--sunset')) {
    const site = landing(opt('--sunset'));
    const fromMs = Date.parse(opt('--from'));
    const hours = Number(opt('--hours', '6'));
    const masts = opt('--masts', '2').split(',').map(Number);
    const { stored, B, drawnA } = await stacks(site);
    console.log(`${site.id}: one-minute samples of the visible part of the Sun's disc from ${iso(fromMs)} for ${hours} h; option B over ${W} m.`);
    console.log(`${'observer'.padEnd(10)}${'stack'.padEnd(26)}${'skyline starts to cut the Sun'.padEnd(32)}${'last limb gone (event)'}`);
    for (const mast of masts) {
      for (const [name, stack] of [['as stored (in use)', stored], ['option B', B], ['eased (easeEdges: true)', drawnA]]) {
        const a = await analyse(site, stack, fromMs, hours, 1, mast);
        const v = a.series.sunVisible;
        let cut = -1;
        for (let k = 1; k < a.series.n; k++) if (cut < 0 && v[k] < 1 && v[k - 1] >= 1) cut = k;
        const sunset = a.events.find((e) => e.type === 'sunset');
        console.log(`${`${mast} m up`.padEnd(10)}${name.padEnd(26)}${(cut < 0 ? 'not in the window' : `${iso(a.series.startMs + cut * a.series.stepMs)}, Sun az ${a.series.sunAz[cut].toFixed(2)}`).padEnd(32)}${sunset ? `${isoS(sunset.timeMs)}, az ${sunset.azDeg.toFixed(2)}` : 'none'}`);
      }
    }
  } else {
    const mast = Number(opt('--mast', '2'));
    const nAz = Number(opt('--az', '1440'));
    const days = Number(opt('--days', '30'));
    const ids = opt('--sites') ? opt('--sites').split(',') : Object.keys(index.sites).filter((id) => index.sites[id].fine);
    const rows = [];
    console.log(`Option B (60 m window eased onto the 3 m model over ${W} m outside its edge) against the stack in use (the stored grids). Observer ${mast} m up, ${nAz} azimuths.`);
    console.log(`Events: every sunrise and sunset (last limb) in the ${days} days after each landing. View: the ground the surface view draws (it eases the model onto the 60 m window, as easeEdges: true) against the analysed ground.\n`);
    for (const id of ids) {
      const site = landing(id);
      const { stored, B, drawnA, ring, buildMs } = await stacks(site);
      const opts = { azStepDeg: 360 / nAz };
      const hs = computeHorizon(stored, site, mast, opts), hb = computeHorizon(B, site, mast, opts), hd = computeHorizon(drawnA, site, mast, opts);
      const cos = Math.cos((site.lat * Math.PI) / 180), rate = (360 / (29.530589 * 1440)) * cos;
      const compare = (h0, h1) => {
        let worst = 0, worstI = 0, sum2 = 0, moved = 0, riseMin = 0, setMin = 0;
        for (let i = 0; i < nAz; i++) {
          const ch = h1.elevDeg[i] - h0.elevDeg[i];
          if (Math.abs(ch) > Math.abs(worst)) { worst = ch; worstI = i; }
          sum2 += ch * ch;
          if (Math.abs(ch) > 0.01) moved++;
          const az = i * h0.azStepDeg, m = Math.abs(ch) / rate;
          if (Math.abs(az - 90) <= 2 / cos) riseMin = Math.max(riseMin, m);
          if (Math.abs(az - 270) <= 2 / cos) setMin = Math.max(setMin, m);
        }
        const former = (h, i) => ({ elevDeg: h.elevDeg[i], distM: h.distM[i], layer: h.layers[h.skylineLayer[i]]?.name ?? null });
        return { largestChangeDeg: worst, atAzDeg: worstI * h0.azStepDeg, rmsChangeDeg: Math.sqrt(sum2 / nAz), movedOver001Share: moved / nAz, sunriseUpToMin: riseMin, sunsetUpToMin: setMin, before: former(h0, worstI), after: former(h1, worstI) };
      };
      const bVsStored = compare(hs, hb);
      const viewA = compare(hs, hd); // drawn (eased by the view) minus analysed (stored)
      const viewBunchanged = compare(hb, hd); // drawn (view unchanged) minus analysed (B)
      // Ground: drawn minus analysed, in the model's outer band and in the ring, on a 3 m lattice.
      const dm = stored.sources[0].descriptor, dd = drawnA.sources[0].descriptor, dr = ring.descriptor, dw = stored.sources[1].descriptor;
      const H = ((dm.n - 1) / 2) * dm.spacingM;
      let gA = 0, gA2 = 0, nA = 0, gB = 0, gB2 = 0, nB = 0, ringMax = 0;
      for (let e = -H - W; e <= H + W + 1e-9; e += 3) {
        for (let nn = -H - W; nn <= H + W + 1e-9; nn += 3) {
          const reach = Math.max(Math.abs(e), Math.abs(nn));
          if (reach < H - 129) continue;
          const inside = reach <= H;
          const analysedStored = inside ? at(dm, e, nn) : at(dw, e, nn);
          const analysedB = inside ? at(dm, e, nn) : at(dr, e, nn);
          const drawn = inside ? at(dd, e, nn) : at(dw, e, nn);
          if (!Number.isFinite(analysedB) || !Number.isFinite(drawn)) continue;
          const a = drawn - analysedStored, b = drawn - analysedB;
          gA = Math.max(gA, Math.abs(a)); gA2 += a * a; nA++;
          gB = Math.max(gB, Math.abs(b)); gB2 += b * b; nB++;
          if (!inside) ringMax = Math.max(ringMax, Math.abs(analysedB - analysedStored));
        }
      }
      // Events in the days after the landing.
      const startMs = landedMs(id);
      const ea = sunEvents(await analyse(site, stored, startMs, days * 24, 10, mast));
      const eb = sunEvents(await analyse(site, B, startMs, days * 24, 10, mast));
      const events = [];
      let eventNote;
      if (ea.length !== eb.length || ea.some((e, k) => e.type !== eb[k].type)) eventNote = `event lists differ: ${ea.map((e) => `${e.type} ${iso(e.timeMs)}`).join(', ')} -> ${eb.map((e) => `${e.type} ${iso(e.timeMs)}`).join(', ')}`;
      else {
        ea.forEach((e, k) => events.push({ type: e.type, storedMs: e.timeMs, bMs: eb[k].timeMs, shiftMin: (eb[k].timeMs - e.timeMs) / 60000 }));
        const shifted = events.filter((e) => Math.abs(e.shiftMin) >= 0.05);
        eventNote = shifted.length ? shifted.map((e) => `${e.type} ${iso(e.storedMs)} -> ${iso(e.bMs)} (${e.shiftMin > 0 ? '+' : ''}${e.shiftMin.toFixed(1)} min)`).join('; ') : `unchanged (${events.length} events)`;
      }
      const row = { site: id, band: W, mastM: mast, azimuths: nAz, buildMs, ringN: dr.n, ringMaxM: ringMax, bVsStored, viewA: { ...viewA, groundMaxM: gA, groundRmsM: Math.sqrt(gA2 / nA) }, viewBunchanged: { ...viewBunchanged, groundMaxM: gB, groundRmsM: Math.sqrt(gB2 / nB) }, events, eventNote };
      rows.push(row);
      const deg = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
      const short = (f) => `${f.elevDeg.toFixed(3)} at ${Math.round(f.distM)} m (${/option B/.test(f.layer ?? '') ? 'B ring' : /NAC/.test(f.layer ?? '') ? '3 m model' : /, (\d+) m site window/.exec(f.layer ?? '')?.[1] ? `${/, (\d+) m site window/.exec(f.layer)[1]} m window` : f.layer})`;
      console.log(`${id.padEnd(14)} B - stored: largest ${deg(bVsStored.largestChangeDeg)} deg at az ${bVsStored.atAzDeg.toFixed(2)} [${short(bVsStored.before)} -> ${short(bVsStored.after)}], RMS ${bVsStored.rmsChangeDeg.toFixed(3)}, moved > 0.01 deg ${(100 * bVsStored.movedOver001Share).toFixed(1)} %, any date: sunrise ${bVsStored.sunriseUpToMin.toFixed(1)} / sunset ${bVsStored.sunsetUpToMin.toFixed(1)} min; ring moves the 60 m window by up to ${ringMax.toFixed(1)} m; built in ${buildMs.toFixed(0)} ms`);
      console.log(`${''.padEnd(14)} events: ${eventNote}`);
      console.log(`${''.padEnd(14)} view under A (drawn - analysed): ground up to ${gA.toFixed(2)} m (RMS ${row.viewA.groundRmsM.toFixed(2)} m over the band and ring), skyline ${deg(viewA.largestChangeDeg)} deg at az ${viewA.atAzDeg.toFixed(2)}; under B with the view unchanged: ground up to ${gB.toFixed(2)} m (RMS ${row.viewBunchanged.groundRmsM.toFixed(2)} m), skyline ${deg(viewBunchanged.largestChangeDeg)} deg at az ${viewBunchanged.atAzDeg.toFixed(2)}`);
    }
    if (opt('--json')) await writeFile(resolve(opt('--json')), JSON.stringify(rows) + '\n');
  }
} finally {
  await vite.close();
}
