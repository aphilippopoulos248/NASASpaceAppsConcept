import { MeshStandardMaterial, PerspectiveCamera, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { MOON_RADIUS_M } from '../../core/types';
import { polarXY } from '../../terrain/geo';
import { COVERAGE_STYLE, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayStyle';
import { PolarCloseUp, type PolarView } from './polarCloseUp';
import { clearTerrainCache, setTerrainReader } from '../../terrain/api';
import { readPublicFile } from '../../terrain/nodeReader';
import { ReliefGlobe } from './reliefGlobe';
import { createSurfaceUniforms } from './surfaceShader';

function cameraAt(lat: number, lon: number, altitudeKm: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.001, 100);
  const c = Math.cos((lat * Math.PI) / 180), d = 1 + (altitudeKm * 1000) / MOON_RADIUS_M;
  camera.position.set(d * c * Math.cos((lon * Math.PI) / 180), d * Math.sin((lat * Math.PI) / 180), -d * c * Math.sin((lon * Math.PI) / 180));
  camera.lookAt(new Vector3(0, 0, 0));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

describe('relief globe (bundled LOLA grids, no network)', () => {
  it('draws root tiles at once, real heights when the overview grid arrives, and fetches the full grid when the camera comes close', async () => {
    const globe = new ReliefGlobe(new MeshStandardMaterial());
    const far = cameraAt(8, 0, 4170);
    // Before any data: a smooth sphere, complete.
    expect(globe.update(far, 720, 0)).toBeGreaterThan(8);
    expect(globe.heightM(5.4, -158.6)).toBe(0);
    expect(globe.pyramid.maxPpd).toBe(0);

    await globe.loadOverview();
    expect(globe.problem).toBeNull();
    expect(globe.pyramid.maxPpd).toBe(4);
    expect(globe.dataVersion).toBe(1);
    // The Moon's highest ground (10.7 km, near 5.4N 158.6W) and the deep South Pole-Aitken basin.
    expect(globe.heightM(5.4, -158.6)).toBeGreaterThan(8000);
    expect(globe.heightM(-70, -170)).toBeLessThan(-4000);

    // From orbit: a few dozen tiles, every one with heights from the new data after a few frames.
    let shown = 0;
    for (let frame = 0; frame < 12; frame++) shown = globe.update(far, 720, 10);
    expect(shown).toBeGreaterThan(20);
    expect(shown).toBeLessThan(140);
    const visible = globe.root.children.filter((m) => m.visible) as Mesh[];
    expect(visible).toHaveLength(shown);
    const heights = visible.flatMap((m) => Array.from(m.geometry.getAttribute('aHeight').array as Float32Array));
    expect(Math.max(...heights) * MOON_RADIUS_M).toBeGreaterThan(3000);
    expect(Math.min(...heights) * MOON_RADIUS_M).toBeLessThan(-3000);

    // 42 km above Apollo 11: finer tiles are wanted than the overview can fill, so the 16 px/deg grid is fetched.
    const near = cameraAt(0.674, 23.473, 42);
    globe.update(near, 720, 1);
    await globe.settled();
    expect(globe.pyramid.maxPpd).toBe(16);
    expect(globe.dataVersion).toBe(2);
    for (let frame = 0; frame < 30; frame++) shown = globe.update(near, 720, 1);
    expect(shown).toBeLessThan(120);
    // Mare Tranquillitatis lies about 1.9 km below the reference sphere.
    expect(globe.heightM(0.674, 23.473)).toBeGreaterThan(-2200);
    expect(globe.heightM(0.674, 23.473)).toBeLessThan(-1600);
  }, 120_000);

  it('asks for the 16 px/deg grid again after a failed load, and says so on screen meanwhile', async () => {
    clearTerrainCache();
    let failures = 1;
    setTerrainReader(async (path) => {
      if (path.endsWith('lola_global_16ppd.lxg') && failures > 0) {
        failures--;
        throw new Error('net::ERR_CACHE_WRITE_FAILURE (tried 3 times)');
      }
      return readPublicFile(path);
    });
    try {
      let clock = 1000;
      const globe = new ReliefGlobe(new MeshStandardMaterial(), () => clock);
      await globe.loadOverview();
      const near = cameraAt(0.674, 23.473, 42);
      globe.update(near, 720, 1);
      await globe.settled();
      // Still the overview, and the reason, what is shown and when it tries again are on screen.
      expect(globe.pyramid.maxPpd).toBe(4);
      expect(globe.problem).toBe('The 16 px/deg whole-Moon elevation grid could not be loaded (net::ERR_CACHE_WRITE_FAILURE (tried 3 times)). The globe shows the 4 px/deg relief and tries again in 20 s.');
      // Not before the pause is over.
      clock += 19_000;
      globe.update(near, 720, 1);
      await globe.settled();
      expect(globe.pyramid.maxPpd).toBe(4);
      // Then it asks again, gets the grid and the message goes.
      clock += 2_000;
      globe.update(near, 720, 1);
      await globe.settled();
      expect(globe.pyramid.maxPpd).toBe(16);
      expect(globe.problem).toBeNull();
    } finally {
      setTerrainReader(null);
      clearTerrainCache();
    }
  }, 120_000);

  it('stops asking after three failed rounds and leaves the reason on screen', async () => {
    clearTerrainCache();
    let asked = 0;
    setTerrainReader(async (path) => {
      if (path.endsWith('lola_global_16ppd.lxg')) {
        asked++;
        throw new Error('offline');
      }
      return readPublicFile(path);
    });
    try {
      let clock = 0;
      const globe = new ReliefGlobe(new MeshStandardMaterial(), () => clock);
      await globe.loadOverview();
      const near = cameraAt(0.674, 23.473, 42);
      for (let round = 0; round < 6; round++) {
        globe.update(near, 720, 1);
        await globe.settled();
        clock += 120_000;
      }
      expect(asked).toBe(3);
      expect(globe.problem).toBe('The 16 px/deg whole-Moon elevation grid could not be loaded (offline). The globe shows the 4 px/deg relief.');
    } finally {
      setTerrainReader(null);
      clearTerrainCache();
    }
  }, 120_000);
});

describe('south-polar close-up (bundled LOLA polar layers, no network)', () => {
  const uniforms = () => createSurfaceUniforms(OVERLAY_RAMP, SUN_BAND_COLOUR, COVERAGE_STYLE.map((c) => c.colour));
  const view = (over: Partial<PolarView>): PolarView => ({ altitudeKm: 60, centre: { lat: -89.6, lon: 125 }, site: null, sunDir: [Math.cos(0.02), 0, -Math.sin(0.02)], realLight: true, nowMs: 0, ...over });
  /** Runs frames until the close-up reports itself (its layers load in the background). */
  async function until(closeUp: PolarCloseUp, v: PolarView, done: () => boolean): Promise<ReturnType<PolarCloseUp['update']>> {
    let status = null;
    for (let i = 0; i < 2400; i++) {
      status = closeUp.update({ ...v, nowMs: i * 600 });
      if (done()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return status;
  }

  it('builds the wide piece and a fine window from the finest layer, and sweeps real shadows into them', async () => {
    const u = uniforms();
    const closeUp = new PolarCloseUp(u);
    // High above the equator it does nothing and loads nothing.
    expect(closeUp.update(view({ altitudeKm: 4000, centre: { lat: 0, lon: 0 } }))).toBeNull();
    expect(closeUp.heightM(-89.6, 125)).toBeNull();
    expect(u.uCapHole.value).toBe(-2);

    // Low over Shackleton crater: 40 m window (inside 87.5S).
    let status = await until(closeUp, view({}), () => closeUp.heightM(-89.6, 125) !== null && closeUp.root.children.length === 2);
    expect(closeUp.problem).toBeNull();
    expect(status).toEqual({ resolutionM: 40, shadows: true });
    expect(closeUp.covers(-89)).toBe(true);
    expect(closeUp.covers(-80.5)).toBe(false); // the blend zone still shows the photographic globe
    expect(u.uCapHole.value).toBeLessThan(-0.98); // the tiles underneath are left out
    // Shackleton's floor, 2.9 km below the sphere (T-4 measured -2871 m at 89.625S 118.68E).
    expect(closeUp.heightM(-89.625, 118.68)!).toBeLessThan(-2700);
    expect(closeUp.heightM(-89.625, 118.68)!).toBeGreaterThan(-3000);
    expect(closeUp.heightM(-70, 0)).toBeNull();

    // After a full shadow update (four frames) both pieces hold lit and dark cells, and the crater floor is dark.
    for (let i = 0; i < 6; i++) closeUp.update(view({ nowMs: 1e7 + i * 600 }));
    const pieces = closeUp as unknown as { wide: { lit: Uint8Array; grid: { n: number; x0: number; y0: number; cellM: number } }; fine: { lit: Uint8Array; grid: { n: number; x0: number; y0: number; cellM: number } } };
    for (const piece of [pieces.wide, pieces.fine]) {
      let dark = 0, lit = 0;
      for (let i = 0; i < piece.lit.length; i += 7) piece.lit[i] === 0 ? dark++ : piece.lit[i] === 255 ? lit++ : 0;
      expect(dark).toBeGreaterThan(1000);
      expect(lit).toBeGreaterThan(1000);
    }
    const floor = polarXY('S', -89.625, 118.68);
    const g = pieces.fine.grid;
    const col = Math.round((floor.x - g.x0) / g.cellM), row = Math.round((g.y0 - floor.y) / g.cellM);
    expect(col).toBeGreaterThan(0);
    expect(col).toBeLessThan(g.n);
    expect(pieces.fine.lit[row * g.n + col]).toBe(0);

    // Even lighting: no shadows claimed. A site at 84.79S (IM-2): the window comes from the 80 m layer.
    expect(closeUp.update(view({ realLight: false, nowMs: 2e7 }))).toEqual({ resolutionM: 40, shadows: false });
    const im2 = { lat: -84.79, lon: 29.2 };
    status = await until(closeUp, view({ altitudeKm: 42, centre: im2, site: im2, nowMs: 3e7 }), () => (closeUp as unknown as { fine: { sourceM: number } }).fine.sourceM === 80);
    expect(status).toMatchObject({ resolutionM: 80 });
    expect(closeUp.heightM(im2.lat, im2.lon)!).toBeGreaterThan(5200); // IM-2's plateau on Mons Mouton, 5.3 km up
    expect(closeUp.heightM(im2.lat, im2.lon)!).toBeLessThan(5450);

    // Climbing away fades it out and gives the tiles back.
    expect(closeUp.update(view({ altitudeKm: 3000, centre: im2, site: im2, nowMs: 4e7 }))).toBeNull();
    expect(u.uCapHole.value).toBe(-2);

    // Low over the near side, with the data loaded: not on screen, and not reported as on screen
    // (it used to stay "shown" wherever the camera went low once it had been loaded).
    expect(closeUp.update(view({ altitudeKm: 42, centre: { lat: 20.19, lon: 30.77 }, nowMs: 5e7 }))).toBeNull();
    expect(closeUp.root.visible).toBe(false);
    expect(closeUp.covers(-89)).toBe(false);
    expect(u.uCapHole.value).toBe(-2);
    // From 1000 km above 40 S the polar region is in view near the limb: shown, partly faded, the tiles kept.
    expect(closeUp.update(view({ altitudeKm: 1000, centre: { lat: -40, lon: 0 }, nowMs: 6e7 }))).not.toBeNull();
    expect(closeUp.root.visible).toBe(true);
    expect(u.uCapHole.value).toBe(-2);
    // From 300 km above 40 S it is beyond the horizon.
    expect(closeUp.update(view({ altitudeKm: 300, centre: { lat: -40, lon: 0 }, nowMs: 7e7 }))).toBeNull();
    closeUp.dispose();
  }, 240_000);
});
