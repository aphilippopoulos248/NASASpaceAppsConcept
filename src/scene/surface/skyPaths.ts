// Sky annotations of the surface scene: the Sun's path and Earth's libration path over the
// mission window as dotted tracks, and small name labels for the two bodies.
//
// Each track is drawn twice from the same points:
//   - filled marks, placed in the sky beyond the terrain, so the terrain in front hides them;
//   - hollow marks, drawn over everything.
// Where the sky is open the filled mark shows; where the track runs behind terrain only the
// hollow one is left. So "filled = above the skyline, hollow = hidden", exactly along the
// skyline as drawn, the same code as the skyline chart (filled = lit, hollow = blocked).
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { SKY_DISTANCE } from './skyBodies';

/** Colours shared with the HUD and the chart (design tokens --sun and --earth). */
export const SUN_COLOR = '#ffd479';
export const EARTH_COLOR = '#6fb4ff';

/** Distance of the overlay marks from the camera, metres: inside the near depth range, drawn without depth test. */
const OVERLAY_DISTANCE = 1000;

type Shape = 'disc' | 'ring' | 'diamond' | 'diamond-ring';
const shapeCache = new Map<Shape, CanvasTexture>();

function shapeTexture(shape: Shape): CanvasTexture {
  let t = shapeCache.get(shape);
  if (t) return t;
  const size = 64, c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineWidth = size * 0.13;
  ctx.beginPath();
  if (shape === 'disc' || shape === 'ring') {
    ctx.arc(size / 2, size / 2, size * (shape === 'disc' ? 0.36 : 0.32), 0, Math.PI * 2);
  } else {
    const r = size * (shape === 'diamond' ? 0.42 : 0.36);
    ctx.moveTo(size / 2, size / 2 - r);
    ctx.lineTo(size / 2 + r, size / 2);
    ctx.lineTo(size / 2, size / 2 + r);
    ctx.lineTo(size / 2 - r, size / 2);
    ctx.closePath();
  }
  if (shape === 'disc' || shape === 'diamond') ctx.fill();
  else ctx.stroke();
  t = new CanvasTexture(c);
  shapeCache.set(shape, t);
  return t;
}

/** Where the Sun and Earth are now, so that hollow marks are not drawn across their discs. */
interface BodyMask {
  uSunDir: { value: Vector3 };
  uSunCos: { value: number };
  uEarthDir: { value: Vector3 };
  uEarthCos: { value: number };
}

function trackMaterial(shape: Shape, color: string, sizePx: number, overlay: boolean, mask: BodyMask): PointsMaterial {
  const material = new PointsMaterial({
    map: shapeTexture(shape),
    color,
    size: sizePx,
    sizeAttenuation: false,
    transparent: true,
    opacity: overlay ? 0.7 : 1,
    depthWrite: false,
    depthTest: !overlay,
    toneMapped: false,
  });
  if (overlay) {
    // The hollow marks are drawn over everything, which would include the Sun and Earth themselves: leave those out.
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, mask);
      shader.vertexShader =
        'uniform vec3 uSunDir;\nuniform float uSunCos;\nuniform vec3 uEarthDir;\nuniform float uEarthCos;\n' +
        shader.vertexShader.replace(
          '#include <project_vertex>',
          '#include <project_vertex>\n\tvec3 lunyxDir = normalize( position );\n\tif ( dot( lunyxDir, uSunDir ) > uSunCos || dot( lunyxDir, uEarthDir ) > uEarthCos ) gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );',
        );
    };
    material.customProgramCacheKey = () => 'lunyx-track-overlay';
  }
  return material;
}

/** A short text drawn to a texture, for a label that keeps its size on screen. */
function textTexture(text: string, color: string): { texture: Texture; aspect: number } {
  const scale = 3, font = `600 ${13 * scale}px "Inter Variable", Inter, system-ui, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 8 * scale, h = 20 * scale;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  // Dark edge so the label reads over bright ground as well as black sky.
  ctx.lineWidth = 4 * scale;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(text, w / 2, h / 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  return { texture: new CanvasTexture(c), aspect: w / h };
}

/** A text label that keeps its size on screen and is drawn over everything. */
export class Label {
  readonly sprite: Sprite;
  private readonly variants: { texture: Texture; aspect: number }[];
  private shown = 0;

  /** @param anchorY where the label hangs relative to its point, in label heights: 1.5 = just under it, -0.9 = just above. */
  constructor(texts: string[], color: string, anchorY = 1.5) {
    this.variants = texts.map((t) => textTexture(t, color));
    this.sprite = new Sprite(new SpriteMaterial({ map: this.variants[0].texture, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.sprite.center.set(0.5, anchorY);
    this.sprite.renderOrder = 11;
    this.sprite.frustumCulled = false;
  }

  /** Puts the label at a world position, 20 CSS pixels tall whatever the zoom and distance. */
  place(camera: PerspectiveCamera, position: Vector3, variant: number, viewportHeightPx: number): void {
    if (variant !== this.shown) {
      this.shown = variant;
      const m = this.sprite.material;
      m.map = this.variants[variant].texture;
      m.needsUpdate = true;
    }
    this.sprite.position.copy(position);
    const k = (20 * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
    this.sprite.scale.set(k * this.variants[variant].aspect, k, 1);
  }

  dispose(): void {
    for (const v of this.variants) v.texture.dispose();
    this.sprite.material.dispose();
  }
}

interface Track {
  sky: Points<BufferGeometry, PointsMaterial>;
  overlay: Points<BufferGeometry, PointsMaterial>;
}

export class SkyPaths {
  /** Marks placed in the sky (hidden by terrain in front of them). */
  readonly sky = new Group();
  /** Marks and labels drawn over everything. */
  readonly overlay = new Group();
  private readonly tracks: Track[] = [];
  private readonly sunLabel = new Label(['Sun', 'Sun (behind terrain)', 'Sun (behind Earth)'], SUN_COLOR);
  private readonly earthLabel = new Label(['Earth', 'Earth (behind terrain)'], EARTH_COLOR);
  private tracksOn = true;
  private labelsOn = true;
  private readonly at = new Vector3();
  private readonly down = new Vector3();
  private readonly mask: BodyMask = { uSunDir: { value: new Vector3(0, 1, 0) }, uSunCos: { value: 2 }, uEarthDir: { value: new Vector3(0, 1, 0) }, uEarthCos: { value: 2 } };

  constructor() {
    // Sun: circles. Earth: diamonds. Filled in the sky, hollow over the terrain.
    this.tracks.push(this.makeTrack('disc', 'ring', SUN_COLOR, 7), this.makeTrack('diamond', 'diamond-ring', EARTH_COLOR, 7));
    this.overlay.add(this.sunLabel.sprite, this.earthLabel.sprite);
  }

  private makeTrack(filled: Shape, hollow: Shape, color: string, sizePx: number): Track {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(0), 3));
    const sky = new Points(geometry, trackMaterial(filled, color, sizePx, false, this.mask));
    const overlay = new Points(geometry, trackMaterial(hollow, color, sizePx, true, this.mask));
    sky.frustumCulled = overlay.frustumCulled = false;
    sky.renderOrder = 0; // before the Sun and Earth, which then cover the marks under them
    overlay.renderOrder = 10;
    sky.scale.setScalar(SKY_DISTANCE * 0.98);
    overlay.scale.setScalar(OVERLAY_DISTANCE);
    this.sky.add(sky);
    this.overlay.add(overlay);
    return { sky, overlay };
  }

  /** Replaces the tracks. Each array holds unit direction vectors (x, y, z triples, scene frame); null clears a track. */
  setTracks(sun: Float32Array | null, earth: Float32Array | null): void {
    [sun, earth].forEach((dirs, k) => {
      const geometry = this.tracks[k].sky.geometry;
      geometry.setAttribute('position', new Float32BufferAttribute(dirs ?? new Float32Array(0), 3));
      geometry.setDrawRange(0, dirs ? dirs.length / 3 : 0);
    });
  }

  setVisible(tracks: boolean, labels: boolean): void {
    this.tracksOn = tracks;
    this.labelsOn = labels;
    for (const t of this.tracks) t.sky.visible = t.overlay.visible = tracks;
  }

  get visible(): { tracks: boolean; labels: boolean } {
    return { tracks: this.tracksOn, labels: this.labelsOn };
  }

  /**
   * Call every frame. `sun` / `earth`: unit vectors towards the bodies and their apparent
   * radii; `sunState` 0 visible, 1 behind terrain, 2 behind Earth; `earthHidden` true when
   * terrain hides Earth. Labels hang just under each disc, and are dropped for a body well
   * below the horizontal, where they would sit on the ground.
   */
  update(camera: PerspectiveCamera, sun: Vector3, earth: Vector3, sunRadiusDeg: number, earthRadiusDeg: number, sunState: 0 | 1 | 2, earthHidden: boolean, viewportHeightPx: number): void {
    const rad = Math.PI / 180;
    this.sky.position.copy(camera.position);
    for (const t of this.tracks) t.overlay.position.copy(camera.position);
    // Half a mark, as an angle at this zoom.
    const markDeg = (4 * camera.fov) / Math.max(1, viewportHeightPx);
    this.mask.uSunDir.value.copy(sun);
    this.mask.uSunCos.value = Math.cos((sunRadiusDeg + markDeg) * rad);
    this.mask.uEarthDir.value.copy(earth);
    this.mask.uEarthCos.value = Math.cos((earthRadiusDeg + markDeg) * rad);

    const minY = Math.sin(-3 * rad);
    this.sunLabel.sprite.visible = this.labelsOn && sun.y > minY;
    this.earthLabel.sprite.visible = this.labelsOn && earth.y > minY;
    // "Down" on screen, to hang each label from the lower limb of its disc.
    this.down.set(0, -1, 0).applyQuaternion(camera.quaternion);
    const under = (dir: Vector3, radiusDeg: number) => this.at.copy(camera.position).addScaledVector(dir, OVERLAY_DISTANCE).addScaledVector(this.down, OVERLAY_DISTANCE * Math.tan(radiusDeg * rad));
    // When the Sun is at or behind Earth's disc its label goes one line under Earth's, instead of on top of it.
    const together = sun.dot(earth) > Math.cos((earthRadiusDeg + sunRadiusDeg + 0.3) * rad);
    this.sunLabel.sprite.center.y = together ? 2.6 : 1.5;
    this.sunLabel.place(camera, together ? under(earth, earthRadiusDeg) : under(sun, sunRadiusDeg), sunState, viewportHeightPx);
    this.earthLabel.place(camera, under(earth, earthRadiusDeg), earthHidden ? 1 : 0, viewportHeightPx);
  }

  dispose(): void {
    for (const t of this.tracks) {
      t.sky.geometry.dispose();
      t.sky.material.dispose();
      t.overlay.material.dispose();
    }
    this.sunLabel.dispose();
    this.earthLabel.dispose();
  }
}
