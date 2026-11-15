import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { latLonToVec3 } from '../../data/landings';
import { flyDirection, MAX_FLY_LAT_DEG } from './flyTarget';
import { vec3ToLatLon } from './latLon';

const from = latLonToVec3(10, 20);
const land = (lat: number, lon: number) => vec3ToLatLon(flyDirection(latLonToVec3(lat, lon), from));

describe('where the globe camera flies to', () => {
  it('lands exactly on the latitude and longitude asked for, poleward of 80 degrees too', () => {
    // Measured before the fix (@assistant): 85 -> 84.9435, 88 -> 87.9708, 89.45 -> 89.4417.
    for (const lat of [0, 45, -80, 80.06, 85, -85, 88, -88, 89.45, -89.45, -89.686, 89.89]) {
      for (const lon of [-163.457, 0, 29.2, 136.7, 180]) {
        const p = land(lat, lon);
        expect(p.lat, `${lat}, ${lon}`).toBeCloseTo(lat, 9);
        expect(Math.abs(((p.lon - lon + 540) % 360) - 180), `${lat}, ${lon}`).toBeLessThan(1e-6);
      }
    }
  });

  it('stops 0.1 degree short of a pole, on the same meridian', () => {
    expect(land(89.95, 45)).toMatchObject({ lat: expect.closeTo(MAX_FLY_LAT_DEG, 9), lon: expect.closeTo(45, 6) });
    expect(land(-90, 29.2).lat).toBeCloseTo(-MAX_FLY_LAT_DEG, 9);
    expect(land(-89.999, -120)).toMatchObject({ lat: expect.closeTo(-MAX_FLY_LAT_DEG, 9), lon: expect.closeTo(-120, 6) });
  });

  it('on a pole itself keeps the meridian the camera is on', () => {
    const p = vec3ToLatLon(flyDirection(new Vector3(0, -1, 0), latLonToVec3(-60, 75)));
    expect(p.lat).toBeCloseTo(-MAX_FLY_LAT_DEG, 9);
    expect(p.lon).toBeCloseTo(75, 6);
    // And with the camera on the axis as well, some meridian rather than a broken vector.
    const q = flyDirection(new Vector3(0, 1, 0), new Vector3(0, 3, 0));
    expect(q.length()).toBeCloseTo(1, 12);
    expect(vec3ToLatLon(q).lat).toBeCloseTo(MAX_FLY_LAT_DEG, 9);
  });

  it('does not change the vector it is given', () => {
    const v = latLonToVec3(-89.99, 10);
    const copy = v.clone();
    flyDirection(v, from);
    expect(v.equals(copy)).toBe(true);
  });
});
