// Science result contract. Owned by the ephemeris/analysis worker, who may extend it
// (additively where possible). UI and assistant code read these shapes; nothing here is
// ever filled with made-up numbers: a value that cannot be computed is NaN / null and
// the reason goes into `warnings`.
import type { LatLon, Scenario, SiteRef } from '../core/types';

/** Where a Sun/Earth direction came from. */
export type EphemerisSource =
  /** In-app model (astronomy-engine + IAU lunar rotation), validated against JPL Horizons. */
  | 'model'
  /** Table from JPL Horizons (airless, topocentric), bundled or fetched through the server proxy. */
  | 'horizons';

/** One body in a site's sky. Topocentric (as seen from the site itself), airless. */
export interface BodySky {
  /** Degrees clockwise from north. */
  azDeg: number;
  /** Degrees above the local horizontal, of the body's centre. */
  elDeg: number;
  /** Apparent radius of the disc, degrees. */
  angularRadiusDeg: number;
  distanceKm: number;
}

export interface SkyInstant {
  timeMs: number;
  sun: BodySky;
  earth: BodySky;
  /** Sunlit fraction of Earth's disc as seen from the site, 0..1. */
  earthLitFraction: number;
  /** Libration: the point on the Moon directly under Earth. */
  subEarth: LatLon;
  subSolar: LatLon;
  source: EphemerisSource;
}

/** Which elevation data was used over which distance range from the site. */
export interface DemLayerUse {
  name: string;
  resolutionM: number;
  fromM: number;
  toM: number;
}

/** The terrain skyline around an observer, with the Moon's curvature included. */
export interface HorizonProfile {
  site: LatLon;
  /** Terrain height at the site, metres above the reference sphere. */
  siteElevationM: number;
  mastHeightM: number;
  /** Sample i is at azimuth i * azStepDeg (0 = north, clockwise). */
  azStepDeg: number;
  /** Skyline elevation above the local horizontal, degrees. */
  elevDeg: Float32Array;
  /** Ground distance to the terrain that forms the skyline at each azimuth, metres. */
  distM: Float32Array;
  /** Height of that terrain, metres above the reference sphere. */
  heightM: Float32Array;
  /** Where the horizon of a perfectly smooth Moon would sit for this observer height, degrees (negative). */
  smoothDipDeg: number;
  /** How far out terrain was searched, metres. */
  maxRangeM: number;
  layers: DemLayerUse[];
  /** Per azimuth: index into `layers` of the data that forms the skyline there. */
  skylineLayer: Uint8Array;
  warnings: string[];
}

/** Sun and Earth over a mission window, sampled at a fixed step. */
export interface SkySeries {
  startMs: number;
  stepMs: number;
  n: number;
  sunAz: Float32Array;
  sunEl: Float32Array;
  earthAz: Float32Array;
  earthEl: Float32Array;
  /** Elevation of the body's centre minus the skyline at its azimuth, degrees. Negative = centre hidden. */
  sunClearance: Float32Array;
  earthClearance: Float32Array;
  /** Fraction of the disc above the skyline, 0..1. */
  sunVisible: Float32Array;
  earthVisible: Float32Array;
  /** Fraction of the solar disc covered by Earth's disc (an eclipse of the Sun as seen from the site), 0..1. Already included in `sunVisible`. */
  sunEclipsed: Float32Array;
  source: EphemerisSource;
}

/** Half-open time span [startMs, endMs). `openStart` / `openEnd` mark spans cut by the window edge. */
export interface Interval {
  startMs: number;
  endMs: number;
  openStart?: boolean;
  openEnd?: boolean;
}

export interface WindowMetrics {
  /** Time-averaged visible fraction of the solar disc, percent. */
  illuminationPct: number;
  /** Percent of the window with any part of the Sun above the skyline. */
  sunAnyPct: number;
  /** Longest continuous spell with the Sun entirely hidden, hours (a lower bound if `darknessOpenEnded`). */
  longestDarknessH: number;
  darknessOpenEnded: boolean;
  /** Percent of the window with direct line of sight to Earth's centre (geometry only, not a link budget). */
  earthVisiblePct: number;
  /** Longest continuous spell without that line of sight, hours (a lower bound if `earthGapOpenEnded`). */
  longestEarthGapH: number;
  earthGapOpenEnded: boolean;
  maxSunElDeg: number;
  minSunElDeg: number;
  sunIntervals: Interval[];
  darkIntervals: Interval[];
  earthIntervals: Interval[];
  earthGapIntervals: Interval[];
  /** Spans when Earth covers part or all of the Sun (seen from the site, geometric, Earth's atmosphere ignored). */
  eclipseIntervals: Interval[];
}

export interface SkyEvent {
  type: 'sunrise' | 'sunset' | 'earthrise' | 'earthset';
  timeMs: number;
  azDeg: number;
}

/** Why a body is (or is not) hidden at an instant: the "blocking ridge". */
export interface Blockage {
  body: 'sun' | 'earth';
  timeMs: number;
  blocked: boolean;
  bodyAzDeg: number;
  bodyElDeg: number;
  skylineElDeg: number;
  /** bodyElDeg - skylineElDeg. */
  clearanceDeg: number;
  /** The terrain that forms the skyline in that direction. */
  ridgeDistanceM: number;
  ridgeHeightM: number;
  ridge: LatLon;
  demName: string;
  demResolutionM: number;
  /** One or two plain sentences stating the above. */
  explanation: string;
  /** Fraction of the body's disc above the skyline at that instant, 0..1 (NaN without a skyline). `blocked` is about the centre only. */
  discVisibleFraction?: number;
  /** Sun only: fraction of its disc covered by Earth at that instant (an eclipse seen from the site), 0..1. */
  eclipsedFraction?: number;
}

export interface SlopeInfo {
  /** Degrees from horizontal; NaN when no elevation data covers the site. */
  slopeDeg: number;
  /** Compass direction the ground falls towards, degrees. */
  aspectDeg: number;
  /** Distance over which the slope was measured, metres. */
  baselineM: number;
  demName: string;
}

export interface Provenance {
  ephemeris: EphemerisSource;
  /** Stated accuracy of the ephemeris source, e.g. "within 0.02 deg of JPL Horizons over 1966-2035 samples". */
  ephemerisNote: string;
  dem: DemLayerUse[];
  assumptions: string[];
  /** The terrain module's own sentences about the elevation data at this site: what is loaded, how far each layer reaches, what is missing. */
  terrainNotes?: string[];
}

/** A ground station on Earth, with the published facts the geometry uses. */
export interface GroundStation {
  /** e.g. "DSS-14". */
  id: string;
  /** e.g. "Goldstone DSS-14 (70 m)". */
  name: string;
  /** e.g. "Goldstone, California, USA". */
  complex: string;
  /** Geodetic latitude (north-positive) and longitude (east-positive, -180..180) on the WGS 84 ellipsoid, degrees. */
  latDeg: number;
  lonDeg: number;
  /** Height above the WGS 84 ellipsoid, metres. */
  heightM: number;
  /** Cartesian position in the Earth-fixed frame (ITRF93), metres. */
  xyzM: [number, number, number];
  /** Elevation limits assumed for this station, degrees: for receiving, and for transmitting. */
  receiveMaskDeg: number;
  transmitMaskDeg: number;
}

/** Spans of geometric line of sight and the gaps between them, within the mission window. */
export interface ContactSummary {
  intervals: Interval[];
  gapIntervals: Interval[];
  /** Percent of the window inside `intervals`. */
  pct: number;
  /** Longest gap, hours (a lower bound if `gapOpenEnded`: it runs into a window edge). */
  longestGapH: number;
  gapOpenEnded: boolean;
}

/** Geometric opportunities between the site and one station. */
export interface StationOpportunities {
  station: GroundStation;
  /** The site is above the station's receive limit AND the station is above the site's terrain skyline. */
  receive: ContactSummary;
  /** The same with the station's transmit limit (two-way geometry). */
  transmit: ContactSummary;
  /** Per sample of `series`: elevation of the site as seen from the station, degrees (airless). */
  stationElDeg: Float32Array;
  /** Per sample of `series`: the station's elevation in the site's sky minus the skyline at its azimuth, degrees (negative = hidden by lunar terrain). */
  siteClearanceDeg: Float32Array;
}

/** One station at one instant (geometry only). */
export interface StationInstant {
  station: GroundStation;
  timeMs: number;
  /** The site in the station's sky: degrees above its horizontal (airless) and azimuth clockwise from north. */
  stationElDeg: number;
  stationAzDeg: number;
  /** The station in the site's sky. */
  siteElDeg: number;
  siteAzDeg: number;
  /** siteElDeg minus the skyline at siteAzDeg (NaN without a skyline). */
  siteClearanceDeg: number;
  /** Straight-line distance at that instant, km (geometric; within about 50 km of the light-time range). */
  rangeKm: number;
  /** Line of sight with the station's receive / transmit elevation limit. */
  receive: boolean;
  transmit: boolean;
  /** What prevents receiving: the site is below the station's receive limit, lunar terrain hides the station, both, or nothing. */
  blockedBy: 'nothing' | 'station-horizon' | 'lunar-terrain' | 'both' | 'unknown';
}

/**
 * Geometric contact opportunities with the three Deep Space Network complexes.
 * Geometry only: no link budget, no scheduling, no antenna availability, no station terrain mask.
 */
export interface DsnOpportunities {
  stations: StationOpportunities[];
  /** At least one station, receive limits. */
  anyReceive: ContactSummary;
  /** At least one station, transmit limits. */
  anyTransmit: ContactSummary;
  /** Where the station facts come from and what was assumed, in words. */
  assumptions: string[];
}

/** Complete analysis of one scenario. */
export interface SiteAnalysis {
  scenario: Scenario;
  horizon: HorizonProfile;
  series: SkySeries;
  metrics: WindowMetrics;
  events: SkyEvent[];
  slope: SlopeInfo;
  provenance: Provenance;
  warnings: string[];
  /** Extension: geometric opportunities with the DSN stations over the window. Absent when no skyline could be computed. */
  dsn?: DsnOpportunities;
}

export interface NearbyOptions {
  /** Search radius around the site, metres. */
  radiusM: number;
  /** Spacing between candidates, metres. */
  spacingM: number;
  slopeLimitDeg: number;
  /** Relative weights of sunlight and Earth contact in the ranking score. */
  weightSun: number;
  weightEarth: number;
  /** Optional speed/accuracy settings for the scan (defaults in DEFAULT_NEARBY_OPTIONS). */
  azStepDeg?: number;
  stepMin?: number;
}

export interface NearbyCandidate {
  site: SiteRef;
  eastM: number;
  northM: number;
  distanceM: number;
  elevationM: number;
  slope: SlopeInfo;
  /** null when the candidate was rejected before the sky analysis. */
  metrics: WindowMetrics | null;
  rejected: null | 'slope' | 'no-data';
  /** Weighted score used for ranking; higher is better. NaN when rejected. */
  score: number;
  /** 1 = best; 0 when rejected. */
  rank: number;
  /** Compass bearing from the scenario's site to this candidate, degrees clockwise from north (NaN for the site itself). */
  bearingDeg?: number;
  /** True for the scenario's own site (always included, even when over the slope limit). */
  isReference: boolean;
  /** What the skyline and slope rest on and which settings were traded for speed, in words. */
  basis: string;
}

/** Signed differences B - A between two analyses, plus sentences a person can read. */
export interface ComparisonDiff {
  illuminationPct: number;
  longestDarknessH: number;
  earthVisiblePct: number;
  longestEarthGapH: number;
  slopeDeg: number;
  /** Most important differences first. */
  highlights: string[];
  /** How the two sides are named in `highlights` (their labels when short and distinct, otherwise what differs between them). */
  names?: { a: string; b: string };
}
