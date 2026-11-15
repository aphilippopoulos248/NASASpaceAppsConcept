import {
  AdditiveBlending,
  AmbientLight,
  Camera,
  CanvasTexture,
  DirectionalLight,
  Group,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  ShaderChunk,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TextureLoader,
  Vector3,
} from 'three';
import type { MoonGeometry, Vec3 } from '../astro/ephemeris';

export type LightMode = 'real' | 'even';

const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6371;

/** Moon-fixed vector (x: 0°E, y: 90°E, z: north) to scene coordinates (see latLonToVec3). */
const toScene = ([x, y, z]: Vec3, out = new Vector3()) => out.set(x, z, -y);

const LAMBERT = 'vec3 irradiance = dotNL * directLight.color;';
const LUNAR = /* glsl */ `
	// Lunar regolith is not a Lambert surface: it scatters light back towards the
	// Sun, which is why the full Moon looks like a flat disc with no dark rim.
	// Lommel-Seeliger approximates that; the exponent softens the terminator a little.
	float lunarNV = saturate( dot( geometryNormal, geometryViewDir ) );
	float lunar = min( 2.0 * dotNL / ( dotNL + lunarNV + 1e-3 ), 1.35 );
	vec3 irradiance = pow( lunar, 0.75 ) * directLight.color;`;

/**
 * Rewrites a standard material's fragment shader so its diffuse falloff is Moon-like.
 * For materials that compose several shader patches; returns the source unchanged (with a
 * warning) if three.js no longer contains the line this replaces.
 */
export function lunarFragmentShader(fragmentShader: string): string {
  const chunk = ShaderChunk.lights_physical_pars_fragment;
  if (!chunk.includes(LAMBERT)) {
    console.warn('Lunar shading not applied: three.js shader source has changed.');
    return fragmentShader;
  }
  return fragmentShader.replace('#include <lights_physical_pars_fragment>', chunk.replace(LAMBERT, LUNAR));
}

/** Swaps a standard material's diffuse falloff for a Moon-like one. */
export function applyLunarShading(material: Material): void {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = lunarFragmentShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'lunar-shading';
}

function glowTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,250,235,1)');
  g.addColorStop(0.3, 'rgba(255,225,170,0.3)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

/** Sunlight, the Sun's glow and the Earth, all positioned from real geometry. */
export class Sky {
  readonly root = new Group();
  private readonly ambient = new AmbientLight(0xffffff, 0.07);
  private readonly sunLight = new DirectionalLight(0xffffff, 3.2);
  private readonly sunGlow: Sprite;
  private readonly earth: Mesh;
  private readonly sunDir = new Vector3(1, 0, 0);
  private mode: LightMode = 'real';

  constructor() {
    this.sunGlow = new Sprite(
      new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, sizeAttenuation: false, toneMapped: false }),
    );
    this.sunGlow.scale.setScalar(0.16);

    const earthMaterial = new MeshStandardMaterial({ color: 0x2a4f8f, roughness: 0.9, metalness: 0 });
    new TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth_2k.jpg`, (t) => {
      t.colorSpace = SRGBColorSpace;
      earthMaterial.map = t;
      earthMaterial.color.set(0xffffff);
      earthMaterial.needsUpdate = true;
    });
    this.earth = new Mesh(new SphereGeometry(EARTH_RADIUS_KM / MOON_RADIUS_KM, 64, 32), earthMaterial);

    this.root.add(this.ambient, this.sunLight, this.sunGlow, this.earth);
  }

  /** Direction to the Sun in scene space, or null when the scene is lit evenly. */
  get litDirection(): Vector3 | null {
    return this.mode === 'real' ? this.sunDir : null;
  }

  setMode(mode: LightMode): void {
    this.mode = mode;
    this.ambient.intensity = mode === 'real' ? 0.07 : 0.22;
    this.sunGlow.visible = mode === 'real';
    if (mode === 'real') this.sunLight.position.copy(this.sunDir);
  }

  setGeometry(g: MoonGeometry): void {
    toScene(g.sunDir, this.sunDir);
    this.sunGlow.position.copy(this.sunDir).multiplyScalar(900);
    if (this.mode === 'real') this.sunLight.position.copy(this.sunDir);

    // Earth at its true distance and size, turned to show the right face.
    toScene(g.earthDir, this.earth.position).multiplyScalar(g.earthDistanceKm / MOON_RADIUS_KM);
    const pole = toScene(g.earthPole).normalize();
    const prime = toScene(g.earthPrime);
    prime.addScaledVector(pole, -prime.dot(pole)).normalize();
    const z = new Vector3().crossVectors(prime, pole);
    this.earth.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(prime, pole, z));
  }

  /** Call every frame. In "even" mode the key light follows the camera so every site is readable. */
  update(camera: Camera, right: Vector3, up: Vector3): void {
    if (this.mode !== 'even') {
      // Night-side fill: faint from afar, stronger up close so a site in darkness is still readable.
      const altitude = camera.position.length() - 1;
      const near = Math.min(1, Math.max(0, (0.5 - altitude) / 0.4));
      this.ambient.intensity = 0.07 + 0.16 * near;
      return;
    }
    this.sunLight.position.copy(camera.position).normalize().addScaledVector(right, -1.1).addScaledVector(up, 0.6);
  }
}
