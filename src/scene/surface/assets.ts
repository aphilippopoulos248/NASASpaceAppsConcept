// Textures and shapes of the surface scene that are built or loaded in the browser: photo
// exposure, photo-derived relief, and the GENERATED (not measured) detail: rocks, craters a
// few metres across, and the close-up surface maps.
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, IcosahedronGeometry, RepeatWrapping, TextureLoader, Vector3, type Texture } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seededRandom, type DetailMap } from './ground';

/**
 * Brightness multiplier that brings an image's average tone to mid-grey, so dark mare and
 * bright highlands both read well. Null when the image cannot serve as the ground's tone:
 * when a tenth or more of it never loaded (those parts would be drawn black), or when it is
 * too dark, as the orbital mosaics near the poles are (mostly shadow, which would paint real
 * ground black whatever the Sun is doing).
 */
export function exposureFor(image: HTMLCanvasElement): number | null {
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
  if (count < 0.9 * (px.length / 4)) return null;
  const gain = 0.2 / (sum / count);
  return gain > 5 ? null : Math.max(0.8, gain);
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

// ---------- generated detail (not real): everything finer than the orbital data can show ----------
// Many small rocks share a few light meshes; the rare boulders, which you can walk up to, get detailed ones.
export const SMALL_ROCK_SHAPES = 3;
export const SMALL_ROCKS_EACH = 260;
export const BOULDER_SHAPES = 2;
export const BOULDERS_EACH = 40;
export const BOULDER_SIZE_M = 0.25;
export const ROCK_CELL_M = 4;
export const ROCK_REACH_M = 46;

/** Repeatable pseudo-random number in [0, 1) for a grid cell. */
export function cellHash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Height of a field of generated craters, one candidate per grid cell. Sizes run from about
 * a quarter to nearly a full cell; most are old and shallow, a few fresh and sharp, and no
 * rim is a perfect circle.
 */
export function craterField(east: number, north: number, cell: number, salt: number): number {
  const ix = Math.floor(east / cell), iy = Math.floor(north / cell);
  let h = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const pick = cellHash(cx, cy, salt);
      if (pick > 0.55) continue;
      const px = (cx + 0.5 + (cellHash(cx, cy, salt + 1) - 0.5) * 0.5) * cell;
      const py = (cy + 0.5 + (cellHash(cx, cy, salt + 2) - 0.5) * 0.5) * cell;
      const ox = east - px, oy = north - py;
      const angle = Math.atan2(oy, ox), phase = pick * 40;
      const radius = cell * (0.14 + 0.3 * cellHash(cx, cy, salt + 3)) * (1 + 0.1 * Math.sin(2 * angle + phase) + 0.06 * Math.sin(5 * angle + phase * 2.3));
      const rho = Math.hypot(ox, oy) / radius;
      if (rho >= 2.6) continue;
      const fresh = cellHash(cx, cy, salt + 4) ** 2;
      const depth = 2 * radius * (0.04 + 0.14 * fresh), rim = depth * (0.1 + 0.2 * fresh);
      // Bowl inside, raised rim, apron of ejecta dying away outside.
      h += rho < 1 ? -depth * (1 - rho * rho) + rim * rho * rho : rim * Math.exp(-3.2 * (rho - 1));
    }
  }
  return h;
}

/** A rock: a subdivided sphere pushed around by layered noise, then chipped along a few flat fracture planes. */
export function rockGeometry(seed: number, subdivisions: number): BufferGeometry {
  const base = new IcosahedronGeometry(1, subdivisions);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const geo = mergeVertices(base);
  const rand = seededRandom(`rock${seed}`);
  // 3D value noise on a hashed lattice.
  const lattice = (x: number, y: number, z: number) => cellHash(x + seed * 131, y, z * 7 + 3);
  const noise = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const fade = (t: number) => t * t * (3 - 2 * t);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const mix = (a: number, b: number, t: number) => a + (b - a) * t;
    return mix(
      mix(mix(lattice(xi, yi, zi), lattice(xi + 1, yi, zi), u), mix(lattice(xi, yi + 1, zi), lattice(xi + 1, yi + 1, zi), u), v),
      mix(mix(lattice(xi, yi, zi + 1), lattice(xi + 1, yi, zi + 1), u), mix(lattice(xi, yi + 1, zi + 1), lattice(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
  // Fracture planes: anything beyond one is sliced flat, giving the angular faces of broken rock.
  const planes = Array.from({ length: 5 + Math.floor(rand() * 4) }, () => {
    const n = new Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    return { n, d: 0.62 + rand() * 0.3 };
  });
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const big = noise(v.x * 1.4 + 5, v.y * 1.4 + 5, v.z * 1.4 + 5);
    const ridged = 1 - Math.abs(2 * noise(v.x * 3 + 9, v.y * 3 + 9, v.z * 3 + 9) - 1);
    const fine = noise(v.x * 8 + 2, v.y * 8 + 2, v.z * 8 + 2);
    const grit = noise(v.x * 19 + 4, v.y * 19 + 4, v.z * 19 + 4);
    let r = 0.78 + 0.42 * (big - 0.5) * 2 * 0.5 + 0.16 * ridged + 0.09 * (fine - 0.5) + 0.035 * (grit - 0.5);
    for (const p of planes) {
      const along = v.dot(p.n) * r;
      if (along > p.d) r *= p.d / along;
    }
    v.multiplyScalar(r);
    pos.setXYZ(i, v.x, v.y * 0.72, v.z);
    // Slightly darker in hollows and lighter on exposed faces.
    const shade = 0.72 + 0.2 * fine + 0.16 * (r - 0.78);
    colors.set([shade, shade, shade], i * 3);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// Artist-made close-up surface maps (craters of roughly 0.1-2.5 m and fine texture). They are not
// lunar measurements: they only shade the ground near the viewer, as part of the generated detail,
// and never move the terrain. Loaded the first time the surface view is used.
export const DETAIL_TILE_M = 12;
export const detailMaps = { normal: { value: null as Texture | null }, tone: { value: null as Texture | null }, ready: { value: 0 } };
/** 0 with the light on the horizon, 1 with it overhead: tone matters more as shading fades. */
export const lightHeight = { value: 0 };
let detailRequested = false;
export function requestDetailMaps(anisotropy: number): void {
  if (detailRequested) return;
  detailRequested = true;
  const loader = new TextureLoader();
  const prepare = (t: Texture) => {
    // Made seamless by scripts/make-surface-detail.mjs, so they simply repeat.
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = anisotropy;
    return t;
  };
  Promise.all([
    loader.loadAsync(`${import.meta.env.BASE_URL}textures/surface_detail_normal.jpg`),
    loader.loadAsync(`${import.meta.env.BASE_URL}textures/surface_detail_tone.jpg`),
  ]).then(
    ([normal, tone]) => {
      detailMaps.normal.value = prepare(normal);
      detailMaps.tone.value = prepare(tone);
      detailMaps.ready.value = 1;
    },
    (err) => console.warn('Close-up surface maps unavailable; using computed craters instead', err),
  );
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
