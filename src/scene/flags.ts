import {
  Camera,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { flagCode, Ownership } from '../data/ownership';
import type { Marker } from './markers';

// Simplified national flags, drawn rather than loaded so there are no image assets to license.
// Keyed by GCAT state code, plus RU (Russia, shown for hardware launched by the USSR: see SUCCESSORS in
// src/data/ownership.ts; no USSR flag is drawn). Proportions are 3:2 for all, for a tidy row on the globe.

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rotation + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

/**
 * The United States flag's 50 stars in a union `cw` wide and `ch` high: nine rows alternating six
 * and five stars, at the positions and size Executive Order 10834 (1959) gives in units of the
 * hoist: union 0.5385 high and 0.76 wide, row centres 0.054 apart starting 0.054 below the
 * union's top (E, F), column centres 0.063 apart starting 0.063 from the hoist (G, H), star
 * diameter 0.0616 (K). Positions scale with the union drawn here; the star size follows its height.
 */
export function usStarField(cw: number, ch: number): { centres: [number, number][]; radius: number } {
  const C = 0.5385, D = 0.76, E = 0.054, F = 0.054, G = 0.063, H = 0.063, K = 0.0616;
  const centres: [number, number][] = [];
  for (let row = 0; row < 9; row++) {
    // Rows of six use the even columns of an 11-column grid, rows of five the odd ones.
    for (let col = row % 2; col < 11; col += 2) centres.push([(cw * (G + col * H)) / D, (ch * (E + row * F)) / C]);
  }
  return { centres, radius: ((K / 2) * ch) / C };
}

/**
 * The stars of China's flag on a `w` x `h` field (3:2), from its construction grid of 30 x 20
 * (GB 12982): the large star centred at (5, 5) with a circumscribed radius of 3, one point
 * straight up; the four small ones centred at (10, 2), (12, 4), (12, 7) and (10, 9) with radius
 * 1, each with one point aimed at the large star's centre.
 */
export function chinaStars(w: number, h: number): { x: number; y: number; r: number; rotation: number }[] {
  const u = w / 30, v = h / 20;
  const big = { x: 5 * u, y: 5 * v, r: 3 * v, rotation: -Math.PI / 2 };
  const small = ([[10, 2], [12, 4], [12, 7], [10, 9]] as const).map(([gx, gy]) => {
    const x = gx * u, y = gy * v;
    // Aimed in drawn (pixel) space, so it holds whatever the canvas size.
    return { x, y, r: v, rotation: Math.atan2(big.y - y, big.x - x) };
  });
  return [big, ...small];
}

const PAINTERS: Record<string, Painter> = {
  US(ctx, w, h) {
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
      ctx.fillRect(0, (i * h) / 13, w, h / 13 + 0.5);
    }
    const cw = w * 0.4, ch = (h * 7) / 13;
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ffffff';
    const field = usStarField(cw, ch);
    for (const [x, y] of field.centres) star(ctx, x, y, field.radius);
  },
  RU(ctx, w, h) {
    const colours = ['#ffffff', '#0039a6', '#d52b1e'];
    colours.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, (i * h) / 3, w, h / 3 + 0.5);
    });
  },
  CN(ctx, w, h) {
    ctx.fillStyle = '#de2910';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffde00';
    for (const s of chinaStars(w, h)) star(ctx, s.x, s.y, s.r, s.rotation);
  },
  IN(ctx, w, h) {
    ctx.fillStyle = '#ff9933';
    ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#138808';
    ctx.fillRect(0, (2 * h) / 3, w, h / 3 + 0.5);
    ctx.strokeStyle = '#000080';
    ctx.lineWidth = Math.max(1, h * 0.02);
    const r = h * 0.14;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, h * 0.008);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    ctx.stroke();
  },
  J(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#bc002d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** A flag on its own, for the info card. Null for states without a drawing. */
export function flagCanvas(state: string, width = 36): HTMLCanvasElement | null {
  const paint = PAINTERS[state];
  if (!paint) return null;
  const scale = 2; // sharp on high-density screens
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = Math.round((width * 2) / 3) * scale;
  const ctx = c.getContext('2d')!;
  paint(ctx, c.width, c.height);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = scale;
  ctx.strokeRect(0, 0, c.width, c.height);
  c.style.width = `${width}px`;
  c.style.height = `${Math.round((width * 2) / 3)}px`;
  return c;
}

// ---------- 3D flags on the globe ----------

/** Pole height on screen, as a fraction of the view height (it then scales with distance). */
const SCREEN_SIZE = 0.05;
/** Flag cloth, relative to a pole of height 1. */
const CLOTH_W = 0.78;
const CLOTH_H = 0.52;

const clothVertex = /* glsl */ `
uniform float uTime;
uniform float uPhase;
varying vec2 vUv;
varying float vShade;
void main() {
	vUv = uv;
	// Ripple travelling away from the pole, growing towards the free edge; the edge at the pole stays put.
	float along = uv.x;
	float wave = sin( along * 7.0 - uTime * 2.6 + uPhase ) * 0.045 * along + sin( along * 13.0 - uTime * 4.1 + uPhase * 1.7 ) * 0.012 * along;
	vec3 p = position;
	p.z += wave;
	p.y -= 0.03 * along * along; // droop slightly at the free corner
	// Light and shade from the slope of the ripple, as cloth folds would catch light.
	float slope = cos( along * 7.0 - uTime * 2.6 + uPhase ) * 0.045 * 7.0 * along;
	vShade = clamp( 0.86 + 0.6 * slope, 0.6, 1.08 );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( p, 1.0 );
}`;

const clothFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uLight;
varying vec2 vUv;
varying float vShade;
void main() {
	vec3 c = texture2D( uMap, vUv ).rgb;
	// Darker towards the pole and the bottom, like a hanging flag lit from above.
	float shade = vShade * mix( 0.88, 1.0, vUv.y ) * mix( 0.9, 1.0, smoothstep( 0.0, 0.2, vUv.x ) );
	gl_FragColor = vec4( c * shade * uLight, 1.0 );
	#include <colorspace_fragment>
}`;

const textureCache = new Map<string, CanvasTexture>();
function clothTexture(code: string): CanvasTexture | null {
  const cached = textureCache.get(code);
  if (cached) return cached;
  const canvas = flagCanvas(code, 96);
  if (!canvas) return null;
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  textureCache.set(code, t);
  return t;
}

const poleGeometry = new CylinderGeometry(0.012, 0.016, 1, 8, 1, false).translate(0, 0.5, 0);
const finialGeometry = new SphereGeometry(0.028, 10, 8).translate(0, 1.0, 0);
const baseGeometry = new CylinderGeometry(0.05, 0.065, 0.025, 16).translate(0, 0.0125, 0);
const clothGeometry = new PlaneGeometry(CLOTH_W, CLOTH_H, 20, 6).translate(CLOTH_W / 2 + 0.012, 1 - CLOTH_H / 2 - 0.02, 0);

interface Flag {
  marker: Marker;
  group: Group;
  swivel: Group;
  cloth: ShaderMaterial;
  metal: MeshBasicMaterial;
}

/**
 * A small flag on a pole planted at each landing site, showing which state the hardware belongs to.
 * The pole stands straight up from the surface; the cloth turns about the pole to face the viewer and
 * ripples gently. Flags stay a constant size on screen, are hidden by the Moon when they go round
 * the limb, and dim (but stay readable) on the night side.
 */
export class FlagMarkers {
  readonly root = new Group();
  private readonly items: Flag[] = [];
  private enabled = false;
  private revealProgress = Infinity;
  private readonly local = new Vector3();
  private readonly inverse = new Quaternion();

  constructor(markers: Marker[], ownerOf: (landingId: string) => Ownership | undefined) {
    const up = new Vector3(0, 1, 0);
    markers.forEach((marker, i) => {
      const owner = ownerOf(marker.landing.id);
      const map = owner ? clothTexture(flagCode(owner)) : null;
      if (!map) return;
      // Transparent (but opaque-looking) so they draw after the explored areas, which go over the terrain.
      const metal = new MeshBasicMaterial({ color: 0xd9dde3, toneMapped: false, transparent: true });
      const cloth = new ShaderMaterial({
        uniforms: { uMap: { value: map }, uTime: { value: 0 }, uPhase: { value: i * 1.7 }, uLight: { value: 1 } },
        vertexShader: clothVertex,
        fragmentShader: clothFragment,
        side: DoubleSide,
        transparent: true,
      });
      const group = new Group();
      group.position.copy(marker.dir).multiplyScalar(1.0003);
      // The pole stands straight out of the surface at the site.
      group.quaternion.setFromUnitVectors(up, marker.dir);
      const swivel = new Group();
      swivel.add(new Mesh(poleGeometry, metal), new Mesh(finialGeometry, metal), new Mesh(clothGeometry, cloth));
      group.add(new Mesh(baseGeometry, metal), swivel);
      group.visible = false;
      // Over the explored areas (2.5), under the markers (3).
      group.traverse((o) => (o.renderOrder = 2.8));
      this.root.add(group);
      this.items.push({ marker, group, swivel, cloth, metal });
    });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const f of this.items) f.group.visible = false;
  }

  setRevealProgress(progress: number): void { this.revealProgress = progress; }

  get count(): number { return this.items.length; }

  /**
   * Call every frame. `sunDir` is the direction to the Sun in scene space, or null when the scene
   * is lit evenly.
   */
  update(camera: Camera, timeSec: number, sunDir: Vector3 | null): void {
    if (!this.enabled) return;
    for (const [i, f] of this.items.entries()) {
      const { marker, group, swivel } = f;
      // A point on the unit sphere faces a camera at c when p·c > 1; past the limb the Moon hides it anyway.
      const facing = marker.dir.dot(camera.position);
      group.visible = i < this.revealProgress && marker.group.visible && facing > 0.98;
      if (!group.visible) continue;
      // Stand where the marker is: on the drawn surface, which moves with the relief exaggeration.
      group.position.copy(marker.group.position);
      const entering = Math.min(1, Math.max(0, (this.revealProgress - i) / 0.9));
      const pop = entering >= 1 ? 1 : entering * (1 + 0.16 * Math.sin(Math.PI * entering));
      group.scale.setScalar(camera.position.distanceTo(group.position) * SCREEN_SIZE * 0.73 * pop);
      // Turn the cloth about the pole so it faces the viewer.
      this.local.copy(camera.position).sub(group.position).applyQuaternion(this.inverse.copy(group.quaternion).invert());
      // Turned slightly off square so the ripple and the pole read in depth.
      swivel.rotation.y = Math.atan2(this.local.x, this.local.z) + 0.35;
      // Sunlit sites at full brightness; sites in night stay readable at a lower level.
      const day = sunDir ? Math.min(1, Math.max(0, marker.dir.dot(sunDir) * 4 + 0.5)) : 1;
      const light = 0.55 + 0.45 * day;
      f.cloth.uniforms.uTime.value = timeSec;
      f.cloth.uniforms.uLight.value = light;
      f.metal.color.setRGB(0.85 * light, 0.87 * light, 0.9 * light);
    }
  }
}
