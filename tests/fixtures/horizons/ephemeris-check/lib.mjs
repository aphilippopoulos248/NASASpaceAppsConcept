// Shared by fetch.mjs (builds the fixture) and check.mjs (re-derives every row from the raw
// replies): reading JPL Horizons observer tables, and the fixture's own geometry helpers.
// Node built-ins only; nothing here comes from src/ or scripts/.

export const SCHEMA = 'lunyx.horizons-sky/1';
export const MOON_RADIUS_KM = 1737.4;
export const D2R = Math.PI / 180;

const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** "2025-Mar-14 05:00:00.000" -> "2025-03-14T05:00:00Z" (milliseconds kept only when not zero). */
export function horizonsTimeToIso(s) {
  const m = /^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(s);
  if (!m || !MONTHS[m[2]]) throw new Error(`unreadable Horizons time "${s}"`);
  return `${m[1]}-${MONTHS[m[2]]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] === '000' ? '' : `.${m[7]}`}Z`;
}

/** The CSV table between $$SOE and $$EOE as an array of objects keyed by Horizons' own column names. */
export function parseHorizonsTable(text) {
  const lines = text.split('\n');
  const soe = lines.findIndex((l) => l.trim() === '$$SOE');
  const eoe = lines.findIndex((l) => l.trim() === '$$EOE');
  if (soe < 2 || eoe < soe) throw new Error('no $$SOE/$$EOE table in the Horizons reply');
  const names = lines[soe - 2].split(',').map((s) => s.trim());
  if (!names[0].startsWith('Date__(UT)')) throw new Error(`unexpected table header: ${lines[soe - 2]}`);
  names[2] = 'solarPresence'; // two unnamed marker columns follow the dates
  names[3] = 'interfererPresence';
  return lines.slice(soe + 1, eoe).map((line) => {
    const cells = line.split(',').map((s) => s.trim());
    const row = {};
    names.forEach((n, i) => { if (n) row[n] = cells[i]; });
    return row;
  });
}

/** Facts stated in the reply's header block, used to prove the query was answered as intended. */
export function readHeader(text) {
  const grab = (re) => (re.exec(text)?.[1] ?? '').trim();
  return {
    apiVersion: grab(/^API VERSION:\s*(.+)$/m),
    banner: grab(/^(Ephemeris \/ .+?)\s*$/m),
    target: grab(/^Target body name:\s*(.+?)\s*\{/m),
    ephemeris: grab(/^Target body name:.*\{source:\s*([^}]+)\}/m),
    center: grab(/^Center body name:\s*(.+?)\s*\{/m),
    centerSite: grab(/^Center-site name:\s*(.+)$/m),
    centerGeodetic: grab(/^Center geodetic\s*:\s*(.+?)\s*\{/m).split(',').map(Number),
    centerFrame: grab(/^Center pole\/equ\s*:\s*(.+?)\s*\{/m),
    centerRadii: grab(/^Center radii\s*:\s*(.+?)\s*km/m),
    targetFrame: grab(/^Target pole\/equ\s*:\s*(.+?)\s*\{/m),
    targetRadii: grab(/^Target radii\s*:\s*(.+?)\s*km/m),
    refraction: grab(/^Atmos refraction:\s*(.+)$/m),
  };
}

const num = (s, what) => {
  const v = Number(s);
  if (s === undefined || s === '' || !Number.isFinite(v)) throw new Error(`${what}: not a number ("${s}")`);
  return v;
};
export const wrap180 = (deg) => { const w = ((((deg + 180) % 360) + 360) % 360) - 180; return w === -180 ? 180 : w; };

/** Throws unless the reply header says what the fixture claims about itself. */
export function assertSiteHeader(text, body, site) {
  const h = readHeader(text);
  const want = body === 'sun' ? 'Sun (10)' : 'Earth (399)';
  const [lon, lat, alt] = h.centerGeodetic;
  const problems = [];
  if (h.target !== want) problems.push(`target is "${h.target}", not ${want}`);
  if (h.center !== 'Moon (301)') problems.push(`centre is "${h.center}"`);
  if (!h.centerFrame.startsWith('MEAN_ME')) problems.push(`site frame is "${h.centerFrame}"`);
  if (h.centerRadii !== '1737.4, 1737.4, 1737.4') problems.push(`reference radii are "${h.centerRadii}"`);
  if (h.refraction !== 'NO (AIRLESS)') problems.push(`refraction is "${h.refraction}"`);
  if (!(Math.abs(lat - site.lat) < 1e-9 && Math.abs(alt - site.altKm) < 1e-9)) problems.push(`site is ${h.centerGeodetic}, asked for ${site.lon},${site.lat},${site.altKm}`);
  // Longitude has no meaning at an exact pole; elsewhere Horizons echoes it as 0..360 east.
  if (Math.abs(site.lat) !== 90 && Math.abs(wrap180(lon - site.lon)) > 1e-9) problems.push(`site longitude is ${lon}, asked for ${site.lon}`);
  if (problems.length) throw new Error(`${body} reply header: ${problems.join('; ')}`);
  return h;
}
export function assertMoonHeader(text) {
  const h = readHeader(text);
  const problems = [];
  if (h.target !== 'Moon (301)') problems.push(`target is "${h.target}"`);
  if (h.center !== 'Earth (399)' || h.centerSite !== 'GEOCENTRIC') problems.push(`observer is "${h.center}" / "${h.centerSite}"`);
  if (h.targetFrame !== 'MOON_ME') problems.push(`Moon frame is "${h.targetFrame}"`);
  if (problems.length) throw new Error(`moon reply header: ${problems.join('; ')}`);
  return h;
}

/**
 * Joins the Sun, Earth and Moon tables into fixture rows, checking that every table holds exactly
 * the requested instants (calendar stamp and Julian date both).
 */
export function rowsFromTables(tables, utcList) {
  for (const [body, t] of Object.entries(tables)) {
    if (t.length !== utcList.length) throw new Error(`${body}: ${t.length} rows returned, ${utcList.length} requested`);
  }
  return utcList.map((utc, i) => {
    const out = { utc };
    for (const body of ['sun', 'earth', 'moon']) {
      const r = tables[body][i];
      const iso = horizonsTimeToIso(r['Date__(UT)__HR:MN:SC.fff']);
      const jdMs = (num(r['Date_________JDUT'], 'JD') - 2440587.5) * 86400000;
      if (iso !== utc || Math.abs(jdMs - Date.parse(utc)) > 1) throw new Error(`${body} row ${i}: Horizons answered for ${iso} (JD ${r['Date_________JDUT']}), asked for ${utc}`);
    }
    for (const body of ['sun', 'earth']) {
      const r = tables[body][i];
      const b = {
        az: num(r['Azimuth_(a-app)'], `${body} az`),
        el: num(r['Elevation_(a-app)'], `${body} el`),
        angDiamArcsec: num(r['Ang-diam'], `${body} ang-diam`),
        rangeKm: num(r['delta'], `${body} range`),
      };
      if (body === 'earth') {
        b.illumPct = num(r['Illu%'], 'earth illu%');
        b.sunElongDeg = num(r['S-O-T'], 'earth S-O-T');
      }
      out[body] = b;
    }
    const m = tables.moon[i];
    // Horizons prints east longitude as 0..360 with six decimals; the fixture uses -180..180.
    const east180 = (s, what) => { const v = num(s, what); return v > 180 ? Number((v - 360).toFixed(6)) : v; };
    out.subEarth = { lat: num(m['ObsSub-LAT'], 'ObsSub-LAT'), lon: east180(m['ObsSub-LON'], 'ObsSub-LON') };
    out.subSolar = { lat: num(m['SunSub-LAT'], 'SunSub-LAT'), lon: east180(m['SunSub-LON'], 'SunSub-LON') };
    return out;
  });
}

/** Pretty JSON for everything except rows, which go one per line (small files, readable diffs). */
export function serialiseSet(doc) {
  const { rows, ...rest } = doc;
  const head = JSON.stringify(rest, null, 1).replace(/\n}$/, '');
  return `${head},\n "rows": [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`;
}

// ---------- geometry (the fixture's own, independent of the app) ----------
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
/** Unit vector of a lat/lon in the Moon-fixed frame (x through 0N 0E, y through 0N 90E, z north). */
export const fromLatLon = (lat, lon) => [Math.cos(lat * D2R) * Math.cos(lon * D2R), Math.cos(lat * D2R) * Math.sin(lon * D2R), Math.sin(lat * D2R)];
/** Local east / north / up axes at a site, as Moon-fixed unit vectors. At an exact pole they follow the stated longitude. */
export function enu(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  return {
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}
/** Azimuth (deg clockwise from north, 0..360) and elevation (deg) of a Moon-fixed vector at a site. */
export function azEl(lat, lon, v) {
  const f = enu(lat, lon);
  const u = unit(v);
  return { az: ((Math.atan2(dot(u, f.east), dot(u, f.north)) / D2R) + 360) % 360, el: Math.asin(Math.max(-1, Math.min(1, dot(u, f.up)))) / D2R };
}
/** Unit vector in the local east/north/up frame for an azimuth and elevation. */
export const fromAzEl = (az, el) => [Math.cos(el * D2R) * Math.sin(az * D2R), Math.cos(el * D2R) * Math.cos(az * D2R), Math.sin(el * D2R)];
/** Angle between two sky directions given as az/el, deg. */
export const separation = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(fromAzEl(a.az, a.el), fromAzEl(b.az, b.el))))) / D2R;
/** Great-circle distance between two lat/lon points, deg. */
export const arc = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(fromLatLon(a.lat, a.lon), fromLatLon(b.lat, b.lon))))) / D2R;
/**
 * How far a direction is from the reference one: elevation difference and the azimuth difference
 * as an arc on the sky (times cos el), both in degrees. This is how the fixture is meant to be
 * compared, because raw azimuth is ill-conditioned towards the zenith and nadir.
 */
export function skyError(got, ref) {
  return { dEl: got.el - ref.el, dAzArc: wrap180(got.az - ref.az) * Math.cos(ref.el * D2R), sep: separation(got, ref) };
}
