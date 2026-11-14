// Small JPL Horizons client shared by the ephemeris scripts and the /api/horizons proxy tests.
// Topocentric observer on the Moon (CENTER='coord@301'), airless apparent az/el.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE = join(ROOT, 'scripts', '.cache', 'horizons');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/** Build the query for one target. `times` is either {start, stop, step} or {tlist: [...]} (Horizons UTC strings). */
export function topoParams(target, site, times) {
  const p = {
    format: 'text',
    COMMAND: `'${target}'`,
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.lon},${site.lat},${site.altKm ?? 0}'`,
    EPHEM_TYPE: "'OBSERVER'",
    QUANTITIES: "'4,20'",
    APPARENT: "'AIRLESS'",
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
    EXTRA_PREC: "'YES'",
    TIME_DIGITS: "'SECONDS'",
    CAL_FORMAT: "'JD'",
  };
  if (times.tlist) {
    p.TLIST = times.tlist.map((t) => `'${t}'`).join(' ');
    p.TLIST_TYPE = "'JD'";
  } else {
    p.START_TIME = `'${times.start}'`;
    p.STOP_TIME = `'${times.stop}'`;
    p.STEP_SIZE = `'${times.step}'`;
  }
  return new URLSearchParams(p);
}

/** Parse rows: JD(UT), az, el, delta AU. */
export function parseRows(text) {
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`unexpected Horizons reply: ${text.slice(0, 600)}`);
  return body
    .trim()
    .split('\n')
    .map((line) => {
      const f = line.split(',').map((s) => s.trim());
      // JDUT, solar-presence, interfering-body, az, el, delta, deldot
      return { jd: Number(f[0]), az: Number(f[3]), el: Number(f[4]), deltaAu: Number(f[5]) };
    });
}

export async function fetchCached(params) {
  const key = createHash('sha256').update(params.toString()).digest('hex').slice(0, 24);
  const file = join(CACHE, `${key}.txt`);
  try {
    return await readFile(file, 'utf8');
  } catch {}
  const res = await fetch(`${API}?${params}`);
  const text = await res.text();
  if (!res.ok || !text.includes('$$SOE')) throw new Error(`Horizons HTTP ${res.status}: ${text.slice(0, 600)}`);
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, text);
  return text;
}

export const jdToMs = (jd) => (jd - 2440587.5) * 86400000;
export const msToJd = (ms) => ms / 86400000 + 2440587.5;
