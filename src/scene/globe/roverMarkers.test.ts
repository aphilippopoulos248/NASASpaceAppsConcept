/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Object3D, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { latLonToVec3, type Landing } from '../../data/landings';
import { parseRovers, roverStateAt } from '../../data/rovers';
import { offsetLatLon } from '../surface/ground';

// Labels draw their text on a canvas, which the test environment does not have.
vi.mock('../surface/skyPaths', () => ({
  Label: class {
    sprite = new Object3D();
    at = new Vector3();
    place(_c: unknown, p: Vector3) {
      this.at.copy(p);
    }
    dispose() {}
  },
}));
const { RoverMarkers, circuitsReadable } = await import('./roverMarkers');

const read = (path: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', path), 'utf8'));
const landings = (read('data/landings.json') as { landings: Landing[] }).landings;
const file = parseRovers(read('data/rovers.json'));
const MOON_RADIUS_M = 1_737_400;

type Site = { landing: Landing; frame: Object3D; ring: Object3D; detail: Object3D; rovers: { track: Parameters<typeof roverStateAt>[0]; symbol: Object3D; label: { at: Vector3; sprite: Object3D } }[]; ringLabel: { sprite: Object3D }; badge: Object3D };
function setUp(siteId: string, altitudeKm: number) {
  const markers = new RoverMarkers(file, landings);
  const site = (markers as unknown as { sites: Site[] }).sites.find((s) => s.landing.id === siteId)!;
  const camera = new PerspectiveCamera();
  camera.position.copy(latLonToVec3(site.landing.lat, site.landing.lon)).multiplyScalar(1 + (altitudeKm * 1000) / MOON_RADIUS_M);
  return { markers, site, camera };
}

describe('rover markers on the globe (simulated)', () => {
  it('cover the landings that have rovers, and no others', () => {
    const { markers } = setUp('im-2', 100);
    expect(markers.siteIds.sort()).toEqual([...new Set(file.rovers.map((r) => r.siteId))].sort());
  });

  it('draw circuits only once they are wide enough on screen to read', () => {
    expect(circuitsReadable(180, 2_000_000)).toBe(false);
    expect(circuitsReadable(180, 7000)).toBe(true);
    expect(circuitsReadable(40, 10_000)).toBe(false);
  });

  it('show a ring round the landing from far away, and each rover on its circuit close up', () => {
    const far = setUp('im-2', 2000);
    far.markers.update(far.camera, 0, 800);
    expect(far.site.ring.visible).toBe(true);
    expect(far.site.detail.visible).toBe(false);
    expect(far.site.rovers.every((r) => !r.label.sprite.visible)).toBe(true);
    expect(far.site.ringLabel.sprite.visible).toBe(false);
    // The rover badge marks the site from any altitude, a constant size on screen.
    expect(far.site.badge.visible).toBe(true);
    expect(far.site.badge.scale.y).toBeCloseTo((24 * 2 * Math.tan((far.camera.fov * Math.PI) / 360)) / 800, 9);
    // Lower, the ring is named. A site whose circuits stay close to the lander keeps the ring down to the lowest the camera goes.
    const mid = setUp('im-2', 200);
    mid.markers.update(mid.camera, 0, 800);
    expect([mid.site.ring.visible, mid.site.ringLabel.sprite.visible]).toEqual([true, true]);
    const small = setUp('slim', 10.5);
    small.markers.update(small.camera, 0, 800);
    expect([small.site.ring.visible, small.site.ringLabel.sprite.visible, small.site.detail.visible]).toEqual([true, true, false]);

    const near = setUp('im-2', 12);
    const now = Date.UTC(2026, 10, 15, 12);
    near.markers.update(near.camera, now, 800);
    expect(near.site.ring.visible).toBe(false);
    expect(near.site.detail.visible).toBe(true);
    expect(near.site.ringLabel.sprite.visible).toBe(false);
    expect(near.site.badge.visible).toBe(false);
    // The symbol stands at the rover's true position: the same point as the track's offset laid out by lat/lon.
    near.site.frame.updateMatrixWorld(true);
    for (const r of near.site.rovers) {
      const s = roverStateAt(r.track, now);
      const p = offsetLatLon(near.site.landing.lat, near.site.landing.lon, s.eastM, s.northM);
      const world = r.symbol.getWorldPosition(new Vector3()).normalize();
      expect(world.distanceTo(latLonToVec3(p.lat, p.lon)) * MOON_RADIUS_M).toBeLessThan(0.5);
      expect(r.label.at.distanceTo(r.symbol.getWorldPosition(new Vector3()))).toBeLessThan(1e-9);
    }
  });

  it('hide with their landing: filtered out, or behind the Moon', () => {
    const { markers, site, camera } = setUp('im-2', 4);
    markers.setFilter((l) => l.id !== 'im-2');
    markers.update(camera, 0, 800);
    expect(site.frame.visible).toBe(false);
    markers.setFilter(() => true);
    camera.position.negate();
    markers.update(camera, 0, 800);
    expect(site.frame.visible).toBe(false);
    expect(site.rovers.every((r) => !r.label.sprite.visible)).toBe(true);
  });
});
