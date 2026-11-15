import { Vector3 } from 'three';

export interface Landing {
  id: string;
  name: string;
  program: string;
  country: string;
  /** ISO date (UTC) of touchdown. */
  date: string;
  /** Touchdown time, UTC, HH:MM. */
  time: string;
  /** Degrees, north-positive. */
  lat: number;
  /** Degrees, east-positive, -180..180. */
  lon: number;
  crewed: boolean;
  /** True when the position is only loosely known. */
  approx?: boolean;
  region: string;
  summary: string;
}

export const PROGRAM_COLORS: Record<string, string> = {
  Apollo: '#ffd23f',
  Surveyor: '#3fa7ff',
  Luna: '#ff4d6d',
  "Chang'e": '#c77dff',
  Chandrayaan: '#ff9a3c',
  SLIM: '#ffffff',
  'Commercial (CLPS)': '#2ee6a6',
};

export function programColor(program: string): string {
  return PROGRAM_COLORS[program] ?? '#cccccc';
}

/**
 * Colour for each country, keyed by the country label in landings.json. The USSR's colour is
 * Russia's, as the app shows those sites as Russia (see src/data/ownership.ts).
 */
export const COUNTRY_COLORS: Record<string, string> = {
  USA: '#4f9dff',
  USSR: '#ff4d5e',
  China: '#ffd23f',
  India: '#ff9a3c',
  Japan: '#d77dff',
};

export function countryColor(country: string): string {
  return COUNTRY_COLORS[country] ?? '#cccccc';
}

/** The colour a landing is drawn in: its country's. */
export function landingColor(l: Landing): string {
  return countryColor(l.country);
}

export async function loadLandings(): Promise<Landing[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/landings.json`);
  if (!res.ok) throw new Error(`landings.json: HTTP ${res.status}`);
  const json = (await res.json()) as { landings: Landing[] };
  return json.landings;
}

/**
 * Selenographic lat/lon to scene coordinates. Matches the UV layout of
 * THREE.SphereGeometry with an equirectangular map centred on 0° longitude:
 * +Y is the north pole, +X is the sub-Earth point (0°, 0°), east is -Z.
 */
export function latLonToVec3(latDeg: number, lonDeg: number, radius = 1, out = new Vector3()): Vector3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return out.set(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon),
  );
}

export function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const MOON_RADIUS_M = 1737400;

/** Deep link to LROC QuickMap, framed on the site (equirectangular view, metres). */
export function quickmapUrl(l: Landing, halfWidthM = 16000): string {
  const x = (MOON_RADIUS_M * l.lon * Math.PI) / 180;
  const y = (MOON_RADIUS_M * l.lat * Math.PI) / 180;
  const hh = halfWidthM * 0.55;
  const extent = [x - halfWidthM, y - hh, x + halfWidthM, y + hh].map((v) => v.toFixed(1)).join(',');
  return `https://quickmap.lroc.im-ldi.com/?prjExtent=${encodeURIComponent(extent)}&proj=10`;
}

/** Deep link to NASA Moon Trek, centred on the site. */
export function trekUrl(l: Landing): string {
  const crs = encodeURIComponent('urn:ogc:def:crs:EPSG::104903');
  return `https://trek.nasa.gov/moon/#v=0.1&x=${l.lon}&y=${l.lat}&z=9&p=${crs}&d=&b=moon`;
}

/** Touchdown as a Date. */
export function landingDate(l: Landing): Date {
  return new Date(`${l.date}T${l.time}:00Z`);
}
