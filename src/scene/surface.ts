import {
  AdditiveBlending,
  AmbientLight,
  Box3,
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
  MeshDepthMaterial,
  MeshStandardMaterial,
  Material,
  PerspectiveCamera,
  RepeatWrapping,
  SRGBColorSpace,
  ShaderChunk,
  ShaderMaterial,
  Scene,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Texture,
  TextureLoader,
  Vector3,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MoonGeometry, Vec3 } from '../astro/ephemeris';
import { Landing, landingColor } from '../data/landings';
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

// ---------- generated detail (not real): everything finer than the orbital data can show ----------
// Many small rocks share a few light meshes; the rare boulders, which you can walk up to, get detailed ones.
const SMALL_ROCK_SHAPES = 3;
const SMALL_ROCKS_EACH = 260;
const BOULDER_SHAPES = 2;
const BOULDERS_EACH = 40;
const BOULDER_SIZE_M = 0.25;
const ROCK_CELL_M = 4;
const ROCK_REACH_M = 46;

/** Repeatable pseudo-random number in [0, 1) for a grid cell. */
function cellHash(ix: number, iy: number, salt: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Height of a field of generated craters, one candidate per grid cell. Sizes run from about
 * a quarter to nearly a full cell; most are old and shallow, a few fresh and sharp, and no
 * rim is a perfect circle.
 */
function craterField(east: number, north: number, cell: number, salt: number): number {
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
function rockGeometry(seed: number, subdivisions: number): BufferGeometry {
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

/**
 * Lunar soil reflects most strongly straight back towards its light source, so ground seen with
 * the Sun behind you is brighter than ground seen looking towards the Sun, with a tight bright
 * patch around your own shadow. Without this, a high Sun leaves the surface flat and pale.
 */
/**
 * Surface detail for the generated rocks, computed per pixel in each rock's own space so it sticks
 * to the rock and differs from rock to rock: rough relief, uneven tone, and a coat of soil-coloured
 * dust on the lower, buried part.
 * Rocks are small on screen, so a few noise lookups per pixel cost very little.
 */
/** The ground under the rocks: its photo (if any), brightness and extent, so rocks can take on its tone. */
interface RockGround {
  map: { value: Texture | null };
  hasMap: { value: number };
  color: { value: Color };
  half: { value: number };
}

function patchRockShader(material: MeshStandardMaterial, ground: RockGround): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundMap = ground.map;
    shader.uniforms.uGroundHasMap = ground.hasMap;
    shader.uniforms.uGroundColor = ground.color;
    shader.uniforms.uGroundHalf = ground.half;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uGroundHalf;\nvarying vec3 vRockPos;\nvarying vec3 vRockSeed;\nvarying float vRockSize;\nvarying vec2 vGroundUv;\nvoid main() {')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
	vRockPos = position;
	#ifdef USE_INSTANCING
		vRockSeed = instanceMatrix[ 3 ].xyz;
		vRockSize = length( instanceMatrix[ 0 ].xyz );
		// Where the rock sits on the ground photo (x east, z south; the photo runs west-east, south-north).
		vGroundUv = vec2( instanceMatrix[ 3 ].x + uGroundHalf, - instanceMatrix[ 3 ].z + uGroundHalf ) / ( 2.0 * uGroundHalf );
	#else
		vGroundUv = vec2( 0.5 );
		vRockSeed = vec3( 0.0 );
		vRockSize = 1.0;
	#endif`,
      );
    shader.fragmentShader = withBackscatter(
      shader.fragmentShader
        .replace(
          'void main() {',
          /* glsl */ `uniform sampler2D uGroundMap;
uniform float uGroundHasMap;
uniform vec3 uGroundColor;
varying vec3 vRockPos;
varying vec3 vRockSeed;
varying float vRockSize;
varying vec2 vGroundUv;
float rHash( vec3 p ) {
	p = fract( p * 0.3183099 + 0.1 );
	p *= 17.0;
	return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float rNoise( vec3 p ) {
	vec3 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix(
		mix( mix( rHash( i ), rHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( rHash( i + vec3( 0, 1, 0 ) ), rHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
		mix( mix( rHash( i + vec3( 0, 0, 1 ) ), rHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( rHash( i + vec3( 0, 1, 1 ) ), rHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
		f.z );
}
void main() {`,
        )
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
	vec3 rP = vRockPos + fract( vRockSeed * 0.137 ) * 40.0;
	// Start from the tone of the ground the rock sits on (averaged over a few metres), so rocks
	// belong to their surroundings, then vary it gently across the rock.
	vec3 rSoil = uGroundColor * ( uGroundHasMap > 0.5 ? texture2D( uGroundMap, vGroundUv, 4.0 ).rgb : vec3( 1.0 ) );
	diffuseColor.rgb *= rSoil * 1.05 * ( 0.9 + 0.16 * rNoise( rP * 2.5 ) + 0.08 * ( rNoise( rP * 11.0 ) - 0.5 ) );
	// Dust settles on the lower part, where the rock meets the soil.
	diffuseColor.rgb = mix( diffuseColor.rgb, rSoil, smoothstep( -0.1, -0.55, vRockPos.y ) * 0.8 );`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
	{
		// Rough, chipped surface: relief scaled to the rock's size so it reads the same on pebbles and boulders.
		float rH = ( 0.07 * rNoise( rP * 4.0 ) + 0.035 * rNoise( rP * 9.0 ) ) * vRockSize;
		vec3 rSigX = dFdx( - vViewPosition ), rSigY = dFdy( - vViewPosition );
		vec3 rR1 = cross( rSigY, normal ), rR2 = cross( normal, rSigX );
		float rDet = dot( rSigX, rR1 ) * faceDirection;
		vec3 rGrad = sign( rDet ) * ( dFdx( rH ) * rR1 + dFdy( rH ) * rR2 );
		normal = normalize( abs( rDet ) * normal - rGrad );
	}`,
        ),
    );
  };
  material.customProgramCacheKey = () => 'lunar-rock';
}

const SHADOW_LINE = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
/**
 * Shadows only exist in a square around the viewer. Without this they would stop dead at its edge;
 * here they fade out over the outer part of the square instead.
 */
const FADED_SHADOW_LIGHTS = ShaderChunk.lights_fragment_begin.includes(SHADOW_LINE)
  ? ShaderChunk.lights_fragment_begin.replace(
      SHADOW_LINE,
      `{
			vec2 gShadowUv = vDirectionalShadowCoord[ i ].xy / vDirectionalShadowCoord[ i ].w;
			vec2 gShadowEdge = min( gShadowUv, 1.0 - gShadowUv );
			float gShadowFade = smoothstep( 0.0, 0.3, min( gShadowEdge.x, gShadowEdge.y ) );
			directLight.color *= ( directLight.visible && receiveShadow ) ? mix( 1.0, getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ), gShadowFade ) : 1.0;
		}`,
    )
  : null;
if (!FADED_SHADOW_LIGHTS) console.warn('Shadow edge fade not applied: three.js shader source has changed.');

function withBackscatter(fragmentShader: string): string {
  if (FADED_SHADOW_LIGHTS) fragmentShader = fragmentShader.replace('#include <lights_fragment_begin>', FADED_SHADOW_LIGHTS);
  return fragmentShader.replace(
    '#include <lights_fragment_end>',
    /* glsl */ `#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
	{
		float gBack = max( dot( normalize( vViewPosition ), directionalLights[ 0 ].direction ), 0.0 );
		reflectedLight.directDiffuse *= 0.84 + 0.42 * gBack * gBack * gBack + 0.22 * pow( gBack, 30.0 );
	}
#endif`,
  ).replace(
    '#include <opaque_fragment>',
    /* glsl */ `{
		// Highlight roll-off: slopes facing a low Sun get very bright. Above a knee, brightness is
		// compressed smoothly instead of clipping to flat white; mid-tones are left exactly as they were.
		float gPeak = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) );
		const float gKnee = 0.5;
		if ( gPeak > gKnee ) outgoingLight *= ( gKnee + ( 1.0 - gKnee ) * ( 1.0 - exp( - ( gPeak - gKnee ) / ( 1.0 - gKnee ) ) ) ) / gPeak;
	}
	#include <opaque_fragment>`,
  );
}

/**
 * Generated detail for terrain beyond the near ground (not real): the close-up crater map, applied
 * at whatever size keeps its craters a similar size on screen. The size is chosen per pixel from
 * how much ground that pixel covers and steps by a factor of 3, cross-fading between neighbouring
 * steps. Because it depends only on position and distance, it is continuous across the different
 * terrain meshes, so there is no visible change of texture where one mesh meets the next.
 * Shading and a little tone only; the terrain shape is untouched.
 */
function withFarDetail(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> },
  strength: number,
  generated: { value: number },
): void {
  shader.uniforms.uFarNormal = detailMaps.normal;
  shader.uniforms.uFarTone = detailMaps.tone;
  shader.uniforms.uFarReady = detailMaps.ready;
  shader.uniforms.uFarOn = generated;
  shader.vertexShader = 'varying vec2 vFarXZ;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvFarXZ = position.xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      /* glsl */ `uniform sampler2D uFarNormal;
uniform sampler2D uFarTone;
uniform float uFarReady;
uniform float uFarOn;
varying vec2 vFarXZ;
// One step of the map at repeat size t. Alternate steps are turned a quarter turn and shifted so
// they do not line up.
// Returns east, north, up.
vec3 fLayer( vec2 p, float t, float step ) {
	bool turn = mod( step, 2.0 ) > 0.5;
	vec2 q = ( turn ? vec2( - p.y, p.x ) : p ) / t + step * 0.37;
	vec3 n = texture2D( uFarNormal, q ).xyz * 2.0 - 1.0;
	if ( turn ) n.xy = vec2( n.y, - n.x );
	return n;
}
float fTone( vec2 p, float t, float step ) {
	bool turn = mod( step, 2.0 ) > 0.5;
	vec2 q = ( turn ? vec2( - p.y, p.x ) : p ) / t + step * 0.37;
	return texture2D( uFarTone, q ).r * 2.0;
}
void main() {`,
    )
    .replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
	vec2 fGround = vec2( vFarXZ.x, - vFarXZ.y );
	// Ground covered by one pixel (metres), and from it the map size: about 300 pixels per repeat.
	float fLevel = max( log( max( length( fwidth( fGround ) ), 1e-4 ) * 300.0 / 12.0 ) / log( 3.0 ), 0.0 );
	float fStep = floor( fLevel ), fBlend = fLevel - fStep;
	float fTile = 12.0 * pow( 3.0, fStep );
	if ( uFarOn > 0.5 && uFarReady > 0.5 ) {
		float tone = mix( fTone( fGround, fTile, fStep ), fTone( fGround, fTile * 3.0, fStep + 1.0 ), fBlend );
		diffuseColor.rgb *= mix( 1.0, clamp( tone, 0.7, 1.25 ), 0.18 );
	}`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `#include <normal_fragment_maps>
	if ( uFarOn > 0.5 && uFarReady > 0.5 ) {
		vec3 fN = normalize( mix( fLayer( fGround, fTile, fStep ), fLayer( fGround, fTile * 3.0, fStep + 1.0 ), fBlend ) );
		// Larger generated craters are kept fainter, so they never compete with the real terrain.
		float fStrength = ${strength.toFixed(2)} * clamp( 40.0 / fTile, 0.35, 1.0 );
		normal = normalize( normal + mat3( viewMatrix ) * vec3( fN.x, 0.0, - fN.y ) * fStrength / max( fN.z, 0.2 ) );
	}`,
    );
}

// Artist-made close-up surface maps (craters of roughly 0.1-2.5 m and fine texture). They are not
// lunar measurements: they only shade the ground near the viewer, as part of the generated detail,
// and never move the terrain. Loaded the first time the surface view is used.
const DETAIL_TILE_M = 12;
const detailMaps = { normal: { value: null as Texture | null }, tone: { value: null as Texture | null }, ready: { value: 0 } };
/** 0 with the light on the horizon, 1 with it overhead: tone matters more as shading fades. */
const lightHeight = { value: 0 };
let detailRequested = false;
function requestDetailMaps(anisotropy: number): void {
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

/**
 * Shader additions for the ground near the viewer:
 *  - smooth (bicubic) magnification of the photo, which otherwise shows its pixel grid as blocky diamonds;
 *  - generated relief finer than the mesh (craters of a few centimetres to a metre, lumpy regolith),
 *    computed per pixel from ground position so it never repeats and stays sharp underfoot;
 *  - faint generated variation in tone.
 * The generated parts switch off with uGenerated.
 */
function patchNearShader(material: MeshStandardMaterial, mapSize: { value: number }, generated: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMapSize = mapSize;
    shader.uniforms.uGenerated = generated;
    shader.uniforms.uDetailNormal = detailMaps.normal;
    shader.uniforms.uDetailTone = detailMaps.tone;
    shader.uniforms.uDetailReady = detailMaps.ready;
    shader.uniforms.uLightHeight = lightHeight;
    shader.vertexShader = 'varying vec2 vGroundXZ;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGroundXZ = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float uMapSize;
uniform float uGenerated;
uniform sampler2D uDetailNormal;
uniform sampler2D uDetailTone;
uniform float uDetailReady;
uniform float uLightHeight;
varying vec2 vGroundXZ;

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

float gHash( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float gNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// One candidate crater per grid cell: mostly worn and shallow, a few sharp, none perfectly round.
// Craters are kept small enough that only the four cells around a point can reach it.
float gCraters( vec2 p, float cell ) {
	vec2 base = floor( p / cell - 0.5 );
	float h = 0.0;
	for ( int y = 0; y <= 1; y ++ ) {
		for ( int x = 0; x <= 1; x ++ ) {
			vec2 c = base + vec2( float( x ), float( y ) );
			float pick = gHash( c + cell * 17.3 );
			if ( pick > 0.62 ) continue;
			vec2 wobble = vec2( gHash( c + 3.3 ), gHash( c + 9.7 ) ) - 0.5;
			vec2 d = p - ( c + 0.5 + wobble * 0.4 ) * cell;
			float dist = length( d );
			vec2 dir = d / max( dist, 1e-5 );
			// Out-of-round rim: a two-lobed variation with a random orientation, no trigonometry needed.
			float lobes = 2.0 * dir.x * dir.y * wobble.y * 2.0 + ( dir.x * dir.x - dir.y * dir.y ) * wobble.x * 2.0;
			float radius = cell * ( 0.1 + 0.2 * gHash( c + 7.1 + cell ) ) * ( 1.0 + 0.16 * lobes );
			float rho = dist / radius;
			if ( rho > 2.2 ) continue;
			float fresh = gHash( c + 21.9 );
			fresh *= fresh;
			float depth = 2.0 * radius * ( 0.04 + 0.15 * fresh ), rim = depth * ( 0.1 + 0.2 * fresh );
			float apron = 1.0 - ( rho - 1.0 ) / 1.2;
			h += rho < 1.0 ? - depth * ( 1.0 - rho * rho ) + rim * rho * rho : rim * apron * apron;
		}
	}
	return h;
}
// Each layer fades out once it is too small on screen to draw cleanly, and is then skipped entirely.
float gLayer( float size, float footprint ) {
	return 1.0 - smoothstep( 0.1, 0.38, footprint / size );
}
float gHeight( vec2 p, float footprint ) {
	float h = 0.0, w;
	if ( uDetailReady < 0.5 ) {
		// Fallback craters, used only until (or unless) the close-up maps have loaded.
		w = gLayer( 0.6, footprint ); if ( w > 0.0 ) h += gCraters( p, 1.6 ) * w;
		w = gLayer( 0.27, footprint ); if ( w > 0.0 ) h += gCraters( p + 31.7, 0.7 ) * w;
		w = gLayer( 0.11, footprint ); if ( w > 0.0 ) h += gCraters( p + 77.1, 0.3 ) * w;
	}
	w = gLayer( 0.43, footprint ); if ( w > 0.0 ) h += ( gNoise( p * 2.3 ) - 0.5 ) * 0.035 * w;
	w = gLayer( 0.11, footprint ); if ( w > 0.0 ) h += ( gNoise( p * 9.0 ) - 0.5 ) * 0.012 * w;
	w = gLayer( 0.032, footprint ); if ( w > 0.0 ) h += ( gNoise( p * 31.0 ) - 0.5 ) * 0.004 * w;
	return h;
}
// Close-up map lookup at a ground position (x east, y north).
// Returns east, north, up.
vec3 gDetailSample( vec2 q ) {
	vec3 n = texture2D( uDetailNormal, q ).xyz * 2.0 - 1.0;
	return n;
}
// Two copies at different sizes, one turned a quarter turn, mixed by a slowly varying mask so the repeat is hard to spot.
vec3 gDetailNormal( vec2 p ) {
	vec3 a = gDetailSample( p / ${DETAIL_TILE_M.toFixed(1)} );
	vec3 b = gDetailSample( vec2( - p.y, p.x ) / ${(DETAIL_TILE_M * 0.79).toFixed(2)} + 0.37 );
	b.xy = vec2( b.y, - b.x );
	return normalize( mix( a, b, smoothstep( 0.35, 0.65, gNoise( p * 0.045 + 11.0 ) ) ) );
}
// Tilts the shading normal for a height change given per screen pixel (metres).
vec3 gPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
	vec3 sigmaX = dFdx( surfPos ), sigmaY = dFdy( surfPos );
	vec3 r1 = cross( sigmaY, surfNorm ), r2 = cross( surfNorm, sigmaX );
	float det = dot( sigmaX, r1 ) * faceDir;
	vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#ifdef USE_MAP
	// Bicubic only when magnified; minified ground keeps normal mip-mapped filtering.
	float texelsPerPixel = max( length( dFdx( vMapUv ) ), length( dFdy( vMapUv ) ) ) * uMapSize;
	vec4 sampledDiffuseColor = mix( smoothMap( map, vMapUv ), texture2D( map, vMapUv ), smoothstep( 0.4, 1.0, texelsPerPixel ) );
	diffuseColor *= sampledDiffuseColor;
#endif
	diffuseColor.rgb *= 1.0 + uGenerated * ( 0.22 * ( gNoise( vGroundXZ * 0.6 ) - 0.5 ) + 0.07 * ( gNoise( vGroundXZ * 21.0 ) - 0.5 ) );
	// A little of the close-up map's light and dark, so small craters read by tone as well as by shading.
	vec2 gGround = vec2( vGroundXZ.x, - vGroundXZ.y );
	if ( uDetailReady > 0.5 ) diffuseColor.rgb *= mix( 1.0, clamp( texture2D( uDetailTone, gGround / ${DETAIL_TILE_M.toFixed(1)} ).r * 2.0, 0.55, 1.35 ), ( 0.35 + 0.4 * uLightHeight ) * uGenerated );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
	if ( uGenerated > 0.5 ) {
		float gH = gHeight( vGroundXZ, length( fwidth( vGroundXZ ) ) );
		normal = gPerturb( - vViewPosition, normal, vec2( dFdx( gH ), dFdy( gH ) ), faceDirection );
	}`,
      );
  };
  const patch = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    // Distant-detail first: the near patch then replaces the map chunk but keeps what follows it.
    withFarDetail(shader, 0.7, generated);
    patch.call(material, shader, renderer);
    shader.fragmentShader = withBackscatter(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => 'ground-near';
}

/**
 * Splits a grid mesh into square pieces that share its vertex data, so the renderer can skip
 * the pieces that are off-screen. A terrain mesh drawn whole is mostly triangles nobody sees.
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
    group.add(new Mesh(geo, material));
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

// Dense ground mesh that follows the viewer, so nearby relief is real geometry.
const NEAR_N = 385;
const NEAR_SPACING = 0.25; // metres -> 96 m across
const NEAR_SNAP = 2; // re-centre onto a 2 m lattice, so vertices never slide over the ground
const NEAR_SLACK = 14; // how far the viewer may wander from the centre before the mesh is rebuilt

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
  private readonly rocks: InstancedMesh[] = [];
  private readonly generatedFlag = { value: 1 };
  /** Generated detail on terrain beyond the near ground; follows generatedFlag. */
  private readonly farFlag = { value: 1 };
  private readonly mapSize = { value: 1024 };
  private readonly rockGround: RockGround = { map: { value: null }, hasMap: { value: 0 }, color: { value: new Color(0.2, 0.2, 0.2) }, half: { value: 1 } };
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
  private near: Group | null = null;
  private nearGeometry: BufferGeometry | null = null;
  /** Image coordinates on the fine mesh's image for a ground point, so the near ground shares it exactly. */
  private fineUvAt: (e: number, n: number, out: [number, number]) => [number, number] = (_e, _n, out) => out;
  private nearCentre = { east: NaN, north: NaN };
  /** A rebuild of the near mesh in progress, worked on a few milliseconds per frame. */
  private nearBuild: { east: number; north: number; row: number; pass: 0 | 1 } | null = null;
  private readonly nearScratch = { pos: new Float32Array(NEAR_N * NEAR_N * 3), nrm: new Float32Array(NEAR_N * NEAR_N * 3), uv: new Float32Array(NEAR_N * NEAR_N * 2) };
  private shadowStale = true;
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

    // The Earth shades itself from the true Sun direction. It cannot use the scene's light, which is
    // exposure-scaled for the ground and, at night, stands in for the Earth's own glow.
    const earthMaterial = new ShaderMaterial({
      uniforms: { map: { value: null as Texture | null }, hasMap: { value: 0 }, sunDir: { value: new Vector3(1, 0, 0) } },
      vertexShader: /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
	vUv = uv;
	vWorldNormal = normalize( mat3( modelMatrix ) * normal );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
      fragmentShader: /* glsl */ `
uniform sampler2D map;
uniform float hasMap;
uniform vec3 sunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;
void main() {
	vec3 base = hasMap > 0.5 ? texture2D( map, vUv ).rgb : vec3( 0.05, 0.12, 0.3 );
	float lit = smoothstep( -0.05, 0.25, dot( normalize( vWorldNormal ), sunDir ) );
	gl_FragColor = vec4( base * ( 0.015 + 1.15 * lit ), 1.0 );
	#include <colorspace_fragment>
}`,
    });
    new TextureLoader().load(`${import.meta.env.BASE_URL}textures/earth_2k.jpg`, (t) => {
      t.colorSpace = SRGBColorSpace;
      earthMaterial.uniforms.map.value = t;
      earthMaterial.uniforms.hasMap.value = 1;
    });
    this.earth = new Mesh(new SphereGeometry(1, 64, 32), earthMaterial);

    // Lunar rock is about as dark as the soil around it, not pale: a linear albedo near 0.2.
    const rockMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    patchRockShader(rockMaterial, this.rockGround);
    for (let k = 0; k < SMALL_ROCK_SHAPES + BOULDER_SHAPES; k++) {
      const boulder = k >= SMALL_ROCK_SHAPES;
      // 320 triangles is plenty for a rock a hand-span across; boulders get 1280.
      const rocks = new InstancedMesh(rockGeometry(k, boulder ? 3 : 2), rockMaterial, boulder ? BOULDERS_EACH : SMALL_ROCKS_EACH);
      rocks.count = 0;
      rocks.frustumCulled = false;
      // Rocks cast shadows but do not receive them: at this size the shadow map would only speckle them.
      rocks.castShadow = true;
      this.rocks.push(rocks);
    }

    // Shadows for the ground around the viewer only.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    const sc = this.sun.shadow.camera;
    // Wide enough that shadows reach well past the near ground before fading out.
    sc.left = sc.bottom = -110;
    sc.right = sc.top = 110;
    sc.near = 1;
    sc.far = 1400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.06;
    // Nothing that casts a shadow moves between rebuilds, so the shadow map is redrawn on demand only.
    this.sun.shadow.autoUpdate = false;

    this.scene.add(this.ambient, this.sun, this.sun.target, stars, this.sunGlow, this.earth, this.terrain, ...this.rocks);
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
    const finePieces = splitForCulling(fineMesh.geometry, fineMesh.material as Material, fine.n, 8, 2 * fine.spacing);
    // The ground around the near mesh takes and casts shadows too, so they don't stop at its edge.
    // Its shadow-casting copy skips the square the near mesh covers, as its visible surface does,
    // so the two overlapping surfaces don't shadow each other.
    const fineDepth = new MeshDepthMaterial();
    fineDepth.onBeforeCompile = (shader) => {
      shader.uniforms.uHole = this.hole;
      shader.vertexShader =
        'varying vec2 vHoleXZ;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvHoleXZ = position.xz;');
      shader.fragmentShader =
        'uniform vec3 uHole;\nvarying vec2 vHoleXZ;\n' +
        shader.fragmentShader.replace(
          'void main() {',
          'void main() {\n\tif ( uHole.z > 0.0 && abs( vHoleXZ.x - uHole.x ) < uHole.z && abs( vHoleXZ.y - uHole.y ) < uHole.z ) discard;',
        );
    };
    fineDepth.customProgramCacheKey = () => 'ground-depth-with-hole';
    for (const piece of finePieces.children) {
      piece.castShadow = piece.receiveShadow = true;
      piece.customDepthMaterial = fineDepth;
    }
    this.terrain.add(finePieces);
    this.fineUvAt = fineMesh.geometry.userData.uvAt;
    this.addNearMesh(fineMesh.material as MeshStandardMaterial, detailMap, 'image' in drape);
    const innerMesh = this.buildMesh(landing, inner, { layer: DETAIL_LAYER }, halfExtent(fine), 0);
    const outerMesh = this.buildMesh(landing, outer, { layer: CONTEXT_LAYER }, halfExtent(inner), 0);
    this.addFarDetail(innerMesh.material as MeshStandardMaterial, 'inner');
    this.addFarDetail(outerMesh.material as MeshStandardMaterial, 'outer');
    this.terrain.add(innerMesh, outerMesh);
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
    if (grid === this.grids[0]) return this.sampleSmooth(grid, east, north) + this.detailAt(east, north) + this.generatedAt(east, north);
    return this.sampleGrid(grid, east, north);
  }

  /**
   * Generated craters a metre or more across (not real), which the near mesh carries as geometry.
   * Where a survey exists they stay under about 2.5 m, below what the photo resolves; elsewhere
   * they run up to about 6 m, meeting the larger generated craters of the fine grid.
   */
  private generatedAt(east: number, north: number): number {
    if (!this.generated) return 0;
    let h = craterField(east, north, 3, 11);
    if (this.detail === 'procedural') h += craterField(east, north, 7, 23);
    return h;
  }

  private addFarDetail(material: MeshStandardMaterial, key: string): void {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = withBackscatter(shader.fragmentShader);
      withFarDetail(shader, 0.7, this.farFlag);
    };
    material.customProgramCacheKey = () => `ground-far-${key}`;
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
        withBackscatter(shader.fragmentShader).replace('void main() {', 'void main() {\n\tif ( uHole.z > 0.0 && abs( vGroundXZ.x - uHole.x ) < uHole.z && abs( vGroundXZ.y - uHole.y ) < uHole.z ) discard;');
      withFarDetail(shader, 0.7, this.farFlag);
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
    geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array(n * n * 3), 3));
    geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(n * n * 2), 2));
    geo.setIndex(idx);
    // Drawn slightly in front where it overlaps the fine mesh at its rim.
    const material = new MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    requestDetailMaps(this.anisotropy);
    patchNearShader(material, this.mapSize, this.generatedFlag);
    this.rockGround.half.value = halfExtent(this.grids[0]);
    this.rockGround.hasMap.value = 0;
    if (hasPhoto) {
      // Share the photo once the fine mesh has it.
      fineMaterial.userData.onMap = () => {
        material.map = fineMaterial.map;
        this.mapSize.value = (fineMaterial.map!.image as HTMLImageElement).width;
        material.color.copy(fineMaterial.color);
        material.needsUpdate = true;
        this.rockGround.map.value = fineMaterial.map;
        this.rockGround.hasMap.value = 1;
        this.rockGround.color.value.copy(fineMaterial.color);
      };
      if (fineMaterial.map) fineMaterial.userData.onMap();
    } else {
      // No photo here: share the same 20 m imagery as the ground around, so the two match in tone.
      material.color.setScalar(0.2);
      this.rockGround.hasMap.value = 0;
      this.rockGround.color.value.setScalar(0.2);
      fineMaterial.userData.onMap = () => {
        material.map = fineMaterial.map;
        this.mapSize.value = (fineMaterial.map!.image as HTMLCanvasElement).width;
        material.color.copy(fineMaterial.color);
        material.needsUpdate = true;
      };
      if (fineMaterial.map) fineMaterial.userData.onMap();
    }
    this.nearGeometry = geo;
    this.near = splitForCulling(geo, material, NEAR_N, 6, 1);
    for (const piece of this.near.children) piece.castShadow = piece.receiveShadow = true;
    this.near.visible = false;
    this.nearCentre = { east: NaN, north: NaN };
    this.nearBuild = null;
    this.terrain.add(this.near);
  }

  /**
   * Keeps the dense mesh centred near the viewer. Rebuilding it means working out some 150,000
   * heights, so the work is spread over several frames (about `budgetMs` each) into scratch
   * buffers and swapped in when complete; the first build after arriving is done in one go.
   */
  private updateNear(east: number, north: number, budgetMs = 4): void {
    const near = this.near, fine = this.grids[0];
    if (!near || !fine) return;
    const reach = ((NEAR_N - 1) / 2) * NEAR_SPACING;
    if (Math.max(Math.abs(east), Math.abs(north)) > halfExtent(fine) - reach - 8) {
      near.visible = false;
      this.nearBuild = null;
      this.hole.value.z = 0;
      for (const r of this.rocks) r.count = 0;
      return;
    }
    const wandered = Math.max(Math.abs(east - this.nearCentre.east), Math.abs(north - this.nearCentre.north));
    if (!this.nearBuild && (!near.visible || wandered >= NEAR_SLACK)) {
      this.nearBuild = { east: Math.round(east / NEAR_SNAP) * NEAR_SNAP, north: Math.round(north / NEAR_SNAP) * NEAR_SNAP, row: 0, pass: 0 };
    }
    const build = this.nearBuild;
    if (!build) return;

    const n = NEAR_N, c = (n - 1) / 2;
    const uvTmp: [number, number] = [0, 0];
    const { pos, nrm, uv } = this.nearScratch;
    const p = new Vector3();
    const deadline = near.visible ? performance.now() + budgetMs : Infinity;
    while (performance.now() < deadline) {
      const j = build.row;
      if (build.pass === 0) {
        // Pass 1: positions.
        for (let i = 0; i < n; i++) {
          const e = build.east + (i - c) * NEAR_SPACING, nn = build.north + (j - c) * NEAR_SPACING;
          // At its rim the mesh settles onto the fine mesh's own surface, so the two join without a step.
          const rim = Math.min(1, (Math.min(i, j, n - 1 - i, n - 1 - j) * NEAR_SPACING) / 12);
          const blend = rim * rim * (3 - 2 * rim);
          const flat = this.sampleGrid(fine, e, nn);
          const h = flat + (this.sampleSmooth(fine, e, nn) + this.detailAt(e, nn) + this.generatedAt(e, nn) - flat) * blend;
          this.groundPoint(e, nn, h, p).toArray(pos, (j * n + i) * 3);
          this.fineUvAt(e, nn, uvTmp);
          uv[(j * n + i) * 2] = uvTmp[0];
          uv[(j * n + i) * 2 + 1] = uvTmp[1];
        }
      } else {
        // Pass 2: normals, from the neighbouring positions.
        const jS = Math.max(0, j - 1), jN = Math.min(n - 1, j + 1);
        for (let i = 0; i < n; i++) {
          const w = (j * n + Math.max(0, i - 1)) * 3, e = (j * n + Math.min(n - 1, i + 1)) * 3;
          const s = (jS * n + i) * 3, t = (jN * n + i) * 3;
          const ax = pos[e] - pos[w], ay = pos[e + 1] - pos[w + 1], az = pos[e + 2] - pos[w + 2]; // towards east
          const bx = pos[t] - pos[s], by = pos[t + 1] - pos[s + 1], bz = pos[t + 2] - pos[s + 2]; // towards north
          const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nrm.set([nx / len, ny / len, nz / len], (j * n + i) * 3);
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
      refreshBounds(near);
      near.visible = true;
      this.nearCentre = { east: build.east, north: build.north };
      this.hole.value.set(build.east, -build.north, reach - 1.5);
      this.scatterRocks(build.east, build.north);
      this.shadowStale = true;
      this.nearBuild = null;
      break;
    }
  }

  /** Generated rocks (not real) around a point. The same cell always gets the same rocks. */
  private scatterRocks(ce: number, cn: number): void {
    const q = new Quaternion(), scale = new Vector3(), p = new Vector3(), m = new Matrix4(), euler = new Euler();
    const counts = this.rocks.map(() => 0);
    const cells = Math.ceil(ROCK_REACH_M / ROCK_CELL_M);
    const c0e = Math.round(ce / ROCK_CELL_M), c0n = Math.round(cn / ROCK_CELL_M);
    for (let j = -cells; j <= cells; j++) {
      for (let i = -cells; i <= cells; i++) {
        const rand = seededRandom(`${this.siteId}:${c0e + i}:${c0n + j}`);
        // About one rock per 25 square metres, mostly fist-sized, with the occasional boulder.
        const n = rand() < 0.45 ? 1 : rand() < 0.14 ? 2 : 0;
        for (let k = 0; k < n; k++) {
          const e = (c0e + i + rand() - 0.5) * ROCK_CELL_M, nn = (c0n + j + rand() - 0.5) * ROCK_CELL_M;
          const size = Math.min(0.9, 0.05 / Math.sqrt(1 - rand()));
          const variant = size >= BOULDER_SIZE_M ? SMALL_ROCK_SHAPES + Math.floor(rand() * BOULDER_SHAPES) : Math.floor(rand() * SMALL_ROCK_SHAPES);
          const squash = 0.55 + rand() * 0.5;
          const stretch = 0.75 + rand() * 0.6;
          const tilt = [rand() * 0.7 - 0.35, rand() * Math.PI * 2, rand() * 0.7 - 0.35];
          if (Math.hypot(e - ce, nn - cn) > ROCK_REACH_M || counts[variant] >= this.rocks[variant].instanceMatrix.count) continue;
          this.groundPoint(e, nn, this.heightAt(e, nn), p);
          p.y += size * squash * 0.25; // sits partly buried
          scale.set(size * stretch, size * squash, size / stretch);
          q.setFromEuler(euler.set(tilt[0], tilt[1], tilt[2]));
          this.rocks[variant].setMatrixAt(counts[variant]++, m.compose(p, q, scale));
        }
      }
    }
    this.rocks.forEach((r, k) => {
      r.count = counts[k];
      r.instanceMatrix.needsUpdate = true;
      r.visible = this.generated;
    });
  }

  /** Shows or hides everything generated rather than measured: rocks, small craters and sub-metre texture. */
  setGenerated(on: boolean): void {
    this.generated = on;
    this.generatedFlag.value = on ? 1 : 0;
    this.farFlag.value = on ? 1 : 0;
    for (const r of this.rocks) r.visible = on;
    this.shadowStale = true;
    // The generated craters are part of the near mesh, so rebuild it on the next step.
    if (this.near) this.near.visible = false;
    this.nearBuild = null;
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
    const span = (n - 1) * grid.spacing;
    /** Image coordinates of a ground point (metres east and north of the site). */
    const uvAt = (e: number, nn: number, out: [number, number]): [number, number] => {
      if (!mosaic) {
        out[0] = (e + span / 2) / span;
        out[1] = (nn + span / 2) / span;
        return out;
      }
      const d = Math.hypot(e, nn) / this.radius;
      const az = Math.atan2(e, nn);
      const lat2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az));
      const dLon = Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat2));
      out[0] = (landing.lon + dLon / DEG - mosaic.lonW) / (mosaic.lonE - mosaic.lonW);
      out[1] = (lat2 / DEG - mosaic.latS) / (mosaic.latN - mosaic.latS);
      return out;
    };
    const t: [number, number] = [0, 0];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const e = (i - c) * grid.spacing, nn = (j - c) * grid.spacing;
        this.groundPoint(e, nn, grid.data[j * n + i], p).toArray(pos, (j * n + i) * 3);
        uvAt(e, nn, t);
        uv[(j * n + i) * 2] = t[0];
        uv[(j * n + i) * 2 + 1] = t[1];
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
    geo.userData.uvAt = uvAt;
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // Until imagery arrives the ground is plain regolith grey.
    const material = new MeshStandardMaterial({ color: 0x777777, roughness: 1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = withBackscatter(shader.fragmentShader);
    };
    material.customProgramCacheKey = () => 'ground-backscatter';
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
        material.userData.onMap?.();
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
    const color = new Color(landingColor(landing));
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
    const earthDir = this.toLocal(g.earthDir);
    (this.earth.material as ShaderMaterial).uniforms.sunDir.value.copy(sunDir);

    // Exposure, like a camera's: level ground keeps a steady mid-tone whatever the light's height,
    // so a low Sun shows up as strong contrast on slopes rather than as a dim scene.
    let sinElevation = 0.8, exposure = 0.62;
    this.sun.color.setRGB(1, 1, 1);
    this.sun.visible = true;
    if (this.mode !== 'real') {
      this.sunDirection.set(0.35, 0.8, 0.5).normalize();
      this.ambient.intensity = 0.3;
    } else if (sunDir.y > -0.01) {
      // Day. Sunlit ground all around bounces light into shadows, so they are dim rather than black;
      // with the Sun high there is little shadow left to fill, so the fill backs off to keep contrast.
      const high = Math.max(0, sunDir.y);
      this.sunDirection.copy(sunDir);
      sinElevation = Math.max(sunDir.y, 0.08);
      exposure = 0.62 + 0.1 * high;
      this.ambient.intensity = 0.3 - 0.14 * high;
    } else if (earthDir.y > 0.02) {
      // Night with the Earth in the sky: the ground is lit by Earthshine, from the Earth's direction,
      // bluish, and brighter the fuller the Earth (which is fullest when the Moon is new).
      const earthLit = 1 - g.litFraction;
      this.sunDirection.copy(earthDir);
      sinElevation = Math.max(earthDir.y, 0.15);
      this.sun.color.setRGB(0.72, 0.84, 1);
      exposure = 0.05 + 0.2 * earthLit;
      this.ambient.intensity = 0.05;
    } else {
      // Night on the far side: starlight only.
      this.sun.visible = false;
      this.ambient.intensity = 0.06;
    }
    lightHeight.value = this.sun.visible ? Math.max(0, this.sunDirection.y) : 0;
    this.sun.intensity = (Math.PI * exposure) / sinElevation;
    this.sun.castShadow = this.sun.visible;
    this.shadowStale = true;

    // Earth at its true direction and apparent size, turned to show the right face.
    this.earth.position.copy(earthDir).multiplyScalar(SKY_DISTANCE);
    this.earth.scale.setScalar((SKY_DISTANCE * EARTH_RADIUS_KM) / g.earthDistanceKm);
    const pole = this.toLocal(g.earthPole).normalize();
    const prime = this.toLocal(g.earthPrime);
    prime.addScaledVector(pole, -prime.dot(pole)).normalize();
    this.earth.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(prime, pole, new Vector3().crossVectors(prime, pole)));
  }

  /** The light sits along the Sun's direction from the viewer, so its shadow area follows them. */
  private placeSun(): void {
    // Centred on the near mesh (the only thing that casts shadows), not on the viewer.
    const e = Number.isFinite(this.nearCentre.east) ? this.nearCentre.east : this.camera.position.x;
    const n = Number.isFinite(this.nearCentre.north) ? this.nearCentre.north : -this.camera.position.z;
    this.groundPoint(e, n, this.grids.length ? this.heightAt(e, n) : 0, this.sun.target.position);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDirection, 600);
    this.sun.shadow.needsUpdate = true;
    this.shadowStale = false;
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
    if (this.shadowStale) this.placeSun();
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
    this.nearGeometry = null;
    for (const r of this.rocks) r.count = 0;
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
      mat.normalMap?.dispose();
      mat.dispose();
    });
    for (const m of this.mosaics) m.dispose();
    this.mosaics = [];
    this.terrain.clear();
  }
}
