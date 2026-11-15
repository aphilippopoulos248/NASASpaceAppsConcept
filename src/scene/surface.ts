import {
  AmbientLight,
  Box3,
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
  Sphere,
  TextureLoader,
  Vector3,
  type Material,
  type MeshLambertMaterial,
  type WebGLRenderer,
} from 'three';
import { skyAt } from '../analysis/api';
import { moonGeometry, type MoonGeometry, type Vec3 } from '../astro/ephemeris';
import type { LightMode } from '../core/types';
import { BOULDER_SHAPES, BOULDER_SIZE_M, BOULDERS_EACH, craterField, detailNormalMap, exposureFor, grainTexture, lightHeight, loadDetail, requestDetailMaps, ROCK_CELL_M, ROCK_REACH_M, rockGeometry, SMALL_ROCK_SHAPES, SMALL_ROCKS_EACH } from './surface/assets';
import { blendEdge, decimate, generatedRelief, Ground, halfExtent, offsetLatLon, sampleGrid, sampleSmooth, seededRandom, upsample, type Grid } from './surface/ground';
import { describeGround, FINE_LEVEL, loadGround, type GroundBand, type SiteLike } from './surface/groundSource';
import { earthshine, groundMaterial, rockMaterial, type RockGround } from './surface/materials';
import { createField, litAt, sweepSunlight, type SweepField } from './surface/shadowSweep';
import { EarthGlobe, SunDisc } from './surface/skyBodies';
import { azElToScene, DEG, discAreaAbove, discCoveredFraction, niceStepH, sceneToAzEl, wrapAz } from './surface/skyMath';
import { Label, SkyPaths } from './surface/skyPaths';
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
//   - GENERATED, labelled and switchable with one control: rocks, craters a few metres
//     across and finer texture near the viewer, crater shading from the close-up maps at
//     every distance and, where no survey exists, craters and bumps within about 770 m.

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

// Dense ground mesh around the viewer, so nearby relief is real geometry: 96 m across, a
// quarter-metre spacing (one metre on weak devices).
const NEAR_HALF_M = 48;
const NEAR_SNAP = 2; // re-centre onto a 2 m lattice, so vertices never slide over the ground
const NEAR_SLACK = 14; // how far the viewer may wander from the centre before the mesh is rebuilt
/** At a site with an orbital photo, the viewer starts this far south of the photographed lander, metres. */
const PHOTO_SITE_START_M = 30;
/** Generated detail (rocks, craters) is left out within this distance of the site and fades in beyond it, metres. */
const SITE_CLEAR_M = 4;

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
  /** The mesh, as square pieces that share its vertex data so that off-screen pieces are skipped. */
  pieces: Group;
  geometry: BufferGeometry;
  material: MeshLambertMaterial;
  /** Image coordinates on this mesh's drape for a ground point (metres east and north of the site). */
  uvAt: (east: number, north: number, out: [number, number]) => [number, number];
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

/**
 * Splits a grid mesh into square pieces that share its vertex data, so the renderer can skip
 * the pieces that are off-screen (or outside the depth range of the pass being drawn). A
 * terrain mesh drawn whole is mostly triangles nobody sees.
 */
function splitForCulling(source: BufferGeometry, material: Material, n: number, pieces: number, pad: number): Group {
  const group = new Group();
  const cells = Math.ceil((n - 1) / pieces);
  const index = source.getIndex()!.array;
  const buckets: number[][] = Array.from({ length: pieces * pieces }, () => []);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const pi = Math.min(pieces - 1, Math.floor((a % n) / cells)), pj = Math.min(pieces - 1, Math.floor(Math.floor(a / n) / cells));
    buckets[pj * pieces + pi].push(index[t], index[t + 1], index[t + 2]);
  }
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const geo = new BufferGeometry();
    for (const name of Object.keys(source.attributes)) geo.setAttribute(name, source.getAttribute(name));
    geo.setIndex(bucket);
    const piece = new Mesh(geo, material);
    // Each depth pass draws the pieces that reach into its range.
    piece.layers.enable(NEAR_LAYER);
    piece.layers.enable(FAR_LAYER);
    group.add(piece);
  }
  group.userData.pad = pad;
  refreshBounds(group);
  return group;
}

/** Bounding spheres from the vertices each piece actually uses (the default would span the whole shared buffer). */
function refreshBounds(group: Group): void {
  const box = new Box3(), v = new Vector3();
  for (const child of group.children) {
    const geo = (child as Mesh).geometry;
    const pos = geo.getAttribute('position'), index = geo.getIndex()!.array;
    box.makeEmpty();
    for (let k = 0; k < index.length; k += 3) box.expandByPoint(v.fromBufferAttribute(pos, index[k]));
    geo.boundingSphere = box.getBoundingSphere(geo.boundingSphere ?? new Sphere());
    geo.boundingSphere.radius += group.userData.pad as number;
  }
}

interface RockSet {
  mesh: InstancedMesh<BufferGeometry, MeshLambertMaterial>;
  /** Per rock: the fraction of the solar disc that clears the terrain where it sits. */
  lit: InstancedBufferAttribute;
  /** Per rock: metres east and north of the site. */
  at: Float32Array;
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

  /** Whether generated (not measured) detail is shown: rocks, small craters and fine texture, crater shading on distant ground and, where no survey exists, the craters within 770 m. */
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
  private readonly nearSpacing: number;
  private readonly nearN: number;
  private readonly ambient = new AmbientLight(0xffffff, 0.1);
  private readonly sun = new DirectionalLight(0xffffff, 3.2);
  private readonly sunDisc = new SunDisc();
  private readonly earthGlobe = new EarthGlobe(`${import.meta.env.BASE_URL}textures/earth_2k.jpg`);
  private readonly paths = new SkyPaths();
  private readonly terrain = new Group();
  private readonly beacon = new Group();
  private beaconLabel: Label | null = null;
  /** Many small rocks share a few light meshes; the rare boulders, which one can walk up to, get detailed ones. */
  private readonly rocks: RockSet[] = [];
  private readonly rockGround: RockGround = { map: { value: null }, hasMap: { value: 0 }, color: { value: new Color(0.2, 0.2, 0.2) }, half: { value: 1 } };
  /** 1 while generated detail is shown: read by the shaders. */
  private readonly generatedFlag = { value: 1 };
  /**
   * Depth of the generated metre-scale craters relative to their normal depth. Towards the
   * poles the Sun never climbs more than a few degrees, and at full depth the shadows of these
   * invented craters would cover most of the ground and bury the measured relief.
   */
  private craterScale = 1;
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
  private near: Group | null = null;
  private nearGeometry: BufferGeometry | null = null;
  private nearField: SweepField | null = null;
  private nearCentre = { east: NaN, north: NaN };
  /** A rebuild of the near mesh in progress, worked on a few milliseconds per frame. */
  private nearBuild: { east: number; north: number; row: number; pass: 0 | 1 } | null = null;
  private readonly nearScratch: { pos: Float32Array; nrm: Float32Array; uv: Float32Array };
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
  private lastStepAt = 0;
  private pathJob: { startMs: number; durationH: number; sunH: number; earthH: number; hour: number; body: 0 | 1; sun: number[]; earth: number[]; state: SkyState } | null = null;
  private viewportHeight = 720;
  private readonly scratch = new Vector3();

  constructor(anisotropy: number, options: SurfaceOptions = {}) {
    this.lowPower = options.lowPower ?? false;
    // Anisotropic filtering is by far the largest cost of this scene in a software rasteriser.
    this.anisotropy = this.lowPower ? 1 : anisotropy;
    this.nearSpacing = this.lowPower ? 0.5 : 0.25;
    this.nearN = (2 * NEAR_HALF_M) / this.nearSpacing + 1;
    const nn = this.nearN * this.nearN;
    this.nearScratch = { pos: new Float32Array(nn * 3), nrm: new Float32Array(nn * 3), uv: new Float32Array(nn * 2) };
    this.camera.rotation.order = 'YXZ';

    const rockShader = rockMaterial(this.rockGround);
    for (let k = 0; k < SMALL_ROCK_SHAPES + BOULDER_SHAPES; k++) {
      const boulder = k >= SMALL_ROCK_SHAPES, capacity = boulder ? BOULDERS_EACH : SMALL_ROCKS_EACH;
      // 320 triangles is plenty for a rock a hand-span across; boulders get 1280.
      const mesh = new InstancedMesh(rockGeometry(k, boulder ? 3 : 2), rockShader, capacity);
      const lit = new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1);
      mesh.geometry.setAttribute('aSunLit', lit);
      mesh.count = 0;
      mesh.frustumCulled = false;
      // Rocks cast shadows but do not receive them: at this size the shadow map would only speckle them.
      mesh.castShadow = true;
      mesh.layers.enable(NEAR_LAYER);
      this.rocks.push({ mesh, lit, at: new Float32Array(capacity * 2) });
    }

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

    this.scene.add(this.ambient, this.sun, this.sun.target, this.sunDisc.mesh, this.earthGlobe.mesh, this.paths.sky, this.paths.overlay, this.terrain, ...this.rocks.map((r) => r.mesh));
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
    // At a landing site the photo shows the lander and its shadow at the very centre.
    this.model.detailCalmM = detailMap && site.kind !== 'custom' ? 12 : 0;
    this.model.extra = (east, north) => this.generatedAt(east, north);
    // The Sun's highest possible elevation here is about 91.5 degrees minus the latitude.
    this.craterScale = Math.min(1, Math.max(0.25, (91.5 - Math.abs(site.lat)) / 25));
    const mid = (this.fineBase.n - 1) / 2;
    this.model.siteHeight = this.fineBase.data[mid * this.fineBase.n + mid];

    const fineHalf = halfExtent(fine);
    const generatedHere = data.fine
      ? 'Generated, not measured: rocks, craters under about 2.5 m and finer texture near the viewer, and faint crater shading on distant ground.'
      : `No survey finer than ${Math.round(data.bands[0].sources[0]?.resolutionM ?? 0)} m exists here: the craters, bumps and rocks drawn within ${Math.round(fineHalf)} m, and the faint crater shading beyond, are generated, not measured. They can change the picture near the ground, never the numbers.`;
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
    for (const level of this.levels) this.terrain.add(level.pieces);
    this.addNearMesh(this.levels[0], detailMap, 'image' in drapeFine);
    this.buildBeacon();
    this.terrain.add(this.beacon);

    // Stand on the site itself, at the observer height: the skyline seen is the one the analysis is
    // about. Where an orbital photo is draped over the ground, the lander and its shadow are in
    // it at the very centre, a smear of white and black at eye level, so there the viewer starts
    // a few steps to the south (as the first version of this view did), with the site marked.
    this.camera.position.set(0, 0, data.ortho ? PHOTO_SITE_START_M : 0);
    this.lift = 0;
    this.shadowsDirty = true;
    this.occlusionDirty = true;
    this.pathsDirty = this.pathWindow !== null;
    if (Number.isFinite(this.timeMs)) this.setTime(this.timeMs);
    this.step(0, { forward: 0, strafe: 0, rise: 0, fast: false });
  }

  /**
   * GENERATED relief for a site with no survey. Shifted so that it is zero at the site (the
   * observer stands at the measured height) and flattened within a few metres of it, so the
   * viewer never starts inside an invented crater.
   */
  private siteRelief(seed: string, base: Grid): Float32Array {
    const relief = generatedRelief(seed, base.n, base.spacing);
    const n = base.n, c = (n - 1) / 2;
    const atSite = relief[c * n + c];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const t = Math.min(1, Math.max(0, (Math.hypot(i - c, j - c) * base.spacing - 4) / 26));
        relief[j * n + i] = (relief[j * n + i] - atSite) * t * t * (3 - 2 * t);
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
    const span = (n - 1) * grid.spacing;
    /** Image coordinates of a ground point (metres east and north of the site). */
    const uvAt = (e: number, nn: number, out: [number, number]): [number, number] => {
      if (!mosaic) {
        // An image resampled onto this very grid, north up (or no image at all).
        out[0] = (e + span / 2) / span;
        out[1] = (nn + span / 2) / span;
        return out;
      }
      // Latitude / longitude of the point (great-circle offset from the site), for the imagery lookup.
      const d = Math.hypot(e, nn) / this.model.radius;
      const az = Math.atan2(e, nn);
      const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
      const dLon = Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
      out[0] = (site.lon + dLon / DEG - mosaic.lonW) / (mosaic.lonE - mosaic.lonW);
      out[1] = (lat2 / DEG - mosaic.latS) / (mosaic.latN - mosaic.latS);
      return out;
    };
    const t: [number, number] = [0, 0];
    let outside = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const o = j * n + i;
        const e = (i - c) * grid.spacing, nn = (j - c) * grid.spacing;
        this.model.point(e, nn, grid.data[o], p).toArray(pos, o * 3);
        field.y[o] = p.y;
        uvAt(e, nn, t);
        uv[o * 2] = t[0];
        uv[o * 2 + 1] = t[1];
        if (t[0] < 0 || t[0] > 1 || t[1] < 0 || t[1] > 1) outside++;
      }
    }
    // Next to a pole a block of map tiles cannot reach round the grid: then no imagery is draped at all.
    const imageryFits = outside <= 0.02 * n * n;
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

    // Until imagery arrives the ground is plain regolith grey. Every level carries the generated
    // crater shading of the close-up maps, at the size that suits its distance.
    const material = groundMaterial(
      {
        color: 0x777777,
        ...(finest && { polygonOffset: true, polygonOffsetFactor: -0.5, polygonOffsetUnits: -1 }),
        ...('global' in drape && { vertexColors: true, color: 0xffffff }),
      },
      { ...(finest && { hole: this.hole }), farDetail: { strength: 0.7, on: this.generatedFlag, single: this.lowPower } },
    );
    // On weak devices the grain is left out: the close-up maps already give the ground its texture, and a bump map costs three more texture reads per pixel.
    if (grainMetres > 0 && !this.lowPower) {
      // Fine surface grain that no elevation data resolves (generated).
      const grain = grainTexture();
      const repeats = ((n - 1) * grid.spacing) / grainMetres;
      // The grain tiles in ground metres, while UVs span the imagery; scale accordingly.
      grain.repeat.set(repeats / Math.abs(uv[(c * n + n - 1) * 2] - uv[c * n * 2]), repeats / Math.abs(uv[((n - 1) * n + c) * 2 + 1] - uv[c * 2 + 1]));
      grain.needsUpdate = true;
      grain.anisotropy = this.anisotropy;
      material.bumpMap = grain;
      material.bumpScale = this.generated ? 0.15 : 0;
    }
    const token = this.loadToken;
    if (mosaic) {
      mosaic.ready.then((ok) => {
        if (!ok || !imageryFits || token !== this.loadToken) return;
        // Mostly-shadow imagery (the poles) is not used: the ground stays plain regolith grey.
        const gain = exposureFor(mosaic.texture.image as HTMLCanvasElement);
        if (gain === null) return;
        material.map = mosaic.texture;
        material.color.setScalar(gain);
        material.needsUpdate = true;
        material.userData.onMap?.();
      });
    } else if ('image' in drape) {
      new TextureLoader().load(drape.image, (tex) => {
        if (token !== this.loadToken) return tex.dispose();
        tex.colorSpace = SRGBColorSpace;
        tex.anisotropy = this.anisotropy;
        material.map = tex;
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
    const pieces = splitForCulling(geo, material, n, n > 257 ? 8 : n > 129 ? 6 : 4, 2 * grid.spacing);
    return { grid, pieces, geometry: geo, material, uvAt, field, innerHalf: holeHalf, outerHalf };
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

  /**
   * GENERATED craters a metre or more across (not measured), which the near mesh carries as
   * geometry and the viewer walks over. Where a survey exists they stay under about 2.5 m,
   * below what the photo resolves; elsewhere they run up to about 6 m, meeting the larger
   * generated craters of the fine grid. They fade out at the site itself, like those.
   */
  private generatedAt(east: number, north: number): number {
    if (!this.generated) return 0;
    const t = Math.min(1, Math.max(0, (Math.hypot(east, north) - SITE_CLEAR_M) / 26));
    if (t <= 0) return 0;
    let h = craterField(east, north, 3, 11);
    if (this.detail === 'procedural') h += craterField(east, north, 7, 23);
    return h * this.craterScale * t * t * (3 - 2 * t);
  }

  /** Sets up the dense mesh around the viewer, and the matching cut-out in the fine mesh. */
  private addNearMesh(fineLevel: Level, detail: Ground['detail'], hasPhoto: boolean): void {
    const fineMaterial = fineLevel.material;
    if (detail) {
      // Beyond the near mesh the photo-derived relief is shown as shading only.
      const normals = detailNormalMap(detail);
      normals.anisotropy = this.anisotropy;
      fineMaterial.normalMap = normals;
    }
    const n = this.nearN;
    const idx: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    }
    this.nearField = createField(n, this.nearSpacing);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setAttribute('aSunLit', new BufferAttribute(this.nearField.lit.fill(255), 1, true));
    geo.setIndex(idx);
    // Drawn slightly in front where it overlaps the fine mesh at its rim. Its shader adds the
    // generated detail too fine for the mesh; bicubic magnification of the photo costs several
    // texture reads per pixel and is skipped on weak devices.
    requestDetailMaps(this.anisotropy);
    const material = groundMaterial(
      { color: 0x777777, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 },
      { near: { on: this.generatedFlag, mapSize: this.mapSize, smooth: !this.lowPower }, farDetail: { strength: 0.7, on: this.generatedFlag, single: this.lowPower }, fadeShadowEdge: true },
    );
    this.rockGround.half.value = halfExtent(this.model.grids[0]);
    this.rockGround.hasMap.value = 0;
    this.rockGround.map.value = null;
    this.rockGround.color.value.setScalar(0.2);
    if (!hasPhoto) material.color.setScalar(0.2);
    // Share the fine mesh's image (the photo, or the same imagery as the ground around) once it has it, so the two match in tone.
    fineMaterial.userData.onMap = () => {
      material.map = fineMaterial.map;
      this.mapSize.value = (fineMaterial.map!.image as HTMLImageElement).width;
      material.color.copy(fineMaterial.color);
      material.needsUpdate = true;
      if (hasPhoto) {
        this.rockGround.map.value = fineMaterial.map;
        this.rockGround.hasMap.value = 1;
        this.rockGround.color.value.copy(fineMaterial.color);
      }
    };
    if (fineMaterial.map) fineMaterial.userData.onMap();
    this.nearGeometry = geo;
    this.near = splitForCulling(geo, material, n, 6, 1);
    for (const piece of this.near.children) {
      piece.receiveShadow = true;
      // The near ground is never further than the near pass reaches.
      piece.layers.disable(FAR_LAYER);
    }
    this.near.visible = false;
    this.nearCentre = { east: NaN, north: NaN };
    this.nearBuild = null;
    this.terrain.add(this.near);
  }

  /**
   * Keeps the dense mesh around the viewer. Rebuilding it means working out up to 150,000
   * heights, so the work is spread over several frames (about `budgetMs` each) into scratch
   * buffers and swapped in when complete; the first build after arriving is done in one go.
   */
  private updateNear(east: number, north: number, budgetMs = 4): void {
    const near = this.near, fine = this.model.grids[0], field = this.nearField;
    if (!near || !fine || !field) return;
    const reach = NEAR_HALF_M, spacing = this.nearSpacing;
    if (Math.max(Math.abs(east), Math.abs(north)) > halfExtent(fine) - reach - 8) {
      near.visible = false;
      this.nearBuild = null;
      this.hole.value.z = 0;
      for (const r of this.rocks) r.mesh.count = 0;
      return;
    }
    const wandered = Math.max(Math.abs(east - this.nearCentre.east), Math.abs(north - this.nearCentre.north));
    if (!this.nearBuild && (!near.visible || !(wandered < NEAR_SLACK))) {
      this.nearBuild = { east: Math.round(east / NEAR_SNAP) * NEAR_SNAP, north: Math.round(north / NEAR_SNAP) * NEAR_SNAP, row: 0, pass: 0 };
    }
    const build = this.nearBuild;
    if (!build) return;

    const n = this.nearN, c = (n - 1) / 2;
    const drawnFine = this.levels[0].grid, uvAt = this.levels[0].uvAt;
    const uvTmp: [number, number] = [0, 0];
    const { pos, nrm, uv } = this.nearScratch;
    const p = new Vector3();
    const deadline = near.visible ? performance.now() + budgetMs : Infinity;
    while (performance.now() < deadline) {
      const j = build.row;
      if (build.pass === 0) {
        // Pass 1: positions.
        for (let i = 0; i < n; i++) {
          const e = build.east + (i - c) * spacing, nn = build.north + (j - c) * spacing;
          // At its rim the mesh settles onto the fine mesh's own surface, so the two join without a step.
          const rim = Math.min(1, (Math.min(i, j, n - 1 - i, n - 1 - j) * spacing) / 12);
          const blend = rim * rim * (3 - 2 * rim);
          const flat = sampleGrid(drawnFine, e, nn);
          const h = flat + (sampleSmooth(fine, e, nn) + this.model.detailAt(e, nn) + this.generatedAt(e, nn) - flat) * blend;
          this.model.point(e, nn, h, p).toArray(pos, (j * n + i) * 3);
          uvAt(e, nn, uvTmp);
          uv[(j * n + i) * 2] = uvTmp[0];
          uv[(j * n + i) * 2 + 1] = uvTmp[1];
        }
      } else {
        // Pass 2: normals, from the neighbouring positions.
        const jS = Math.max(0, j - 1), jN = Math.min(n - 1, j + 1);
        for (let i = 0; i < n; i++) {
          const w = (j * n + Math.max(0, i - 1)) * 3, e = (j * n + Math.min(n - 1, i + 1)) * 3;
          const lo = (jS * n + i) * 3, hi = (jN * n + i) * 3;
          const ax = pos[e] - pos[w], ay = pos[e + 1] - pos[w + 1], az = pos[e + 2] - pos[w + 2]; // towards east
          const bx = pos[hi] - pos[lo], by = pos[hi + 1] - pos[lo + 1], bz = pos[hi + 2] - pos[lo + 2]; // towards north
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nrm[(j * n + i) * 3] = nx / len;
          nrm[(j * n + i) * 3 + 1] = ny / len;
          nrm[(j * n + i) * 3 + 2] = nz / len;
        }
      }
      if (++build.row < n) continue;
      if (build.pass === 0) {
        build.pass = 1;
        build.row = 0;
        continue;
      }
      // Done: swap the finished mesh in.
      for (const [name, data] of [['position', pos], ['normal', nrm], ['uv', uv]] as const) {
        const attr = this.nearGeometry!.getAttribute(name) as Float32BufferAttribute;
        (attr.array as Float32Array).set(data);
        attr.needsUpdate = true;
      }
      for (let k = 0; k < n * n; k++) field.y[k] = pos[k * 3 + 1];
      field.east0 = build.east;
      field.north0 = build.north;
      refreshBounds(near);
      near.visible = true;
      this.nearCentre = { east: build.east, north: build.north };
      this.hole.value.set(build.east, -build.north, reach - 1.5);
      this.scatterRocks(build.east, build.north);
      this.placeSun();
      this.nearBuild = null;
      if (!this.shadowsDirty) this.sweepNear();
      break;
    }
  }

  /** Generated rocks (not measured) around a point. The same cell always gets the same rocks. */
  private scatterRocks(ce: number, cn: number): void {
    const q = new Quaternion(), scale = new Vector3(), p = new Vector3(), m = new Matrix4(), euler = new Euler();
    const counts = this.rocks.map(() => 0);
    const cells = Math.ceil(ROCK_REACH_M / ROCK_CELL_M);
    const c0e = Math.round(ce / ROCK_CELL_M), c0n = Math.round(cn / ROCK_CELL_M);
    const seed = this.site?.id ?? '';
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        const rand = seededRandom(`${seed}:${c0e + i}:${c0n + j}`);
        // About one rock per 25 square metres, mostly fist-sized, with the occasional boulder.
        const n = rand() < 0.45 ? 1 : rand() < 0.14 ? 2 : 0;
        for (let k = 0; k < n; k++) {
          const e = (c0e + i + rand() - 0.5) * ROCK_CELL_M, nn = (c0n + j + rand() - 0.5) * ROCK_CELL_M;
          const size = Math.min(0.9, 0.05 / Math.sqrt(1 - rand()));
          const variant = size >= BOULDER_SIZE_M ? SMALL_ROCK_SHAPES + Math.floor(rand() * BOULDER_SHAPES) : Math.floor(rand() * SMALL_ROCK_SHAPES);
          const squash = 0.55 + rand() * 0.5;
          const stretch = 0.75 + rand() * 0.6;
          const tilt = [rand() * 0.7 - 0.35, rand() * Math.PI * 2, rand() * 0.7 - 0.35];
          const set = this.rocks[variant];
          if (Math.hypot(e - ce, nn - cn) > ROCK_REACH_M || counts[variant] >= set.mesh.instanceMatrix.count) continue;
          // Like the other generated detail, rocks keep clear of the site itself, where the viewer first stands.
          if (Math.hypot(e, nn) < SITE_CLEAR_M + size) continue;
          this.model.point(e, nn, this.model.heightAt(e, nn), p);
          p.y += size * squash * 0.25; // sits partly buried
          scale.set(size * stretch, size * squash, size / stretch);
          q.setFromEuler(euler.set(tilt[0], tilt[1], tilt[2]));
          set.at[counts[variant] * 2] = e;
          set.at[counts[variant] * 2 + 1] = nn;
          set.mesh.setMatrixAt(counts[variant]++, m.compose(p, q, scale));
        }
      }
    }
    this.rocks.forEach((r, k) => {
      r.mesh.count = counts[k];
      r.mesh.instanceMatrix.needsUpdate = true;
      r.mesh.visible = this.generated;
    });
    this.sun.shadow.needsUpdate = true;
  }

  /** Shows or hides everything generated rather than measured: rocks, small craters and fine texture, crater shading on distant ground and, where no survey exists, the craters of the fine grid. */
  setGenerated(on: boolean): void {
    if (on === this.generated) return;
    this.generated = on;
    this.generatedFlag.value = on ? 1 : 0;
    for (const r of this.rocks) r.mesh.visible = on;
    this.sun.shadow.needsUpdate = true;
    const fineLevel = this.levels[0];
    if (fineLevel) fineLevel.material.bumpScale = on ? 0.15 : 0;
    if (this.relief && fineLevel) {
      // The larger generated craters are part of the fine mesh: rebuild it with or without them.
      const fine = this.model.grids[0];
      this.composeFine(fine);
      const drawn = this.lowPower ? decimate(fine, 2) : fine;
      fineLevel.grid = drawn;
      const n = drawn.n, c = (n - 1) / 2;
      const pos = fineLevel.geometry.getAttribute('position') as Float32BufferAttribute;
      const p = new Vector3();
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          this.model.point((i - c) * drawn.spacing, (j - c) * drawn.spacing, drawn.data[j * n + i], p);
          pos.setXYZ(j * n + i, p.x, p.y, p.z);
          fineLevel.field.y[j * n + i] = p.y;
        }
      }
      pos.needsUpdate = true;
      fineLevel.geometry.computeVertexNormals();
      refreshBounds(fineLevel.pieces);
    }
    // The small generated craters are part of the near mesh: it is rebuilt on the next step.
    if (this.near) this.near.visible = false;
    this.nearBuild = null;
    this.shadowsDirty = true;
    this.occlusionDirty = true;
  }

  /**
   * A marker at the exact site coordinates: a ring on the ground, a thin beam rising 400 m
   * from it and the site's name. Shown only once the viewer has walked away from the site,
   * to find it again.
   */
  private buildBeacon(): void {
    const g = this.beacon;
    g.clear();
    this.beaconLabel?.dispose();
    const color = new Color(BEACON_COLOR);
    const flat = (opacity: number) => new MeshBasicMaterial({ color, toneMapped: false, transparent: true, opacity, depthWrite: false });
    // The ring leaves the ground at the site itself uncovered.
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
    const beam = new Mesh(new ConeGeometry(0.3, 400, 8, 1, true), flat(0.45));
    const base = this.model.point(0, 0, this.model.heightAt(0, 0), p).y;
    beam.position.y = base + 200;
    g.add(ring, beam);
    g.traverse((o) => {
      o.layers.enable(NEAR_LAYER);
      o.layers.enable(FAR_LAYER);
    });
    const site = this.site!;
    this.beaconLabel = new Label([site.kind === 'custom' ? (site.name ?? 'Pinned site') : `${site.name ?? site.id} · landing site`], BEACON_COLOR, -0.9);
    this.beaconLabel.sprite.layers.enable(NEAR_LAYER);
    this.beaconLabel.sprite.userData.anchor = new Vector3(0, base + 3, 0);
    g.add(this.beaconLabel.sprite);
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

  /**
   * Sunlight for the current sky. Exposure works like a camera's: it is set so that level
   * ground seen at a typical angle keeps a steady mid-tone whatever the Sun's height. A low
   * Sun then shows as long shadows and strong relief, not as a dim (or burnt-out) scene.
   */
  private applyLight(): void {
    const s = this.sky;
    if (this.mode === 'real') {
      this.sun.visible = s.sun.y > -0.2;
      this.sun.intensity = ((Math.PI * 0.62) / levelGroundResponse(s.sun.y)) * (1 - this.sunBehindEarth);
    } else {
      // "Even" lighting: a fixed high light so every site is readable. Not the real Sun.
      this.sun.visible = true;
      this.sun.intensity = (Math.PI * 0.62) / levelGroundResponse(0.8);
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
    for (const level of this.levels) level.geometry.getAttribute('aSunLit').needsUpdate = true;
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
    const field = this.nearField, near = this.near, geometry = this.nearGeometry;
    if (!field || !near || !geometry || !near.visible) return;
    const s = this.sky;
    if (this.mode !== 'real' || !this.skyKnown) field.lit.fill(255);
    else if (s.sun.y < -0.2) field.lit.fill(0);
    else {
      const { azDeg, elDeg } = sceneToAzEl(s.sun);
      sweepSunlight(field, azDeg, elDeg, s.sunRadiusDeg, this.levels[0].field);
    }
    geometry.getAttribute('aSunLit').needsUpdate = true;
    for (const r of this.rocks) {
      for (let k = 0; k < r.mesh.count; k++) r.lit.setX(k, litAt(field, r.at[k * 2], r.at[k * 2 + 1]));
      r.lit.needsUpdate = true;
    }
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

  /** Starts recomputing the tracks. The sky model costs about half a millisecond per instant, so the work is spread over frames. */
  private rebuildPaths(): void {
    this.pathsDirty = false;
    const w = this.pathWindow;
    if (!w || !this.site) {
      this.pathJob = null;
      this.paths.setTracks(null, null);
      this.pathSteps = null;
      return;
    }
    // The old tracks belong to another site or window: gone at once, not when the new ones are ready.
    this.paths.setTracks(null, null);
    this.pathSteps = null;
    // One mark per step. The Sun moves about half a degree an hour; Earth only wanders a degree or two a day.
    const sunH = niceStepH(Math.max(1, w.durationH / 360)), earthH = niceStepH(Math.max(6, w.durationH / 200));
    this.pathJob = { ...w, sunH, earthH, hour: 0, body: 0, sun: [], earth: [], state: { ...this.sky, sun: new Vector3(), earth: new Vector3() } };
  }

  /** Works on the tracks for a few milliseconds; publishes them when both are complete. */
  private continuePaths(budgetMs: number): void {
    const job = this.pathJob;
    if (!job) return;
    const started = performance.now();
    const minY = Math.sin(-2 * DEG); // marks further below the horizontal would only litter the ground
    while (performance.now() - started < budgetMs) {
      const stepH = job.body === 0 ? job.sunH : job.earthH;
      if (job.hour > job.durationH + 1e-9) {
        if (job.body === 1) {
          this.paths.setTracks(new Float32Array(job.sun), new Float32Array(job.earth));
          this.pathSteps = { sunH: job.sunH, earthH: job.earthH, startMs: job.startMs, durationH: job.durationH };
          this.pathJob = null;
          return;
        }
        job.body = 1;
        job.hour = 0;
        continue;
      }
      this.computeSky(job.startMs + job.hour * 3_600_000, null, job.state);
      const v = job.body === 0 ? job.state.sun : job.state.earth;
      if (v.y >= minY) (job.body === 0 ? job.sun : job.earth).push(v.x, v.y, v.z);
      job.hour += stepH;
    }
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
      // A few milliseconds of a fast frame, a larger slice of a slow one, so the tracks never take long to appear.
      this.continuePaths(Math.min(150, Math.max(5, (now - this.lastStepAt) * 0.2)));
      this.lastStepAt = now;
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
    this.earthGlobe.update(cam, s.earth, s.earthRadiusDeg, this.sunFromEarth, this.earthPole, this.earthPrime, this.sunBehindEarth);
    this.paths.sky.visible = this.paths.overlay.visible = this.skyKnown;
    this.paths.update(cam, s.sun, s.earth, s.sunRadiusDeg, s.earthRadiusDeg, this.sunBehindEarth > 0.98 ? 2 : this.sunAboveTerrain < 0.02 ? 1 : 0, this.earthBehindTerrain, this.viewportHeight);

    // Fill light. The Moon has no sky light: shadows are lit only by sunlight scattered off
    // nearby ground, a few percent of the direct light. That is the base level. On top of it
    // the fill stands for the eye adapting: under a low Sun most of the view is shadow, and in
    // shadow or at night there is no glare, so more of the unlit ground can be made out.
    const lowSun = 1 - Math.min(1, Math.max(0, (s.sun.y - 0.035) / 0.22));
    const dazzle = real && s.sun.y > -0.02 ? sunShowing : 0;
    // Night with Earth in the sky: the ground is lit by earthshine, from Earth's direction,
    // bluish, and brighter the fuller Earth is. While Earth hides the Sun (an eclipse) that
    // light is the red of sunlight bent through Earth's air. Without Earth, only the fill.
    const earthUp = Math.min(1, Math.max(0, (s.earth.y - 0.01) / 0.03));
    const night = real && this.skyKnown ? 1 - dazzle : 0;
    const shine = night * earthUp * ((Math.PI * (0.05 + 0.2 * s.earthLit)) / Math.max(s.earth.y, 0.15));
    earthshine.light.value.set(0.72 + 0.28 * this.sunBehindEarth, 0.84 - 0.42 * this.sunBehindEarth, 1 - 0.76 * this.sunBehindEarth).multiplyScalar(shine);
    earthshine.direction.value.copy(s.earth).transformDirection(cam.matrixWorldInverse);
    const dayFill = 0.1 + 0.14 * lowSun, nightFill = 0.34 - 0.2 * earthUp;
    this.ambient.intensity = real ? dayFill + (nightFill - dayFill) * night : 0.3;
    // 0 with the Sun on the horizon, 1 with it overhead: tone matters more as shading fades.
    lightHeight.value = real ? Math.max(0, s.sun.y) * (1 - night) : 0.8;

    // The site marker appears once the viewer has left the site. Its name is drawn over the
    // terrain, towards the site, so the way back can be found from behind a rise.
    const away = Math.hypot(cam.position.x, cam.position.z);
    this.beacon.visible = away > 25;
    if (this.beaconLabel && this.beacon.visible) {
      const anchor = this.beaconLabel.sprite.userData.anchor as Vector3;
      const to = this.scratch.copy(anchor).sub(cam.position);
      const d = to.length();
      this.beaconLabel.place(cam, to.multiplyScalar(Math.min(1, 1000 / d)).add(cam.position), 0, this.viewportHeight);
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
    // Asked for between frames (an action right after a time change): bring the terrain test up to date first.
    if (this.occlusionDirty && this.levels.length) this.updateOcclusion();
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
    this.nearGeometry = null;
    this.nearField = null;
    this.nearBuild = null;
    this.beaconLabel?.dispose();
    this.beaconLabel = null;
    this.levels = [];
    for (const r of this.rocks) r.mesh.count = 0;
    this.rockGround.map.value = null;
    this.rockGround.hasMap.value = 0;
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
      mat.normalMap?.dispose();
      mat.dispose();
    });
    for (const m of this.mosaics) m.dispose();
    this.mosaics = [];
    this.terrain.clear();
  }
}

/**
 * How bright level ground looks under a Sun at the given sine of elevation, relative to a
 * matte surface lit from straight above: the lunar reflectance of materials.ts evaluated for
 * a middling view (emission cosine 0.2, looking across the Sun's direction at 60 degrees
 * phase, where L = 0.42). The Sun is treated as at least 1.7 degrees up, so the last moments
 * of a sunset dim instead of flaring.
 */
function levelGroundResponse(sinElevation: number): number {
  const mu0 = Math.max(0.03, sinElevation);
  return 0.42 * Math.min((2 * mu0) / (mu0 + 0.2), 0.8) + 0.58 * mu0;
}

/** Colour of the site marker (design token --accent). */
const BEACON_COLOR = '#8fb8ff';

/** Direction of the artificial key light in "even" mode. */
const EVEN_LIGHT = new Vector3(0.35, 0.8, 0.5).normalize();
