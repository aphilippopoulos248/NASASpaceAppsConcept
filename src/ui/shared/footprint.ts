// The outline of what the globe camera sees, as lat/lon points, for the locator map.
// Rebuilds the camera from the shared state (centre point, altitude, window aspect), so it
// needs no access to the scene. Pure maths: unit-tested.
import { MOON_RADIUS_KM, wrapLon } from '../../core/types';

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Same convention as latLonToVec3: +Y north, +X (0°, 0°), east is -Z. */
export function toVec(lat: number, lon: number): V {
  const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

export function toLatLon(v: V): { lat: number; lon: number } {
  const n = norm(v);
  return { lat: (Math.asin(Math.max(-1, Math.min(1, n[1]))) * 180) / Math.PI, lon: wrapLon((Math.atan2(-n[2], n[0]) * 180) / Math.PI) };
}

/** Vertical field of view the globe camera uses for a window size (see GlobeView.resize). */
export function globeFovDeg(w: number, h: number): number {
  return w < h ? 40 * Math.min(1.6, h / w) : 40;
}

/**
 * Points (lat/lon) around the edge of the visible part of the Moon, in order.
 * Rays past the limb are replaced by the limb point in the same screen direction.
 */
export function viewFootprint(center: { lat: number; lon: number; altitudeKm: number }, aspect: number, fovDeg: number, perEdge = 12): { lat: number; lon: number }[] {
  const D = 1 + center.altitudeKm / MOON_RADIUS_KM;
  const c = toVec(center.lat, center.lon);
  const P = scale(c, D);
  const fwd = scale(c, -1);
  // OrbitControls keeps world +Y as up.
  let right = cross(fwd, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-9) right = [0, 0, -1];
  right = norm(right);
  const up = cross(right, fwd);
  const ty = Math.tan(((fovDeg / 2) * Math.PI) / 180), tx = ty * aspect;
  const border: [number, number][] = [];
  for (let i = 0; i < perEdge; i++) border.push([-1 + (2 * i) / perEdge, 1]);
  for (let i = 0; i < perEdge; i++) border.push([1, 1 - (2 * i) / perEdge]);
  for (let i = 0; i < perEdge; i++) border.push([1 - (2 * i) / perEdge, -1]);
  for (let i = 0; i < perEdge; i++) border.push([-1, -1 + (2 * i) / perEdge]);
  const out: { lat: number; lon: number }[] = [];
  for (const [sx, sy] of border) {
    const d = norm(add(add(fwd, scale(right, sx * tx)), scale(up, sy * ty)));
    // Ray P + t d against the unit sphere.
    const b = dot(P, d), cc = dot(P, P) - 1, disc = b * b - cc;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      out.push(toLatLon(add(P, scale(d, t))));
    } else {
      // Limb point in the plane of the camera direction and this ray.
      const perp = add(d, scale(c, -dot(d, c)));
      const u = norm(perp);
      out.push(toLatLon(add(scale(c, 1 / D), scale(u, Math.sqrt(1 - 1 / (D * D))))));
    }
  }
  return out;
}
