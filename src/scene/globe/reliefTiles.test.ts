import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M } from '../../core/types';
import {
  buildTileArrays, childTiles, dirOf, distanceToTile, effectiveRelief, maxLevelFor, rootTiles, SEGMENTS, selectTiles, tileBounds, tileCap, tileFacesCamera,
  tileKey, tilePpd, tileWantsSplit, type LodView, type TileId,
} from './reliefTiles';

const view = (cam: [number, number, number], over: Partial<LodView> = {}): LodView => ({ cam, pxPerRad: 720 / ((40 * Math.PI) / 180), cellPx: 8, maxLevel: 5, maxDisplacement: 0, ...over });

/** Solid angle of a tile, steradians. */
const area = (t: TileId) => {
  const b = tileBounds(t);
  return ((b.lonE - b.lonW) * Math.PI) / 180 * (Math.sin((b.latN * Math.PI) / 180) - Math.sin((b.latS * Math.PI) / 180));
};

describe('tile layout', () => {
  it('covers the Moon with 8 x 4 root tiles and quarters each tile into its children', () => {
    const roots = rootTiles();
    expect(roots).toHaveLength(32);
    expect(roots.reduce((s, t) => s + area(t), 0)).toBeCloseTo(4 * Math.PI, 9);
    expect(tileBounds({ level: 0, x: 0, y: 0 })).toEqual({ latN: 90, latS: 45, lonW: -180, lonE: -135 });
    expect(tileBounds({ level: 0, x: 7, y: 3 })).toEqual({ latN: -45, latS: -90, lonW: 135, lonE: 180 });
    const t = { level: 2, x: 17, y: 5 };
    const kids = childTiles(t);
    expect(kids.map(tileKey)).toEqual(['3/34/10', '3/35/10', '3/34/11', '3/35/11']);
    expect(kids.reduce((s, k) => s + area(k), 0)).toBeCloseTo(area(t), 12);
    expect(tileBounds(kids[3])).toMatchObject({ latS: tileBounds(t).latS, lonE: tileBounds(t).lonE });
  });

  it('asks the height data for one sample per cell and stops one level past the data', () => {
    expect(tilePpd(0)).toBeCloseTo(SEGMENTS / 45, 9);
    expect(tilePpd(5)).toBeCloseTo(22.76, 2);
    expect(maxLevelFor(4)).toBe(3); // level 3 cells are 0.18 deg, the 0.25 deg data
    expect(maxLevelFor(16)).toBe(5); // 0.044 deg cells for 0.0625 deg data
    expect(maxLevelFor(0)).toBe(2); // no data yet: a smooth sphere needs no more
  });
});

describe('tile geometry', () => {
  const tile = { level: 1, x: 9, y: 3 }; // 22.5..45E, 22.5N..0
  const height = (lat: number, lon: number) => 1000 + 10 * lat + lon;
  const a = buildTileArrays(tile, height);
  const n = SEGMENTS + 1;

  it('puts every vertex on the unit sphere at its latitude and longitude, with matching texture coordinates and height', () => {
    expect(a.position.length).toBe((n * n + 4 * n) * 3);
    for (const [r, c] of [[0, 0], [0, SEGMENTS], [SEGMENTS, 0], [16, 16], [SEGMENTS, SEGMENTS]]) {
      const i = r * n + c;
      const lat = 22.5 - (22.5 * r) / SEGMENTS, lon = 22.5 + (22.5 * c) / SEGMENTS;
      const d = dirOf(lat, lon) as number[];
      for (let k = 0; k < 3; k++) expect(a.position[i * 3 + k]).toBeCloseTo(d[k], 6);
      expect(Math.hypot(a.position[i * 3], a.position[i * 3 + 1], a.position[i * 3 + 2])).toBeCloseTo(1, 6);
      expect(a.uv[i * 2]).toBeCloseTo((lon + 180) / 360, 6);
      expect(a.uv[i * 2 + 1]).toBeCloseTo((lat + 90) / 180, 6);
      expect(a.height[i] * MOON_RADIUS_M).toBeCloseTo(height(lat, lon), 1);
      expect(a.skirt[i]).toBe(0);
    }
    // 0N 0E is +X, the north pole +Y, 90E is -Z.
    expect(dirOf(0, 0)).toEqual([1, 0, -0]);
    expect((dirOf(90, 0) as number[])[1]).toBe(1);
    expect((dirOf(0, 90) as number[])[2]).toBeCloseTo(-1, 12);
  });

  it('winds surface triangles counter-clockwise seen from outside', () => {
    for (let k = 0; k < SEGMENTS * SEGMENTS * 6; k += 3) {
      const p = [0, 1, 2].map((j) => Array.from(a.position.subarray(a.index[k + j] * 3, a.index[k + j] * 3 + 3)));
      const u = p[1].map((v, j) => v - p[0][j]), w = p[2].map((v, j) => v - p[0][j]);
      const normal = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      expect(normal[0] * p[0][0] + normal[1] * p[0][1] + normal[2] * p[0][2]).toBeGreaterThan(0);
    }
  });

  it('hangs a skirt from every border vertex', () => {
    const surface = n * n;
    const skirtCount = Array.from(a.skirt).filter((v) => v > 0).length;
    expect(skirtCount).toBe(4 * n);
    expect(a.skirt[surface]).toBeGreaterThan(0.005); // 22.5 deg tile: about 1 % of the radius
    expect(a.skirt[surface]).toBeLessThanOrEqual(0.05);
    // A skirt vertex is its border vertex again: same place, same height, same texture coordinate.
    expect(Array.from(a.position.subarray(surface * 3, surface * 3 + 3))).toEqual(Array.from(a.position.subarray(0, 3)));
    expect(a.height[surface + n]).toBe(a.height[SEGMENTS * n]);
    expect(Math.max(...a.index)).toBe(surface + 4 * n - 1);
  });
});

describe('choosing tiles', () => {
  const nearSide: [number, number, number] = [3.4, 0, 0];

  it('hides tiles behind the limb, with room for exaggerated mountains', () => {
    const far = { level: 0, x: 0, y: 1 }; // 180W..135W, on the far side
    expect(tileFacesCamera(far, view(nearSide))).toBe(false);
    expect(tileFacesCamera({ level: 0, x: 4, y: 1 }, view(nearSide))).toBe(true);
    // The limb is 72.9 deg from the sub-camera point at 3.4 radii. A tile starting 80 deg away is hidden...
    const beyond = { level: 2, x: 23, y: 7 }; // 78.75..90E on the equator
    expect(tileCap(beyond).radius).toBeLessThan(0.14);
    expect(tileFacesCamera(beyond, view(nearSide))).toBe(false);
    // ...unless relief is drawn tall enough to stand above the limb (6 % of the radius reaches 19 deg further).
    expect(tileFacesCamera(beyond, view(nearSide, { maxDisplacement: 0.06 }))).toBe(true);
  });

  it('measures distance to the nearest point of a tile', () => {
    expect(distanceToTile({ level: 0, x: 4, y: 1 }, nearSide)).toBeCloseTo(2.4, 9); // 0..45E, 45N..0 touches the sub-camera point
    expect(distanceToTile({ level: 0, x: 3, y: 2 }, nearSide)).toBeCloseTo(2.4, 9);
    const d = distanceToTile({ level: 0, x: 5, y: 1 }, nearSide); // nearest point 0N 45E
    expect(d).toBeCloseTo(Math.hypot(3.4 - Math.SQRT1_2, Math.SQRT1_2), 9);
  });

  it('splits until a cell is small enough on screen, never past the deepest level', () => {
    const root = { level: 0, x: 4, y: 1 };
    expect(tileWantsSplit(root, view(nearSide))).toBe(true); // 10.5 px cells from the whole-Moon view
    expect(tileWantsSplit({ level: 1, x: 8, y: 3 }, view(nearSide))).toBe(false); // 5.3 px
    expect(tileWantsSplit(root, view(nearSide, { maxLevel: 0 }))).toBe(false);
    // 42 km above the surface every level wants more detail, down to the deepest.
    const low: [number, number, number] = [1 + 42 / 1737.4, 0, 0];
    expect(tileWantsSplit({ level: 4, x: 64, y: 31 }, view(low))).toBe(true);
    expect(tileWantsSplit({ level: 5, x: 128, y: 63 }, view(low))).toBe(false);
  });

  it('covers what faces the camera exactly once, and falls back to a parent while its children are not ready', () => {
    const all = selectTiles(view(nearSide), () => true);
    const keys = new Set(all.map(tileKey));
    expect(keys.size).toBe(all.length);
    // No tile is drawn together with one of its ancestors.
    for (const t of all) {
      for (let l = t.level - 1, x = t.x >> 1, y = t.y >> 1; l >= 0; l--, x >>= 1, y >>= 1) expect(keys.has(`${l}/${x}/${y}`)).toBe(false);
    }
    expect(Math.max(...all.map((t) => t.level))).toBe(1);
    // Everything within 60 degrees of the sub-camera point is covered: the areas add up to at least that cap.
    const covered = all.reduce((s, t) => s + area(t), 0);
    expect(covered).toBeGreaterThan(2 * Math.PI * (1 - Math.cos((72 * Math.PI) / 180)));
    expect(covered).toBeLessThan(4 * Math.PI * 0.75);

    // Only root tiles are ready: the roots stand in, and nothing is missing.
    const rootsOnly = selectTiles(view(nearSide), (t) => t.level === 0);
    expect(rootsOnly.every((t) => t.level === 0)).toBe(true);
    expect(rootsOnly.reduce((s, t) => s + area(t), 0)).toBeGreaterThanOrEqual(covered - 1e-9);

    // A child that is not ready keeps its parent on screen instead of its three siblings.
    const missing = '1/8/3';
    const partial = selectTiles(view(nearSide), (t) => tileKey(t) !== missing);
    expect(partial.map(tileKey)).toContain('0/4/1');
    expect(partial.map(tileKey)).not.toContain('1/9/3');
    expect(partial.reduce((s, t) => s + area(t), 0)).toBeGreaterThanOrEqual(covered - 1e-9);

    // The caller can hide tiles outside its view (frustum): they are simply left out.
    expect(selectTiles(view(nearSide), () => true, (t) => t.y < 2 << t.level).every((t) => tileBounds(t).latS >= 0)).toBe(true);
  });

  it('keeps the tile count modest from orbit and close to the ground', () => {
    expect(selectTiles(view(nearSide), () => true).length).toBeLessThan(120);
    // 42 km up, looking straight down: what the view cone holds (the caller's frustum test) is a handful of fine tiles.
    const low: [number, number, number] = [1 + 42 / 1737.4, 0, 0];
    const inCone = (t: TileId) => {
      const { centre, radius } = tileCap(t);
      return Math.acos(Math.min(1, centre[0])) - radius < (3 * Math.PI) / 180;
    };
    const close = selectTiles(view(low), () => true, inCone);
    expect(close.length).toBeLessThan(60);
    expect(Math.max(...close.map((t) => t.level))).toBe(5);
    // Without that test every tile out to the horizon is listed: still bounded.
    expect(selectTiles(view(low), () => true).length).toBeLessThan(400);
  });
});

describe('relief scale', () => {
  it('is never more than true scale', () => {
    expect(effectiveRelief(10)).toBe(1);
    expect(effectiveRelief(1.01)).toBe(1);
    expect(effectiveRelief(1)).toBe(1);
    expect(effectiveRelief(0.5)).toBe(0.5);
    expect(effectiveRelief(0)).toBe(0);
    expect(effectiveRelief(-3)).toBe(0);
  });
});
