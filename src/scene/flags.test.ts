import { describe, expect, it } from 'vitest';
import { chinaStars, usStarField } from './flags';

describe('the flags drawn on the globe and in the site card', () => {
  it('United States: 50 stars in nine rows alternating six and five (Executive Order 10834)', () => {
    // The union of a 192 x 128 cloth texture, as drawn: 0.4 of the fly wide, 7/13 of the hoist high.
    const cw = 192 * 0.4, ch = (128 * 7) / 13;
    const { centres, radius } = usStarField(cw, ch);
    expect(centres).toHaveLength(50);
    const rows = new Map<number, number[]>();
    for (const [x, y] of centres) rows.set(Math.round(y * 1000), [...(rows.get(Math.round(y * 1000)) ?? []), x]);
    expect([...rows.values()].map((r) => r.length)).toEqual([6, 5, 6, 5, 6, 5, 6, 5, 6]);
    // Rows of five sit between the stars of the rows of six.
    const [six, five] = [...rows.values()];
    for (let i = 0; i < 5; i++) {
      expect(five[i]).toBeGreaterThan(six[i]);
      expect(five[i]).toBeLessThan(six[i + 1]);
    }
    // Every star inside the union with a margin, and no two touching.
    for (const [x, y] of centres) {
      expect(x - radius).toBeGreaterThan(0);
      expect(x + radius).toBeLessThan(cw);
      expect(y - radius).toBeGreaterThan(0);
      expect(y + radius).toBeLessThan(ch);
    }
    let closest = Infinity;
    for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) closest = Math.min(closest, Math.hypot(centres[i][0] - centres[j][0], centres[i][1] - centres[j][1]));
    expect(closest).toBeGreaterThan(2 * radius);
    // The order's figures, in units of the hoist (here the union height is 0.5385 of it).
    const hoist = ch / 0.5385;
    expect(radius * 2).toBeCloseTo(0.0616 * hoist, 9);
    expect(centres[0][1]).toBeCloseTo(0.054 * hoist, 9);
    expect(centres[49][1]).toBeCloseTo(0.486 * hoist, 9);
  });

  it('China: the large star at (5, 5) of the 30 x 20 grid, the small ones each pointing at its centre', () => {
    const [big, ...small] = chinaStars(192, 128);
    // On a 192 x 128 canvas one grid unit is 6.4 px.
    const grid = (s: { x: number; y: number; r: number }) => [s.x / 6.4, s.y / 6.4, s.r / 6.4].map((n) => Math.round(n * 1e9) / 1e9);
    expect(grid(big)).toEqual([5, 5, 3]);
    expect(big.rotation).toBe(-Math.PI / 2); // one point straight up
    expect(small.map(grid)).toEqual([
      [10, 2, 1],
      [12, 4, 1],
      [12, 7, 1],
      [10, 9, 1],
    ]);
    for (const s of small) {
      // One point of each small star lies on the line to the large star's centre.
      const tipX = s.x + Math.cos(s.rotation) * s.r, tipY = s.y + Math.sin(s.rotation) * s.r;
      const cross = (tipX - s.x) * (big.y - s.y) - (tipY - s.y) * (big.x - s.x);
      expect(Math.abs(cross)).toBeLessThan(1e-9);
      expect(Math.hypot(big.x - tipX, big.y - tipY)).toBeLessThan(Math.hypot(big.x - s.x, big.y - s.y));
    }
  });
});
