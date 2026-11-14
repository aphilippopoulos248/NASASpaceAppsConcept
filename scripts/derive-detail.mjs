// Recovers relief finer than the elevation models can resolve, from the shading
// in the orbital photos (photoclinometry, or "shape from shading").
//
// A slope facing the Sun is brighter than level ground and one facing away is
// darker, so brightness along the Sun's direction is a measure of slope. Given
// where the Sun was when each photo was taken (from the photo's timestamp and
// our own ephemeris), integrating that slope gives height. Only the fine part
// is kept (features under roughly 20 m); everything larger stays with the
// stereo elevation model, which is more trustworthy.
//
// The result is calibrated against the elevation model in the size range both
// can see, and thrown away if the two do not agree. Limits: brightness changes
// caused by surface material rather than slope are read as relief, and cast
// shadows flatten whatever lies inside them.
//
// Output, per site: public/terrain/<id>_detail.webp (heights, 1 m per pixel)
// and a "detail" entry in index.json.
//
// Run after fetch-apollo-terrain: npm run derive-detail
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createServer } from 'vite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'terrain');
const STORE = 'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM';
const DEG = Math.PI / 180;

const SIZE = 1536; // output pixels per side (the fine terrain square is 1536 m, so 1 m per pixel)
const LEAK_M = 8; // integration memory, metres: keeps features up to a few times this size
const KEEP_BELOW_M = 6; // box radius of the low-pass that is subtracted, metres
const MIN_AGREEMENT = 0.2; // correlation with the elevation model below which the result is rejected

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { moonGeometry } = await vite.ssrLoadModule('/src/astro/ephemeris.ts');
await vite.close();

/** Three box blurs: close to a Gaussian, and fast. Edges are clamped. */
function blur(src, w, h, radius) {
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let pass = 0; pass < 3; pass++) {
    for (const [len, lines, stride, lineStride] of [[w, h, 1, w], [h, w, w, 1]]) {
      for (let l = 0; l < lines; l++) {
        const base = l * lineStride;
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += a[base + Math.min(len - 1, Math.max(0, k)) * stride];
        for (let i = 0; i < len; i++) {
          b[base + i * stride] = sum / (2 * r + 1);
          sum += a[base + Math.min(len - 1, i + r + 1) * stride] - a[base + Math.max(0, i - r) * stride];
        }
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

const index = JSON.parse(await readFile(join(OUT, 'index.json'), 'utf8'));
const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));
const candidates = JSON.parse(await readFile(join(ROOT, 'scripts/nac-dtm-candidates.json'), 'utf8')).sites;

for (const site of landings) {
  const fine = index.sites[site.id].fine;
  if (!fine?.ortho) continue;
  const id = site.id;

  // When was the photo taken? (Read once from the product label, then remembered.)
  if (!fine.orthoTime) {
    const file = fine.source.match(/orthophoto (\S+\.IMG)/)[1];
    const folder = candidates[id].find((c) => c.orthos.includes(file)).folder;
    const res = await fetch(`${STORE}/${folder}/${file}`, { headers: { Range: 'bytes=0-4999' } });
    if (res.status !== 206) throw new Error(`${file}: HTTP ${res.status}`);
    fine.orthoTime = (await res.text()).match(/START_TIME\s*=\s*(\S+)/)[1] + 'Z';
    await new Promise((r) => setTimeout(r, 400));
  }

  // Where was the Sun in this site's sky at that moment?
  const [sx, sy, sz] = moonGeometry(new Date(fine.orthoTime)).sunDir;
  const la = site.lat * DEG, lo = site.lon * DEG;
  const east = -Math.sin(lo) * sx + Math.cos(lo) * sy;
  const north = -Math.sin(la) * Math.cos(lo) * sx - Math.sin(la) * Math.sin(lo) * sy + Math.cos(la) * sz;
  const up = Math.cos(la) * Math.cos(lo) * sx + Math.cos(la) * Math.sin(lo) * sy + Math.sin(la) * sz;
  const azimuth = Math.atan2(east, north), elevation = Math.asin(up);
  if (elevation < 3 * DEG) {
    console.log(`${id}: Sun below or at the horizon for this photo (${(elevation / DEG).toFixed(1)}°), skipped`);
    continue;
  }

  // Photo at 1 m per pixel, as brightness relative to its surroundings.
  const metres = (fine.size - 1) * fine.spacing;
  const px = metres / (SIZE - 1);
  const raw = await sharp(join(OUT, fine.ortho)).resize(SIZE, SIZE, { kernel: 'lanczos3' }).greyscale().raw().toBuffer();
  const img = Float32Array.from(raw);
  const local = blur(img, SIZE, SIZE, 30 / px);
  // Brighter than surroundings = tilted towards the Sun = ground falling away in the Sun's direction.
  const slope = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < slope.length; i++) slope[i] = -Math.max(-0.8, Math.min(0.8, img[i] / Math.max(local[i], 1) - 1));

  // Integrate the slope along the Sun's direction, from both sides, with a fading memory.
  const ux = Math.sin(azimuth), uy = -Math.cos(azimuth); // image x is east, image y is south
  const steps = Math.ceil((4 * LEAK_M) / px);
  const weights = Array.from({ length: steps }, (_, k) => Math.exp((-(k + 0.5) * px) / LEAK_M) * px);
  const at = (x, y) => slope[Math.min(SIZE - 1, Math.max(0, Math.round(y))) * SIZE + Math.min(SIZE - 1, Math.max(0, Math.round(x)))];
  let height = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let h = 0;
      for (let k = 0; k < steps; k++) {
        const t = k + 0.5;
        h += (at(x - t * ux, y - t * uy) - at(x + t * ux, y + t * uy)) * weights[k];
      }
      height[y * SIZE + x] = h / 2;
    }
  }
  height = blur(height, SIZE, SIZE, 1); // knock down streaks along the Sun direction

  // Calibrate against the stereo elevation model in the band both resolve (~12-40 m features).
  const n = fine.size;
  const dtmBuf = await readFile(join(OUT, `${id}_fine.bin`));
  const dtm = new Float32Array(dtmBuf.buffer, dtmBuf.byteOffset, n * n);
  const coarse = new Float32Array(n * n); // photo-derived heights on the elevation grid (row 0 = south)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = (i / (n - 1)) * (SIZE - 1), cy = (1 - j / (n - 1)) * (SIZE - 1);
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = Math.round(cx + dx), Y = Math.round(cy + dy);
        if (X >= 0 && Y >= 0 && X < SIZE && Y < SIZE) { s += height[Y * SIZE + X]; c++; }
      }
      coarse[j * n + i] = s / c;
    }
  }
  const band = (g) => {
    const lo = blur(g, n, n, 4), hi = blur(g, n, n, 1);
    return hi.map((v, i) => v - lo[i]);
  };
  const a = band(coarse), b = band(dtm);
  let aa = 0, bb = 0, ab = 0;
  for (let j = 20; j < n - 20; j++) for (let i = 20; i < n - 20; i++) {
    const k = j * n + i;
    aa += a[k] * a[k]; bb += b[k] * b[k]; ab += a[k] * b[k];
  }
  const agreement = ab / Math.sqrt(aa * bb), gain = ab / aa;
  if (!(agreement > MIN_AGREEMENT)) {
    delete fine.detail;
    console.log(`${id.padEnd(13)} Sun az ${(azimuth / DEG).toFixed(0)}° el ${(elevation / DEG).toFixed(0)}°, agreement ${agreement.toFixed(2)}: too low, no detail kept`);
    continue;
  }

  // Keep only what is finer than the elevation model, in metres.
  const smooth = blur(height, SIZE, SIZE, KEEP_BELOW_M / px);
  let sq = 0;
  for (let i = 0; i < height.length; i++) {
    height[i] = (height[i] - smooth[i]) * gain;
    sq += height[i] * height[i];
  }
  const rms = Math.sqrt(sq / height.length);
  const range = Math.max(0.3, 4 * rms);
  const bytes = Buffer.alloc(height.length);
  for (let i = 0; i < height.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round((height[i] / range) * 127 + 128)));
  await sharp(bytes, { raw: { width: SIZE, height: SIZE, channels: 1 } }).webp({ lossless: true }).toFile(join(OUT, `${id}_detail.webp`));

  fine.detail = {
    file: `${id}_detail.webp`,
    size: SIZE,
    range: Number(range.toFixed(3)),
    agreement: Number(agreement.toFixed(2)),
    sunAzimuth: Number((azimuth / DEG).toFixed(1)),
    sunElevation: Number((elevation / DEG).toFixed(1)),
  };
  console.log(`${id.padEnd(13)} Sun az ${(azimuth / DEG).toFixed(0)}° el ${(elevation / DEG).toFixed(0)}°, agreement ${agreement.toFixed(2)}, gain ${gain.toFixed(2)}, detail rms ${(rms * 100).toFixed(0)} cm`);
}
await writeFile(join(OUT, 'index.json'), JSON.stringify(index, null, 1) + '\n');
console.log('done');
