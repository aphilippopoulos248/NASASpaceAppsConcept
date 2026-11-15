// SIMULATED rovers: public/data/rovers.json, written by scripts/build-rovers.mjs.
//
// Nothing here is data. The rovers, their names, their positions and their routes are invented so
// that the surface view has vehicles moving at a believable pace (docs/DATA_SOURCES.md,
// "Simulated rovers"). Anything that shows one must say so.
//
// The file gives each rover a closed circuit of lat/lon points beside a real landing site. This
// module checks the file when it is read, turns a circuit into metres east and north of its site
// (the surface view's frame) and answers "where is the rover at this instant".
import { parseUtc } from '../core/time';

const MOON_RADIUS_M = 1_737_400;
const DEG = Math.PI / 180;

export interface RoverWaypoint {
  /** Degrees, north-positive. */
  lat: number;
  /** Degrees, east-positive, -180..180. */
  lon: number;
  /** The rover halts here for this many seconds. */
  stopS?: number;
  /** What the halt is for. */
  activity?: string;
}

export interface Rover {
  id: string;
  name: string;
  /** Always true: no rover in the file is real. */
  simulated: true;
  /** The landing in the catalogue it drives beside. */
  siteId: string;
  /** Country label, as in landings.json. */
  country: string;
  operator: string;
  kind: 'robotic' | 'crewed';
  role: string;
  massKg: number;
  /** Driving speed, metres per second. */
  speedMps: number;
  /** Seconds into a lap at the epoch. */
  phaseS: number;
  /** Length of one lap, metres. */
  lengthM: number;
  /** The first point of the path. */
  home: { lat: number; lon: number };
  /** A closed circuit: the last point leads back to the first. */
  path: RoverWaypoint[];
}

export interface RoverFile {
  /** Laps are counted from this instant, UTC ms. */
  epochMs: number;
  rovers: Rover[];
}

/** Checks and converts the file's content. Throws an Error that names the rover and the field. */
export function parseRovers(json: unknown): RoverFile {
  const file = json as { simulated?: unknown; epochUtc?: unknown; rovers?: unknown };
  if (file?.simulated !== true) throw new Error('rovers.json: must be marked "simulated": true.');
  if (typeof file.epochUtc !== 'string') throw new Error('rovers.json: "epochUtc" must be a UTC time.');
  const epochMs = parseUtc(file.epochUtc);
  if (!Array.isArray(file.rovers)) throw new Error('rovers.json: "rovers" must be a list.');
  const seen = new Set<string>();
  const rovers = file.rovers.map((raw, i): Rover => {
    const r = raw as Record<string, unknown>;
    const where = `rovers.json, rover ${typeof r?.id === 'string' ? `"${r.id}"` : i + 1}`;
    const fail = (what: string): never => {
      throw new Error(`${where}: ${what}`);
    };
    const text = (key: string, v: unknown = r[key]): string => (typeof v === 'string' && v.trim() ? v.trim() : fail(`"${key}" must be text.`));
    const num = (key: string, min: number, max: number, v: unknown = r[key]): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`"${key}" must be a number from ${min} to ${max}.`);
    if (typeof r !== 'object' || r === null) fail('must be an object.');

    const id = text('id');
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('"id" may hold lower-case letters, digits and hyphens only.');
    if (seen.has(id)) fail('this id is used twice.');
    seen.add(id);
    if (r.simulated !== true) fail('must be marked "simulated": true.');
    const kind = r.kind === 'robotic' || r.kind === 'crewed' ? r.kind : fail('"kind" must be "robotic" or "crewed".');
    if (!Array.isArray(r.path) || r.path.length < 3) fail('"path" must be a list of at least 3 points.');
    const path = (r.path as Record<string, unknown>[]).map((p, k): RoverWaypoint => {
      const lat = num(`path[${k}].lat`, -90, 90, p?.lat);
      const lon = num(`path[${k}].lon`, -180, 180, p?.lon);
      if (p.stopS === undefined) return { lat, lon };
      return { lat, lon, stopS: num(`path[${k}].stopS`, 0, 86_400, p.stopS), ...(p.activity !== undefined && { activity: text(`path[${k}].activity`, p.activity) }) };
    });
    const home = r.home as Record<string, unknown> | undefined;
    return {
      id,
      name: text('name'),
      simulated: true,
      siteId: text('siteId'),
      country: text('country'),
      operator: text('operator'),
      kind,
      role: text('role'),
      massKg: num('massKg', 1, 20_000),
      speedMps: num('speedMps', 0.001, 10),
      phaseS: num('phaseS', 0, 1e7),
      lengthM: num('lengthM', 1, 1e6),
      home: { lat: num('home.lat', -90, 90, home?.lat), lon: num('home.lon', -180, 180, home?.lon) },
      path,
    };
  });
  return { epochMs, rovers };
}

export async function loadRovers(): Promise<RoverFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/rovers.json`);
  if (!res.ok) throw new Error(`rovers.json: HTTP ${res.status}`);
  return parseRovers(await res.json());
}

let shared: Promise<RoverFile | null> | null = null;
/** The simulated rovers, read once and shared by the globe, the surface view and the site card; null when the file cannot be read (the app works without them). */
export function simulatedRovers(): Promise<RoverFile | null> {
  shared ??= loadRovers().catch((err) => {
    console.warn('Simulated rovers:', err instanceof Error ? err.message : err);
    return null;
  });
  return shared;
}

/**
 * The instant the rovers are placed for, UTC ms: real time, whatever the app's clock does, so
 * that they drive at their true speed and stand in the same place in every view. (The app's
 * clock usually runs at an hour a second, or stands still.)
 */
export function roverNowMs(): number {
  return Date.now();
}

/** The rovers placed beside one landing site. */
export function roversAtSite(rovers: readonly Rover[], siteId: string): Rover[] {
  return rovers.filter((r) => r.siteId === siteId);
}

/**
 * Where (lat, lon) lies from (lat0, lon0), in metres east and north along the great circle between
 * them: the inverse of offsetLatLon in src/scene/surface/ground.ts, so a point laid out with one
 * comes back with the other.
 */
export function localOffset(lat0: number, lon0: number, lat: number, lon: number): { eastM: number; northM: number } {
  const a = lat0 * DEG;
  const b = lat * DEG;
  const dLon = (lon - lon0) * DEG;
  const y = Math.sin(dLon) * Math.cos(b);
  const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dLon);
  const cosD = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dLon);
  // atan2 of the chord terms keeps millimetres at these distances, where acos(cosD) would not.
  const d = Math.atan2(Math.hypot(x, y), cosD) * MOON_RADIUS_M;
  const az = Math.atan2(y, x);
  return { eastM: d * Math.sin(az), northM: d * Math.cos(az) };
}

/** One step of a circuit: a halt at a point, then the drive to the next. Times are seconds into a lap. */
interface Leg {
  eastM: number;
  northM: number;
  /** When the rover arrives at this point. */
  arriveS: number;
  /** When it drives off again. */
  departS: number;
  /** Drive to the next point: its duration, and its heading in degrees clockwise from north. */
  driveS: number;
  headingDeg: number;
  activity?: string;
}

/** How far the circuit reaches from the site it is laid out around, metres. */
export function trackReachM(track: Pick<RoverTrack, 'points'>): number {
  return Math.max(...track.points.map((p) => Math.hypot(p.eastM, p.northM)));
}

/** Compass direction of an offset, in eight points: "NE". */
export function compassPoint(eastM: number, northM: number): string {
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((Math.atan2(eastM, northM) / DEG) + 360) % 360) / 45) % 8];
}

/** A rover's circuit in metres around its site, timed. */
export interface RoverTrack {
  rover: Rover;
  epochMs: number;
  /** Route points, metres east and north of the site. */
  points: { eastM: number; northM: number }[];
  /** Length of one lap, metres. */
  lengthM: number;
  /** Duration of one lap, driving and halts, seconds. */
  lapS: number;
  legs: Leg[];
}

export interface RoverState {
  /** Metres east and north of the site. */
  eastM: number;
  northM: number;
  /** The way it faces, degrees clockwise from north. */
  headingDeg: number;
  /** False while halted at a station. */
  moving: boolean;
  /** What it is doing while halted. */
  activity?: string;
}

/** Lays a rover's circuit out around its site (the landing it is placed beside). */
export function buildTrack(rover: Rover, site: { lat: number; lon: number }, epochMs: number): RoverTrack {
  const points = rover.path.map((p) => localOffset(site.lat, site.lon, p.lat, p.lon));
  const legs: Leg[] = [];
  let t = 0;
  let lengthM = 0;
  rover.path.forEach((p, i) => {
    const here = points[i];
    const next = points[(i + 1) % points.length];
    const dE = next.eastM - here.eastM;
    const dN = next.northM - here.northM;
    const dist = Math.hypot(dE, dN);
    const departS = t + (p.stopS ?? 0);
    const driveS = dist / rover.speedMps;
    legs.push({ ...here, arriveS: t, departS, driveS, headingDeg: ((Math.atan2(dE, dN) / DEG) + 360) % 360, activity: p.activity });
    t = departS + driveS;
    lengthM += dist;
  });
  return { rover, epochMs, points, lengthM, lapS: t, legs };
}

/**
 * Where the rover is at an instant (UTC ms). The circuit repeats without end, before the epoch as
 * well as after, so every clock time has an answer; at one simulated second per real second the
 * rover covers `speedMps` metres a second.
 */
export function roverStateAt(track: RoverTrack, timeMs: number): RoverState {
  const { legs, lapS } = track;
  const raw = ((timeMs - track.epochMs) / 1000 + track.rover.phaseS) % lapS;
  const s = raw < 0 ? raw + lapS : raw;
  // The last leg that has been reached.
  let lo = 0;
  let hi = legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (legs[mid].arriveS <= s) lo = mid;
    else hi = mid - 1;
  }
  const leg = legs[lo];
  if (s < leg.departS) {
    // Halted: still facing the way it drove in.
    const before = legs[(lo + legs.length - 1) % legs.length];
    return { eastM: leg.eastM, northM: leg.northM, headingDeg: before.headingDeg, moving: false, ...(leg.activity !== undefined && { activity: leg.activity }) };
  }
  const next = legs[(lo + 1) % legs.length];
  const f = leg.driveS > 0 ? Math.min(1, (s - leg.departS) / leg.driveS) : 1;
  return { eastM: leg.eastM + (next.eastM - leg.eastM) * f, northM: leg.northM + (next.northM - leg.northM) * f, headingDeg: leg.headingDeg, moving: true };
}

/**
 * Where the rovers of one site are at an instant, in a line for a reader who has to keep clear
 * of them: "Kestrel: 34 m NW of the lander, driving (circuit within 45 m)". Tracks must be laid
 * out around the lander.
 */
export function describeRovers(tracks: readonly RoverTrack[], timeMs: number): string {
  return tracks
    .map((t) => {
      const s = roverStateAt(t, timeMs);
      const doing = s.moving ? 'driving' : `halted${s.activity ? `: ${s.activity.toLowerCase()}` : ''}`;
      return `${t.rover.name}: ${Math.round(Math.hypot(s.eastM, s.northM))} m ${compassPoint(s.eastM, s.northM)} of the lander, ${doing} (circuit within ${Math.ceil(trackReachM(t))} m)`;
    })
    .join('; ');
}
