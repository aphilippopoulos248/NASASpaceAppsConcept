// High-resolution terrain and imagery around the six Apollo landing sites, for the surface view.
//
// Source: LROC NAC digital terrain models and orthophotos (NASA/GSFC/Arizona State University),
// from the PDS archive. Typically 2 m per pixel elevation and 0.5 m per pixel imagery.
// The source files run to hundreds of megabytes, so only the rows around each
// landing point are requested.
//
// Output, per site, in public/terrain/:
//   <id>_fine.bin    Float32 heights (metres above the 1737.4 km sphere), FINE_N x FINE_N,
//                    on the same east/north grid convention as fetch-terrain.mjs
//   <id>_ortho.webp  orthophoto resampled onto that same square, north up
// and a "fine" entry for the site in index.json.
//
// Run fetch-terrain first, then: npm run fetch-apollo-terrain
import { readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'terrain');
const STORE = 'https://pds.mcp.nasa.gov/data/store/img';
const DIR = 'lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM';
const R = 1737400;
const DEG = Math.PI / 180;

const FINE_N = 513; // height samples per side
const FINE_SPACING = 3; // metres -> 1536 m across
const ORTHO_PX = 3072; // 0.5 m per pixel over the same square

// Which archive products lie near which landing site (see nac-dtm-candidates.json).
const CANDIDATES = JSON.parse(await readFile(join(ROOT, 'scripts/nac-dtm-candidates.json'), 'utf8')).sites;
// Skip an orthophoto if reading the rows around the site would mean downloading more than this.
const MAX_ORTHO_BYTES = 170e6;

// ---------- HTTP ----------
let active = 0;
const waiting = [];
async function limit(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}
async function range(url, start, length) {
  return limit(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${start}-${start + length - 1}` } });
        if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length !== length) throw new Error(`short read ${buf.length}/${length}`);
        await new Promise((r) => setTimeout(r, 250)); // stay well under the archive's rate limit
        return buf;
      } catch (e) {
        if (attempt >= 4) throw new Error(`${url} @${start}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
  });
}
async function listFolder(folder) {
  let xml = '';
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${STORE}?delimiter=/&prefix=${DIR}/${folder}/`);
    if (res.ok) { xml = await res.text(); break; }
    // The archive answers 429 when it has seen too many requests; wait and try again.
    if (attempt >= 6) throw new Error(`${folder}: listing failed with HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 20000));
  }
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1].split('/').pop());
}

// ---------- PDS image with an attached label ----------
async function openImage(folder, file) {
  const url = `${STORE}/${DIR}/${folder}/${file}`;
  const label = (await range(url, 0, 6000)).toString('latin1');
  const num = (key) => {
    const m = label.match(new RegExp(`(?:^|\\s)${key}\\s*=\\s*(-?[0-9.]+(?:[eE][-+]?[0-9]+)?)`, 'm'));
    if (!m) throw new Error(`${file}: label has no ${key}`);
    return Number(m[1]);
  };
  const img = {
    url, file,
    recordBytes: num('RECORD_BYTES'),
    lines: num('LINES'),
    samples: num('LINE_SAMPLES'),
    bits: num('SAMPLE_BITS'),
    scale: num('MAP_SCALE'),
    lat0: num('CENTER_LATITUDE'),
    lon0: num('CENTER_LONGITUDE'),
    l0: num('LINE_PROJECTION_OFFSET'),
    s0: num('SAMPLE_PROJECTION_OFFSET'),
  };
  // Only equirectangular products are handled; anything else (polar stereographic) reports no coverage.
  const supported = /MAP_PROJECTION_TYPE\s*=\s*"?EQUIRECTANGULAR/.test(label);
  img.dataStart = img.recordBytes * (num('\\^IMAGE') - 1);
  img.bytes = img.bits / 8;
  // Equirectangular: x scales with cos(centre latitude); longitudes are measured from the centre longitude.
  img.toPixel = (lat, lon) => {
    if (!supported) return { line: -1, sample: -1 };
    let dLon = lon - img.lon0;
    dLon -= 360 * Math.round(dLon / 360);
    return {
      line: img.l0 - (R * lat * DEG) / img.scale,
      sample: img.s0 + (R * dLon * DEG * Math.cos(img.lat0 * DEG)) / img.scale,
    };
  };
  return img;
}

/** Reads a rectangular window as Float32 (NaN where the product has no data). */
async function readWindow(img, line0, lineCount, sample0, sampleCount) {
  const rowBytes = img.samples * img.bytes;
  const out = new Float32Array(lineCount * sampleCount);
  const decode = (buf, bufOffset, row) => {
    for (let i = 0; i < sampleCount; i++) {
      const o = bufOffset + i * img.bytes;
      let v;
      if (img.bits === 32) { v = buf.readFloatLE(o); if (v < -1e30) v = NaN; }
      else { v = buf.readInt16LE(o); if (v <= -32752) v = NaN; }
      out[row * sampleCount + i] = v;
    }
  };
  // Whole rows in a few large requests, one after another: thousands of small
  // per-row requests get rate-limited by the archive.
  const rowsPerChunk = Math.max(1, Math.floor(32e6 / rowBytes));
  for (let r0 = 0; r0 < lineCount; r0 += rowsPerChunk) {
    const rows = Math.min(rowsPerChunk, lineCount - r0);
    const buf = await range(img.url, img.dataStart + (line0 + r0) * rowBytes, rows * rowBytes);
    for (let r = 0; r < rows; r++) decode(buf, r * rowBytes + sample0 * img.bytes, r0 + r);
  }
  return out;
}

function offsetPoint(lat, lon, east, north) {
  const d = Math.hypot(east, north) / R;
  if (d === 0) return { lat, lon };
  const az = Math.atan2(east, north);
  const la = lat * DEG;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
  const lon2 = lon * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return { lat: lat2 / DEG, lon: lon2 / DEG };
}

/** Resamples an image onto an n x n east/north grid centred on the site. Row 0 is `firstNorth` metres north. */
async function resample(img, site, n, spacing, northUp) {
  const half = ((n - 1) / 2) * spacing;
  const px = new Float64Array(n * n * 2);
  let minL = Infinity, maxL = -Infinity, minS = Infinity, maxS = -Infinity;
  for (let j = 0; j < n; j++) {
    const north = northUp ? half - j * spacing : j * spacing - half;
    for (let i = 0; i < n; i++) {
      const p = offsetPoint(site.lat, site.lon, i * spacing - half, north);
      const q = img.toPixel(p.lat, p.lon);
      px[(j * n + i) * 2] = q.line;
      px[(j * n + i) * 2 + 1] = q.sample;
      minL = Math.min(minL, q.line); maxL = Math.max(maxL, q.line);
      minS = Math.min(minS, q.sample); maxS = Math.max(maxS, q.sample);
    }
  }
  const l0 = Math.max(0, Math.floor(minL)), l1 = Math.min(img.lines - 1, Math.ceil(maxL) + 1);
  const s0 = Math.max(0, Math.floor(minS)), s1 = Math.min(img.samples - 1, Math.ceil(maxS) + 1);
  const out = new Float32Array(n * n).fill(NaN);
  if (l1 <= l0 || s1 <= s0) return out;
  const w = s1 - s0 + 1, h = l1 - l0 + 1;
  const src = await readWindow(img, l0, h, s0, w);
  for (let k = 0; k < n * n; k++) {
    const fl = px[k * 2] - l0, fs = px[k * 2 + 1] - s0;
    const y = Math.floor(fl), x = Math.floor(fs);
    if (y < 0 || x < 0 || y >= h - 1 || x >= w - 1) continue;
    const a = fl - y, b = fs - x;
    out[k] = (1 - a) * ((1 - b) * src[y * w + x] + b * src[y * w + x + 1]) + a * ((1 - b) * src[(y + 1) * w + x] + b * src[(y + 1) * w + x + 1]);
  }
  return out;
}

// ---------- main ----------
const exists = (p) => access(p).then(() => true, () => false);
const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));
const indexPath = join(OUT, 'index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
const N = index.size;

for (const [id, candidates] of Object.entries(CANDIDATES)) {
  const site = landings.find((l) => l.id === id);
  const finePath = join(OUT, `${id}_fine.bin`);
  const orthoPath = join(OUT, `${id}_ortho.webp`);
  if (index.sites[id].fine && (await exists(finePath))) {
    console.log(`${id}: already built`);
    continue;
  }

  // ----- elevation: the nearest product that really covers the landing point -----
  let folder = null, files = [], dtmFile = null, dtm = null, fine = null;
  for (const cand of candidates) {
    const img = await openImage(cand.folder, cand.dtm);
    const c = img.toPixel(site.lat, site.lon);
    if (c.line < 0 || c.sample < 0 || c.line >= img.lines || c.sample >= img.samples) continue;
    const grid = await resample(img, site, FINE_N, FINE_SPACING, false);
    let ok = 0;
    for (const v of grid) if (!Number.isNaN(v)) ok++;
    if (ok < grid.length * 0.5) continue;
    folder = cand.folder; dtmFile = cand.dtm; dtm = img; fine = grid;
    // Orthophotos from this product first, then from the neighbouring ones.
    files = [cand, ...candidates.filter((c) => c !== cand)].flatMap((c) => c.orthos.map((f) => ({ folder: c.folder, f })));
    break;
  }
  if (!fine) {
    console.log(`${id}: no product covers the landing point`);
    continue;
  }

  // The 60 m model already in use around this site, to tie the two height datums together.
  const coarseBuf = await readFile(join(OUT, `${id}.bin`));
  const coarse = new Float32Array(coarseBuf.buffer, coarseBuf.byteOffset, N * N);
  const coarseSpacing = index.levels[0].spacing;
  const coarseAt = (east, north) => {
    const fx = east / coarseSpacing + (N - 1) / 2, fy = north / coarseSpacing + (N - 1) / 2;
    const x = Math.floor(fx), y = Math.floor(fy), a = fx - x, b = fy - y;
    return (1 - b) * ((1 - a) * coarse[y * N + x] + a * coarse[y * N + x + 1]) + b * ((1 - a) * coarse[(y + 1) * N + x] + a * coarse[(y + 1) * N + x + 1]);
  };
  const half = ((FINE_N - 1) / 2) * FINE_SPACING;
  let sum = 0, valid = 0;
  for (let j = 0; j < FINE_N; j++) for (let i = 0; i < FINE_N; i++) {
    const v = fine[j * FINE_N + i];
    if (Number.isNaN(v)) continue;
    sum += v - coarseAt(i * FINE_SPACING - half, j * FINE_SPACING - half);
    valid++;
  }
  const datumShift = sum / valid;
  for (let j = 0; j < FINE_N; j++) for (let i = 0; i < FINE_N; i++) {
    const k = j * FINE_N + i;
    // Shift onto the coarse model's datum; where the fine model has gaps, fall back to the coarse one.
    fine[k] = Number.isNaN(fine[k]) ? coarseAt(i * FINE_SPACING - half, j * FINE_SPACING - half) : fine[k] - datumShift;
  }
  await writeFile(finePath, Buffer.from(fine.buffer));

  // ----- orthophoto: finest scale available that actually covers the landing point -----
  const orthos = files
    .map((o) => ({ ...o, m: o.f.match(/_M\d+[A-Z]*_(\d+)(CM|M)\.IMG$/) }))
    .filter((o) => o.m)
    .map((o) => ({ folder: o.folder, file: o.f, metres: Number(o.m[1]) * (o.m[2] === 'CM' ? 0.01 : 1) }))
    .sort((a, b) => a.metres - b.metres);
  let ortho = null, orthoImg = null, coverage = 0;
  let orthoPx = ORTHO_PX;
  for (const cand of orthos) {
    const img = await openImage(cand.folder, cand.file);
    const c = img.toPixel(site.lat, site.lon);
    if (c.line < 0 || c.sample < 0 || c.line >= img.lines || c.sample >= img.samples) continue;
    // Whole rows have to be read, so a very wide image costs a lot; fall back to a coarser one.
    if (((2 * half) / img.scale) * img.samples * img.bytes > MAX_ORTHO_BYTES) continue;
    const px = Math.min(ORTHO_PX, Math.round((2 * half) / img.scale) + 1);
    const data = await resample(img, site, px, (2 * half) / (px - 1), true);
    let ok = 0;
    for (const v of data) if (!Number.isNaN(v)) ok++;
    if (ok / data.length > coverage) { ortho = data; orthoImg = cand; coverage = ok / data.length; orthoPx = px; }
    if (coverage > 0.97) break;
  }
  let orthoFile = null;
  if (ortho && coverage > 0.3) {
    // Contrast stretch between the 0.5th and 99.8th percentiles; gaps get the average tone.
    const sample = [];
    for (let k = 0; k < ortho.length; k += 97) if (!Number.isNaN(ortho[k])) sample.push(ortho[k]);
    sample.sort((a, b) => a - b);
    const lo = sample[Math.floor(sample.length * 0.005)], hi = sample[Math.floor(sample.length * 0.998)];
    const mean = sample[Math.floor(sample.length / 2)];
    const bytes = Buffer.alloc(ortho.length);
    for (let k = 0; k < ortho.length; k++) {
      const v = Number.isNaN(ortho[k]) ? mean : ortho[k];
      bytes[k] = Math.max(0, Math.min(255, Math.round(((v - lo) / (hi - lo)) * 235 + 12)));
    }
    await sharp(bytes, { raw: { width: orthoPx, height: orthoPx, channels: 1 } }).webp({ quality: 82 }).toFile(orthoPath);
    orthoFile = `${id}_ortho.webp`;
  }

  index.sites[id].fine = {
    size: FINE_N,
    spacing: FINE_SPACING,
    ortho: orthoFile,
    source: `LROC NAC DTM ${dtmFile} (${dtm.scale.toFixed(1)} m)` + (orthoImg ? `, orthophoto ${orthoImg.file} (${orthoImg.metres} m)` : ''),
  };
  await writeFile(indexPath, JSON.stringify(index, null, 1) + '\n');
  const centre = fine[((FINE_N - 1) / 2) * FINE_N + (FINE_N - 1) / 2];
  console.log(
    `${id.padEnd(10)} DTM ${dtm.scale.toFixed(1)} m, ${((valid / FINE_N / FINE_N) * 100).toFixed(0)}% cover, datum shift ${datumShift.toFixed(1)} m, site ${centre.toFixed(0)} m | ortho ${orthoImg ? `${orthoImg.file} ${(coverage * 100).toFixed(0)}% cover` : 'none'}`,
  );
}
console.log('done');
