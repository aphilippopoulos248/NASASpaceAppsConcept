// Sun and Earth in a site's sky: the in-app model (src/astro/topocentric.ts) and
// bundled JPL Horizons tables, behind one "ephemeris" interface used by the series code.
import type { LatLon } from '../core/types';
import { EARTH_R_KM, SUN_R_KM, topocentricSky } from '../astro/topocentric';
import type { EphemerisSource, SkyInstant } from './types';

/** Measured agreement of the model with JPL Horizons (see docs/lunyx/validation.md). */
export const MODEL_ACCURACY_NOTE =
  'In-app model (astronomy-engine + IAU lunar rotation, light-time and aberration applied, airless): ' +
  'within 0.004 deg of JPL Horizons topocentric airless az/el (DE441) in all validation samples 1969-2035.';
export const HORIZONS_NOTE =
  'JPL Horizons table (DE441, CENTER coord@301, APPARENT=AIRLESS) bundled with the app, 10 min step, interpolated linearly between rows.';

const RAD = Math.PI / 180;
/** A table is used only within this distance of its site: 100 m tilts the local vertical by 0.0033 deg, within the model error budget. */
export const TABLE_MAX_SEP_M = 100;

/** Sun and Earth as seen from a site at one instant (topocentric, airless, in-app model). */
export function skyAt(site: LatLon, elevationM: number, timeMs: number): SkyInstant {
  if (!Number.isFinite(timeMs) || !Number.isFinite(site.lat) || !Number.isFinite(site.lon)) {
    throw new RangeError('skyAt: site and time must be finite numbers');
  }
  if (Math.abs(site.lat) > 90) throw new RangeError('skyAt: latitude must be within -90..90');
  const s = topocentricSky(site.lat, site.lon, Number.isFinite(elevationM) ? elevationM : 0, timeMs);
  return {
    timeMs,
    sun: { azDeg: s.sun.azDeg, elDeg: s.sun.elDeg, angularRadiusDeg: s.sun.angularRadiusDeg, distanceKm: s.sun.distanceKm },
    earth: { azDeg: s.earth.azDeg, elDeg: s.earth.elDeg, angularRadiusDeg: s.earth.angularRadiusDeg, distanceKm: s.earth.distanceKm },
    earthLitFraction: s.earthLitFraction,
    subEarth: s.subEarth,
    subSolar: s.subSolar,
    source: 'model',
  };
}

/** One Horizons table, as bundled in public/data/horizons/<id>.json. */
export interface HorizonsTable {
  id: string;
  label: string;
  siteId?: string;
  site: { lat: number; lon: number; heightM: number };
  startMs: number;
  stepMs: number;
  n: number;
  sun: { az: number[]; el: number[]; distKmHourly?: number[] };
  earth: { az: number[]; el: number[]; distKmHourly?: number[] };
  query?: Record<string, string>;
}

/** Anything that can give Sun/Earth az/el at an instant. */
export interface Ephemeris {
  source: EphemerisSource;
  note: string;
  /** Writes [sunAz, sunEl, earthAz, earthEl, sunRadius, earthRadius] (degrees) for an instant; `out` needs 6 slots. */
  at(timeMs: number, out: Float64Array): void;
  /** Full instant (distances, phase, libration) for display. */
  instant(timeMs: number): SkyInstant;
}

export function modelEphemeris(site: LatLon, elevationM: number): Ephemeris {
  return {
    source: 'model',
    note: MODEL_ACCURACY_NOTE,
    at(t, out) {
      const s = topocentricSky(site.lat, site.lon, elevationM, t);
      out[0] = s.sun.azDeg; out[1] = s.sun.elDeg; out[2] = s.earth.azDeg; out[3] = s.earth.elDeg;
      out[4] = s.sun.angularRadiusDeg; out[5] = s.earth.angularRadiusDeg;
    },
    instant: (t) => skyAt(site, elevationM, t),
  };
}

/** Great-circle separation of two sites, metres on the 1737.4 km sphere. */
export function siteSeparationM(a: LatLon, b: LatLon): number {
  const c = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) * 1_737_400;
}

/** Interpolates a direction given as az/el at two rows, through unit vectors (safe across north and near the zenith). */
function interpAzEl(az0: number, el0: number, az1: number, el1: number, f: number): [number, number] {
  const v = (az: number, el: number) => [Math.cos(el * RAD) * Math.sin(az * RAD), Math.cos(el * RAD) * Math.cos(az * RAD), Math.sin(el * RAD)];
  const a = v(az0, el0), b = v(az1, el1);
  const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f, z = a[2] + (b[2] - a[2]) * f;
  let az = Math.atan2(x, y) / RAD;
  if (az < 0) az += 360;
  return [az, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/** Whether a table can stand for a scenario: same place (within `maxSepM`) and the whole span inside the table. */
export function tableCovers(table: HorizonsTable, site: LatLon, startMs: number, endMs: number, maxSepM = TABLE_MAX_SEP_M): boolean {
  const last = table.startMs + (table.n - 1) * table.stepMs;
  return siteSeparationM(table.site, site) <= maxSepM && startMs >= table.startMs && endMs <= last;
}

/**
 * Ephemeris backed by a Horizons table. Az/el come from the table (interpolated between
 * rows); distances, Earth's phase and the libration points come from the model, which
 * agrees with Horizons to the accuracy stated in MODEL_ACCURACY_NOTE.
 */
export function horizonsEphemeris(table: HorizonsTable, site: LatLon, elevationM: number): Ephemeris {
  const last = table.startMs + (table.n - 1) * table.stepMs;
  const model = modelEphemeris(site, elevationM);
  const mo = new Float64Array(6);
  const hourlyEvery = Math.max(1, Math.round(3_600_000 / table.stepMs));
  /** Distance from the table's hourly column (linear), or NaN when the table has none. */
  const distAt = (col: number[] | undefined, t: number) => {
    if (!col || col.length < 2) return NaN;
    const x = (t - table.startMs) / (table.stepMs * hourlyEvery);
    const i = Math.max(0, Math.min(col.length - 2, Math.floor(x)));
    return col[i] + (col[i + 1] - col[i]) * (x - i);
  };
  const radius = (rKm: number, dKm: number) => Math.asin(Math.min(1, rKm / dKm)) / RAD;
  const rowAt = (t: number) => {
    if (!(t >= table.startMs && t <= last)) throw new RangeError(`time ${new Date(t).toISOString()} is outside Horizons table ${table.id}`);
    const x = (t - table.startMs) / table.stepMs;
    const i = Math.min(table.n - 2, Math.floor(x));
    return { i, f: x - i };
  };
  const eph: Ephemeris = {
    source: 'horizons',
    note: `${HORIZONS_NOTE} Table: ${table.id}${table.query?.fetched ? `, fetched ${table.query.fetched}` : ''}.`,
    at(t, out) {
      const { i, f } = rowAt(t);
      const s = interpAzEl(table.sun.az[i], table.sun.el[i], table.sun.az[i + 1], table.sun.el[i + 1], f);
      const e = interpAzEl(table.earth.az[i], table.earth.el[i], table.earth.az[i + 1], table.earth.el[i + 1], f);
      out[0] = s[0]; out[1] = s[1]; out[2] = e[0]; out[3] = e[1];
      const ds = distAt(table.sun.distKmHourly, t), de = distAt(table.earth.distKmHourly, t);
      if (Number.isFinite(ds) && Number.isFinite(de)) {
        out[4] = radius(SUN_R_KM, ds); out[5] = radius(EARTH_R_KM, de);
      } else {
        model.at(t, mo);
        out[4] = mo[4]; out[5] = mo[5];
      }
    },
    instant(t) {
      const m = skyAt(site, elevationM, t);
      const o = new Float64Array(6);
      eph.at(t, o);
      return { ...m, sun: { ...m.sun, azDeg: o[0], elDeg: o[1] }, earth: { ...m.earth, azDeg: o[2], elDeg: o[3] }, source: 'horizons' };
    },
  };
  return eph;
}

// ---------- bundled tables ----------

export interface HorizonsIndexEntry {
  id: string;
  label: string;
  siteId?: string;
  site: { lat: number; lon: number; heightM: number };
  startMs: number;
  stepMs: number;
  n: number;
  file: string;
  bytes: number;
}

/** Reads a bundled file by its path under public/ (e.g. "data/horizons/index.json"). Replaceable for Node and tests. */
export type BundleReader = (path: string) => Promise<string>;

const defaultReader: BundleReader = async (path) => {
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.text();
};

let reader: BundleReader = defaultReader;
let indexPromise: Promise<HorizonsIndexEntry[]> | null = null;
const tableCache = new Map<string, Promise<HorizonsTable>>();

/** Replace how bundled files are read (Node scripts and tests read from disk). */
export function setBundleReader(r: BundleReader): void {
  reader = r;
  indexPromise = null;
  tableCache.clear();
}

export function bundledHorizonsIndex(): Promise<HorizonsIndexEntry[]> {
  indexPromise ??= reader('data/horizons/index.json').then((t) => (JSON.parse(t) as { windows: HorizonsIndexEntry[] }).windows);
  return indexPromise;
}

export function loadHorizonsTable(entry: HorizonsIndexEntry): Promise<HorizonsTable> {
  let p = tableCache.get(entry.id);
  if (!p) {
    p = reader(`data/horizons/${entry.file}`).then((t) => JSON.parse(t) as HorizonsTable);
    tableCache.set(entry.id, p);
  }
  return p;
}

/** The bundled Horizons table covering this site and span, or null (then the model is used). Never throws: a missing bundle means "use the model". */
export async function findBundledTable(site: LatLon, startMs: number, endMs: number): Promise<HorizonsTable | null> {
  try {
    const idx = await bundledHorizonsIndex();
    for (const e of idx) {
      const last = e.startMs + (e.n - 1) * e.stepMs;
      if (siteSeparationM(e.site, site) <= TABLE_MAX_SEP_M && startMs >= e.startMs && endMs <= last) return await loadHorizonsTable(e);
    }
  } catch {
    // No bundle reachable: fall back to the model.
  }
  return null;
}
