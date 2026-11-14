// Spherical geometry shared by the terrain sources, the window builder and their tests.
// Sphere of radius 1737.4 km (the LOLA datum). No DOM, no three.js, no imports: this file
// is also loaded directly by Node scripts.

export const R_MOON_M = 1_737_400;
const DEG = Math.PI / 180;

/** Unit vector of a lat/lon (x towards 0E on the equator, y towards 90E, z towards the north pole). */
export function unitVector(lat: number, lon: number): [number, number, number] {
  const φ = lat * DEG;
  const λ = lon * DEG;
  const c = Math.cos(φ);
  return [c * Math.cos(λ), c * Math.sin(λ), Math.sin(φ)];
}

/**
 * Local east and north unit vectors at a point. At a pole "north" is taken along the
 * meridian of the longitude given, which keeps every formula below well defined there.
 */
export function localFrame(lat: number, lon: number): { p: [number, number, number]; e: [number, number, number]; n: [number, number, number] } {
  const φ = lat * DEG;
  const λ = lon * DEG;
  const sφ = Math.sin(φ);
  const cφ = Math.cos(φ);
  const sλ = Math.sin(λ);
  const cλ = Math.cos(λ);
  return { p: [cφ * cλ, cφ * sλ, sφ], e: [-sλ, cλ, 0], n: [-sφ * cλ, -sφ * sλ, cφ] };
}

/**
 * The point reached from (lat, lon) after travelling `eastM` and `northM` metres over the
 * sphere: distance hypot(east, north) along the great circle whose initial bearing is
 * atan2(east, north). This is the convention of the site windows (azimuthal equidistant).
 */
export function offsetPoint(lat: number, lon: number, eastM: number, northM: number): { lat: number; lon: number } {
  const d = Math.hypot(eastM, northM) / R_MOON_M;
  if (d === 0) return { lat, lon };
  const { p, e, n } = localFrame(lat, lon);
  const ce = eastM / (d * R_MOON_M);
  const cn = northM / (d * R_MOON_M);
  const s = Math.sin(d);
  const c = Math.cos(d);
  const x = c * p[0] + s * (ce * e[0] + cn * n[0]);
  const y = c * p[1] + s * (ce * e[1] + cn * n[1]);
  const z = c * p[2] + s * (ce * e[2] + cn * n[2]);
  return { lat: Math.asin(Math.max(-1, Math.min(1, z))) / DEG, lon: Math.atan2(y, x) / DEG };
}

/** Inverse of offsetPoint: where (lat, lon) lies, in metres east and north, as seen from (lat0, lon0). */
export function localOffset(lat0: number, lon0: number, lat: number, lon: number): { eastM: number; northM: number } {
  const { p, e, n } = localFrame(lat0, lon0);
  const q = unitVector(lat, lon);
  const ce = q[0] * e[0] + q[1] * e[1] + q[2] * e[2];
  const cn = q[0] * n[0] + q[1] * n[1] + q[2] * n[2];
  const t = Math.hypot(ce, cn);
  if (t < 1e-15) return { eastM: 0, northM: 0 };
  const k = (Math.atan2(t, q[0] * p[0] + q[1] * p[1] + q[2] * p[2]) * R_MOON_M) / t;
  return { eastM: ce * k, northM: cn * k };
}

/** Great-circle distance in metres. */
export function surfaceDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = unitVector(lat1, lon1);
  const b = unitVector(lat2, lon2);
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) * R_MOON_M;
}

/**
 * Polar stereographic projection of the LOLA polar products (sphere, true scale at the
 * pole, longitude 0 along +y for the south pole and along -y for the north pole).
 * Returns metres; line = c - y / scale, sample = c + x / scale.
 */
export function polarXY(pole: 'N' | 'S', lat: number, lon: number): { x: number; y: number } {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = 2 * R_MOON_M * Math.tan((colat / 2) * DEG);
  const λ = lon * DEG;
  return pole === 'S' ? { x: r * Math.sin(λ), y: r * Math.cos(λ) } : { x: r * Math.sin(λ), y: -r * Math.cos(λ) };
}

/** Inverse of polarXY. */
export function polarLatLon(pole: 'N' | 'S', x: number, y: number): { lat: number; lon: number } {
  const colat = (2 * Math.atan(Math.hypot(x, y) / (2 * R_MOON_M))) / DEG;
  return pole === 'S' ? { lat: colat - 90, lon: Math.atan2(x, y) / DEG } : { lat: 90 - colat, lon: Math.atan2(x, -y) / DEG };
}

/** Latitude (unsigned, degrees) of the circle inscribed in a polar grid of the given half-width. */
export function polarEdgeLatitude(halfWidthM: number): number {
  return 90 - (2 * Math.atan(halfWidthM / (2 * R_MOON_M))) / DEG;
}
