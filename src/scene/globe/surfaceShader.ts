// One shader patch for everything drawn on the Moon's surface in the globe view (relief
// tiles, site imagery, the polar close-up): relief displacement in the vertex shader and the
// colour overlays in the fragment shader. All patched materials share one set of uniforms,
// so the exaggeration, the Sun and the overlay change everywhere at once.
//
// Geometry convention: `position` is the point on the unit sphere, `aHeight` its height in
// Moon radii, `aSkirt` how far a skirt vertex hangs below the surface. A vertex ends up at
// position * (1 + uRelief * aHeight + lift - aSkirt).
import { Color, Material, Texture, Vector2, Vector3, Vector4, type IUniform } from 'three';
import { lunarFragmentShader } from '../sky';

/** Landing-site elevation windows the coverage overlay can outline. */
export const MAX_COVERAGE_SITES = 32;
/** Colours of the 0..100 % ramp, low to high (same list as the legend). */
export const RAMP_STEPS = 6;

/** Overlay numbers in the shader. */
export const OVERLAY_CODE = { off: 0, 'sun-band': 1, 'avg-illumination': 2, 'avg-earth-visibility': 2 } as const;

export interface SurfaceUniforms {
  /** Exaggeration actually drawn (0 = smooth sphere, 1 = true scale). */
  uRelief: IUniform<number>;
  /** Unit vector towards the Sun, scene axes (the Moon does not rotate in the scene). */
  uSunDir: IUniform<Vector3>;
  /** Required Sun elevation band, degrees: min, max. */
  uBand: IUniform<Vector2>;
  uBandColor: IUniform<Color>;
  uRamp: IUniform<Color[]>;
  /** Polar-stereographic average maps, one byte per cell: value x 255 = percent of time. A wide and a fine map per pole. */
  uAvgSouth: IUniform<Texture | null>;
  uAvgSouthDetail: IUniform<Texture | null>;
  uAvgNorth: IUniform<Texture | null>;
  uAvgNorthDetail: IUniform<Texture | null>;
  /** Half-width of each map's square in Moon radii: south wide, south fine, north wide, north fine; 0 = not loaded. */
  uAvgHalf: IUniform<Vector4>;
  /** Half-widths of the three south-polar elevation squares, Moon radii, finest first. */
  uPolarHalf: IUniform<Vector3>;
  uCoverColor: IUniform<Color[]>;
  uSiteCount: IUniform<number>;
  /** Site direction (xyz) and 1 in w where a 3 m survey exists. */
  uSiteDir: IUniform<Vector4[]>;
  uSiteEast: IUniform<Vector3[]>;
  /** Sine of the angular half-width of the 480 m, 60 m and 3 m site windows. */
  uSiteHalf: IUniform<Vector3>;
  /** Base tiles are not drawn where the unit direction's y is below this (the polar close-up covers that part). -2 = draw everything. */
  uCapHole: IUniform<number>;
}

export function createSurfaceUniforms(ramp: readonly string[], bandColor: string, coverColors: readonly string[]): SurfaceUniforms {
  if (ramp.length !== RAMP_STEPS) throw new Error(`the overlay ramp needs ${RAMP_STEPS} colours`);
  return {
    uRelief: { value: 0 },
    uSunDir: { value: new Vector3(1, 0, 0) },
    uBand: { value: new Vector2(0, 90) },
    uBandColor: { value: new Color(bandColor) },
    uRamp: { value: ramp.map((c) => new Color(c)) },
    uAvgSouth: { value: null },
    uAvgSouthDetail: { value: null },
    uAvgNorth: { value: null },
    uAvgNorthDetail: { value: null },
    uAvgHalf: { value: new Vector4(0, 0, 0, 0) },
    uPolarHalf: { value: new Vector3(0, 0, 0) },
    uCoverColor: { value: coverColors.map((c) => new Color(c)) },
    uSiteCount: { value: 0 },
    uSiteDir: { value: Array.from({ length: MAX_COVERAGE_SITES }, () => new Vector4()) },
    uSiteEast: { value: Array.from({ length: MAX_COVERAGE_SITES }, () => new Vector3()) },
    uSiteHalf: { value: new Vector3(0, 0, 0) },
    uCapHole: { value: -2 },
  };
}

const VERTEX_PARS = /* glsl */ `
attribute float aHeight;
attribute float aSkirt;
uniform float uRelief;
uniform float uLift;
varying vec3 vDir;
varying vec2 vLunyxUv;
#ifdef LUNYX_POLAR
	uniform vec4 uSink;
	uniform float uSinkDepth;
#endif
`;

const VERTEX_BEGIN = /* glsl */ `
vec3 lunyxDir = normalize( position );
vDir = lunyxDir;
vLunyxUv = uv;
vec3 transformed = lunyxDir * ( 1.0 + uRelief * aHeight + uLift - aSkirt );
#ifdef LUNYX_POLAR
	// Under a finer window this layer is lowered a little, so its coarse facets never stand in front of the window's surface.
	float lunyxUnder = step( uSink.x, uv.x ) * step( uv.x, uSink.z ) * step( uSink.y, uv.y ) * step( uv.y, uSink.w );
	transformed -= lunyxDir * uSinkDepth * lunyxUnder * max( 1.0, uRelief );
#endif
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vDir;
varying vec2 vLunyxUv;
uniform float uCapHole;
#if LUNYX_OVERLAY == 1
	uniform vec3 uSunDir;
	uniform vec2 uBand;
	uniform vec3 uBandColor;
#endif
#if LUNYX_OVERLAY == 2
	uniform vec3 uRamp[ ${RAMP_STEPS} ];
	uniform sampler2D uAvgSouth;
	uniform sampler2D uAvgSouthDetail;
	uniform sampler2D uAvgNorth;
	uniform sampler2D uAvgNorthDetail;
	uniform vec4 uAvgHalf;
#endif
#if LUNYX_COVERAGE == 1
	uniform vec3 uPolarHalf;
	uniform vec3 uCoverColor[ 6 ];
	uniform int uSiteCount;
	uniform vec4 uSiteDir[ ${MAX_COVERAGE_SITES} ];
	uniform vec3 uSiteEast[ ${MAX_COVERAGE_SITES} ];
	uniform vec3 uSiteHalf;
#endif
#ifdef LUNYX_POLAR
	uniform sampler2D uShadowMap;
	uniform float uShadowOn;
	uniform float uFade;
	uniform vec2 uFadeLat;
	uniform float uEdgeFade;
	uniform vec4 uCut;
#endif

#if LUNYX_OVERLAY == 2 || LUNYX_COVERAGE == 1
// Polar stereographic position in Moon radii, laid out like the LOLA polar grids:
// pole = -1.0 for the south pole (x towards 90E, y towards 0E), +1.0 for the north pole.
vec2 lunyxPolarXY( vec3 d, float pole ) {
	float k = 2.0 / ( 1.0 + pole * d.y );
	return vec2( - k * d.z, - pole * k * d.x );
}
#endif

#if LUNYX_OVERLAY == 2
vec3 lunyxRamp( float t ) {
	float x = clamp( t, 0.0, 1.0 ) * ${(RAMP_STEPS - 1).toFixed(1)};
	int i = int( min( floor( x ), ${(RAMP_STEPS - 2).toFixed(1)} ) );
	return mix( uRamp[ i ], uRamp[ i + 1 ], x - float( i ) );
}
#endif

#if LUNYX_COVERAGE == 1
// One nested outline: fills lightly inside the half-width, with a line on its edge.
vec4 lunyxSquare( float m, float halfW, vec3 colour, float fill ) {
	float w = max( fwidth( m ) * 1.5, 1e-7 );
	float inside = 1.0 - smoothstep( halfW - w, halfW, m );
	float line = inside * smoothstep( halfW - 3.0 * w, halfW - 1.5 * w, m );
	return vec4( colour, max( inside * fill, line * 0.9 ) );
}
#endif

// The overlays are compiled in only while they are switched on (LUNYX_OVERLAY, LUNYX_COVERAGE):
// a software renderer would otherwise pay for the unused branches on every pixel.
vec3 lunyxOverlay( vec3 colour, vec3 d ) {
	#if LUNYX_OVERLAY == 1
	{
		// Sun elevation on a smooth sphere: the angle between the local vertical and the Sun, from the horizon.
		float el = degrees( asin( clamp( dot( d, uSunDir ), - 1.0, 1.0 ) ) );
		float w = max( fwidth( el ), 0.01 );
		float inside = smoothstep( uBand.x - w, uBand.x + w, el ) * ( 1.0 - smoothstep( uBand.y - w, uBand.y + w, el ) );
		float edge = max( 1.0 - abs( el - uBand.x ) / ( 1.5 * w ), 1.0 - abs( el - uBand.y ) / ( 1.5 * w ) );
		colour = mix( colour, uBandColor, 0.34 * inside );
		colour = mix( colour, uBandColor, 0.85 * clamp( edge, 0.0, 1.0 ) );
	}
	#endif
	#if LUNYX_OVERLAY == 2
	{
		// Map position of this point in its own hemisphere's polar projection; rows run down from +y.
		float pole = d.y < 0.0 ? - 1.0 : 1.0;
		vec2 xy = lunyxPolarXY( vec3( d.x, pole * max( abs( d.y ), 0.3 ), d.z ), pole );
		vec2 q = vec2( xy.x, - xy.y );
		float wide = pole < 0.0 ? uAvgHalf.x : uAvgHalf.z;
		float fine = pole < 0.0 ? uAvgHalf.y : uAvgHalf.w;
		// All four maps are read outside any branch (texture lookups need that), then one is chosen.
		vec2 uvWide = 0.5 + q / ( 2.0 * max( wide, 1e-6 ) );
		vec2 uvFine = 0.5 + q / ( 2.0 * max( fine, 1e-6 ) );
		float sWide = pole < 0.0 ? texture2D( uAvgSouth, uvWide ).r : texture2D( uAvgNorth, uvWide ).r;
		float sFine = pole < 0.0 ? texture2D( uAvgSouthDetail, uvFine ).r : texture2D( uAvgNorthDetail, uvFine ).r;
		float m = max( abs( xy.x ), abs( xy.y ) );
		float inWide = step( 0.3, abs( d.y ) ) * step( 1e-5, wide ) * step( m, wide );
		float inFine = step( 1e-5, fine ) * step( m, fine * 0.995 );
		// One byte per cell: the value read, times 255, is percent of time.
		float percent = mix( sWide, sFine, inFine ) * 255.0;
		colour = mix( colour, lunyxRamp( percent / 100.0 ), 0.82 * inWide );
	}
	#endif
	#if LUNYX_COVERAGE == 1
	{
		if ( d.y < - 0.9 ) {
			vec2 xy = abs( lunyxPolarXY( d, - 1.0 ) );
			float m = max( xy.x, xy.y );
			vec4 a = lunyxSquare( m, uPolarHalf.z, uCoverColor[ 2 ], 0.22 );
			vec4 b = lunyxSquare( m, uPolarHalf.y, uCoverColor[ 1 ], 0.26 );
			vec4 c = lunyxSquare( m, uPolarHalf.x, uCoverColor[ 0 ], 0.3 );
			colour = mix( colour, a.rgb, a.a );
			colour = mix( colour, b.rgb, b.a );
			colour = mix( colour, c.rgb, c.a );
		}
		for ( int i = 0; i < ${MAX_COVERAGE_SITES}; i ++ ) {
			if ( i >= uSiteCount ) break;
			vec3 s = uSiteDir[ i ].xyz;
			vec3 e = uSiteEast[ i ];
			float m = max( abs( dot( d, e ) ), abs( dot( d, cross( s, e ) ) ) );
			// Only on the site's own side of the Moon, and near it.
			m = dot( d, s ) > 0.9995 ? m : 1.0;
			vec4 a = lunyxSquare( m, uSiteHalf.x, uCoverColor[ 3 ], 0.2 );
			vec4 b = lunyxSquare( m, uSiteHalf.y, uCoverColor[ 4 ], 0.24 );
			vec4 c = lunyxSquare( m, uSiteHalf.z * uSiteDir[ i ].w, uCoverColor[ 5 ], 0.3 );
			colour = mix( colour, a.rgb, a.a );
			colour = mix( colour, b.rgb, b.a );
			colour = mix( colour, c.rgb, c.a );
		}
	}
	#endif
	return colour;
}
`;

const FRAGMENT_HOLE = /* glsl */ `
#ifdef LUNYX_HOLE
	if ( normalize( vDir ).y < uCapHole ) discard;
#endif
#ifdef LUNYX_POLAR
	// Where a finer close-up window is drawn on top, this layer is left out.
	if ( vLunyxUv.x > uCut.x && vLunyxUv.x < uCut.z && vLunyxUv.y > uCut.y && vLunyxUv.y < uCut.w ) discard;
#endif
`;

const FRAGMENT_SHADOW = /* glsl */ `
#ifdef LUNYX_POLAR
	// Fraction of the Sun's disc that reaches this point over the real terrain (swept on the elevation grid).
	float lunyxLit = mix( 1.0, texture2D( uShadowMap, vLunyxUv ).r, uShadowOn );
	reflectedLight.directDiffuse *= lunyxLit;
	reflectedLight.directSpecular *= lunyxLit;
#endif
`;

const FRAGMENT_OVERLAY = /* glsl */ `
outgoingLight = lunyxOverlay( outgoingLight, normalize( vDir ) );
#ifdef LUNYX_POLAR
	{
		float lunyxAlpha = uFade;
		// Blend into the photographic globe towards the edge of the elevation data.
		lunyxAlpha *= 1.0 - smoothstep( uFadeLat.x, uFadeLat.y, normalize( vDir ).y );
		if ( uEdgeFade > 0.0 ) {
			vec2 e = min( vLunyxUv, 1.0 - vLunyxUv );
			lunyxAlpha *= smoothstep( 0.0, uEdgeFade, min( e.x, e.y ) );
		}
		diffuseColor.a *= lunyxAlpha;
	}
#endif
`;

export interface SurfacePatch {
  /** Constant height above the terrain, Moon radii (site imagery sits just above the relief). */
  lift?: number;
  /** Base relief tiles: leave a hole where the polar close-up is drawn. */
  hole?: boolean;
  /** Polar close-up: shadow map, fade towards the edge of the data. Its uniforms. */
  polar?: {
    uShadowMap: IUniform<Texture | null>;
    uShadowOn: IUniform<number>;
    uFade: IUniform<number>;
    /** Direction y (= sine of latitude) where the close-up starts to fade and where it is gone. */
    uFadeLat: IUniform<Vector2>;
    /** Width of the feathered border in texture units (0 = none). */
    uEdgeFade: IUniform<number>;
    /** Texture-space rectangle (min u, min v, max u, max v) left out because a finer window covers it. */
    uCut: IUniform<Vector4>;
    /** Texture-space rectangle under a finer window, where this layer is lowered by uSinkDepth (Moon radii). */
    uSink: IUniform<Vector4>;
    uSinkDepth: IUniform<number>;
  };
}

const patched = new Set<Material>();
let features = { overlay: 0, coverage: 0 };

/**
 * Switches the overlay code in every patched material (0 = none, 1 = Sun band, 2 = average
 * map; coverage outlines on or off). The shaders are recompiled, which takes a moment, so
 * this is for changes a person makes, not for animation.
 */
export function setSurfaceFeatures(overlay: number, coverage: boolean): void {
  const next = { overlay, coverage: coverage ? 1 : 0 };
  if (next.overlay === features.overlay && next.coverage === features.coverage) return;
  features = next;
  for (const m of patched) {
    m.defines = { ...m.defines, LUNYX_OVERLAY: features.overlay, LUNYX_COVERAGE: features.coverage };
    m.needsUpdate = true;
  }
}

/**
 * Makes a standard material draw relief, lunar shading and the overlays. The material's
 * geometry must follow the convention at the top of this file.
 */
export function patchSurfaceMaterial(material: Material, shared: SurfaceUniforms, options: SurfacePatch = {}): void {
  const lift: IUniform<number> = { value: options.lift ?? 0 };
  material.defines = { ...material.defines, LUNYX_OVERLAY: features.overlay, LUNYX_COVERAGE: features.coverage, ...(options.hole && { LUNYX_HOLE: '' }), ...(options.polar && { LUNYX_POLAR: '' }) };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, { uLift: lift }, options.polar ?? {});
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${VERTEX_PARS}`).replace('#include <begin_vertex>', VERTEX_BEGIN);
    let f = lunarFragmentShader(shader.fragmentShader);
    f = f.replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`);
    f = f.replace('#include <map_fragment>', `${FRAGMENT_HOLE}#include <map_fragment>`);
    f = f.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAGMENT_SHADOW}`);
    f = f.replace('#include <opaque_fragment>', `${FRAGMENT_OVERLAY}#include <opaque_fragment>`);
    shader.fragmentShader = f;
  };
  material.customProgramCacheKey = () => 'lunyx-surface';
  material.userData.lift = lift;
  patched.add(material);
  material.addEventListener('dispose', () => patched.delete(material));
}
