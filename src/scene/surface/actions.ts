// Registered actions of the surface view (decision D-1): everything a person can do there
// with the mouse, touch or keyboard is reachable by name with absolute parameters, so the
// assistant can put the view in the same state and read back what is on screen.
//
// The actions talk to the view through the small SurfaceApi interface, which keeps them
// testable without WebGL.
import { ActionError, defineAction, type ActionDef } from '../../core/actions';
import type { Store } from '../../core/store';
import { isoUtc } from '../../core/time';
import type { SurfaceGround, SurfaceSky } from '../surface';
import type { SiteLike } from './groundSource';

/** The part of SurfaceView the actions use. */
export interface SurfaceApi {
  readonly generated: boolean;
  readonly ground: SurfaceGround | null;
  readonly site: SiteLike | null;
  readonly skyNow: SurfaceSky | null;
  readonly lookDirection: { azDeg: number; elDeg: number; fovDeg: number };
  readonly position: { eastM: number; northM: number; eyeHeightM: number };
  readonly distanceFromSite: number;
  readonly annotations: { tracks: boolean; labels: boolean };
  readonly pathSteps: { sunH: number; earthH: number; startMs: number; durationH: number } | null;
  setGenerated(on: boolean): void;
  setLook(azDeg: number, elDeg: number, fovDeg?: number): void;
  setFov(fovDeg: number): void;
  setPosition(eastM: number, northM: number, liftM?: number): void;
  setAnnotations(tracks: boolean, labels?: boolean): void;
}

export interface SurfaceActionContext {
  store: Store;
  view: SurfaceApi;
  /** True while the surface view is on screen. */
  active: () => boolean;
  /** Tells the HUD that something it shows has changed. */
  changed: () => void;
}

export const MIN_FOV_DEG = 4;
export const MAX_FOV_DEG = 100;
export const MAX_LIFT_M = 500;

const round = (v: number, digits: number) => Number(v.toFixed(digits));

/** The look direction as it goes into the store and into action results: tenths of a degree. */
export function roundedLook(view: SurfaceApi): { azDeg: number; elDeg: number; fovDeg: number } {
  const l = view.lookDirection;
  return { azDeg: round(l.azDeg, 1) % 360, elDeg: round(l.elDeg, 1), fovDeg: round(l.fovDeg, 1) };
}

/** What the scene shows of the sky right now, with units in the names. Null before a site and a time are set. */
export function skySummary(sky: SurfaceSky | null) {
  if (!sky) return null;
  return {
    timeUtc: Number.isFinite(sky.timeMs) ? isoUtc(sky.timeMs) : null,
    directions: sky.topocentric ? 'topocentric (for the site itself), airless' : 'from the Moon\'s centre (interim: Earth up to 0.26 deg off), airless',
    sun: {
      azDeg: round(sky.sun.azDeg, 2),
      elDeg: round(sky.sun.elDeg, 2),
      angularDiameterDeg: round(sky.sun.radiusDeg * 2, 3),
      discAboveDrawnTerrainPct: round(sky.sunAboveTerrain * 100, 0),
      discBehindEarthPct: round(sky.sunBehindEarth * 100, 0),
    },
    earth: {
      azDeg: round(sky.earth.azDeg, 2),
      elDeg: round(sky.earth.elDeg, 2),
      angularDiameterDeg: round(sky.earth.radiusDeg * 2, 3),
      litPct: round(sky.earth.litFraction * 100, 0),
      centreBehindDrawnTerrain: sky.earthBehindTerrain,
    },
    note: 'Visibility here is against the terrain as drawn, from where the viewer stands. The mission-window numbers come from the analysis (getAnalysis). Earth visibility is geometric line of sight, not a radio link.',
  };
}

export function createSurfaceActions(ctx: SurfaceActionContext): ActionDef<any, any>[] {
  const { store, view } = ctx;
  const requireSurface = () => {
    if (!ctx.active()) throw new ActionError('Enter the surface view first (enterSurface).');
  };
  /** Writes the camera direction to the shared state at once, without waiting for the next frame. */
  const publishLook = () => {
    const look = roundedLook(view);
    store.set({ look });
    return look;
  };
  const positionSummary = () => {
    const p = view.position;
    return { eastM: round(p.eastM, 1), northM: round(p.northM, 1), distanceFromSiteM: round(view.distanceFromSite, 1), eyeHeightM: round(p.eyeHeightM, 2) };
  };
  const groundSummary = () => {
    const g = view.ground;
    if (!g) return null;
    return {
      summary: g.summary,
      surveyed: g.surveyed,
      drawnOutToKm: round(g.reachM / 1000, 0),
      bands: g.bands.map((b) => ({
        fromM: b.fromM,
        toM: b.toM,
        gridSpacingM: b.gridM,
        product: b.sources[0]?.name ?? null,
        productResolutionM: b.sources[0] ? round(b.sources[0].resolutionM, 1) : null,
        interpolated: b.interpolated,
      })),
      generated: g.generated,
      generatedDetailShown: view.generated,
      notes: g.notes,
    };
  };

  return [
    defineAction<{ on: boolean }, unknown>({
      name: 'setGeneratedDetail',
      title: 'Generated detail',
      description:
        'In the surface view, shows or hides everything that is generated rather than measured: rocks, craters a few metres across and finer texture near the viewer, faint crater shading on distant ground and, where no survey of the ground exists, the craters and bumps within about 770 m of the site. With it off only measured (or interpolated) terrain is drawn. Sun, Earth and the numbers are never affected.',
      effect: 'command',
      params: { type: 'object', properties: { on: { type: 'boolean', description: 'Show generated detail.' } }, required: ['on'] },
      run: ({ on }) => {
        view.setGenerated(on);
        ctx.changed();
        return { generatedDetail: view.generated, whatIsGenerated: view.ground?.generated ?? null };
      },
    }),
    defineAction<{ fovDeg: number }, unknown>({
      name: 'setFieldOfView',
      title: 'Zoom',
      description: `In the surface view, sets the vertical field of view in degrees (${MIN_FOV_DEG} to ${MAX_FOV_DEG}). 70 is the normal view; about 5 fills the screen with the Sun or Earth, whose discs are drawn at true size (Sun about 0.53 deg, Earth about 1.9 deg). The same as scrolling or pinching.`,
      effect: 'command',
      params: { type: 'object', properties: { fovDeg: { type: 'number', description: 'Vertical field of view, degrees.', minimum: MIN_FOV_DEG, maximum: MAX_FOV_DEG } }, required: ['fovDeg'] },
      run: ({ fovDeg }) => {
        requireSurface();
        view.setFov(fovDeg);
        return { look: publishLook() };
      },
    }),
    defineAction<{ body: 'sun' | 'earth'; fovDeg?: number }, unknown>({
      name: 'lookAtBody',
      title: 'Face the Sun or Earth',
      description:
        'In the surface view, turns the camera to the Sun or Earth at the simulated time and reports its azimuth and elevation and whether the terrain as drawn hides it. Optional `fovDeg` zooms as well (5 shows the disc large). If the body is more than 5 degrees below the horizontal the camera turns to its azimuth and looks at the horizon instead.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          body: { type: 'string', description: 'Which body to face.', enum: ['sun', 'earth'] },
          fovDeg: { type: 'number', description: 'Vertical field of view, degrees.', minimum: MIN_FOV_DEG, maximum: MAX_FOV_DEG },
        },
        required: ['body'],
      },
      run: ({ body, fovDeg }) => {
        requireSurface();
        const sky = view.skyNow;
        if (!sky) throw new ActionError('The sky is not ready yet for this site.');
        const b = body === 'sun' ? sky.sun : sky.earth;
        // A body just under the horizontal can still show over a low skyline, so look straight at it down to -5 degrees.
        view.setLook(b.azDeg, b.elDeg < -5 ? 0 : b.elDeg, fovDeg);
        const summary = skySummary(sky)!;
        return {
          body,
          ...(body === 'sun' ? summary.sun : summary.earth),
          belowHorizontal: b.elDeg < 0,
          look: publishLook(),
          timeUtc: summary.timeUtc,
          directions: summary.directions,
        };
      },
    }),
    defineAction<{ eastM: number; northM: number; liftM?: number }, unknown>({
      name: 'walkTo',
      title: 'Walk to',
      description: `In the surface view, moves the viewer to a point given in metres east and north of the site (0, 0 = the site itself; negative = west / south), like walking there with W A S D. Optional \`liftM\` raises the viewpoint above standing height (0 to ${MAX_LIFT_M} m, like E / Q). The viewer can go about 26 km from the site. Sun, Earth and the analysis stay those of the site.`,
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          eastM: { type: 'number', description: 'Metres east of the site.', minimum: -30000, maximum: 30000 },
          northM: { type: 'number', description: 'Metres north of the site.', minimum: -30000, maximum: 30000 },
          liftM: { type: 'number', description: 'Extra height above standing height, metres.', minimum: 0, maximum: MAX_LIFT_M },
        },
        required: ['eastM', 'northM'],
      },
      run: ({ eastM, northM, liftM }) => {
        requireSurface();
        view.setPosition(eastM, northM, liftM ?? 0);
        const at = positionSummary();
        ctx.changed();
        return { position: at, clamped: Math.abs(at.eastM - eastM) > 0.5 || Math.abs(at.northM - northM) > 0.5 };
      },
    }),
    defineAction<{ tracks?: boolean; labels?: boolean }, unknown>({
      name: 'setSkyAnnotations',
      title: 'Sky paths and labels',
      description:
        'In the surface view, shows or hides the dotted tracks of the Sun (circles) and of Earth (diamonds, its libration path) over the mission window, and the name labels of the two bodies. Filled marks are above the skyline as drawn; hollow marks are where the track runs behind terrain.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          tracks: { type: 'boolean', description: 'Show the Sun and Earth tracks.' },
          labels: { type: 'boolean', description: 'Show the "Sun" and "Earth" labels.' },
        },
      },
      run: ({ tracks, labels }) => {
        if (tracks === undefined && labels === undefined) throw new ActionError('Give `tracks` and/or `labels`.');
        const now = view.annotations;
        view.setAnnotations(tracks ?? now.tracks, labels ?? now.labels);
        ctx.changed();
        return { ...view.annotations, markEvery: view.pathSteps ? { sunH: view.pathSteps.sunH, earthH: view.pathSteps.earthH } : null };
      },
    }),
    defineAction({
      name: 'getSurfaceView',
      title: 'Surface view state',
      description:
        'Reads what the surface view shows: where the camera looks (azimuth, elevation, field of view), where the viewer stands relative to the site, where the Sun and Earth are drawn and whether the drawn terrain hides them, which elevation data the ground is built from at which resolution, and what is generated rather than measured.',
      effect: 'query',
      params: { type: 'object', properties: {} },
      run: () => {
        const s = store.get();
        const steps = view.pathSteps;
        return {
          active: ctx.active(),
          site: view.site ? { id: view.site.id, name: view.site.name ?? view.site.id, latDeg: view.site.lat, lonDegEast: view.site.lon } : null,
          look: roundedLook(view),
          position: positionSummary(),
          sky: skySummary(view.skyNow),
          lighting: s.lightMode === 'real' ? 'real: the Sun\'s direction at the simulated time, shadows cast by the terrain as drawn' : 'even: artificial light for readability, no shadows',
          ground: groundSummary(),
          annotations: {
            ...view.annotations,
            tracks: view.annotations.tracks && steps !== null,
            window: steps ? { startUtc: isoUtc(steps.startMs), durationH: steps.durationH, sunMarkEveryH: steps.sunH, earthMarkEveryH: steps.earthH } : null,
          },
        };
      },
    }),
  ];
}
