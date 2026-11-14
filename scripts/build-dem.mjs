// Builds the elevation grids bundled with the app, in public/data/dem/:
//
//   lola_global_16ppd.lxg     whole Moon, 16 px/deg (1895 m), heights rounded to 1 m
//   lola_global_4ppd.lxg      whole Moon, 4 px/deg (7581 m), for a quick first drawing of the relief
//   lola_south_80s_160m.lxg   south pole, the LDEM_80S square at 160 m (2x2 means of the 80 m product), 1 m steps
//   lola_south_85s_80m.lxg    south pole, the LDEM_85S square at 80 m (2x2 means of the 40 m product), 1 m steps
//   lola_south_875s_40m.lxg   south pole, the LDEM_875S square at 40 m (2x2 means of the 20 m product), 0.5 m steps
//   index.json                what each file is: extent, resolution, source, size, checksum, limits
//
// Source: NASA PDS Geosciences Node, LRO LOLA gridded data records (LRO-L-LOLA-4-GDR-V1.0).
// Heights are metres above the 1737.4 km sphere, as in the source.
//
// The source files (about 410 MB together) are downloaded once into scripts/.cache/dem/.
// File format: see src/terrain/lxg.ts. Run with: npm run build-dem
//
// The north pole has no bundled polar layer (the size budget went to the south, where the
// landing-site questions are); it is covered by the whole-Moon grid only.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { polarEdgeLatitude } from '../src/terrain/geo.ts';
import { decodeLxg, encodeLxg } from '../src/terrain/lxg.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'dem');
const OUT = join(ROOT, 'public', 'data', 'dem');
const PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr';
const R = 1737400;

const CITATION =
  'Smith, D. E., et al. (2017). Summary of the results from the Lunar Orbiter Laser Altimeter after seven years in lunar orbit. Icarus, 283, 70-91. ' +
  'Data: LRO LOLA Gridded Data Records (LRO-L-LOLA-4-GDR-V1.0), NASA Planetary Data System, Geosciences Node.';

// ---------------------------------------------------------------- source products

const exists = (p) => stat(p).then(() => true, () => false);

async function download(url, dest) {
  if (await exists(dest)) return;
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(`${dest}.part`));
  await rename(`${dest}.part`, dest);
}

/** Reads a PDS3 label value, e.g. num(label, 'LINE_SAMPLES'). */
function labelValue(label, key) {
  const m = label.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n<]+?)"?\\s*(?:<[^>]*>)?\\s*$`, 'm'));
  if (!m) throw new Error(`label has no ${key}`);
  return m[1].trim();
}

/** Downloads (once) and opens a LOLA gridded product; everything about its layout comes from its own label. */
async function openProduct(path) {
  const name = path.split('/').pop();
  await mkdir(CACHE, { recursive: true });
  await download(`${PDS}/${path}.lbl`, join(CACHE, `${name}.lbl`));
  await download(`${PDS}/${path}.img`, join(CACHE, `${name}.img`));
  const label = await readFile(join(CACHE, `${name}.lbl`), 'latin1');
  const num = (key) => Number(labelValue(label, key));
  const p = {
    name,
    url: `${PDS}/${path}.img`,
    labelUrl: `${PDS}/${path}.lbl`,
    productId: name.toUpperCase(),
    version: labelValue(label, 'PRODUCT_VERSION_ID'),
    created: labelValue(label, 'PRODUCT_CREATION_TIME'),
    lines: num('LINES'),
    samples: num('LINE_SAMPLES'),
    scaling: num('SCALING_FACTOR'),
    projection: labelValue(label, 'MAP_PROJECTION_TYPE'),
    mapScale: num('MAP_SCALE'),
    centerLon: num('CENTER_LONGITUDE'),
    lineOffset: num('LINE_PROJECTION_OFFSET'),
    sampleOffset: num('SAMPLE_PROJECTION_OFFSET'),
  };
  if (labelValue(label, 'SAMPLE_TYPE') !== 'LSB_INTEGER' || num('SAMPLE_BITS') !== 16) throw new Error(`${name}: expected 16-bit little-endian samples`);
  if (num('OFFSET') !== R) throw new Error(`${name}: heights are not relative to the 1737.4 km sphere`);
  const buf = await readFile(join(CACHE, `${name}.img`));
  if (buf.length !== p.lines * p.samples * 2) throw new Error(`${name}: file is ${buf.length} bytes, label says ${p.lines} x ${p.samples} x 2`);
  p.dn = new Int16Array(buf.buffer, buf.byteOffset, p.lines * p.samples);
  // The LOLA height grids are gap-filled; make sure no "missing" marker slips through as a height.
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.dn.length; i++) { const v = p.dn[i]; if (v < min) min = v; if (v > max) max = v; }
  if (min <= -32767) throw new Error(`${name}: contains the value ${min}, which looks like a missing-data marker`);
  p.minM = min * p.scaling;
  p.maxM = max * p.scaling;
  return p;
}

// ---------------------------------------------------------------- grids

/** Whole-Moon cylindrical grid, rearranged to start at 180W like the app's textures. `unitM` = height step stored. */
function globalGrid(p, unitM) {
  if (p.projection !== 'SIMPLE CYLINDRICAL' || p.centerLon !== 180 || p.samples !== 2 * p.lines) throw new Error(`${p.name}: unexpected layout`);
  if (p.lineOffset !== p.lines / 2 - 0.5 || p.sampleOffset !== p.samples / 2 - 0.5) throw new Error(`${p.name}: unexpected pixel registration`);
  const { lines: h, samples: w, dn } = p;
  const out = new Int16Array(w * h);
  const half = w / 2;
  let worst = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      // Source column 0 is 0E..; output column 0 is 180W.., i.e. source column w/2.
      const m = dn[r * w + ((c + half) % w)] * p.scaling;
      const q = Math.round(m / unitM);
      out[r * w + c] = q;
      worst = Math.max(worst, Math.abs(q * unitM - m));
    }
  }
  return { data: out, width: w, height: h, worstRoundingM: worst };
}

/** 2x2 block means of a polar product: half the pixels per side, pole still at the centre. */
function polarHalved(p, unitM) {
  if (p.projection !== 'POLAR STEREOGRAPHIC' || p.centerLon !== 0 || p.lines !== p.samples || p.lines % 2) throw new Error(`${p.name}: unexpected layout`);
  if (p.lineOffset !== p.lines / 2 - 0.5 || p.sampleOffset !== p.samples / 2 - 0.5) throw new Error(`${p.name}: the pole is not at the centre`);
  const n = p.lines;
  const size = n / 2;
  const out = new Int16Array(size * size);
  let worst = 0;
  for (let r = 0; r < size; r++) {
    const a = 2 * r * n;
    const b = a + n;
    for (let c = 0; c < size; c++) {
      const m = ((p.dn[a + 2 * c] + p.dn[a + 2 * c + 1] + p.dn[b + 2 * c] + p.dn[b + 2 * c + 1]) / 4) * p.scaling;
      const q = Math.round(m / unitM);
      out[r * size + c] = q;
      worst = Math.max(worst, Math.abs(q * unitM - m));
    }
  }
  return { data: out, size, metresPerPx: p.mapScale * 2, worstRoundingM: worst };
}

// ---------------------------------------------------------------- output

const layers = [];

/** Lowest and highest height actually stored, metres. */
function rangeM(data, unitM) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
  return [min * unitM, max * unitM];
}

async function writeLayer(info, grid, data) {
  const header = { format: 'lunyx-grid/1', id: info.id, datum: 'metres above the 1737.4 km sphere', source: info.provenance, grids: [grid] };
  const body = encodeLxg(header, [data]);
  const packed = gzipSync(body, { level: 9, memLevel: 9 });
  // Read it back the way the app will, and insist on an identical grid.
  const check = await decodeLxg(packed);
  if (check.arrays[0].length !== data.length) throw new Error(`${info.file}: read-back length differs`);
  for (let i = 0; i < data.length; i++) if (check.arrays[0][i] !== data[i]) throw new Error(`${info.file}: read-back differs at sample ${i}`);
  await writeFile(join(OUT, info.file), packed);
  const layer = { ...info, bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex') };
  layers.push(layer);
  console.log(`  ${info.file.padEnd(26)} ${(packed.length / 1e6).toFixed(2).padStart(6)} MB  (${(data.byteLength / 1e6).toFixed(1)} MB as int16)`);
}

const productLine = (p) => `LRO LOLA ${p.productId} (PDS product version ${p.version}, created ${p.created})`;

async function buildGlobal({ path, id, file, role, unitM, name, notCovered }) {
  const p = await openProduct(path);
  const g = globalGrid(p, unitM);
  const ppd = p.samples / 360;
  await writeLayer(
    {
      id, file, role, kind: 'equirect', name,
      resolutionM: p.mapScale,
      latMin: -90, latMax: 90,
      heightStepM: unitM,
      heightRangeM: rangeM(g.data, unitM),
      provenance: {
        product: productLine(p),
        url: p.url,
        processing:
          `Columns rearranged to run from 180W to 180E (the source runs 0E to 360E); ` +
          (unitM === p.scaling ? `heights kept at the source's ${p.scaling} m steps.` : `heights rounded from the source's ${p.scaling} m steps to ${unitM} m (largest change ${g.worstRoundingM} m).`) +
          ' No resampling.',
        citation: CITATION,
      },
      notCovered,
    },
    { dtype: 'int16', encoding: 'plane-delta', width: g.width, height: g.height, kind: 'equirect', name, resolutionM: p.mapScale, latN: 90, latS: -90, lonW: -180, lonE: 180, scale: unitM, offset: 0, pixelsPerDegree: ppd },
    g.data,
  );
}

async function buildPolar({ path, id, file, unitM, edge }) {
  const p = await openProduct(path);
  const g = polarHalved(p, unitM);
  const halfWidthM = ((g.size - 1) / 2) * g.metresPerPx;
  const circle = polarEdgeLatitude(halfWidthM);
  const corner = polarEdgeLatitude(halfWidthM * Math.SQRT2);
  // Round the guaranteed band towards the pole so the statement is never too generous.
  const latMax = -Math.ceil(circle * 100) / 100;
  const name = `LOLA south pole, ${edge} square at ${g.metresPerPx} m`;
  await writeLayer(
    {
      id, file, role: 'polar', kind: 'polar', pole: 'S', name,
      resolutionM: g.metresPerPx,
      halfWidthM,
      latMin: -90, latMax,
      footprintNote:
        `Square of ${(2 * halfWidthM / 1000).toFixed(1)} km centred on the south pole (polar stereographic). Complete south of ${Math.abs(latMax).toFixed(2)}S; ` +
        `towards its corners (longitudes 45, 135, -135 and -45) it reaches ${corner.toFixed(1)}S.`,
      heightStepM: unitM,
      heightRangeM: rangeM(g.data, unitM),
      provenance: {
        product: productLine(p),
        url: p.url,
        processing:
          `Each ${g.metresPerPx} m sample is the mean of 2x2 samples of the ${p.mapScale} m source grid, rounded to ${unitM} m ` +
          `(the source stores ${p.scaling} m steps; largest rounding change ${g.worstRoundingM} m). Same projection and extent as the source.`,
        citation: CITATION,
      },
      notCovered: `Nothing north of the square. Detail finer than ${g.metresPerPx} m; the source's own ${p.mapScale} m grid is not bundled.`,
    },
    { dtype: 'int16', encoding: 'plane-delta', width: g.size, height: g.size, kind: 'polar', name, resolutionM: g.metresPerPx, pole: 'S', metresPerPx: g.metresPerPx, scale: unitM, offset: 0 },
    g.data,
  );
}

await mkdir(OUT, { recursive: true });
console.log('Building public/data/dem/');
await buildPolar({ path: 'polar/img/ldem_875s_20m', id: 'south-875s-40m', file: 'lola_south_875s_40m.lxg', unitM: 0.5, edge: '87.5S' });
await buildPolar({ path: 'polar/img/ldem_85s_40m', id: 'south-85s-80m', file: 'lola_south_85s_80m.lxg', unitM: 1, edge: '85S' });
await buildPolar({ path: 'polar/img/ldem_80s_80m', id: 'south-80s-160m', file: 'lola_south_80s_160m.lxg', unitM: 1, edge: '80S' });
await buildGlobal({
  path: 'cylindrical/img/ldem_16', id: 'global-16ppd', file: 'lola_global_16ppd.lxg', role: 'global', unitM: 1,
  name: 'LOLA whole-Moon grid, 16 px/deg',
  notCovered: 'Relief narrower than about 1.9 km (each sample stands for a 1.9 km cell at the equator): sharp ridges and small craters are smoothed.',
});
await buildGlobal({
  path: 'cylindrical/img/ldem_4', id: 'global-4ppd', file: 'lola_global_4ppd.lxg', role: 'overview', unitM: 0.5,
  name: 'LOLA whole-Moon overview, 4 px/deg',
  notCovered: 'Anything smaller than about 7.6 km. Meant for drawing the globe quickly, not for analysis.',
});

const index = {
  format: 'lunyx-dem-index/1',
  datum: 'Heights are metres above a sphere of radius 1737.4 km (the LOLA reference), Mean Earth / Polar Axis frame, east-positive longitude.',
  fileFormat: 'LXG: gzip-compressed header + int16 grid with a lossless predictor; see src/terrain/lxg.ts. Rebuild with: npm run build-dem',
  notBundled: [
    'North polar layers: the north pole is covered by the whole-Moon grid only (1.9 km).',
    'North of the 80S square nothing finer than the whole-Moon grid is bundled, apart from the windows around the catalogued landing sites (public/terrain/). The elevation server builds 60 m windows for other coordinates on request (needs network access).',
  ],
  totalBytes: layers.reduce((s, l) => s + l.bytes, 0),
  layers,
};
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`  total ${(index.totalBytes / 1e6).toFixed(2)} MB in ${layers.length} files`);
