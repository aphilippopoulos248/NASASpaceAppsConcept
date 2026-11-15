// Builds public/data/science/shadowcam/: an index of the ShadowCam controlled mosaics of
// permanently shadowed regions, so the app can tell whether a point is covered by one and
// link to the product in the ShadowCam PDS archive. NO IMAGERY IS BUNDLED.
//
// Source: KPLO ShadowCam Data Archive (PDS4 bundle, doi:10.17189/y89z-kt98),
// https://pds.shadowcam.im-ldi.com/ :
//   derived/vector/shadowcam_vector_controlled_mosaics_{sp,np}/  outline tables (GeoCSV)
//   derived/cmosaic/<site>/..._readme.txt                        dates, PSR ids, references
//
// Output:
//   index.json              one entry per mosaic: what, where, when, links, the authors'
//                           bounding outline, and where its coverage grid sits
//   shadowcam_coverage.lxg  one small 0/1 grid per mosaic: the published footprint
//                           (thousands of polygon fragments) sampled at 200 m
//
// The archive carries no licence or usage statement (bundle label, archive SIS and product
// readmes checked on 2026-11-14), which is why the app links out instead of bundling images.
//
// Run with: node --experimental-strip-types --no-warnings scripts/build-shadowcam-index.mjs
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { decodeLxg, encodeLxg } from '../src/terrain/lxg.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache', 'shadowcam');
const OUT = join(ROOT, 'public', 'data', 'science', 'shadowcam');
const ARCHIVE = 'https://pds.shadowcam.im-ldi.com';
const R = 1737400;
const DEG = Math.PI / 180;
const CELL_M = 200;

const exists = (p) => stat(p).then(() => true, () => false);

async function cached(url, name, { text = true } = {}) {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, name);
  if (!(await exists(path))) {
    console.log(`  downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
  }
  return text ? readFile(path, 'utf8') : readFile(path);
}

/** RFC 4180 CSV with quoted fields (the WKT columns contain commas and are megabytes long). */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else {
        // Copy runs of ordinary characters in one go: the polygons are long.
        let j = i;
        while (j < text.length && text[j] !== '"') j++;
        field += text.slice(i, j);
        i = j - 1;
      }
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); field = ''; if (row.length > 1 || row[0] !== '') rows.push(row); row = []; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k]])));
}

/**
 * Every ring of a (MULTI)POLYGON, as flat [x0, y0, x1, y1, ...] arrays. Outer rings and
 * holes alike: the fill rule sorts them out. The published coordinates are whole metres
 * with floating-point noise in the ninth decimal (95451.00000000086), so a ring's last
 * vertex can differ from its first by a nanometre; they are snapped to the millimetre and
 * every ring is closed exactly.
 */
function wktRings(wkt) {
  const rings = [];
  const re = /\(([^()]+)\)/g;
  for (let m; (m = re.exec(wkt)); ) {
    const nums = m[1].split(/[ ,]+/).map((t) => Math.round(Number(t) * 1000) / 1000);
    if (nums.length < 8 || nums.length % 2 || nums.some(Number.isNaN)) throw new Error('unexpected WKT ring');
    const n = nums.length;
    if (Math.hypot(nums[0] - nums[n - 2], nums[1] - nums[n - 1]) > 0.01) throw new Error('WKT ring is not closed');
    nums[n - 2] = nums[0];
    nums[n - 1] = nums[1];
    rings.push(Float64Array.from(nums));
  }
  return rings;
}

/** Area of a (MULTI)POLYGON in square metres: each polygon's outer ring minus its holes. */
function wktArea(wkt) {
  const ringArea = (text) => {
    const v = text.split(/[ ,]+/).map(Number);
    let a = 0;
    for (let i = 0; i + 3 < v.length; i += 2) a += v[i] * v[i + 3] - v[i + 2] * v[i + 1];
    return Math.abs(a) / 2;
  };
  let total = 0;
  for (const m of wkt.matchAll(/\(\(([^()]+(?:\),\([^()]+)*)\)\)/g)) {
    const [outer, ...holes] = m[1].split('),(');
    total += ringArea(outer) - holes.reduce((sum, h) => sum + ringArea(h), 0);
  }
  return total;
}

/** Polar stereographic metres of the outline tables (standard GIS axes: x east of the central meridian, y "north") to lat/lon. */
function toLatLon(pole, x, y) {
  const colat = (2 * Math.atan(Math.hypot(x, y) / (2 * R))) / DEG;
  return pole === 'S' ? { lat: colat - 90, lon: Math.atan2(x, y) / DEG } : { lat: 90 - colat, lon: Math.atan2(x, -y) / DEG };
}
function toXY(pole, lat, lon) {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = 2 * R * Math.tan((colat / 2) * DEG);
  return pole === 'S' ? { x: r * Math.sin(lon * DEG), y: r * Math.cos(lon * DEG) } : { x: r * Math.sin(lon * DEG), y: -r * Math.cos(lon * DEG) };
}
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/**
 * Samples a footprint on a grid of CELL_M cells aligned to whole multiples of CELL_M: a
 * cell is 1 when its centre is inside the footprint (even-odd over all rings, which handles
 * holes and separate pieces).
 */
function rasterise(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1]); }
  const left = Math.floor(minX / CELL_M) * CELL_M;
  const top = Math.ceil(maxY / CELL_M) * CELL_M;
  const cols = Math.ceil((maxX - left) / CELL_M);
  const rows = Math.ceil((top - minY) / CELL_M);
  const crossings = Array.from({ length: rows }, () => []);
  for (const r of rings) {
    for (let i = 0; i + 3 < r.length; i += 2) {
      const x0 = r[i], y0 = r[i + 1], x1 = r[i + 2], y1 = r[i + 3];
      if (y0 === y1) continue;
      const yLo = Math.min(y0, y1), yHi = Math.max(y0, y1);
      // Rows whose centre line y = top - (row + 0.5) * CELL_M crosses this edge (half-open in y, so shared vertices count once).
      // yLo <= y < yHi  <=>  (top - yHi) / CELL_M - 0.5 < row <= (top - yLo) / CELL_M - 0.5
      const first = Math.max(0, Math.floor((top - yHi) / CELL_M - 0.5) + 1);
      const last = Math.min(rows - 1, Math.floor((top - yLo) / CELL_M - 0.5));
      for (let row = first; row <= last; row++) {
        const y = top - (row + 0.5) * CELL_M;
        if (y < yLo || y >= yHi) continue;
        crossings[row].push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
      }
    }
  }
  const mask = new Uint8Array(cols * rows);
  let covered = 0;
  for (let row = 0; row < rows; row++) {
    const xs = crossings[row].sort((a, b) => a - b);
    if (xs.length % 2) throw new Error('footprint ring is not closed');
    for (let k = 0; k < xs.length; k += 2) {
      // Cells whose centre left + (col + 0.5) * CELL_M lies in [xs[k], xs[k + 1]).
      const c0 = Math.max(0, Math.ceil((xs[k] - left) / CELL_M - 0.5));
      const c1 = Math.min(cols - 1, Math.ceil((xs[k + 1] - left) / CELL_M - 0.5) - 1);
      for (let col = c0; col <= c1; col++) { mask[row * cols + col] = 1; covered++; }
    }
  }
  return { left, top, cols, rows, mask, covered };
}

/** The facts a mosaic's readme states about it. */
function readme(text) {
  const get = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
    return m ? m[1] : null;
  };
  const psr = [];
  // "PSR IDs:              SP_896450_1282030: https://lroc.im-ldi.com/atlases/psr/264" (possibly several, comma or newline separated)
  const block = text.match(/^PSR IDs:\s*([\s\S]*?)^Center Lat:/m);
  if (block) for (const m of block[1].matchAll(/([NS]P_\d+_\d+):\s*(https?:\/\/\S+?)(?=[,\s]|$)/g)) psr.push({ id: m[1], url: m[2] });
  const citation = text.match(/When citing this product, use the following reference:\s*([\s\S]*?)\n\s*\n/);
  return {
    rdrName: get('RDR Name'), siteName: get('Site Name'), psr,
    pixelScale: get('Pixel Scale'), images: get('# Images'),
    imageStart: get('Image Start'), imageStop: get('Image Stop'),
    sigma0: get('Sigma0'), mapProjDtm: get('Map Proj DTM'),
    citation: citation ? citation[1].replace(/\s+/g, ' ').trim() : null,
  };
}

async function head(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return Number(res.headers.get('content-length'));
    if (res.status === 404) return null;
    if (attempt >= 2) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((go) => setTimeout(go, 1500));
  }
}

await mkdir(OUT, { recursive: true });
console.log('Building public/data/science/shadowcam/');
const mosaics = [];
const grids = [];
const arrays = [];
let citation = null;
let tableNote = null;
for (const [pole, tag] of [['S', 'sp'], ['N', 'np']]) {
  const dir = `${ARCHIVE}/derived/vector/shadowcam_vector_controlled_mosaics_${tag}`;
  const table = parseCsv(await cached(`${dir}/shadowcam_vector_cmosaics_${tag}.csv`, `shadowcam_vector_cmosaics_${tag}.csv`));
  const prj = await cached(`${dir}/shadowcam_vector_cmosaics_${tag}.prj`, `shadowcam_vector_cmosaics_${tag}.prj`);
  const note = await cached(`${dir}/shadowcam_vector_cmosaics_${tag}_readme.txt`, `shadowcam_vector_cmosaics_${tag}_readme.txt`);
  if (!prj.includes('Stereographic') || !prj.includes('1737400') || !prj.includes(`"Latitude_Of_Origin",${pole === 'S' ? -90 : 90}`) || !prj.includes('"Central_Meridian",0') || !prj.includes('"Scale_Factor",1')) throw new Error(`${tag}: unexpected projection: ${prj}`);
  tableNote ??= (note.match(/This GeoCSV contains all[^.]*\./) ?? [null])[0]?.replace(/\s+/g, ' ').replace(/South Pole |North Pole /, '') ?? null;
  for (const row of table) {
    const id = row.pds_name;
    const productId = row.cog_name.replace(/_cog\.tif$/, '');
    if (!productId.startsWith(`shadowcam_cmosaic_${id}_`) || !row.product_link.endsWith(`/derived/cmosaic/${id}/`)) throw new Error(`${id}: unexpected product naming`);
    const info = readme(await cached(`${row.product_link}${productId}_readme.txt`, `${productId}_readme.txt`));
    if (info.rdrName !== productId) throw new Error(`${id}: readme is for ${info.rdrName}`);
    citation ??= info.citation;
    const rings = wktRings(row.wkt);
    const g = rasterise(rings);
    const coveredM2 = g.covered * CELL_M * CELL_M;
    const stated = Number(row.coverage);
    // The 200 m sampling must reproduce the area of the published polygon. (The table's own
    // "coverage" figure is up to 3 % larger than its polygon for the simpler outlines; both are recorded.)
    const exact = wktArea(row.wkt);
    if (Math.abs(coveredM2 - exact) / exact > 0.01) throw new Error(`${id}: sampled coverage ${coveredM2} m2 against the polygon's ${exact} m2`);
    if (Math.abs(exact - stated) / stated > 0.04) throw new Error(`${id}: polygon area ${exact} m2 against the table's ${stated} m2`);
    const outline = wktRings(row.mbr_wkt);
    if (outline.length !== 1) throw new Error(`${id}: expected one bounding ring`);
    const center = { lat: +Number(row.center_latitude).toFixed(4), lon: +wrap(Number(row.center_longitude)).toFixed(4) };
    // The stated centre must fall on the grid, which pins down the axes of the outline tables.
    const c = toXY(pole, center.lat, center.lon);
    if (!(c.x >= g.left && c.x <= g.left + g.cols * CELL_M && c.y <= g.top && c.y >= g.top - g.rows * CELL_M)) throw new Error(`${id}: stated centre is off its own footprint grid`);
    const suffix = productId.slice(`shadowcam_cmosaic_${id}_`.length).split('_'); // e.g. p896s1350, summer, 11am
    // Where the outline table and the product's readme disagree, say so instead of picking silently.
    const disagreements = [];
    if (info.pixelScale && Math.abs(parseFloat(info.pixelScale) - Number(row.pixel_scale)) > 0.06) disagreements.push(`pixel scale: outline table ${Number(row.pixel_scale)} m, product readme ${info.pixelScale}`);
    if (info.images && Number(info.images) !== Number(row.num_images)) disagreements.push(`number of images: outline table ${row.num_images}, product readme ${info.images}`);
    // The table's title names a month ("... Monthly Mosaic February 2023"); the readme dates the images.
    const named = row.pds_comment.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? (20\d\d)\b/);
    if (named && info.imageStart && info.imageStop) {
      const monthOf = (day) => `${new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${day.slice(0, 4)}`;
      const title = `${named[1]} ${named[2]}`;
      if (title !== monthOf(info.imageStart) && title !== monthOf(info.imageStop)) disagreements.push(`month of the images: the outline table's title says ${named[0]}, the product readme dates them ${info.imageStart.slice(0, 10)} to ${info.imageStop.slice(0, 10)}`);
    }
    const cogUrl = `${row.product_link}${productId}_20m_cog.tif`;
    const cogBytes = await head(cogUrl);
    mosaics.push({
      id, productId,
      lid: `urn:nasa:pds:kplo-shadowcam:derived-cmosaic:${productId}`,
      title: row.pds_comment, site: info.siteName, pole, version: Number(row.version),
      center,
      season: row.season, localTime: suffix[2], avgTimeOfDay: row.avg_time_of_day,
      avgSubsolar: { lat: +Number(row.avg_subsolar_lat).toFixed(3), lon: +wrap(Number(row.avg_subsolar_lon)).toFixed(3) },
      imageStart: info.imageStart?.slice(0, 10) ?? null, imageStop: info.imageStop?.slice(0, 10) ?? null,
      images: Number(row.num_images), pixelScaleM: Number(row.pixel_scale),
      ...(disagreements.length ? { sourceDisagreements: disagreements } : {}),
      psr: info.psr, referenceDtm: info.mapProjDtm,
      // The latitude/longitude box the authors trimmed the mosaic to (longitude 0..360 east, as published).
      trim: { minLat: Number(row.trim_min_lat), maxLat: Number(row.trim_max_lat), minLon: Number(row.trim_min_lon), maxLon: Number(row.trim_max_lon) },
      statedCoverageKm2: +(stated / 1e6).toFixed(1), footprintKm2: +(exact / 1e6).toFixed(1), sampledCoverageKm2: +(coveredM2 / 1e6).toFixed(1),
      productUrl: row.product_link, readmeUrl: `${row.product_link}${productId}_readme.txt`,
      preview20m: cogBytes === null ? null : { url: cogUrl, bytes: cogBytes, format: 'Cloud-Optimized GeoTIFF, 20 m per pixel' },
      // The authors' "minimum bounding region": a loose outline for drawing. Polar stereographic metres, x then y.
      outline: Array.from(outline[0], (v) => Math.round(v)),
      coverage: { grid: grids.length, left: g.left, top: g.top, cols: g.cols, rows: g.rows },
    });
    grids.push({ dtype: 'uint8', encoding: 'plane-delta', width: g.cols, height: g.rows, mosaic: id, pole, left: g.left, top: g.top, cellM: CELL_M });
    arrays.push(g.mask);
    console.log(`  ${id.padEnd(34)} ${String(g.cols).padStart(4)} x ${String(g.rows).padEnd(4)} cells  ${(coveredM2 / 1e6).toFixed(1).padStart(7)} km2 (polygon ${(exact / 1e6).toFixed(1)}, table ${(stated / 1e6).toFixed(1)})  ${rings.length} rings  ${info.imageStart?.slice(0, 10)}..${info.imageStop?.slice(0, 10)}  20 m preview ${cogBytes === null ? 'missing' : `${(cogBytes / 1e6).toFixed(1)} MB`}`);
  }
}

const packed = gzipSync(encodeLxg({ format: 'lunyx-grid/1', id: 'shadowcam-coverage', cellM: CELL_M, grids }, arrays), { level: 9, memLevel: 9 });
const back = (await decodeLxg(packed)).arrays;
arrays.forEach((a, k) => { for (let i = 0; i < a.length; i++) if (back[k][i] !== a[i]) throw new Error(`coverage grid ${k}: read-back differs`); });
await writeFile(join(OUT, 'shadowcam_coverage.lxg'), packed);

const index = {
  format: 'lunyx-shadowcam-index/1',
  title: 'ShadowCam controlled mosaics of permanently shadowed regions: where they are and where to get them',
  what: 'An index only. No ShadowCam imagery is bundled with the app: each entry links to the product in the ShadowCam PDS archive. ShadowCam (on the Korean orbiter Danuri) images permanently shadowed ground by light reflected from nearby sunlit terrain; in these mosaics sunlit ground is saturated.',
  archive: { name: 'KPLO ShadowCam Data Archive (PDS4 bundle)', doi: '10.17189/y89z-kt98', url: `${ARCHIVE}/`, author: 'ShadowCam SOC', portal: 'https://data.im-ldi.com/' },
  release: tableNote,
  credit: 'NASA/KARI/Arizona State University',
  creditNote: 'Credit line as the ShadowCam site prints it under its images up to mid-2025; posts from 2026 print "NASA/KARI/Intuitive Machines". The archive itself names no credit line.',
  licence: 'No licence or usage statement was found in the archive (bundle label, archive SIS, product readmes; checked 2026-11-14). It is a public NASA PDS archive. For that reason Lunyx links to the products and bundles none of the imagery.',
  citation: [
    citation,
    'Outlines: Collins, W. M., Grieser, S. A., Henriksen, M. R., Clark, J. D., Carr, N. F., Wagner, R. V., Roseborough, T. A., Nystrom, S. E., & Robinson, M. S. (2026). Photogrammetric Processing of Regional ShadowCam and LROC NAC Controlled Mosaics, Evaluation of Positional Accuracies, and Scientific Applications. Remote Sensing, 18(3), 525. https://doi.org/10.3390/rs18030525',
    'Archive: ShadowCam SOC (2026). KPLO ShadowCam Data Archive. NASA Planetary Data System. https://doi.org/10.17189/y89z-kt98',
  ],
  seasonDefinition: 'As the product readmes define it: summer when the subsolar latitude is more than 1 degree into that pole\'s hemisphere, winter when it is more than 1 degree into the other; spring and autumn ("fall") in between. Local time is for the mosaic centre and rounded to the hour; near the pole it changes quickly with longitude.',
  projection: 'Outlines and coverage grids are in polar stereographic metres on a sphere of 1737.4 km, true scale at the pole: x = r sin(lon), y = r cos(lon) at the south pole and -r cos(lon) at the north pole, r = 2 R tan(colatitude / 2).',
  coverage: {
    file: 'shadowcam_coverage.lxg', bytes: packed.length, sha256: createHash('sha256').update(packed).digest('hex'), cellM: CELL_M,
    rule: `One grid per mosaic. A ${CELL_M} m cell is 1 when its centre lies inside the footprint published in the archive's outline table (which follows the valid pixels, gaps and all). Cell (col, row) spans x from left + col * ${CELL_M} and y down from top - row * ${CELL_M}. Within ${CELL_M} m of an edge the answer can be off: open the product to be sure.`,
  },
  mosaics,
};
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
const indexBytes = (await stat(join(OUT, 'index.json'))).size;
console.log(`  ${mosaics.length} mosaics; index.json ${(indexBytes / 1024).toFixed(0)} kB, shadowcam_coverage.lxg ${(packed.length / 1024).toFixed(0)} kB`);
