// Lunyx shared contracts: the vocabulary every module (scenes, UI, analysis,
// assistant, server) agrees on. Pure types and constants only: no DOM, no three.js.
//
// Conventions used everywhere in the app (and shown to the user):
//   - Time is UTC. Instants are milliseconds since the Unix epoch.
//   - Latitude is north-positive; longitude is EAST-positive in -180..180,
//     in the Moon's Mean Earth / Polar Axis (ME) frame.
//   - Heights are metres above the 1737.4 km reference sphere (the LOLA datum).
//   - Azimuth is degrees clockwise from local north (N = 0, E = 90).
//   - Elevation is degrees above the local horizontal plane, with NO refraction
//     (the Moon is airless). "Skyline" is the terrain horizon as an elevation angle.

export const MOON_RADIUS_M = 1_737_400;
export const MOON_RADIUS_KM = 1737.4;

export interface LatLon {
  /** Degrees, north-positive. */
  lat: number;
  /** Degrees, east-positive, -180..180. */
  lon: number;
}

/** A place on the Moon that can be studied: a catalogued landing, a custom pin, or a scan candidate. */
export interface SiteRef extends LatLon {
  /** Stable id: a landing id ("apollo-11"), or "pin:<lat>,<lon>" for custom coordinates. */
  id: string;
  name: string;
  kind: 'landing' | 'custom' | 'candidate';
}

/** Everything a site analysis depends on. Two scenarios are comparable when they differ only where the user chose. */
export interface Scenario {
  id: string;
  label: string;
  site: SiteRef;
  /** Observer (antenna / solar array) height above the local terrain, metres. */
  mastHeightM: number;
  /** Start of the mission window (arrival), UTC ms. */
  startMs: number;
  /** Length of the mission window, hours. */
  durationH: number;
  /** Sampling step of the time series, minutes. */
  stepMin: number;
}

export type ViewMode = 'globe' | 'surface';
export type LightMode = 'real' | 'even';
/**
 * Colour overlay on the globe.
 *  - 'sun-band': where the Sun's elevation is inside the required band right now (smooth sphere, no terrain).
 *  - 'avg-illumination' / 'avg-earth-visibility': published long-term averages (PGDA product 69), polar regions only.
 */
export type OverlayMode = 'off' | 'sun-band' | 'avg-illumination' | 'avg-earth-visibility';

/** The single source of truth shared by the globe, the surface view, the charts, the comparison and the assistant. */
export interface AppState {
  /** Simulated instant, UTC ms. One clock for every view. */
  timeMs: number;
  playing: boolean;
  /** Simulated seconds per real second while playing. */
  rate: number;
  view: ViewMode;
  /** The site under study, or null when nothing is pinned. */
  site: SiteRef | null;
  /** Observer height above local terrain, metres. */
  mastHeightM: number;
  /** Mission window under evaluation (starts at arrival), UTC ms and hours. */
  windowStartMs: number;
  windowDurationH: number;
  /** Arrival delay being explored for the same site, hours (0 = none). */
  delayH: number;
  /** Saved scenarios for the side-by-side comparison. */
  compareA: Scenario | null;
  compareB: Scenario | null;
  comparing: boolean;
  /** Maximum acceptable terrain slope for nearby alternatives, degrees. */
  slopeLimitDeg: number;
  /** Largest Earth-visibility gap the mission tolerates, hours; null = no requirement. */
  maxEarthGapH: number | null;
  /** Required solar elevation band, degrees. Drives the 'sun-band' overlay and viability flags. */
  sunElMinDeg: number;
  sunElMaxDeg: number;
  overlay: OverlayMode;
  showMissions: boolean;
  /** Country territory colouring on the globe (nearest-site Voronoi). */
  showTerritories: boolean;
  /** 3D country flags on the landing markers (globe view). */
  showFlags: boolean;
  lightMode: LightMode;
  /** Globe camera: the point under the screen centre and the camera altitude. Written by the globe scene. */
  globeCenter: LatLon & { altitudeKm: number };
  /** Surface camera: where the viewer looks. Written by the surface scene. */
  look: { azDeg: number; elDeg: number; fovDeg: number };
  assistantOpen: boolean;
}

/** Imperative requests that are not state: a scene or panel carries them out. */
export interface AppCommands {
  /** Turn the globe so this point is centred (and optionally descend). */
  flyTo: LatLon & { altitudeKm?: number };
  /** Turn the surface camera towards an azimuth (and optionally an elevation). */
  lookAt: { azDeg: number; elDeg?: number };
  /** Short, non-blocking message to the user. */
  toast: { text: string; kind?: 'info' | 'warn' | 'error' };
}

/** Id for a custom pin, stable for a given coordinate (5 decimals is about 0.3 m on the Moon). */
export function pinId(lat: number, lon: number): string {
  return `pin:${lat.toFixed(5)},${lon.toFixed(5)}`;
}

/** Wraps a longitude into -180..180 (east-positive). */
export function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === -180 && lon > 0 ? 180 : w;
}
