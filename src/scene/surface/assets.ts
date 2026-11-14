// Textures and shapes of the surface scene that are built in the browser: photo exposure,
// photo-derived relief, and the GENERATED (not measured) sub-metre texture and rocks.
import { CanvasTexture, IcosahedronGeometry, RepeatWrapping } from 'three';
import { seededRandom, type DetailMap } from './ground';

/** Brightness multiplier that brings an image's average tone to mid-grey, so dark mare and bright highlands both read well. */
export function exposureFor(image: HTMLCanvasElement): number {
  const probe = document.createElement('canvas');
  probe.width = probe.height = 16;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 16, 16);
  const px = ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0, count = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // tiles that never loaded
    sum += (px[i] / 255) ** 2.2; // approximate sRGB -> linear
    count++;
  }
  if (!count) return 1;
  return Math.max(0.8, Math.min(5, 0.2 / (sum / count)));
}

/** Reads the photo-derived relief image: grey level 128 is zero, +-127 spans `range` metres. */
export async function loadDetail(url: string, size: number, range: number, half: number): Promise<DetailMap> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const heights = new Float32Array(size * size);
  for (let i = 0; i < heights.length; i++) heights[i] = ((px[i * 4] - 128) / 127) * range;
  return { size, half, heights };
}

/** Normal map of the fine relief, for ground too far away to be worth real geometry. */
export function detailNormalMap(d: DetailMap): CanvasTexture {
  const n = d.size, metresPerPx = (2 * d.half) / (n - 1);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    const yN = Math.max(0, y - 1), yS = Math.min(n - 1, y + 1);
    for (let x = 0; x < n; x++) {
      const xW = Math.max(0, x - 1), xE = Math.min(n - 1, x + 1);
      let nx = -(d.heights[y * n + xE] - d.heights[y * n + xW]) / ((xE - xW) * metresPerPx);
      let ny = -(d.heights[yN * n + x] - d.heights[yS * n + x]) / ((yS - yN) * metresPerPx);
      const len = Math.hypot(nx, ny, 1);
      nx /= len; ny /= len;
      const o = (y * n + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (0.5 / len + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new CanvasTexture(canvas);
}

// ---------- generated detail (not real): everything finer than the orbital photos can show ----------
export const MICRO_TILE_M = 12;
const MICRO_PX = 1024;
export const MAX_ROCKS = 600;
export const ROCK_CELL_M = 4;
export const ROCK_REACH_M = 46;

let microTexture: CanvasTexture | null = null;

/** True for the shared sub-metre texture, which must not be disposed with a site. */
export const isSharedTexture = (t: unknown): boolean => t !== null && t === microTexture;

/** Tiling normal map of centimetre-to-metre craters and lumps, built once from fixed random numbers. */
export function microNormalMap(): CanvasTexture {
  if (microTexture) return microTexture;
  const n = MICRO_PX, px = MICRO_TILE_M / n;
  const rand = seededRandom('regolith');
  const h = new Float32Array(n * n);
  // Small craters, same D^-2 size law as the larger generated ones.
  const count = Math.round((0.03 * MICRO_TILE_M * MICRO_TILE_M) / 0.15 ** 2);
  for (let k = 0; k < count; k++) {
    const d = Math.min(3, 0.15 / Math.sqrt(1 - rand()));
    const r = d / 2 / px;
    const cx = rand() * n, cy = rand() * n;
    const depth = d * (0.03 + 0.15 * rand() ** 2), rim = depth * 0.2;
    const reach = Math.ceil(r * 2);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const rho = Math.hypot(dx, dy) / r;
        if (rho >= 2) continue;
        const x = (((Math.round(cx) + dx) % n) + n) % n, y = (((Math.round(cy) + dy) % n) + n) % n; // wraps, so the texture tiles
        h[y * n + x] += rho < 1 ? -depth * (1 - rho * rho) + rim * rho * rho : rim * (2 - rho) ** 2;
      }
    }
  }
  // Lumpy regolith at a few scales.
  for (let cells = 16, amp = 0.02; cells <= 256; cells *= 2, amp *= 0.55) {
    const lattice = new Float32Array(cells * cells).map(() => rand() * 2 - 1);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells, fy = (y / n) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (xx: number, yy: number) => lattice[(yy % cells) * cells + (xx % cells)];
        h[y * n + x] += ((at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx) * (1 - sy) + (at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx) * sy) * amp;
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let nx = -(h[y * n + ((x + 1) % n)] - h[y * n + ((x + n - 1) % n)]) / (2 * px);
      let ny = -(h[((y + n - 1) % n) * n + x] - h[((y + 1) % n) * n + x]) / (2 * px);
      const len = Math.hypot(nx, ny, 1);
      const o = (y * n + x) * 4;
      img.data[o] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[o + 2] = (0.5 / len + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  microTexture = new CanvasTexture(canvas);
  microTexture.wrapS = microTexture.wrapT = RepeatWrapping;
  return microTexture;
}

/** One lumpy rock shape; instances are stretched and turned for variety. */
export function rockGeometry(): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, 1);
  const rand = seededRandom('rock');
  const pos = geo.getAttribute('position');
  const moved = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    // Vertices are duplicated per face; move coincident ones together so the rock stays closed.
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!moved.has(key)) moved.set(key, 0.72 + rand() * 0.5);
    const f = moved.get(key)!;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Tiling grey noise, used as fine surface grain that the elevation data cannot resolve. */
export function grainTexture(): CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const acc = new Float32Array(size * size);
  // Sum of wrapped value-noise octaves.
  for (let cells = 8, amp = 1; cells <= 128; cells *= 2, amp *= 0.6) {
    const lattice = new Float32Array(cells * cells).map(() => Math.random());
    const at = (x: number, y: number) => lattice[(y % cells) * cells + (x % cells)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells, fy = (y / size) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
        const bot = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
        acc[y * size + x] += (top * (1 - sy) + bot * sy) * amp;
      }
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let i = 0; i < acc.length; i++) {
    const v = ((acc[i] - lo) / (hi - lo)) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}
