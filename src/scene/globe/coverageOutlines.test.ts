import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M } from '../../core/types';
import { coverageRegions } from '../../terrain/api';
import { surfaceDistanceM } from '../../terrain/geo';
import { CoverageOutlines, windowClasses } from './coverageOutlines';
import { COVERAGE_STYLE } from './overlayStyle';

describe('coverage outlines', () => {
  it('draws the terrain module\'s own list of site windows: 480 m and 60 m at every landing, 3 m where surveyed', async () => {
    const regions = await coverageRegions();
    const classes = windowClasses(regions, COVERAGE_STYLE.slice(3).map((c) => c.colour));
    expect(classes).toHaveLength(3);
    expect(classes.map((c) => c.sites.length)).toEqual([28, 28, classes[2].sites.length]);
    expect(classes[2].sites.length).toBeGreaterThan(10);
    expect(classes[2].sites.length).toBeLessThan(28);
    // Half-widths: 30.72 km, 3.84 km, and well under 2 km for the surveys.
    expect(classes[0].sites[0].halfWidthM).toBeCloseTo(30_720, 0);
    expect(classes[1].sites[0].halfWidthM).toBeCloseTo(3_840, 0);
    expect(classes[2].sites[0].halfWidthM).toBeLessThan(2_000);

    const outlines = new CoverageOutlines(classes);
    expect(outlines.count).toBe(28); // one group per site, however many squares it has

    // On a surface 2 % above the sphere: every vertex is at that radius, and the outer square's corner is where its half-width puts it.
    outlines.place(() => 1.02);
    const group = outlines.root.children[0];
    const fill = group.children[0] as unknown as { geometry: { getAttribute(n: string): { array: Float32Array } } };
    const p = fill.geometry.getAttribute('position').array;
    for (let k = 0; k < p.length; k += 3) expect(Math.hypot(p[k], p[k + 1], p[k + 2])).toBeCloseTo(1.0201, 4);
    const site = classes[0].sites[0];
    const toLatLon = (x: number, y: number, z: number) => ({ lat: (Math.asin(y / Math.hypot(x, y, z)) * 180) / Math.PI, lon: (Math.atan2(-z, x) * 180) / Math.PI });
    const corner = toLatLon(p[0], p[1], p[2]);
    expect(surfaceDistanceM(site.lat, site.lon, corner.lat, corner.lon)).toBeCloseTo(30_720 * Math.SQRT2, -2);
    expect(30_720 / MOON_RADIUS_M).toBeLessThan(0.02);

    // Seen from above the first site, its window shows and one on the other side of the Moon does not.
    const camera = new PerspectiveCamera();
    camera.position.set(p[40 * 3] * 3, p[40 * 3 + 1] * 3, p[40 * 3 + 2] * 3); // above the middle vertex of the 9 x 9 fill
    outlines.update(camera);
    expect(group.visible).toBe(true);
    expect(outlines.root.children.some((g) => !g.visible)).toBe(true);
  });
});
