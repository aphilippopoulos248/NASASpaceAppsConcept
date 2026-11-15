import { describe, expect, it } from 'vitest';
import { wrapLon, type LatLon } from '../../core/types';
import { surfaceDistanceM } from '../../terrain/geo';
import { observerLocation, surfaceMapWindow } from './locatorPosition';

const site = { lat: 26.132, lon: 3.633 };
const pixel = (at: LatLon, window: ReturnType<typeof surfaceMapWindow>) => ({
  x: (wrapLon(at.lon - (window.west + window.w / 2)) + window.w / 2) / window.w * 200,
  y: (window.north - at.lat) / window.h * 100,
});

describe('surface locator position', () => {
  it('tracks east and north walking offsets without changing the landing site', () => {
    const origin = observerLocation(site, { eastM: 0, northM: 0 });
    const east = observerLocation(site, { eastM: 100, northM: 0 });
    const north = observerLocation(site, { eastM: 0, northM: 100 });
    expect(origin).toEqual(site);
    expect(surfaceDistanceM(site.lat, site.lon, east.lat, east.lon)).toBeCloseTo(100, 5);
    expect(surfaceDistanceM(site.lat, site.lon, north.lat, north.lon)).toBeCloseTo(100, 5);
    const window = surfaceMapWindow(site, origin, 4);
    expect(pixel(east, window).x - pixel(origin, window).x).toBeGreaterThan(19);
    expect(pixel(north, window).y - pixel(origin, window).y).toBeLessThan(-19);
    expect(site).toEqual({ lat: 26.132, lon: 3.633 });
  });

  it.each([
    { lat: 0, lon: 179.999 }, { lat: -89.999, lon: -179.9 }, { lat: 90, lon: 0 },
  ])('keeps a distant walker visible near poles and the date line: %j', (anchor) => {
    for (const [eastM, northM] of [[12000, 0], [-12000, -12000], [0, 12000]]) {
      const at = observerLocation(anchor, { eastM, northM });
      const window = surfaceMapWindow(anchor, at, 4);
      const p = pixel(at, window);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(200);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
      expect(window.north).toBeLessThanOrEqual(90);
      expect(window.north - window.h).toBeGreaterThanOrEqual(-90);
    }
  });
});
