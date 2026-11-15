// The Sun and Earth as drawn in the surface scene's black sky: both at their true angular
// sizes, the Sun as a disc with a restrained glare, Earth as a globe lit from the Sun's real
// direction (so its phase is right) and turned to show the right face.
//
// Both are placed along a direction from the camera, far beyond any terrain, so walking
// around does not shift them and the terrain in front hides them pixel by pixel.
import {
  AdditiveBlending,
  Matrix4,
  Mesh,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { DEG } from './skyMath';

/** Distance from the camera at which sky objects are placed, metres: beyond the farthest terrain drawn. */
export const SKY_DISTANCE = 600_000;

const SUN_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv * 2.0 - 1.0;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

// rho is the distance from the Sun's centre in solar radii. The disc is rho < 1, drawn
// with mild limb darkening and a one-pixel soft edge; everything outside it is glare.
const SUN_FRAGMENT = /* glsl */ `
uniform float uQuadRadii;
uniform float uSigma;
uniform float uGlare;
varying vec2 vUv;
void main() {
	float r = length( vUv );
	float rho = r * uQuadRadii;
	float edge = max( fwidth( rho ), 1e-4 );
	float disc = 1.0 - smoothstep( 1.0 - edge, 1.0 + edge, rho );
	float mu = sqrt( max( 0.0, 1.0 - min( rho * rho, 1.0 ) ) );
	vec3 discColor = mix( vec3( 1.0, 0.86, 0.66 ), vec3( 1.0, 0.99, 0.95 ), mu ) * 1.6;
	float fall = max( rho - 1.0, 0.0 );
	float halo = uGlare * ( 0.45 * exp( - fall / uSigma ) + 0.07 * exp( - fall / ( 2.5 * uSigma ) ) );
	halo *= 1.0 - smoothstep( 0.75, 1.0, r );
	vec3 color = discColor * disc + vec3( 1.0, 0.95, 0.86 ) * halo * ( 1.0 - disc );
	gl_FragColor = vec4( color, 1.0 );
	#include <colorspace_fragment>
}`;

/** The solar disc at its true angular size, with a glare that fades as terrain (or Earth) hides it. */
export class SunDisc {
  readonly mesh: Mesh;
  private readonly uniforms = { uQuadRadii: { value: 10 }, uSigma: { value: 3 }, uGlare: { value: 1 } };

  constructor() {
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SUN_VERTEX,
      fragmentShader: SUN_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  /**
   * @param direction    unit vector towards the Sun, scene frame
   * @param radiusDeg    apparent radius of the disc
   * @param visible      fraction of the disc not hidden by terrain or Earth, 0..1 (scales the glare only)
   */
  update(camera: PerspectiveCamera, direction: Vector3, radiusDeg: number, visible: number): void {
    // Glare width: under one solar radius when zoomed in, wider (in solar radii) at a wide
    // field of view so the 5-pixel disc can still be found.
    const sigmaDeg = Math.max(0.7 * radiusDeg, 0.012 * camera.fov);
    const quadDeg = 6 * sigmaDeg + radiusDeg;
    this.uniforms.uSigma.value = sigmaDeg / radiusDeg;
    this.uniforms.uQuadRadii.value = Math.tan(quadDeg * DEG) / Math.tan(radiusDeg * DEG);
    this.uniforms.uGlare.value = Math.max(0, Math.min(1, visible));
    this.mesh.position.copy(camera.position).addScaledVector(direction, SKY_DISTANCE);
    this.mesh.scale.setScalar(SKY_DISTANCE * Math.tan(quadDeg * DEG));
    // Face the viewer, so the disc is round wherever it sits in the picture.
    this.mesh.lookAt(camera.position);
  }
}

const EARTH_VERTEX = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
	vUv = uv;
	vNormalW = normalize( mat3( modelMatrix ) * normal );
	vec4 world = modelMatrix * vec4( position, 1.0 );
	vViewW = cameraPosition - world.xyz;
	gl_Position = projectionMatrix * viewMatrix * world;
}`;

const EARTH_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform float uHasMap;
uniform vec3 uSunDir;
uniform float uBacklit;
varying vec3 vNormalW;
varying vec3 vViewW;
varying vec2 vUv;
void main() {
	vec3 n = normalize( vNormalW );
	float ndl = dot( n, uSunDir );
	// The terminator is softened over a few degrees, as the atmosphere does; the night side is black.
	float day = smoothstep( -0.04, 0.12, ndl );
	vec3 albedo = uHasMap > 0.5 ? texture2D( uMap, vUv ).rgb : vec3( 0.06, 0.16, 0.38 );
	vec3 color = albedo * ( 0.35 + 1.9 * max( ndl, 0.0 ) );
	// Air: a blue veil that thickens towards the limb.
	float edge = 1.0 - max( dot( n, normalize( vViewW ) ), 0.0 );
	float rim = pow( edge, 2.5 );
	color += vec3( 0.16, 0.34, 0.80 ) * ( 0.18 + 0.9 * rim ) * sqrt( max( ndl, 0.0 ) );
	color *= day;
	// Display aids on the night side: a barely visible limb, so the dark disc can be made out
	// against the black sky, and, while Earth hides the Sun, the thin ring of sunlit air
	// around it (drawn schematically: its real brightness and colour vary).
	float limb = pow( edge, 8.0 );
	color += ( vec3( 0.020, 0.028, 0.045 ) + uBacklit * vec3( 0.95, 0.38, 0.16 ) ) * limb * ( 1.0 - day );
	gl_FragColor = vec4( color, 1.0 );
	#include <colorspace_fragment>
}`;

/** Earth at its true angular size, lit from the Sun's actual direction and turned to show the face it shows at that instant. */
export class EarthGlobe {
  readonly mesh: Mesh;
  private readonly uniforms = { uMap: { value: null as Texture | null }, uHasMap: { value: 0 }, uSunDir: { value: new Vector3(1, 0, 0) }, uBacklit: { value: 0 } };
  private readonly basis = new Matrix4();
  private readonly z = new Vector3();

  constructor(textureUrl: string) {
    const material = new ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: EARTH_VERTEX,
      fragmentShader: EARTH_FRAGMENT,
      // Sorted with the Sun (which is additive) so that Earth is drawn over it during an eclipse.
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    new TextureLoader().load(textureUrl, (t) => {
      t.colorSpace = SRGBColorSpace;
      this.uniforms.uMap.value = t;
      this.uniforms.uHasMap.value = 1;
    });
    this.mesh = new Mesh(new SphereGeometry(1, 64, 32), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * @param direction   unit vector towards Earth, scene frame
   * @param radiusDeg   apparent radius of the disc
   * @param sunFromEarth unit vector from Earth towards the Sun, scene frame (sets the phase)
   * @param pole, prime Earth's north pole and Greenwich-meridian direction, scene frame
   * @param sunCovered  fraction of the Sun's disc that Earth hides, 0..1 (lights the ring of air around the night side)
   */
  update(camera: PerspectiveCamera, direction: Vector3, radiusDeg: number, sunFromEarth: Vector3, pole: Vector3, prime: Vector3, sunCovered = 0): void {
    this.uniforms.uBacklit.value = Math.max(0, Math.min(1, sunCovered));
    this.mesh.position.copy(camera.position).addScaledVector(direction, SKY_DISTANCE);
    // A sphere of radius r at distance D spans asin(r / D).
    this.mesh.scale.setScalar(SKY_DISTANCE * Math.sin(radiusDeg * DEG));
    this.uniforms.uSunDir.value.copy(sunFromEarth).normalize();
    // The sphere's texture has longitude 0 on +X, the north pole on +Y and 90 E on -Z.
    this.z.crossVectors(prime, pole);
    this.mesh.quaternion.setFromRotationMatrix(this.basis.makeBasis(prime, pole, this.z));
  }
}
