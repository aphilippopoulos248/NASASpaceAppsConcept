/// <reference types="node" />
// Test-only helpers: synthetic height sources with known answers, and a minimal
// reader for the per-site grids in public/terrain/ (used until src/terrain's
// loaders land). Not imported by app code.
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

/** Square azimuthal-equidistant grid centred on (lat0, lon0), as written by scripts/fetch-terrain.mjs. */
export function localGridSource(name: string, lat0: number, lon0: number, n: number, spacingM: number, data: Float32Array): HeightSource {
  const c = (n - 1) / 2;
  const half = c * spacingM;
  const toGrid = (lat: number, lon: number) => {
    const { d, az } = distAz(lat0, lon0, lat, lon);
    return { x: (d * Math.sin(az * RAD)) / spacingM + c, y: (d * Math.cos(az * RAD)) / spacingM + c };
  };
  const covers = (lat: number, lon: number) => {
    const { x, y } = toGrid(lat, lon);
    return x >= 0 && y >= 0 && x <= n - 1 && y <= n - 1;
  };
  return {
    name,
    resolutionM: spacingM,
    descriptor: { kind: 'local', name, resolutionM: spacingM, lat0, lon0, n, spacingM, data },
    covers,
    sample(lat, lon) {
      const { x, y } = toGrid(lat, lon);
      if (!(x >= 0 && y >= 0 && x <= n - 1 && y <= n - 1)) return NaN;
      const i = Math.min(n - 2, Math.floor(x)), j = Math.min(n - 2, Math.floor(y));
      const fx = x - i, fy = y - j;
      const v = (ii: number, jj: number) => data[jj * n + ii];
      return (1 - fy) * ((1 - fx) * v(i, j) + fx * v(i + 1, j)) + fy * ((1 - fx) * v(i, j + 1) + fx * v(i + 1, j + 1));
    },
  };
  void half;
}

/** Reads public/terrain/<id>.bin (+ <id>_fine.bin) into a stack, finest first. Node only. */
export async function readSiteTerrain(id: string): Promise<TerrainStack & { lat: number; lon: number }> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(process.cwd(), 'public', 'terrain');
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));
  const landings = JSON.parse(await readFile(join(process.cwd(), 'public', 'data', 'landings.json'), 'utf8')).landings;
  const site = landings.find((l: { id: string }) => l.id === id);
  const meta = index.sites[id];
  const N = index.size as number;
  const buf = await readFile(join(dir, `${id}.bin`));
  const all = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const sources: HeightSource[] = [];
  if (meta.fine) {
    const fb = await readFile(join(dir, `${id}_fine.bin`));
    const fine = new Float32Array(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.length));
    sources.push(localGridSource(`LROC NAC DTM (site window, ${meta.fine.spacing} m grid)`, site.lat, site.lon, meta.fine.size, meta.fine.spacing, fine));
  }
  index.levels.forEach((lv: { name: string; spacing: number }, k: number) => {
    sources.push(localGridSource(`${meta.source} (${lv.name} site window, ${lv.spacing} m grid)`, site.lat, site.lon, N, lv.spacing, all.subarray(k * N * N, (k + 1) * N * N)));
  });
  return { sources, notes: [], lat: site.lat, lon: site.lon };
}
