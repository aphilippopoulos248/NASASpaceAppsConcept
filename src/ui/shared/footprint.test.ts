import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_KM } from '../../core/types';
import { globeFovDeg, toLatLon, toVec, viewFootprint } from './footprint';

describe('view footprint', () => {
  it('round-trips lat/lon through scene vectors (east-positive)', () => {
    for (const [lat, lon] of [[0, 0], [10, 90], [-45, -120], [60, 179]]) {
      const r = toLatLon(toVec(lat, lon));
      expect(r.lat).toBeCloseTo(lat, 9);
      expect(r.lon).toBeCloseTo(lon, 9);
    }
  });

  it('from far away the outline is the limb: 90° minus the horizon dip from the centre', () => {
    const alt = 2.4 * MOON_RADIUS_KM;
    const pts = viewFootprint({ lat: 0, lon: 0, altitudeKm: alt }, 16 / 9, 40);
    const D = 1 + alt / MOON_RADIUS_KM;
    const limb = (Math.acos(1 / D) * 180) / Math.PI;
    for (const p of pts) {
      const ang = (Math.acos(Math.cos((p.lat * Math.PI) / 180) * Math.cos((p.lon * Math.PI) / 180)) * 180) / Math.PI;
      expect(ang).toBeLessThanOrEqual(limb + 1e-6);
    }
    expect(Math.max(...pts.map((p) => Math.abs(p.lon)))).toBeCloseTo(limb, 6);
  });

  it('close up, the outline is a small box around the centre', () => {
    const pts = viewFootprint({ lat: 0.674, lon: 23.473, altitudeKm: 41.7 }, 16 / 9, 40);
    // Half-height on the ground is about altitude * tan(20°) = 15 km = 0.5° of latitude.
    const lats = pts.map((p) => p.lat), lons = pts.map((p) => p.lon);
    expect(Math.max(...lats) - 0.674).toBeCloseTo(0.5, 1);
    expect(Math.max(...lons) - 23.473).toBeGreaterThan(Math.max(...lats) - 0.674);
  });

  it('widens the field of view on portrait screens', () => {
    expect(globeFovDeg(1280, 720)).toBe(40);
    expect(globeFovDeg(390, 844)).toBeCloseTo(64, 5);
  });
});
