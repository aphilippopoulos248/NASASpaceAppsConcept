// GET /api/horizons — a constrained proxy to JPL Horizons for topocentric, airless Sun and
// Earth azimuth/elevation at a site on the Moon. Only these parameters are accepted, and
// only these are ever sent to Horizons:
//   lat, lon      site, degrees (ME frame, east-positive)
//   altKm         height above the 1737.4 km sphere, km (-12..25)
//   start, stop   UTC instants (ISO 8601), stop after start, span <= 90 days
//   stepMin       sample step, whole minutes, 1..1440, at most 20 000 rows
// Replies with JSON in the HorizonsTable shape of src/analysis/sky.ts, so the client can
// use it exactly like a bundled table. Answers are cached on disk under
// scripts/.cache/horizons-proxy/. Offline or on a Horizons error the reply is a JSON
// error with status 502 (never a partial table).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApiHandler, ApiRequest, ApiResponse } from '../plugin';

const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const CACHE_DIR = join(process.cwd(), 'scripts', '.cache', 'horizons-proxy');
const MAX_ROWS = 20_000;
const MAX_SPAN_MS = 90 * 86_400_000;
const AU_KM = 149_597_870.7;

export interface HorizonsQuery {
  lat: number;
  lon: number;
  altKm: number;
  startMs: number;
  stopMs: number;
  stepMin: number;
}

export class QueryError extends Error {}

/** Validates the query string. Unknown parameters are rejected rather than ignored, so nothing else can reach Horizons. */
export function parseQuery(search: URLSearchParams): HorizonsQuery {
  const allowed = new Set(['lat', 'lon', 'altKm', 'start', 'stop', 'stepMin']);
  for (const k of search.keys()) if (!allowed.has(k)) throw new QueryError(`unknown parameter "${k}"`);
  const num = (k: string, lo: number, hi: number, dflt?: number) => {
    const raw = search.get(k);
    if (raw === null || raw === '') {
      if (dflt !== undefined) return dflt;
      throw new QueryError(`missing parameter "${k}"`);
    }
    if (!/^[-+]?\d+(\.\d+)?$/.test(raw)) throw new QueryError(`"${k}" must be a plain number`);
    const v = Number(raw);
    if (!(v >= lo && v <= hi)) throw new QueryError(`"${k}" must be within ${lo}..${hi}`);
    return v;
  };
  const time = (k: string) => {
    const raw = search.get(k) ?? '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(raw)) throw new QueryError(`"${k}" must be a UTC ISO time like 2025-03-06T17:28:00Z`);
    const v = Date.parse(raw);
    if (!Number.isFinite(v)) throw new QueryError(`"${k}" is not a valid time`);
    return v;
  };
  const q: HorizonsQuery = {
    lat: num('lat', -90, 90),
    lon: num('lon', -180, 180),
    altKm: num('altKm', -12, 25, 0),
    startMs: time('start'),
    stopMs: time('stop'),
    stepMin: num('stepMin', 1, 1440, 10),
  };
  if (!Number.isInteger(q.stepMin)) throw new QueryError('"stepMin" must be a whole number of minutes');
  if (q.stopMs <= q.startMs) throw new QueryError('"stop" must be after "start"');
  if (q.stopMs - q.startMs > MAX_SPAN_MS) throw new QueryError('span is limited to 90 days');
  if (Math.floor((q.stopMs - q.startMs) / (q.stepMin * 60_000)) + 1 > MAX_ROWS) throw new QueryError(`at most ${MAX_ROWS} rows per request`);
  return q;
}

const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/** The exact parameters sent to Horizons for one body. */
export function horizonsParams(q: HorizonsQuery, target: '10' | '399'): URLSearchParams {
  return new URLSearchParams({
    format: 'text',
    COMMAND: `'${target}'`,
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${q.lon},${q.lat},${q.altKm}'`,
    EPHEM_TYPE: "'OBSERVER'",
    QUANTITIES: "'4,20'",
    APPARENT: "'AIRLESS'",
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
    EXTRA_PREC: "'YES'",
    TIME_DIGITS: "'SECONDS'",
    CAL_FORMAT: "'JD'",
    START_TIME: `'${fmt(q.startMs)}'`,
    STOP_TIME: `'${fmt(q.stopMs)}'`,
    STEP_SIZE: `'${q.stepMin} m'`,
  });
}

export interface ParsedRow { jd: number; az: number; el: number; deltaAu: number }

export function parseHorizonsText(text: string): ParsedRow[] {
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`Horizons did not return a table: ${text.slice(0, 300).replace(/\s+/g, ' ')}`);
  return body.trim().split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim());
    const row = { jd: Number(f[0]), az: Number(f[3]), el: Number(f[4]), deltaAu: Number(f[5]) };
    if (![row.jd, row.az, row.el, row.deltaAu].every(Number.isFinite)) throw new Error(`unreadable Horizons row: ${line.slice(0, 120)}`);
    return row;
  });
}

export type TextFetcher = (url: string) => Promise<string>;

const netFetch: TextFetcher = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
  return text;
};

async function cachedText(params: URLSearchParams, fetcher: TextFetcher, cacheDir: string): Promise<string> {
  const key = createHash('sha256').update(params.toString()).digest('hex').slice(0, 32);
  const file = join(cacheDir, `${key}.txt`);
  try {
    return await readFile(file, 'utf8');
  } catch {
    // not cached
  }
  const text = await fetcher(`${API}?${params}`);
  parseHorizonsText(text); // only cache real tables
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, text);
  return text;
}

/** Fetches (or reads from cache) both bodies and assembles the table. */
export async function horizonsTable(q: HorizonsQuery, fetcher: TextFetcher = netFetch, cacheDir = CACHE_DIR) {
  const [sunText, earthText] = await Promise.all([
    cachedText(horizonsParams(q, '10'), fetcher, cacheDir),
    cachedText(horizonsParams(q, '399'), fetcher, cacheDir),
  ]);
  const sun = parseHorizonsText(sunText), earth = parseHorizonsText(earthText);
  if (sun.length !== earth.length) throw new Error('Horizons returned tables of different lengths');
  const startMs = Math.round(((sun[0].jd - 2440587.5) * 86_400_000) / 1000) * 1000;
  const hourly = Math.max(1, Math.round(60 / q.stepMin));
  const body = (rows: ParsedRow[]) => ({
    az: rows.map((r) => r.az),
    el: rows.map((r) => r.el),
    distKmHourly: rows.filter((_, i) => i % hourly === 0).map((r) => Math.round(r.deltaAu * AU_KM * 10) / 10),
  });
  return {
    id: `proxy:${q.lat},${q.lon},${q.altKm}:${fmt(q.startMs)}`,
    label: `JPL Horizons, site ${q.lat}, ${q.lon} (${q.altKm} km), from ${fmt(q.startMs)} UTC`,
    site: { lat: q.lat, lon: q.lon, heightM: q.altKm * 1000 },
    startMs,
    stepMs: q.stepMin * 60_000,
    n: sun.length,
    sun: body(sun),
    earth: body(earth),
    query: {
      service: 'JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api)',
      CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${q.lon},${q.lat},${q.altKm}`,
      QUANTITIES: '4,20', APPARENT: 'AIRLESS', START_TIME: fmt(q.startMs), STOP_TIME: fmt(q.stopMs), STEP_SIZE: `${q.stepMin} m`,
    },
  };
}

const reply = (status: number, json: unknown): ApiResponse => ({
  status,
  json,
  headers: { 'cache-control': status === 200 ? 'public, max-age=86400' : 'no-store' },
});

/** Answers GET /api/horizons. `fetcher` can be replaced in tests. */
export async function respond(req: Pick<ApiRequest, 'method' | 'query'>, fetcher: TextFetcher = netFetch): Promise<ApiResponse> {
  if (req.method !== 'GET') return reply(405, { error: 'only GET is supported' });
  let q: HorizonsQuery;
  try {
    q = parseQuery(req.query);
  } catch (e) {
    return reply(400, { error: (e as Error).message });
  }
  try {
    return reply(200, await horizonsTable(q, fetcher));
  } catch (e) {
    return reply(502, { error: `JPL Horizons unavailable: ${(e as Error).message}. The app falls back to its own validated model.` });
  }
}

/** The handler served at /api/horizons (contract: ApiHandler in server/plugin.ts). */
const handler: ApiHandler = (req) => respond(req);
export default handler;
