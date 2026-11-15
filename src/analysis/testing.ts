// Test-only helpers: synthetic height sources with known answers. Real terrain in tests
// comes from the terrain module's own loader (loadTerrainFor). Not imported by app code.
import type { HeightGridDescriptor, HeightSource, TerrainStack } from '../terrain/types';
import { MOON_RADIUS_M } from '../core/types';

const R = MOON_RADIUS_M;
const RAD = Math.PI / 180;

/** Great-circle distance (m) and initial azimuth (deg) from a to b. */
export function distAz(lat0: number, lon0: number, lat: number, lon: number): { d: number; az: number } {
  const p1 = lat0 * RAD, p2 = lat * RAD, dl = (lon - lon0) * RAD;
  const c = Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
  const d = Math.acos(Math.max(-1, Math.min(1, c))) * R;
  const az = Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD;
  return { d, az };
}

const dummyDescriptor = (name: string, resolutionM: number): HeightGridDescriptor => ({
  kind: 'local', name, resolutionM, lat0: 0, lon0: 0, n: 1, spacingM: resolutionM, data: new Float32Array(1),
});

/** Whole-Moon analytic source: height as a function of (lat, lon). */
export function fnSource(name: string, resolutionM: number, f: (lat: number, lon: number) => number, covers: (lat: number, lon: number) => boolean = () => true): HeightSource {
  return { name, resolutionM, descriptor: dummyDescriptor(name, resolutionM), covers, sample: (lat, lon) => (covers(lat, lon) ? f(lat, lon) : NaN) };
}

/** Height defined by distance (m) and azimuth (deg) from a centre point. */
export function radialSource(name: string, resolutionM: number, lat0: number, lon0: number, f: (d: number, az: number) => number): HeightSource {
  return fnSource(name, resolutionM, (lat, lon) => {
    const { d, az } = distAz(lat0, lon0, lat, lon);
    return f(d, az);
  });
}

export const stackOf = (...sources: HeightSource[]): TerrainStack => ({ sources, notes: [] });
