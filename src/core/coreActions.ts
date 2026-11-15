// The app's core actions (decision D-1): time, site, view, camera, scenario, overlays,
// filters and comparison. UI controls call these through runAction; the assistant gets the
// same list as tools. Every result is a small JSON object read back from real state.
import { findLanding, landingSite } from '../data/catalog';
import { formatCoords, Landing, landingDate, quickmapUrl, trekUrl } from '../data/landings';
import { ActionError, ActionDef, defineAction } from './actions';
import { reportAnalysis, reportComparison, scenarioFacts, type ReportScience } from './analysisReport';
import { rounded, type AnalysisSlot, type AnalysisStore } from './analysisStore';
import { emitCommand } from './bus';
import { ALL_MISSIONS, matchesFilter, MissionFilter, MissionFilterStore, MissionType } from './missionFilter';
import { moonPhaseAt } from './moonPhase';
import { effectiveStartMs, labelPair, scenarioFromState } from './scenario';
import { EVENT_INFO, EVENT_TYPES, findEvent, type EventType } from './skyEvents';
import { MAX_TIME_MS, MIN_TIME_MS, Store } from './store';
import { isoUtc, parseUtc } from './time';
import { AppState, LightMode, MOON_RADIUS_KM, OverlayMode, pinId, SiteRef, ViewMode, wrapLon } from './types';

/** Camera altitude (km above the reference sphere) for the whole-Moon view. */
export const GLOBE_ALTITUDE_KM = 2.4 * MOON_RADIUS_KM;
/** Camera altitude when a site is selected: about 42 km. */
export const SITE_ALTITUDE_KM = 0.024 * MOON_RADIUS_KM;
export const MIN_ALTITUDE_KM = 10;
export const MAX_ALTITUDE_KM = 8 * MOON_RADIUS_KM;
/** The globe view centres at most this close to a pole, degrees of latitude: exactly on a pole it cannot be turned. */
export const MAX_VIEW_LAT_DEG = 89.9;

export const RATE_PRESETS = [
  { secondsPerSecond: 60, label: '1 min/s' },
  { secondsPerSecond: 600, label: '10 min/s' },
  { secondsPerSecond: 3600, label: '1 hour/s' },
  { secondsPerSecond: 43200, label: '12 hours/s' },
  { secondsPerSecond: 259200, label: '3 days/s' },
] as const;

export interface CoreContext {
  store: Store;
  landings: () => readonly Landing[];
  filters: MissionFilterStore;
  analysis?: AnalysisStore;
  /**
   * Provided by the scene host: resolves when the surface view for this site is ready to
   * show (terrain loaded, camera arrived), rejects with a sentence when it cannot be shown.
   */
  prepareSurface?: (site: SiteRef) => Promise<void>;
  /**
   * Provided by the scene host: resolves when this view is the one on screen. The switch fades
   * over about a third of a second, and what needs the surface on screen (looking at the Sun,
   * zooming) must not run before it.
   */
  viewShown?: (view: ViewMode) => Promise<void>;
  /** The science lookups getAnalysis reads Sun/Earth "now" and the next events from. Defaults to the science core. */
  science?: ReportScience;
  /** How the globe is being drawn (relief exaggeration, coverage outlines, polar close-up), for getState. */
  display?: () => Record<string, unknown>;
  /** What the shell shows that is not in AppState (zoom of the locator map, which panels are open), for getState. */
  shell?: () => ShellState;
}

export interface ShellState {
  /** Zoom of the small whole-Moon locator map: 1 = the whole Moon. */
  locatorZoom: number;
  /** Open (true) or folded away, by the names showPanel takes. */
  panels: Record<string, boolean>;
}

/** Vertical field of view lookAt accepts, degrees: the range of the surface scene (its setFieldOfView). */
export const MIN_LOOK_FOV_DEG = 4;
export const MAX_LOOK_FOV_DEG = 100;

const OVERLAYS: readonly OverlayMode[] = ['off', 'sun-band', 'avg-illumination', 'avg-earth-visibility'];
export { EVENT_TYPES, type EventType } from './skyEvents';
const NO_PARAMS = { type: 'object', properties: {} } as const;

/** What the catalogue says about a landing: the facts on the site card. */
function landingFacts(l: Landing) {
  return {
    program: l.program,
    country: l.country,
    landedUtc: isoUtc(landingDate(l).getTime()),
    crewed: l.crewed,
    region: l.region,
    positionApproximate: Boolean(l.approx),
    /** The catalogue's one-paragraph account of the mission, as on the site card. */
    summary: l.summary,
  };
}

function siteSummary(site: SiteRef | null, landings: readonly Landing[]) {
  if (!site) return null;
  const l = site.kind === 'landing' ? landings.find((x) => x.id === site.id) : undefined;
  return {
    id: site.id,
    name: site.name,
    kind: site.kind,
    latDeg: site.lat,
    lonDegEast: site.lon,
    ...(l && {
      ...landingFacts(l),
      /** The card's two outside links: the same place in LROC QuickMap and in NASA Moon Trek (they open in a new tab; nothing is loaded from them). */
      links: { quickMap: quickmapUrl(l), moonTrek: trekUrl(l) },
    }),
  };
}

function timeSummary(s: Readonly<AppState>) {
  return { timeUtc: isoUtc(s.timeMs), playing: s.playing, rateSimSecondsPerSecond: s.rate };
}

/** The mission window as results report it. `startUtc` is the planned start; the analysed window begins at `effectiveStartUtc` (planned start plus delay). */
function windowSummary(s: Readonly<AppState>) {
  const start = effectiveStartMs(s), end = start + s.windowDurationH * 3_600_000;
  return {
    startUtc: isoUtc(s.windowStartMs),
    durationH: s.windowDurationH,
    delayH: s.delayH,
    effectiveStartUtc: isoUtc(start),
    endUtc: isoUtc(end),
    clockInsideWindow: s.timeMs >= start && s.timeMs <= end,
  };
}

/** Turns the globe to a point; when no scene is listening (tests, headless) records where it would point. */
export function flyGlobeTo(store: Store, lat: number, lon: number, altitudeKm?: number): void {
  const delivered = emitCommand('flyTo', { lat, lon, altitudeKm });
  if (!delivered) store.set({ globeCenter: { lat, lon, altitudeKm: altitudeKm ?? store.get().globeCenter.altitudeKm } });
}

/**
 * Steps down to the surface at the selected site: waits until the scene can show it, switches
 * the view, and returns once the surface is on screen, so the next action can use it at once.
 */
export async function enterSurfaceView(ctx: Pick<CoreContext, 'store' | 'prepareSurface' | 'viewShown'>): Promise<void> {
  const { store } = ctx;
  const site = store.get().site;
  if (!site) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
  if (store.get().view !== 'surface') {
    if (ctx.prepareSurface) {
      try {
        await ctx.prepareSurface(site);
      } catch (err) {
        throw new ActionError(err instanceof Error ? err.message : String(err));
      }
    }
    if (store.get().site?.id !== site.id) throw new ActionError('The selected site changed before the surface view was ready.');
    store.set({ view: 'surface' });
  }
  await ctx.viewShown?.('surface');
}

export function createCoreActions(ctx: CoreContext): ActionDef<any, any>[] {
  const { store } = ctx;
  const state = () => store.get();

  const setTimeClamped = (ms: number) => {
    if (!Number.isFinite(ms) || ms < MIN_TIME_MS || ms > MAX_TIME_MS) {
      throw new ActionError(`Time must be between ${isoUtc(MIN_TIME_MS)} and ${isoUtc(MAX_TIME_MS)} (the span the ephemeris is validated for).`);
    }
    store.set({ timeMs: ms });
  };

  const requireSite = (): SiteRef => {
    const site = state().site;
    if (!site) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return site;
  };

  const flyTo = (lat: number, lon: number, altitudeKm?: number) => flyGlobeTo(store, lat, lon, altitudeKm);

  const enterSurface = () => enterSurfaceView(ctx);

  const viewResult = () => ({ view: state().view, site: siteSummary(state().site, ctx.landings()) });

  const selectedLanding = (): Landing | undefined => {
    const site = state().site;
    return site?.kind === 'landing' ? ctx.landings().find((l) => l.id === site.id) : undefined;
  };

  const checkTime = (ms: number, what: string) => {
    if (!Number.isFinite(ms) || ms < MIN_TIME_MS || ms > MAX_TIME_MS) throw new ActionError(`${what} must be between ${isoUtc(MIN_TIME_MS)} and ${isoUtc(MAX_TIME_MS)} (the span the ephemeris is validated for).`);
    return ms;
  };

  const requireAnalysis = (): AnalysisStore => {
    if (!ctx.analysis) throw new ActionError('The site analysis is not running in this session.');
    return ctx.analysis;
  };

  const filterResult = () => {
    const all = ctx.landings();
    const f = ctx.filters.get();
    const shown = all.filter((l) => matchesFilter(f, l));
    return { shown: shown.length, total: all.length, filter: f, shownIds: shown.map((l) => l.id) };
  };

  return [
    // ---------- time ----------
    defineAction<{ utc?: string; offsetHours?: number }, unknown>({
      name: 'setTime',
      title: 'Set time',
      description:
        'Sets the simulated instant shown in every view (UTC). Give `utc` as "YYYY-MM-DD" or "YYYY-MM-DDTHH:MMZ", or `offsetHours` to move relative to the current simulated time (negative = earlier). Valid from 1950 to 2100.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          utc: { type: 'string', description: 'Absolute UTC date/time, e.g. "2025-03-14T06:00Z".' },
          offsetHours: { type: 'number', description: 'Hours to move from the current simulated time.', minimum: -1e6, maximum: 1e6 },
        },
      },
      run: ({ utc, offsetHours }) => {
        if ((utc === undefined) === (offsetHours === undefined)) throw new ActionError('Give exactly one of `utc` or `offsetHours`.');
        let ms: number;
        try {
          ms = utc !== undefined ? parseUtc(utc) : state().timeMs + offsetHours! * 3_600_000;
        } catch (err) {
          throw new ActionError((err as Error).message);
        }
        setTimeClamped(ms);
        return timeSummary(state());
      },
    }),
    defineAction<{ rate?: number }, unknown>({
      name: 'play',
      title: 'Play',
      description: 'Starts the simulated clock. Optional `rate` in simulated seconds per real second (3600 = one hour per second). A clock that runs into the end of the mission window stops there; play again to go on past it.',
      effect: 'command',
      params: { type: 'object', properties: { rate: { type: 'number', description: 'Simulated seconds per real second.', minimum: 1, maximum: 31_536_000 } } },
      run: ({ rate }) => {
        if (state().lightMode === 'even') store.set({ lightMode: 'real' });
        store.set({ playing: true, ...(rate !== undefined && { rate }) });
        return timeSummary(state());
      },
    }),
    defineAction({
      name: 'pause',
      title: 'Pause',
      description: 'Stops the simulated clock at the current instant.',
      effect: 'command',
      params: NO_PARAMS,
      run: () => {
        store.set({ playing: false });
        return timeSummary(state());
      },
    }),
    defineAction<{ secondsPerSecond: number }, unknown>({
      name: 'setRate',
      title: 'Set playback speed',
      description: 'Sets how fast the simulated clock runs while playing, in simulated seconds per real second (60 = 1 min/s, 600 = 10 min/s, 3600 = 1 h/s, 86400 = 1 day/s).',
      effect: 'command',
      params: { type: 'object', properties: { secondsPerSecond: { type: 'number', description: 'Simulated seconds per real second.', minimum: 1, maximum: 31_536_000 } }, required: ['secondsPerSecond'] },
      run: ({ secondsPerSecond }) => {
        store.set({ rate: secondsPerSecond });
        return timeSummary(state());
      },
    }),
    defineAction<{ mode: LightMode }, unknown>({
      name: 'setLightMode',
      title: 'Set lighting',
      description: '"real" lights the Moon from the Sun\'s true direction at the simulated time; "even" lights every site from the viewer for readability (not real; pauses the clock).',
      effect: 'command',
      params: { type: 'object', properties: { mode: { type: 'string', description: 'Lighting mode.', enum: ['real', 'even'] } }, required: ['mode'] },
      run: ({ mode }) => {
        store.set({ lightMode: mode, ...(mode === 'even' && { playing: false }) });
        return { lightMode: state().lightMode, playing: state().playing };
      },
    }),

    defineAction<{ type: EventType; which?: 'next' | 'previous' }, unknown>({
      name: 'jumpToEvent',
      title: 'Jump to sunrise / sunset / Earthrise / Earthset',
      description:
        'Moves the clock to the next (or previous) sunrise, sunset, Earthrise or Earthset at the selected site and pauses it. ' +
        `A rise or set takes time, so each is one defined instant, named in the result's \`instant\`: sunrise = ${EVENT_INFO.sunrise.instant} ("${EVENT_INFO.sunrise.label}"); sunset = ${EVENT_INFO.sunset.instant} ("${EVENT_INFO.sunset.label}"); Earthrise and Earthset = the centre of Earth's disc crossing the skyline. Say which instant a time is when you quote it. ` +
        'The times come from the site analysis, so they are measured against the terrain skyline, and only events inside the analysed mission window can be reached (lengthen the window with setMissionWindow to look further). Waits for the analysis if it is still running.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Event type.', enum: EVENT_TYPES },
          which: { type: 'string', description: 'next (default) or previous, relative to the current simulated time.', enum: ['next', 'previous'] },
        },
        required: ['type'],
      },
      run: async ({ type, which = 'next' }) => {
        const st = await requireAnalysis().settled('current');
        if (st.state === 'idle') throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
        if (st.state !== 'ready') throw new ActionError(st.state === 'error' ? `The site analysis is not available: ${st.error}` : 'The site analysis has not finished. Ask again in a moment.');
        const hit = findEvent(st.value.events, type, which, state().timeMs);
        if (!hit) {
          const from = isoUtc(st.scenario.startMs), to = isoUtc(st.scenario.startMs + st.scenario.durationH * 3_600_000);
          throw new ActionError(`There is no ${which} ${type} ${which === 'next' ? 'after' : 'before'} the simulated time inside the analysed mission window (${from} to ${to}). Here "${type}" is the instant ${EVENT_INFO[type].instant}.`);
        }
        store.set({ timeMs: hit.timeMs, playing: false });
        return { event: type, label: EVENT_INFO[type].label, instant: EVENT_INFO[type].instant, timeUtc: isoUtc(hit.timeMs), azDeg: rounded(hit.azDeg, 1), playing: false };
      },
    }),

    // ---------- site and view ----------
    defineAction<{ site: string; surface?: boolean; atLanding?: boolean; fly?: boolean }, unknown>({
      name: 'selectSite',
      title: 'Select landing site',
      description:
        'Selects a catalogued landing site by id or name (e.g. "apollo-11", "Apollo 11", "Chang\'e 4") and flies the globe to it. ' +
        'With `atLanding: true` it also lines everything up with that mission: the clock and the mission window start are set to the touchdown time (UTC), any arrival delay is cleared, sunlight is real and the clock is paused, so "IM-2 at its landing" is one step. ' +
        'With `surface: true` it then steps down into the surface view. `fly: false` keeps the camera where it is. Custom coordinates use dropPin instead.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Landing id or name.' },
          atLanding: { type: 'boolean', description: 'Also set the clock and the mission window start to the touchdown time and clear the arrival delay.' },
          surface: { type: 'boolean', description: 'Enter the surface view once the camera arrives.' },
          fly: { type: 'boolean', description: 'Fly the globe to the site (default true).' },
        },
        required: ['site'],
      },
      run: async ({ site, surface, atLanding, fly }) => {
        const all = ctx.landings();
        const pinned = /^pin:(-?[\d.]+),(-?[\d.]+)$/.exec(site.trim());
        let ref: SiteRef;
        let landing: Landing | undefined;
        if (pinned) {
          const lat = Number(pinned[1]), lon = wrapLon(Number(pinned[2]));
          if (!(Math.abs(lat) <= 90)) throw new ActionError('Pin latitude must be within -90..90.');
          ref = { id: pinId(lat, lon), name: `Pin ${formatCoords(lat, lon)}`, kind: 'custom', lat, lon };
        } else {
          landing = findLanding(site, all);
          if (!landing) throw new ActionError(`No catalogued landing matches "${site}". Known sites: ${all.map((x) => x.name).join(', ')}.`);
          ref = landingSite(landing);
        }
        if (atLanding && !landing) throw new ActionError('`atLanding` needs a catalogued landing: a pin has no landing date. Use setMissionWindow and setTime for a pin.');
        const touchdown = atLanding ? checkTime(landingDate(landing!).getTime(), 'The landing time') : null;
        if (state().view === 'surface' && state().site?.id !== ref.id) store.set({ view: 'globe' });
        store.set({ site: ref });
        if (touchdown !== null) store.set({ timeMs: touchdown, windowStartMs: touchdown, delayH: 0, playing: false, lightMode: 'real' });
        if (fly !== false) flyTo(ref.lat, ref.lon, SITE_ALTITUDE_KM);
        if (surface) await enterSurface();
        return { ...viewResult(), ...(touchdown !== null && { ...timeSummary(state()), missionWindow: windowSummary(state()), lightMode: state().lightMode }) };
      },
    }),
    defineAction<{ lat: number; lon: number; fly?: boolean }, unknown>({
      name: 'dropPin',
      title: 'Drop a pin',
      description:
        'Selects any coordinate on the Moon as the site under study (latitude north-positive, longitude EAST-positive, degrees). With `fly: true` the globe also flies down to it.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude, degrees north-positive.', minimum: -90, maximum: 90 },
          lon: { type: 'number', description: 'Longitude, degrees east-positive.', minimum: -360, maximum: 360 },
          fly: { type: 'boolean', description: 'Fly the camera down to the pin.' },
        },
        required: ['lat', 'lon'],
      },
      run: ({ lat, lon, fly }) => {
        const w = wrapLon(lon);
        const ref: SiteRef = { id: pinId(lat, w), name: `Pin ${formatCoords(lat, w)}`, kind: 'custom', lat, lon: w };
        if (state().view === 'surface') store.set({ view: 'globe' });
        store.set({ site: ref });
        if (fly) flyTo(lat, w, SITE_ALTITUDE_KM);
        return viewResult();
      },
    }),
    defineAction({
      name: 'clearSite',
      title: 'Clear site',
      description: 'Deselects the current site or pin and returns to the whole-Moon globe view.',
      effect: 'command',
      params: NO_PARAMS,
      run: () => {
        const { lat, lon } = state().site ?? state().globeCenter;
        store.set({ site: null, view: 'globe' });
        flyTo(lat, lon, GLOBE_ALTITUDE_KM);
        return viewResult();
      },
    }),
    defineAction({
      name: 'enterSurface',
      title: 'Enter surface view',
      description: 'Steps down to stand on the surface at the selected site, looking at the real skyline with the Sun and Earth in place. Needs a selected site with terrain data.',
      effect: 'command',
      params: NO_PARAMS,
      run: async () => {
        await enterSurface();
        return viewResult();
      },
    }),
    defineAction({
      name: 'exitSurface',
      title: 'Back to globe',
      description: 'Leaves the surface view and returns to the globe, keeping the selected site.',
      effect: 'command',
      params: NO_PARAMS,
      run: () => {
        store.set({ view: 'globe' });
        return viewResult();
      },
    }),
    defineAction<{ lat: number; lon: number; altitudeKm?: number }, unknown>({
      name: 'setGlobeCamera',
      title: 'Turn the globe',
      description: `Turns the globe so the point (lat, lon east-positive, degrees) is under the screen centre, at an optional camera altitude above the surface in km (${MIN_ALTITUDE_KM} to ${Math.round(MAX_ALTITUDE_KM)}; whole Moon about ${Math.round(GLOBE_ALTITUDE_KM)}). Switches to the globe view.`,
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude, degrees north-positive.', minimum: -90, maximum: 90 },
          lon: { type: 'number', description: 'Longitude, degrees east-positive.', minimum: -360, maximum: 360 },
          altitudeKm: { type: 'number', description: 'Camera altitude above the surface, km.', minimum: MIN_ALTITUDE_KM, maximum: MAX_ALTITUDE_KM },
        },
        required: ['lat', 'lon'],
      },
      run: ({ lat, lon, altitudeKm }) => {
        if (state().view !== 'globe') store.set({ view: 'globe' });
        flyTo(lat, wrapLon(lon), altitudeKm);
        const centredLat = Math.max(-MAX_VIEW_LAT_DEG, Math.min(MAX_VIEW_LAT_DEG, lat));
        return {
          view: 'globe',
          target: { latDeg: lat, lonDegEast: wrapLon(lon), altitudeKm: altitudeKm ?? null },
          ...(centredLat !== lat && {
            centredLatDeg: centredLat,
            note: `The view centres ${MAX_VIEW_LAT_DEG} degrees from the equator at most: exactly on a pole the globe cannot be turned. A pin can still go on the pole itself (dropPin).`,
          }),
        };
      },
    }),
    defineAction<{ azDeg: number; elDeg?: number; fovDeg?: number }, unknown>({
      name: 'lookAt',
      title: 'Look towards',
      description: `In the surface view, turns the camera to an azimuth (degrees clockwise from north) and optional elevation (degrees above horizontal) and vertical field of view (${MIN_LOOK_FOV_DEG} to ${MAX_LOOK_FOV_DEG} degrees: 70 is the normal view, about 5 fills the screen with the Sun or Earth). Tip: use the Sun or Earth azimuth from the analysis results.`,
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          azDeg: { type: 'number', description: 'Azimuth, degrees clockwise from north.', minimum: -360, maximum: 720 },
          elDeg: { type: 'number', description: 'Elevation, degrees above horizontal.', minimum: -85, maximum: 85 },
          fovDeg: { type: 'number', description: 'Vertical field of view, degrees.', minimum: MIN_LOOK_FOV_DEG, maximum: MAX_LOOK_FOV_DEG },
        },
        required: ['azDeg'],
      },
      run: ({ azDeg, elDeg, fovDeg }) => {
        if (state().view !== 'surface') throw new ActionError('Enter the surface view first (enterSurface).');
        const look = { azDeg: ((azDeg % 360) + 360) % 360, elDeg: elDeg ?? state().look.elDeg, fovDeg: fovDeg ?? state().look.fovDeg };
        store.set({ look });
        emitCommand('lookAt', { azDeg: look.azDeg, elDeg: look.elDeg });
        return { look };
      },
    }),

    // ---------- scenario ----------
    defineAction<{ metres: number }, unknown>({
      name: 'setMastHeight',
      title: 'Set mast height',
      description: 'Sets the observer (antenna / solar array) height above the local terrain, metres. A higher mast sees over nearby ridges.',
      effect: 'command',
      params: { type: 'object', properties: { metres: { type: 'number', description: 'Height above terrain, metres.', minimum: 0, maximum: 100 } }, required: ['metres'] },
      run: ({ metres }) => {
        store.set({ mastHeightM: metres });
        return { mastHeightM: state().mastHeightM };
      },
    }),
    defineAction<{ startUtc?: string; durationH?: number; moveClock?: boolean }, unknown>({
      name: 'setMissionWindow',
      title: 'Set mission window',
      description:
        'Sets the mission window the analysis evaluates (it starts at arrival). `startUtc`: "YYYY-MM-DDTHH:MMZ", or "now" for the current simulated time, or "landing" for the touchdown time of the selected catalogued landing. `durationH`: length in hours. ' +
        '`moveClock: true` also sets the simulated clock to the start of the window (planned start plus any arrival delay), so the views show the moment of arrival. Without it the clock stays where it is, which may be outside the new window.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          startUtc: { type: 'string', description: 'Planned window start (UTC), "now" for the simulated time, or "landing" for the selected landing\'s touchdown.' },
          durationH: { type: 'number', description: 'Window length, hours.', minimum: 1, maximum: 8760 },
          moveClock: { type: 'boolean', description: 'Also set the simulated clock to the start of the window.' },
        },
      },
      run: ({ startUtc, durationH, moveClock }) => {
        if (startUtc === undefined && durationH === undefined && !moveClock) throw new ActionError('Give `startUtc` and/or `durationH` (or `moveClock: true` to bring the clock to the window start).');
        let start = state().windowStartMs;
        if (startUtc !== undefined) {
          const word = startUtc.trim().toLowerCase();
          if (word === 'now') start = state().timeMs;
          else if (word === 'landing') {
            const l = selectedLanding();
            if (!l) throw new ActionError('"landing" needs a selected catalogued landing site (selectSite). A pin has no landing date.');
            start = landingDate(l).getTime();
          } else {
            try {
              start = parseUtc(startUtc);
            } catch (err) {
              throw new ActionError((err as Error).message);
            }
          }
          checkTime(start, 'The window start');
        }
        const next = { windowStartMs: start, windowDurationH: durationH ?? state().windowDurationH, delayH: state().delayH };
        if (moveClock) checkTime(effectiveStartMs(next), 'The window start plus the arrival delay');
        store.set({ windowStartMs: start, ...(durationH !== undefined && { windowDurationH: durationH }) });
        if (moveClock) store.set({ timeMs: effectiveStartMs(state()) });
        const w = windowSummary(state());
        return { windowStartUtc: w.startUtc, windowDurationH: w.durationH, delayH: w.delayH, effectiveStartUtc: w.effectiveStartUtc, windowEndUtc: w.endUtc, timeUtc: isoUtc(state().timeMs), clockInsideWindow: w.clockInsideWindow };
      },
    }),
    defineAction<{ hours: number }, unknown>({
      name: 'setDelay',
      title: 'Set arrival delay',
      description: 'Explores a late arrival at the same site: shifts the mission window start by this many hours (0 = on time, 24 = one day late).',
      effect: 'command',
      params: { type: 'object', properties: { hours: { type: 'number', description: 'Delay, hours.', minimum: 0, maximum: 720 } }, required: ['hours'] },
      run: ({ hours }) => {
        store.set({ delayH: hours });
        const w = windowSummary(state());
        return { delayH: w.delayH, plannedStartUtc: w.startUtc, effectiveStartUtc: w.effectiveStartUtc, clockInsideWindow: w.clockInsideWindow };
      },
    }),
    defineAction<{ degrees: number }, unknown>({
      name: 'setSlopeLimit',
      title: 'Set slope limit',
      description: 'Maximum terrain slope (degrees) acceptable for nearby alternative sites.',
      effect: 'command',
      params: { type: 'object', properties: { degrees: { type: 'number', description: 'Slope limit, degrees.', minimum: 0, maximum: 45 } }, required: ['degrees'] },
      run: ({ degrees }) => {
        store.set({ slopeLimitDeg: degrees });
        return { slopeLimitDeg: state().slopeLimitDeg };
      },
    }),
    defineAction<{ hours?: number }, unknown>({
      name: 'setMaxEarthGap',
      title: 'Set max Earth gap',
      description: 'Largest gap in Earth visibility the mission tolerates, hours. Omit `hours` to remove the requirement.',
      effect: 'command',
      params: { type: 'object', properties: { hours: { type: 'number', description: 'Maximum gap, hours.', minimum: 0, maximum: 8760 } } },
      run: ({ hours }) => {
        store.set({ maxEarthGapH: hours ?? null });
        return { maxEarthGapH: state().maxEarthGapH };
      },
    }),
    defineAction<{ minDeg: number; maxDeg: number }, unknown>({
      name: 'setSunBand',
      title: 'Set solar elevation band',
      description: 'Required solar elevation band, degrees above the horizontal (min < elevation < max). Drives the "sun-band" overlay on the globe.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          minDeg: { type: 'number', description: 'Lowest acceptable solar elevation, degrees.', minimum: -90, maximum: 90 },
          maxDeg: { type: 'number', description: 'Highest acceptable solar elevation, degrees.', minimum: -90, maximum: 90 },
        },
        required: ['minDeg', 'maxDeg'],
      },
      run: ({ minDeg, maxDeg }) => {
        if (!(minDeg < maxDeg)) throw new ActionError('minDeg must be lower than maxDeg.');
        store.set({ sunElMinDeg: minDeg, sunElMaxDeg: maxDeg });
        return { sunElMinDeg: minDeg, sunElMaxDeg: maxDeg };
      },
    }),
    defineAction<{ mode: OverlayMode }, unknown>({
      name: 'setOverlay',
      title: 'Set globe overlay',
      description:
        'Colour overlay on the globe: "off"; "sun-band" = where the Sun is inside the required elevation band at the simulated time (smooth Moon, no terrain); "avg-illumination" / "avg-earth-visibility" = published multi-year averages (NASA PGDA product 69, polar regions only).',
      effect: 'command',
      params: { type: 'object', properties: { mode: { type: 'string', description: 'Overlay.', enum: OVERLAYS } }, required: ['mode'] },
      run: ({ mode }) => {
        store.set({ overlay: mode });
        return { overlay: state().overlay };
      },
    }),
    defineAction<{ show: boolean }, unknown>({
      name: 'showMissions',
      title: 'Show previous missions',
      description: 'Shows or hides the markers of catalogued landings on the globe.',
      effect: 'command',
      params: { type: 'object', properties: { show: { type: 'boolean', description: 'Show the landing markers.' } }, required: ['show'] },
      run: ({ show }) => {
        store.set({ showMissions: show });
        return { showMissions: state().showMissions };
      },
    }),
    defineAction<{ show: boolean }, unknown>({
      name: 'showFlags',
      title: 'Show country flags',
      description:
        'Shows or hides a 3D flag on each landing marker for the state the hardware there belongs to (GCAT catalogue; USSR hardware is shown as Russia, its successor state).',
      effect: 'command',
      params: { type: 'object', properties: { show: { type: 'boolean', description: 'Show the flags.' } }, required: ['show'] },
      run: ({ show }) => {
        store.set({ showFlags: show });
        return { showFlags: state().showFlags };
      },
    }),
    defineAction<{ programs?: string[]; countries?: string[]; type?: MissionType; fromYear?: number; toYear?: number; reset?: boolean }, unknown>({
      name: 'setFilters',
      title: 'Filter landings',
      description:
        'Chooses which catalogued landings are shown. Lists replace the current selection (an empty list hides all); omitted fields stay as they are; `reset: true` shows everything first. Selecting a site that the filter hides deselects it.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          programs: { type: 'array', description: 'Programs to show, e.g. ["Apollo", "Luna"].', items: { type: 'string', description: 'Program name.' } },
          countries: { type: 'array', description: 'Countries to show, e.g. ["USA", "China"].', items: { type: 'string', description: 'Country name.' } },
          type: { type: 'string', description: 'Crewed, robotic or all.', enum: ['all', 'crewed', 'robotic'] },
          fromYear: { type: 'integer', description: 'First year shown.', minimum: 1950, maximum: 2100 },
          toYear: { type: 'integer', description: 'Last year shown.', minimum: 1950, maximum: 2100 },
          reset: { type: 'boolean', description: 'Start from "show everything".' },
        },
      },
      run: ({ programs, countries, type, fromYear, toYear, reset }) => {
        const all = ctx.landings();
        const pick = (given: string[] | undefined, known: string[], what: string) => {
          if (given === undefined) return undefined;
          const out: string[] = [];
          for (const g of given) {
            const hit = known.find((k) => k.toLowerCase() === g.trim().toLowerCase());
            if (!hit) throw new ActionError(`Unknown ${what} "${g}". Known: ${known.join(', ')}.`);
            out.push(hit);
          }
          return out.length === known.length ? null : out;
        };
        const prev = reset ? ALL_MISSIONS : ctx.filters.get();
        const next: MissionFilter = {
          programs: programs !== undefined ? pick(programs, [...new Set(all.map((l) => l.program))], 'program')! : prev.programs,
          countries: countries !== undefined ? pick(countries, [...new Set(all.map((l) => l.country))], 'country')! : prev.countries,
          type: type ?? prev.type,
          fromYear: fromYear !== undefined ? fromYear : prev.fromYear,
          toYear: toYear !== undefined ? toYear : prev.toYear,
        };
        if (next.fromYear !== null && next.toYear !== null && next.fromYear > next.toYear) throw new ActionError('fromYear must not be after toYear.');
        ctx.filters.set(next);
        const site = state().site;
        if (site?.kind === 'landing') {
          const l = all.find((x) => x.id === site.id);
          if (l && !matchesFilter(next, l)) store.set({ site: null, view: 'globe' });
        }
        return filterResult();
      },
    }),

    // ---------- comparison ----------
    defineAction<{ slot: 'A' | 'B'; label?: string }, unknown>({
      name: 'saveScenario',
      title: 'Save scenario for comparison',
      description:
        'Saves the current scenario (site, mission window including any arrival delay, mast height) into comparison slot A or B. Without a `label` the two slots are named after their sites, plus what differs between them when the site is the same (arrival, mast height, window length). Returns immediately; `compare` waits for the analyses.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          slot: { type: 'string', description: 'Comparison slot.', enum: ['A', 'B'] },
          label: { type: 'string', description: 'Optional short label.' },
        },
        required: ['slot'],
      },
      run: ({ slot, label }) => {
        requireSite();
        const sc = scenarioFromState(state(), label)!;
        // Name both sides so they can be told apart ("... (earlier arrival)" / "... (arrival 24 h later)").
        const [a, b] = slot === 'A' ? labelPair(sc, state().compareB) : labelPair(state().compareA, sc);
        store.set({ compareA: a, compareB: b });
        const saved = (slot === 'A' ? a : b)!;
        return {
          slot,
          scenario: { label: saved.label, siteId: saved.site.id, startUtc: isoUtc(saved.startMs), durationH: saved.durationH, mastHeightM: saved.mastHeightM },
          labels: { A: a?.label ?? null, B: b?.label ?? null },
        };
      },
    }),
    defineAction({
      name: 'compare',
      title: 'Compare A and B',
      description:
        'Opens the side-by-side comparison of the scenarios saved in slots A and B (use saveScenario first), waits until both analyses have finished, and returns both sides with `diff`: B minus A for illumination (percentage points), longest darkness (h), Earth line of sight (percentage points), longest Earth gap (h) and slope (deg), plus the headline differences in words.',
      effect: 'command',
      params: NO_PARAMS,
      run: async () => {
        const s = state();
        const missing = [!s.compareA && 'A', !s.compareB && 'B'].filter(Boolean);
        if (missing.length) throw new ActionError(`Save a scenario in slot ${missing.join(' and ')} first (saveScenario).`);
        const [a, b] = labelPair(s.compareA, s.compareB);
        store.set({ compareA: a, compareB: b, comparing: true });
        const result = ctx.analysis ? reportComparison(await ctx.analysis.settledComparison()) : { diff: null, error: 'The site analysis is not running in this session.' };
        // Read the state again: the wait can take seconds and the slots may have been renamed or closed meanwhile.
        const now = state();
        return {
          comparing: now.comparing,
          A: now.compareA?.label ?? null,
          B: now.compareB?.label ?? null,
          scenarioA: now.compareA ? scenarioFacts(now.compareA) : null,
          scenarioB: now.compareB ? scenarioFacts(now.compareB) : null,
          analysisA: ctx.analysis?.summary('A') ?? null,
          analysisB: ctx.analysis?.summary('B') ?? null,
          ...result,
        };
      },
    }),
    defineAction({
      name: 'stopCompare',
      title: 'Close comparison',
      description: 'Closes the side-by-side comparison. Saved scenarios are kept.',
      effect: 'command',
      params: NO_PARAMS,
      run: () => {
        store.set({ comparing: false });
        return { comparing: false };
      },
    }),

    // ---------- query ----------
    defineAction<{ shownOnly?: boolean }, unknown>({
      name: 'listSites',
      title: 'List the landing catalogue',
      description:
        'Lists the catalogued Moon landings (the markers on the globe), oldest first: id, name, latitude and longitude (degrees, longitude east-positive), touchdown time (UTC), program, country, crewed or robotic, region and the catalogue\'s short account of the mission. Each row says whether the current mission filters show it (`shown`); with `shownOnly: true` only those rows are returned. Changes nothing. Pass an `id` or `name` to selectSite to go there.',
      effect: 'query',
      params: { type: 'object', properties: { shownOnly: { type: 'boolean', description: 'Only the landings the current filters show (default: all of them, each marked).' } } },
      run: ({ shownOnly }) => {
        const f = ctx.filters.get();
        const rows = ctx.landings().map((l) => ({ id: l.id, name: l.name, latDeg: l.lat, lonDegEast: l.lon, ...landingFacts(l), shown: matchesFilter(f, l) }));
        const sites = shownOnly ? rows.filter((r) => r.shown) : rows;
        return {
          total: rows.length,
          shown: rows.filter((r) => r.shown).length,
          listed: sites.length,
          filter: f,
          /** False when "Show previous missions" is off: no marker is drawn, whatever the filters say. */
          markersOnGlobe: state().showMissions,
          selectedId: state().site?.kind === 'landing' ? state().site!.id : null,
          sites,
        };
      },
    }),
    defineAction<{ slot?: AnalysisSlot }, unknown>({
      name: 'getAnalysis',
      title: 'Read the site analysis',
      description:
        'Waits until the analysis of the scenario on screen (default), or of comparison slot "A" or "B", has finished, then returns it: window metrics (illumination %, longest darkness, Earth line of sight %, longest Earth gap), ground slope, where the Sun and Earth are at the simulated time (azimuth, elevation, clearance above the terrain skyline, the terrain that forms the skyline there), the next sunrise / sunset / Earthrise / Earthset in the window (each a defined instant: see `eventDefinitions` in the result, and say which instant a time is when you quote it), darkness and Earth-gap intervals, the user\'s requirements checked against it, data sources, assumptions and warnings. ' +
        'Use this after selecting a site or changing the window, mast or delay. `state` is "ready", or "error" / "idle" with the reason in `error`. Earth figures are geometric line of sight, not a radio link.',
      effect: 'query',
      params: { type: 'object', properties: { slot: { type: 'string', description: 'Which analysis: the scenario on screen, or a saved comparison slot.', enum: ['current', 'A', 'B'] } } },
      run: async ({ slot = 'current' }) => reportAnalysis(slot, await requireAnalysis().settled(slot), state(), ctx.science),
    }),
    defineAction({
      name: 'getState',
      title: 'Current state',
      description:
        'Reads what is on screen now, without waiting: view, simulated time (UTC) with the Moon\'s phase as seen from Earth, site (for a catalogued landing with its facts, summary and outside links), globe camera, surface look direction, mission window, mast, delay, requirements, overlay, filters, comparison slots, how the globe is drawn (relief exaggeration, coverage outlines, polar close-up), the zoom of the locator map, which panels are open, and the status of the current analysis (which may still be "loading": use getAnalysis for results).',
      effect: 'query',
      params: NO_PARAMS,
      run: () => {
        const s = state();
        const f = filterResult();
        const shell = ctx.shell?.();
        return {
          view: s.view,
          ...timeSummary(s),
          /** The line under the time scrubber: the Moon's phase as seen from Earth at the simulated time, and whether the Moon is in Earth's shadow (in-app ephemeris model, geometric discs). */
          moonPhase: moonPhaseAt(s.timeMs),
          lightMode: s.lightMode,
          site: siteSummary(s.site, ctx.landings()),
          globeCenter: { latDeg: s.globeCenter.lat, lonDegEast: s.globeCenter.lon, altitudeKm: s.globeCenter.altitudeKm },
          look: s.view === 'surface' ? s.look : null,
          missionWindow: windowSummary(s),
          mastHeightM: s.mastHeightM,
          slopeLimitDeg: s.slopeLimitDeg,
          maxEarthGapH: s.maxEarthGapH,
          sunBandDeg: { min: s.sunElMinDeg, max: s.sunElMaxDeg },
          overlay: s.overlay,
          showMissions: s.showMissions,
          showFlags: s.showFlags,
          missionsShown: { shown: f.shown, total: f.total, filter: f.filter },
          compare: { A: s.compareA?.label ?? null, B: s.compareB?.label ?? null, open: s.comparing },
          globeDisplay: ctx.display?.() ?? null,
          locatorZoom: shell?.locatorZoom ?? null,
          panels: shell?.panels ?? null,
          analysis: ctx.analysis?.summary('current') ?? null,
        };
      },
    }),
  ];
}
