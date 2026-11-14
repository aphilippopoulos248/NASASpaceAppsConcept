// Builds a small elevation model around every landing site, for the surface view.
//
// Source: NASA PDS Geosciences Node, LRO LOLA archive
//   - SLDEM2015 (LOLA + Kaguya), 512 px/deg (~59 m), latitudes 60S..60N
//   - LOLA polar DEMs (20 m and 60 m polar stereographic) for sites poleward of 60 degrees
// The source files are 1-2 GB each, so only the rows around each site are
// requested (HTTP range requests); nothing large is downloaded.
//
// Output, per site, in public/terrain/:
//   <id>.bin   Float32 heights in metres above the 1737.4 km sphere:
//              an inner grid (fine) followed by an outer grid (coarse)
//   index.json grid sizes and spacings, and for each site the centre (lat, lon) its window was built for
//
// Each grid is square, centred on the site, with x east and y north; a sample
// at (east, north) metres is the point reached by walking that far over the sphere.
//
// Run with: npm run fetch-terrain
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'terrain');
const PDS = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data';
const R = 1737400;
const DEG = Math.PI / 180;

const N = 129; // samples per side
const LEVELS = [
  { name: 'inner', spacing: 60 }, // 7.7 km across
  { name: 'outer', spacing: 480 }, // 61 km across
];

// ---------- range-request plumbing ----------
let active = 0;
const waiting = [];
async function limit(fn) {
  if (active >= 10) await new Promise((r) => waiting.push(r));
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
        return buf;
      } catch (e) {
        if (attempt >= 4) throw new Error(`${url} @${start}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  });
}

// ---------- sources ----------
// Each source maps lat/lon to fractional (line, sample) and can read part of a line as metres.

const SLDEM_BANDS = ['30n_60n', '00n_30n', '30s_00s', '60s_30s'];
const sldem = {
  name: 'SLDEM2015 512 ppd',
  nativeSpacing: (Math.PI * R) / (180 * 512),
  toPixel(lat, lon) {
    const lon360 = ((lon % 360) + 360) % 360;
    return { line: (60 - lat) * 512 - 0.5, sample: lon360 * 512 - 0.5 };
  },
  async readLine(line, s0, count) {
    const band = Math.floor(line / 15360);
    const out = new Float32Array(count);
    // A request may straddle two 45-degree tiles.
    for (let done = 0; done < count; ) {
      const s = s0 + done;
      const tile = Math.floor(s / 23040);
      const n = Math.min(count - done, (tile + 1) * 23040 - s);
      const w = String(tile * 45).padStart(3, '0');
      const e = String(tile * 45 + 45).padStart(3, '0');
      const url = `${PDS}/sldem2015/tiles/float_img/sldem2015_512_${SLDEM_BANDS[band]}_${w}_${e}_float.img`;
      const buf = await range(url, ((line - band * 15360) * 23040 + (s - tile * 23040)) * 4, n * 4);
      for (let i = 0; i < n; i++) out[done + i] = buf.readFloatLE(i * 4) * 1000; // km -> m
      done += n;
    }
    return out;
  },
};

function polar(file, scale, size) {
  const offset = size / 2 - 0.5;
  return {
    name: `LOLA ${file}`,
    nativeSpacing: scale,
    // South polar stereographic, as defined in the LOLA product labels.
    toPixel(lat, lon) {
      const r = 2 * R * Math.tan(((90 + lat) / 2) * DEG);
      return { line: offset - (r * Math.cos(lon * DEG)) / scale, sample: offset + (r * Math.sin(lon * DEG)) / scale };
    },
    async readLine(line, s0, count) {
      const buf = await range(`${PDS}/lola_gdr/polar/img/${file}.img`, (line * size + s0) * 2, count * 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(i * 2) * 0.5;
      return out;
    },
  };
}
const polar80s = polar('ldem_80s_20m', 20, 30400);
const polar60s = polar('ldem_60s_60m', 60, 31040);

function sourceFor(lat) {
  if (lat <= -80.6) return polar80s; // keeps the whole outer grid inside the 80S product
  if (lat <= -61.1) return polar60s;
  if (Math.abs(lat) < 58.9) return sldem;
  throw new Error(`no elevation source configured for latitude ${lat}`);
}

// ---------- geometry ----------
/** Point reached from (lat, lon) after going `east` and `north` metres over the sphere. */
function offsetPoint(lat, lon, east, north) {
  const d = Math.hypot(east, north) / R;
  if (d === 0) return { lat, lon };
  const az = Math.atan2(east, north);
  const la = lat * DEG;
  const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
  const lon2 = lon * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
  return { lat: lat2 / DEG, lon: lon2 / DEG };
}

async function buildGrid(site, spacing, src) {
  const half = (N - 1) / 2;
  const px = new Array(N * N);
  let minL = Infinity, maxL = -Infinity, minS = Infinity, maxS = -Infinity;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const p = offsetPoint(site.lat, site.lon, (i - half) * spacing, (j - half) * spacing);
      const q = src.toPixel(p.lat, p.lon);
      px[j * N + i] = q;
      minL = Math.min(minL, q.line); maxL = Math.max(maxL, q.line);
      minS = Math.min(minS, q.sample); maxS = Math.max(maxS, q.sample);
    }
  }
  // Read every `step`-th source line and sample: enough for this grid's spacing.
  const step = Math.max(1, Math.round(spacing / src.nativeSpacing / 1.05));
  const l0 = Math.floor(minL) - step, s0 = Math.floor(minS) - step;
  const nl = Math.ceil((maxL - l0) / step) + 2;
  const ns = Math.ceil((maxS - s0) / step) + 2;
  const rows = await Promise.all(
    Array.from({ length: nl }, (_, k) => src.readLine(l0 + k * step, s0, (ns - 1) * step + 1)),
  );
  const at = (k, m) => rows[k][m * step];
  const out = new Float32Array(N * N);
  for (let n = 0; n < N * N; n++) {
    const fl = (px[n].line - l0) / step, fs = (px[n].sample - s0) / step;
    const k = Math.floor(fl), m = Math.floor(fs), a = fl - k, b = fs - m;
    out[n] = (1 - a) * ((1 - b) * at(k, m) + b * at(k, m + 1)) + a * ((1 - b) * at(k + 1, m) + b * at(k + 1, m + 1));
  }
  return out;
}

// ---------- main ----------
const exists = (p) => access(p).then(() => true, () => false);
const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));
await mkdir(OUT, { recursive: true });

// Keep what later steps added to an existing index (the "fine" entries of fetch-apollo-terrain).
const previous = (await exists(join(OUT, 'index.json'))) ? JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8')).sites ?? {} : {};
const index = { radius: R, size: N, levels: LEVELS, sites: {} };
for (const site of landings) {
  const dest = join(OUT, `${site.id}.bin`);
  const src = sourceFor(site.lat);
  let data;
  if (await exists(dest)) {
    const b = await readFile(dest);
    data = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  } else {
    const grids = [];
    for (const level of LEVELS) grids.push(await buildGrid(site, level.spacing, src));
    data = new Float32Array(N * N * LEVELS.length);
    grids.forEach((g, i) => data.set(g, i * N * N));
    await writeFile(dest, Buffer.from(data.buffer));
  }
  const centre = data[((N - 1) / 2) * N + (N - 1) / 2];
  let lo = Infinity, hi = -Infinity;
  for (const v of data) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  // lat/lon record the centre this window was built for (the loaders place the grid from them).
  index.sites[site.id] = { ...previous[site.id], lat: site.lat, lon: site.lon, source: src.name, height: Math.round(centre) };
  console.log(`${site.id.padEnd(14)} site ${centre.toFixed(0).padStart(6)} m   range ${lo.toFixed(0)} .. ${hi.toFixed(0)} m   (${src.name})`);
}
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log('done');
