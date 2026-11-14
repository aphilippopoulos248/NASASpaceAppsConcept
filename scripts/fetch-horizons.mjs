// Asks JPL Horizons where the Sun and Earth were over the Moon at each landing,
// and saves the answers to public/data/horizons-check.json as reference data.
// Run with: npm run fetch-horizons   (then: npm run check-ephemeris)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const wrap = (lon) => (lon > 180 ? lon - 360 : lon);

const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));
const out = [];
for (const l of landings) {
  const params = new URLSearchParams({
    format: 'text',
    COMMAND: "'301'", // the Moon
    CENTER: "'500@399'", // seen from Earth's centre
    EPHEM_TYPE: "'OBSERVER'",
    QUANTITIES: "'14,15'", // sub-observer and sub-solar longitude/latitude
    TLIST: `'${l.date} ${l.time}'`,
    ANG_FORMAT: "'DEG'",
    CSV_FORMAT: "'YES'",
  });
  const text = await (await fetch(`${API}?${params}`)).text();
  const row = text.split('$$SOE')[1]?.split('$$EOE')[0]?.trim();
  if (!row) throw new Error(`${l.id}: unexpected Horizons reply\n${text.slice(0, 400)}`);
  const n = row.split(',').map((s) => s.trim());
  const [obsLon, obsLat, sunLon, sunLat] = n.slice(3, 7).map(Number);
  out.push({
    id: l.id,
    utc: `${l.date}T${l.time}:00Z`,
    subEarth: { lat: obsLat, lon: wrap(obsLon) },
    subSolar: { lat: sunLat, lon: wrap(sunLon) },
  });
  console.log(`${l.id.padEnd(14)} sun ${sunLat.toFixed(2)}, ${wrap(sunLon).toFixed(2)}`);
}
await writeFile(
  join(ROOT, 'public/data/horizons-check.json'),
  JSON.stringify({ source: 'JPL Horizons (ssd.jpl.nasa.gov), target 301, geocentric observer, quantities 14 and 15', points: out }, null, 1) + '\n',
);
