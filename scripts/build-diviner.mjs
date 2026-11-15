// Builds public/data/science/diviner/: maps of ANNUAL MAXIMUM and ANNUAL MEAN surface
// temperature at the lunar poles, measured by the LRO Diviner radiometer.
//
// Source (CC0 1.0): Schorghofer, N., & Williams, J.-P., "Lunar polar maps derived from
// Diviner temperatures organized by subsolar and ecliptic longitude", Harvard Dataverse,
// https://doi.org/10.7910/DVN/EGOOCL , version 3.0. Method: Schorghofer & Williams (2020),
// Planetary Science Journal 1, 54. The maps were made from the Diviner polar cumulative
// products of Williams et al. (2019): bolometric temperatures binned at 240 m in 96
// local-time bins and 2 seasons.
//
// What is packaged, per pole: Tmax ("Maximum temperature, after frequency-domain
// Fourier-filtering [K]") and Tmean ("Mean temperature, averaged over ecliptic and
// subsolar longitudes [K]"), at the published 240 m grid (2533 x 2533, polar
// stereographic, poleward of 80 degrees), rounded to 1 K. Cells the authors left empty
// stay empty; nothing is interpolated here.
//
// NOT packaged: separate summer and winter maps. They do not exist as maps; the seasonal
// measurements are 192.7 GB of tables in the PDS (docs/lunyx/handover/T-23-findings.md).
//
// The four source grids (25.7 MB each) are downloaded once into scripts/.cache/diviner/
// and checked against the MD5 sums the repository publishes. Run with:
//   node --experimental-strip-types --no-warnings scripts/build-diviner.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeLxg, encodeLxg } from '../src/terrain/lxg.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'diviner');
const OUT = join(ROOT, 'public', 'data', 'science', 'diviner');
const R = 1737400;
const DEG = Math.PI / 180;
const NODATA = -32768;
const DOI = 'https://doi.org/10.7910/DVN/EGOOCL';
const access = (id) => `https://dataverse.harvard.edu/api/access/datafile/${id}`;

const SETS = {
  S: {
    directory: 'polar_south_96x2',
    period: 'July 2009 to February 2019',
    max: { id: 8134803, file: 'polar_south_80_Tmax.grd', md5: 'b0d096f3519d4d13d73d38f025dcfee1', cache: 'polar_south_96x2_Tmax.grd' },
    mean: { id: 8134809, file: 'polar_south_80_Tmean.grd', md5: '8b0813862ab4383cb3faced7070d4d47', cache: 'polar_south_96x2_Tmean.grd' },
  },
  N: {
    directory: 'polar_north_96x2_2024',
    period: 'July 2009 to January 2024',
    max: { id: 9263280, file: 'polar_north_80_Tmax.grd', md5: '95942cbbd47aadb3386498b5689ceed1', cache: 'polar_north_96x2_2024_Tmax.grd' },
    mean: { id: 9263266, file: 'polar_north_80_Tmean.grd', md5: '863bf6e834b8b81bce4d14d73a46dc2b', cache: 'polar_north_96x2_2024_Tmean.grd' },
  },
};

const QUANTITIES = {
  'annual-max': {
    key: 'max',
    label: 'Annual maximum temperature (Diviner)',
    sourceText: 'Maximum temperature, after frequency-domain Fourier-filtering [K]',
    meaning:
      'Highest surface temperature over the year at this place, from LRO Diviner bolometric temperatures binned by local time (96 bins) and season (2 bins) in 240 m cells; ' +
      'the authors fill gaps in each cell\'s time series and smooth it before taking the maximum. An annual value: separate summer and winter maps are not included.',
  },
  'annual-mean': {
    key: 'mean',
    label: 'Annual mean temperature (Diviner)',
    sourceText: 'Mean temperature, averaged over ecliptic and subsolar longitudes [K]',
    meaning:
      'Mean surface temperature over the lunar day and the year at this place, from LRO Diviner bolometric temperatures binned by local time (96 bins) and season (2 bins) in 240 m cells. ' +
      'An annual value: separate summer and winter maps are not included.',
  },
};

/** Places whose values are recorded from the source at build time, for the tests. */
const PLACES = [
  { name: 'Shackleton crater, centre of the floor (IAU 89.67S 129.78E)', lat: -89.67, lon: 129.78 },
  { name: 'South pole (on Shackleton\'s rim)', lat: -90, lon: 0 },
  { name: 'Near side, 86S 0E', lat: -86, lon: 0 },
  { name: 'Far side, 86S 180E', lat: -86, lon: 180 },
  { name: '82S 90E', lat: -82, lon: 90 },
  { name: '81S 135W', lat: -81, lon: -135 },
  { name: 'North pole', lat: 90, lon: 0 },
  { name: 'Near side, 86N 0E', lat: 86, lon: 0 },
  { name: 'Far side, 86N 180E', lat: 86, lon: 180 },
  { name: '82N 90W', lat: 82, lon: -90 },
  { name: '81N 45E', lat: 81, lon: 45 },
];

// ---------------------------------------------------------------- reading the source

const exists = (p) => stat(p).then(() => true, () => false);

async function fetchSource(spec) {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, spec.cache);
  if (!(await exists(path))) {
    console.log(`  downloading ${access(spec.id)}`);
    const res = await fetch(access(spec.id), { headers: { 'User-Agent': 'Mozilla/5.0 (lunyx data build)' } });
    if (!res.ok) throw new Error(`${spec.file}: HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
  }
  const buf = await readFile(path);
  const md5 = createHash('md5').update(buf).digest('hex');
  if (md5 !== spec.md5) throw new Error(`${spec.file}: md5 ${md5} differs from the published ${spec.md5}`);
  return buf;
}

/** Just enough of netCDF classic (CDF-1) to read a GMT grid: dimensions, attributes, variables. */
function readNetcdf(buf) {
  if (buf.toString('latin1', 0, 3) !== 'CDF' || buf[3] !== 1) throw new Error('not a netCDF classic file');
  let p = 4;
  const u32 = () => { const v = buf.readUInt32BE(p); p += 4; return v; };
  const name = () => { const n = u32(); const s = buf.toString('utf8', p, p + n); p += Math.ceil(n / 4) * 4; return s; };
  const SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 4, 6: 8 };
  const value = (type, at) => (type === 3 ? buf.readInt16BE(at) : type === 4 ? buf.readInt32BE(at) : type === 5 ? buf.readFloatBE(at) : type === 6 ? buf.readDoubleBE(at) : buf.readInt8(at));
  const attributes = () => {
    const tag = u32(); const count = u32(); const out = {};
    if (tag === 0) return out;
    for (let k = 0; k < count; k++) {
      const key = name(); const type = u32(); const n = u32();
      out[key] = type === 2 ? buf.toString('latin1', p, p + n).replace(/\0+$/, '') : Array.from({ length: n }, (_, i) => value(type, p + i * SIZE[type]));
      p += Math.ceil((n * SIZE[type]) / 4) * 4;
    }
    return out;
  };
  u32(); // number of records: none in these files
  const dims = [];
  { const tag = u32(); const count = u32(); for (let k = 0; k < (tag ? count : 0); k++) dims.push({ name: name(), size: u32() }); }
  const global = attributes();
  const vars = {};
  { const tag = u32(); const count = u32();
    for (let k = 0; k < (tag ? count : 0); k++) {
      const key = name(); const nd = u32(); const ids = Array.from({ length: nd }, () => u32());
      const atts = attributes(); const type = u32(); u32(); const begin = u32();
      vars[key] = { dims: ids.map((i) => dims[i].name), shape: ids.map((i) => dims[i].size), atts, type, begin };
    }
  }
  const read = (key) => {
    const v = vars[key];
    const n = v.shape.reduce((a, b) => a * b, 1);
    const out = v.type === 6 ? new Float64Array(n) : new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = value(v.type, v.begin + i * SIZE[v.type]);
    return out;
  };
  return { dims, global, vars, read };
}

/** A source grid, turned into the app's layout: row 0 at the top (largest y), column 0 at the left (smallest x). */
async function openGrid(spec, pole) {
  const nc = readNetcdf(await fetchSource(spec));
  const x = nc.read('x');
  const y = nc.read('y');
  const z = nc.read('z');
  const n = x.length;
  if (y.length !== n || nc.vars.z.dims.join() !== 'y,x' || z.length !== n * n) throw new Error(`${spec.file}: unexpected grid layout`);
  if (nc.global.node_offset?.[0] !== 1) throw new Error(`${spec.file}: expected pixel registration`);
  if (!(x[1] > x[0]) || !(y[1] > y[0])) throw new Error(`${spec.file}: expected ascending coordinates`);
  const step = (x[n - 1] - x[0]) / (n - 1);
  // Coordinates are polar stereographic distances in lunar radii; the grid is centred on the pole.
  if (Math.abs(x[0] + x[n - 1]) > 1e-9 || Math.abs(y[0] + y[n - 1]) > 1e-9 || Math.abs((y[n - 1] - y[0]) / (n - 1) - step) > 1e-12) throw new Error(`${spec.file}: grid is not centred on the pole`);
  // Pixel-registered: the grid's edge is half a cell beyond the outer cell centres. It should be the 80-degree circle.
  const edge = x[n - 1] + step / 2;
  if (Math.abs(edge - 2 * Math.tan(5 * DEG)) > 1e-6) throw new Error(`${spec.file}: expected the grid to end at 80 degrees`);
  const kelvin = new Float32Array(n * n);
  for (let row = 0; row < n; row++) kelvin.set(z.subarray((n - 1 - row) * n, (n - row) * n), row * n);
  return { n, metresPerPx: step * R, halfWidthM: edge * R, kelvin, title: nc.global.title, gmt: nc.global.GMT_version, pole, dataOffset: nc.vars.z.begin };
}

// ---------------------------------------------------------------- projection (PCP tables: x = r sin(lon); y = r cos(lon) south, -r cos(lon) north)

function toPixel(pole, lat, lon, n, metresPerPx) {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = (2 * R * Math.tan((colat / 2) * DEG)) / metresPerPx;
  const c = n / 2 - 0.5;
  return { row: c - (pole === 'S' ? 1 : -1) * r * Math.cos(lon * DEG), col: c + r * Math.sin(lon * DEG) };
}

function toLatLon(pole, row, col, n, metresPerPx) {
  const c = n / 2 - 0.5;
  const x = (col - c) * metresPerPx;
  const y = (c - row) * metresPerPx;
  const colat = (2 * Math.atan(Math.hypot(x, y) / (2 * R))) / DEG;
  return pole === 'S' ? { lat: colat - 90, lon: Math.atan2(x, y) / DEG } : { lat: 90 - colat, lon: Math.atan2(x, -y) / DEG };
}

// ---------------------------------------------------------------- packaging

const layers = [];

async function buildLayer(pole, quantity) {
  const q = QUANTITIES[quantity];
  const set = SETS[pole];
  const spec = set[q.key];
  const g = await openGrid(spec, pole);
  const { n } = g;
  const data = new Int16Array(n * n);
  const c = n / 2 - 0.5;
  const rim = g.halfWidthM / g.metresPerPx; // radius of the 80-degree circle, in cells
  let min = Infinity, max = -Infinity, sum = 0, filled = 0, emptyInside = 0, filledOutside = 0, inside = 0, worst = 0, coldest = -1, warmest = -1;
  for (let i = 0; i < data.length; i++) {
    const k = g.kelvin[i];
    const within = Math.hypot((i % n) - c, Math.floor(i / n) - c) <= rim;
    if (within) inside++;
    if (Number.isNaN(k)) {
      data[i] = NODATA;
      if (within) emptyInside++;
      continue;
    }
    const v = Math.round(k);
    data[i] = v;
    filled++;
    if (!within) filledOutside++;
    sum += k;
    worst = Math.max(worst, Math.abs(v - k));
    if (k < min) { min = k; coldest = i; }
    if (k > max) { max = k; warmest = i; }
  }
  const at = (i) => {
    const row = Math.floor(i / n), col = i % n;
    const p = toLatLon(pole, row, col, n, g.metresPerPx);
    return { lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(3), row, col, sourceK: +g.kelvin[i].toFixed(2), storedK: data[i] };
  };
  const checks = [];
  for (const place of PLACES) {
    if ((place.lat < 0) !== (pole === 'S')) continue;
    const px = toPixel(pole, place.lat, place.lon, n, g.metresPerPx);
    const row = Math.round(px.row), col = Math.round(px.col);
    if (row < 0 || col < 0 || row >= n || col >= n) continue;
    const k = g.kelvin[row * n + col];
    checks.push({ name: place.name, lat: place.lat, lon: place.lon, row, col, sourceK: Number.isNaN(k) ? null : +k.toFixed(2), storedK: Number.isNaN(k) ? null : data[row * n + col] });
  }

  const poleName = pole === 'S' ? 'south' : 'north';
  const id = `${poleName}-${quantity}`;
  const file = `diviner_${poleName}_${quantity.replace('-', '_')}_240m.lxg`;
  const info = {
    id, file, quantity, pole,
    size: n, metresPerPx: +g.metresPerPx.toFixed(4), halfWidthM: +g.halfWidthM.toFixed(1),
    latCompleteTo: pole === 'S' ? -80 : 80,
    unit: 'K', valueStepK: 1, noData: NODATA,
    period: set.period,
    source: {
      dataset: DOI, version: '3.0', licence: 'CC0 1.0',
      file: `${set.directory}/${spec.file}`, url: access(spec.id), md5: spec.md5,
      description: q.sourceText,
      binning: '96 local-time bins x 2 seasons, 240 m cells',
      internalTitle: g.title, // as found in the file; the south "96x2" files call themselves "24x6"
      // Where the values sit in the source file, so single cells can be re-read from the repository:
      // big-endian float32, rows from south to north of the y axis, i.e. bottom row of this layout first.
      dataOffset: g.dataOffset,
    },
    processing: `Published 240 m grid, unchanged in position; temperatures rounded to 1 K (largest change ${worst.toFixed(2)} K). Cells the authors left empty are kept empty (stored as ${NODATA}); nothing is interpolated.`,
    stats: {
      minK: +min.toFixed(2), maxK: +max.toFixed(2), meanK: +(sum / filled).toFixed(2),
      cellsInside80: inside, emptyInside80: emptyInside, emptyInside80Fraction: +(emptyInside / inside).toFixed(4), filledOutside80: filledOutside,
    },
    coldest: at(coldest), warmest: at(warmest), checks,
  };
  const header = {
    format: 'lunyx-grid/1', id, quantity, pole,
    grids: [{ dtype: 'int16', encoding: 'plane-delta', width: n, height: n, kind: 'polar-temperature', pole, metresPerPx: info.metresPerPx, scale: 1, offset: 0, nodata: NODATA, unit: 'K' }],
  };
  const packed = gzipSync(encodeLxg(header, [data]), { level: 9, memLevel: 9 });
  const back = (await decodeLxg(packed)).arrays[0];
  for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) throw new Error(`${file}: read-back differs at ${i}`);
  await writeFile(join(OUT, file), packed);
  layers.push({ ...info, bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex') });
  console.log(`  ${file.padEnd(40)} ${(packed.length / 1e6).toFixed(2)} MB  ${min.toFixed(1)}..${max.toFixed(1)} K  mean ${(sum / filled).toFixed(1)} K  empty inside 80 deg: ${emptyInside} (${((100 * emptyInside) / inside).toFixed(2)} %)`);
}

await mkdir(OUT, { recursive: true });
console.log('Building public/data/science/diviner/');
for (const pole of ['S', 'N']) for (const quantity of Object.keys(QUANTITIES)) await buildLayer(pole, quantity);

const index = {
  format: 'lunyx-polar-temperatures/1',
  title: 'Annual maximum and annual mean surface temperature at the lunar poles, measured by LRO Diviner',
  what: 'Two maps per pole, poleward of 80 degrees, in 240 m cells: the annual maximum and the annual mean of the surface (bolometric) temperature. They summarise many years of measurements; they are not the temperature at the date on screen.',
  notIncluded: 'Separate summer and winter maps are not included. No such maps are published; the seasonal measurements exist only as about 190 GB of tables in the NASA PDS (Williams et al. 2019).',
  projection: 'Polar stereographic on a sphere of radius 1737.4 km, true scale at the pole, pole at the centre of the grid. South: longitude 0 points to the top row, 90E to the right. North: longitude 0 points to the bottom row, 90E to the right. Mean Earth / Polar Axis frame, east-positive longitude.',
  values: `One 16-bit integer per cell: kelvin, rounded to 1 K. ${NODATA} = no value: the corners of the square beyond 80 degrees, and cells the authors left empty.`,
  quantities: Object.fromEntries(Object.entries(QUANTITIES).map(([k, q]) => [k, { label: q.label, unit: 'K', sourceDescription: q.sourceText, meaning: q.meaning }])),
  caveats: [
    'Annual values only: separate summer and winter maps are not included.',
    `Cells without a value in the published maps are left empty here: ${layers.filter((l) => l.quantity === 'annual-max').map((l) => `${(100 * l.stats.emptyInside80Fraction).toFixed(l.stats.emptyInside80Fraction < 0.001 ? 2 : 1)} % of the cells inside 80 degrees ${l.pole === 'S' ? 'south' : 'north'}`).join(', ')}.`,
    'The maximum is taken after the authors interpolate and Fourier-filter each cell\'s time series; it is not the highest single measurement.',
    'A 240 m cell averages over small cold spots and warm slopes; Diviner\'s footprint and the binning limit what is resolved.',
    'South: data from July 2009 to February 2019. North: July 2009 to January 2024.',
  ],
  citation:
    'Schorghofer, N., & Williams, J.-P. (2024). Lunar polar maps derived from Diviner temperatures organized by subsolar and ecliptic longitude (version 3.0) [Data set]. Harvard Dataverse. https://doi.org/10.7910/DVN/EGOOCL . ' +
    'Method: Schorghofer, N., & Williams, J.-P. (2020). Mapping of ice storage processes on the Moon with time-dependent temperatures. Planetary Science Journal, 1, 54. https://doi.org/10.3847/PSJ/abb6ff . ' +
    'Underlying measurements: Williams, J.-P., et al. (2019). Seasonal polar temperatures on the Moon. Journal of Geophysical Research: Planets, 124, 2505-2521.',
  licence: 'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/), as stated by the Harvard Dataverse record.',
  source: DOI,
  fileFormat: 'LXG (gzip-compressed lossless int16 grid; see src/terrain/lxg.ts). Rebuild with: node --experimental-strip-types --no-warnings scripts/build-diviner.mjs',
  totalBytes: layers.reduce((s, l) => s + l.bytes, 0),
  layers,
};
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log(`  total ${(index.totalBytes / 1e6).toFixed(2)} MB in ${layers.length} files`);
