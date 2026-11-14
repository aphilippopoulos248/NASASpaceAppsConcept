// The app's core actions (decision D-1): time, site, view, camera, scenario, overlays,
// filters and comparison. UI controls call these through runAction; the assistant gets the
// same list as tools. Every result is a small JSON object read back from real state.
import { findLanding, landingSite } from '../data/catalog';
import { formatCoords, Landing, landingDate } from '../data/landings';
import { ActionError, ActionDef, defineAction } from './actions';
import type { AnalysisStore } from './analysisStore';
import { emitCommand } from './bus';
import { ALL_MISSIONS, matchesFilter, MissionFilter, MissionFilterStore, MissionType } from './missionFilter';
import { scenarioFromState } from './scenario';
import { MAX_TIME_MS, MIN_TIME_MS, Store } from './store';
import { isoUtc, parseUtc } from './time';
import { AppState, LightMode, MOON_RADIUS_KM, OverlayMode, pinId, SiteRef, wrapLon } from './types';

/** Camera altitude (km above the reference sphere) for the whole-Moon view. */
export const GLOBE_ALTITUDE_KM = 2.4 * MOON_RADIUS_KM;
/** Camera altitude when a site is selected: about 42 km. */
export const SITE_ALTITUDE_KM = 0.024 * MOON_RADIUS_KM;
export const MIN_ALTITUDE_KM = 10;
export const MAX_ALTITUDE_KM = 8 * MOON_RADIUS_KM;

export const RATE_PRESETS = [
  { secondsPerSecond: 60, label: '1 min/s' },
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
}

const OVERLAYS: readonly OverlayMode[] = ['off', 'sun-band', 'avg-illumination', 'avg-earth-visibility'];
const NO_PARAMS = { type: 'object', properties: {} } as const;

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
      program: l.program,
      country: l.country,
      landedUtc: isoUtc(landingDate(l).getTime()),
      crewed: l.crewed,
      region: l.region,
      positionApproximate: Boolean((l as Landing & { approx?: boolean }).approx),
    }),
  };
}

function timeSummary(s: Readonly<AppState>) {
  return { timeUtc: isoUtc(s.timeMs), playing: s.playing, rateSimSecondsPerSecond: s.rate };
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

  const flyTo = (lat: number, lon: number, altitudeKm?: number) => {
    const delivered = emitCommand('flyTo', { lat, lon, altitudeKm });
    // Nothing is rendering the globe (tests, headless): record where it would point.
    if (!delivered) store.set({ globeCenter: { lat, lon, altitudeKm: altitudeKm ?? state().globeCenter.altitudeKm } });
  };

  const enterSurface = async () => {
    const site = requireSite();
    if (state().view === 'surface') return;
    if (ctx.prepareSurface) {
      try {
        await ctx.prepareSurface(site);
      } catch (err) {
        throw new ActionError(err instanceof Error ? err.message : String(err));
      }
    }
    if (state().site?.id !== site.id) throw new ActionError('The selected site changed before the surface view was ready.');
    store.set({ view: 'surface' });
  };

  const viewResult = () => ({ view: state().view, site: siteSummary(state().site, ctx.landings()) });

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
      description: 'Starts the simulated clock. Optional `rate` in simulated seconds per real second (3600 = one hour per second).',
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
      description: 'Sets how fast the simulated clock runs while playing, in simulated seconds per real second (60 = 1 min/s, 3600 = 1 h/s, 86400 = 1 day/s).',
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

    // ---------- site and view ----------
    defineAction<{ site: string; surface?: boolean }, unknown>({
      name: 'selectSite',
      title: 'Select landing site',
      description:
        'Selects a catalogued landing site by id or name (e.g. "apollo-11", "Apollo 11", "Chang\'e 4") and flies the globe to it. With `surface: true` it then steps down into the surface view. Custom coordinates use dropPin instead.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          site: { type: 'string', description: 'Landing id or name.' },
          surface: { type: 'boolean', description: 'Enter the surface view once the camera arrives.' },
        },
        required: ['site'],
      },
      run: async ({ site, surface }) => {
        const all = ctx.landings();
        const pinned = /^pin:(-?[\d.]+),(-?[\d.]+)$/.exec(site.trim());
        let ref: SiteRef;
        if (pinned) {
          const lat = Number(pinned[1]), lon = wrapLon(Number(pinned[2]));
          if (!(Math.abs(lat) <= 90)) throw new ActionError('Pin latitude must be within -90..90.');
          ref = { id: pinId(lat, lon), name: `Pin ${formatCoords(lat, lon)}`, kind: 'custom', lat, lon };
        } else {
          const l = findLanding(site, all);
          if (!l) throw new ActionError(`No catalogued landing matches "${site}". Known sites: ${all.map((x) => x.name).join(', ')}.`);
          ref = landingSite(l);
        }
        if (state().view === 'surface' && state().site?.id !== ref.id) store.set({ view: 'globe' });
        store.set({ site: ref });
        flyTo(ref.lat, ref.lon, SITE_ALTITUDE_KM);
        if (surface) await enterSurface();
        return viewResult();
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
        return { view: 'globe', target: { latDeg: lat, lonDegEast: wrapLon(lon), altitudeKm: altitudeKm ?? null } };
      },
    }),
    defineAction<{ azDeg: number; elDeg?: number; fovDeg?: number }, unknown>({
      name: 'lookAt',
      title: 'Look towards',
      description: 'In the surface view, turns the camera to an azimuth (degrees clockwise from north) and optional elevation (degrees above horizontal) and field of view (degrees). Tip: use the Sun or Earth azimuth from the analysis results.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          azDeg: { type: 'number', description: 'Azimuth, degrees clockwise from north.', minimum: -360, maximum: 720 },
          elDeg: { type: 'number', description: 'Elevation, degrees above horizontal.', minimum: -85, maximum: 85 },
          fovDeg: { type: 'number', description: 'Vertical field of view, degrees.', minimum: 20, maximum: 90 },
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
    defineAction<{ startUtc?: string; durationH?: number }, unknown>({
      name: 'setMissionWindow',
      title: 'Set mission window',
      description: 'Sets the mission window evaluated by the analysis: `startUtc` (arrival, "YYYY-MM-DDTHH:MMZ", or "now" for the current simulated time) and/or `durationH` in hours.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          startUtc: { type: 'string', description: 'Window start (UTC), or "now" for the simulated time.' },
          durationH: { type: 'number', description: 'Window length, hours.', minimum: 1, maximum: 8760 },
        },
      },
      run: ({ startUtc, durationH }) => {
        if (startUtc === undefined && durationH === undefined) throw new ActionError('Give `startUtc` and/or `durationH`.');
        let start = state().windowStartMs;
        if (startUtc !== undefined) {
          try {
            start = startUtc.trim().toLowerCase() === 'now' ? state().timeMs : parseUtc(startUtc);
          } catch (err) {
            throw new ActionError((err as Error).message);
          }
          if (start < MIN_TIME_MS || start > MAX_TIME_MS) throw new ActionError(`The window must start between ${isoUtc(MIN_TIME_MS)} and ${isoUtc(MAX_TIME_MS)}.`);
        }
        store.set({ windowStartMs: start, ...(durationH !== undefined && { windowDurationH: durationH }) });
        return { windowStartUtc: isoUtc(state().windowStartMs), windowDurationH: state().windowDurationH, delayH: state().delayH };
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
        return { delayH: state().delayH, effectiveStartUtc: isoUtc(state().windowStartMs + hours * 3_600_000) };
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
      description: 'Saves the current scenario (site, mission window incl. delay, mast height) into comparison slot A or B.',
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
        store.set(slot === 'A' ? { compareA: sc } : { compareB: sc });
        return { slot, scenario: { label: sc.label, siteId: sc.site.id, startUtc: isoUtc(sc.startMs), durationH: sc.durationH, mastHeightM: sc.mastHeightM } };
      },
    }),
    defineAction({
      name: 'compare',
      title: 'Compare A and B',
      description: 'Opens the side-by-side comparison of the scenarios saved in slots A and B (use saveScenario first).',
      effect: 'command',
      params: NO_PARAMS,
      run: () => {
        const s = state();
        const missing = [!s.compareA && 'A', !s.compareB && 'B'].filter(Boolean);
        if (missing.length) throw new ActionError(`Save a scenario in slot ${missing.join(' and ')} first (saveScenario).`);
        store.set({ comparing: true });
        return { comparing: true, A: s.compareA!.label, B: s.compareB!.label, analysisA: ctx.analysis?.summary('A') ?? null, analysisB: ctx.analysis?.summary('B') ?? null };
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
    defineAction({
      name: 'getState',
      title: 'Current state',
      description:
        'Reads what is on screen now: view, simulated time (UTC), site, globe camera, surface look direction, mission window, mast, delay, requirements, overlay, filters, comparison slots and the analysis status of the current scenario.',
      effect: 'query',
      params: NO_PARAMS,
      run: () => {
        const s = state();
        const f = filterResult();
        return {
          view: s.view,
          ...timeSummary(s),
          lightMode: s.lightMode,
          site: siteSummary(s.site, ctx.landings()),
          globeCenter: { latDeg: s.globeCenter.lat, lonDegEast: s.globeCenter.lon, altitudeKm: s.globeCenter.altitudeKm },
          look: s.view === 'surface' ? s.look : null,
          missionWindow: { startUtc: isoUtc(s.windowStartMs), durationH: s.windowDurationH, delayH: s.delayH },
          mastHeightM: s.mastHeightM,
          slopeLimitDeg: s.slopeLimitDeg,
          maxEarthGapH: s.maxEarthGapH,
          sunBandDeg: { min: s.sunElMinDeg, max: s.sunElMaxDeg },
          overlay: s.overlay,
          showMissions: s.showMissions,
          missionsShown: { shown: f.shown, total: f.total, filter: f.filter },
          compare: { A: s.compareA?.label ?? null, B: s.compareB?.label ?? null, open: s.comparing },
          analysis: ctx.analysis?.summary('current') ?? null,
        };
      },
    }),
  ];
}
