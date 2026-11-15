// Builds public/data/rovers.json: SIMULATED rovers driving near some of the landing sites.
//
// THIS IS NOT DATA. No source stands behind any of it: the rovers, their names, their operators'
// involvement, their positions and their routes are all invented here, so that the surface view has
// something moving at a believable pace. See docs/DATA_SOURCES.md, "Simulated rovers".
//
// What is made up, and how:
//   - The roster below (name, operator, mass, drive speed) is written by hand. Speeds are in the
//     range of real vehicles: small robotic rovers 0.05-0.2 m/s, a crewed vehicle about 10 km/h.
//   - Each route is a closed circuit around a point near the lander: a few "stations" at random
//     bearings and distances, joined by a smooth curve and sampled every few metres, with a small
//     sideways wobble as if steering round rocks. The rover stops at each station for a while.
//   - Only the landing's own coordinates come from landings.json; every route is laid out in metres
//     east and north of the lander and converted to latitude and longitude.
// The random numbers are seeded by the rover's id, so a re-run writes the same file.
// Routes know nothing about the terrain: they may cross craters or slopes no rover would drive.
//
// Run with: npm run build-rovers
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data', 'rovers.json');
const MOON_RADIUS_M = 1_737_400;
const DEG = Math.PI / 180;
/** Routes repeat from this instant; any clock time maps onto a point of the circuit. */
const EPOCH_UTC = '2026-01-01T00:00:00Z';
/** No route comes closer to the lander than this, metres. */
const LANDER_CLEAR_M = 8;

// centre: where the circuit is centred, metres [east, north] of the lander. radius: [nearest, furthest]
// station from that centre. stepM: spacing of the route points. stopS: [shortest, longest] halt at a station.
const ROSTER = [
  { id: 'prospector-1', name: 'Prospector-1', siteId: 'im-2', operator: 'NASA', kind: 'robotic', role: 'Volatiles prospecting', massKg: 430, speedMps: 0.2,
    centre: [35, 40], radius: [70, 140], stations: 7, stepM: 4, stopS: [300, 900], activities: ['Neutron spectrometer reading', 'Drill to 1 m', 'Mass spectrometer reading', 'Panorama'] },
  { id: 'kestrel', name: 'Kestrel', siteId: 'im-2', operator: 'NASA', kind: 'robotic', role: 'Scout micro-rover', massKg: 12, speedMps: 0.1,
    centre: [-12, -6], radius: [18, 42], stations: 5, stepM: 2, stopS: [60, 240], activities: ['Stereo imaging', 'Relay check', 'Thermal reading'] },
  { id: 'malapert-relay', name: 'Malapert Relay Rover', siteId: 'im-1', operator: 'NASA', kind: 'robotic', role: 'Communications relay survey', massKg: 60, speedMps: 0.1,
    centre: [10, 22], radius: [30, 75], stations: 6, stepM: 3, stopS: [120, 480], activities: ['Earth link test', 'Horizon survey', 'Panorama'] },
  { id: 'anveshak-1', name: 'Anveshak-1', siteId: 'chandrayaan-3', operator: 'ISRO', kind: 'robotic', role: 'Regolith composition', massKg: 32, speedMps: 0.05,
    centre: [6, -10], radius: [14, 34], stations: 5, stepM: 2, stopS: [240, 720], activities: ['LIBS reading', 'APXS reading', 'Wheel-track imaging'] },
  { id: 'tansuo-1', name: 'Tansuo-1', siteId: 'change-4', operator: 'CNSA', kind: 'robotic', role: 'Far-side geology', massKg: 140, speedMps: 0.055,
    centre: [-15, 12], radius: [24, 60], stations: 6, stepM: 2.5, stopS: [300, 900], activities: ['Ground-penetrating radar profile', 'Infrared spectrometer reading', 'Panorama'] },
  { id: 'tansuo-2', name: 'Tansuo-2', siteId: 'change-6', operator: 'CNSA', kind: 'robotic', role: 'Basin floor survey', massKg: 140, speedMps: 0.055,
    centre: [14, 8], radius: [22, 55], stations: 6, stepM: 2.5, stopS: [300, 900], activities: ['Ground-penetrating radar profile', 'Infrared spectrometer reading', 'Panorama'] },
  { id: 'guanghan', name: 'Guanghan', siteId: 'change-3', operator: 'CNSA', kind: 'robotic', role: 'Mare basalt survey', massKg: 120, speedMps: 0.06,
    centre: [4, 18], radius: [20, 48], stations: 5, stepM: 2.5, stopS: [300, 720], activities: ['APXS reading', 'Radar profile', 'Panorama'] },
  { id: 'hayate', name: 'Hayate', siteId: 'slim', operator: 'JAXA', kind: 'robotic', role: 'Olivine outcrop imaging', massKg: 18, speedMps: 0.08,
    centre: [-8, 5], radius: [12, 30], stations: 5, stepM: 2, stopS: [120, 480], activities: ['Multiband imaging', 'Rock close-up', 'Panorama'] },
  { id: 'juniper', name: 'Juniper', siteId: 'blue-ghost-1', operator: 'NASA', kind: 'robotic', role: 'Regolith and heat-flow survey', massKg: 85, speedMps: 0.12,
    centre: [18, -14], radius: [26, 70], stations: 6, stepM: 3, stopS: [180, 600], activities: ['Regolith sample', 'Heat-flow probe reading', 'Panorama'] },
  { id: 'hadley-scout', name: 'Hadley Scout', siteId: 'apollo-15', operator: 'NASA', kind: 'robotic', role: 'Rille-edge reconnaissance', massKg: 95, speedMps: 0.15,
    centre: [-20, 10], radius: [45, 110], stations: 6, stepM: 3.5, stopS: [180, 600], activities: ['Stereo imaging', 'Spectrometer reading', 'Panorama'] },
  { id: 'mule-2', name: 'Mule-2', siteId: 'apollo-17', operator: 'NASA', kind: 'robotic', role: 'Cargo carrier', massKg: 310, speedMps: 0.4,
    centre: [50, 35], radius: [40, 115], stations: 5, stepM: 5, stopS: [240, 900], activities: ['Unloading', 'Recharge', 'Waiting for crew'] },
  { id: 'ltv-pathfinder', name: 'LTV Pathfinder', siteId: 'apollo-17', operator: 'NASA', kind: 'crewed', role: 'Crew traverse vehicle', massKg: 900, speedMps: 2.8,
    centre: [-180, 240], radius: [260, 720], stations: 7, stepM: 14, stopS: [600, 2400], activities: ['Sampling stop', 'Geology station', 'Gravimeter reading', 'Navigation fix'] },
];

/** Small seeded generator (mulberry32), seeded from a string, so each rover's route is reproducible. */
function seeded(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 3432918353), (h = (h << 13) | (h >>> 19));
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The point `east`, `north` metres from (lat0, lon0) along a great circle. Same formula as offsetLatLon in src/scene/surface/ground.ts. */
function offsetLatLon(lat0, lon0, east, north) {
  const d = Math.hypot(east, north) / MOON_RADIUS_M;
  if (d === 0) return { lat: lat0, lon: lon0 };
  const az = Math.atan2(east, north);
  const la = lat0 * DEG;
  const sinLat = Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(az);
  const lat2 = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  const lon2 = lon0 * DEG + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * sinLat);
  return { lat: lat2 / DEG, lon: ((((lon2 / DEG + 180) % 360) + 360) % 360) - 180 };
}

/** Catmull-Rom through p1..p2, with p0 and p3 as neighbours. */
function spline(p0, p1, p2, p3, u) {
  const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** A closed route in metres [east, north] of the lander; station points carry a stop. */
function layRoute(spec) {
  const rand = seeded(spec.id);
  const n = spec.stations;
  const turn = rand() < 0.5 ? 1 : -1;
  const start = rand() * 2 * Math.PI;
  const stations = [];
  for (let i = 0; i < n; i++) {
    const bearing = start + turn * ((i + (rand() - 0.5) * 0.5) / n) * 2 * Math.PI;
    const r = spec.radius[0] + rand() * (spec.radius[1] - spec.radius[0]);
    stations.push([spec.centre[0] + r * Math.sin(bearing), spec.centre[1] + r * Math.cos(bearing)]);
  }
  const wobble = Math.min(0.4, spec.stepM * 0.12);
  const points = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [stations[(i + n - 1) % n], stations[i], stations[(i + 1) % n], stations[(i + 2) % n]];
    const steps = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spec.stepM));
    const [lo, hi] = spec.stopS;
    points.push({ east: p1[0], north: p1[1], stopS: Math.round((lo + rand() * (hi - lo)) / 30) * 30, activity: spec.activities[Math.floor(rand() * spec.activities.length)] });
    for (let k = 1; k < steps; k++) {
      const [e, nn] = spline(p0, p1, p2, p3, k / steps);
      points.push({ east: e + (rand() - 0.5) * 2 * wobble, north: nn + (rand() - 0.5) * 2 * wobble });
    }
  }
  return points;
}

const landings = JSON.parse(await readFile(join(ROOT, 'public', 'data', 'landings.json'), 'utf8')).landings;
const num = (v, digits) => Number(v.toFixed(digits));

const rovers = ROSTER.map((spec) => {
  const site = landings.find((l) => l.id === spec.siteId);
  if (!site) throw new Error(`${spec.id}: no landing "${spec.siteId}" in landings.json`);
  const route = layRoute(spec);
  const nearest = Math.min(...route.map((p) => Math.hypot(p.east, p.north)));
  if (nearest < LANDER_CLEAR_M) throw new Error(`${spec.id}: route passes ${nearest.toFixed(1)} m from the lander; move its centre or widen its radius`);
  let lengthM = 0;
  let stoppedS = 0;
  route.forEach((p, i) => {
    const q = route[(i + 1) % route.length];
    lengthM += Math.hypot(q.east - p.east, q.north - p.north);
    stoppedS += p.stopS ?? 0;
  });
  const lapS = lengthM / spec.speedMps + stoppedS;
  const path = route.map((p) => {
    const { lat, lon } = offsetLatLon(site.lat, site.lon, p.east, p.north);
    return { lat: num(lat, 7), lon: num(lon, 7), ...(p.stopS ? { stopS: p.stopS, activity: p.activity } : {}) };
  });
  return {
    id: spec.id,
    name: spec.name,
    simulated: true,
    siteId: spec.siteId,
    country: site.country,
    operator: spec.operator,
    kind: spec.kind,
    role: spec.role,
    massKg: spec.massKg,
    speedMps: spec.speedMps,
    // Where on the circuit the rover is at the epoch, seconds into a lap, so rovers do not all start at a station.
    phaseS: Math.round(seeded(`${spec.id}/phase`)() * lapS),
    lengthM: Math.round(lengthM),
    home: { lat: path[0].lat, lon: path[0].lon },
    path,
  };
});

const note =
  'SIMULATED, NOT DATA. Every rover in this file is invented for the surface view: names, operators, masses, speeds, positions and routes ' +
  'come from scripts/build-rovers.mjs and from no mission, catalogue or measurement. Only the landing each rover is placed beside (siteId) is real. ' +
  "Latitude is north-positive and longitude east-positive (-180..180), degrees, in the Moon's Mean Earth / Polar Axis frame, as in landings.json. " +
  "'path' is a closed circuit: the rover drives from each point to the next in a straight line at speedMps (metres per second), and from the last point back to the first. " +
  "At a point with 'stopS' it halts for that many seconds ('activity' says what for). The circuit repeats without end from 'epochUtc'; " +
  "'phaseS' is how many seconds into a lap the rover is at the epoch. 'lengthM' is the length of one lap; 'home' is the first point of the path. " +
  'Routes ignore the terrain. Do not edit by hand: change the roster in the script and run npm run build-rovers.';

// One path point per line: readable in a diff without the file running to thousands of lines.
const body = rovers
  .map((r) => {
    const { path, ...head } = r;
    const fields = Object.entries(head).map(([k, v]) => `   ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const points = path.map((p) => `    ${JSON.stringify(p)}`).join(',\n');
    return `  {\n${fields.join(',\n')},\n   "path": [\n${points}\n   ]\n  }`;
  })
  .join(',\n');
await writeFile(OUT, `{\n "note": ${JSON.stringify(note)},\n "simulated": true,\n "epochUtc": ${JSON.stringify(EPOCH_UTC)},\n "rovers": [\n${body}\n ]\n}\n`);

for (const r of rovers) {
  const stopped = r.path.reduce((s, p) => s + (p.stopS ?? 0), 0);
  console.log(`${r.id.padEnd(16)} ${r.siteId.padEnd(14)} ${String(r.path.length).padStart(4)} points  ${String(r.lengthM).padStart(5)} m  lap ${((r.lengthM / r.speedMps + stopped) / 3600).toFixed(2)} h`);
}
console.log(`Wrote ${OUT}`);
