import { describe, expect, it } from 'vitest';
import { litFraction, NO_SHADOW, sampleField, SUN_RADIUS_RAD, sunOverSouthPole, sweepShadowHeight, type SweepGrid } from './polarShadow';

const N = 201, CELL = 100;
const flat = (): SweepGrid => ({ n: N, z: new Float32Array(N * N), cellM: CELL });
const at = (col: number, row: number) => row * N + col;
const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

/** True where the cell is in shadow (below the shadow height). */
const shaded = (g: SweepGrid, s: Float32Array, col: number, row: number) => g.z[at(col, row)] < s[at(col, row)];

describe('shadow sweep', () => {
  it('leaves flat ground lit when the light is above the horizon, and dark when it is below', () => {
    const g = flat();
    const day = sweepShadowHeight(g, 1, 0, tan(5), new Float32Array(N * N));
    expect(shaded(g, day, 100, 100)).toBe(false);
    expect(day[at(N - 1, 50)]).toBe(NO_SHADOW); // the border towards the light: nothing known beyond it
    const night = sweepShadowHeight(g, 1, 0, tan(-1), new Float32Array(N * N));
    expect(shaded(g, night, 100, 100)).toBe(true); // the ground itself is in the way
    expect(sweepShadowHeight(g, 0, 0, 1, new Float32Array(N * N))[0]).toBe(NO_SHADOW);
  });

  it('casts a shadow of length height / tan(elevation) behind a wall, in each of the four axis directions', () => {
    const H = 500, el = 5; // 5715 m of shadow = 57 cells
    const length = H / tan(el) / CELL;
    for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const g = flat();
      // A wall through the middle, across the light's direction.
      for (let k = 0; k < N; k++) g.z[ux !== 0 ? at(100, k) : at(k, 100)] = H;
      const s = sweepShadowHeight(g, ux, uy, tan(el), new Float32Array(N * N));
      // "Behind" the wall is away from the light: -x for light from +x, and +row for light from +y (rows grow towards -y).
      const cell = (d: number): [number, number] => (ux !== 0 ? [100 - ux * d, 77] : [77, 100 + uy * d]);
      expect(shaded(g, s, ...cell(10))).toBe(true);
      expect(shaded(g, s, ...cell(Math.floor(length) - 1))).toBe(true);
      expect(shaded(g, s, ...cell(Math.ceil(length) + 1))).toBe(false);
      expect(shaded(g, s, ...cell(-10))).toBe(false); // the sunward side
    }
  });

  it('follows an oblique direction: the shadow of a wall falls along the light, with the right length', () => {
    const H = 500, el = 5;
    const g = flat();
    for (let k = 0; k < N; k++) g.z[at(150, k)] = H; // a north-south wall at column 150
    // Light from the east-north-east: 30 degrees north of east.
    const ux = Math.cos(Math.PI / 6), uy = Math.sin(Math.PI / 6);
    const s = sweepShadowHeight(g, ux, uy, tan(el), new Float32Array(N * N));
    // Along the light's direction the shadow is H / tan(el) long; measured across the wall that is cos(30 deg) of it.
    const across = (H / tan(el) / CELL) * ux;
    expect(shaded(g, s, 150 - Math.floor(across) + 2, 100)).toBe(true);
    expect(shaded(g, s, 150 - Math.ceil(across) - 2, 100)).toBe(false);
    expect(shaded(g, s, 160, 100)).toBe(false);
  });

  it('lets a peak shade a strip no wider than itself, pointing away from the light', () => {
    const g = flat();
    for (let r = 95; r <= 105; r++) for (let c = 145; c <= 155; c++) g.z[at(c, r)] = 800;
    const s = sweepShadowHeight(g, 1, 0, tan(4), new Float32Array(N * N)); // light from +x
    expect(shaded(g, s, 100, 100)).toBe(true); // 4.5 km behind an 800 m block (shadow 11.4 km)
    expect(shaded(g, s, 100, 80)).toBe(false); // beside the strip
    expect(shaded(g, s, 100, 120)).toBe(false);
    expect(shaded(g, s, 20, 100)).toBe(false); // beyond the shadow's end
  });

  it('takes the shadow arriving at the border from a wider grid when one is given', () => {
    const g = flat();
    // Something 300 m tall stands just outside the eastern border: it reaches 300 / tan(3 deg) = 5.7 km into the grid.
    const s = sweepShadowHeight(g, 1, 0, tan(3), new Float32Array(N * N), () => 300);
    expect(s[at(N - 1, 60)]).toBe(300);
    expect(shaded(g, s, N - 1 - 40, 60)).toBe(true);
    expect(shaded(g, s, N - 1 - 70, 60)).toBe(false);
  });

  it('turns two shadow heights into the visible fraction of the Sun, with a penumbra between them', () => {
    const z = Float32Array.from([0, 100, 50, 75, 100, 0]);
    const low = Float32Array.from([NO_SHADOW, 50, 0, 50, 100, 10]);
    const high = Float32Array.from([NO_SHADOW, 60, 100, 100, 200, 20]);
    expect(Array.from(litFraction(z, low, high, new Uint8Array(6)))).toEqual([255, 255, 128, 128, 0, 0]);
  });

  it('gives a soft edge whose width grows with distance from the obstacle', () => {
    const g = flat();
    for (let k = 0; k < N; k++) g.z[at(180, k)] = 400;
    const el = (3 * Math.PI) / 180;
    const low = sweepShadowHeight(g, 1, 0, Math.tan(el + SUN_RADIUS_RAD), new Float32Array(N * N));
    const high = sweepShadowHeight(g, 1, 0, Math.tan(el - SUN_RADIUS_RAD), new Float32Array(N * N));
    const lit = litFraction(g.z, low, high, new Uint8Array(N * N));
    const row = Array.from({ length: 180 }, (_, c) => lit[at(c, 100)]);
    expect(row[170]).toBe(0); // close behind the wall: full shadow
    expect(row[20]).toBe(255); // far beyond the shadow
    // Shadow ends between 400/tan(3.27 deg) = 7.0 km and 400/tan(2.73 deg) = 8.4 km behind the wall: a 1.4 km penumbra.
    const partial = row.filter((v) => v > 0 && v < 255).length;
    expect(partial).toBeGreaterThanOrEqual(11);
    expect(partial).toBeLessThanOrEqual(16);
    for (let c = 96; c < 110; c++) expect(row[c]).toBeGreaterThanOrEqual(row[c + 1]); // brighter away from the wall
  });

  it('reads a field between cells', () => {
    const f = Float32Array.from([0, 10, 20, 30]);
    expect(sampleField(f, 2, 0.5, 0.5)).toBe(15);
    expect(sampleField(f, 2, 1, 0)).toBe(10);
    expect(sampleField(f, 2, 1.2, 0)).toBe(NO_SHADOW);
  });
});

describe('the Sun over the south pole', () => {
  it('maps Moon-fixed directions into the polar grid frame', () => {
    // Sun over 0N 90E, on the equator: towards +x of the south-polar map, on the horizon at the pole.
    const east = sunOverSouthPole([0, 1, 0]);
    expect([east.ux, east.uy]).toEqual([1, 0]);
    expect(east.elevationRad).toBeCloseTo(0, 12);
    // Sun over longitude 0: towards +y of the map.
    expect(sunOverSouthPole([1, 0, 0])).toMatchObject({ ux: 0, uy: 1 });
    // Southern summer: the sub-solar point 1.5 degrees south puts the Sun 1.5 degrees above the pole's horizon.
    const s = (1.5 * Math.PI) / 180;
    expect(sunOverSouthPole([Math.cos(s), 0, -Math.sin(s)]).elevationRad).toBeCloseTo(s, 12);
    expect(sunOverSouthPole([Math.cos(s), 0, Math.sin(s)]).elevationRad).toBeCloseTo(-s, 12);
  });
});
