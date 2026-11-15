import { describe, expect, it } from 'vitest';
import { createField, litAt, NO_CEILING, sweepSunlight, type SweepField } from './shadowSweep';

const SUN_R = 0.266;

/** Field with heights from a function of (east, north). */
function field(n: number, spacing: number, h: (e: number, nn: number) => number, east0 = 0, north0 = 0): SweepField {
  const f = createField(n, spacing, east0, north0);
  const c = (n - 1) / 2;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) f.y[j * n + i] = h(east0 + (i - c) * spacing, north0 + (j - c) * spacing);
  return f;
}
const lit = (f: SweepField, e: number, nn: number) => litAt(f, e, nn);

describe('sweepSunlight', () => {
  it('lights flat ground whenever the Sun is up', () => {
    const f = field(65, 10, () => 0);
    for (const az of [0, 37, 90, 135, 222, 301]) {
      sweepSunlight(f, az, 5, SUN_R, null);
      expect(Math.min(...f.lit)).toBe(255);
    }
  });

  it('casts a wall shadow of length height / tan(elevation), in any direction', () => {
    const H = 50, el = 10, len = H / Math.tan((el * Math.PI) / 180); // 283.6 m
    for (const az of [90, 270, 0, 180, 45, 63, 118, 200, 333]) {
      const a = (az * Math.PI) / 180, sx = Math.sin(a), sy = Math.cos(a);
      // A long wall through the origin, perpendicular to the Sun's azimuth, 12 m thick.
      const f = field(257, 4, (e, nn) => (Math.abs(e * sx + nn * sy) <= 6 ? H : 0));
      sweepSunlight(f, az, el, SUN_R, null);
      const at = (dist: number) => lit(f, -sx * dist, -sy * dist); // dist metres down-Sun of the wall's centre
      expect(at(len * 0.5), `az ${az} mid-shadow`).toBeLessThan(0.02);
      expect(at(len - 30), `az ${az} near the tip`).toBeLessThan(0.1);
      expect(at(len + 40), `az ${az} past the tip`).toBeGreaterThan(0.9);
      expect(lit(f, sx * 100, sy * 100), `az ${az} sunward side`).toBe(1);
    }
  });

  it('gives a penumbra as wide as the Sun looks from the shadow edge', () => {
    const H = 100, el = 5, d2r = Math.PI / 180;
    const f = field(513, 8, (e) => (Math.abs(e) <= 8 ? H : 0));
    sweepSunlight(f, 90, el, SUN_R, null); // Sun in the east: the shadow falls to the west
    // The wall's top edge is its west face (e = -8): lower limb clears at H / tan(el - r), upper limb at H / tan(el + r).
    const full = 8 + H / Math.tan((el - SUN_R) * d2r), none = 8 + H / Math.tan((el + SUN_R) * d2r);
    expect(full - none).toBeGreaterThan(110); // a 122 m wide penumbra 1.1 km from the wall
    expect(full).toBeLessThan(1900); // all of it inside the grid
    expect(lit(f, -(none - 40), 0)).toBeLessThan(0.03);
    expect(lit(f, -(full + 40), 0)).toBeGreaterThan(0.97);
    const mid = lit(f, -(none + full) / 2, 0);
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.65);
  });

  it('shades slopes that face away from the Sun more steeply than it stands', () => {
    // A ridge with 20-degree flanks, Sun at 10 degrees in the east: the west flank is in shadow, the east one lit.
    const slope = Math.tan((20 * Math.PI) / 180);
    const f = field(129, 5, (e) => Math.max(0, 60 - Math.abs(e) * slope));
    sweepSunlight(f, 90, 10, SUN_R, null);
    expect(lit(f, 80, 0)).toBe(1);
    expect(lit(f, -80, 0)).toBe(0);
  });

  it('passes shadows from a coarse grid into the finer grid inside it', () => {
    // A 400 m ridge 3 km east of the site exists only in the coarse grid; the fine grid is flat.
    const coarse = field(129, 100, (e) => (Math.abs(e - 3000) <= 100 ? 400 : 0));
    const fine = field(129, 10, () => 0);
    const d2r = Math.PI / 180;
    const tip = (el: number) => 3000 - 100 - 400 / Math.tan(el * d2r); // where the shadow of a point Sun ends, east coordinate
    // Sun at 6 degrees: the shadow reaches 3.8 km west of the ridge, across the whole fine grid.
    sweepSunlight(coarse, 90, 6, SUN_R, null);
    sweepSunlight(fine, 90, 6, SUN_R, coarse);
    expect(tip(6)).toBeLessThan(-640);
    expect(Math.max(...fine.lit)).toBe(0);
    // Sun at 9 degrees: the tip falls inside the fine grid, with a penumbra 152 m long on the
    // ground (the Sun's 0.53 degrees seen from 2.5 km away, stretched by the low angle).
    sweepSunlight(coarse, 90, 9, SUN_R, null);
    sweepSunlight(fine, 90, 9, SUN_R, coarse);
    const dark = tip(9 + SUN_R), bright = tip(9 - SUN_R); // 448 m and 296 m east of the site
    expect(dark - bright).toBeGreaterThan(140);
    expect(lit(fine, dark + 30, 0)).toBeLessThan(0.02);
    expect(lit(fine, bright - 30, 0)).toBeGreaterThan(0.98);
    const mid = lit(fine, tip(9), 0);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    // The coarse grid gives the same answer where both exist.
    expect(lit(coarse, bright - 100, 0)).toBe(1);
    // With the Sun on the other side the ridge casts nothing here.
    sweepSunlight(coarse, 270, 9, SUN_R, null);
    sweepSunlight(fine, 270, 9, SUN_R, coarse);
    expect(Math.min(...fine.lit)).toBe(255);
  });

  it('uses the smooth Moon beyond the grid: night when the Sun is under the horizon, peaks lit last', () => {
    const R = 1_737_400;
    // Curved ground (the sphere itself) with one 300 m conical hill at the site.
    const ground = (e: number, nn: number) => -(e * e + nn * nn) / (2 * R) + 300 * Math.max(0, 1 - Math.hypot(e, nn) / 1500);
    const f = field(129, 500, ground);
    const limb = { radius: R, height0: 0 };
    sweepSunlight(f, 90, 2, SUN_R, null, limb);
    expect(lit(f, -20000, 0)).toBe(1); // day on the plain
    // Sun 0.6 degrees under the site's horizontal: the plain is dark, but a 300 m hill still sees it
    // (the horizon dips sqrt(2 * 300 / R) = 1.06 degrees for that height).
    sweepSunlight(f, 90, -0.6, SUN_R, null, limb);
    expect(lit(f, -10000, 5000)).toBe(0);
    expect(lit(f, 0, 0)).toBe(1);
    // Far enough towards the Sun the ground is still in daylight: 25 km east the Sun stands 0.82 degrees higher.
    expect(lit(f, 25000, 9000)).toBeGreaterThan(0.5);
    // Sun 2 degrees under: night everywhere, hill included.
    sweepSunlight(f, 90, -2, SUN_R, null, limb);
    expect(Math.max(...f.lit)).toBe(0);
    // Without a limb the coarsest grid knows of nothing beyond its edge.
    sweepSunlight(f, 90, 2, SUN_R, null);
    expect(f.ceilLow[64 * 129 + 128]).toBe(NO_CEILING);
  });

  it('reports full light outside a field', () => {
    const f = field(9, 10, () => 0);
    sweepSunlight(f, 90, 10, SUN_R, null);
    expect(litAt(f, 1e6, 0)).toBe(1);
  });
});
