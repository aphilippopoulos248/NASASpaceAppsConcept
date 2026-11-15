// The Moon's surface as real geometry: latitude/longitude tiles displaced by the whole-Moon
// LOLA elevation grid, finer where the camera is close (see reliefTiles.ts for the scheme).
// The colour and normal maps are the existing equirectangular textures; the tiles share one
// material, and the vertex shader applies the exaggeration, so changing it costs nothing.
import { BufferAttribute, BufferGeometry, Frustum, Group, Material, Matrix4, Mesh, PerspectiveCamera, Sphere, Vector3 } from 'three';
import { loadGlobalGrid } from '../../terrain/api';
import { HeightPyramid } from './heightPyramid';
import { buildTileArrays, MAX_HEIGHT_R, maxLevelFor, rootTiles, selectTiles, tileCap, tileKey, tilePpd, type LodView, type TileId } from './reliefTiles';

/** A tile is split while its cells are larger than this on screen. */
const CELL_PX = 8;
/** Tiles built or rebuilt per frame at most (each takes a fraction of a millisecond). */
const BUILDS_PER_FRAME = 12;
const MAX_TILES = 700;
/** Rounds of asking for the 16 px/deg grid (each one is three tries in the loader), and the pause after the first failed round, seconds (doubled after the second). */
const FINE_ROUNDS = 3;
const FINE_RETRY_S = 20;

interface Tile {
  id: TileId;
  mesh: Mesh;
  /** Version of the height data the geometry was built from. */
  version: number;
  lastDrawn: number;
  centre: Vector3;
  /** Radius of a sphere around `centre` holding the undisplaced tile, Moon radii. */
  radius: number;
}

export class ReliefGlobe {
  readonly root = new Group();
  readonly pyramid = new HeightPyramid();
  private readonly tiles = new Map<string, Tile>();
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly sphere = new Sphere();
  private readonly caps = new Map<string, { centre: Vector3; radius: number }>();
  private version = 0;
  private frame = 0;
  private builds = 0;
  private fineRequested = false;
  /** Failed loads of the 16 px/deg grid so far, and when it may be asked for again. */
  private fineFailures = 0;
  private fineRetryAt = 0;
  /** Set when a grid could not be loaded: shown instead of pretending there is relief. */
  problem: string | null = null;
  /** Settles when the grid being fetched (if any) has been taken in. */
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly material: Material,
    /** Milliseconds, for the pause before asking again (tests pass their own clock). */
    private readonly now: () => number = () => performance.now(),
  ) {
    for (const t of rootTiles()) this.build(t);
  }

  /** Number of times the height data changed: compare to know when heights must be read again. */
  get dataVersion(): number {
    return this.version;
  }

  /** The small whole-Moon grid (4 samples per degree): quick to load, enough for the view from orbit. */
  loadOverview(): Promise<void> {
    return (this.pending = this.load(4));
  }

  /** Resolves when no elevation grid is being fetched any more (tests, and callers that want to wait). */
  settled(): Promise<void> {
    return this.pending;
  }

  private async load(ppd: 4 | 16): Promise<void> {
    try {
      const source = await loadGlobalGrid(ppd);
      const d = source.descriptor;
      if (d.kind !== 'equirect') throw new Error('the whole-Moon grid is not equirectangular');
      this.pyramid.add(d, 1);
      this.version++;
      this.problem = null;
      if (ppd === 16) this.fineFailures = 0;
    } catch (err) {
      this.problem = `The ${ppd} px/deg whole-Moon elevation grid could not be loaded (${err instanceof Error ? err.message : String(err)}).`;
      if (ppd === 16) {
        // The loader has already tried three times. Ask again later, a few rounds, and say so meanwhile:
        // the globe does not stay on the coarser relief without telling.
        this.fineFailures++;
        const coarser = this.pyramid.maxPpd ? ` The globe shows the ${this.pyramid.maxPpd} px/deg relief` : ' The globe shows no relief';
        if (this.fineFailures < FINE_ROUNDS) {
          const waitS = FINE_RETRY_S * this.fineFailures;
          this.fineRequested = false;
          this.fineRetryAt = this.now() + waitS * 1000;
          this.problem += `${coarser} and tries again in ${waitS} s.`;
        } else this.problem += `${coarser}.`;
      }
      console.warn(this.problem);
    }
  }

  /** Height above the reference sphere in metres, from the finest grid loaded (0 before any has arrived). */
  heightM(lat: number, lon: number): number {
    return this.pyramid.sample(lat, lon);
  }

  private cap(t: TileId): { centre: Vector3; radius: number } {
    const key = tileKey(t);
    let c = this.caps.get(key);
    if (!c) {
      const { centre, radius } = tileCap(t);
      // Chord from the centre to the farthest corner.
      c = { centre: new Vector3(centre[0], centre[1], centre[2]), radius: 2 * Math.sin(radius / 2) };
      this.caps.set(key, c);
    }
    return c;
  }

  private build(t: TileId): Tile {
    const key = tileKey(t);
    const ppd = tilePpd(t.level);
    const a = buildTileArrays(t, (lat, lon) => this.pyramid.sample(lat, lon, ppd));
    const geometry = new BufferGeometry();
    const position = new BufferAttribute(a.position, 3);
    geometry.setAttribute('position', position);
    geometry.setAttribute('normal', position); // on the unit sphere the normal is the position
    geometry.setAttribute('uv', new BufferAttribute(a.uv, 2));
    geometry.setAttribute('aHeight', new BufferAttribute(a.height, 1));
    geometry.setAttribute('aSkirt', new BufferAttribute(a.skirt, 1));
    geometry.setIndex(new BufferAttribute(a.index, 1));
    const old = this.tiles.get(key);
    let tile: Tile;
    if (old) {
      old.mesh.geometry.dispose();
      old.mesh.geometry = geometry;
      old.version = this.version;
      tile = old;
    } else {
      const mesh = new Mesh(geometry, this.material);
      mesh.frustumCulled = false; // chosen below, with room for the displacement
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      const { centre, radius } = this.cap(t);
      tile = { id: t, mesh, version: this.version, lastDrawn: this.frame, centre, radius };
      this.tiles.set(key, tile);
    }
    return tile;
  }

  /**
   * Chooses and shows the tiles for this camera. `relief` is the exaggeration being drawn.
   * Returns how many tiles are on screen.
   */
  update(camera: PerspectiveCamera, viewportHeightPx: number, relief: number): number {
    this.frame++;
    this.builds = 0;
    const maxLevel = maxLevelFor(this.pyramid.maxPpd);
    const maxDisplacement = Math.max(0, relief) * MAX_HEIGHT_R;
    const view: LodView = {
      cam: [camera.position.x, camera.position.y, camera.position.z],
      pxPerRad: viewportHeightPx / ((camera.fov * Math.PI) / 180),
      cellPx: CELL_PX,
      // Until the 16 px/deg grid is in memory there is nothing finer to show than level 3.
      maxLevel: this.pyramid.maxPpd >= 16 ? maxLevel : Math.max(maxLevel, 5),
      maxDisplacement,
    };
    this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    const inView = (t: TileId): boolean => {
      const c = this.cap(t);
      this.sphere.center.copy(c.centre);
      this.sphere.radius = c.radius + maxDisplacement + 0.06;
      return this.frustum.intersectsSphere(this.sphere);
    };
    let wantsFiner = false;
    const available = (t: TileId): boolean => {
      // Levels the present data cannot fill are not built: their parent is drawn, and the finer grid is fetched.
      if (t.level > maxLevel) {
        wantsFiner = true;
        return false;
      }
      const tile = this.tiles.get(tileKey(t));
      if (tile) return true;
      if (this.builds >= BUILDS_PER_FRAME) return false;
      this.builds++;
      this.build(t);
      return true;
    };
    const chosen = selectTiles(view, available, inView);
    if (wantsFiner && !this.fineRequested && this.now() >= this.fineRetryAt) {
      this.fineRequested = true;
      this.pending = this.load(16);
    }
    for (const tile of this.tiles.values()) tile.mesh.visible = false;
    for (const id of chosen) {
      const tile = this.tiles.get(tileKey(id))!;
      // Geometry from older height data is still drawn; it is rebuilt a few tiles per frame.
      if (tile.version !== this.version && this.builds < BUILDS_PER_FRAME) {
        this.builds++;
        this.build(id);
      }
      tile.mesh.visible = true;
      tile.lastDrawn = this.frame;
    }
    if (this.tiles.size > MAX_TILES) this.evict();
    return chosen.length;
  }

  /** Forgets tiles that have not been on screen for a while (root tiles stay). */
  private evict(): void {
    for (const [key, tile] of this.tiles) {
      if (tile.id.level === 0 || this.frame - tile.lastDrawn < 240) continue;
      tile.mesh.geometry.dispose();
      this.root.remove(tile.mesh);
      this.tiles.delete(key);
    }
  }
}
