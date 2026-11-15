// Where a programmatic flight of the globe camera ends (setGlobeCamera, selecting a site,
// the keyboard): straight over the point asked for, except right over a pole.
import { Vector3 } from 'three';
import { MAX_VIEW_LAT_DEG } from '../../core/coreActions';

/**
 * Flights stop this close to a pole, degrees of latitude (0.1 degree is about 3 km on the
 * Moon). Dead-centre on a pole the orbit controls' azimuth is undefined, and dragging spins the
 * view in place instead of moving across the ground. setGlobeCamera reports it (core).
 */
export const MAX_FLY_LAT_DEG = MAX_VIEW_LAT_DEG;

const DEG = Math.PI / 180;

/**
 * The unit direction to fly to: `dir` itself, or, poleward of MAX_FLY_LAT_DEG, the point at
 * that latitude on the same meridian. Only the latitude is limited: the longitude is kept, so
 * the camera lands exactly where it was asked to everywhere else (the earlier rule clamped the
 * vector's height and moved every target poleward of 80 degrees by up to 1.7 km).
 * On a pole itself the meridian is undefined: the camera's present one is used.
 */
export function flyDirection(dir: Vector3, from: Vector3): Vector3 {
  const d = dir.clone().normalize();
  const maxY = Math.sin(MAX_FLY_LAT_DEG * DEG);
  if (Math.abs(d.y) <= maxY) return d;
  let h = Math.hypot(d.x, d.z);
  let x = d.x, z = d.z;
  if (h < 1e-9) {
    x = from.x;
    z = from.z;
    h = Math.hypot(x, z);
    if (h < 1e-9) {
      x = 1;
      z = 0;
      h = 1;
    }
  }
  const k = Math.cos(MAX_FLY_LAT_DEG * DEG) / h;
  return d.set(x * k, Math.sign(d.y) * maxY, z * k);
}
