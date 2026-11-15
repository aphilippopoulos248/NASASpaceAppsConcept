// Filters > "Centre of view": two fields for the point under the screen centre, and "Drop pin at
// centre". The logic without the DOM, so it can be tested (centreFields.test.ts).
//
// What went wrong before (lunyx-experience Q-1, Q-2): the fields showed the camera's centre,
// which moves for a few seconds after a coordinate is entered. Typed in the natural order
// (latitude, Tab, longitude, Enter), the latitude field was refilled with the still-flying
// camera's latitude when it lost the focus, and the longitude commit then sent that one; "Drop
// pin at centre" pinned the camera wherever it was at the click. Now both read the point the
// view was asked to centre on (GlobeLive.viewTarget), exactly as entered, until the globe is
// turned by hand.

export interface Point {
  lat: number;
  lon: number;
}

/** The point the view is on, or on its way to: the last one asked for, else the camera's centre. */
export function viewPoint(centre: Point, asked: Point | null): Point {
  return asked ?? centre;
}

/** A field's text for a value: two decimals (about 300 m of latitude). */
export const fieldText = (v: number): string => v.toFixed(2);

/** What a field was last given by the app: its text and the exact value behind it. */
export interface Written {
  text: string;
  value: number;
}

/**
 * The value of a field: the exact value the app wrote there while its text is unchanged (a
 * site's 84.7906 S shows as -84.79 and is still sent as -84.7906), otherwise the number typed;
 * null when the field holds no number.
 */
export function fieldValue(text: string, written: Written | null): number | null {
  if (written && text === written.text) return written.value;
  const t = text.trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/**
 * Where to fly when one field is committed (Enter, or leaving it after a change): the value
 * entered, with the other coordinate from the other field as it reads now; when that field
 * holds no number, from the point the view is on or going to.
 */
export function committedPoint(which: 'lat' | 'lon', value: number, otherText: string, otherWritten: Written | null, current: Point): Point {
  const other = fieldValue(otherText, otherWritten);
  return which === 'lat' ? { lat: value, lon: other ?? current.lon } : { lat: other ?? current.lat, lon: value };
}

/** "Drop pin at centre": the point, rounded to 1e-5 degree (about 0.3 m). */
export function pinPoint(p: Point): Point {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  return { lat: r(p.lat), lon: r(p.lon) };
}
