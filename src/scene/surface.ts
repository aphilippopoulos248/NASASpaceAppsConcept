import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Scene,
  TextureLoader,
  Vector3,
  type MeshLambertMaterial,
  type WebGLRenderer,
} from 'three';
import { skyAt } from '../analysis/api';
import { moonGeometry, type MoonGeometry, type Vec3 } from '../astro/ephemeris';
import type { LightMode } from '../core/types';
import { detailNormalMap, exposureFor, grainTexture, isSharedTexture, loadDetail, MAX_ROCKS, MICRO_TILE_M, microNormalMap, ROCK_CELL_M, ROCK_REACH_M, rockGeometry } from './surface/assets';
import { blendEdge, decimate, generatedRelief, Ground, halfExtent, offsetLatLon, sampleGrid, sampleSmooth, seededRandom, upsample, type Grid } from './surface/ground';
import { describeGround, FINE_LEVEL, loadGround, type GroundBand, type SiteLike } from './surface/groundSource';
import { groundMaterial } from './surface/materials';
import { createField, litAt, sweepSunlight, type SweepField } from './surface/shadowSweep';
import { EarthGlobe, SunDisc } from './surface/skyBodies';
import { azElToScene, DEG, discAreaAbove, discCoveredFraction, niceStepH, sceneToAzEl, wrapAz } from './surface/skyMath';
import { SkyPaths } from './surface/skyPaths';
import { CONTEXT_LAYER, createTileMosaic, DETAIL_LAYER, type ImageryLayer, type TileMosaic } from './sitePatch';

// Ground-level view of a site. Local frame, in metres:
// +X east, +Y up, +Z south (so north is -Z); the site is the origin.
//
// What is measured and what is not:
//   - Terrain comes from elevation products (see surface/groundSource.ts); `ground` says
//     which product stands behind each distance band. Nothing large is invented.
//   - Sun and Earth directions are computed for the site and the instant (topocentric,
//     airless) and drawn at their true angular sizes; Earth's phase and facing are computed.
//   - Shadows are cast by the terrain as drawn, for the Sun's real direction and disc size.
//   - GENERATED, labelled and switchable: rocks, sub-metre texture and, where no survey
//     exists, small craters and bumps within about 770 m.

const WALK_SPEED_FINE = 1.5; // m/s; a true walking pace
const WALK_SPEED_COARSE = 5; // where only a coarse model exists a walking pace would look frozen
const FAST_FACTOR = 8;
const MAX_LIFT = 500;
/** Furthest the viewer may go from the site, metres: well inside the 480 m grid. */
const MAX_WALK_M = 26_000;

const DEFAULT_FOV = 70;
const MIN_FOV = 4;
const MAX_FOV = 100;
const MAX_PITCH = 89;

// Depth: the scene is drawn in two passes that share one camera, far terrain and sky first.
// A single depth range from half a metre to hundreds of kilometres cannot tell a ridge
// 100 km away from the one behind it.
const NEAR = 0.5;
const SPLIT = 3000;
const SPLIT_OVERLAP = 150;
const FAR = 800_000;
const FAR_LAYER = 1;
const NEAR_LAYER = 2;

// Dense ground mesh that follows the viewer, so nearby relief is real geometry.
const NEAR_N = 257;
const NEAR_SPACING = 0.5; // metres -> 128 m across
const NEAR_SNAP = 4; // re-centre in steps of this many metres, so vertices never slide over the ground

const EARTH_RADIUS_KM = 6378.137;
const SUN_RADIUS_KM = 695_700;
const AU_KM = 149_597_870.7;

/** What to drape over a terrain mesh: map tiles looked up by lat/lon, one image covering the grid exactly, or the whole-Moon colour map per vertex. */
type Drape = { layer: ImageryLayer } | { image: string } | { global: true };

export interface SurfaceInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  rise: number; // -1..1, raises or lowers the viewpoint
  fast: boolean;
}

export interface SurfaceOptions {
  /** Software rendering or a weak GPU: lighter meshes, plain texture filtering, no rock shadow map. */
  lowPower?: boolean;
}

/** What the ground of the current site is built from, for display next to the picture. */
export interface SurfaceGround {
  /** Distance bands, nearest first, with the elevation product behind each. */
  bands: GroundBand[];
  /** The same in one line. */
  summary: string;
  /** True when a survey of about 10 m per sample or finer covers the site. */
  surveyed: boolean;
  /** What is generated rather than measured at this site, in words. */
  generated: string;
  /** Notes from the terrain service about gaps and limits. */
  notes: string[];
  /** Where the outermost drawn terrain ends, metres from the site. */
  reachM: number;
}

/** The sky as placed in the scene at the current instant. Degrees; elevation above the site's horizontal, airless. */
export interface SurfaceSky {
  timeMs: number;
  /** True when the directions are for the site itself (topocentric); false for the interim Moon-centre directions. */
  topocentric: boolean;
  sun: { azDeg: number; elDeg: number; radiusDeg: number };
  earth: { azDeg: number; elDeg: number; radiusDeg: number; litFraction: number };
  /** Fraction of the solar disc that clears the terrain as drawn, from where the viewer stands, 0..1. */
  sunAboveTerrain: number;
  /** Fraction of the solar disc covered by Earth (an eclipse seen from the Moon), 0..1. */
  sunBehindEarth: number;
  /** True when the terrain as drawn hides Earth's centre from where the viewer stands. */
  earthBehindTerrain: boolean;
}

interface Level {
  /** The grid as drawn (the finest may be thinned out on weak devices). */
  grid: Grid;
  mesh: Mesh<BufferGeometry, MeshLambertMaterial>;
  field: SweepField;
  /** Half-width of the square hole where the next finer mesh sits, metres (0 = none). */
  innerHalf: number;
  outerHalf: number;
}

interface SkyState {
  sun: Vector3;
  earth: Vector3;
  sunRadiusDeg: number;
  earthRadiusDeg: number;
  sunDistanceKm: number;
  earthDistanceKm: number;
  earthLit: number;
  topocentric: boolean;
}

let albedoPromise: Promise<ImageData | null> | null = null;
/** The bundled whole-Moon colour map as pixels, for colouring distant terrain without any network. */
function globalAlbedo(): Promise<ImageData | null> {
  albedoPromise ??= (async () => {
    try {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}textures/moon_color_2k.jpg`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      return null;
    }
  })();
  return albedoPromise;
}

export class SurfaceView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(DEFAULT_FOV, 1, NEAR, FAR);
  /** Compass heading the camera faces, degrees clockwise from north. */
  heading = 0;
  /** Height of the viewpoint above the observer height, metres (0 = standing on the ground). */
  lift = 0;
  private pitch = 0;
  /** Height of the eye above the ground when standing, metres: the observer (mast) height of the scenario. */
  observerHeight = 2;

  /** Whether generated (not measured) detail is shown: rocks, sub-metre texture and, where no survey exists, small craters. */
  generated = true;
  /** Whether the ground near the site is surveyed or (in part) generated. */
  detail: 'measured' | 'procedural' = 'procedural';
  /** Elevation products of the current site, nearest first, for display. */
  sources: string[] = [];
  /** What the current ground is built from; null until a site has loaded. */
  ground: SurfaceGround | null = null;
  /** The site on show; null until one has loaded. */
  site: SiteLike | null = null;
  /** Hours between marks on the Sun's and Earth's tracks; null when no track is drawn. */
  pathSteps: { sunH: number; earthH: number; startMs: number; durationH: number } | null = null;

  private readonly anisotropy: number;
  private readonly lowPower: boolean;
  private readonly ambient = new AmbientLight(0xffffff, 0.1);
  private readonly sun = new DirectionalLight(0xffffff, 3.2);
  private readonly sunDisc = new SunDisc();
  private readonly earthGlobe = new EarthGlobe(`${import.meta.env.BASE_URL}textures/earth_2k.jpg`);
  private readonly paths = new SkyPaths();
  private readonly terrain = new Group();
  private readonly beacon = new Group();
  private readonly rocks: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
  private readonly rockLit: InstancedBufferAttribute;
  private readonly rockAt = new Float32Array(MAX_ROCKS * 2);
  private mosaics: TileMosaic[] = [];
  private mode: LightMode = 'real';
  private readonly mapSize = { value: 1024 };

  // Terrain model of the current site.
  private readonly model = new Ground();
  /** Finest first. */
  private levels: Level[] = [];
  /** Measured (or interpolated) fine grid before generated relief is added, and that relief. */
  private fineBase: Grid | null = null;
  private relief: Float32Array | null = null;
  private coarse: Grid[] = [];
  private loadToken = 0;
  private near: Mesh<BufferGeometry, MeshLambertMaterial> | null = null;
  private nearField: SweepField | null = null;
  private nearCentre = { east: NaN, north: NaN };
  /** Square cut out of the fine mesh where the near mesh takes over: x, z, half-size (scene units). */
  private readonly hole = { value: new Vector3(0, 0, 0) };

  // Sky at the current instant.
  private timeMs = NaN;
  private readonly sky: SkyState = { sun: new Vector3(0, 1, 0), earth: new Vector3(0, 0, -1), sunRadiusDeg: 0.266, earthRadiusDeg: 0.95, sunDistanceKm: AU_KM, earthDistanceKm: 384_400, earthLit: 0.5, topocentric: false };
  private readonly earthPole = new Vector3(0, 1, 0);
  private readonly earthPrime = new Vector3(1, 0, 0);
  private readonly sunFromEarth = new Vector3(1, 0, 0);
  private skyKnown = false;
  private east: Vec3 = [0, 1, 0];
  private north: Vec3 = [0, 0, 1];
  private up: Vec3 = [1, 0, 0];

  // Shadows.
  private shadowsDirty = true;
  private lastSweepAt = 0;
  private sweepCostMs = 0;
  private readonly sweptSun = new Vector3(0, 0, 0);
  private sweptRadius = 0;
  /** Fraction of the solar disc above the drawn terrain from the camera, and whether Earth's centre is behind it. */
  private sunAboveTerrain = 1;
  private sunBehindEarth = 0;
  private earthBehindTerrain = false;
  private readonly occlusionAt = new Vector3(NaN, NaN, NaN);
  private occlusionDirty = true;

  // Sky paths.
  private pathWindow: { startMs: number; durationH: number } | null = null;
  private pathsDirty = false;
  private viewportHeight = 720;

  constructor(anisotropy: number, options: SurfaceOptions = {}) {
    this.lowPower = options.lowPower ?? false;
    // Anisotropic filtering is by far the largest cost of this scene in a software rasteriser.
    this.anisotropy = this.lowPower ? 1 : anisotropy;
    this.camera.rotation.order = 'YXZ';

    this.rocks = new InstancedMesh(rockGeometry(), groundMaterial({ color: 0x555555, flatShading: true }), MAX_ROCKS);
    this.rockLit = new InstancedBufferAttribute(new Float32Array(MAX_ROCKS).fill(1), 1);
    this.rocks.geometry.setAttribute('aSunLit', this.rockLit);
    this.rocks.count = 0;
    this.rocks.frustumCulled = false;
    this.rocks.castShadow = this.rocks.receiveShadow = true;
    this.rocks.layers.enable(NEAR_LAYER);

    // A shadow map for the rocks only, around the viewer. Terrain shadows come from the sweep (updateShadows).
    this.sun.castShadow = !this.lowPower;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.autoUpdate = false;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 1400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;

    for (const light of [this.ambient, this.sun]) light.layers.enableAll();
    for (const o of [this.sunDisc.mesh, this.earthGlobe.mesh]) o.layers.enable(FAR_LAYER);
    this.paths.sky.traverse((o) => o.layers.enable(FAR_LAYER));
    this.paths.overlay.traverse((o) => o.layers.enable(NEAR_LAYER));
    this.beacon.visible = false;

    this.scene.add(this.ambient, this.sun, this.sun.target, this.sunDisc.mesh, this.earthGlobe.mesh, this.paths.sky, this.paths.overlay, this.terrain, this.rocks);
  }

  // ------------------------------------------------------------------ loading a site

  /** Loads the terrain and imagery for any site. Resolves when the ground is ready to stand on; rejects with a sentence when no elevation data exists. */
  async load(site: SiteLike): Promise<void> {
    const token = ++this.loadToken;
    const data = await loadGround(site);
    if (token !== this.loadToken) return;
    const detailMap = data.detail && data.fine ? await loadDetail(data.detail.url, data.detail.size, data.detail.range, halfExtent(data.fine)).catch(() => null) : null;
    if (token !== this.loadToken) return;
    this.clearTerrain();
    this.site = { id: site.id, name: site.name, lat: site.lat, lon: site.lon, kind: site.kind };

    // Grids. Without a survey the fine grid is the coarse model, smoothly interpolated; small generated relief is added on top while `generated` is on.
    this.coarse = data.coarse;
    for (let k = this.coarse.length - 2; k >= 0; k--) blendEdge(this.coarse[k], this.coarse[k + 1]);
    this.fineBase = data.fine ?? upsample(this.coarse[0], FINE_LEVEL.n, FINE_LEVEL.spacing);
    this.relief = data.fine ? null : this.siteRelief(site.id, this.fineBase);
    this.detail = data.fine ? 'measured' : 'procedural';
    const fine: Grid = { n: this.fineBase.n, spacing: this.fineBase.spacing, data: new Float32Array(this.fineBase.data.length) };
    this.composeFine(fine);
    this.model.grids = [fine, ...this.coarse];
    this.model.detail = detailMap;
    const mid = (this.fineBase.n - 1) / 2;
    this.model.siteHeight = this.fineBase.data[mid * this.fineBase.n + mid];

    const fineHalf = halfExtent(fine);
    const generatedHere = data.fine
      ? 'Rocks and surface texture finer than about a metre are generated, not measured.'
      : `No survey finer than ${Math.round(data.bands[0].sources[0]?.resolutionM ?? 0)} m exists here: the craters, bumps and rocks drawn within ${Math.round(fineHalf)} m are generated, not measured. They can change the picture near the ground, never the numbers.`;
    this.ground = {
      bands: data.bands,
      summary: describeGround(data.bands) + (detailMap ? '; relief finer than the survey worked out from shading in the orbital photo' : ''),
      surveyed: !!data.fine,
      generated: generatedHere,
      notes: data.notes,
      reachM: halfExtent(this.coarse[this.coarse.length - 1]),
    };
    this.sources = data.bands.map((b) => b.sources[0]?.name ?? '').filter((s, i, all) => s && all.indexOf(s) === i);

    // Local east / north / up axes in the Moon-fixed frame, for placing the Sun and Earth in this sky.
    const la = site.lat * DEG, lo = site.lon * DEG;
    this.east = [-Math.sin(lo), Math.cos(lo), 0];
    this.north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
    this.up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];

    // Meshes, finest first. Each coarser mesh has a hole where the next finer one sits.
    const meshFine = this.lowPower ? decimate(fine, 2) : fine;
    const drapeFine: Drape = data.ortho ? { image: data.ortho } : { layer: DETAIL_LAYER };
    this.levels = [this.buildLevel(meshFine, drapeFine, 0, fineHalf, 1.5, true)];
    this.coarse.forEach((grid, k) => {
      const inner = k === 0 ? fineHalf : halfExtent(this.coarse[k - 1]);
      const drape: Drape = k === 0 ? { layer: DETAIL_LAYER } : k === 1 ? { layer: CONTEXT_LAYER } : { global: true };
      const drawn = this.lowPower && grid.n > 129 ? decimate(grid, 2) : grid;
      this.levels.push(this.buildLevel(drawn, drape, inner, halfExtent(grid), 0, false));
    });
    for (const level of this.levels) this.terrain.add(level.mesh);
    this.addNearMesh(this.levels[0].mesh.material, detailMap, 'image' in drapeFine);
    this.buildBeacon();
    this.terrain.add(this.beacon);

    // Stand on the site itself, at the observer height: the skyline seen is the one the analysis is about.
    this.camera.position.set(0, 0, 0);
    this.lift = 0;
    this.shadowsDirty = true;
    this.occlusionDirty = true;
    this.pathsDirty = this.pathWindow !== null;
    if (Number.isFinite(this.timeMs)) this.setTime(this.timeMs);
    this.step(0, { forward: 0, strafe: 0, rise: 0, fast: false });
  }

  /** GENERATED relief for a site with no survey, faded out around the site itself so the observer stands at the measured height. */
  private siteRelief(seed: string, base: Grid): Float32Array {
    const relief = generatedRelief(seed, base.n, base.spacing);
    const n = base.n, c = (n - 1) / 2;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const t = Math.min(1, Math.max(0, (Math.hypot(i - c, j - c) * base.spacing - 10) / 50));
        relief[j * n + i] *= t * t * (3 - 2 * t);
      }
    }
    return relief;
  }

  /** Fills the fine grid from its measured base, plus generated relief when that is switched on. */
  private composeFine(fine: Grid): void {
    const base = this.fineBase!;
    fine.data.set(base.data);
    if (this.relief && this.generated) for (let k = 0; k < fine.data.length; k++) fine.data[k] += this.relief[k];
    blendEdge(fine, this.coarse[0]);
  }

  // ------------------------------------------------------------------ terrain meshes

  private buildLevel(grid: Grid, drape: Drape, holeHalf: number, outerHalf: number, grainMetres: number, finest: boolean): Level {
    const site = this.site!;
    const n = grid.n, c = (n - 1) / 2;
    const mosaic = 'layer' in drape ? createTileMosaic(site.lat, site.lon, drape.layer, this.anisotropy) : null;
    if (mosaic) this.mosaics.push(mosaic);

    const pos = new Float32Array(n * n * 3);
    const uv = new Float32Array(n * n * 2);
    const field = createField(n, grid.spacing);
    const p = new Vector3();
    const la = site.lat * DEG;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = j * n + i;
        const e = (i - c) * grid.spacing, nn = (j - c) * grid.spacing;
        this.model.point(e, nn, grid.data[o], p).toArray(pos, o * 3);
        field.y[o] = p.y;
        if (!mosaic) {
          // An image resampled onto this very grid, north up (or no image at all).
          uv[o * 2] = i / (n - 1);
          uv[o * 2 + 1] = j / (n - 1);
          continue;
        }
        // Latitude / longitude of this sample (great-circle offset from the site), for the imagery lookup.
        const d = Math.hypot(e, nn) / this.model.radius;
        const az = Math.atan2(e, nn);
        const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
        const dLon = Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
        uv[o * 2] = (site.lon + dLon / DEG - mosaic.lonW) / (mosaic.lonE - mosaic.lonW);
        uv[o * 2 + 1] = (lat2 / DEG - mosaic.latS) / (mosaic.latN - mosaic.latS);
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        // Leave a hole where the finer mesh sits.
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
    geo.setAttribute('aSunLit', new BufferAttribute(field.lit.fill(255), 1, true));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Until imagery arrives the ground is plain regolith grey.
    const material = groundMaterial({
      color: 0x777777,
      ...(finest && { hole: this.hole, polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 }),
      ...('global' in drape && { vertexColors: true, color: 0xffffff }),
    });
    if (grainMetres > 0) {
      // Fine surface grain that no elevation data resolves (generated).
      const grain = grainTexture();
      const repeats = ((n - 1) * grid.spacing) / grainMetres;
      // The grain tiles in ground metres, while UVs span the imagery; scale accordingly.
      grain.repeat.set(repeats / Math.abs(uv[(c * n + n - 1) * 2] - uv[c * n * 2]), repeats / Math.abs(uv[((n - 1) * n + c) * 2 + 1] - uv[c * 2 + 1]));
      grain.needsUpdate = true;
      grain.anisotropy = this.anisotropy;
      material.bumpMap = grain;
      material.bumpScale = 0.15;
    }
    const token = this.loadToken;
    if (mosaic) {
      mosaic.ready.then((ok) => {
        if (!ok || token !== this.loadToken) return;
        material.map = mosaic.texture;
        material.color.setScalar(exposureFor(mosaic.texture.image as HTMLCanvasElement));
        material.needsUpdate = true;
      });
    } else if ('image' in drape) {
      new TextureLoader().load(drape.image, (t) => {
        if (token !== this.loadToken) return t.dispose();
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = this.anisotropy;
        material.map = t;
        material.color.setScalar(1.0);
        material.needsUpdate = true;
        material.userData.onMap?.();
      });
    } else {
      // Distant terrain: tone from the bundled whole-Moon colour map, per vertex. Mid-grey until it has loaded.
      const colors = new Float32Array(n * n * 3).fill(0.2);
      geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
      void globalAlbedo().then((image) => {
        if (!image || token !== this.loadToken) return;
        this.colourFromAlbedo(grid, image, colors);
        geo.getAttribute('color').needsUpdate = true;
      });
    }
    const mesh = new Mesh(geo, material);
    mesh.frustumCulled = false;
    return { grid, mesh, field, innerHalf: holeHalf, outerHalf };
  }

  /** Per-vertex tone from the whole-Moon colour map, exposed so its average is the same mid-grey as the nearer ground. */
  private colourFromAlbedo(grid: Grid, image: ImageData, out: Float32Array): void {
    const site = this.site!, n = grid.n, c = (n - 1) / 2;
    const { width, height, data } = image;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const p = offsetLatLon(site.lat, site.lon, (i - c) * grid.spacing, (j - c) * grid.spacing);
        const x = Math.min(width - 1, Math.max(0, Math.floor(((p.lon + 180) / 360) * width)));
        const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - p.lat) / 180) * height)));
        const v = (data[(y * width + x) * 4] / 255) ** 2.2; // approximate sRGB -> linear
        out[(j * n + i) * 3] = v;
        sum += v;
      }
    }
    const gain = Math.max(0.8, Math.min(5, 0.2 / Math.max(1e-4, sum / (n * n))));
    for (let k = 0; k < n * n; k++) out[k * 3] = out[k * 3 + 1] = out[k * 3 + 2] = Math.min(1, out[k * 3] * gain);
  }

  /** Sets up the dense mesh that follows the viewer, and the matching cut-out in the fine mesh. */
  private addNearMesh(fineMaterial: MeshLambertMaterial, detail: Ground['detail'], hasPhoto: boolean): void {
    if (detail) {
      // Beyond the near mesh the photo-derived relief is shown as shading only.
      const normals = detailNormalMap(detail);
      normals.anisotropy = this.anisotropy;
      fineMaterial.normalMap = normals;
    }
    const n = NEAR_N;
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.nearField = createField(n, NEAR_SPACING);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setAttribute('aSunLit', new BufferAttribute(this.nearField.lit.fill(255), 1, true));
    geo.setIndex(idx);
    // Drawn slightly in front where it overlaps the fine mesh at its rim.
    const material = groundMaterial({
      color: 0x777777,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
      // Bicubic magnification of the photo costs several texture reads per pixel: skipped on weak devices.
      ...(hasPhoto && !this.lowPower && { smoothMapSize: this.mapSize }),
    });
    // Generated sub-metre relief (not measured), as shading.
    const micro = microNormalMap();
    micro.anisotropy = this.anisotropy;
    micro.repeat.setScalar((2 * halfExtent(this.model.grids[0])) / MICRO_TILE_M);
    material.normalMap = micro;
    material.normalScale.setScalar(this.generated ? 1 : 0);
    if (hasPhoto) {
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
    this.near.receiveShadow = true;
    this.near.frustumCulled = false;
    this.near.visible = false;
    this.near.layers.enable(NEAR_LAYER);
    this.nearCentre = { east: NaN, north: NaN };
    this.terrain.add(this.near);
  }

  /** Keeps the dense mesh centred near the viewer. */
  private updateNear(east: number, north: number, force = false): void {
    const near = this.near, fine = this.model.grids[0], field = this.nearField;
    if (!near || !fine || !field) return;
    const reach = ((NEAR_N - 1) / 2) * NEAR_SPACING;
    if (Math.max(Math.abs(east), Math.abs(north)) > halfExtent(fine) - reach - 8) {
      near.visible = false;
      this.hole.value.z = 0;
      this.rocks.count = 0;
      return;
    }
    const ce = Math.round(east / NEAR_SNAP) * NEAR_SNAP, cn = Math.round(north / NEAR_SNAP) * NEAR_SNAP;
    if (!force && near.visible && ce === this.nearCentre.east && cn === this.nearCentre.north) return;
    this.nearCentre = { east: ce, north: cn };

    const n = NEAR_N, c = (n - 1) / 2, span = 2 * halfExtent(fine);
    const drawnFine = this.levels[0].grid;
    const pos = near.geometry.getAttribute('position') as Float32BufferAttribute;
    const uv = near.geometry.getAttribute('uv') as Float32BufferAttribute;
    const p = new Vector3();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const e = ce + (i - c) * NEAR_SPACING, nn = cn + (j - c) * NEAR_SPACING;
        // At its rim the mesh settles onto the fine mesh's own surface, so the two join without a step.
        const rim = Math.min(1, (Math.min(i, j, n - 1 - i, n - 1 - j) * NEAR_SPACING) / 12);
        const blend = rim * rim * (3 - 2 * rim);
        const flat = sampleGrid(drawnFine, e, nn);
        const h = flat + (sampleSmooth(fine, e, nn) + this.model.detailAt(e, nn) - flat) * blend;
        this.model.point(e, nn, h, p);
        pos.setXYZ(j * n + i, p.x, p.y, p.z);
        field.y[j * n + i] = p.y;
        uv.setXY(j * n + i, (e + span / 2) / span, (nn + span / 2) / span);
      }
    }
    field.east0 = ce;
    field.north0 = cn;
    pos.needsUpdate = true;
    uv.needsUpdate = true;
    near.geometry.computeVertexNormals();
    near.visible = true;
    this.hole.value.set(ce, -cn, reach - 1.5);
    this.scatterRocks(ce, cn);
    this.placeSun();
    if (!this.shadowsDirty) this.sweepNear();
  }

  /** Generated rocks (not measured) around a point. The same cell always gets the same rocks. */
  private scatterRocks(ce: number, cn: number): void {
    const q = new Quaternion(), scale = new Vector3(), p = new Vector3(), m = new Matrix4(), euler = new Euler();
    let count = 0;
    const cells = Math.ceil(ROCK_REACH_M / ROCK_CELL_M);
    const c0e = Math.round(ce / ROCK_CELL_M), c0n = Math.round(cn / ROCK_CELL_M);
    const seed = this.site?.id ?? '';
    for (let j = -cells; j <= cells && count < MAX_ROCKS; j++) {
      for (let i = -cells; i <= cells && count < MAX_ROCKS; i++) {
        const rand = seededRandom(`${seed}:${c0e + i}:${c0n + j}`);
        // About one rock per 30 square metres, mostly fist-sized, with the occasional boulder.
        const n = rand() < 0.42 ? 1 : rand() < 0.1 ? 2 : 0;
        for (let k = 0; k < n && count < MAX_ROCKS; k++) {
          const e = (c0e + i + rand() - 0.5) * ROCK_CELL_M, nn = (c0n + j + rand() - 0.5) * ROCK_CELL_M;
          const size = Math.min(0.9, 0.06 / Math.sqrt(1 - rand()));
          if (Math.hypot(e - ce, nn - cn) > ROCK_REACH_M) continue;
          this.model.point(e, nn, this.model.heightAt(e, nn), p);
          p.y += size * 0.2; // partly buried
          scale.set(size * (0.7 + rand() * 0.6), size * (0.45 + rand() * 0.4), size * (0.7 + rand() * 0.6));
          q.setFromEuler(euler.set(rand() * 0.6 - 0.3, rand() * Math.PI * 2, rand() * 0.6 - 0.3));
          this.rockAt[count * 2] = e;
          this.rockAt[count * 2 + 1] = nn;
          this.rocks.setMatrixAt(count++, m.compose(p, q, scale));
        }
      }
    }
    this.rocks.count = count;
    this.rocks.instanceMatrix.needsUpdate = true;
    this.rocks.visible = this.generated;
    this.sun.shadow.needsUpdate = true;
  }

  /** Shows or hides everything generated rather than measured: rocks, sub-metre surface texture and, where no survey exists, the small craters. */
  setGenerated(on: boolean): void {
    if (on === this.generated) return;
    this.generated = on;
    this.rocks.visible = on;
    this.sun.shadow.needsUpdate = true;
    if (this.near) this.near.material.normalScale.setScalar(on ? 1 : 0);
    const fineLevel = this.levels[0];
    if (fineLevel) fineLevel.mesh.material.bumpScale = on ? 0.15 : 0;
    if (this.relief && fineLevel) {
      // The generated craters are part of the fine mesh: rebuild it with or without them.
      const fine = this.model.grids[0];
      this.composeFine(fine);
      const drawn = this.lowPower ? decimate(fine, 2) : fine;
      fineLevel.grid = drawn;
      const n = drawn.n, c = (n - 1) / 2;
      const pos = fineLevel.mesh.geometry.getAttribute('position') as Float32BufferAttribute;
      const p = new Vector3();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          this.model.point((i - c) * drawn.spacing, (j - c) * drawn.spacing, drawn.data[j * n + i], p);
          pos.setXYZ(j * n + i, p.x, p.y, p.z);
          fineLevel.field.y[j * n + i] = p.y;
        }
      }
      pos.needsUpdate = true;
      fineLevel.mesh.geometry.computeVertexNormals();
      this.updateNear(this.camera.position.x, -this.camera.position.z, true);
      this.shadowsDirty = true;
      this.occlusionDirty = true;
    }
  }

  /** A marker at the exact site coordinates, shown once the viewer has walked away from it. */
  private buildBeacon(): void {
    const g = this.beacon;
    g.clear();
    const color = new Color(0x8fb8ff);
    const flat = (opacity: number) => new MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, depthWrite: false });
    // A ring around the spot and a beam above it, leaving the ground at the site itself uncovered.
    const seg = 96, pos: number[] = [], idx: number[] = [], p = new Vector3();
    for (let k = 0; k <= seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      for (const r of [14, 14.6]) {
        const e = Math.sin(a) * r, nn = Math.cos(a) * r;
        this.model.point(e, nn, this.model.heightAt(e, nn), p);
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
    beam.position.y = this.model.point(0, 0, this.model.heightAt(0, 0), p).y + 325;
    g.add(ring, beam);
    g.traverse((o) => {
      o.layers.enable(NEAR_LAYER);
      o.layers.enable(FAR_LAYER);
    });
  }

  // ------------------------------------------------------------------ sky

  private toLocal(v: Vec3, out = new Vector3()): Vector3 {
    const dot = (a: Vec3) => v[0] * a[0] + v[1] * a[1] + v[2] * a[2];
    return out.set(dot(this.east), dot(this.up), -dot(this.north));
  }

  setMode(mode: LightMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.shadowsDirty = true;
    this.applyLight();
  }

  /** Sun and Earth as seen from the site at an instant, in the scene frame. Topocentric when the analysis core provides skyAt(). */
  private computeSky(timeMs: number, g: MoonGeometry | null, out: SkyState): void {
    const site = this.site;
    if (site) {
      try {
        const s = skyAt({ lat: site.lat, lon: site.lon }, this.model.siteHeight + this.observerHeight, timeMs);
        azElToScene(s.sun.azDeg, s.sun.elDeg, out.sun);
        azElToScene(s.earth.azDeg, s.earth.elDeg, out.earth);
        out.sunRadiusDeg = s.sun.angularRadiusDeg;
        out.earthRadiusDeg = s.earth.angularRadiusDeg;
        out.sunDistanceKm = s.sun.distanceKm;
        out.earthDistanceKm = s.earth.distanceKm;
        out.earthLit = s.earthLitFraction;
        out.topocentric = true;
        return;
      } catch {
        // The sky model is not available: fall through to directions from the Moon's centre.
      }
    }
    // Interim: directions from the Moon's centre (Earth is up to 0.26 degrees off; the Sun about 0.002).
    const geometry = g ?? moonGeometry(new Date(timeMs));
    this.toLocal(geometry.sunDir, out.sun).normalize();
    this.toLocal(geometry.earthDir, out.earth).normalize();
    out.earthDistanceKm = geometry.earthDistanceKm;
    out.sunDistanceKm = AU_KM;
    out.sunRadiusDeg = Math.asin(SUN_RADIUS_KM / AU_KM) / DEG;
    out.earthRadiusDeg = Math.asin(EARTH_RADIUS_KM / geometry.earthDistanceKm) / DEG;
    // Phase of Earth: angle at Earth between the Sun and the Moon.
    const dotSE = geometry.sunDir[0] * geometry.earthDir[0] + geometry.sunDir[1] * geometry.earthDir[1] + geometry.sunDir[2] * geometry.earthDir[2];
    out.earthLit = (1 - dotSE) / 2;
    out.topocentric = false;
  }

  /** Places the Sun and Earth for an instant (UTC ms). Call whenever the shared clock changes. */
  setTime(timeMs: number): void {
    this.timeMs = timeMs;
    if (!this.site) return;
    const g = moonGeometry(new Date(timeMs));
    this.computeSky(timeMs, g, this.sky);
    this.applySky(g);
  }

  /** Interim entry point: places the Sun and Earth from Moon-centre geometry. Prefer setTime(). */
  setSky(g: MoonGeometry): void {
    if (!this.site) return;
    this.computeSky(NaN, g, this.sky);
    this.applySky(g);
  }

  private applySky(g: MoonGeometry): void {
    const s = this.sky;
    this.skyKnown = true;
    // Earth's own orientation does not depend on where on the Moon the viewer stands.
    this.toLocal(g.earthPole, this.earthPole).normalize();
    this.toLocal(g.earthPrime, this.earthPrime);
    this.earthPrime.addScaledVector(this.earthPole, -this.earthPrime.dot(this.earthPole)).normalize();
    // Direction of the Sun as seen from Earth, which sets Earth's phase.
    this.sunFromEarth.copy(s.sun).multiplyScalar(s.sunDistanceKm).addScaledVector(s.earth, -s.earthDistanceKm).normalize();
    // An eclipse seen from the Moon: Earth's disc in front of the Sun's.
    const sep = Math.acos(Math.max(-1, Math.min(1, s.sun.dot(s.earth)))) / DEG;
    this.sunBehindEarth = discCoveredFraction(s.sunRadiusDeg, s.earthRadiusDeg, sep);
    if (s.sun.angleTo(this.sweptSun) > 0.01 * DEG || s.sunRadiusDeg !== this.sweptRadius) this.shadowsDirty = true;
    this.occlusionDirty = true;
    this.applyLight();
  }

  /** Sunlight for the current sky. Exposure works like a camera's: level ground keeps a steady mid-tone whatever the Sun's height, so a low Sun shows as strong contrast on slopes rather than a dim scene. */
  private applyLight(): void {
    const s = this.sky;
    if (this.mode === 'real') {
      const sinElevation = Math.max(s.sun.y, 0.08);
      this.sun.visible = s.sun.y > -0.2;
      this.sun.intensity = ((Math.PI * 0.62) / sinElevation) * (1 - this.sunBehindEarth);
    } else {
      // "Even" lighting: a fixed high light so every site is readable. Not the real Sun.
      this.sun.visible = true;
      this.sun.intensity = (Math.PI * 0.62) / 0.8;
    }
    this.sun.castShadow = this.sun.visible && !this.lowPower && this.mode === 'real';
    this.placeSun();
  }

  /** The light sits along the Sun's direction from the dense mesh's centre, so the rock shadow map covers the ground around the viewer. */
  private placeSun(): void {
    const direction = this.mode === 'real' ? this.sky.sun : EVEN_LIGHT;
    const ce = Number.isFinite(this.nearCentre.east) ? this.nearCentre.east : this.camera.position.x;
    const cn = Number.isFinite(this.nearCentre.north) ? this.nearCentre.north : -this.camera.position.z;
    const ground = this.levels.length ? this.model.point(ce, cn, this.model.heightAt(ce, cn), this.sun.target.position) : this.sun.target.position.set(ce, 0, -cn);
    this.sun.position.copy(ground).addScaledVector(direction, 600);
    this.sun.shadow.needsUpdate = true;
  }

  // ------------------------------------------------------------------ terrain shadows

  /** Sweeps every terrain level for the current Sun (coarsest first, each handing its shadows to the finer one inside it). */
  private updateShadows(): void {
    const s = this.sky;
    const started = performance.now();
    if (this.mode !== 'real' || !this.skyKnown) {
      for (const level of this.levels) level.field.lit.fill(255);
      this.nearField?.lit.fill(255);
    } else if (s.sun.y < -0.2) {
      for (const level of this.levels) level.field.lit.fill(0);
      this.nearField?.lit.fill(0);
    } else {
      const { azDeg, elDeg } = sceneToAzEl(s.sun);
      // Beyond the drawn terrain: a smooth Moon at the mean height of the outermost grid's edge.
      const outer = this.levels[this.levels.length - 1];
      const limb = { radius: this.model.radius, height0: this.edgeHeight(outer) };
      let parent: SweepField | null = null;
      for (let k = this.levels.length - 1; k >= 0; k--) {
        sweepSunlight(this.levels[k].field, azDeg, elDeg, s.sunRadiusDeg, parent, parent ? null : limb);
        parent = this.levels[k].field;
      }
    }
    for (const level of this.levels) level.mesh.geometry.getAttribute('aSunLit').needsUpdate = true;
    this.sweptSun.copy(s.sun);
    this.sweptRadius = s.sunRadiusDeg;
    this.shadowsDirty = false;
    this.sweepNear();
    this.sweepCostMs = performance.now() - started;
    this.lastSweepAt = started;
  }

  /** Mean scene height the outermost grid would have at the site if it were a smooth sphere through its own edge. */
  private edgeHeight(level: Level): number {
    const { n, data } = level.grid;
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) {
      sum += data[i] + data[(n - 1) * n + i] + data[i * n] + data[i * n + n - 1];
      count += 4;
    }
    return sum / count - this.model.siteHeight;
  }

  /** Shadows on the dense mesh around the viewer and on the rocks, from the fine level's sweep. */
  private sweepNear(): void {
    const field = this.nearField, near = this.near;
    if (!field || !near || !near.visible) return;
    const s = this.sky;
    if (this.mode !== 'real' || !this.skyKnown) field.lit.fill(255);
    else if (s.sun.y < -0.2) field.lit.fill(0);
    else {
      const { azDeg, elDeg } = sceneToAzEl(s.sun);
      sweepSunlight(field, azDeg, elDeg, s.sunRadiusDeg, this.levels[0].field);
    }
    near.geometry.getAttribute('aSunLit').needsUpdate = true;
    for (let k = 0; k < this.rocks.count; k++) this.rockLit.setX(k, litAt(field, this.rockAt[k * 2], this.rockAt[k * 2 + 1]));
    this.rockLit.needsUpdate = true;
  }

  /** How much of the Sun, and whether Earth, clears the terrain as drawn, from the camera. */
  private updateOcclusion(): void {
    const cam = this.camera.position, s = this.sky;
    this.occlusionAt.copy(cam);
    this.occlusionDirty = false;
    if (!this.levels.length || !this.skyKnown) return;
    const sun = sceneToAzEl(s.sun);
    const tanUp = Math.tan(Math.min(89.9, sun.elDeg + s.sunRadiusDeg) * DEG), tanLow = Math.tan(Math.max(-89.9, sun.elDeg - s.sunRadiusDeg) * DEG);
    // Three azimuths across the disc, since a skyline is rarely level.
    let above = 0;
    for (const offset of [-0.6, 0, 0.6]) {
      const skyline = this.model.skylineTan(cam, sun.azDeg + (offset * s.sunRadiusDeg) / Math.max(0.05, Math.cos(sun.elDeg * DEG)));
      above += discAreaAbove((tanUp - skyline) / (tanUp - tanLow)) / 3;
    }
    this.sunAboveTerrain = above;
    const earth = sceneToAzEl(s.earth);
    this.earthBehindTerrain = this.model.skylineTan(cam, earth.azDeg) > Math.tan(earth.elDeg * DEG);
  }

  // ------------------------------------------------------------------ sky paths

  /** Draws the Sun's and Earth's tracks over a mission window (UTC ms start, hours). Pass null to remove them. */
  setPathWindow(startMs: number | null, durationH = 0): void {
    const next = startMs !== null && Number.isFinite(startMs) && durationH > 0 ? { startMs, durationH } : null;
    if (next?.startMs === this.pathWindow?.startMs && next?.durationH === this.pathWindow?.durationH) return;
    this.pathWindow = next;
    this.pathsDirty = true;
  }

  /** Shows or hides the dotted tracks and the Sun / Earth name labels. */
  setAnnotations(tracks: boolean, labels = tracks): void {
    this.paths.setVisible(tracks, labels);
  }

  get annotations(): { tracks: boolean; labels: boolean } {
    return this.paths.visible;
  }

  private rebuildPaths(): void {
    this.pathsDirty = false;
    const w = this.pathWindow;
    if (!w || !this.site) {
      this.paths.setTracks(null, null);
      this.pathSteps = null;
      return;
    }
    // One mark per step. The Sun moves about half a degree an hour; Earth only wanders a degree or two a day.
    const sunH = niceStepH(Math.max(1, w.durationH / 360)), earthH = niceStepH(Math.max(6, w.durationH / 200));
    const state: SkyState = { ...this.sky, sun: new Vector3(), earth: new Vector3() };
    const minY = Math.sin(-2 * DEG); // marks further below the horizontal would only litter the ground
    const track = (stepH: number, pick: (s: SkyState) => Vector3): Float32Array => {
      const out: number[] = [];
      for (let h = 0; h <= w.durationH + 1e-9; h += stepH) {
        this.computeSky(w.startMs + h * 3_600_000, null, state);
        const v = pick(state);
        if (v.y >= minY) out.push(v.x, v.y, v.z);
      }
      return new Float32Array(out);
    };
    this.paths.setTracks(
      track(sunH, (s) => s.sun),
      track(earthH, (s) => s.earth),
    );
    this.pathSteps = { sunH, earthH, startMs: w.startMs, durationH: w.durationH };
  }

  // ------------------------------------------------------------------ looking and walking

  /** Mouse-look: positive dx turns right, positive dy looks down (pixels). */
  look(dx: number, dy: number): void {
    const k = (this.camera.fov / DEFAULT_FOV) * 0.0028;
    this.heading = wrapAz(this.heading + (dx * k) / DEG);
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - (dy * k) / DEG));
  }

  /** Absolute look direction: azimuth clockwise from north and elevation above the horizontal, degrees; optionally the vertical field of view. */
  setLook(azDeg: number, elDeg: number, fovDeg?: number): void {
    if (Number.isFinite(azDeg)) this.heading = wrapAz(azDeg);
    if (Number.isFinite(elDeg)) this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, elDeg));
    if (fovDeg !== undefined && Number.isFinite(fovDeg)) this.setFov(fovDeg);
  }

  /** Where the camera looks: azimuth, elevation and vertical field of view, degrees. */
  get lookDirection(): { azDeg: number; elDeg: number; fovDeg: number } {
    return { azDeg: this.heading, elDeg: this.pitch, fovDeg: this.camera.fov };
  }

  /** Vertical field of view, degrees (4 = strong zoom on the Sun or Earth, 100 = wide). */
  setFov(fovDeg: number): void {
    this.camera.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, fovDeg));
    this.camera.updateProjectionMatrix();
  }

  /** Wheel zoom: positive widens the view, negative narrows it. */
  zoom(delta: number): void {
    this.setFov(this.camera.fov * (delta > 0 ? 1.1 : 1 / 1.1));
  }

  /** Height of the eye above the ground when standing, metres (the scenario's observer / mast height). */
  setObserverHeight(metres: number): void {
    if (!Number.isFinite(metres)) return;
    this.observerHeight = Math.max(0.2, Math.min(200, metres));
    this.occlusionDirty = true;
  }

  /** Moves the viewer to a point east and north of the site, metres (0, 0 = the site itself). Clamped to the walkable area. */
  setPosition(eastM: number, northM: number, liftM = this.lift): void {
    const limit = this.walkLimit();
    this.camera.position.x = Math.max(-limit, Math.min(limit, eastM));
    this.camera.position.z = Math.max(-limit, Math.min(limit, -northM));
    this.lift = Math.max(0, Math.min(MAX_LIFT, liftM));
  }

  /** Where the viewer stands relative to the site, metres, and how far the eye is above the ground. */
  get position(): { eastM: number; northM: number; eyeHeightM: number } {
    return { eastM: this.camera.position.x, northM: -this.camera.position.z, eyeHeightM: this.observerHeight + this.lift };
  }

  private walkLimit(): number {
    const g = this.model.grids;
    if (!g.length) return 0;
    // Stay inside the 480 m grid (or whatever is the outermost, when there is less).
    const outer = g.length > 3 ? g[2] : g[g.length - 1];
    return Math.min(MAX_WALK_M, halfExtent(outer) * 0.9);
  }

  /** Advances walking, keeps the eye at the observer height above the ground and brings shadows, sky and annotations up to date. Call once per frame before drawing. */
  step(dt: number, input: SurfaceInput): void {
    const cam = this.camera;
    const h = this.heading * DEG;
    if (this.levels.length) {
      const onFine = this.model.gridAt(cam.position.x, -cam.position.z) === this.model.grids[0];
      // Rising is slow near the ground and quicker higher up; moving speeds up with height too.
      this.lift = Math.max(0, Math.min(MAX_LIFT, this.lift + input.rise * Math.max(4, this.lift * 0.9) * (input.fast ? 3 : 1) * dt));
      const speed = (onFine ? WALK_SPEED_FINE : WALK_SPEED_COARSE) * (input.fast ? FAST_FACTOR : 1) * (1 + this.lift / 6) * dt;
      // Heading 0 faces north (-Z); 90 faces east (+X).
      cam.position.x += (Math.sin(h) * input.forward + Math.cos(h) * input.strafe) * speed;
      cam.position.z += (-Math.cos(h) * input.forward + Math.sin(h) * input.strafe) * speed;
      const limit = this.walkLimit();
      cam.position.x = Math.max(-limit, Math.min(limit, cam.position.x));
      cam.position.z = Math.max(-limit, Math.min(limit, cam.position.z));
      const east = cam.position.x, north = -cam.position.z;
      this.updateNear(east, north);
      cam.position.y = this.model.point(east, north, this.model.heightAt(east, north), new Vector3()).y + this.observerHeight + this.lift;

      const now = performance.now();
      // While the Sun moves, sweep at a pace the device can afford; the last position always gets its own sweep.
      if (this.shadowsDirty && now - this.lastSweepAt >= Math.min(250, Math.max(30, this.sweepCostMs * 4))) this.updateShadows();
      if (this.occlusionDirty || cam.position.distanceToSquared(this.occlusionAt) > 0.0625) this.updateOcclusion();
      if (this.pathsDirty) this.rebuildPaths();
    }
    cam.rotation.set(this.pitch * DEG, -h, 0);
    this.prepareFrame();
  }

  /** Positions everything that follows the camera, and sorts the terrain into the two depth passes. */
  private prepareFrame(): void {
    const cam = this.camera, s = this.sky;
    cam.updateMatrixWorld();
    const real = this.mode === 'real';
    const sunShowing = this.sunAboveTerrain * (1 - this.sunBehindEarth);
    this.sunDisc.mesh.visible = this.earthGlobe.mesh.visible = this.skyKnown;
    this.sunDisc.update(cam, s.sun, s.sunRadiusDeg, sunShowing);
    this.earthGlobe.update(cam, s.earth, s.earthRadiusDeg, this.sunFromEarth, this.earthPole, this.earthPrime);
    this.paths.sky.visible = this.paths.overlay.visible = this.skyKnown;
    this.paths.update(cam, s.sun, s.earth, this.sunBehindEarth > 0.98 ? 2 : this.sunAboveTerrain < 0.02 ? 1 : 0, this.earthBehindTerrain, this.viewportHeight);

    // Fill light: none of it is real skylight (there is no sky), it stands for the eye adapting.
    // A viewer in shadow or at night sees more of the unlit ground than one dazzled by sunlit regolith.
    const dazzle = real && s.sun.y > -0.02 ? sunShowing : 0;
    this.ambient.intensity = real ? 0.28 - 0.18 * dazzle : 0.3;

    // The site marker appears once the viewer has left the site.
    const away = Math.hypot(cam.position.x, cam.position.z);
    this.beacon.visible = away > 25;

    const cx = Math.abs(cam.position.x), cz = Math.abs(cam.position.z);
    for (const level of this.levels) {
      const reach = Math.max(cx, cz);
      const nearest = reach > level.outerHalf ? Math.hypot(Math.max(0, cx - level.outerHalf), Math.max(0, cz - level.outerHalf)) : reach < level.innerHalf ? level.innerHalf - reach : 0;
      const farthest = Math.hypot(cx + level.outerHalf, cz + level.outerHalf) + this.lift + 200;
      level.mesh.layers.set(0);
      if (nearest < SPLIT + SPLIT_OVERLAP) level.mesh.layers.enable(NEAR_LAYER);
      if (farthest > SPLIT) level.mesh.layers.enable(FAR_LAYER);
    }
  }

  /**
   * Draws the scene: far terrain and the sky first, then everything near over a fresh depth
   * buffer. `step()` must have run for this frame.
   */
  render(renderer: WebGLRenderer): void {
    const cam = this.camera;
    const height = renderer.domElement.clientHeight;
    if (height > 0 && height !== this.viewportHeight) {
      this.viewportHeight = height;
      this.prepareFrame();
    }
    const autoClear = renderer.autoClear;
    // The rock shadow map is rendered with the near pass, where the rocks are.
    const shadowPending = this.sun.shadow.needsUpdate;
    this.sun.shadow.needsUpdate = false;

    cam.near = SPLIT;
    cam.far = FAR;
    cam.updateProjectionMatrix();
    cam.layers.set(FAR_LAYER);
    renderer.autoClear = true;
    renderer.render(this.scene, cam);

    cam.near = this.lift > 30 ? 2 : NEAR;
    cam.far = SPLIT + SPLIT_OVERLAP;
    cam.updateProjectionMatrix();
    cam.layers.set(NEAR_LAYER);
    renderer.autoClear = false;
    renderer.clearDepth();
    this.sun.shadow.needsUpdate = shadowPending;
    renderer.render(this.scene, cam);

    renderer.autoClear = autoClear;
    // Left ready for a plain single-pass render(scene, camera) as well.
    cam.near = NEAR;
    cam.far = FAR;
    cam.updateProjectionMatrix();
    cam.layers.set(0);
  }

  /** Distance from the site, metres. */
  get distanceFromSite(): number {
    return Math.hypot(this.camera.position.x, this.camera.position.z);
  }

  /** The sky as placed at the current instant, or null before a site and a time are set. */
  get skyNow(): SurfaceSky | null {
    if (!this.skyKnown) return null;
    const s = this.sky, sun = sceneToAzEl(s.sun), earth = sceneToAzEl(s.earth);
    return {
      timeMs: this.timeMs,
      topocentric: s.topocentric,
      sun: { ...sun, radiusDeg: s.sunRadiusDeg },
      earth: { ...earth, radiusDeg: s.earthRadiusDeg, litFraction: s.earthLit },
      sunAboveTerrain: this.sunAboveTerrain,
      sunBehindEarth: this.sunBehindEarth,
      earthBehindTerrain: this.earthBehindTerrain,
    };
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private clearTerrain(): void {
    this.near = null;
    this.nearField = null;
    this.levels = [];
    this.rocks.count = 0;
    this.model.detail = null;
    this.model.grids = [];
    this.hole.value.set(0, 0, 0);
    this.terrain.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mat = mesh.material as MeshLambertMaterial;
      // Tile mosaics dispose their own textures below; single-image drapes are owned by the material.
      if (mat.map && !this.mosaics.some((m) => m.texture === mat.map)) mat.map.dispose();
      mat.bumpMap?.dispose();
      if (mat.normalMap && !isSharedTexture(mat.normalMap)) mat.normalMap.dispose();
      mat.dispose();
    });
    for (const m of this.mosaics) m.dispose();
    this.mosaics = [];
    this.terrain.clear();
  }
}

/** Direction of the artificial key light in "even" mode. */
const EVEN_LIGHT = new Vector3(0.35, 0.8, 0.5).normalize();
