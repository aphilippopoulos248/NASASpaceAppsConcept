// Sky geometry for the surface scene. Pure math: no DOM, no three.js.
//
// Scene frame (metres): +X east, +Y up, +Z south, origin at the site. Azimuth is degrees
// clockwise from north, elevation is degrees above the site's horizontal plane (airless).

export const DEG = Math.PI / 180;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Unit vector in the scene frame for an azimuth and elevation in degrees. */
export function azElToScene<T extends Vec3Like>(azDeg: number, elDeg: number, out: T): T {
  const az = azDeg * DEG, el = elDeg * DEG, c = Math.cos(el);
  out.x = c * Math.sin(az);
  out.y = Math.sin(el);
  out.z = -c * Math.cos(az);
  return out;
}

/** Azimuth (0..360) and elevation of a scene-frame direction, degrees. */
export function sceneToAzEl(v: Vec3Like): { azDeg: number; elDeg: number } {
  const h = Math.hypot(v.x, v.z);
  let az = Math.atan2(v.x, -v.z) / DEG;
  if (az < 0) az += 360;
  return { azDeg: h < 1e-12 ? 0 : az, elDeg: Math.atan2(v.y, h) / DEG };
}

/** Wraps an azimuth into 0..360. */
export function wrapAz(azDeg: number): number {
  return ((azDeg % 360) + 360) % 360;
}

/** Shortest signed turn from azimuth a to azimuth b, degrees in -180..180. */
export function azDelta(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180;
}

/** Angle between two directions given as azimuth/elevation, degrees. */
export function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const a = azElToScene(az1, el1, { x: 0, y: 0, z: 0 }), b = azElToScene(az2, el2, { x: 0, y: 0, z: 0 });
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
  return Math.atan2(Math.hypot(cx, cy, cz), dot) / DEG;
}

/**
 * Fraction of a disc's area that lies above a straight edge, given the fraction `x` of its
 * vertical diameter above that edge (0 = just hidden, 0.5 = cut through the centre, 1 = just clear).
 */
export function discAreaAbove(x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const u = 1 - 2 * x; // signed distance of the edge from the centre, in radii
  return (Math.acos(u) - u * Math.sqrt(1 - u * u)) / Math.PI;
}

/**
 * Fraction of a disc of angular radius `r` (the Sun) covered by another disc of radius `R`
 * (Earth) whose centre is `d` away; all three in the same unit. 0 = clear, 1 = fully covered.
 */
export function discCoveredFraction(r: number, R: number, d: number): number {
  if (!(r > 0) || !(R > 0)) return 0;
  if (d >= r + R) return 0;
  if (d <= Math.abs(R - r)) return R >= r ? 1 : (R * R) / (r * r);
  // Area of the lens where two circles overlap.
  const a = (d * d + r * r - R * R) / (2 * d * r);
  const b = (d * d + R * R - r * r) / (2 * d * R);
  const lens =
    r * r * Math.acos(Math.max(-1, Math.min(1, a))) +
    R * R * Math.acos(Math.max(-1, Math.min(1, b))) -
    0.5 * Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
  return Math.max(0, Math.min(1, lens / (Math.PI * r * r)));
}

/** A step between time samples that reads well ("every 2 hours"), at least `minH` hours. */
export function niceStepH(minH: number): number {
  for (const s of [0.25, 0.5, 1, 2, 3, 6, 12, 24, 48, 72, 168]) if (s >= minH) return s;
  return Math.ceil(minH / 168) * 168;
}
