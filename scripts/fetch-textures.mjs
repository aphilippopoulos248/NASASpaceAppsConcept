// Downloads NASA SVS "CGI Moon Kit" maps (https://svs.gsfc.nasa.gov/4720) and
// converts them into web-ready textures in public/textures/.
//
//   colour : LROC WAC global mosaic  -> moon_color_{2k,4k,8k}.jpg
//   relief : LOLA elevation (16 ppd) -> moon_normal_4k.jpg (tangent-space normal map)
//   relief : LOLA elevation (64 ppd) -> moon_normal_8k.webp (sharper, for capable devices)
//   earth  : Blue Marble             -> earth_2k.jpg
//
// Run with: npm run fetch-textures
import { mkdir, writeFile, access, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'scripts', '.cache');
const OUT = join(ROOT, 'public', 'textures');
const BASE = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/';

const MOON_RADIUS_M = 1737400;
// Relief is exaggerated so craters read clearly at globe scale.
const RELIEF_EXAGGERATION = 4;

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function download(name, base = BASE) {
  const dest = join(CACHE, name);
  if (await exists(dest)) return dest;
  console.log(`downloading ${name} ...`);
  const res = await fetch(base + name, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function buildColour() {
  const src = await download('lroc_color_poles_8k.tif');
  for (const [label, width] of [['2k', 2048], ['4k', 4096], ['8k', 8192]]) {
    const out = join(OUT, `moon_color_${label}.jpg`);
    await sharp(src).resize(width, width / 2).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
    console.log(`wrote ${out}`);
  }
}

async function buildNormalMap() {
  // 16-bit unsigned, half-metre units, 5760 x 2880 (16 px per degree).
  const src = await download('ldem_16_uint.tif');
  const W = 4096, H = 2048;
  const { data, info } = await sharp(src)
    .resize(W, H, { kernel: 'lanczos3' })
    .toColourspace('grey16')
    .raw({ depth: 'ushort' })
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const h = new Float32Array(W * H);
  const u16 = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
  for (let i = 0; i < W * H; i++) h[i] = u16[i * ch] * 0.5; // metres

  await writeNormalMap(h, W, H, join(OUT, 'moon_normal_4k.jpg'));
}

/** Turns a W x H grid of heights (metres, equirectangular, north up) into a tangent-space normal map. */
async function writeNormalMap(h, W, H, dest) {
  const out = Buffer.alloc(W * H * 3);
  const metresPerPxLat = (Math.PI * MOON_RADIUS_M) / H;
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    // Clamp near the poles, where east-west pixels shrink to nothing.
    const metresPerPxLon = metresPerPxLat * Math.max(Math.cos(lat), 0.05);
    const yN = Math.max(y - 1, 0), yS = Math.min(y + 1, H - 1);
    for (let x = 0; x < W; x++) {
      const xW = (x - 1 + W) % W, xE = (x + 1) % W;
      const dEast = (h[y * W + xE] - h[y * W + xW]) / (2 * metresPerPxLon);
      const dNorth = (h[yN * W + x] - h[yS * W + x]) / ((yS - yN) * metresPerPxLat);
      let nx = -dEast * RELIEF_EXAGGERATION;
      let ny = -dNorth * RELIEF_EXAGGERATION;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * W + x) * 3;
      out[o] = Math.round((nx * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    }
  }
  const image = sharp(out, { raw: { width: W, height: H, channels: 3 } });
  await (dest.endsWith('.webp') ? image.webp({ quality: 90, smartSubsample: false }) : image.jpeg({ quality: 90, chromaSubsampling: '4:4:4' })).toFile(dest);
  console.log(`wrote ${dest}`);
}

// Sharper relief for the globe, from the LOLA 64 px/degree whole-Moon elevation model
// (https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/, 530 MB download, cached).
async function buildNormalMap8k() {
  const dest = join(OUT, 'moon_normal_8k.webp');
  if (await exists(dest)) return;
  const src = await download('LDEM_64.IMG', 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/');
  const SW = 23040, SH = 11520, W = 8192, H = 4096;
  const sum = new Float32Array(W * H), count = new Uint8Array(W * H);
  const fh = await open(src, 'r');
  const row = Buffer.alloc(SW * 2);
  for (let y = 0; y < SH; y++) {
    await fh.read(row, 0, row.length, y * row.length);
    const oy = Math.min(H - 1, Math.floor((y * H) / SH));
    for (let x = 0; x < SW; x++) {
      // The file starts at longitude 0; our maps are centred on it, so shift by half a turn.
      const ox = Math.floor((((x + SW / 2) % SW) * W) / SW);
      sum[oy * W + ox] += row.readInt16LE(x * 2) * 0.5; // half-metres -> metres
      count[oy * W + ox]++;
    }
  }
  await fh.close();
  for (let i = 0; i < sum.length; i++) sum[i] /= count[i];
  await writeNormalMap(sum, W, H, dest);
}

// NASA Blue Marble (https://svs.gsfc.nasa.gov/2915), for the Earth in the lunar sky.
async function buildEarth() {
  const src = await download('bluemarble-2048.png', 'https://svs.gsfc.nasa.gov/vis/a000000/a002900/a002915/');
  const out = join(OUT, 'earth_2k.jpg');
  await sharp(src).jpeg({ quality: 85, mozjpeg: true }).toFile(out);
  console.log(`wrote ${out}`);
}

await mkdir(CACHE, { recursive: true });
await mkdir(OUT, { recursive: true });
await buildColour();
await buildNormalMap();
await buildNormalMap8k();
await buildEarth();
console.log('done');
