// Ground and rock materials of the surface scene: three.js Lambert shading with a few
// additions compiled in.
//
//  - `aSunLit` (per vertex, or per rock): the fraction of the solar disc that clears the
//    terrain there, from the shadow sweep. It scales direct sunlight only, so shadowed
//    ground keeps the faint fill light.
//  - an optional square hole (where a denser mesh takes over),
//  - optional smooth (bicubic) magnification of the ground photo,
//  - lunar reflectance instead of a matte (Lambert) surface: regolith scatters sunlight back
//    the way it came, so ground seen at a grazing angle under a low Sun is far brighter than
//    a matte surface would be, and the contrast depends on whether one looks down-Sun or
//    up-Sun. Without this, a polar scene is white slopes on black ground.
//  - a soft shoulder on highlights, so Sun-facing slopes at a low Sun do not clip to flat white.
import { MeshLambertMaterial, ShaderChunk, type MeshLambertMaterialParameters, type Vector3 } from 'three';

export interface GroundMaterialOptions extends MeshLambertMaterialParameters {
  /** Square cut out of the mesh: x, z of its centre and its half-size, scene units (half-size 0 = no hole). */
  hole?: { value: Vector3 };
  /** Width of the colour map in pixels, to magnify it smoothly instead of showing its pixel grid. */
  smoothMapSize?: { value: number };
}

const SMOOTH_PARS = /* glsl */ `uniform float uMapSize;
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
`;

const SMOOTH_MAP = /* glsl */ `#ifdef USE_MAP
	// Only when magnified; minified ground keeps normal mip-mapped filtering.
	float texelsPerPixel = max( length( dFdx( vMapUv ) ), length( dFdy( vMapUv ) ) ) * uMapSize;
	vec4 sampledDiffuseColor = mix( smoothMap( map, vMapUv ), texture2D( map, vMapUv ), smoothstep( 0.4, 1.0, texelsPerPixel ) );
	diffuseColor *= sampledDiffuseColor;
#endif`;

const LAMBERT_TERM = 'vec3 irradiance = dotNL * directLight.color;';
/**
 * The "lunar-Lambert" photometric function used for orbital lunar imagery (McEwen 1996):
 *   2 L mu0 / (mu0 + mu) + (1 - L) mu0,
 * a blend of the Lommel-Seeliger law and Lambert's, with L falling from 1 (looking down-Sun)
 * to 0 (looking towards the Sun) as a cubic in the phase angle. mu0 and mu are the cosines of
 * the incidence and emission angles. The Lommel-Seeliger part is capped at 0.8: uncapped it
 * doubles towards the horizon and washes distant ground out to white under a low Sun.
 */
const LUNAR_TERM = /* glsl */ `
	float lunyxMu = saturate( dot( geometryNormal, geometryViewDir ) );
	float lunyxPhase = degrees( acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) ) );
	float lunyxL = clamp( 1.0 + lunyxPhase * ( -0.019 + lunyxPhase * ( 2.42e-4 - 1.46e-6 * lunyxPhase ) ), 0.0, 1.0 );
	float lunyxLS = min( 2.0 * dotNL / ( dotNL + lunyxMu + 1e-3 ), 0.8 );
	vec3 irradiance = ( lunyxL * lunyxLS + ( 1.0 - lunyxL ) * dotNL ) * directLight.color;`;

/** Compresses linear values above 0.6 smoothly towards 1 (identity below). */
const SHOULDER = /* glsl */ `
	vec3 lunyxOver = max( outgoingLight - 0.6, 0.0 );
	outgoingLight = min( outgoingLight, 0.6 ) + 0.4 * ( 1.0 - exp( - lunyxOver / 0.4 ) );
`;

/** A Lambert material lit by the swept Sun mask. The geometry (or instanced mesh) must carry a float attribute `aSunLit` in 0..1. */
export function groundMaterial(options: GroundMaterialOptions = {}): MeshLambertMaterial {
  const { hole, smoothMapSize, ...params } = options;
  const material = new MeshLambertMaterial(params);
  material.onBeforeCompile = (shader) => {
    if (hole) shader.uniforms.uHole = hole;
    if (smoothMapSize) shader.uniforms.uMapSize = smoothMapSize;

    shader.vertexShader =
      'attribute float aSunLit;\nvarying float vSunLit;\n' +
      (hole ? 'varying vec2 vGroundXZ;\n' : '') +
      shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n\tvSunLit = aSunLit;${hole ? '\n\tvGroundXZ = position.xz;' : ''}`);

    let fragment = shader.fragmentShader;
    const must = (find: string, replace: string) => {
      if (!fragment.includes(find)) console.warn(`Surface ground material: three.js shader has changed (missing "${find}").`);
      fragment = fragment.replace(find, replace);
    };
    must(
      'void main() {',
      `varying float vSunLit;\n${hole ? 'uniform vec3 uHole;\nvarying vec2 vGroundXZ;\n' : ''}${smoothMapSize ? SMOOTH_PARS : ''}void main() {${
        hole ? '\n\tif ( uHole.z > 0.0 && abs( vGroundXZ.x - uHole.x ) < uHole.z && abs( vGroundXZ.y - uHole.y ) < uHole.z ) discard;' : ''
      }`,
    );
    if (smoothMapSize) must('#include <map_fragment>', SMOOTH_MAP);
    if (ShaderChunk.lights_lambert_pars_fragment.includes(LAMBERT_TERM)) must('#include <lights_lambert_pars_fragment>', ShaderChunk.lights_lambert_pars_fragment.replace(LAMBERT_TERM, LUNAR_TERM));
    else console.warn('Surface ground material: lunar reflectance not applied (three.js shader has changed).');
    // The Sun is the only direct light in this scene.
    must('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.directDiffuse *= vSunLit;');
    must('#include <opaque_fragment>', `${SHOULDER}\t#include <opaque_fragment>`);
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => `lunyx-ground${hole ? '-hole' : ''}${smoothMapSize ? '-smooth' : ''}`;
  return material;
}
