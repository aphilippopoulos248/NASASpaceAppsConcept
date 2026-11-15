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
  /**
   * The skyline read at a finer azimuth step where the Sun's or Earth's disc comes near it in the
   * analysed window (src/analysis/fineSkyline.ts). Where a segment covers an azimuth, skylineAt()
   * reads it instead of the main profile, so a notch or a peak narrower than `azStepDeg` under a disc
   * is seen when it rises or sets. Absent or empty: the main profile everywhere.
   */
  fine?: FineSkyline[];
}

/** One stretch of skyline at a fine azimuth step: sample k is at azimuth (k0 + k) / perDeg degrees (taken modulo 360). */
export interface FineSkyline {
  /** Index of the first sample on the fine grid: its azimuth is k0 / perDeg degrees, 0 <= k0 < 360 * perDeg. */
  k0: number;
  /** Samples per degree (20 = every 0.05 deg). */
  perDeg: number;
  /** Skyline elevation above the local horizontal, degrees, as in HorizonProfile.elevDeg. */
  elevDeg: Float32Array;
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

/** A darkness or an Earth gap measured in full: followed beyond the analysed window to its real start and end. */
export interface FullSpan {
  startMs: number;
  endMs: number;
  /** endMs - startMs, hours. A lower bound when `startFound` or `endFound` is false. */
  hours: number;
  /** False when the search limit was reached before the real start (end) was found. */
  startFound: boolean;
  endFound: boolean;
  /** How far beyond a window edge the search goes at most, days. */
  limitDays: number;
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
  /**
   * The longest darkness that overlaps the window, measured in full: where it runs past a window
   * edge it is followed to its real start or end (up to 60 days each way, with the in-app model).
   * `longestDarknessH` stays the part inside the window. Absent when the window has no darkness,
   * and in the nearby scan.
   */
  longestDarknessFull?: FullSpan;
  /** The same for the longest spell without line of sight to Earth's centre. */
  longestEarthGapFull?: FullSpan;

  // ---- Earth by disc (T-31 item 3). The fields above count Earth's CENTRE; these count ANY PART of
  // Earth's disc above the skyline, the definition of the long-term Earth map of NASA PGDA product 69.
  // Shown next to the centre figures, never instead of them. Filled by every analysis, nearby
  // candidate and outlook evaluation from this build on; optional only so that hand-built objects
  // still type-check.

  /** Percent of the window with any part of Earth's disc above the skyline (geometry only, not a link budget). At least earthVisiblePct. */
  earthAnyPct?: number;
  /** Longest continuous spell with Earth's disc wholly behind the skyline, hours (a lower bound if `earthAnyGapOpenEnded`). At most longestEarthGapH. */
  longestEarthAnyGapH?: number;
  earthAnyGapOpenEnded?: boolean;
  /** Spans with any part of Earth's disc above the skyline, and the spans with none of it. */
  earthAnyIntervals?: Interval[];
  earthAnyGapIntervals?: Interval[];
  /** The longest spell with Earth's disc wholly hidden that overlaps the window, measured in full (as `longestEarthGapFull`). Absent when there is none, and in the nearby scan. */
  longestEarthAnyGapFull?: FullSpan;
}

export interface SkyEvent {
  /**
   * Which instant each type is (unchanged; decision D-8 of the Lunyx hub):
   * sunrise = the first part of the Sun's disc appears above the terrain skyline ("Sun starts rising");
   * sunset = the last part of the Sun's disc goes behind it ("Sun fully set");
   * earthrise / earthset = the centre of Earth's disc crosses the skyline ("Earth's centre rises / sets").
   * A rise or set is not one moment: `span` gives the whole passage the event belongs to.
   */
  type: 'sunrise' | 'sunset' | 'earthrise' | 'earthset';
  timeMs: number;
  azDeg: number;
  /**
   * The passage of the disc through the skyline that this event is one instant of (T-31 item 2):
   * a sunset is its `end` (edge 'last-limb'), a sunrise its `start` (edge 'first-limb'), an Earthset or
   * Earthrise one of its `centre` crossings. The same object as the matching entry of
   * `SiteAnalysis.transitions`. Present on every event of analyse() from this build on; optional only so
   * that events built by hand still type-check.
   */
  span?: SkyTransition;
}

// ---------- passages through the skyline: both ends of every rise and set (T-31 item 2, D-8) ----------

/**
 * One end of a passage of a disc through the terrain skyline (terrain only: Earth in front of the Sun
 * is an eclipse, in `eclipseIntervals`, not a set).
 * - 'first-cut': the skyline starts to cut into a disc that was wholly clear of it ("starts setting");
 * - 'last-limb': the last part of the disc goes behind the skyline ("fully set");
 * - 'first-limb': the first part of a hidden disc comes above the skyline ("starts rising");
 * - 'whole-clear': the whole disc is clear of the skyline ("fully risen");
 * - 'unresolved': this end lies beyond the analysed window and was not found within the search limit
 *   (`limitDays`): the time is then where the search stopped, not an event.
 */
export type TransitionEdge = 'first-cut' | 'last-limb' | 'first-limb' | 'whole-clear' | 'unresolved';

/**
 * What the disc did between the two ends.
 * - 'set': from wholly clear to wholly hidden (first cut ... last limb);
 * - 'rise': from wholly hidden to wholly clear (first limb ... whole disc clear);
 * - 'graze': the skyline cut into the disc and let go of it again without hiding it completely
 *   (first cut ... whole disc clear): "partly hidden, never fully set";
 * - 'peek': part of the disc came above the skyline and went again without the whole disc clearing it
 *   (first limb ... last limb): "partly visible, never fully risen";
 * - 'unresolved': one end is 'unresolved'.
 */
export type TransitionKind = 'set' | 'rise' | 'graze' | 'peek' | 'unresolved';

/** One instant of a passage. */
export interface TransitionInstant {
  /** UTC, ms. */
  timeMs: number;
  /** Azimuth of the disc's centre at that instant, degrees clockwise from north. */
  azDeg: number;
  /** False when the instant lies outside the analysed window: it was found by following the passage with the in-app model (or, for edge 'unresolved', is where that search stopped). */
  inWindow: boolean;
}

/**
 * A passage of the Sun's or Earth's disc through the terrain skyline: the span in which the disc is
 * neither wholly clear of the skyline nor wholly behind it. Every sunrise, sunset, Earthrise and Earthset
 * of `SiteAnalysis.events` lies in exactly one; grazes and peeks may have no event at all.
 */
export interface SkyTransition {
  body: 'sun' | 'earth';
  kind: TransitionKind;
  /** First cut ('set', 'graze') or first limb ('rise', 'peek'). */
  start: TransitionInstant & { edge: 'first-cut' | 'first-limb' | 'unresolved' };
  /** Last limb ('set', 'peek') or whole disc clear ('rise', 'graze'). */
  end: TransitionInstant & { edge: 'last-limb' | 'whole-clear' | 'unresolved' };
  /** end - start, hours (a lower bound when an end is 'unresolved'). */
  hours: number;
  /** The disc's centre crossing the skyline during the passage, in time order (up = coming above it). For Earth these are the earthrise / earthset events (inside the window). */
  centre: (TransitionInstant & { up: boolean })[];
  /**
   * Least and largest fraction of the disc above the skyline at the analysis' samples inside the window
   * during the passage (0..1; NaN when no sample falls inside it). For a graze, 1 - minVisibleFraction is
   * how much of the disc the skyline hides at most; for a peek, maxVisibleFraction how much shows at most.
   * Sampled every `Scenario.stepMin`, so a brief extreme can be missed.
   */
  minVisibleFraction: number;
  maxVisibleFraction: number;
  /** How far beyond a window edge an end was searched for, days. */
  limitDays: number;
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

/** Settings of the seasonal outlook. */
export interface OutlookOptions {
  /** Length of the outlook in synodic months of 29.53 days (default 12, at most 60). */
  months?: number;
  /** Length of each row's window, days (default: one lunar day, 29.530589 days). */
  windowDays?: number;
  /** Sampling step, minutes (default 20). */
  stepMin?: number;
  /** Weights of sunlight and Earth line of sight in the arrival score (defaults 1 and 1, as in the nearby ranking). */
  weightSun?: number;
  weightEarth?: number;
}

/** One window of the outlook: a lunar day unless `windowDays` says otherwise. */
export interface OutlookRow {
  /** 1 = the window that starts at the scenario's start. */
  index: number;
  startMs: number;
  endMs: number;
  /** Time-averaged visible fraction of the solar disc over this window, percent. */
  illuminationPct: number;
  /** Percent of this window with any part of the Sun above the skyline. */
  sunAnyPct: number;
  /** Longest darkness overlapping this window, measured in full (not cut at the window's edges), hours. */
  longestDarknessH: number;
  /** False when that darkness runs beyond what was searched: `longestDarknessH` is then a lower bound. */
  darknessComplete: boolean;
  /** The same darkness cut at this window's edges, hours: what analyse() calls longestDarknessH for this window. */
  longestDarknessInWindowH: number;
  /** Percent of this window with line of sight to Earth's centre (geometry only). */
  earthVisiblePct: number;
  /** Percent of this window with any part of Earth's disc above the skyline (PGDA product 69's definition; T-31). Optional only so that hand-built rows type-check. */
  earthAnyPct?: number;
  /** Longest spell without that line of sight overlapping this window, in full, hours. */
  longestEarthGapH: number;
  earthGapComplete: boolean;
  longestEarthGapInWindowH: number;
  maxSunElDeg: number;
  minSunElDeg: number;
}

/** A mission-length window that starts at a given arrival time. */
export interface ArrivalOption {
  startMs: number;
  endMs: number;
  /** Arrival minus the scenario's own start, days. */
  slipDays: number;
  illuminationPct: number;
  sunAnyPct: number;
  earthVisiblePct: number;
  /** Longest darkness inside the mission window, hours (cut at its edges). */
  longestDarknessH: number;
  /** Weighted mean of illuminationPct and earthVisiblePct: the score of the nearby ranking. */
  score: number;
}

/**
 * The long view for one site and mast height: conditions per lunar day across a span of
 * months, and how a mission of the scenario's length fares for every arrival date in it.
 * One skyline, the in-app Sun/Earth model throughout. No statement about power or temperature.
 */
export interface Outlook {
  scenario: Scenario;
  /** The span covered by `rows`: from the scenario's start. */
  startMs: number;
  endMs: number;
  months: number;
  windowDays: number;
  stepMin: number;
  rows: OutlookRow[];
  /**
   * Mission-length windows by arrival time, for charts: arrival i starts at startMs + i * stepMs
   * and lasts missionH hours. Arrays have n entries. Empty (n = 0) when nothing could be computed.
   */
  arrivals: {
    startMs: number;
    stepMs: number;
    n: number;
    missionH: number;
    score: Float32Array;
    illuminationPct: Float32Array;
    earthVisiblePct: Float32Array;
    longestDarknessH: Float32Array;
  };
  /** The scenario's own arrival, and the best and worst arrivals of the span by score (null when nothing could be computed). */
  planned: ArrivalOption | null;
  best: ArrivalOption | null;
  worst: ArrivalOption | null;
  /** The planned arrival delayed by 1, 3, 7, 14 and 28 days (those that fit in the span). */
  slips: ArrivalOption[];
  /** The longest darkness and the longest Earth gap anywhere in the span, measured in full. */
  longestDarkness: FullSpan | null;
  longestEarthGap: FullSpan | null;
  /** Headline sentences built only from the numbers above. */
  highlights: string[];
  /** The elevation data the skyline rests on, by distance range. */
  dem: DemLayerUse[];
  /** Span, step, model and terrain basis, in words. */
  assumptions: string[];
  warnings: string[];
}

/** Complete analysis of one scenario. */
export interface SiteAnalysis {
  scenario: Scenario;
  horizon: HorizonProfile;
  series: SkySeries;
  metrics: WindowMetrics;
  events: SkyEvent[];
  /**
   * Every passage of the Sun's and Earth's discs through the terrain skyline that overlaps the window,
   * in time order of their start (T-31 item 2, D-8). Ends beyond the window are followed with the in-app
   * model up to `limitDays`. Empty when no skyline could be computed; optional only so that hand-built
   * analyses type-check.
   */
  transitions?: SkyTransition[];
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
  /** B - A of the Earth's-centre figure (percentage points). */
  earthVisiblePct: number;
  /** B - A of the any-part-of-Earth's-disc figure (percentage points; T-31). Optional only so that hand-built objects type-check. */
  earthAnyPct?: number;
  longestEarthGapH: number;
  slopeDeg: number;
  /** Most important differences first. */
  highlights: string[];
  /** How the two sides are named in `highlights` (their labels when short and distinct, otherwise what differs between them). */
  names?: { a: string; b: string };
}
