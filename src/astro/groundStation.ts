// Straight-line geometry between a ground station on Earth and a point on the Moon.
//
// Positions: the Moon's centre from astronomy-engine (geocentric, J2000 equatorial), the
// lunar site through the IAU rotation model (src/astro/topocentric.ts), the station from its
// published Earth-fixed Cartesian coordinates rotated by Greenwich apparent sidereal time and
// the precession-nutation matrix of astronomy-engine.
//
// Simplifications, each far below a hundredth of a degree for this purpose:
//  - geometric positions at one instant (the 1.3 s of light-time moves the Moon by 1.3 km
//    relative to Earth: 0.0002 deg);
//  - UT1 taken equal to UTC (they differ by less than 0.9 s: up to 0.004 deg of Earth rotation)
//    and no polar motion (0.0001 deg);
//  - no atmosphere: elevations are airless.
//
// Pure math: no DOM, no three.js.
import { GeoMoon, KM_PER_AU, MakeTime, Rotation_EQD_EQJ, SiderealTime } from 'astronomy-engine';
import { azEl, localFrame, moonAxes, MOON_R_KM, type V3 } from './topocentric';

const DEG = Math.PI / 180;

/** A station as needed for the geometry: Earth-fixed position and the direction of its local vertical. */
export interface StationPlace {
  /** Cartesian position in the Earth-fixed frame (x through 0 N 0 E, z through the north pole), metres. */
  xyzM: readonly [number, number, number];
  /** Geodetic latitude and east longitude, degrees: they define the local horizontal plane. */
  latDeg: number;
  lonDeg: number;
}

/** What one instant fixes for every station and site: where the Moon is, how it is turned, how Earth is turned. */
export interface LinkEpoch {
  /** Earth's centre to the Moon's centre, km, J2000 equatorial. */
  moonKm: V3;
  /** Moon-fixed axes as J2000 unit vectors. */
  ex: V3;
  ey: V3;
  ez: V3;
  /** Rotation from the Earth-fixed frame to J2000, row-major 3 x 3. */
  earthToJ2000: number[];
}

export function linkEpoch(timeMs: number): LinkEpoch {
  const time = MakeTime(new Date(timeMs));
  const m = GeoMoon(time);
  const { ex, ey, ez } = moonAxes(time);
  // Earth-fixed -> equator of date: a turn about the pole by the Greenwich apparent sidereal angle.
  const gast = SiderealTime(time) * 15 * DEG;
  const c = Math.cos(gast), s = Math.sin(gast);
  // Equator of date -> J2000. astronomy-engine stores the matrix so that out_i = sum_j rot[j][i] * in_j.
  const r = Rotation_EQD_EQJ(time).rot;
  const P = [r[0][0], r[1][0], r[2][0], r[0][1], r[1][1], r[2][1], r[0][2], r[1][2], r[2][2]];
  // P * Rz(gast)
  const e2j = [
    P[0] * c + P[1] * s, -P[0] * s + P[1] * c, P[2],
    P[3] * c + P[4] * s, -P[3] * s + P[4] * c, P[5],
    P[6] * c + P[7] * s, -P[6] * s + P[7] * c, P[8],
  ];
  return { moonKm: [m.x * KM_PER_AU, m.y * KM_PER_AU, m.z * KM_PER_AU], ex, ey, ez, earthToJ2000: e2j };
}

const rot = (m: number[], v: readonly number[]): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A station prepared for repeated use: position in km and its east/north/up directions, Earth-fixed. */
export interface StationFrame {
  posKm: V3;
  up: V3;
  east: V3;
  north: V3;
}

export function stationFrame(st: StationPlace): StationFrame {
  const f = localFrame(st.latDeg, st.lonDeg);
  return { posKm: [st.xyzM[0] / 1000, st.xyzM[1] / 1000, st.xyzM[2] / 1000], up: f.up, east: f.east, north: f.north };
}

/** A lunar site prepared for repeated use: its local frame (Moon-fixed) and its distance from the Moon's centre. */
export interface SiteFrame {
  frame: { up: V3; east: V3; north: V3 };
  radiusKm: number;
}

export function siteFrame(latDeg: number, lonDeg: number, heightM: number): SiteFrame {
  return { frame: localFrame(latDeg, lonDeg), radiusKm: MOON_R_KM + heightM / 1000 };
}

export interface LinkGeometry {
  /** The lunar site as seen from the station: degrees above the station's horizontal, and azimuth clockwise from north. */
  stationElDeg: number;
  stationAzDeg: number;
  /** The station as seen from the lunar site: degrees above the site's horizontal, and azimuth clockwise from north. */
  siteElDeg: number;
  siteAzDeg: number;
  rangeKm: number;
}

/** The straight line between a station and a lunar site at one instant. */
export function linkGeometry(epoch: LinkEpoch, site: SiteFrame, station: StationFrame, out?: LinkGeometry): LinkGeometry {
  const m = epoch.earthToJ2000;
  const sp = rot(m, station.posKm);
  const u = site.frame.up;
  const r = site.radiusKm;
  // The site in J2000: Moon centre + r * (up expressed through the Moon's axes).
  const sx = epoch.moonKm[0] + r * (epoch.ex[0] * u[0] + epoch.ey[0] * u[1] + epoch.ez[0] * u[2]);
  const sy = epoch.moonKm[1] + r * (epoch.ex[1] * u[0] + epoch.ey[1] * u[1] + epoch.ez[1] * u[2]);
  const sz = epoch.moonKm[2] + r * (epoch.ex[2] * u[0] + epoch.ey[2] * u[1] + epoch.ez[2] * u[2]);
  const vx = sx - sp[0], vy = sy - sp[1], vz = sz - sp[2];
  const range = Math.hypot(vx, vy, vz);
  const v: V3 = [vx / range, vy / range, vz / range];
  // At the station.
  const up = dot(v, rot(m, station.up)), east = dot(v, rot(m, station.east)), north = dot(v, rot(m, station.north));
  let az = Math.atan2(east, north) / DEG;
  if (az < 0) az += 360;
  // At the site: the direction back to the station, in Moon-fixed axes.
  const back: V3 = [-dot(v, epoch.ex), -dot(v, epoch.ey), -dot(v, epoch.ez)];
  const atSite = azEl(site.frame, back);
  const g = out ?? ({} as LinkGeometry);
  g.stationElDeg = Math.atan2(up, Math.hypot(east, north)) / DEG;
  g.stationAzDeg = az;
  g.siteElDeg = atSite.el;
  g.siteAzDeg = atSite.az;
  g.rangeKm = range;
  return g;
}
