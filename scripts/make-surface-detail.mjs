// Builds the close-up surface maps used by the landing view from the "moon-surface" asset pack:
//   public/textures/surface_detail_normal.jpg   tiling normal map (2048 px)
//   public/textures/surface_detail_tone.jpg     tiling light/dark variation (1024 px), mean at mid-grey
//
// The source maps do not tile, so they are made seamless here: each is cross-faded, near its edges,
// with a copy of itself shifted by half its size. (Mirroring at each repeat instead would leave a
// visible crease along every tile edge.)
//
// Usage: node scripts/make-surface-detail.mjs <folder containing NormalMap.jpeg and Diffuse.jpeg>
import { join } from 'node:path';
import sharp from 'sharp';

const src = process.argv[2];
if (!src) {
  console.error('usage: node scripts/make-surface-detail.mjs <folder with NormalMap.jpeg and Diffuse.jpeg>');
  process.exit(1);
}

/** Cross-fade weight for the original image: 1 in the middle, 0 at the edges. */
function centreWeight(x, y, size) {
  const d = Math.min(x, y, size - 1 - x, size - 1 - y) / size;
  const t = Math.min(1, d / 0.22);
  return t * t * (3 - 2 * t);
}

async function seamless(file, size, channels) {
  const { data } = await sharp(file).resize(size, size, { kernel: 'lanczos3' }).toColourspace(channels === 1 ? 'b-w' : 'srgb').raw().toBuffer({ resolveWithObject: true });
  const out = new Float32Array(size * size * channels);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const w = centreWeight(x, y, size);
      const a = (y * size + x) * channels;
      const b = (((y + half) % size) * size + ((x + half) % size)) * channels;
      for (let c = 0; c < channels; c++) out[a + c] = data[a + c] * w + data[b + c] * (1 - w);
    }
  }
  return out;
}

const SIZE_N = 2048;
const normal = await seamless(join(src, 'NormalMap.jpeg'), SIZE_N, 3);
// Blending two normals shortens the result; renormalise.
const nBytes = Buffer.alloc(normal.length);
for (let i = 0; i < normal.length; i += 3) {
  let x = normal[i] / 127.5 - 1, y = normal[i + 1] / 127.5 - 1, z = normal[i + 2] / 127.5 - 1;
  const len = Math.hypot(x, y, z) || 1;
  x /= len; y /= len; z /= len;
  nBytes[i] = Math.round((x + 1) * 127.5);
  nBytes[i + 1] = Math.round((y + 1) * 127.5);
  nBytes[i + 2] = Math.round((z + 1) * 127.5);
}
await sharp(nBytes, { raw: { width: SIZE_N, height: SIZE_N, channels: 3 } })
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  .toFile('public/textures/surface_detail_normal.jpg');

const SIZE_T = 1024;
const tone = await seamless(join(src, 'Diffuse.jpeg'), SIZE_T, 1);
let sum = 0;
for (const v of tone) sum += v;
const mean = sum / tone.length;
const tBytes = Buffer.alloc(tone.length);
for (let i = 0; i < tone.length; i++) tBytes[i] = Math.max(0, Math.min(255, Math.round((tone[i] / mean) * 128)));
await sharp(tBytes, { raw: { width: SIZE_T, height: SIZE_T, channels: 1 } }).jpeg({ quality: 86 }).toFile('public/textures/surface_detail_tone.jpg');
console.log('wrote public/textures/surface_detail_normal.jpg and surface_detail_tone.jpg');
