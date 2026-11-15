import { describe, expect, it } from 'vitest';
import { nextShootingStarDelaySec, ShootingStar } from './shootingStar';

describe('shooting star', () => {
  it('picks a delay inside the 25–45 s window', () => {
    expect(nextShootingStarDelaySec(() => 0)).toBe(25);
    expect(nextShootingStarDelaySec(() => 1)).toBe(45);
    expect(nextShootingStarDelaySec(() => 0.5)).toBe(35);
  });

  it('stays hidden under reduced motion and cleans up on dispose', () => {
    const matchMedia = (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') && query.includes('reduce'),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList;
    const prev = globalThis.window;
    Object.assign(globalThis, { window: { matchMedia } });
    try {
      const star = new ShootingStar();
      star.update(40);
      expect(star.root.children[0].visible).toBe(false);
      star.dispose();
      star.update(1);
      expect(star.root.children[0].visible).toBe(false);
    } finally {
      Object.assign(globalThis, { window: prev });
    }
  });

  it('spawns a visible streak after the wait when motion is allowed', () => {
    const matchMedia = () =>
      ({
        matches: false,
        media: '',
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {
          return false;
        },
      }) as MediaQueryList;
    const prev = globalThis.window;
    Object.assign(globalThis, { window: { matchMedia } });
    try {
      const star = new ShootingStar();
      // Force the wait to expire.
      (star as unknown as { wait: number }).wait = 0;
      star.update(0.016);
      expect(star.root.children[0].visible).toBe(true);
      // Finish the flight and ensure it hides again.
      (star as unknown as { t: number; duration: number }).t = 2;
      (star as unknown as { duration: number }).duration = 1;
      star.update(0.016);
      expect(star.root.children[0].visible).toBe(false);
      star.dispose();
    } finally {
      Object.assign(globalThis, { window: prev });
    }
  });
});
