// Fetches JPL Horizons topocentric airless Sun/Earth az/el for a spread of lunar sites
// and dates (1969-2035) and writes src/analysis/__fixtures__/horizons-topo-check.json,
// the reference the skyAt() test suite runs against with no network.
// Run with: node scripts/fetch-horizons-topo-check.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, topoParams, fetchCached, parseRows, jdToMs, msToJd } from './horizons-lib.mjs';

const SITES = [
  { name: 'equator 0N 0E', lat: 0, lon: 0, altKm: 0 },
  { name: 'Apollo 15 (mid-latitude)', lat: 26.13239, lon: 3.6333, altKm: -1.928 },
  { name: 'mid-latitude SW', lat: -45, lon: -60, altKm: 0.5 },
  { name: 'east limb', lat: 5, lon: 89, altKm: 0 },
  { name: 'west limb', lat: -10, lon: -88.5, altKm: 0 },
  { name: 'far side (Chang\'e 4)', lat: -45.4446, lon: 177.5991, altKm: -5.9 },
  { name: 'antimeridian', lat: 12, lon: -180, altKm: 0 },
  { name: 'south pole exact', lat: -90, lon: 0, altKm: 0 },
  { name: 'north pole exact', lat: 90, lon: 0, altKm: 0 },
  { name: 'near south pole', lat: -89.9, lon: -137, altKm: 1.5 },
  { name: 'IM-2 (south polar)', lat: -84.79, lon: 29.2, altKm: 5.321 },
];
const DATES = [
  '1969-07-20T20:17:00Z', '1972-12-11T19:54:00Z', '1979-03-03T07:00:00Z', '1985-05-01T00:00:00Z', '1993-09-17T15:45:00Z',
  '2000-01-01T12:00:00Z', '2006-07-07T04:20:00Z', '2013-12-14T13:11:00Z', '2019-01-03T02:26:00Z', '2025-03-06T17:28:00Z',
  '2025-03-14T06:58:00Z', '2030-06-15T03:00:00Z', '2035-11-30T22:30:00Z',
];
const rows = [];
for (const site of SITES) {
  const tlist = DATES.map((d) => msToJd(Date.parse(d)).toFixed(9));
  const sun = parseRows(await fetchCached(topoParams('10', site, { tlist })));
  const earth = parseRows(await fetchCached(topoParams('399', site, { tlist })));
  sun.forEach((s, i) => {
    rows.push({
      site: site.name, lat: site.lat, lon: site.lon, heightM: site.altKm * 1000,
      utc: new Date(Math.round(jdToMs(s.jd) / 1000) * 1000).toISOString(),
      sun: { az: s.az, el: s.el, distKm: Math.round(s.deltaAu * 149597870.7) },
      earth: { az: earth[i].az, el: earth[i].el, distKm: Math.round(earth[i].deltaAu * 149597870.7 * 10) / 10 },
    });
  });
}
const dir = join(ROOT, 'src', 'analysis', '__fixtures__');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'horizons-topo-check.json'), JSON.stringify({
  source: 'JPL Horizons API (DE441), CENTER=coord@301, COORD_TYPE=GEODETIC, QUANTITIES=4,20, APPARENT=AIRLESS, EXTRA_PREC=YES; site heights in metres above the 1737.4 km sphere',
  fetched: new Date().toISOString().slice(0, 10),
  rows,
}, null, 0) + '\n');
console.log(`${rows.length} rows`);
