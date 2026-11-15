import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M, type LatLon } from '../core/types';
import { destination } from './horizon';

const RAD = Math.PI / 180;
function vector(p: LatLon) {
  const lat = p.lat * RAD, lon = p.lon * RAD;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}
function chordM(a: LatLon, b: LatLon) {
  const u = vector(a), v = vector(b);
  return MOON_RADIUS_M * Math.hypot(...u.map((x, i) => x - v[i]));
}

describe('destination: circular radius searches', () => {
  it.each([
    { lat: -90, lon: 39.09 },
    { lat: 90, lon: 39.09 },
    { lat: -89.999999, lon: 39.09 },
    { lat: 89.999999, lon: -140.91 },
    { lat: -85, lon: 39.09 },
    { lat: 0, lon: 179.999 },
  ])('keeps a complete, evenly spaced circle around $lat, $lon', site => {
    for (const radiusM of [100, 600, 2000, 10000]) {
      const ring = Array.from({ length: 120 }, (_, i) => destination(site, i * 3, radiusM));
      const expectedRadiusChord = 2 * MOON_RADIUS_M * Math.sin(radiusM / MOON_RADIUS_M / 2);
      const expectedEdge = 2 * MOON_RADIUS_M * Math.sin(radiusM / MOON_RADIUS_M) * Math.sin(1.5 * RAD);
      expect(new Set(ring.map(p => `${p.lat.toFixed(10)},${p.lon.toFixed(10)}`)).size).toBe(120);
      ring.forEach((p, i) => {
        expect(p.lon).toBeGreaterThanOrEqual(-180);
        expect(p.lon).toBeLessThan(180);
        expect(chordM(site, p)).toBeCloseTo(expectedRadiusChord, 5);
        expect(chordM(p, ring[(i + 1) % ring.length])).toBeCloseTo(expectedEdge, 5);
      });
    }
  });

  it('keeps north and east aligned with the selected meridian at both poles', () => {
    expect(destination({ lat: -90, lon: 39.09 }, 0, 2000).lon).toBeCloseTo(39.09, 8);
    expect(destination({ lat: -90, lon: 39.09 }, 90, 2000).lon).toBeCloseTo(129.09, 8);
    expect(destination({ lat: 90, lon: 39.09 }, 0, 2000).lon).toBeCloseTo(-140.91, 8);
    expect(destination({ lat: 90, lon: 39.09 }, 90, 2000).lon).toBeCloseTo(129.09, 8);
  });
});
