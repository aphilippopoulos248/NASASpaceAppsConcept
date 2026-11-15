// Builds public/data/heatmap/: the long-term average maps of NASA PGDA product 69
// ("Lunar Polar Illumination", E. Mazarico, https://pgda.gsfc.nasa.gov/products/69) as
// small rasters for the globe overlay and for reading a value at a point.
//
// These are MULTI-YEAR AVERAGES computed by the LOLA team, not the Sun's or Earth's
// position on any date:
//   average solar illumination  fraction of hourly time steps, over 18.6 years (one lunar
//                               nutation cycle), in which ANY part of the Sun's disc is
//                               above the terrain horizon. A fraction of time, not of energy.
//   average Earth visibility    the same for any part of Earth's disc.
//
// For each pole and each quantity two layers are written, both in the source's own
// projection (polar stereographic, true scale at the pole, sphere of 1737.4 km):
//   wide    the 65-degree product (240 m, 6420 px) averaged 4x4 -> 960 m, 1605 px
//   detail  the 85-degree product (60 m, 5058 px) averaged 2x2 -> 120 m, 2529 px
// One byte per cell: 0 = no source pixel of the cell is ever lit (permanent shadow in the
// model), 1..100 = the cell's mean in percent, rounded, but never less than 1 once any
// source pixel is lit. Container: LXG (src/terrain/lxg.ts).
//
// Source files (about 535 MB together) are downloaded once into scripts/.cache/heatmap/
// from the LOLA team's server at MIT, with their PDS labels; everything about a file's
// layout is read from its label. Run with: npm run build-heatmap
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeLxg, encodeLxg } from '../src/terrain/lxg.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'heatmap');
const OUT = join(ROOT, 'public', 'data', 'heatmap');
const SOURCE = 'https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG';
const R = 1737400;
const DEG = Math.PI / 180;

const CITATION = 'Mazarico, E., Neumann, G. A., Smith, D. E., Zuber, M. T., & Torrence, M. H. (2011). Illumination conditions of the lunar polar regions using LOLA topography. Icarus, 211, 1066-1081. https://doi.org/10.1016/j.icarus.2010.10.030';

const QUANTITIES = {
  illumination: {
    suffix: '',
    label: 'Average sunlight (multi-year)',
    shortLabel: 'Average sunlight',
    meaning:
      'Fraction of time with any part of the Sun\'s disc above the terrain horizon, averaged over hourly steps spanning 18.6 years (one lunar nutation cycle). ' +
      'It counts time with any sunlight, not how much of the disc or of its energy arrives. A multi-year average computed from LOLA elevation models (Mazarico et al. 2011; NASA PGDA product 69), not the Sun\'s position on the date shown.',
  },
  'earth-visibility': {
    suffix: '_EARTH',
    label: 'Average Earth visibility (multi-year)',
    shortLabel: 'Average Earth visibility',
    meaning:
      'Fraction of time with any part of Earth\'s disc above the terrain horizon, averaged over hourly steps spanning 18.6 years (one lunar nutation cycle). ' +
      'Geometric line of sight only, and slightly optimistic for radio because a sliver of Earth counts: not a link budget. A multi-year average (Mazarico et al. 2011; NASA PGDA product 69), not Earth\'s position on the date shown.',
  },
};

const ROLES = {
  wide: { product: (pole) => `AVGVISIB_65${pole}_240M_201608`, block: 4 },
  detail: { product: (pole) => `AVGVISIB_85${pole}_060M_201608`, block: 2 },
};

/** Places whose values are recorded from the source at build time, so the tests can prove the packaged maps say the same. */
const PLACES = [
  { name: 'Shackleton crater, centre of the floor (IAU 89.67S 129.78E)', lat: -89.67, lon: 129.78 },
  { name: 'South pole (on Shackleton\'s rim)', lat: -90, lon: 0 },
  { name: 'Ridge at 89.45S 137.31W, between Shackleton and de Gerlache', lat: -89.45, lon: -137.31 },
  { name: 'Near side, 86S 0E', lat: -86, lon: 0 },
  { name: 'Far side, 86S 180E', lat: -86, lon: 180 },
  { name: 'Near side, 70S 0E', lat: -70, lon: 0 },
  { name: 'North pole', lat: 90, lon: 0 },
  { name: 'Near side, 86N 0E', lat: 86, lon: 0 },
  { name: 'Far side, 86N 180E', lat: 86, lon: 180 },
  { name: 'Near side, 70N 0E', lat: 70, lon: 0 },
];

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

function labelValue(label, key) {
  const m = label.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n<]+?)"?\\s*(?:<[^>]*>)?\\s*$`, 'm'));
  if (!m) throw new Error(`label has no ${key}`);
  return m[1].trim();
}

async function openProduct(id, pole) {
  await mkdir(CACHE, { recursive: true });
  await download(`${SOURCE}/${id}.LBL`, join(CACHE, `${id}.LBL`));
  await download(`${SOURCE}/${id}.IMG`, join(CACHE, `${id}.IMG`));
  const label = await readFile(join(CACHE, `${id}.LBL`), 'latin1');
  const num = (key) => Number(labelValue(label, key));
  const p = {
    id,
    url: `${SOURCE}/${id}.IMG`,
    labelUrl: `${SOURCE}/${id}.LBL`,
    version: labelValue(label, 'PRODUCT_VERSION_ID'),
    created: labelValue(label, 'PRODUCT_CREATION_TIME').slice(0, 10),
    size: num('LINES'),
    scaling: num('SCALING_FACTOR'),
    mapScale: num('MAP_SCALE'),
    // The terrain model the LOLA team computed the map from, as named in the label's description.
    basedOn: (label.match(/LDEM_\d+[NS]_\d+M/) ?? ['a LOLA elevation model'])[0],
  };
  if (labelValue(label, 'PRODUCT_ID') !== id) throw new Error(`${id}: label is for another product`);
  if (labelValue(label, 'SAMPLE_TYPE') !== 'LSB_INTEGER' || num('SAMPLE_BITS') !== 16) throw new Error(`${id}: expected 16-bit little-endian samples`);
  if (num('LINE_SAMPLES') !== p.size || num('OFFSET') !== 0) throw new Error(`${id}: unexpected layout`);
  if (labelValue(label, 'MAP_PROJECTION_TYPE') !== 'POLAR STEREOGRAPHIC' || num('CENTER_LONGITUDE') !== 0 || num('CENTER_LATITUDE') !== (pole === 'S' ? -90 : 90)) throw new Error(`${id}: unexpected projection`);
  if (num('LINE_PROJECTION_OFFSET') !== p.size / 2 - 0.5 || num('SAMPLE_PROJECTION_OFFSET') !== p.size / 2 - 0.5) throw new Error(`${id}: the pole is not at the centre`);
  if (Math.abs(p.scaling * 25000 - 1) > 1e-9) throw new Error(`${id}: expected DN 25000 = 1`);
  const buf = await readFile(join(CACHE, `${id}.IMG`));
  if (buf.length !== p.size * p.size * 2) throw new Error(`${id}: file is ${buf.length} bytes, label says ${p.size} x ${p.size} x 2`);
  p.dn = new Int16Array(buf.buffer, buf.byteOffset, p.size * p.size);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < p.dn.length; i++) { const v = p.dn[i]; if (v < min) min = v; if (v > max) max = v; }
  if (min < 0 || max > 25000) throw new Error(`${id}: values outside 0..25000 (${min}..${max})`);
  return p;
}

// ---------------------------------------------------------------- projection (as the PDS labels define it)

/** Fractional (line, sample) of a point in a grid of `size` pixels of `metresPerPx`, pole at the centre. */
function toPixel(pole, lat, lon, size, metresPerPx) {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = (2 * R * Math.tan((colat / 2) * DEG)) / metresPerPx;
  const c = size / 2 - 0.5;
  // South: longitude 0 is up (towards line 0). North: longitude 0 is down.
  return { line: c - (pole === 'S' ? 1 : -1) * r * Math.cos(lon * DEG), sample: c + r * Math.sin(lon * DEG) };
}

function toLatLon(pole, line, sample, size, metresPerPx) {
  const c = size / 2 - 0.5;
  const x = (sample - c) * metresPerPx;
  const y = (c - line) * metresPerPx;
  const colat = (2 * Math.atan(Math.hypot(x, y) / (2 * R))) / DEG;
  return pole === 'S' ? { lat: colat - 90, lon: Math.atan2(x, y) / DEG } : { lat: 90 - colat, lon: Math.atan2(x, -y) / DEG };
}

const edgeLat = (halfM) => 90 - (2 * Math.atan(halfM / (2 * R))) / DEG;

// ---------------------------------------------------------------- packaging

function blockMeans(p, block) {
  const n = p.size;
  if (n % block) throw new Error(`${p.id}: ${n} px is not a multiple of ${block}`);
  const size = n / block;
  const out = new Uint8Array(size * size);
  /** Exact cell means as fractions, kept for the checks. */
  const mean = new Float32Array(size * size);
  let zeros = 0, sum = 0, max = 0, worst = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let s = 0;
      for (let b = 0; b < block; b++) {
        const row = (r * block + b) * n + c * block;
        for (let a = 0; a < block; a++) s += p.dn[row + a];
      }
      const fraction = (s / (block * block)) * p.scaling;
      const pct = s === 0 ? 0 : Math.max(1, Math.round(fraction * 100));
      out[r * size + c] = pct;
      mean[r * size + c] = fraction;
      if (pct === 0) zeros++;
      sum += fraction;
      if (pct > max) max = pct;
      // How far the stored whole percent is from the exact mean (the "at least 1" rule aside).
      if (fraction * 100 >= 0.5) worst = Math.max(worst, Math.abs(pct - fraction * 100));
    }
  }
  return { size, data: out, mean, zeroFraction: zeros / out.length, meanFraction: sum / out.length, maxPercent: max, worstRoundingPercent: worst };
}

const layers = [];

async function buildLayer(pole, quantity, role) {
  const q = QUANTITIES[quantity];
  const spec = ROLES[role];
  const p = await openProduct(spec.product(pole) + q.suffix, pole);
  const g = blockMeans(p, spec.block);
  const metresPerPx = p.mapScale * spec.block;
  const halfWidthM = (g.size / 2) * metresPerPx; // to the outer edge of the outer cells
  const id = `${pole === 'S' ? 'south' : 'north'}-${quantity}-${role}`;
  const file = `pgda69_${pole === 'S' ? 'south' : 'north'}_${quantity.replace('-', '_')}_${metresPerPx}m.lxg`;
  const sign = pole === 'S' ? -1 : 1;
  // Round the "complete to" latitude towards the pole, so the statement is never too generous.
  const completeTo = sign * Math.ceil(edgeLat(halfWidthM) * 100) / 100;
  const cornersTo = sign * Math.ceil(edgeLat(halfWidthM * Math.SQRT2) * 10) / 10;

  const checks = [];
  for (const place of PLACES) {
    if ((place.lat < 0) !== (pole === 'S')) continue;
    const src = toPixel(pole, place.lat, place.lon, p.size, p.mapScale);
    const sl = Math.round(src.line), ss = Math.round(src.sample);
    if (sl < 0 || ss < 0 || sl >= p.size || ss >= p.size) continue;
    const cell = { line: Math.floor(sl / spec.block), sample: Math.floor(ss / spec.block) };
    checks.push({
      name: place.name, lat: place.lat, lon: place.lon,
      // The source pixel that contains the point, and its value.
      sourceLine: sl, sourceSample: ss, sourceFraction: +(p.dn[sl * p.size + ss] * p.scaling).toFixed(5),
      // The packaged cell that contains that pixel: exact mean of its source pixels, and what is stored.
      line: cell.line, sample: cell.sample, cellMeanFraction: +g.mean[cell.line * g.size + cell.sample].toFixed(5), storedPercent: g.data[cell.line * g.size + cell.sample],
    });
  }
  // The brightest source pixel of the product, wherever it is.
  let top = 0;
  for (let i = 1; i < p.dn.length; i++) if (p.dn[i] > p.dn[top]) top = i;
  const topLine = Math.floor(top / p.size), topSample = top % p.size;
  const topAt = toLatLon(pole, topLine, topSample, p.size, p.mapScale);
  const topCell = { line: Math.floor(topLine / spec.block), sample: Math.floor(topSample / spec.block) };
  const brightest = {
    lat: +topAt.lat.toFixed(4), lon: +topAt.lon.toFixed(3), sourceLine: topLine, sourceSample: topSample, sourceFraction: +(p.dn[top] * p.scaling).toFixed(5),
    line: topCell.line, sample: topCell.sample, cellMeanFraction: +g.mean[topCell.line * g.size + topCell.sample].toFixed(5), storedPercent: g.data[topCell.line * g.size + topCell.sample],
  };

  const info = {
    id, file, quantity, pole, role,
    size: g.size, metresPerPx, halfWidthM,
    latCompleteTo: completeTo, latCornersTo: cornersTo,
    valueStep: 0.01,
    source: {
      product: `${p.id} (LOLA team, PDS label version ${p.version}, created ${p.created})`,
      url: p.url, label: p.labelUrl,
      resolutionM: p.mapScale, sizePx: p.size, basedOn: p.basedOn,
    },
    processing:
      `Each ${metresPerPx} m cell is the mean of ${spec.block}x${spec.block} pixels of the ${p.mapScale} m source map, stored as a whole percent ` +
      `(largest rounding change ${g.worstRoundingPercent.toFixed(2)} points). 0 is kept for cells in which no source pixel is ever lit; any lit cell is stored as at least 1. Same projection as the source.`,
    stats: { neverLitFraction: +g.zeroFraction.toFixed(4), meanFraction: +g.meanFraction.toFixed(4), maxPercent: g.maxPercent },
    brightest, checks,
  };
  const header = {
    format: 'lunyx-grid/1', id, quantity, pole, role,
    grids: [{ dtype: 'uint8', encoding: 'plane-delta', width: g.size, height: g.size, kind: 'polar-average', pole, metresPerPx, valueScale: 0.01, zeroMeans: 'never lit in the model' }],
  };
  const packed = gzipSync(encodeLxg(header, [g.data]), { level: 9, memLevel: 9 });
  const back = (await decodeLxg(packed)).arrays[0];
  for (let i = 0; i < g.data.length; i++) if (back[i] !== g.data[i]) throw new Error(`${file}: read-back differs at ${i}`);
  await writeFile(join(OUT, file), packed);
  layers.push({ ...info, bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex') });
  console.log(`  ${file.padEnd(48)} ${(packed.length / 1e6).toFixed(2).padStart(5)} MB  ${g.size} px  never lit ${(100 * g.zeroFraction).toFixed(1)}%  max ${g.maxPercent}%  brightest source pixel ${(100 * brightest.sourceFraction).toFixed(1)}% at ${brightest.lat}, ${brightest.lon}`);
}

await mkdir(OUT, { recursive: true });
console.log('Building public/data/heatmap/');
for (const pole of ['S', 'N']) for (const quantity of Object.keys(QUANTITIES)) for (const role of ['detail', 'wide']) await buildLayer(pole, quantity, role);

const index = {
  format: 'lunyx-polar-averages/1',
  title: 'Long-term average solar illumination and Earth visibility at the lunar poles (NASA PGDA product 69)',
  what: 'Multi-year averages computed by the LOLA team from LOLA elevation models. They describe a place over many years; they are not the geometry of any date.',
  averagingPeriod: 'Hourly time steps spanning 18.6 years (one lunar nutation cycle), as stated on the PGDA product page. The published files do not state the calendar dates of that span.',
  projection: 'Polar stereographic on a sphere of radius 1737.4 km, true scale at the pole, pole at the centre of the grid. South: longitude 0 points to the top row, 90E to the right. North: longitude 0 points to the bottom row, 90E to the right. Mean Earth / Polar Axis frame, east-positive longitude.',
  values: 'One byte per cell. 0 = no source pixel in the cell is ever lit (permanent shadow in the model). 1..100 = mean of the cell in percent of time, rounded; lit cells are stored as at least 1.',
  quantities: Object.fromEntries(Object.entries(QUANTITIES).map(([k, q]) => [k, { label: q.label, shortLabel: q.shortLabel, unit: 'percent of time', meaning: q.meaning }])),
  caveats: [
    'These maps are "EXTRAS" products: their README says they "are not supported by the PDS or the LOLA Science Team".',
    'The README notes that some maps show linear artefacts inherited from the elevation models they were computed from.',
    'Averaged cells dilute small bright spots: a narrow ridge crest reads lower here than in the 60 m source map.',
    'Poleward of 85 degrees the detail layer (120 m cells) applies; elsewhere only the wide layer (960 m cells). Nothing equatorward of the wide layer\'s square.',
  ],
  citation: CITATION,
  productPage: 'https://pgda.gsfc.nasa.gov/products/69',
  sourceDirectory: 'https://imbrium.mit.edu/EXTRAS/ILLUMINATION/',
  usage:
    'NASA data. No licence file accompanies the maps; the PGDA page points to NASA\'s media usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/), under which NASA content is generally not subject to copyright in the United States. The authors ask that Mazarico et al. (2011) be cited.',
  fileFormat: 'LXG (gzip-compressed lossless 8-bit grid; see src/terrain/lxg.ts). Rebuild with: npm run build-heatmap',
  totalBytes: layers.reduce((s, l) => s + l.bytes, 0),
  layers,
};
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`  total ${(index.totalBytes / 1e6).toFixed(2)} MB in ${layers.length} files`);
