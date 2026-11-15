import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { iceTargetLayer } from '../../core/siteScience';
import { IceOutlines } from './iceOutlines';

describe('ice target outlines', () => {
  it('draws every mapped region on the surface, south of 75S, and hides them from the far side', async () => {
    const layer = await iceTargetLayer();
    const outlines = new IceOutlines(layer);
    expect(outlines.count).toBe(layer.targets.length);
    expect(outlines.count).toBe(169);
    outlines.place(() => 1.001);
    let vertices = 0;
    outlines.root.traverse((o) => {
      const g = (o as unknown as { geometry?: { getAttribute(n: string): { array: Float32Array } } }).geometry;
      if (!g) return;
      const p = g.getAttribute('position').array;
      for (let k = 0; k < p.length; k += 3) {
        vertices++;
        expect(Math.hypot(p[k], p[k + 1], p[k + 2])).toBeCloseTo(1.0011, 4);
        expect(p[k + 1]).toBeLessThan(-0.96); // y = sin(latitude): everything is in the south polar region
      }
    });
    expect(vertices).toBeGreaterThan(1000);
    const camera = new PerspectiveCamera();
    camera.position.set(0, -3, 0); // over the south pole
    outlines.update(camera);
    expect(outlines.root.children.every((g) => g.visible)).toBe(true);
    camera.position.set(0, 3, 0); // over the north pole
    outlines.update(camera);
    expect(outlines.root.children.some((g) => g.visible)).toBe(false);
  });
});
