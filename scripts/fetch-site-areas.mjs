// Builds the "area explored" around each landing site from LROC's measured positions of hardware on
// the Moon and, where published, the astronauts' mapped walking paths.
//
// Sources (NASA PDS, LROC release LROLRC_2001, EXTRAS/SHAPEFILE):
//   ANTHROPOGENIC_OBJECTS_180.csv  Wagner et al. (2017), Icarus 283, 92-103, updated by the LROC team:
//                                  measured positions of landers, rovers and deployed instruments.
//   APOLLO_11/12/14 *_PATHS.csv    Gonzales et al. (2019): mapped EVA traverse paths of each astronaut.
// and, for every Apollo mission, NASA PDS Geosciences Node "Apollo Analyst's Notebook" map layers
// (https://an.rsl.wustl.edu/apollo/): Lunar Roving Vehicle traverses (Apollo 15-17, reconstructed from the
// rover navigation records in NASA TN D-7469), sampling stations, deployed instruments and sample sites.
//
// Output:
//   public/data/sources/lroc-anthropogenic-objects.csv   the catalogue, unchanged
//   public/data/sources/site-areas.json                  one polygon per landing (derived)
//
// The area is the convex hull of every known point for the mission (lander, rovers' final positions,
// instruments, traverse paths), widened by a margin that covers the lander's footprint and the position
// uncertainty. Where a rover's route is not published, only its final position is known, so the area is
// the straight corridor between lander and rover: the real route wandered more widely.
// landings.json is never modified.
//
// Run with: npm run fetch-site-areas
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'data', 'sources');
const BASE = 'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/EXTRAS/SHAPEFILE';
const OBJECTS_URL = `${BASE}/ANTHROPOGENIC_OBJECTS/ANTHROPOGENIC_OBJECTS_180.csv`;
const R = 1737400;
const DEG = Math.PI / 180;
const MARGIN_M = 30; // lander footprint and position uncertainty

// Mission name in the catalogue -> landing id in landings.json.
const MISSION = {
  'Surveyor 1': 'surveyor-1', 'Surveyor 3': 'surveyor-3', 'Surveyor 5': 'surveyor-5', 'Surveyor 6': 'surveyor-6', 'Surveyor 7': 'surveyor-7',
  'Apollo 11': 'apollo-11', 'Apollo 12': 'apollo-12', 'Apollo 14': 'apollo-14', 'Apollo 15': 'apollo-15', 'Apollo 16': 'apollo-16', 'Apollo 17': 'apollo-17',
  'Luna 9': 'luna-9', 'Luna 13': 'luna-13', 'Luna 16': 'luna-16', 'Luna 17': 'luna-17', 'Luna 20': 'luna-20', 'Luna 21': 'luna-21', 'Luna 23': 'luna-23', 'Luna 24': 'luna-24',
  "Chang'e 3": 'change-3', "Chang'e 4": 'change-4', "Chang'e 5": 'change-5', "Chang'e 6": 'change-6',
  'Chandrayaan-3': 'chandrayaan-3', SLIM: 'slim', 'IM-1': 'im-1', 'IM-2': 'im-2', 'Blue Ghost Mission 1': 'blue-ghost-1',
};

// Published astronaut traverse paths: landing id -> path files.
const TRAVERSES = {
  'apollo-11': ['APOLLO_11/APOLLO_11-1_CDR_PATHS', 'APOLLO_11/APOLLO_11-1_LMP_PATHS'],
  'apollo-12': ['APOLLO_12/APOLLO_12-1_CDR_PATHS', 'APOLLO_12/APOLLO_12-1_LMP_PATHS', 'APOLLO_12/APOLLO_12-2_CDR_PATHS', 'APOLLO_12/APOLLO_12-2_LMP_PATHS'],
  'apollo-14': ['APOLLO_14/APOLLO_14-1_CDR_PATHS', 'APOLLO_14/APOLLO_14-1_LMP_PATHS', 'APOLLO_14/APOLLO_14-2_CDR_PATHS', 'APOLLO_14/APOLLO_14-2_LMP_PATHS'],
};

// Apollo Analyst's Notebook map services (NASA PDS Geosciences Node), and the layers taken from each.
const AN_BASE = 'https://anms.rsl.wustl.edu/arcgis/rest/services/Apollo';
const AN_SERVICE = {
  'apollo-11': 'Apollo11_vec', 'apollo-12': 'Apollo12_vec', 'apollo-14': 'Apollo14_vec',
  'apollo-15': 'Apollo15_vec', 'apollo-16': 'Apollo16_vec', 'apollo-17': 'Apollo17_vec',
};
const AN_LAYERS = /traverse|station|instrument|sample/i; // not "features" (named craters and rocks nearby)

// Missions whose surface activity went beyond what any published position data records.
const KNOWN_GAPS = {
  'luna-17': "Lunokhod 1 drove about 10 km, but only its final position is published as data; the area is the corridor from lander to rover, and the real route wandered more widely.",
  'luna-21': "Lunokhod 2 drove about 40 km, but only its final position is published as data; the area is the corridor from lander to rover, and the real route wandered more widely.",
  'change-3': "Yutu's short route is not published as data; the area covers the lander and Yutu's final position.",
  'change-4': 'Yutu-2 has driven about 1.6 km, but its route is not published as data; the area covers the lander only.',
  'chandrayaan-3': "Pragyan's route of about 100 m is not published as data; the area covers the lander only.",
};

/** All features of an ArcGIS map layer, in lunar longitude/latitude (GCS Moon 2000, wkid 104903). */
async function arcgisFeatures(service, layerId) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `${AN_BASE}/${service}/MapServer/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=104903&resultOffset=${offset}&resultRecordCount=1000&f=json`;
    const page = JSON.parse(await get(url));
    if (page.error) throw new Error(`${service}/${layerId}: ${page.error.message}`);
    out.push(...page.features);
    if (!page.exceededTransferLimit || !page.features.length) return out;
  }
}

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.text();
    if (attempt >= 4) throw new Error(`${url}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
}

/** Minimal CSV parser that handles quoted fields. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Equidistant cylindrical (as in the .PRJ files) back to latitude/longitude. */
function unproject(x, y, prj) {
  const central = Number(prj.match(/Central_Meridian",(-?[\d.]+)/)[1]);
  const parallel = Number(prj.match(/Standard_Parallel_1",(-?[\d.]+)/)[1]);
  let lon = central + x / (R * Math.cos(parallel * DEG) * DEG);
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return { lat: y / (R * DEG), lon };
}

function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const objectsCsv = await get(OBJECTS_URL);
await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, 'lroc-anthropogenic-objects.csv'), objectsCsv);
const objects = parseCsv(objectsCsv).filter((o) => !/impact/i.test(o.OBJECT));
const { landings } = JSON.parse(await readFile(join(ROOT, 'public/data/landings.json'), 'utf8'));

const areas = {};
for (const landing of landings) {
  const mine = objects.filter((o) => MISSION[o.MISSION] === landing.id);
  const points = mine.map((o) => ({ lat: Number(o.LATITUDE), lon: Number(o.LONGITUDE), what: o.SHORT_NAME, unc: Number(o.UNCERTAIN) || 0 }));
  const sources = mine.length ? [`LROC anthropogenic objects: ${mine.map((o) => o.SHORT_NAME).join(', ')}`] : [];

  for (const file of TRAVERSES[landing.id] ?? []) {
    const prj = await get(`${BASE}/${file}.PRJ`);
    const rows = parseCsv(await get(`${BASE}/${file}.csv`));
    for (const r of rows) {
      for (const [, x, y] of r.WKT.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)) points.push({ ...unproject(Number(x), Number(y), prj), what: 'traverse', unc: 0 });
    }
    sources.push(`LROC traverse map: ${file.split('/')[1]}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  const service = AN_SERVICE[landing.id];
  if (service) {
    const info = JSON.parse(await get(`${AN_BASE}/${service}/MapServer?f=json`));
    const used = [];
    for (const layer of info.layers.filter((l) => AN_LAYERS.test(l.name))) {
      const features = await arcgisFeatures(service, layer.id);
      for (const f of features) {
        const g = f.geometry ?? {};
        if (typeof g.x === 'number') points.push({ lat: g.y, lon: g.x, what: layer.name, unc: 0 });
        for (const path of g.paths ?? []) for (const [x, y] of path) points.push({ lat: y, lon: x, what: layer.name, unc: 0 });
      }
      used.push(`${layer.name} (${features.length})`);
      await new Promise((r) => setTimeout(r, 200));
    }
    sources.push(`Apollo Analyst's Notebook (NASA PDS Geosciences): ${used.join(', ')}`);
  }

  const located = mine.length > 0;
  if (!located) points.push({ lat: landing.lat, lon: landing.lon, what: 'this project\'s coordinates', unc: 0 });

  // Local east/north metres around the lander (or the first point).
  const anchor = mine.find((o) => /lander|descent/i.test(o.OBJECT)) ?? mine[0];
  const lat0 = anchor ? Number(anchor.LATITUDE) : landing.lat;
  const lon0 = anchor ? Number(anchor.LONGITUDE) : landing.lon;
  const toLocal = (p) => [R * Math.cos(lat0 * DEG) * (p.lon - lon0) * DEG, R * (p.lat - lat0) * DEG];
  const toLatLon = ([e, n]) => [lat0 + n / (R * DEG), lon0 + e / (R * Math.cos(lat0 * DEG) * DEG)];

  const margin = Math.max(MARGIN_M, ...points.map((p) => p.unc));
  const widened = [];
  for (const p of points) {
    const [e, n] = toLocal(p);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      widened.push([e + Math.cos(a) * margin, n + Math.sin(a) * margin]);
    }
  }
  const hull = convexHull(widened);
  let area = 0, extent = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    area += x1 * y2 - x2 * y1;
    for (const q of hull) extent = Math.max(extent, Math.hypot(q[0] - x1, q[1] - y1));
  }
  areas[landing.id] = {
    polygon: hull.map(toLatLon).map(([la, lo]) => [Number(la.toFixed(6)), Number(lo.toFixed(6))]),
    extentM: Math.round(extent),
    areaM2: Math.round(Math.abs(area) / 2),
    pointsUsed: points.length,
    located,
    sources,
    note: !located
      ? 'Not located in the LROC catalogue; the area is the lander alone, at this project\'s approximate coordinates.'
      : (KNOWN_GAPS[landing.id] ?? null),
  };
  console.log(`${landing.id.padEnd(14)} ${String(points.length).padStart(5)} pts  across ${(extent / 1000).toFixed(2).padStart(6)} km  ${located ? '' : '(not in catalogue)'}`);
}

await writeFile(
  join(OUT_DIR, 'site-areas.json'),
  JSON.stringify(
    {
      description: 'Area explored at each landing site: convex hull of measured hardware positions and mapped traverse paths, widened by a margin. Derived by scripts/fetch-site-areas.mjs.',
      sources: [
        'Wagner, R. V., et al. (2017). Coordinates of anthropogenic features on the Moon. Icarus, 283, 92-103. doi:10.1016/j.icarus.2016.05.011 (LROC ANTHROPOGENIC_OBJECTS, NASA PDS)',
        'Gonzales et al. (2019), LPSC L, abstract 3089: Apollo 11, 12 and 14 traverse maps (LROC, NASA PDS)',
        "Apollo Analyst's Notebook, NASA PDS Geosciences Node (https://an.rsl.wustl.edu/apollo/): Apollo traverses, stations, instruments and sample sites; LRV traverses from NASA TN D-7469",
      ],
      sourceUrl: `${BASE}/`,
      marginM: MARGIN_M,
      retrieved: new Date().toISOString(),
      areas,
    },
    null,
    1,
  ) + '\n',
);
console.log('wrote public/data/sources/site-areas.json and lroc-anthropogenic-objects.csv');
