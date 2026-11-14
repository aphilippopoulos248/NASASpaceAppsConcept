import {
  AdditiveBlending,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Quaternion,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
} from 'three';
import type { MoonGeometry, Vec3 } from '../astro/ephemeris';
import { Landing, programColor } from '../data/landings';
import { createStars } from './globe';
import { CONTEXT_LAYER, createTileMosaic, DETAIL_LAYER, ImageryLayer, TileMosaic } from './sitePatch';
import type { LightMode } from './sky';

// Ground-level view of a landing site. Local frame, in metres:
// +X east, +Y up, +Z south (so north is -Z); the landing point is the origin.

const DEG = Math.PI / 180;
const EYE_HEIGHT = 1.7;
// Walking pace, m/s. Where only the ~60 m terrain model exists a true walking pace would look frozen, so it is faster there.
const WALK_SPEED_FINE = 1.5;
const WALK_SPEED_COARSE = 5;
const FAST_FACTOR = 8;
const MAX_LIFT = 500;
const SKY_DISTANCE = 300000;
const EARTH_RADIUS_KM = 6371;

interface TerrainIndex {
  radius: number;
  size: number;
  levels: { name: string; spacing: number }[];
  sites: Record<string, { source: string; height: number; fine?: { size: number; spacing: number; ortho: string | null; source: string; detail?: { file: string; size: number; range: number; agreement: number } } }>;
}

/** A square height grid centred on the landing point; x east, y north. Heights in metres above the reference sphere. */
interface Grid {
  n: number;
  spacing: number;
  data: Float32Array;
}
const halfExtent = (g: Grid) => ((g.n - 1) / 2) * g.spacing;

/** Small deterministic random generator, so a site's procedural detail is the same on every visit. */
function seededRandom(text: string): () => number {
  let a = 2166136261;
  for (let i = 0; i < text.length; i++) a = Math.imul(a ^ text.charCodeAt(i), 16777619);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Procedural stand-in for sites with no high-resolution survey.
const PROC_N = 513;
const PROC_SPACING = 3;
/** Craters per square metre larger than D metres, about D^-2: roughly the equilibrium density of old lunar surfaces. */
const CRATER_DENSITY = 0.03;
const CRATER_MIN = 7;
const CRATER_MAX = 220;

/** Brightness multiplier that brings an image's average tone to mid-grey, so dark mare and bright highlands both read well. */
function exposureFor(image: HTMLCanvasElement): number {
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

/** Relief finer than the elevation model, derived from photo shading (see scripts/derive-detail.mjs). Row 0 is north. */
interface DetailMap {
  size: number;
  /** Half the width of the square it covers, metres. */
  half: number;
  heights: Float32Array;
}

async function loadDetail(url: string, size: number, range: number, half: number): Promise<DetailMap> {
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
function detailNormalMap(d: DetailMap): CanvasTexture {
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
const MICRO_TILE_M = 12;
const MICRO_PX = 1024;
const MAX_ROCKS = 600;
const ROCK_CELL_M = 4;
const ROCK_REACH_M = 46;

let microTexture: CanvasTexture | null = null;

/** Tiling normal map of centimetre-to-metre craters and lumps, built once from fixed random numbers. */
function microNormalMap(): CanvasTexture {
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
function rockGeometry(): IcosahedronGeometry {
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

/**
 * Smooth (bicubic) magnification for the ground photo. Plain bilinear filtering shows the
 * photo's pixel grid as blocky diamonds when one pixel covers a large part of the screen.
 */
function useSmoothMagnification(material: MeshStandardMaterial, mapSize: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMapSize = mapSize;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float uMapSize;
vec4 smoothMap( sampler2D tex, vec2 uv ) {
	vec2 st = uv * uMapSize - 0.5;
	vec2 f = fract( st ), i = floor( st );
	// Cubic B-spline weights, folded into four bilinear taps.
	vec2 w0 = ( 1.0 - f ) * ( 1.0 - f ) * ( 1.0 - f ) / 6.0;
	vec2 w1 = ( 4.0 - 6.0 * f * f + 3.0 * f * f * f ) / 6.0;
	vec2 w3 = f * f * f / 6.0;
	vec2 w2 = 1.0 - w0 - w1 - w3;
	vec2 g0 = w0 + w1, g1 = w2 + w3;
	vec2 h0 = ( i - 0.5 + w1 / g0 ) / uMapSize, h1 = ( i + 1.5 + w3 / g1 ) / uMapSize;
	return ( texture2D( tex, vec2( h0.x, h0.y ) ) * g0.x + texture2D( tex, vec2( h1.x, h0.y ) ) * g1.x ) * g0.y
		+ ( texture2D( tex, vec2( h0.x, h1.y ) ) * g0.x + texture2D( tex, vec2( h1.x, h1.y ) ) * g1.x ) * g1.y;
}
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#ifdef USE_MAP
	// Only when magnified; minified ground keeps normal mip-mapped filtering.
	float texelsPerPixel = max( length( dFdx( vMapUv ) ), length( dFdy( vMapUv ) ) ) * uMapSize;
	vec4 sampledDiffuseColor = mix( smoothMap( map, vMapUv ), texture2D( map, vMapUv ), smoothstep( 0.4, 1.0, texelsPerPixel ) );
	diffuseColor *= sampledDiffuseColor;
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'ground-smooth-magnify';
}

// Dense ground mesh that follows the viewer, so nearby relief is real geometry.
const NEAR_N = 257;
const NEAR_SPACING = 0.5; // metres -> 128 m across
const NEAR_SNAP = 4; // re-centre in steps of this many metres, so vertices never slide over the ground

/** What to drape over a terrain mesh: map tiles looked up by lat/lon, or one image covering the grid exactly. */
type Drape = { layer: ImageryLayer } | { image: string };

let indexPromise: Promise<TerrainIndex> | null = null;
const terrainUrl = (file: string) => `${import.meta.env.BASE_URL}terrain/${file}`;
function loadIndex(): Promise<TerrainIndex> {
  indexPromise ??= fetch(terrainUrl('index.json')).then((r) => {
    if (!r.ok) throw new Error(`terrain index: HTTP ${r.status}`);
    return r.json();
  });
  return indexPromise;
}

/** Tiling grey noise, used as fine surface grain that the elevation data cannot resolve. */
function grainTexture(): CanvasTexture {
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

function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,252,240,1)');
  g.addColorStop(0.25, 'rgba(255,230,180,0.25)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

export interface SurfaceInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  rise: number; // -1..1, raises or lowers the viewpoint
  fast: boolean;
}

export class SurfaceView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(70, 1, 0.3, 500000);
  /** Compass heading the camera faces, degrees clockwise from north. */
  heading = 0;
  /** Height of the viewpoint above head height, metres (0 = standing on the ground). */
  lift = 0;
  private pitch = 0;

  private readonly ambient = new AmbientLight(0xffffff, 0.1);
  private readonly sun = new DirectionalLight(0xffffff, 3.2);
  private readonly sunGlow: Sprite;
  private readonly earth: Mesh;
  private readonly terrain = new Group();
  private mosaics: TileMosaic[] = [];
  private mode: LightMode = 'real';
  private readonly sunDirection = new Vector3(0, 1, 0);
  private readonly rocks: InstancedMesh;
  private readonly mapSize = { value: 1024 };
  private siteId = '';
  /** Whether generated (not real) detail is shown: rocks and sub-metre texture. */
  generated = true;

  // Terrain model of the current site.
  private radius = 1737400;
  private siteHeight = 0;
  /** Finest first. */
  private grids: Grid[] = [];
  /** Data sources for the current site, for display. */
  sources: string[] = [];
  /** Whether the ground near the landing point is surveyed or generated. */
  detail: 'measured' | 'procedural' = 'procedural';
  private east: Vec3 = [0, 1, 0];
  private north: Vec3 = [0, 0, 1];
  private up: Vec3 = [1, 0, 0];
  private loadToken = 0;
  private detailMap: DetailMap | null = null;
  private near: Mesh | null = null;
  private nearCentre = { east: NaN, north: NaN };
  /** Square cut out of the fine mesh where the near mesh takes over: x, z, half-size (scene units). */
  private readonly hole = { value: new Vector3(0, 0, 0) };

  constructor(private readonly anisotropy: number) {
    this.camera.rotation.order = 'YXZ';

    const stars = createStars(2500);
    stars.scale.setScalar(SKY_DISTANCE / 500);
    stars.frustumCulled = false;

    this.sunGlow = new Sprite(
      new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false, toneMapped: false }),
    );
    this.sunGlow.scale.setScalar(0.22);

    const earthMaterial = new MeshStandardMaterial({ color: 0x2a4f8f, roughness: 0.9, metalness: 0 });
    new TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth_2k.jpg`, (t) => {
      t.colorSpace = SRGBColorSpace;
      earthMaterial.map = t;
      earthMaterial.color.set(0xffffff);
      earthMaterial.needsUpdate = true;
    });
    this.earth = new Mesh(new SphereGeometry(1, 64, 32), earthMaterial);

    this.rocks = new InstancedMesh(rockGeometry(), new MeshStandardMaterial({ color: 0x555555, roughness: 1, metalness: 0, flatShading: true }), MAX_ROCKS);
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = this.rocks.receiveShadow = true;

    // Shadows for the ground around the viewer only.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 1400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;

    this.scene.add(this.ambient, this.sun, this.sun.target, stars, this.sunGlow, this.earth, this.terrain, this.rocks);
  }

  /** Loads the terrain and imagery for a site. Resolves when the ground is ready to stand on. */
  async load(landing: Landing): Promise<void> {
    const token = ++this.loadToken;
    this.siteId = landing.id;
    const getBinary = (file: string) =>
      fetch(terrainUrl(file)).then((r) => {
        if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      });
    const index = await loadIndex();
    const info = index.sites[landing.id];
    if (!info) throw new Error(`no terrain for ${landing.id}`);
    const [buffer, fineBuffer] = await Promise.all([
      getBinary(`${landing.id}.bin`),
      info.fine ? getBinary(`${landing.id}_fine.bin`).catch(() => null) : null,
    ]);
    if (token !== this.loadToken) return;
    const detailInfo = info.fine?.detail;
    const detailMap =
      fineBuffer && detailInfo
        ? await loadDetail(terrainUrl(detailInfo.file), detailInfo.size, detailInfo.range, ((info.fine!.size - 1) / 2) * info.fine!.spacing).catch(() => null)
        : null;
    if (token !== this.loadToken) return;
    this.clearTerrain();
    this.detailMap = detailMap;

    const n = index.size;
    const all = new Float32Array(buffer);
    this.radius = index.radius;
    const [inner, outer]: Grid[] = index.levels.map((l, i) => ({ n, spacing: l.spacing, data: all.subarray(i * n * n, (i + 1) * n * n) }));
    const measured: Grid | null = info.fine && fineBuffer ? { n: info.fine.size, spacing: info.fine.spacing, data: new Float32Array(fineBuffer) } : null;
    this.detail = measured ? 'measured' : 'procedural';
    // No survey here: generate plausible small-scale relief on top of the real 60 m terrain.
    const fine: Grid = measured ?? this.proceduralGrid(landing.id, inner);
    this.grids = [fine, inner, outer];
    this.sources = measured ? [info.fine!.source, info.source] : [info.source];
    // Ease each grid onto the next coarser one at its edge, coarsest pair first.
    for (let k = this.grids.length - 2; k >= 0; k--) this.blendEdge(this.grids[k], this.grids[k + 1]);
    const finest = this.grids[0];
    this.siteHeight = finest.data[((finest.n - 1) / 2) * finest.n + (finest.n - 1) / 2];

    // Local east / north / up axes in the Moon-fixed frame, for placing the Sun and Earth in this sky.
    const la = landing.lat * DEG, lo = landing.lon * DEG;
    this.east = [-Math.sin(lo), Math.cos(lo), 0];
    this.north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    this.up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];

    const drape: Drape = measured && info.fine!.ortho ? { image: terrainUrl(info.fine!.ortho) } : { layer: DETAIL_LAYER };
    // Sub-metre grain underfoot is procedural everywhere: no orbital photo resolves it.
    const fineMesh = this.buildMesh(landing, fine, drape, 0, 1.5);
    this.terrain.add(fineMesh);
    this.addNearMesh(fineMesh.material as MeshStandardMaterial, detailMap, 'image' in drape);
    this.terrain.add(this.buildMesh(landing, inner, { layer: DETAIL_LAYER }, halfExtent(fine), 0));
    this.terrain.add(this.buildMesh(landing, outer, { layer: CONTEXT_LAYER }, halfExtent(inner), 0));
    this.terrain.add(this.buildBeacon(landing));

    // Start a short walk south of the landing point, facing it.
    this.camera.position.set(0, 0, 45);
    this.heading = 0;
    this.pitch = 0;
    this.lift = 0;
    this.camera.fov = 70;
    this.camera.updateProjectionMatrix();
    this.step(0, { forward: 0, strafe: 0, rise: 0, fast: false });
  }

  /** Near its edge, ease the fine grid onto the coarse one so the two meshes meet without a step. */
  private blendEdge(inner: Grid, outer: Grid) {
    const n = inner.n, c = (n - 1) / 2, band = Math.max(10, Math.round(n / 12));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const fromEdge = Math.min(i, j, n - 1 - i, n - 1 - j);
        if (fromEdge >= band) continue;
        const t = 1 - fromEdge / band;
        const coarse = this.sampleGrid(outer, (i - c) * inner.spacing, (j - c) * inner.spacing);
        inner.data[j * n + i] += (coarse - inner.data[j * n + i]) * t * t * (3 - 2 * t);
      }
    }
  }

  /**
   * Generated fine grid: the real coarse terrain, smoothly interpolated, plus craters and
   * gentle undulation that the 60 m model cannot resolve. The craters are invented.
   */
  private proceduralGrid(seed: string, coarse: Grid): Grid {
    const n = PROC_N, sp = PROC_SPACING, c = (n - 1) / 2, half = c * sp;
    const rand = seededRandom(seed);
    const data = new Float32Array(n * n);
    const detail = new Float32Array(n * n);

    // Craters: sizes follow a D^-2 cumulative law, most of them old and shallow.
    const area = (2 * half) ** 2;
    const count = Math.round((CRATER_DENSITY * area) / CRATER_MIN ** 2);
    for (let k = 0; k < count; k++) {
      const d = Math.min(CRATER_MAX, CRATER_MIN / Math.sqrt(1 - rand()));
      const r = d / 2;
      const cx = (rand() * 2 - 1) * half, cy = (rand() * 2 - 1) * half;
      const fresh = rand() ** 3; // 0 = worn almost flat, 1 = sharp
      const depth = d * (0.025 + 0.16 * fresh);
      const rim = depth * 0.22;
      const reach = r * 2.2;
      const i0 = Math.max(0, Math.floor((cx - reach) / sp + c)), i1 = Math.min(n - 1, Math.ceil((cx + reach) / sp + c));
      const j0 = Math.max(0, Math.floor((cy - reach) / sp + c)), j1 = Math.min(n - 1, Math.ceil((cy + reach) / sp + c));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const rho = Math.hypot((i - c) * sp - cx, (j - c) * sp - cy) / r;
          if (rho >= 2.2) continue;
          // Bowl inside the rim, raised rim falling away outside it.
          detail[j * n + i] += rho < 1 ? -depth * (1 - rho * rho) + rim * rho * rho : rim * (1 - (rho - 1) / 1.2) ** 2;
        }
      }
    }

    // Gentle undulation at a few scales.
    for (let cells = 6, amp = 1.6; cells <= 48; cells *= 2, amp *= 0.5) {
      const lattice = new Float32Array((cells + 1) * (cells + 1)).map(() => rand() * 2 - 1);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const fx = (i / (n - 1)) * cells, fy = (j / (n - 1)) * cells;
          const x = Math.min(cells - 1, Math.floor(fx)), y = Math.min(cells - 1, Math.floor(fy));
          const tx = fx - x, ty = fy - y, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
          const row = cells + 1;
          const top = lattice[y * row + x] * (1 - sx) + lattice[y * row + x + 1] * sx;
          const bot = lattice[(y + 1) * row + x] * (1 - sx) + lattice[(y + 1) * row + x + 1] * sx;
          detail[j * n + i] += (top * (1 - sy) + bot * sy) * amp;
        }
      }
    }

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        data[j * n + i] = this.sampleSmooth(coarse, (i - c) * sp, (j - c) * sp) + detail[j * n + i];
      }
    }
    return { n, spacing: sp, data };
  }

  /** Catmull-Rom interpolation, so upsampled coarse terrain has no creases at cell edges. */
  private sampleSmooth(grid: Grid, east: number, north: number): number {
    const n = grid.n, c = (n - 1) / 2;
    const fx = Math.min(n - 2.001, Math.max(1, east / grid.spacing + c));
    const fy = Math.min(n - 2.001, Math.max(1, north / grid.spacing + c));
    const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
    const cubic = (p0: number, p1: number, p2: number, p3: number, t: number) =>
      p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (yy: number) => {
      const o = yy * n + x;
      return cubic(grid.data[o - 1], grid.data[o], grid.data[o + 1], grid.data[o + 2], tx);
    };
    return cubic(row(y - 1), row(y), row(y + 1), row(y + 2), ty);
  }

  private sampleGrid(grid: Grid, east: number, north: number): number {
    const n = grid.n, c = (n - 1) / 2;
    const fx = Math.min(n - 1.001, Math.max(0, east / grid.spacing + c));
    const fy = Math.min(n - 1.001, Math.max(0, north / grid.spacing + c));
    const x = Math.floor(fx), y = Math.floor(fy), a = fx - x, b = fy - y;
    const d = grid.data;
    return (1 - b) * ((1 - a) * d[y * n + x] + a * d[y * n + x + 1]) + b * ((1 - a) * d[(y + 1) * n + x] + a * d[(y + 1) * n + x + 1]);
  }

  /** Height above the sphere at a local east/north offset, metres. */
  private heightAt(east: number, north: number): number {
    const grid = this.gridAt(east, north);
    if (grid === this.grids[0]) return this.sampleSmooth(grid, east, north) + this.detailAt(east, north);
    return this.sampleGrid(grid, east, north);
  }

  /** Photo-derived fine relief at a point, metres; zero where there is none. */
  private detailAt(east: number, north: number): number {
    const d = this.detailMap;
    if (!d) return 0;
    const fx = ((east + d.half) / (2 * d.half)) * (d.size - 1);
    const fy = ((d.half - north) / (2 * d.half)) * (d.size - 1);
    if (fx < 0 || fy < 0 || fx >= d.size - 1 || fy >= d.size - 1) return 0;
    const x = Math.floor(fx), y = Math.floor(fy), a = fx - x, b = fy - y, h = d.heights, n = d.size;
    const v = (1 - b) * ((1 - a) * h[y * n + x] + a * h[y * n + x + 1]) + b * ((1 - a) * h[(y + 1) * n + x] + a * h[(y + 1) * n + x + 1]);
    // Ease out towards the edge of the surveyed square.
    return v * Math.min(1, (d.half - Math.max(Math.abs(east), Math.abs(north))) / 40);
  }

  /** Sets up the dense mesh that follows the viewer, and the matching cut-out in the fine mesh. */
  private addNearMesh(fineMaterial: MeshStandardMaterial, detail: DetailMap | null, hasPhoto: boolean): void {
    if (detail) {
      // Beyond the near mesh the photo-derived relief is shown as shading only.
      const normals = detailNormalMap(detail);
      normals.anisotropy = this.anisotropy;
      fineMaterial.normalMap = normals;
    }
    fineMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uHole = this.hole;
      shader.vertexShader = 'varying vec2 vGroundXZ;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGroundXZ = position.xz;');
      shader.fragmentShader =
        'uniform vec3 uHole;\nvarying vec2 vGroundXZ;\n' +
        shader.fragmentShader.replace('void main() {', 'void main() {\n\tif ( uHole.z > 0.0 && abs( vGroundXZ.x - uHole.x ) < uHole.z && abs( vGroundXZ.y - uHole.y ) < uHole.z ) discard;');
    };
    fineMaterial.customProgramCacheKey = () => 'ground-with-hole';

    const n = NEAR_N;
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setIndex(idx);
    // Drawn slightly in front where it overlaps the fine mesh at its rim.
    const material = new MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    // Generated sub-metre relief (not real), as shading.
    const micro = microNormalMap();
    micro.anisotropy = this.anisotropy;
    micro.repeat.setScalar((2 * halfExtent(this.grids[0])) / MICRO_TILE_M);
    material.normalMap = micro;
    material.normalScale.setScalar(this.generated ? 1 : 0);
    if (hasPhoto) {
      useSmoothMagnification(material, this.mapSize);
      // Share the photo once the fine mesh has it.
      fineMaterial.userData.onMap = () => {
        material.map = fineMaterial.map;
        this.mapSize.value = (fineMaterial.map!.image as HTMLImageElement).width;
        material.color.copy(fineMaterial.color);
        material.needsUpdate = true;
      };
      if (fineMaterial.map) fineMaterial.userData.onMap();
    } else {
      // No photo here: the 20 m imagery is one flat tone at this scale, so use the exposed mid-grey directly.
      material.color.setScalar(0.2);
    }
    this.near = new Mesh(geo, material);
    this.near.castShadow = this.near.receiveShadow = true;
    this.near.frustumCulled = false;
    this.near.visible = false;
    this.nearCentre = { east: NaN, north: NaN };
    this.terrain.add(this.near);
  }

  /** Keeps the dense mesh centred near the viewer. */
  private updateNear(east: number, north: number): void {
    const near = this.near, fine = this.grids[0];
    if (!near || !fine) return;
    const reach = ((NEAR_N - 1) / 2) * NEAR_SPACING;
    if (Math.max(Math.abs(east), Math.abs(north)) > halfExtent(fine) - reach - 8) {
      near.visible = false;
      this.hole.value.z = 0;
      this.rocks.count = 0;
      return;
    }
    const ce = Math.round(east / NEAR_SNAP) * NEAR_SNAP, cn = Math.round(north / NEAR_SNAP) * NEAR_SNAP;
    if (near.visible && ce === this.nearCentre.east && cn === this.nearCentre.north) return;
    this.nearCentre = { east: ce, north: cn };

    const n = NEAR_N, c = (n - 1) / 2, span = 2 * halfExtent(fine);
    const pos = near.geometry.getAttribute('position') as Float32BufferAttribute;
    const uv = near.geometry.getAttribute('uv') as Float32BufferAttribute;
    const p = new Vector3();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const e = ce + (i - c) * NEAR_SPACING, nn = cn + (j - c) * NEAR_SPACING;
        // At its rim the mesh settles onto the fine mesh's own surface, so the two join without a step.
        const rim = Math.min(1, (Math.min(i, j, n - 1 - i, n - 1 - j) * NEAR_SPACING) / 12);
        const blend = rim * rim * (3 - 2 * rim);
        const flat = this.sampleGrid(fine, e, nn);
        const h = flat + (this.sampleSmooth(fine, e, nn) + this.detailAt(e, nn) - flat) * blend;
        this.groundPoint(e, nn, h, p);
        pos.setXYZ(j * n + i, p.x, p.y, p.z);
        uv.setXY(j * n + i, (e + span / 2) / span, (nn + span / 2) / span);
      }
    }
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    near.geometry.computeVertexNormals();
    near.visible = true;
    this.hole.value.set(ce, -cn, reach - 1.5);
    this.scatterRocks(ce, cn);
  }

  /** Generated rocks (not real) around a point. The same cell always gets the same rocks. */
  private scatterRocks(ce: number, cn: number): void {
    const q = new Quaternion(), scale = new Vector3(), p = new Vector3(), m = new Matrix4(), euler = new Euler();
    let count = 0;
    const cells = Math.ceil(ROCK_REACH_M / ROCK_CELL_M);
    const c0e = Math.round(ce / ROCK_CELL_M), c0n = Math.round(cn / ROCK_CELL_M);
    for (let j = -cells; j <= cells && count < MAX_ROCKS; j++) {
      for (let i = -cells; i <= cells && count < MAX_ROCKS; i++) {
        const rand = seededRandom(`${this.siteId}:${c0e + i}:${c0n + j}`);
        // About one rock per 30 square metres, mostly fist-sized, with the occasional boulder.
        const n = rand() < 0.42 ? 1 : rand() < 0.1 ? 2 : 0;
        for (let k = 0; k < n && count < MAX_ROCKS; k++) {
          const e = (c0e + i + rand() - 0.5) * ROCK_CELL_M, nn = (c0n + j + rand() - 0.5) * ROCK_CELL_M;
          const size = Math.min(0.9, 0.06 / Math.sqrt(1 - rand()));
          if (Math.hypot(e - ce, nn - cn) > ROCK_REACH_M) continue;
          this.groundPoint(e, nn, this.heightAt(e, nn), p);
          p.y += size * 0.2; // partly buried
          scale.set(size * (0.7 + rand() * 0.6), size * (0.45 + rand() * 0.4), size * (0.7 + rand() * 0.6));
          q.setFromEuler(euler.set(rand() * 0.6 - 0.3, rand() * Math.PI * 2, rand() * 0.6 - 0.3));
          this.rocks.setMatrixAt(count++, m.compose(p, q, scale));
        }
      }
    }
    this.rocks.count = count;
    this.rocks.instanceMatrix.needsUpdate = true;
    this.rocks.visible = this.generated;
  }

  /** Shows or hides everything generated rather than measured: rocks and sub-metre surface texture. */
  setGenerated(on: boolean): void {
    this.generated = on;
    this.rocks.visible = on;
    if (this.near) {
      const m = this.near.material as MeshStandardMaterial;
      m.normalScale.setScalar(on ? 1 : 0);
      m.bumpScale = on ? 0.15 : 0;
    }
  }

  /** The finest grid that covers a point. */
  private gridAt(east: number, north: number): Grid {
    const reach = Math.max(Math.abs(east), Math.abs(north));
    return this.grids.find((g) => reach <= halfExtent(g)) ?? this.grids[this.grids.length - 1];
  }

  /** Scene position of the ground at a local east/north offset, including the Moon's curvature. */
  private groundPoint(east: number, north: number, h: number, out: Vector3): Vector3 {
    const d = Math.hypot(east, north);
    const theta = d / this.radius;
    const rr = this.radius + h;
    const horiz = d > 0 ? (rr * Math.sin(theta)) / d : 0;
    return out.set(east * horiz, rr * Math.cos(theta) - (this.radius + this.siteHeight), -north * horiz);
  }

  private buildMesh(landing: Landing, grid: Grid, drape: Drape, holeHalf: number, grainMetres: number): Mesh {
    const n = grid.n, c = (n - 1) / 2;
    const mosaic = 'layer' in drape ? createTileMosaic(landing.lat, landing.lon, drape.layer, this.anisotropy) : null;
    if (mosaic) this.mosaics.push(mosaic);

    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const p = new Vector3();
    const la = landing.lat * DEG;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const e = (i - c) * grid.spacing, nn = (j - c) * grid.spacing;
        this.groundPoint(e, nn, grid.data[j * n + i], p).toArray(pos, (j * n + i) * 3);
        if (!mosaic) {
          // The image was resampled onto this very grid, north up.
          uv[(j * n + i) * 2] = i / (n - 1);
          uv[(j * n + i) * 2 + 1] = j / (n - 1);
          continue;
        }
        // Latitude / longitude of this sample (great-circle offset from the site), for the imagery lookup.
        const d = Math.hypot(e, nn) / this.radius;
        const az = Math.atan2(e, nn);
        const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
        const dLon = Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
        uv[(j * n + i) * 2] = (landing.lon + dLon / DEG - mosaic.lonW) / (mosaic.lonE - mosaic.lonW);
        uv[(j * n + i) * 2 + 1] = (lat2 / DEG - mosaic.latS) / (mosaic.latN - mosaic.latS);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        // Leave a hole in the coarse mesh where the fine mesh sits.
        const inHole =
          Math.max(Math.abs(i - c), Math.abs(i + 1 - c)) * grid.spacing <= holeHalf &&
          Math.max(Math.abs(j - c), Math.abs(j + 1 - c)) * grid.spacing <= holeHalf;
        if (inHole) continue;
        const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
        idx.push(a, b, d, a, d, cc);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Until imagery arrives the ground is plain regolith grey.
    const material = new MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0 });
    if (grainMetres > 0) {
      const grain = grainTexture();
      const repeats = ((n - 1) * grid.spacing) / grainMetres;
      // The grain tiles in ground metres, while UVs span the imagery; scale accordingly.
      grain.repeat.set(repeats / Math.abs(uv[(c * n + n - 1) * 2] - uv[(c * n) * 2]), repeats / Math.abs(uv[((n - 1) * n + c) * 2 + 1] - uv[c * 2 + 1]));
      grain.needsUpdate = true;
      grain.anisotropy = this.anisotropy;
      material.bumpMap = grain;
      material.bumpScale = 0.15;
    }
    if (mosaic && 'layer' in drape) {
      mosaic.ready.then((ok) => {
        if (!ok) return;
        material.map = mosaic.texture;
        material.color.setScalar(exposureFor(mosaic.texture.image as HTMLCanvasElement));
        material.needsUpdate = true;
      });
    } else if ('image' in drape) {
      const token = this.loadToken;
      new TextureLoader().load(drape.image, (t) => {
        if (token !== this.loadToken) return t.dispose();
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = this.anisotropy;
        material.map = t;
        material.color.setScalar(1.0);
        material.needsUpdate = true;
        material.userData.onMap?.();
      });
    }
    return new Mesh(geo, material);
  }

  /** A marker at the exact landing coordinates. */
  private buildBeacon(landing: Landing): Group {
    const g = new Group();
    const color = new Color(programColor(landing.program));
    const flat = (opacity: number) => new MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
    // A ring around the spot and a beam above it, leaving the ground at the landing point itself uncovered.
    const seg = 96, pos: number[] = [], idx: number[] = [], p = new Vector3();
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      for (const r of [14, 14.6]) {
        const e = Math.sin(a) * r, nn = Math.cos(a) * r;
        this.groundPoint(e, nn, this.heightAt(e, nn), p);
        pos.push(p.x, p.y + 0.25, p.z);
      }
      if (k < seg) idx.push(k * 2, k * 2 + 1, k * 2 + 3, k * 2, k * 2 + 3, k * 2 + 2);
    }
    const ringGeo = new BufferGeometry();
    ringGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    ringGeo.setIndex(idx);
    const ringMat = flat(0.85);
    ringMat.side = DoubleSide;
    const ring = new Mesh(ringGeo, ringMat);
    const beam = new Mesh(new ConeGeometry(0.3, 600, 8, 1, true), flat(0.3));
    beam.position.y = 325;
    g.add(ring, beam);
    return g;
  }

  private toLocal(v: Vec3, out = new Vector3()): Vector3 {
    const dot = (a: Vec3) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
    return out.set(dot(this.east), dot(this.up), -dot(this.north));
  }

  setMode(mode: LightMode): void {
    this.mode = mode;
  }

  /** Places the Sun and Earth in this site's sky. */
  setSky(g: MoonGeometry): void {
    const sunDir = this.toLocal(g.sunDir);
    this.sunGlow.position.copy(sunDir).multiplyScalar(SKY_DISTANCE);
    this.sunGlow.visible = this.mode === 'real';
    // Exposure, like a camera's: level ground keeps a steady mid-tone whatever the Sun's height,
    // so a low Sun shows up as strong contrast on slopes rather than as a dim scene.
    let sinElevation = 0.8;
    if (this.mode === 'real') {
      this.sunDirection.copy(sunDir);
      sinElevation = Math.max(sunDir.y, 0.08);
      this.sun.visible = sunDir.y > -0.01;
      // Fill light so the ground is still readable in shadow and at night.
      this.ambient.intensity = this.sun.visible ? 0.1 : 0.28;
    } else {
      this.sunDirection.set(0.35, 0.8, 0.5).normalize();
      this.sun.visible = true;
      this.ambient.intensity = 0.3;
    }
    this.sun.intensity = (Math.PI * 0.62) / sinElevation;
    this.sun.castShadow = this.sun.visible;
    this.placeSun();
    // The Earth shares this light, so cancel the exposure boost on it.
    const earthMaterial = this.earth.material as MeshStandardMaterial;
    if (earthMaterial.map) earthMaterial.color.setScalar(3.2 / this.sun.intensity);

    // Earth at its true direction and apparent size, turned to show the right face.
    this.toLocal(g.earthDir, this.earth.position).multiplyScalar(SKY_DISTANCE);
    this.earth.scale.setScalar((SKY_DISTANCE * EARTH_RADIUS_KM) / g.earthDistanceKm);
    const pole = this.toLocal(g.earthPole).normalize();
    const prime = this.toLocal(g.earthPrime);
    prime.addScaledVector(pole, -prime.dot(pole)).normalize();
    this.earth.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(prime, pole, new Vector3().crossVectors(prime, pole)));
  }

  /** The light sits along the Sun's direction from the viewer, so its shadow area follows them. */
  private placeSun(): void {
    const cam = this.camera.position;
    this.sun.target.position.set(cam.x, cam.y - EYE_HEIGHT - this.lift, cam.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirection, 600);
  }

  /** Mouse-look: positive dx turns right, positive dy looks down. */
  look(dx: number, dy: number): void {
    const k = (this.camera.fov / 70) * 0.0028;
    this.heading = (((this.heading + (dx * k) / DEG) % 360) + 360) % 360;
    this.pitch = Math.max(-85, Math.min(85, this.pitch - (dy * k) / DEG));
  }

  zoom(delta: number): void {
    this.camera.fov = Math.max(20, Math.min(90, this.camera.fov * (delta > 0 ? 1.1 : 1 / 1.1)));
    this.camera.updateProjectionMatrix();
  }

  /** Advances walking and keeps the eye at head height above the ground. */
  step(dt: number, input: SurfaceInput): void {
    const cam = this.camera;
    const h = this.heading * DEG;
    const onFine = this.gridAt(cam.position.x, -cam.position.z) === this.grids[0];
    // Rising is slow near the ground and quicker higher up; moving speeds up with height too.
    this.lift = Math.max(0, Math.min(MAX_LIFT, this.lift + input.rise * Math.max(4, this.lift * 0.9) * (input.fast ? 3 : 1) * dt));
    const speed = (onFine ? WALK_SPEED_FINE : WALK_SPEED_COARSE) * (input.fast ? FAST_FACTOR : 1) * (1 + this.lift / 6) * dt;
    // Heading 0 faces north (-Z); 90 faces east (+X).
    cam.position.x += (Math.sin(h) * input.forward + Math.cos(h) * input.strafe) * speed;
    cam.position.z += (-Math.cos(h) * input.forward + Math.sin(h) * input.strafe) * speed;

    if (this.grids.length) {
      // Stay inside the modelled area.
      const limit = halfExtent(this.grids[this.grids.length - 1]) * 0.9;
      cam.position.x = Math.max(-limit, Math.min(limit, cam.position.x));
      cam.position.z = Math.max(-limit, Math.min(limit, cam.position.z));
      const east = cam.position.x, north = -cam.position.z;
      this.updateNear(east, north);
      cam.position.y = this.groundPoint(east, north, this.heightAt(east, north), new Vector3()).y + EYE_HEIGHT + this.lift;
    }
    cam.rotation.set(this.pitch * DEG, -h, 0);
    this.placeSun();
  }

  /** Distance from the landing point, metres. */
  get distanceFromSite(): number {
    return Math.hypot(this.camera.position.x, this.camera.position.z);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private clearTerrain(): void {
    this.near = null;
    this.rocks.count = 0;
    this.detailMap = null;
    this.hole.value.set(0, 0, 0);
    this.terrain.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as MeshStandardMaterial;
      // Tile mosaics dispose their own textures below; single-image drapes are owned by the material.
      if (mat.map && !this.mosaics.some((m) => m.texture === mat.map)) mat.map.dispose();
      mat.bumpMap?.dispose();
      if (mat.normalMap && mat.normalMap !== microTexture) mat.normalMap.dispose();
      mat.dispose();
    });
    for (const m of this.mosaics) m.dispose();
    this.mosaics = [];
    this.terrain.clear();
  }
}
