import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { buildTrack, roverStateAt, type Rover } from '../../data/rovers';
import { offsetLatLon, type Ground } from './ground';

// Labels draw their text on a canvas, which the test environment does not have.
vi.mock('./skyPaths', () => ({
  Label: class {
    sprite = { visible: true, layers: { enable() {} }, position: new Vector3(), removeFromParent() {}, parent: null, isObject3D: true, dispatchEvent() {} };
    variant = -1;
    place(_c: unknown, p: Vector3, variant: number) {
      this.sprite.position.copy(p);
      this.variant = variant;
    }
    dispose() {}
  },
}));
const { SurfaceRovers, roverLengthM } = await import('./rovers');

const SITE = { lat: 20, lon: 30 };
/** A square circuit 20 m on a side, north-east of the site, driven clockwise from its south-west corner. */
function rover(): Rover {
  const corner = (e: number, n: number) => offsetLatLon(SITE.lat, SITE.lon, e, n);
  const path = [{ ...corner(10, 10), stopS: 60, activity: 'Panorama' }, corner(10, 30), corner(30, 30), corner(30, 10)];
  return { id: 'test', name: 'Test', simulated: true, siteId: 'x', country: 'USA', operator: 'NASA', kind: 'robotic', role: 'r', massKg: 140, speedMps: 0.1, phaseS: 0, lengthM: 80, home: path[0], path };
}
/** Flat ground with a slope of `rise` metres per metre towards the north. */
const ground = (rise = 0) => ({ heightAt: (_e: number, n: number) => n * rise, point: (e: number, n: number, h: number, out: Vector3) => out.set(e, h, -n) }) as unknown as Ground;

function setUp() {
  const rovers = new SurfaceRovers([1, 2], 2);
  // The mocked label is not a real Object3D; keep it out of the group.
  rovers.group.add = () => rovers.group;
  const track = buildTrack(rover(), SITE, 0);
  rovers.setTracks([track]);
  const camera = new PerspectiveCamera();
  camera.position.set(0, 2, 0);
  const shown = (rovers as unknown as { shown: { body: { position: Vector3; getWorldDirection(v: Vector3): Vector3; quaternion: unknown; up: Vector3 }; label: { variant: number; sprite: { visible: boolean } }; materials: { material: { color: { r: number } }; base: { r: number } }[] }[] }).shown[0];
  return { rovers, track, camera, shown };
}

describe('rovers in the surface view (simulated)', () => {
  it('size a vehicle from its mass', () => {
    expect(roverLengthM({ massKg: 12 })).toBeCloseTo(0.82, 2);
    expect(roverLengthM({ massKg: 900 })).toBeCloseTo(3.48, 2);
    expect(roverLengthM({ massKg: 1 })).toBe(0.7);
  });

  it('stand where the track puts them, nose in the direction of travel', () => {
    const { rovers, track, camera, shown } = setUp();
    // 100 s after the 60 s halt: 10 m up the first side, driving north (scene -Z).
    rovers.update(160_000, ground(), camera, 720, () => 1);
    expect(shown.body.position.x).toBeCloseTo(10, 4);
    expect(shown.body.position.z).toBeCloseTo(-20, 4);
    const nose = new Vector3(0, 0, -1).applyQuaternion(shown.body.quaternion as never);
    expect(nose.z).toBeCloseTo(-1, 5);
    // On the second side it drives east (scene +X), wheels still down.
    const at = 60_000 + 250_000;
    expect(roverStateAt(track, at).headingDeg).toBeCloseTo(90, 3);
    rovers.update(at, ground(), camera, 720, () => 1);
    nose.set(0, 0, -1).applyQuaternion(shown.body.quaternion as never);
    expect(nose.x).toBeCloseTo(1, 5);
    expect(new Vector3(0, 1, 0).applyQuaternion(shown.body.quaternion as never).y).toBeCloseTo(1, 5);
  });

  it('tilt with the ground', () => {
    const { rovers, camera, shown } = setUp();
    rovers.update(160_000, ground(0.2), camera, 720, () => 1);
    const nose = new Vector3(0, 0, -1).applyQuaternion(shown.body.quaternion as never);
    // Driving north up a 1-in-5 slope: the nose points up by atan(0.2).
    expect(Math.atan2(nose.y, -nose.z)).toBeCloseTo(Math.atan(0.2), 4);
    expect(shown.body.position.y).toBeCloseTo(4, 4);
  });

  it('name what a halted rover is doing, go dark in shadow, and ask for a new shadow only after moving', () => {
    const { rovers, camera, shown } = setUp();
    expect(rovers.names).toEqual(['Test']);
    expect(rovers.update(30_000, ground(), camera, 720, () => 1)).toBe(true);
    expect(shown.label.variant).toBe(1);
    expect(rovers.update(40_000, ground(), camera, 720, () => 0)).toBe(false);
    expect(shown.materials[0].material.color.r).toBeCloseTo(shown.materials[0].base.r * 0.04, 6);
    expect(rovers.update(160_000, ground(), camera, 720, () => 1)).toBe(true);
    expect(shown.label.variant).toBe(0);
    expect(shown.materials[0].material.color.r).toBeCloseTo(shown.materials[0].base.r, 6);
    // Far from the viewer: no name, and no shadow to redraw.
    camera.position.set(5000, 2, 0);
    expect(rovers.update(200_000, ground(), camera, 720, () => 1)).toBe(false);
    expect(shown.label.sprite.visible).toBe(false);
  });
});
