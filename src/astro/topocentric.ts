// Sun and Earth as seen from a point ON the Moon (topocentric), airless.
//
// Modelled to match JPL Horizons observer tables for CENTER='coord@301' with
// APPARENT='AIRLESS': apparent directions (light-time + stellar aberration from
// the observer's barycentric motion), no refraction. Elevation is measured from the
// plane perpendicular to the local radial (the reference surface is the 1737.4 km
// sphere, as in Horizons for the Moon). Azimuth is clockwise from north.
//
// Positions come from astronomy-engine (VSOP87 Earth, its lunar theory); the
// Moon-fixed frame is the IAU (WGCCRE) rotation model from astronomy-engine.
// Horizons uses the DE441 libration (MEAN_ME frame); the difference is part of the
// measured error recorded in docs/lunyx/validation.md.
//
// Pure math: no DOM, no three.js.
import { Body, C_AUDAY, GeoMoonState, HelioState, KM_PER_AU, MakeTime, RotationAxis, type AstroTime } from 'astronomy-engine';

export const MOON_R_KM = 1737.4;
/** IAU 2015 nominal solar radius, km (the value Horizons quotes). */
export const SUN_R_KM = 695_700;
/** Earth's equatorial radius, km (WGS-84 / IAU). */
export const EARTH_R_KM = 6378.137;

const DEG = Math.PI / 180;

export type V3 = [number, number, number];

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: V3): V3 => scale(a, 1 / len(a));

/** Moon-fixed axes (x to 0N 0E, y to 0N 90E, z to the north pole) as J2000 equatorial unit vectors. */
export function moonAxes(time: AstroTime): { ex: V3; ey: V3; ez: V3 } {
  const axis = RotationAxis(Body.Moon, time);
  const ra = axis.ra * 15 * DEG;
  const w = axis.spin * DEG;
  const ez = unit([axis.north.x, axis.north.y, axis.north.z]);
  const node: V3 = [-Math.sin(ra), Math.cos(ra), 0];
  const m = cross(ez, node);
  const ex: V3 = add(scale(node, Math.cos(w)), scale(m, Math.sin(w)));
  const ey = cross(ez, ex);
  return { ex, ey, ez };
}

/** Local frame of a site: unit up, east and north vectors in the Moon-fixed frame.
 *  At the poles (|lat| = 90) "north" is the limit taken along the site's own meridian,
 *  so azimuths stay continuous as a site approaches the pole along that meridian. */
export function localFrame(latDeg: number, lonDeg: number): { up: V3; east: V3; north: V3 } {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  return {
    up: [cl * co, cl * so, sl],
    east: [-so, co, 0],
    north: [-sl * co, -sl * so, cl],
  };
}

/** Azimuth (0..360, clockwise from north) and elevation of a Moon-fixed direction, degrees. */
export function azEl(frame: { up: V3; east: V3; north: V3 }, dir: V3): { az: number; el: number } {
  const u = dot(dir, frame.up), e = dot(dir, frame.east), n = dot(dir, frame.north);
  let az = Math.atan2(e, n) / DEG;
  if (az < 0) az += 360;
  return { az, el: Math.atan2(u, Math.hypot(e, n)) / DEG };
}

export interface TopoBody {
  /** Apparent direction, unit vector, Moon-fixed frame. */
  dir: V3;
  azDeg: number;
  elDeg: number;
  /** Light-time (apparent) distance, km. */
  distanceKm: number;
  angularRadiusDeg: number;
}

export interface TopoSky {
  sun: TopoBody;
  earth: TopoBody;
  /** Sunlit fraction of Earth's disc as seen from the site. */
  earthLitFraction: number;
  /** Directions from the Moon's centre (no parallax), apparent, Moon-fixed. */
  sunDirCentre: V3;
  earthDirCentre: V3;
  subSolar: { lat: number; lon: number };
  subEarth: { lat: number; lon: number };
}

const toLatLon = (d: V3) => {
  let lon = Math.atan2(d[1], d[0]) / DEG;
  if (lon > 180) lon -= 360;
  return { lat: Math.asin(Math.max(-1, Math.min(1, d[2]))) / DEG, lon };
};

/** First-order stellar aberration: apparent direction of a source at unit direction u for an observer moving at v (same units as c). */
function aberrate(u: V3, v: V3, c: number): V3 {
  const b = scale(v, 1 / c);
  const ub = dot(u, b);
  // Exact special-relativistic form is overkill at 1e-4 c; first order plus normalisation is better than 0.01 arcsec here.
  return unit(sub(add(u, b), scale(u, ub)));
}

/**
 * Topocentric airless Sun and Earth for a site on the Moon.
 * @param latDeg, lonDeg  site, ME-frame planetocentric degrees (east-positive)
 * @param heightM          height above the 1737.4 km sphere, metres (terrain + mast)
 * @param date             UTC instant
 */
export function topocentricSky(latDeg: number, lonDeg: number, heightM: number, date: Date | number): TopoSky {
  const time = MakeTime(typeof date === 'number' ? new Date(date) : date);
  const { ex, ey, ez } = moonAxes(time);
  const toFixed = (v: V3): V3 => [dot(v, ex), dot(v, ey), dot(v, ez)];
  const toJ2000 = (v: V3): V3 => add(add(scale(ex, v[0]), scale(ey, v[1])), scale(ez, v[2]));

  // Heliocentric states, AU and AU/day, J2000 equatorial. The Sun's barycentric motion
  // (~13 m/s) is ignored: it shifts the Sun's direction by < 1e-5 deg over the light time.
  // The Moon is Earth plus the geocentric Moon: exactly what astronomy-engine's own heliocentric
  // Moon is, without evaluating Earth's series a second time.
  const earth = HelioState(Body.Earth, time);
  const geoMoon = GeoMoonState(time);
  const moonPos: V3 = [geoMoon.x + earth.x, geoMoon.y + earth.y, geoMoon.z + earth.z];
  const moonVel: V3 = [geoMoon.vx + earth.vx, geoMoon.vy + earth.vy, geoMoon.vz + earth.vz];
  const earthPos: V3 = [earth.x, earth.y, earth.z];
  const earthVel: V3 = [earth.vx, earth.vy, earth.vz];

  const frame = localFrame(latDeg, lonDeg);
  const rObsKm = MOON_R_KM + heightM / 1000;
  const siteJ = toJ2000(scale(frame.up, rObsKm / KM_PER_AU)); // AU
  const obsPos = add(moonPos, siteJ);
  // The site's rotation speed (~4.6 m/s) is negligible against the orbital 30 km/s.
  const obsVel = moonVel;

  const sunApparent = (from: V3, vel: V3) => {
    // Sun at the origin: light time does not move it measurably.
    const rel = scale(from, -1);
    const d = len(rel);
    return { u: aberrate(unit(rel), vel, C_AUDAY), dKm: d * KM_PER_AU };
  };
  const earthApparent = (from: V3, vel: V3) => {
    // Earth's position at the retarded time t - tau, linear in Earth's velocity (tau ~ 1.3 s).
    let rel = sub(earthPos, from);
    let tau = 0;
    for (let k = 0; k < 2; k++) {
      tau = len(rel) / C_AUDAY;
      rel = sub(sub(earthPos, scale(earthVel, tau)), from);
    }
    return { u: aberrate(unit(rel), vel, C_AUDAY), dKm: len(rel) * KM_PER_AU };
  };

  const sunT = sunApparent(obsPos, obsVel);
  const earthT = earthApparent(obsPos, obsVel);
  const sunC = sunApparent(moonPos, moonVel);
  const earthC = earthApparent(moonPos, moonVel);

  const mk = (u: V3, dKm: number, rKm: number): TopoBody => {
    const dir = toFixed(u);
    const { az, el } = azEl(frame, dir);
    return { dir, azDeg: az, elDeg: el, distanceKm: dKm, angularRadiusDeg: Math.asin(Math.min(1, rKm / dKm)) / DEG };
  };

  // Phase of Earth seen from the site: angle at Earth between the Sun and the observer.
  const earthToSun = unit(scale(earthPos, -1));
  const earthToObs = unit(sub(obsPos, earthPos));
  const litFraction = (1 + dot(earthToSun, earthToObs)) / 2;

  const sunDirCentre = toFixed(sunC.u);
  const earthDirCentre = toFixed(earthC.u);
  return {
    sun: mk(sunT.u, sunT.dKm, SUN_R_KM),
    earth: mk(earthT.u, earthT.dKm, EARTH_R_KM),
    earthLitFraction: litFraction,
    sunDirCentre,
    earthDirCentre,
    subSolar: toLatLon(sunDirCentre),
    subEarth: toLatLon(earthDirCentre),
  };
}
