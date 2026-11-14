// Pure text helpers for deterministic mode: splitting a request into steps and reading
// numbers, durations, dates and coordinates out of it. No guessing: a helper returns
// null when the text does not clearly contain what it is looking for.
import { parseUtc } from '../../core/time';

/** Lower-cased, single-spaced, typographic characters folded to ASCII, trailing punctuation removed. */
export function normalise(text: string): string {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/°/g, ' deg ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Steps of a request, in order. "then", semicolons, new lines and sentence ends always
 * separate steps. Commas and "and" are weak separators, returned by `splitWeak` and
 * used only when a step is not understood as a whole (so "compare A and B" and
 * "lat -89.5, lon 30" stay together).
 */
export function splitSteps(text: string): string[] {
  return text
    .split(/\s*(?:;|\n|\.\s+|\?\s+|!\s+|,?\s*\b(?:and\s+)?(?:then|after that|afterwards)\b,?\s*)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitWeak(step: string): string[] {
  return step
    .split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s+&\s+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, twenty: 20, thirty: 30, half: 0.5,
};

const NUM = '(?:[+-]?\\d+(?:\\.\\d+)?|\\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|twenty|thirty|half)\\b)';

function toNumber(token: string): number {
  const t = token.trim().toLowerCase();
  return t in NUMBER_WORDS ? NUMBER_WORDS[t] : Number(t);
}

const UNIT_HOURS: Record<string, number> = {
  s: 1 / 3600, sec: 1 / 3600, secs: 1 / 3600, second: 1 / 3600, seconds: 1 / 3600,
  min: 1 / 60, mins: 1 / 60, minute: 1 / 60, minutes: 1 / 60,
  h: 1, hr: 1, hrs: 1, hour: 1, hours: 1,
  d: 24, day: 24, days: 24,
  w: 168, wk: 168, week: 168, weeks: 168,
  'lunar day': 708.7, 'lunar days': 708.7, lunation: 708.7, lunations: 708.7,
};
const UNIT = '(?:lunar days?|lunations?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|wk|[smhdw])';

/**
 * A duration in hours: "24 h", "2 days", "90 min", "a day", "half a day", "1.5 hours".
 * Returns the first one found together with the text it matched.
 */
export function findDuration(text: string): { hours: number; match: string } | null {
  const half = /\bhalf (?:a |an )?(lunar day|hour|day|week)\b/i.exec(text);
  if (half) return { hours: 0.5 * UNIT_HOURS[half[1].toLowerCase()], match: half[0] };
  const m = new RegExp(`(${NUM})\\s*-?\\s*(${UNIT})\\b`, 'i').exec(text);
  if (!m) return null;
  const value = toNumber(m[1]);
  const perUnit = UNIT_HOURS[m[2].toLowerCase()];
  if (!Number.isFinite(value) || perUnit === undefined) return null;
  return { hours: value * perUnit, match: m[0] };
}

/** Every plain number in the text, in order (number words are not counted). */
export function findNumbers(text: string): number[] {
  return [...text.matchAll(/(?<![\w.])[+-]?\d+(?:\.\d+)?(?![\w]*\d)/g)].map((m) => Number(m[0])).filter(Number.isFinite);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const CLOCK = '(?:(?:,|\\s+at)?\\s*(\\d{1,2})[:h](\\d{2})(?::\\d{2})?)?';

function iso(y: number, monthIndex: number, d: number, h = 0, min = 0): string | null {
  const text = `${String(y).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}Z`;
  try {
    parseUtc(text);
    return text;
  } catch {
    return null;
  }
}

/**
 * A UTC date/time written out in the text: "2026-03-01", "2026-03-01 12:00",
 * "2026-03-01T12:00Z", "14 March 2025 06:00", "March 14, 2025 at 06:00".
 * Returns the ISO form the actions take ("YYYY-MM-DDTHH:MMZ") and the matched text.
 */
export function findDateTime(text: string): { utc: string; match: string } | null {
  const isoLike = /(\d{4})-(\d{2})-(\d{2})(?:[t\s]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?\s*(?:z|utc)?/i.exec(text);
  if (isoLike) {
    const utc = iso(Number(isoLike[1]), Number(isoLike[2]) - 1, Number(isoLike[3]), Number(isoLike[4] ?? 0), Number(isoLike[5] ?? 0));
    return utc ? { utc, match: isoLike[0].trim() } : null;
  }
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\.?,?\\s+(\\d{4})${CLOCK}\\s*(?:z|utc)?`, 'i').exec(text);
  if (dmy) {
    const month = MONTHS.findIndex((name) => name.startsWith(dmy[2].toLowerCase().slice(0, 3)));
    const utc = iso(Number(dmy[3]), month, Number(dmy[1]), Number(dmy[4] ?? 0), Number(dmy[5] ?? 0));
    return utc ? { utc, match: dmy[0].trim() } : null;
  }
  const mdy = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})${CLOCK}\\s*(?:z|utc)?`, 'i').exec(text);
  if (mdy) {
    const month = MONTHS.findIndex((name) => name.startsWith(mdy[1].toLowerCase().slice(0, 3)));
    const utc = iso(Number(mdy[3]), month, Number(mdy[2]), Number(mdy[4] ?? 0), Number(mdy[5] ?? 0));
    return utc ? { utc, match: mdy[0].trim() } : null;
  }
  return null;
}

export interface Coordinates {
  /** Degrees, north-positive. */
  lat: number;
  /** Degrees, east-positive. */
  lon: number;
  match: string;
}

const DEG = '(?:\\s*deg(?:rees?)?)?';

/**
 * Coordinates written as "89.5 S 135 E", "89.5 deg south, 135 deg east",
 * "lat -89.45 lon 222.8", "latitude -89.45, longitude 222.8", or a bare pair "-89.45, 222.8"
 * (latitude first). Longitude is east-positive; "W" makes it negative.
 */
export function findCoordinates(text: string): Coordinates | null {
  const hemi = new RegExp(`(\\d+(?:\\.\\d+)?)${DEG}\\s*(n|s|north|south)\\b[,;\\s]*(\\d+(?:\\.\\d+)?)${DEG}\\s*(e|w|east|west)\\b`, 'i').exec(text);
  if (hemi) {
    const lat = Number(hemi[1]) * (hemi[2].toLowerCase().startsWith('s') ? -1 : 1);
    const lon = Number(hemi[3]) * (hemi[4].toLowerCase().startsWith('w') ? -1 : 1);
    return valid(lat, lon, hemi[0]);
  }
  const labelled = new RegExp(`\\blat(?:itude)?\\s*(?:[:=]|of|is)?\\s*([+-]?\\d+(?:\\.\\d+)?)${DEG}(?:\\s*(n|s)\\b)?[,;\\s]*(?:and\\s+)?\\blon(?:g(?:itude)?)?\\s*(?:[:=]|of|is)?\\s*([+-]?\\d+(?:\\.\\d+)?)${DEG}(?:\\s*(e|w)\\b)?`, 'i').exec(text);
  if (labelled) {
    const lat = Number(labelled[1]) * (labelled[2]?.toLowerCase() === 's' ? -1 : 1);
    const lon = Number(labelled[3]) * (labelled[4]?.toLowerCase() === 'w' ? -1 : 1);
    return valid(lat, lon, labelled[0]);
  }
  const pair = new RegExp(`\\(?\\s*([+-]?\\d+(?:\\.\\d+)?)${DEG}\\s*[,;]\\s*([+-]?\\d+(?:\\.\\d+)?)${DEG}\\s*\\)?`, 'i').exec(text);
  if (pair) return valid(Number(pair[1]), Number(pair[2]), pair[0]);
  return null;
}

function valid(lat: number, lon: number, match: string): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
  return { lat, lon, match: match.trim() };
}

const COMPASS: Record<string, number> = {
  north: 0, n: 0, 'north-east': 45, northeast: 45, ne: 45, east: 90, e: 90, 'south-east': 135, southeast: 135, se: 135,
  south: 180, s: 180, 'south-west': 225, southwest: 225, sw: 225, west: 270, w: 270, 'north-west': 315, northwest: 315, nw: 315,
};

/** Azimuth in degrees for a compass word ("north-east", "sw"), or null. */
export function compassAzimuth(word: string): number | null {
  const key = word.trim().toLowerCase().replace(/\s+/g, '-');
  return key in COMPASS ? COMPASS[key] : null;
}

export const COMPASS_WORD = '(north[- ]?east|north[- ]?west|south[- ]?east|south[- ]?west|north|south|east|west|ne|nw|se|sw|n|s|e|w)';
