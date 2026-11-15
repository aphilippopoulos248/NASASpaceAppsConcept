// Scene directions and selenographic coordinates. Scene axes: +Y the north pole, +X the
// sub-Earth point (0 N, 0 E), east is -Z (see latLonToVec3 in src/data/landings.ts).
import type { Vector3 } from 'three';
import { wrapLon } from '../../core/types';

/** Scene direction to selenographic lat/lon in degrees, longitude east-positive (inverse of latLonToVec3). */
export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  return { lat: (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI, lon: wrapLon((Math.atan2(-n.z, n.x) * 180) / Math.PI) };
}
