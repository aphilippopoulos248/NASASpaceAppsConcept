import { describe, expect, it } from 'vitest';
import { handleGlobeKey, keyStep, type Pose } from './globeKeys';

/**
 * A globe as far as the keys go: `go` starts a flight at once (setGlobeCamera runs synchronously
 * up to the scene's flyTo); the centre the globe draws is published only when a frame is drawn.
 */
function globe(start: Pose) {
  let centre = { ...start };
  let flight: Pose | null = null;
  const calls: Pose[] = [];
  const pins: Pose[] = [];
  const deps = {
    pose: () => flight ?? centre,
    go: (to: Pose) => {
      flight = to;
      calls.push(to);
    },
    pin: () => pins.push(flight ?? centre),
  };
  return {
    press: (key: string) => handleGlobeKey(key, deps),
    /** Frames go by and the flight arrives. */
    arrive: () => {
      if (flight) centre = flight;
      flight = null;
    },
    get centre() {
      return centre;
    },
    calls,
    pins,
  };
}

describe('globe keys', () => {
  it('five presses within one frame turn the globe five steps', () => {
    // At the whole-Moon view a step is 20 degrees of longitude at the equator.
    const g = globe({ lat: 0, lon: 0, altitudeKm: 4170 });
    for (let i = 0; i < 5; i++) expect(g.press('ArrowRight')).toBe(true);
    expect(g.calls.map((p) => p.lon)).toEqual([20, 40, 60, 80, 100]);
    g.arrive();
    expect(g.centre).toEqual({ lat: 0, lon: 100, altitudeKm: 4170 });
    // Before, each press started from the centre last drawn and the view ended one step away.
  });

  it('zoom presses add up too, and mixed keys combine', () => {
    const g = globe({ lat: 10, lon: 20, altitudeKm: 4170 });
    g.press('+');
    g.press('+');
    g.press('ArrowUp');
    const last = g.calls.at(-1)!;
    expect(last.altitudeKm).toBeCloseTo(4170 / 2.25, 9);
    // The step shrinks with the altitude it steps from: 1853 km gives about 12.8 degrees.
    expect(last.lat).toBeCloseTo(10 + (4170 / 2.25 / 1737.4) * 12, 9);
    expect(last.lon).toBe(20);
  });

  it('keeps to the arrows’ latitude limit, and does not pull back a pose already beyond it', () => {
    const g = globe({ lat: 85, lon: 0, altitudeKm: 4170 });
    g.press('ArrowUp');
    expect(g.calls.at(-1)!.lat).toBe(89);
    g.press('ArrowUp');
    expect(g.calls.at(-1)!.lat).toBe(89);
    expect(keyStep('ArrowUp', { lat: 89.95, lon: 0, altitudeKm: 300 })!.lat).toBe(89.95);
    expect(keyStep('ArrowDown', { lat: -89.95, lon: 0, altitudeKm: 300 })!.lat).toBe(-89.95);
  });

  it('wraps longitude, keeps the altitude in range, ignores other keys', () => {
    expect(keyStep('ArrowLeft', { lat: 0, lon: -170, altitudeKm: 4170 })!.lon).toBe(170);
    expect(keyStep('+', { lat: 0, lon: 0, altitudeKm: 11 })!.altitudeKm).toBe(10);
    expect(keyStep('-', { lat: 0, lon: 0, altitudeKm: 13000 })!.altitudeKm).toBeCloseTo(13899.2, 6);
    const g = globe({ lat: 0, lon: 0, altitudeKm: 4170 });
    expect(g.press('a')).toBe(false);
    expect(g.press('Tab')).toBe(false);
    expect(g.calls).toEqual([]);
  });

  it('Enter pins the point the view is on its way to', () => {
    const g = globe({ lat: 0, lon: 0, altitudeKm: 4170 });
    g.press('ArrowRight');
    g.press('Enter');
    expect(g.pins).toEqual([{ lat: 0, lon: 20, altitudeKm: 4170 }]);
  });
});
