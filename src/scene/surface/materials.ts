// Ground and rock materials of the surface scene: three.js Lambert shading with additions
// compiled in. Each addition is optional, so one function serves every terrain mesh.
//
// Measured light:
//  - `aSunLit` (per vertex, or per rock): the fraction of the solar disc that clears the
//    terrain there, from the shadow sweep. It scales direct sunlight only.
//  - lunar reflectance instead of a matte (Lambert) surface: regolith scatters sunlight back
//    the way it came, so ground seen at a grazing angle under a low Sun is far brighter than
//    a matte surface would be, and contrast depends on looking down-Sun or up-Sun; plus the
//    tight bright patch around the viewer's own shadow (the opposition surge).
//  - earthshine: a second, faint light from Earth's direction, for the night.
//  - a highlight roll-off, so Sun-facing slopes at a low Sun do not clip to flat white.
//
// GENERATED detail (not measured; all of it follows one switch):
//  - the close-up crater maps, applied at whatever size keeps their craters a similar size on
//    screen, so ground far away is not unnaturally smooth (shading and a little tone only);
//  - near the viewer, relief finer than the mesh and faint variation in tone;
//  - the rocks' surface: rough relief, uneven tone, dust where they meet the soil.
import { MeshLambertMaterial, ShaderChunk, Vector3, type Color, type MeshLambertMaterialParameters, type Texture } from 'three';
import { DETAIL_TILE_M, detailMaps, lightHeight } from './assets';

/** Earthshine, shared by every ground and rock material: direction to Earth in view space, and its colour times strength (zero by day). */
export const earthshine = { direction: { value: new Vector3(0, 1, 0) }, light: { value: new Vector3(0, 0, 0) } };

export interface GroundShaderOptions {
  /** Square cut out of the mesh: x, z of its centre and its half-size, scene units (half-size 0 = no hole). */
  hole?: { value: Vector3 };
  /**
   * Generated crater shading at every scale, from the close-up maps. `on.value` is 1 while
   * generated detail is shown. `single` reads one size of the map per pixel instead of
   * cross-fading two (half the texture reads, for weak devices; sizes then change in steps).
   */
  farDetail?: { strength: number; on: { value: number }; single?: boolean };
  /** The ground near the viewer: per-pixel generated relief and tone, and (optionally) smooth magnification of the photo. */
  near?: { on: { value: number }; mapSize: { value: number }; smooth: boolean };
  /** Fade the shadow map out towards the edge of its square instead of letting shadows stop dead there. */
  fadeShadowEdge?: boolean;
}

/** The ground under the rocks: its photo (if any), brightness and extent, so rocks can take on its tone. */
export interface RockGround {
  map: { value: Texture | null };
  hasMap: { value: number };
  color: { value: Color };
  half: { value: number };
}

type Shader = { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> };

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

const SHADOW_LINE =
  'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
/** The shadow map only exists in a square around the viewer; its shadows fade out over the outer part of the square. */
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

// After the lights: the Sun mask, the opposition surge, earthshine.
const AFTER_LIGHTS = /* glsl */ `#include <lights_fragment_end>
	// The Sun is the only light three.js knows about here: its light reaches this point as far as the terrain lets it.
	reflectedLight.directDiffuse *= vSunLit;
#if NUM_DIR_LIGHTS > 0
	{
		// Lunar soil is brightest straight back towards its light: a tight bright patch around the viewer's own shadow.
		float gBack = max( dot( normalize( vViewPosition ), directionalLights[ 0 ].direction ), 0.0 );
		reflectedLight.directDiffuse *= 1.0 + 0.22 * pow( gBack, 30.0 );
	}
#endif
	// Earthshine: faint, bluish, from Earth's direction. No shadows are worked out for it.
	reflectedLight.directDiffuse += uEarthshine * saturate( dot( normal, uEarthshineDir ) ) * BRDF_Lambert( material.diffuseColor );`;

// Highlight roll-off: above a knee, brightness is compressed smoothly instead of clipping to
// flat white; mid-tones are left exactly as they were, and the colour keeps its hue.
const ROLL_OFF = /* glsl */ `{
		float gPeak = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) );
		const float gKnee = 0.5;
		if ( gPeak > gKnee ) outgoingLight *= ( gKnee + ( 1.0 - gKnee ) * ( 1.0 - exp( - ( gPeak - gKnee ) / ( 1.0 - gKnee ) ) ) ) / gPeak;
	}
	#include <opaque_fragment>`;

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
	// Bicubic only when magnified; minified ground keeps normal mip-mapped filtering.
	float texelsPerPixel = max( length( dFdx( vMapUv ) ), length( dFdy( vMapUv ) ) ) * uMapSize;
	vec4 sampledDiffuseColor = mix( smoothMap( map, vMapUv ), texture2D( map, vMapUv ), smoothstep( 0.4, 1.0, texelsPerPixel ) );
	diffuseColor *= sampledDiffuseColor;
#endif`;

// Generated relief finer than the near mesh (lumpy regolith; small craters only until the
// close-up maps have loaded), computed per pixel from ground position so it never repeats.
const NEAR_PARS = /* glsl */ `uniform float uGenerated;
uniform sampler2D uDetailTone;
uniform float uDetailReady;
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
// Tilts the shading normal for a height change given per screen pixel (metres).
vec3 gPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
	vec3 sigmaX = dFdx( surfPos ), sigmaY = dFdy( surfPos );
	vec3 r1 = cross( sigmaY, surfNorm ), r2 = cross( surfNorm, sigmaX );
	float det = dot( sigmaX, r1 ) * faceDir;
	vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}
`;

const NEAR_TONE = /* glsl */ `
	diffuseColor.rgb *= 1.0 + uGenerated * ( 0.22 * ( gNoise( vGroundXZ * 0.6 ) - 0.5 ) + 0.07 * ( gNoise( vGroundXZ * 21.0 ) - 0.5 ) );
	// A little of the close-up map's light and dark, so small craters read by tone as well as by shading.
	if ( uDetailReady > 0.5 ) diffuseColor.rgb *= mix( 1.0, clamp( texture2D( uDetailTone, vec2( vGroundXZ.x, - vGroundXZ.y ) / ${DETAIL_TILE_M.toFixed(1)} ).r * 2.0, 0.55, 1.35 ), ( 0.35 + 0.4 * uLightHeight ) * uGenerated );`;

const NEAR_RELIEF = /* glsl */ `
	if ( uGenerated > 0.5 ) {
		// Held back under a low Sun, like the crater shading: lumps shaded without shadows would go black wherever they tilt away from it.
		float gH = gHeight( vGroundXZ, length( fwidth( vGroundXZ ) ) ) * mix( 0.3, 1.0, smoothstep( 0.0, 0.4, uLightHeight ) );
		normal = gPerturb( - vViewPosition, normal, vec2( dFdx( gH ), dFdy( gH ) ), faceDirection );
	}`;

// The close-up crater map at repeat size t. Alternate levels are turned a quarter turn and
// shifted so they do not line up. The size is chosen per pixel from how much ground that pixel
// covers and steps by a factor of 3, cross-fading between neighbouring levels; because it
// depends only on position and distance it is continuous across the terrain meshes.
const FAR_PARS = /* glsl */ `uniform sampler2D uFarNormal;
uniform sampler2D uFarTone;
uniform float uFarReady;
uniform float uFarOn;
// Returns east, north, up.
vec3 fLayer( vec2 p, float t, float level ) {
	bool turn = mod( level, 2.0 ) > 0.5;
	vec2 q = ( turn ? vec2( - p.y, p.x ) : p ) / t + level * 0.37;
	vec3 n = texture2D( uFarNormal, q ).xyz * 2.0 - 1.0;
	if ( turn ) n.xy = vec2( n.y, - n.x );
	return n;
}
float fTone( vec2 p, float t, float level ) {
	bool turn = mod( level, 2.0 ) > 0.5;
	vec2 q = ( turn ? vec2( - p.y, p.x ) : p ) / t + level * 0.37;
	return texture2D( uFarTone, q ).r * 2.0;
}
`;

const farTone = (single: boolean) => /* glsl */ `
	vec2 fGround = vec2( vGroundXZ.x, - vGroundXZ.y );
	// Ground covered by one pixel (metres), and from it the map size: about 300 pixels per repeat.
	float fLevel = max( log( max( length( fwidth( fGround ) ), 1e-4 ) * 300.0 / ${DETAIL_TILE_M.toFixed(1)} ) / log( 3.0 ), 0.0 );
	float fStep = floor( fLevel${single ? ' + 0.5' : ''} ), fBlend = fLevel - fStep;
	float fTile = ${DETAIL_TILE_M.toFixed(1)} * pow( 3.0, fStep );
	if ( uFarOn > 0.5 && uFarReady > 0.5 ) {
		float tone = ${single ? 'fTone( fGround, fTile, fStep )' : 'mix( fTone( fGround, fTile, fStep ), fTone( fGround, fTile * 3.0, fStep + 1.0 ), fBlend )'};
		diffuseColor.rgb *= mix( 1.0, clamp( tone, 0.7, 1.25 ), 0.18 );
	}`;

const farRelief = (strength: number, single: boolean) => /* glsl */ `
	if ( uFarOn > 0.5 && uFarReady > 0.5 ) {
		vec3 fN = normalize( ${single ? 'fLayer( fGround, fTile, fStep )' : 'mix( fLayer( fGround, fTile, fStep ), fLayer( fGround, fTile * 3.0, fStep + 1.0 ), fBlend )'} );
		// Larger generated craters are kept fainter, so they never compete with the real terrain. So is
		// all of it under a low Sun, where shading without shadows would turn every dimple into a
		// white and black blotch.
		float fStrength = ${strength.toFixed(2)} * clamp( 40.0 / fTile, 0.35, 1.0 ) * mix( 0.3, 1.0, smoothstep( 0.0, 0.4, uLightHeight ) );
		normal = normalize( normal + mat3( viewMatrix ) * vec3( fN.x, 0.0, - fN.y ) * fStrength / max( fN.z, 0.2 ) );
	}`;

// Surface detail for the generated rocks, computed per pixel in each rock's own space so it
// sticks to the rock and differs from rock to rock.
const ROCK_VERTEX_PARS = 'uniform float uGroundHalf;\nvarying vec3 vRockPos;\nvarying vec3 vRockSeed;\nvarying float vRockSize;\nvarying vec2 vGroundUv;\n';
const ROCK_VERTEX = /* glsl */ `
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
	#endif`;
const ROCK_PARS = /* glsl */ `uniform sampler2D uGroundMap;
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
`;
const ROCK_COLOR = /* glsl */ `#include <color_fragment>
	vec3 rP = vRockPos + fract( vRockSeed * 0.137 ) * 40.0;
	// Start from the tone of the ground the rock sits on (averaged over a few metres), so rocks
	// belong to their surroundings, then vary it gently across the rock.
	vec3 rSoil = uGroundColor * ( uGroundHasMap > 0.5 ? texture2D( uGroundMap, vGroundUv, 4.0 ).rgb : vec3( 1.0 ) );
	diffuseColor.rgb *= rSoil * 1.05 * ( 0.9 + 0.16 * rNoise( rP * 2.5 ) + 0.08 * ( rNoise( rP * 11.0 ) - 0.5 ) );
	// Dust settles on the lower part, where the rock meets the soil.
	diffuseColor.rgb = mix( diffuseColor.rgb, rSoil, smoothstep( -0.1, -0.55, vRockPos.y ) * 0.8 );`;
const ROCK_RELIEF = /* glsl */ `
	{
		// Rough, chipped surface: relief scaled to the rock's size so it reads the same on pebbles and boulders.
		float rH = ( 0.07 * rNoise( rP * 4.0 ) + 0.035 * rNoise( rP * 9.0 ) ) * vRockSize;
		vec3 rSigX = dFdx( - vViewPosition ), rSigY = dFdy( - vViewPosition );
		vec3 rR1 = cross( rSigY, normal ), rR2 = cross( normal, rSigX );
		float rDet = dot( rSigX, rR1 ) * faceDirection;
		vec3 rGrad = sign( rDet ) * ( dFdx( rH ) * rR1 + dFdy( rH ) * rR2 );
		normal = normalize( abs( rDet ) * normal - rGrad );
	}`;

/** Replaces `find` in a shader stage, warning if three.js no longer contains it. */
function swap(source: string, find: string, replace: string): string {
  if (!source.includes(find)) {
    console.warn(`Surface materials: three.js shader has changed (missing "${find}").`);
    return source;
  }
  return source.replace(find, replace);
}

/** Lighting shared by ground and rocks: the Sun mask, lunar reflectance, the opposition surge, earthshine, the roll-off. */
function applyLighting(shader: Shader, fadeShadowEdge: boolean): void {
  shader.uniforms.uEarthshineDir = earthshine.direction;
  shader.uniforms.uEarthshine = earthshine.light;
  shader.vertexShader = 'attribute float aSunLit;\nvarying float vSunLit;\n' + swap(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n\tvSunLit = aSunLit;');
  let f = 'varying float vSunLit;\nuniform vec3 uEarthshineDir;\nuniform vec3 uEarthshine;\n' + shader.fragmentShader;
  if (ShaderChunk.lights_lambert_pars_fragment.includes(LAMBERT_TERM)) f = swap(f, '#include <lights_lambert_pars_fragment>', ShaderChunk.lights_lambert_pars_fragment.replace(LAMBERT_TERM, LUNAR_TERM));
  else console.warn('Surface materials: lunar reflectance not applied (three.js shader has changed).');
  if (fadeShadowEdge && FADED_SHADOW_LIGHTS) f = swap(f, '#include <lights_fragment_begin>', FADED_SHADOW_LIGHTS);
  f = swap(f, '#include <lights_fragment_end>', AFTER_LIGHTS);
  f = swap(f, '#include <opaque_fragment>', ROLL_OFF);
  shader.fragmentShader = f;
}

/**
 * A terrain material. The geometry must carry a float attribute `aSunLit` in 0..1.
 * With `hole`, `near` or `farDetail` the shader also needs the ground position, which it
 * takes from the vertex position (scene x and z).
 */
export function groundMaterial(params: MeshLambertMaterialParameters = {}, options: GroundShaderOptions = {}): MeshLambertMaterial {
  const { hole, farDetail, near, fadeShadowEdge = false } = options;
  const material = new MeshLambertMaterial(params);
  const needsGround = Boolean(hole || farDetail || near);
  material.onBeforeCompile = (shader) => {
    applyLighting(shader, fadeShadowEdge);
    const pars: string[] = [];
    let afterMap = '', afterNormals = '';
    if (needsGround) {
      shader.vertexShader = 'varying vec2 vGroundXZ;\n' + swap(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\n\tvGroundXZ = position.xz;');
      pars.push('varying vec2 vGroundXZ;\n');
    }
    if (near || farDetail) {
      shader.uniforms.uLightHeight = lightHeight;
      pars.push('uniform float uLightHeight;\n');
    }
    if (hole) {
      shader.uniforms.uHole = hole;
      pars.push('uniform vec3 uHole;\n');
    }
    if (near) {
      shader.uniforms.uGenerated = near.on;
      shader.uniforms.uDetailTone = detailMaps.tone;
      shader.uniforms.uDetailReady = detailMaps.ready;
      pars.push(NEAR_PARS);
      afterMap += NEAR_TONE;
      afterNormals += NEAR_RELIEF;
      if (near.smooth) {
        shader.uniforms.uMapSize = near.mapSize;
        pars.push(SMOOTH_PARS);
      }
    }
    if (farDetail) {
      shader.uniforms.uFarNormal = detailMaps.normal;
      shader.uniforms.uFarTone = detailMaps.tone;
      shader.uniforms.uFarReady = detailMaps.ready;
      shader.uniforms.uFarOn = farDetail.on;
      pars.push(FAR_PARS);
      afterMap += farTone(farDetail.single ?? false);
      afterNormals += farRelief(farDetail.strength, farDetail.single ?? false);
    }
    let f = shader.fragmentShader;
    f = swap(f, 'void main() {', `${pars.join('')}void main() {${hole ? '\n\tif ( uHole.z > 0.0 && abs( vGroundXZ.x - uHole.x ) < uHole.z && abs( vGroundXZ.y - uHole.y ) < uHole.z ) discard;' : ''}`);
    if (near?.smooth || afterMap) f = swap(f, '#include <map_fragment>', (near?.smooth ? SMOOTH_MAP : '#include <map_fragment>') + afterMap);
    if (afterNormals) f = swap(f, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + afterNormals);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () =>
    `lunyx-ground${hole ? '-hole' : ''}${near ? (near.smooth ? '-near-smooth' : '-near') : ''}${farDetail ? `-far${farDetail.strength}${farDetail.single ? 's' : ''}` : ''}${fadeShadowEdge ? '-fade' : ''}`;
  return material;
}

/** The material of the generated rocks. The instanced mesh must carry a per-rock float attribute `aSunLit`. */
export function rockMaterial(ground: RockGround): MeshLambertMaterial {
  // Lunar rock is about as dark as the soil around it, not pale: its tone comes from the ground under it.
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    applyLighting(shader, false);
    shader.uniforms.uGroundMap = ground.map;
    shader.uniforms.uGroundHasMap = ground.hasMap;
    shader.uniforms.uGroundColor = ground.color;
    shader.uniforms.uGroundHalf = ground.half;
    shader.vertexShader = ROCK_VERTEX_PARS + swap(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>' + ROCK_VERTEX);
    let f = shader.fragmentShader;
    f = swap(f, 'void main() {', `${ROCK_PARS}void main() {`);
    f = swap(f, '#include <color_fragment>', ROCK_COLOR);
    f = swap(f, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + ROCK_RELIEF);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => 'lunyx-rock';
  return material;
}
