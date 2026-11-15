// Number and time formatting for the compare panel. One place, so A, B and the differences
// read the same everywhere. A value that does not exist is said in words, never as a number.
import { formatUtc } from '../../core/time';

export const NOT_AVAILABLE = 'not available';
const MINUS = '−';

const fixed = (v: number, digits: number) => v.toFixed(digits).replace('-', MINUS);

/** "92.5 %" */
export function pctText(v: number, digits = 1): string {
  return Number.isFinite(v) ? `${fixed(v, digits)} %` : NOT_AVAILABLE;
}

/** "18.2 h"; from two days up also in days: "379.8 h (15.8 d)". */
export function hoursText(h: number): string {
  if (!Number.isFinite(h)) return NOT_AVAILABLE;
  if (Math.abs(h) < 0.05) return 'none';
  return Math.abs(h) >= 48 ? `${fixed(h, 1)} h (${fixed(h / 24, 1)} d)` : `${fixed(h, 1)} h`;
}

/** "2.5°" with a real minus sign. */
export function degText(v: number, digits = 1): string {
  return Number.isFinite(v) ? `${fixed(v, digits)}°` : NOT_AVAILABLE;
}

/** "+4.1", "−10.8", "0.0": a difference with its sign. */
export function signedText(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return NOT_AVAILABLE;
  const r = Number(v.toFixed(digits));
  return r === 0 ? (0).toFixed(digits) : `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(digits)}`;
}

/** "84.790° S, 29.200° E" (east-positive longitude said as E/W). */
export function coordsText(lat: number, lon: number, digits = 3): string {
  return `${Math.abs(lat).toFixed(digits)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(digits)}° ${lon >= 0 ? 'E' : 'W'}`;
}

/** "2025-03-06 17:28 UTC" */
export const utcText = (ms: number) => formatUtc(ms);

/** "60 m", "1.9 km": the spacing of an elevation grid. */
export function resolutionText(metres: number): string {
  if (!Number.isFinite(metres)) return 'unknown resolution';
  return metres < 1000 ? `${Number(metres.toFixed(metres < 10 ? 1 : 0))} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** "671 m", "1.8 km" */
export function distanceText(metres: number): string {
  if (!Number.isFinite(metres)) return NOT_AVAILABLE;
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(2).replace(/0$/, '')} km`;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
/** "207° (SSW)" */
export function bearingText(deg: number): string {
  if (!Number.isFinite(deg)) return '';
  const d = ((deg % 360) + 360) % 360;
  return `${Math.round(d)}° (${COMPASS[Math.round(d / 22.5) % 16]})`;
}
