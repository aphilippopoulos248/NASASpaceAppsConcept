// Where the Sun and Earth are, as seen from the Moon, for any date.
// Pure math on top of astronomy-engine (no DOM, no three.js) so that
// scripts/check-ephemeris.mjs can run the same code against JPL Horizons.
import {
  Body,
  GeoMoon,
  GeoVector,
  KM_PER_AU,
  RotateVector,
  Rotation_EQD_EQJ,
  RotationAxis,
  SiderealTime,
  Vector,
  MakeTime,
} from 'astronomy-engine';

export interface LatLon {
  /** Degrees, north-positive. */
  lat: number;
  /** Degrees, east-positive, -180..180. */
  lon: number;
}

/** Vector in the Moon-fixed frame: x through (0°, 0°), y through (0°, 90°E), z through the north pole. */
export type Vec3 = [number, number, number];

export interface MoonGeometry {
  subSolar: LatLon;
  subEarth: LatLon;
  /** Unit vectors, Moon-fixed. */
  sunDir: Vec3;
  earthDir: Vec3;
  earthDistanceKm: number;
  /** Earth's north pole and its Greenwich-meridian direction, Moon-fixed, for orienting an Earth model. */
  earthPole: Vec3;
  earthPrime: Vec3;
  /** Fraction of the Earth-facing disc that is sunlit, 0..1. */
  litFraction: number;
  /** True between new and full Moon. */
  waxing: boolean;
}

const DEG = Math.PI / 180;

type V = { x: number; y: number; z: number };
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V): V => {
  const l = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

export function moonGeometry(date: Date): MoonGeometry {
  const time = MakeTime(date);

  // Moon-fixed axes expressed in J2000 equatorial coordinates (IAU rotation model).
  const axis = RotationAxis(Body.Moon, time);
  const ra = axis.ra * 15 * DEG;
  const w = axis.spin * DEG;
  const pole: V = norm(axis.north);
  const node: V = { x: -Math.sin(ra), y: Math.cos(ra), z: 0 }; // ascending node of the lunar equator
  const m = cross(pole, node);
  const ex: V = {
    x: node.x * Math.cos(w) + m.x * Math.sin(w),
    y: node.y * Math.cos(w) + m.y * Math.sin(w),
    z: node.z * Math.cos(w) + m.z * Math.sin(w),
  };
  const ey = cross(pole, ex);
  const toMoon = (v: V): Vec3 => [dot(v, ex), dot(v, ey), dot(v, pole)];
  const toLatLon = ([x, y, z]: Vec3): LatLon => ({ lat: Math.asin(z) / DEG, lon: Math.atan2(y, x) / DEG });

  const moon = GeoMoon(time); // Earth -> Moon, AU
  const sun = GeoVector(Body.Sun, time, true); // Earth -> Sun, AU
  const moonToSun = norm({ x: sun.x - moon.x, y: sun.y - moon.y, z: sun.z - moon.z });
  const moonToEarth = norm({ x: -moon.x, y: -moon.y, z: -moon.z });

  const sunDir = toMoon(moonToSun);
  const earthDir = toMoon(moonToEarth);
  const subSolar = toLatLon(sunDir);

  // Earth's spin axis and Greenwich meridian: defined in the equator-of-date frame, rotated to J2000.
  const rot = Rotation_EQD_EQJ(time);
  const gast = SiderealTime(time) * 15 * DEG;
  const j2000 = (x: number, y: number, z: number) => RotateVector(rot, new Vector(x, y, z, time));

  return {
    subSolar,
    subEarth: toLatLon(earthDir),
    sunDir,
    earthDir,
    earthDistanceKm: moon.Length() * KM_PER_AU,
    earthPole: toMoon(j2000(0, 0, 1)),
    earthPrime: toMoon(j2000(Math.cos(gast), Math.sin(gast), 0)),
    litFraction: (1 + dot(moonToSun, moonToEarth)) / 2,
    waxing: subSolar.lon > 0,
  };
}

/** Unit vector for a point on the Moon, in the Moon-fixed frame. */
export function siteVector(lat: number, lon: number): Vec3 {
  const la = lat * DEG;
  const lo = lon * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Angle of a distant body above the local horizon at a site, in degrees (negative = below). */
export function elevation(lat: number, lon: number, bodyDir: Vec3): number {
  const s = siteVector(lat, lon);
  return Math.asin(Math.max(-1, Math.min(1, s[0] * bodyDir[0] + s[1] * bodyDir[1] + s[2] * bodyDir[2]))) / DEG;
}

export function phaseName(g: Pick<MoonGeometry, 'litFraction' | 'waxing'>): string {
  const f = g.litFraction;
  if (f < 0.02) return 'New Moon';
  if (f > 0.98) return 'Full Moon';
  if (Math.abs(f - 0.5) < 0.04) return g.waxing ? 'First quarter' : 'Last quarter';
  return `${g.waxing ? 'Waxing' : 'Waning'} ${f < 0.5 ? 'crescent' : 'gibbous'}`;
}
