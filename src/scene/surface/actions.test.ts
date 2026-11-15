import { beforeEach, describe, expect, it } from 'vitest';
import { listActions, registerActions, resetActions, runAction, toolDefinitions } from '../../core/actions';
import { initialState, Store } from '../../core/store';
import type { SurfaceGround, SurfaceSky } from '../surface';
import { aimAtBody, createSurfaceActions, roundedLook, skySummary, type SurfaceApi, type TrackedBody } from './actions';

const T0 = Date.UTC(2025, 2, 6, 17, 28);

const SKY: SurfaceSky = {
  timeMs: T0,
  topocentric: true,
  sun: { azDeg: 65.678, elDeg: 2.461, radiusDeg: 0.2687 },
  earth: { azDeg: 335.84, elDeg: 11.19, radiusDeg: 0.9412, litFraction: 0.4987 },
  sunAboveTerrain: 0.62,
  sunBehindEarth: 0,
  earthBehindTerrain: false,
};

const GROUND: SurfaceGround = {
  bands: [
    { fromM: 0, toM: 768, gridM: 3, sources: [{ name: 'LOLA LDEM_80S_20M, 60 m site window', resolutionM: 60, share: 1 }], interpolated: true },
    { fromM: 768, toM: 3840, gridM: 60, sources: [{ name: 'LOLA LDEM_80S_20M, 60 m site window', resolutionM: 60, share: 1 }], interpolated: false },
  ],
  summary: 'LOLA LDEM_80S_20M, 60 m site window (60 m per sample), interpolated to 0.8 km; LOLA LDEM_80S_20M, 60 m site window (60 m per sample) to 3.8 km',
  surveyed: false,
  generated: 'No survey finer than 60 m exists here: the craters, bumps and rocks drawn within 768 m are generated, not measured.',
  notes: ['Beyond about 31 km only the whole-Moon grid is available.'],
  reachM: 3840,
};

/** A stand-in for SurfaceView with the same clamping rules. */
function fakeView() {
  const state = { az: 10, el: 0, fov: 70, east: 0, north: 0, lift: 0, generated: true, tracks: true, labels: true };
  const view: SurfaceApi = {
    get generated() { return state.generated; },
    ground: GROUND,
    site: { id: 'im-2', name: 'IM-2 Athena', lat: -84.79, lon: 29.2, kind: 'landing' },
    skyNow: SKY,
    get lookDirection() { return { azDeg: state.az, elDeg: state.el, fovDeg: state.fov }; },
    get position() { return { eastM: state.east, northM: state.north, eyeHeightM: 2 + state.lift }; },
    get distanceFromSite() { return Math.hypot(state.east, state.north); },
    get annotations() { return { tracks: state.tracks, labels: state.labels }; },
    pathSteps: { sunH: 1, earthH: 6, startMs: T0, durationH: 24 },
    setGenerated(on) { state.generated = on; },
    setLook(az, el, fov) {
      state.az = ((az % 360) + 360) % 360;
      state.el = Math.max(-89, Math.min(89, el));
      if (fov !== undefined) state.fov = Math.max(4, Math.min(100, fov));
    },
    setFov(fov) { state.fov = Math.max(4, Math.min(100, fov)); },
    setPosition(e, n, lift = state.lift) {
      state.east = Math.max(-26000, Math.min(26000, e));
      state.north = Math.max(-26000, Math.min(26000, n));
      state.lift = lift;
    },
    setAnnotations(tracks, labels = tracks) { state.tracks = tracks; state.labels = labels; },
  };
  return { view, state };
}

describe('surface view actions', () => {
  let store: Store;
  let active: boolean;
  let changes: number;
  let fake: ReturnType<typeof fakeView>;
  let trackingBody: TrackedBody | null;

  beforeEach(() => {
    resetActions();
    store = new Store(initialState(T0));
    active = true;
    changes = 0;
    fake = fakeView();
    trackingBody = null;
    registerActions(
      createSurfaceActions({
        store,
        view: fake.view,
        active: () => active,
        trackingBody: () => trackingBody,
        setTrackingBody: (body) => {
          trackingBody = body;
        },
        changed: () => changes++,
      }),
    );
  });

  it('registers the documented names with schemas the assistant can use', () => {
    expect(listActions().map((a) => a.name)).toEqual(['setGeneratedDetail', 'setFieldOfView', 'lookAtBody', 'setBodyTracking', 'walkTo', 'setSkyAnnotations', 'getSurfaceView']);
    for (const tool of toolDefinitions()) {
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.input_schema.type).toBe('object');
    }
  });

  it('zooms and writes the look direction to the shared state', async () => {
    const r = await runAction<{ look: { fovDeg: number } }>('setFieldOfView', { fovDeg: 5 }, 'test');
    expect(r).toEqual({ ok: true, result: { look: { azDeg: 10, elDeg: 0, fovDeg: 5 } } });
    expect(store.get().look).toEqual({ azDeg: 10, elDeg: 0, fovDeg: 5 });
    expect((await runAction('setFieldOfView', { fovDeg: 2 }, 'test')).ok).toBe(false); // below the documented range
  });

  it('faces the Sun or Earth and reports what the scene shows, with units in the names', async () => {
    const sun = await runAction<Record<string, unknown>>('lookAtBody', { body: 'sun' }, 'test');
    expect(sun.ok && sun.result).toMatchObject({
      body: 'sun',
      azDeg: 65.68,
      elDeg: 2.46,
      angularDiameterDeg: 0.537,
      discAboveDrawnTerrainPct: 62,
      belowHorizontal: false,
      look: { azDeg: 65.7, elDeg: 2.5, fovDeg: 70 },
      timeUtc: '2025-03-06T17:28Z',
    });
    expect(store.get().look).toEqual({ azDeg: 65.7, elDeg: 2.5, fovDeg: 70 });
    const earth = await runAction<Record<string, unknown>>('lookAtBody', { body: 'earth', fovDeg: 6 }, 'test');
    expect(earth.ok && earth.result).toMatchObject({ body: 'earth', litPct: 50, angularDiameterDeg: 1.882, centreBehindDrawnTerrain: false, look: { azDeg: 335.8, elDeg: 11.2, fovDeg: 6 } });
  });

  it('looks at the horizon in the direction of a body that is well below it', async () => {
    (fake.view as { skyNow: SurfaceSky }).skyNow = { ...SKY, sun: { ...SKY.sun, elDeg: -12 } };
    const r = await runAction<Record<string, unknown>>('lookAtBody', { body: 'sun' }, 'test');
    expect(r.ok && r.result).toMatchObject({ belowHorizontal: true, elDeg: -12, look: { azDeg: 65.7, elDeg: 0 } });
    // Just under the horizontal it may still show over a low skyline: look straight at it.
    (fake.view as { skyNow: SurfaceSky }).skyNow = { ...SKY, sun: { ...SKY.sun, elDeg: -0.34 } };
    const low = await runAction<Record<string, unknown>>('lookAtBody', { body: 'sun', fovDeg: 4 }, 'test');
    expect(low.ok && low.result).toMatchObject({ belowHorizontal: true, look: { azDeg: 65.7, elDeg: -0.3, fovDeg: 4 } });
  });

  it('tracks one body at a time and can re-aim it after the sky changes', async () => {
    const sun = await runAction<Record<string, unknown>>('setBodyTracking', { body: 'sun', on: true }, 'test');
    expect(sun.ok && sun.result).toEqual({ body: 'sun', tracking: 'sun', look: { azDeg: 65.7, elDeg: 2.5, fovDeg: 70 } });
    expect(trackingBody).toBe('sun');

    (fake.view as { skyNow: SurfaceSky }).skyNow = { ...SKY, sun: { ...SKY.sun, azDeg: 90, elDeg: 20 } };
    aimAtBody(fake.view, 'sun');
    expect(fake.state).toMatchObject({ az: 90, el: 20, fov: 70 });

    const earth = await runAction<Record<string, unknown>>('setBodyTracking', { body: 'earth', on: true }, 'test');
    expect(earth.ok && earth.result).toMatchObject({ body: 'earth', tracking: 'earth', look: { azDeg: 335.8, elDeg: 11.2 } });
    expect(trackingBody).toBe('earth');
    const off = await runAction<Record<string, unknown>>('setBodyTracking', { body: 'earth', on: false }, 'test');
    expect(off.ok && off.result).toMatchObject({ body: 'earth', tracking: null });
    expect(trackingBody).toBeNull();
  });

  it('stops tracking when the view is turned to the other body, and keeps it for the same one', async () => {
    await runAction('setBodyTracking', { body: 'sun', on: true }, 'test');
    expect((await runAction('lookAtBody', { body: 'sun' }, 'test')).ok).toBe(true);
    expect(trackingBody).toBe('sun');
    const before = changes;
    expect((await runAction('lookAtBody', { body: 'earth' }, 'test')).ok).toBe(true);
    expect(trackingBody).toBeNull();
    // The HUD hears of it, so the "Track Sun" toggle is released.
    expect(changes).toBeGreaterThan(before);
  });

  it('walks to an absolute position and says when it was clamped', async () => {
    const r = await runAction<{ position: Record<string, number>; clamped: boolean }>('walkTo', { eastM: 120, northM: -50, liftM: 10 }, 'test');
    expect(r.ok && r.result).toEqual({ position: { eastM: 120, northM: -50, distanceFromSiteM: 130, eyeHeightM: 12 }, clamped: false });
    const far = await runAction<{ clamped: boolean }>('walkTo', { eastM: 29000, northM: 0 }, 'test');
    expect(far.ok && far.result.clamped).toBe(true);
    const home = await runAction<{ position: Record<string, number> }>('walkTo', { eastM: 0, northM: 0 }, 'test');
    expect(home.ok && home.result.position).toMatchObject({ distanceFromSiteM: 0, eyeHeightM: 2 });
    expect(changes).toBe(3);
  });

  it('refuses to move the camera while the surface view is not on screen, with a sentence', async () => {
    active = false;
    for (const [name, params] of [
      ['setFieldOfView', { fovDeg: 30 }],
      ['lookAtBody', { body: 'sun' }],
      ['setBodyTracking', { body: 'sun', on: true }],
      ['walkTo', { eastM: 1, northM: 1 }],
    ] as const) {
      const r = await runAction(name, params, 'test');
      expect(r).toEqual({ ok: false, error: 'Enter the surface view first (enterSurface).' });
    }
    // Display preferences can be set ahead of time.
    expect((await runAction('setGeneratedDetail', { on: false }, 'test')).ok).toBe(true);
    expect((await runAction('setSkyAnnotations', { tracks: false }, 'test')).ok).toBe(true);
  });

  it('switches generated detail and the sky annotations', async () => {
    const off = await runAction<Record<string, unknown>>('setGeneratedDetail', { on: false }, 'test');
    expect(off.ok && off.result).toEqual({ generatedDetail: false, whatIsGenerated: GROUND.generated });
    expect(fake.state.generated).toBe(false);
    const a = await runAction<Record<string, unknown>>('setSkyAnnotations', { tracks: false }, 'test');
    expect(a.ok && a.result).toEqual({ tracks: false, labels: true, markEvery: { sunH: 1, earthH: 6 } });
    expect((await runAction('setSkyAnnotations', {}, 'test')).ok).toBe(false);
  });

  it('reports the whole view in one query', async () => {
    await runAction('lookAtBody', { body: 'sun' }, 'test');
    const r = await runAction<Record<string, any>>('getSurfaceView', {}, 'test');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result).toMatchObject({
      active: true,
      trackingBody: null,
      site: { id: 'im-2', latDeg: -84.79, lonDegEast: 29.2 },
      look: { azDeg: 65.7, elDeg: 2.5, fovDeg: 70 },
      position: { eastM: 0, northM: 0, distanceFromSiteM: 0, eyeHeightM: 2 },
      sky: { timeUtc: '2025-03-06T17:28Z', sun: { azDeg: 65.68, elDeg: 2.46 }, earth: { azDeg: 335.84, elDeg: 11.19, litPct: 50 } },
      ground: { surveyed: false, drawnOutToKm: 4, generatedDetailShown: true },
      annotations: { tracks: true, labels: true, window: { startUtc: '2025-03-06T17:28Z', durationH: 24, sunMarkEveryH: 1, earthMarkEveryH: 6 } },
    });
    expect(r.result.ground.bands[0]).toEqual({ fromM: 0, toM: 768, gridSpacingM: 3, product: 'LOLA LDEM_80S_20M, 60 m site window', productResolutionM: 60, interpolated: true });
    expect(r.result.sky.directions).toMatch(/topocentric/);
    expect(JSON.stringify(r.result)).not.toMatch(/NaN|undefined/);
  });
});

describe('summaries', () => {
  it('round the look direction to tenths and wrap 360 to 0', () => {
    const { view, state } = fakeView();
    state.az = 359.97;
    state.el = -3.24;
    state.fov = 69.96;
    expect(roundedLook(view)).toEqual({ azDeg: 0, elDeg: -3.2, fovDeg: 70 });
  });

  it('say so when directions are the interim Moon-centre ones', () => {
    expect(skySummary({ ...SKY, topocentric: false })!.directions).toMatch(/interim/);
    expect(skySummary(null)).toBeNull();
  });
});
