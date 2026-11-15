import { MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { resetActions, runAction } from '../../core/actions';
import { AverageMaps } from './averageMaps';
import { DEFAULT_RELIEF, displaySummary, globeDisplay, registerDisplayActions, reliefText } from './displayState';
import { COVERAGE_STYLE, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayStyle';
import { createSurfaceUniforms, patchSurfaceMaterial, setSurfaceFeatures } from './surfaceShader';
import { imageryText } from '../sitePatch';

const uniforms = () => createSurfaceUniforms(OVERLAY_RAMP, SUN_BAND_COLOUR, COVERAGE_STYLE.map((c) => c.colour));

describe('globe display actions', () => {
  it('sets the relief exaggeration and the coverage outlines, and reports what is drawn', async () => {
    resetActions();
    registerDisplayActions();
    expect(globeDisplay.get()).toEqual({ reliefFactor: DEFAULT_RELIEF, coverage: false, iceTargets: false });
    let heard = 0;
    const off = globeDisplay.subscribe(() => heard++);

    const r = await runAction<any>('setReliefExaggeration', { factor: 20 });
    expect(r).toMatchObject({ ok: true, result: { reliefExaggeration: 20, coverageShown: false, polarCloseUp: null } });
    expect(r.ok && r.result.reliefRule).toContain('eases to true scale (1) below 100 km');
    expect(globeDisplay.get().reliefFactor).toBe(20);
    expect(heard).toBe(1);
    await runAction('setReliefExaggeration', { factor: 20 }); // no change, no notification
    expect(heard).toBe(1);

    // The scene reports what it actually draws: near the ground that is true scale whatever was chosen.
    globeDisplay.setLive({ reliefNow: 1, reliefPpd: 16 });
    expect(displaySummary()).toMatchObject({ reliefExaggeration: 20, reliefDrawnNow: 1, reliefDataSamplesPerDegree: 16 });

    expect(await runAction('setReliefExaggeration', { factor: 0 })).toMatchObject({ ok: true, result: { reliefExaggeration: 0, reliefRule: null } });
    expect(await runAction('setReliefExaggeration', { factor: 31 })).toMatchObject({ ok: false, error: 'params.factor must be at most 30' });
    expect(await runAction('showCoverage', { show: true })).toMatchObject({ ok: true, result: { coverageShown: true } });
    expect(globeDisplay.get().coverage).toBe(true);
    expect(await runAction('showIceTargets', { show: true })).toMatchObject({ ok: true, result: { iceTargetsShown: true, coverageShown: true } });
    expect(globeDisplay.get().iceTargets).toBe(true);
    expect(JSON.parse(JSON.stringify(displaySummary()))).toEqual(displaySummary());
    off();
    globeDisplay.set({ reliefFactor: DEFAULT_RELIEF, coverage: false, iceTargets: false });
    resetActions();
  });

  it('words the exaggeration for the on-screen label', () => {
    expect(reliefText(10)).toBe('relief ×10');
    expect(reliefText(5.44)).toBe('relief ×5.4');
    expect(reliefText(1)).toBe('relief at true scale');
    expect(reliefText(0)).toBe('smooth sphere (relief off)');
  });

  it('tells listeners only when something they show has changed', () => {
    let heard = 0;
    const off = globeDisplay.subscribe(() => heard++);
    globeDisplay.setLive({ reliefNow: 7.31, reliefPpd: 16, reliefProblem: null });
    const base = heard;
    globeDisplay.setLive({ reliefNow: 7.32 }); // within a twentieth: the label would read the same
    expect(heard).toBe(base);
    globeDisplay.setLive({ polar: { resolutionM: 80, shadows: true, note: 'n' } });
    globeDisplay.setLive({ polar: { resolutionM: 80, shadows: true, note: 'n' } });
    expect(heard).toBe(base + 1);
    globeDisplay.setLive({ polar: null });
    expect(heard).toBe(base + 2);
    off();
  });
});

describe('surface shader switches', () => {
  it('compiles the overlays into every patched material only while they are on', () => {
    const u = uniforms();
    const tiles = new MeshStandardMaterial(), patch = new MeshStandardMaterial();
    patchSurfaceMaterial(tiles, u, { hole: true });
    patchSurfaceMaterial(patch, u, { lift: 0.0001 });
    expect(tiles.defines).toMatchObject({ LUNYX_OVERLAY: 0, LUNYX_COVERAGE: 0, LUNYX_HOLE: '' });
    expect(patch.defines).not.toHaveProperty('LUNYX_HOLE');
    expect(patch.userData.lift.value).toBe(0.0001);
    const before = [tiles.version, patch.version];
    setSurfaceFeatures(1, true);
    expect(tiles.defines).toMatchObject({ LUNYX_OVERLAY: 1, LUNYX_COVERAGE: 1 });
    expect(patch.defines).toMatchObject({ LUNYX_OVERLAY: 1, LUNYX_COVERAGE: 1 });
    expect([tiles.version, patch.version]).toEqual(before.map((v) => v + 1)); // flagged for recompiling
    setSurfaceFeatures(1, true);
    expect(tiles.version).toBe(before[0] + 1); // nothing changed: no recompile
    // A material made while an overlay is on starts with it.
    const later = new MeshStandardMaterial();
    patchSurfaceMaterial(later, u);
    expect(later.defines).toMatchObject({ LUNYX_OVERLAY: 1, LUNYX_COVERAGE: 1 });
    // A disposed material is forgotten.
    patch.dispose();
    setSurfaceFeatures(0, false);
    expect(patch.defines).toMatchObject({ LUNYX_OVERLAY: 1 });
    expect(tiles.defines).toMatchObject({ LUNYX_OVERLAY: 0, LUNYX_COVERAGE: 0 });
  });

  it('shares one set of uniforms: six ramp colours, three polar squares, no hole by default', () => {
    const u = uniforms();
    expect(u.uRamp.value).toHaveLength(6);
    expect(u.uCoverColor.value).toHaveLength(3);
    expect(u.uCapHole.value).toBe(-2);
    expect(u.uRelief.value).toBe(0);
    expect(() => createSurfaceUniforms(['#000'], '#fff', [])).toThrow('6 colours');
  });
});

describe('average maps', () => {
  it('is off until an avg-* overlay is chosen, then either ready with its legend or missing with the reason', async () => {
    const u = uniforms();
    const maps = new AverageMaps(u, 4096);
    const seen: string[] = [];
    maps.onChange = () => seen.push(maps.state.state);
    maps.update('off', null);
    maps.update('sun-band', null);
    expect(maps.state).toEqual({ state: 'off' });
    maps.update('avg-illumination', 'S');
    expect(maps.state.state).toBe('loading');
    // The maps arrive one by one (two wide ones and the fine one): wait for the south-polar wide map, or for the verdict that there are none.
    for (let i = 0; i < 800 && maps.state.state !== 'missing' && !(u.uAvgHalf.value.x > 0); i++) await new Promise((r) => setTimeout(r, 25));
    const st = maps.state;
    // The maps belong to the science-layers module: when it is in the build they load, otherwise the overlay says why not.
    if (st.state === 'ready') {
      expect(st.legend.unit).toBe('percent of time');
      expect(st.legend.extent).toContain('poles only');
      expect(u.uAvgHalf.value.x).toBeGreaterThan(0.2);
      expect(u.uAvgSouth.value).not.toBeNull();
    } else {
      expect(st).toMatchObject({ state: 'missing', reason: expect.stringContaining('not part of this build') });
      expect(u.uAvgHalf.value.toArray()).toEqual([0, 0, 0, 0]);
    }
    // Switching the overlay off releases the textures.
    maps.update('off', null);
    expect(maps.state).toEqual({ state: 'off' });
    expect(u.uAvgSouth.value).toBeNull();
    expect(u.uAvgHalf.value.toArray()).toEqual([0, 0, 0, 0]);
    expect(seen[0]).toBe('loading');
  }, 30_000);
});

describe('close-up imagery state', () => {
  it('says what is on screen: loading, shown with the layers that arrived, or not reachable', () => {
    expect(displaySummary().closeUpImagery).toBeNull();
    // The stars behind the globe are generated, and getState says so.
    expect(displaySummary().backgroundStars).toBe('Background stars are decorative: random points, not the real sky.');
    let heard = 0;
    const off = globeDisplay.subscribe(() => heard++);
    globeDisplay.setLive({ closeUp: { state: 'loading', credits: [] } });
    expect(displaySummary().closeUpImagery).toMatchObject({ state: 'loading', layersShown: [], text: expect.stringContaining('loading from NASA Moon Trek') });
    // Only one of the two layers arrived: only that one is credited.
    globeDisplay.setLive({ closeUp: { state: 'shown', credits: ['LROC WAC (NASA/GSFC/ASU)'] } });
    expect(displaySummary().closeUpImagery).toEqual({ state: 'shown', layersShown: ['LROC WAC (NASA/GSFC/ASU)'], text: 'Close-up imagery: LROC WAC (NASA/GSFC/ASU), via NASA Moon Trek.' });
    // The same state again is not news.
    globeDisplay.setLive({ closeUp: { state: 'shown', credits: ['LROC WAC (NASA/GSFC/ASU)'] } });
    expect(heard).toBe(2);
    // No network: nothing is credited, and the sentence says what is shown instead and that nothing else depends on it.
    globeDisplay.setLive({ closeUp: { state: 'unavailable', credits: [] } });
    const text = displaySummary().closeUpImagery!.text;
    expect(text).toBe(imageryText('unavailable', []));
    expect(text).toContain('NASA Moon Trek could not be reached');
    expect(text).toContain('whole-Moon mosaic');
    expect(text).not.toContain('LROC');
    expect(heard).toBe(3);
    globeDisplay.setLive({ closeUp: null });
    expect(displaySummary().closeUpImagery).toBeNull();
    off();
  });
});
