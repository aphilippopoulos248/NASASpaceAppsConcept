// How deterministic mode writes values: always with a unit, times in UTC, longitudes
// east-positive, and "unavailable" (never a made-up number) when a result has no value.
export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Reads `a.b.c` from a result. */
export function at(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const key of path.split('.')) {
    if (!isObject(cur)) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** The first of several paths that holds a finite number. */
export function num(value: unknown, ...paths: string[]): number | undefined {
  for (const p of paths) {
    const v = at(value, p);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

export function str(value: unknown, ...paths: string[]): string | undefined {
  for (const p of paths) {
    const v = at(value, p);
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

export const UNAVAILABLE = 'unavailable';

const fixed = (v: number | undefined, digits: number, unit: string): string => (v === undefined ? UNAVAILABLE : `${v.toFixed(digits)}${unit}`);

export const degrees = (v: number | undefined, digits = 1): string => fixed(v, digits, '°');
export const hours = (v: number | undefined): string => fixed(v, 1, ' h');
export const percent = (v: number | undefined): string => fixed(v, 1, ' %');

export function distance(metres: number | undefined): string {
  if (metres === undefined) return UNAVAILABLE;
  return Math.abs(metres) >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`;
}

/** "latitude -89.4500°, longitude 137.2000° (east-positive)". */
export function coordinates(lat: number | undefined, lon: number | undefined): string {
  if (lat === undefined || lon === undefined) return 'coordinates unavailable';
  return `latitude ${lat.toFixed(4)}°, longitude ${lon.toFixed(4)}° (east-positive)`;
}

/** "2025-03-14T06:00Z" -> "2025-03-14 06:00 UTC". Anything else is returned with "UTC" appended. */
export function utc(isoText: string | undefined): string {
  if (!isoText) return UNAVAILABLE;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(isoText);
  return m ? `${m[1]} ${m[2]} UTC` : `${isoText} UTC`;
}

const BEARINGS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/** "north-east (47°)". */
export function bearing(deg: number | undefined): string {
  if (deg === undefined) return 'bearing unavailable';
  const wrapped = ((deg % 360) + 360) % 360;
  return `${BEARINGS[Math.round(wrapped / 45) % 8]} (${wrapped.toFixed(0)}°)`;
}

/** "3 d 04 h", "5 h 12 min": a duration given in hours. */
export function span(hoursValue: number | undefined): string {
  if (hoursValue === undefined) return UNAVAILABLE;
  const totalMin = Math.round(Math.abs(hoursValue) * 60);
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), min = totalMin % 60;
  if (d > 0) return `${d} d ${String(h).padStart(2, '0')} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} min`;
  return `${min} min`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
