import { describe, expect, it } from 'vitest';
import { azDelta, azElToScene, discAreaAbove, discCoveredFraction, niceStepH, sceneToAzEl, separationDeg, wrapAz } from './skyMath';

describe('sky geometry', () => {
  it('maps azimuth and elevation onto the scene axes (+X east, +Y up, +Z south)', () => {
    const v = { x: 0, y: 0, z: 0 };
    expect(azElToScene(0, 0, v)).toMatchObject({ x: expect.closeTo(0, 12), y: expect.closeTo(0, 12), z: expect.closeTo(-1, 12) }); // north
    expect(azElToScene(90, 0, v).x).toBeCloseTo(1, 12); // east
    expect(azElToScene(180, 0, v).z).toBeCloseTo(1, 12); // south
    expect(azElToScene(270, 0, v).x).toBeCloseTo(-1, 12); // west
    expect(azElToScene(123, 90, v).y).toBeCloseTo(1, 12); // zenith
  });

  it('round-trips directions', () => {
    for (const [az, el] of [[0, 0], [37.5, 12.25], [359.9, -3], [181, 88], [270, -45]]) {
      const back = sceneToAzEl(azElToScene(az, el, { x: 0, y: 0, z: 0 }));
      expect(back.azDeg).toBeCloseTo(az, 9);
      expect(back.elDeg).toBeCloseTo(el, 9);
    }
  });

  it('wraps and differences azimuths the short way round', () => {
    expect(wrapAz(-10)).toBe(350);
    expect(wrapAz(725)).toBe(5);
    expect(azDelta(350, 10)).toBe(20);
    expect(azDelta(10, 350)).toBe(-20);
    expect(azDelta(0, 180)).toBe(-180);
  });

  it('measures the angle between two directions', () => {
    expect(separationDeg(0, 0, 90, 0)).toBeCloseTo(90, 9);
    expect(separationDeg(10, 5, 10, 5.25)).toBeCloseTo(0.25, 9);
    expect(separationDeg(0, 89, 180, 89)).toBeCloseTo(2, 9);
  });
});

describe('disc fractions', () => {
  it('turns the visible part of a diameter into the visible part of the area', () => {
    expect(discAreaAbove(-0.2)).toBe(0);
    expect(discAreaAbove(0)).toBe(0);
    expect(discAreaAbove(0.5)).toBeCloseTo(0.5, 12);
    expect(discAreaAbove(1)).toBe(1);
    expect(discAreaAbove(3)).toBe(1);
    // Symmetric about the centre, and small near the limb (a sliver of the limb is little area).
    expect(discAreaAbove(0.25) + discAreaAbove(0.75)).toBeCloseTo(1, 12);
    expect(discAreaAbove(0.1)).toBeCloseTo(0.052, 3);
  });

  it('computes how much of the Sun a larger disc covers', () => {
    const sun = 0.266, earth = 0.95;
    expect(discCoveredFraction(sun, earth, 2)).toBe(0); // far apart
    expect(discCoveredFraction(sun, earth, sun + earth)).toBe(0); // touching
    expect(discCoveredFraction(sun, earth, 0.1)).toBe(1); // Sun wholly behind Earth
    expect(discCoveredFraction(sun, earth, earth - sun)).toBe(1); // internal contact
    // Earth's limb through the Sun's centre covers a little less than half: the limb curves away from the Sun.
    const half = discCoveredFraction(sun, earth, earth);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.5);
    // Equal discs, one centred on the other's limb: 2/3 - sqrt(3) / (2 pi) = 0.391 of the area overlaps.
    expect(discCoveredFraction(1, 1, 1)).toBeCloseTo(2 / 3 - Math.sqrt(3) / (2 * Math.PI), 9);
    // A smaller disc can cover only its own share of the larger one.
    expect(discCoveredFraction(1, 0.5, 0)).toBeCloseTo(0.25, 12);
  });
});

describe('niceStepH', () => {
  it('picks a readable step', () => {
    expect(niceStepH(0.1)).toBe(0.25);
    expect(niceStepH(1)).toBe(1);
    expect(niceStepH(1.5)).toBe(2);
    expect(niceStepH(5)).toBe(6);
    expect(niceStepH(200)).toBe(336);
  });
});
