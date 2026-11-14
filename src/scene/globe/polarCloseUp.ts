// The south-polar close-up. Near the pole the photographic maps are useless (equirectangular
// images stretch into streaks), so poleward of about 80S the surface is drawn from the
// bundled LOLA polar elevation layers instead: real relief, shaded by the Sun's direction at
// the simulated time, with the long shadows the terrain really casts (polarShadow.ts).
// It is shaded relief computed from elevation data, not a photograph, and the UI says so.
//
// Two pieces: the whole 80S square at 640 m (always, once the camera is low enough), and a
// 1024 x 1024 window of the finest layer around the point of interest (40, 80 or 160 m).
import { BufferAttribute, BufferGeometry, DataTexture, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RedFormat, RGBAFormat, UnsignedByteType, Vector2, Vector4, type IUniform, type Texture } from 'three';
import { MOON_RADIUS_M } from '../../core/types';
import { loadTerrainFor } from '../../terrain/api';
import { polarXY } from '../../terrain/geo';
import { cutWindow, decimate, gridCell, gridCovers, gridHeight, gridLatLon, gridX, gridY, groundCell, heightsAbovePolarPlane, layerHalfWidth, normalMap, type PolarGrid, type PolarLayer } from './polarGrid';
import { litFraction, sampleField, SUN_RADIUS_RAD, sunOverSouthPole, sweepShadowHeight } from './polarShadow';
import { dirOf } from './reliefTiles';
import { patchSurfaceMaterial, type SurfaceUniforms } from './surfaceShader';

/** The close-up shows below this camera altitude, fully from `FULL_BELOW_KM` down. */
const GONE_ABOVE_KM = 1400;
const FULL_BELOW_KM = 900;
/** Latitude where the close-up is fully opaque, and where it has faded into the photographic globe. */
const SOLID_LAT = -81;
const EDGE_LAT = -80.1;
/** Samples per side of the fine window, and mesh cells per side of each piece. */
const WINDOW = 1024;
const WIDE_SEGMENTS = 192;
const FINE_SEGMENTS = 256;
/** How far the wide piece is lowered under the fine window, metres: more than its 3 km facets can stand above the true surface. */
const SINK_M = 700;
/** Regolith grey of the shaded relief (no albedo map exists in this projection). */
const SURFACE_COLOUR = 0x8e8e8e;
const sinDeg = (deg: number) => Math.sin((deg * Math.PI) / 180);

interface Piece {
  grid: PolarGrid;
  /** Heights above the plane through the pole, for the shadow sweep. */
  z: Float32Array;
  ground: number;
  low: Float32Array;
  high: Float32Array;
  lit: Uint8Array;
  shadow: DataTexture;
  normal: DataTexture;
  mesh: Mesh;
  material: MeshStandardMaterial;
  uniforms: { uShadowMap: IUniform<Texture | null>; uShadowOn: IUniform<number>; uFade: IUniform<number>; uFadeLat: IUniform<Vector2>; uEdgeFade: IUniform<number>; uCut: IUniform<Vector4>; uSink: IUniform<Vector4>; uSinkDepth: IUniform<number> };
  /** Resolution of the layer it was cut from, metres. */
  sourceM: number;
}

export interface PolarView {
  altitudeKm: number;
  /** Point under the screen centre. */
  centre: { lat: number; lon: number };
  /** The selected site, when there is one. */
  site: { lat: number; lon: number } | null;
  /** Unit vector to the Sun, Moon-fixed (x: 0N 0E, y: 0N 90E, z: north). */
  sunDir: readonly [number, number, number];
  realLight: boolean;
  nowMs: number;
}

export interface PolarStatus {
  /** Grid spacing of the finest piece on screen, metres. */
  resolutionM: number;
  shadows: boolean;
}

export class PolarCloseUp {
  readonly root = new Group();
  private layers: PolarLayer[] | null = null;
  private loading = false;
  private wide: Piece | null = null;
  private fine: Piece | null = null;
  private swept = { ux: NaN, uy: NaN, el: NaN, at: 0 };
  /** The rest of a shadow update in progress: one sweep per frame. */
  private steps: (() => unknown)[] = [];
  private lastFineAt = 0;
  private opacity = 0;
  /** Why the close-up could not be built, when it could not. */
  problem: string | null = null;
  /** Called when a piece was built: markers on the cap re-read their heights. */
  onData: (() => void) | null = null;

  constructor(private readonly shared: SurfaceUniforms) {}

  /** Height above the reference sphere from the polar layers, metres, or null where the close-up does not reach. */
  heightM(lat: number, lon: number): number | null {
    if (lat > EDGE_LAT || !this.wide) return null;
    const { x, y } = polarXY('S', lat, lon);
    for (const piece of [this.fine, this.wide]) {
      if (!piece) continue;
      const h = gridHeight(piece.grid, x, y);
      if (Number.isFinite(h)) return h;
    }
    return null;
  }

  /** True while the close-up covers this point on screen. */
  covers(lat: number): boolean {
    return this.opacity > 0.5 && lat < SOLID_LAT;
  }

  /** Call every frame. Returns what is on screen, or null when the close-up is not showing. */
  update(view: PolarView): PolarStatus | null {
    const wanted = view.altitudeKm < GONE_ABOVE_KM * 1.15 && (view.centre.lat < -55 || (view.site?.lat ?? 0) < EDGE_LAT);
    if (wanted && !this.layers && !this.loading) void this.load();
    const t = Math.min(1, Math.max(0, (GONE_ABOVE_KM - view.altitudeKm) / (GONE_ABOVE_KM - FULL_BELOW_KM)));
    this.opacity = this.wide ? t * t * (3 - 2 * t) : 0;
    this.root.visible = this.opacity > 0.001;
    // The photographic tiles are left out under the solid part of the close-up, so they cannot poke through it.
    this.shared.uCapHole.value = this.opacity >= 0.999 ? sinDeg(SOLID_LAT - 0.2) : -2;
    if (!this.wide || !this.root.visible) return null;

    this.chooseWindow(view);
    for (const piece of [this.wide, this.fine]) {
      if (!piece) continue;
      piece.uniforms.uFade.value = this.opacity;
      piece.uniforms.uShadowOn.value = view.realLight ? 1 : 0;
    }
    if (view.realLight) this.sweep(view);
    return { resolutionM: this.fine?.grid.cellM ?? this.wide.grid.cellM, shadows: view.realLight };
  }

  private async load(): Promise<void> {
    this.loading = true;
    try {
      // A pin at the pole is within reach of every south-polar layer: this is the terrain module's own loader.
      const stack = await loadTerrainFor({ id: 'pin:-90.00000,0.00000', name: 'South pole', kind: 'custom', lat: -90, lon: 0 }, { remote: false });
      const layers: PolarLayer[] = [];
      for (const s of stack.sources) if (s.descriptor.kind === 'polar' && s.descriptor.pole === 'S') layers.push(s.descriptor);
      if (!layers.length) throw new Error('no south-polar elevation layer is installed');
      layers.sort((a, b) => a.metresPerPx - b.metresPerPx);
      this.layers = layers;
      const widest = layers[layers.length - 1];
      // About 640 m per cell over the whole square: 950 x 950 for the 160 m layer.
      this.wide = this.build(decimate(widest, Math.max(1, Math.round(640 / widest.metresPerPx))), WIDE_SEGMENTS, widest.metresPerPx, false);
      this.root.add(this.wide.mesh);
      this.problem = null;
      this.onData?.();
    } catch (err) {
      this.problem = `The south-polar elevation layers could not be loaded (${err instanceof Error ? err.message : String(err)}).`;
      console.warn(this.problem);
    } finally {
      this.loading = false;
    }
  }

  /** Builds or moves the fine window: around the selected site, else around the screen centre once the camera is low. */
  private chooseWindow(view: PolarView): void {
    if (!this.layers || !this.wide) return;
    // The fine window goes where the camera is looking: around the selected site while it is on screen, else around the screen centre.
    const centreXY = polarXY('S', view.centre.lat, view.centre.lon);
    let target: { x: number; y: number } | null = null;
    if (view.site && view.site.lat < EDGE_LAT) {
      const s = polarXY('S', view.site.lat, view.site.lon);
      const onScreen = view.centre.lat < -60 && Math.hypot(s.x - centreXY.x, s.y - centreXY.y) < (view.altitudeKm * 0.8 + 15) * 1000;
      if (onScreen) target = s;
    }
    if (!target && view.altitudeKm < 600 && view.centre.lat < SOLID_LAT) target = centreXY;
    if (!target) return;
    const { x, y } = target;
    if (this.fine) {
      // Still well inside the present window: keep it.
      const [c, r] = gridCell(this.fine.grid, x, y);
      const margin = WINDOW * 0.2;
      const inside = c > margin && r > margin && c < WINDOW - 1 - margin && r < WINDOW - 1 - margin;
      // A window pushed against its layer's edge cannot centre the target better: keep it too.
      const layer = this.layers.find((l) => l.metresPerPx === this.fine!.sourceM)!;
      const pinned = gridCovers(this.fine.grid, x, y) && Math.max(Math.abs(x), Math.abs(y)) > layerHalfWidth(layer) - WINDOW * 0.3 * layer.metresPerPx;
      const finer = this.layers.find((l) => l.metresPerPx < this.fine!.sourceM && Math.max(Math.abs(x), Math.abs(y)) < layerHalfWidth(l));
      if ((inside || pinned) && !finer) return;
    }
    if (view.nowMs - this.lastFineAt < 500) return; // building a window takes a few frames' worth of time
    for (const layer of this.layers) {
      const grid = layer.size >= WINDOW ? cutWindow(layer, x, y, WINDOW) : null;
      if (!grid) continue;
      this.lastFineAt = view.nowMs;
      this.disposePiece(this.fine);
      this.fine = this.build(grid, FINE_SEGMENTS, layer.metresPerPx, true);
      this.root.add(this.fine.mesh);
      // The wide piece is not drawn under the window's solid part.
      const [c0, r0] = gridCell(this.wide.grid, gridX(grid, 0), gridY(grid, 0));
      const [c1, r1] = gridCell(this.wide.grid, gridX(grid, WINDOW - 1), gridY(grid, WINDOW - 1));
      const n = this.wide.grid.n, inset = 0.06 * (c1 - c0);
      this.wide.uniforms.uCut.value.set((c0 + inset + 0.5) / n, (r0 + inset + 0.5) / n, (c1 - inset + 0.5) / n, (r1 - inset + 0.5) / n);
      // In the feathered border both are drawn: there the wide piece is lowered so the window always lies in front.
      this.wide.uniforms.uSink.value.set((c0 + 0.5) / n, (r0 + 0.5) / n, (c1 + 0.5) / n, (r1 + 0.5) / n);
      this.steps = [];
      this.swept.el = NaN; // sweep again, now with the window
      this.onData?.();
      return;
    }
  }

  private build(grid: PolarGrid, segments: number, sourceM: number, fine: boolean): Piece {
    const n = grid.n, count = n * n;
    const lit = new Uint8Array(count).fill(255);
    const shadow = new DataTexture(lit, n, n, RedFormat, UnsignedByteType);
    shadow.magFilter = LinearFilter;
    shadow.minFilter = LinearMipmapLinearFilter;
    shadow.generateMipmaps = true;
    shadow.needsUpdate = true;
    const normal = new DataTexture(normalMap(grid), n, n, RGBAFormat, UnsignedByteType);
    normal.magFilter = LinearFilter;
    normal.minFilter = LinearMipmapLinearFilter;
    normal.generateMipmaps = true;
    normal.needsUpdate = true;

    // Mesh: a regular grid over the piece. Positions on the unit sphere; the shader adds the height.
    const side = segments + 1;
    const position = new Float32Array(side * side * 3), uv = new Float32Array(side * side * 2), height = new Float32Array(side * side);
    for (let j = 0; j < side; j++) {
      const row = (j * (n - 1)) / segments;
      for (let i = 0; i < side; i++) {
        const col = (i * (n - 1)) / segments;
        const k = j * side + i;
        const { lat, lon } = gridLatLon(grid, col, row);
        dirOf(lat, lon, position, k * 3);
        uv[k * 2] = (col + 0.5) / n;
        uv[k * 2 + 1] = (row + 0.5) / n;
        height[k] = gridHeight(grid, gridX(grid, col), gridY(grid, row)) / MOON_RADIUS_M;
      }
    }
    const index = new Uint32Array(segments * segments * 6);
    let o = 0;
    for (let j = 0; j < segments; j++) {
      for (let i = 0; i < segments; i++) {
        const a = j * side + i, b = a + 1, c = a + side, d = c + 1;
        // The map is the view from outside (x to the right, y up, rows downwards): counter-clockwise as seen from there.
        index[o++] = a; index[o++] = c; index[o++] = b;
        index[o++] = b; index[o++] = c; index[o++] = d;
      }
    }
    const geometry = new BufferGeometry();
    const positionAttr = new BufferAttribute(position, 3);
    geometry.setAttribute('position', positionAttr);
    geometry.setAttribute('normal', positionAttr);
    geometry.setAttribute('uv', new BufferAttribute(uv, 2));
    geometry.setAttribute('aHeight', new BufferAttribute(height, 1));
    geometry.setIndex(new BufferAttribute(index, 1));

    const uniforms: Piece['uniforms'] = {
      uShadowMap: { value: shadow },
      uShadowOn: { value: 1 },
      uFade: { value: 0 },
      // The wide piece fades into the photographic globe towards the edge of the data; the window fades at its own border.
      uFadeLat: { value: fine ? new Vector2(2, 3) : new Vector2(sinDeg(SOLID_LAT), sinDeg(EDGE_LAT)) },
      uEdgeFade: { value: fine ? 0.05 : 0 },
      uCut: { value: new Vector4(2, 2, 2, 2) },
      uSink: { value: new Vector4(2, 2, 2, 2) },
      uSinkDepth: { value: SINK_M / MOON_RADIUS_M },
    };
    const material = new MeshStandardMaterial({
      color: SURFACE_COLOUR,
      roughness: 1,
      metalness: 0,
      normalMap: normal,
      transparent: true,
      // Slightly towards the camera in depth, so it wins where it meets the surface it replaces.
      polygonOffset: true,
      polygonOffsetFactor: fine ? -4 : -2,
      polygonOffsetUnits: fine ? -16 : -8,
    });
    patchSurfaceMaterial(material, this.shared, { polar: uniforms });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = fine ? 2 : 1;
    return { grid, z: heightsAbovePolarPlane(grid), ground: groundCell(grid), low: new Float32Array(count), high: new Float32Array(count), lit, shadow, normal, mesh, material, uniforms, sourceM };
  }

  /**
   * Recomputes the shadows when the Sun has moved enough to see. One sweep of one piece per
   * frame (four frames for a full update), so a running clock does not stall the picture.
   */
  private sweep(view: PolarView): void {
    if (!this.wide) return;
    if (this.steps.length) {
      this.steps.shift()!();
      return;
    }
    const sun = sunOverSouthPole(view.sunDir);
    const len = Math.hypot(sun.ux, sun.uy) || 1;
    const ux = sun.ux / len, uy = sun.uy / len;
    const turned = Math.acos(Math.min(1, Math.max(-1, ux * this.swept.ux + uy * this.swept.uy)));
    const moved = !(turned < 0.0015) || !(Math.abs(sun.elevationRad - this.swept.el) < 0.0002); // 0.09 deg round the horizon, 0.01 deg in height
    if (!moved) return;
    this.swept = { ux, uy, el: sun.elevationRad, at: view.nowMs };
    const tanLow = Math.tan(sun.elevationRad + SUN_RADIUS_RAD), tanHigh = Math.tan(sun.elevationRad - SUN_RADIUS_RAD);
    const wide = this.wide, fine = this.fine;
    const grid = (p: Piece) => ({ n: p.grid.n, z: p.z, cellM: p.ground });
    // Shadows arriving at the window's border come from the wide piece (terrain up to 300 km away).
    const edge = (field: Float32Array) => (col: number, row: number) => {
      const [c, r] = gridCell(wide.grid, gridX(fine!.grid, col), gridY(fine!.grid, row));
      return sampleField(field, wide.grid.n, c, r);
    };
    const publish = (p: Piece) => {
      litFraction(p.z, p.low, p.high, p.lit);
      p.shadow.needsUpdate = true;
    };
    this.steps = [
      () => sweepShadowHeight(grid(wide), ux, uy, tanLow, wide.low),
      () => {
        sweepShadowHeight(grid(wide), ux, uy, tanHigh, wide.high);
        publish(wide);
      },
    ];
    if (fine) {
      this.steps.push(
        () => this.fine === fine && sweepShadowHeight(grid(fine), ux, uy, tanLow, fine.low, edge(wide.low)),
        () => {
          if (this.fine !== fine) return;
          sweepShadowHeight(grid(fine), ux, uy, tanHigh, fine.high, edge(wide.high));
          publish(fine);
        },
      );
    }
    this.steps.shift()!();
  }

  private disposePiece(piece: Piece | null): void {
    if (!piece) return;
    this.root.remove(piece.mesh);
    piece.mesh.geometry.dispose();
    piece.material.dispose();
    piece.shadow.dispose();
    piece.normal.dispose();
  }

  dispose(): void {
    this.disposePiece(this.fine);
    this.disposePiece(this.wide);
    this.fine = this.wide = null;
    this.shared.uCapHole.value = -2;
  }
}
