// Development check: src/astro/topocentric.ts against live (cached) JPL Horizons
// topocentric airless az/el for a spread of sites and dates. Prints the error table.
// Run with: node scripts/compare-topocentric.mjs
import { createServer } from 'vite';
import { ROOT, topoParams, fetchCached, parseRows, jdToMs, msToJd } from './horizons-lib.mjs';

const vite = await createServer({ root: ROOT, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { topocentricSky } = await vite.ssrLoadModule('/src/astro/topocentric.ts');
await vite.close();

const SITES = [
  { name: 'equator 0,0', lat: 0, lon: 0 },
  { name: 'apollo-15', lat: 26.13239, lon: 3.6333 },
  { name: 'mid-lat W', lat: -45, lon: -60 },
  { name: 'limb E', lat: 5, lon: 89 },
  { name: 'limb W', lat: -10, lon: -88.5 },
  { name: 'far side', lat: -45.4446, lon: 177.5991 },
  { name: 'S pole -89.9', lat: -89.9, lon: -137 },
  { name: 'N pole 89.9', lat: 89.9, lon: 45 },
  { name: 'im-2', lat: -84.79, lon: 29.2, altKm: 0.002 },
];
const DATES = ['1969-07-20T20:17:00Z', '1972-12-11T19:54:00Z', '1985-05-01T00:00:00Z', '2000-01-01T12:00:00Z', '2013-12-14T13:11:00Z', '2025-03-06T17:28:00Z', '2025-03-14T06:00:00Z', '2030-06-15T03:00:00Z', '2035-11-30T22:30:00Z'];

const angSep = (az1, el1, az2, el2) => {
  const r = Math.PI / 180;
  const c = Math.sin(el1 * r) * Math.sin(el2 * r) + Math.cos(el1 * r) * Math.cos(el2 * r) * Math.cos((az1 - az2) * r);
  return Math.acos(Math.min(1, c)) / r;
};
const worst = { sun: { el: 0, sep: 0 }, earth: { el: 0, sep: 0 } };
for (const site of SITES) {
  const tlist = DATES.map((d) => msToJd(Date.parse(d)).toFixed(8));
  for (const [body, target] of [['sun', '10'], ['earth', '399']]) {
    const rows = parseRows(await fetchCached(topoParams(target, site, { tlist })));
    let wEl = 0, wSep = 0, wDist = 0;
    for (const r of rows) {
      const s = topocentricSky(site.lat, site.lon, (site.altKm ?? 0) * 1000, jdToMs(r.jd))[body];
      wEl = Math.max(wEl, Math.abs(s.elDeg - r.el));
      wSep = Math.max(wSep, angSep(s.azDeg, s.elDeg, r.az, r.el));
      wDist = Math.max(wDist, Math.abs(s.distanceKm - r.deltaAu * 149597870.7));
    }
    worst[body].el = Math.max(worst[body].el, wEl);
    worst[body].sep = Math.max(worst[body].sep, wSep);
    console.log(`${site.name.padEnd(14)} ${body.padEnd(6)} |dEl| ${(wEl * 3600).toFixed(1).padStart(7)}"  sep ${(wSep * 3600).toFixed(1).padStart(7)}"  |dDist| ${wDist.toFixed(1)} km`);
  }
}
console.log(JSON.stringify(worst));
