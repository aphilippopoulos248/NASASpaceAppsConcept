// Test scaffolding only (never imported by the app): a small stand-in for the navigator
// that registers actions with the same names, parameters and result shapes as the real
// ones, backed by a plain object. It lets the assistant's loop and deterministic mode be
// tested in Node against the real action registry (`registerActions` / `runAction`).
//
// The numbers it returns are fixtures for tests. They never reach the application.
import { ActionError, defineAction, registerActions, resetActions, type ActionDef } from '../../core/actions';
import { isoUtc, parseUtc } from '../../core/time';

export interface FakeSite {
  id: string;
  name: string;
  kind: 'landing' | 'custom' | 'candidate';
  latDeg: number;
  lonDegEast: number;
}

export interface FakeMetrics {
  illuminationPct: number;
  longestDarknessH: number;
  earthVisiblePct: number;
  longestEarthGapH: number;
  slopeDeg: number;
}

export interface FakeRow extends FakeMetrics {
  rank: number;
  id: string;
  name: string;
  latDeg: number;
  lonDegEast: number;
  distanceM: number;
  bearingDeg: number;
  score: number;
}

export interface FakeState {
  timeMs: number;
  playing: boolean;
  rate: number;
  view: 'globe' | 'surface';
  site: FakeSite | null;
  mastHeightM: number;
  windowStartMs: number;
  windowDurationH: number;
  delayH: number;
  slopeLimitDeg: number;
  maxEarthGapH: number | null;
  sunBand: { min: number; max: number };
  overlay: string;
  showMissions: boolean;
  lightMode: 'real' | 'even';
  globeCenter: { latDeg: number; lonDegEast: number; altitudeKm: number };
  look: { azDeg: number; elDeg: number; fovDeg: number };
  compareA: { label: string; metrics: FakeMetrics } | null;
  compareB: { label: string; metrics: FakeMetrics } | null;
  comparing: boolean;
  filter: { programs: string[] | null; countries: string[] | null; type: string; fromYear: number | null; toYear: number | null };
}

export const T0 = Date.UTC(2026, 2, 1, 12, 0);

export const LANDINGS: (FakeSite & { program: string; country: string; year: number; crewed: boolean; landedMs: number })[] = [
  { id: 'apollo-11', name: 'Apollo 11', kind: 'landing', latDeg: 0.67408, lonDegEast: 23.47297, program: 'Apollo', country: 'USA', year: 1969, crewed: true, landedMs: Date.UTC(1969, 6, 20, 20, 17) },
  { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', latDeg: -84.7906, lonDegEast: 29.1957, program: 'CLPS', country: 'USA', year: 2025, crewed: false, landedMs: Date.UTC(2025, 2, 6, 17, 28) },
  { id: 'chandrayaan-3', name: 'Chandrayaan-3', kind: 'landing', latDeg: -69.373, lonDegEast: 32.319, program: 'Chandrayaan', country: 'India', year: 2023, crewed: false, landedMs: Date.UTC(2023, 7, 23, 12, 33) },
];

export const EVENTS = [
  { type: 'sunrise', timeMs: T0 + 5 * 3_600_000, azDeg: 91.2 },
  { type: 'earthset', timeMs: T0 + 9 * 3_600_000, azDeg: 348.4 },
  { type: 'sunset', timeMs: T0 + 20 * 3_600_000, azDeg: 268.9 },
  { type: 'earthrise', timeMs: T0 + 30 * 3_600_000, azDeg: 11.7 },
] as const;

/** Fixture metrics: differ by site, mast height and delay so comparisons have something to show. */
export function metricsFor(site: FakeSite, mastHeightM: number, delayH: number): FakeMetrics {
  const seed = Math.abs(Math.round(site.latDeg * 10 + site.lonDegEast)) % 17;
  return {
    illuminationPct: 40 + seed + mastHeightM * 0.5 - delayH * 0.25,
    longestDarknessH: 60 - seed - mastHeightM * 0.5 + delayH * 0.5,
    earthVisiblePct: 55 + seed * 0.5,
    longestEarthGapH: 30 - seed * 0.5,
    slopeDeg: 3 + seed * 0.25,
  };
}

export interface FakeAppOptions {
  /** Include actions that the science/compare workers add later (rankNearby, selectCandidate, explainBlockage). */
  analysisActions?: boolean;
  /** Include the awaiting getAnalysis query. */
  getAnalysis?: boolean;
  /** Include what later core builds add: selectSite { atLanding }, setMissionWindow "landing", showPanel. */
  landingActions?: boolean;
  /** Rows returned by rankNearby (the reference row is derived from the current site). */
  nearby?: FakeRow[];
  /** `getState` reports the analysis as loading this many times before it is ready. */
  analysisLoadingPolls?: number;
  /**
   * Mimics the real analysis store after a scenario is saved: `compare` reports both sides
   * as idle for this many calls (the debounce), then loading for as many again, then ready.
   */
  compareSettleCalls?: number;
}

export const NEARBY: FakeRow[] = [
  { rank: 1, id: 'cand-1', name: 'Candidate 1', latDeg: -84.801, lonDegEast: 29.26, distanceM: 640, bearingDeg: 152, slopeDeg: 6.8, illuminationPct: 71.5, longestDarknessH: 31.0, earthVisiblePct: 64.0, longestEarthGapH: 18.5, score: 0.91 },
  { rank: 2, id: 'cand-2', name: 'Candidate 2', latDeg: -84.779, lonDegEast: 29.11, distanceM: 910, bearingDeg: 341, slopeDeg: 2.1, illuminationPct: 66.2, longestDarknessH: 38.5, earthVisiblePct: 61.5, longestEarthGapH: 20.0, score: 0.84 },
  { rank: 3, id: 'cand-3', name: 'Candidate 3', latDeg: -84.795, lonDegEast: 29.31, distanceM: 1220, bearingDeg: 98, slopeDeg: 9.4, illuminationPct: 58.0, longestDarknessH: 52.0, earthVisiblePct: 57.0, longestEarthGapH: 26.0, score: 0.7 },
];

export function createFakeApp(options: FakeAppOptions = {}): { state: FakeState; actions: ActionDef<any, any>[] } {
  const state: FakeState = {
    timeMs: T0,
    playing: false,
    rate: 3600,
    view: 'globe',
    site: null,
    mastHeightM: 2,
    windowStartMs: T0,
    windowDurationH: 24,
    delayH: 0,
    slopeLimitDeg: 10,
    maxEarthGapH: null,
    sunBand: { min: 0, max: 90 },
    overlay: 'off',
    showMissions: true,
    lightMode: 'real',
    globeCenter: { latDeg: 0, lonDegEast: 0, altitudeKm: 4170 },
    look: { azDeg: 0, elDeg: 0, fovDeg: 70 },
    compareA: null,
    compareB: null,
    comparing: false,
    filter: { programs: null, countries: null, type: 'all', fromYear: null, toYear: null },
  };
  let loadingPolls = options.analysisLoadingPolls ?? 0;
  let compareCalls = 0;
  const nearbyRows = options.nearby ?? NEARBY;
  const none = { type: 'object', properties: {} } as const;
  const siteOut = (s: FakeSite | null) => (s ? { id: s.id, name: s.name, kind: s.kind, latDeg: s.latDeg, lonDegEast: s.lonDegEast } : null);
  const viewOut = () => ({ view: state.view, site: siteOut(state.site) });
  const timeOut = () => ({ timeUtc: isoUtc(state.timeMs), playing: state.playing, rateSimSecondsPerSecond: state.rate });
  const requireSite = () => {
    if (!state.site) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return state.site;
  };
  const label = () => `${state.site!.name}, from ${isoUtc(state.windowStartMs + state.delayH * 3_600_000)} for ${state.windowDurationH} h, mast ${state.mastHeightM} m${state.delayH ? `, +${state.delayH} h delay` : ''}`;
  const currentMetrics = () => metricsFor(requireSite(), state.mastHeightM, state.delayH);
  const summary = () => {
    if (!state.site) return { state: 'idle' };
    if (loadingPolls > 0) {
      loadingPolls--;
      return { state: 'loading', scenario: label() };
    }
    return { state: 'ready', scenario: label(), ...currentMetrics(), warnings: [] as string[] };
  };
  const pinId = (lat: number, lon: number) => `pin:${lat.toFixed(5)},${lon.toFixed(5)}`;

  const actions: ActionDef<any, any>[] = [
    defineAction<{ utc?: string; offsetHours?: number }, unknown>({
      name: 'setTime', title: 'Set time', description: 'Sets the simulated instant (UTC).', effect: 'command',
      params: { type: 'object', properties: { utc: { type: 'string', description: 'UTC' }, offsetHours: { type: 'number', description: 'hours' } } },
      run: ({ utc, offsetHours }) => {
        if ((utc === undefined) === (offsetHours === undefined)) throw new ActionError('Give exactly one of `utc` or `offsetHours`.');
        try {
          state.timeMs = utc !== undefined ? parseUtc(utc) : state.timeMs + offsetHours! * 3_600_000;
        } catch (err) {
          throw new ActionError((err as Error).message);
        }
        return timeOut();
      },
    }),
    defineAction<{ rate?: number }, unknown>({ name: 'play', title: 'Play', description: 'Starts the clock.', effect: 'command', params: { type: 'object', properties: { rate: { type: 'number', description: 'rate' } } }, run: ({ rate }) => { state.playing = true; if (rate) state.rate = rate; return timeOut(); } }),
    defineAction({ name: 'pause', title: 'Pause', description: 'Stops the clock.', effect: 'command', params: none, run: () => { state.playing = false; return timeOut(); } }),
    defineAction<{ secondsPerSecond: number }, unknown>({ name: 'setRate', title: 'Set playback speed', description: 'Sets the speed.', effect: 'command', params: { type: 'object', properties: { secondsPerSecond: { type: 'number', description: 'rate', minimum: 1 } }, required: ['secondsPerSecond'] }, run: ({ secondsPerSecond }) => { state.rate = secondsPerSecond; return timeOut(); } }),
    defineAction<{ mode: 'real' | 'even' }, unknown>({ name: 'setLightMode', title: 'Set lighting', description: 'Lighting.', effect: 'command', params: { type: 'object', properties: { mode: { type: 'string', description: 'mode', enum: ['real', 'even'] } }, required: ['mode'] }, run: ({ mode }) => { state.lightMode = mode; if (mode === 'even') state.playing = false; return { lightMode: state.lightMode, playing: state.playing }; } }),
    defineAction<{ site: string; surface?: boolean; atLanding?: boolean }, unknown>({
      name: 'selectSite', title: 'Select landing site', description: 'Selects a catalogued landing site by id or name.', effect: 'command',
      params: { type: 'object', properties: { site: { type: 'string', description: 'id or name' }, surface: { type: 'boolean', description: 'enter surface' }, ...(options.landingActions ? { atLanding: { type: 'boolean' as const, description: 'at touchdown' } } : {}) }, required: ['site'] },
      run: ({ site, surface, atLanding }) => {
        const key = site.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
        const hit = LANDINGS.find((l) => l.id.replace(/[^a-z0-9]/g, '') === key || l.name.toLowerCase().replace(/[^a-z0-9]/g, '') === key || l.name.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(key));
        if (!hit) throw new ActionError(`No catalogued landing matches "${site}". Known sites: ${LANDINGS.map((l) => l.name).join(', ')}.`);
        state.site = { id: hit.id, name: hit.name, kind: 'landing', latDeg: hit.latDeg, lonDegEast: hit.lonDegEast };
        state.view = surface ? 'surface' : 'globe';
        if (atLanding) {
          state.timeMs = hit.landedMs;
          state.windowStartMs = hit.landedMs;
          state.delayH = 0;
          state.playing = false;
          return { ...viewOut(), ...timeOut(), missionWindow: { startUtc: isoUtc(state.windowStartMs), durationH: state.windowDurationH, delayH: 0 } };
        }
        return viewOut();
      },
    }),
    defineAction<{ lat: number; lon: number; fly?: boolean }, unknown>({
      name: 'dropPin', title: 'Drop a pin', description: 'Selects any coordinate.', effect: 'command',
      params: { type: 'object', properties: { lat: { type: 'number', description: 'lat', minimum: -90, maximum: 90 }, lon: { type: 'number', description: 'lon', minimum: -360, maximum: 360 }, fly: { type: 'boolean', description: 'fly' } }, required: ['lat', 'lon'] },
      run: ({ lat, lon }) => {
        state.site = { id: pinId(lat, lon), name: `Pin ${lat.toFixed(4)}, ${lon.toFixed(4)}`, kind: 'custom', latDeg: lat, lonDegEast: lon };
        state.view = 'globe';
        return viewOut();
      },
    }),
    defineAction({ name: 'clearSite', title: 'Clear site', description: 'Deselects.', effect: 'command', params: none, run: () => { state.site = null; state.view = 'globe'; return viewOut(); } }),
    defineAction({ name: 'enterSurface', title: 'Enter surface view', description: 'Steps down.', effect: 'command', params: none, run: () => { requireSite(); state.view = 'surface'; return viewOut(); } }),
    defineAction({ name: 'exitSurface', title: 'Back to globe', description: 'Leaves the surface.', effect: 'command', params: none, run: () => { state.view = 'globe'; return viewOut(); } }),
    defineAction<{ lat: number; lon: number; altitudeKm?: number }, unknown>({
      name: 'setGlobeCamera', title: 'Turn the globe', description: 'Turns the globe.', effect: 'command',
      params: { type: 'object', properties: { lat: { type: 'number', description: 'lat', minimum: -90, maximum: 90 }, lon: { type: 'number', description: 'lon', minimum: -360, maximum: 360 }, altitudeKm: { type: 'number', description: 'km', minimum: 10, maximum: 13900 } }, required: ['lat', 'lon'] },
      run: ({ lat, lon, altitudeKm }) => {
        state.view = 'globe';
        state.globeCenter = { latDeg: lat, lonDegEast: lon, altitudeKm: altitudeKm ?? state.globeCenter.altitudeKm };
        return { view: 'globe', target: { latDeg: lat, lonDegEast: lon, altitudeKm: altitudeKm ?? null } };
      },
    }),
    defineAction<{ azDeg: number; elDeg?: number; fovDeg?: number }, unknown>({
      name: 'lookAt', title: 'Look towards', description: 'Turns the surface camera.', effect: 'command',
      params: { type: 'object', properties: { azDeg: { type: 'number', description: 'az', minimum: -360, maximum: 720 }, elDeg: { type: 'number', description: 'el', minimum: -85, maximum: 85 }, fovDeg: { type: 'number', description: 'fov', minimum: 20, maximum: 90 } }, required: ['azDeg'] },
      run: ({ azDeg, elDeg, fovDeg }) => {
        if (state.view !== 'surface') throw new ActionError('Enter the surface view first (enterSurface).');
        state.look = { azDeg: ((azDeg % 360) + 360) % 360, elDeg: elDeg ?? state.look.elDeg, fovDeg: fovDeg ?? state.look.fovDeg };
        return { look: state.look };
      },
    }),
    defineAction<{ metres: number }, unknown>({ name: 'setMastHeight', title: 'Set mast height', description: 'Mast.', effect: 'command', params: { type: 'object', properties: { metres: { type: 'number', description: 'm', minimum: 0, maximum: 100 } }, required: ['metres'] }, run: ({ metres }) => { state.mastHeightM = metres; return { mastHeightM: metres }; } }),
    defineAction<{ startUtc?: string; durationH?: number }, unknown>({
      name: 'setMissionWindow', title: 'Set mission window', description: 'Window.', effect: 'command',
      params: { type: 'object', properties: { startUtc: { type: 'string', description: 'start' }, durationH: { type: 'number', description: 'h', minimum: 1, maximum: 8760 } } },
      run: ({ startUtc, durationH }) => {
        if (startUtc === undefined && durationH === undefined) throw new ActionError('Give `startUtc` and/or `durationH`.');
        if (startUtc === 'landing' && options.landingActions) {
          const landing = LANDINGS.find((l) => l.id === state.site?.id);
          if (!landing) throw new ActionError('"landing" needs a selected catalogued landing.');
          state.windowStartMs = landing.landedMs;
        } else if (startUtc !== undefined) {
          try {
            state.windowStartMs = startUtc === 'now' ? state.timeMs : parseUtc(startUtc);
          } catch (err) {
            throw new ActionError((err as Error).message);
          }
        }
        if (durationH !== undefined) state.windowDurationH = durationH;
        return { windowStartUtc: isoUtc(state.windowStartMs), windowDurationH: state.windowDurationH, delayH: state.delayH };
      },
    }),
    defineAction<{ hours: number }, unknown>({ name: 'setDelay', title: 'Set arrival delay', description: 'Delay.', effect: 'command', params: { type: 'object', properties: { hours: { type: 'number', description: 'h', minimum: 0, maximum: 720 } }, required: ['hours'] }, run: ({ hours }) => { state.delayH = hours; return { delayH: hours, effectiveStartUtc: isoUtc(state.windowStartMs + hours * 3_600_000) }; } }),
    defineAction<{ degrees: number }, unknown>({ name: 'setSlopeLimit', title: 'Set slope limit', description: 'Slope.', effect: 'command', params: { type: 'object', properties: { degrees: { type: 'number', description: 'deg', minimum: 0, maximum: 45 } }, required: ['degrees'] }, run: ({ degrees }) => { state.slopeLimitDeg = degrees; return { slopeLimitDeg: degrees }; } }),
    defineAction<{ hours?: number }, unknown>({ name: 'setMaxEarthGap', title: 'Set max Earth gap', description: 'Gap.', effect: 'command', params: { type: 'object', properties: { hours: { type: 'number', description: 'h', minimum: 0 } } }, run: ({ hours }) => { state.maxEarthGapH = hours ?? null; return { maxEarthGapH: state.maxEarthGapH }; } }),
    defineAction<{ minDeg: number; maxDeg: number }, unknown>({ name: 'setSunBand', title: 'Set solar elevation band', description: 'Band.', effect: 'command', params: { type: 'object', properties: { minDeg: { type: 'number', description: 'min' }, maxDeg: { type: 'number', description: 'max' } }, required: ['minDeg', 'maxDeg'] }, run: ({ minDeg, maxDeg }) => { if (!(minDeg < maxDeg)) throw new ActionError('minDeg must be lower than maxDeg.'); state.sunBand = { min: minDeg, max: maxDeg }; return { sunElMinDeg: minDeg, sunElMaxDeg: maxDeg }; } }),
    defineAction<{ mode: string }, unknown>({ name: 'setOverlay', title: 'Set globe overlay', description: 'Overlay.', effect: 'command', params: { type: 'object', properties: { mode: { type: 'string', description: 'mode', enum: ['off', 'sun-band', 'avg-illumination', 'avg-earth-visibility'] } }, required: ['mode'] }, run: ({ mode }) => { state.overlay = mode; return { overlay: mode }; } }),
    defineAction<{ show: boolean }, unknown>({ name: 'showMissions', title: 'Show previous missions', description: 'Markers.', effect: 'command', params: { type: 'object', properties: { show: { type: 'boolean', description: 'show' } }, required: ['show'] }, run: ({ show }) => { state.showMissions = show; return { showMissions: show }; } }),
    defineAction<{ programs?: string[]; countries?: string[]; type?: string; fromYear?: number; toYear?: number; reset?: boolean }, unknown>({
      name: 'setFilters', title: 'Filter landings', description: 'Filters.', effect: 'command',
      params: { type: 'object', properties: { programs: { type: 'array', description: 'programs', items: { type: 'string', description: 'p' } }, countries: { type: 'array', description: 'countries', items: { type: 'string', description: 'c' } }, type: { type: 'string', description: 'type', enum: ['all', 'crewed', 'robotic'] }, fromYear: { type: 'integer', description: 'from' }, toYear: { type: 'integer', description: 'to' }, reset: { type: 'boolean', description: 'reset' } } },
      run: ({ programs, countries, type, fromYear, toYear, reset }) => {
        const pick = (given: string[] | undefined, known: string[], what: string) => {
          if (given === undefined) return undefined;
          return given.map((g) => {
            const hit = known.find((k) => k.toLowerCase() === g.trim().toLowerCase());
            if (!hit) throw new ActionError(`Unknown ${what} "${g}". Known: ${known.join(', ')}.`);
            return hit;
          });
        };
        const p = pick(programs, [...new Set(LANDINGS.map((l) => l.program))], 'program');
        const c = pick(countries, [...new Set(LANDINGS.map((l) => l.country))], 'country');
        const prev = reset ? { programs: null, countries: null, type: 'all', fromYear: null, toYear: null } : state.filter;
        state.filter = { programs: p ?? prev.programs, countries: c ?? prev.countries, type: type ?? prev.type, fromYear: fromYear ?? prev.fromYear, toYear: toYear ?? prev.toYear };
        const f = state.filter;
        const shown = LANDINGS.filter((l) => (!f.programs || f.programs.includes(l.program)) && (!f.countries || f.countries.includes(l.country)) && (f.type === 'all' || (f.type === 'crewed') === l.crewed) && (f.fromYear === null || l.year >= f.fromYear) && (f.toYear === null || l.year <= f.toYear));
        return { shown: shown.length, total: LANDINGS.length, filter: f, shownIds: shown.map((l) => l.id) };
      },
    }),
    defineAction<{ slot: 'A' | 'B'; label?: string }, unknown>({
      name: 'saveScenario', title: 'Save scenario for comparison', description: 'Saves A or B.', effect: 'command',
      params: { type: 'object', properties: { slot: { type: 'string', description: 'slot', enum: ['A', 'B'] }, label: { type: 'string', description: 'label' } }, required: ['slot'] },
      run: ({ slot, label: given }) => {
        const site = requireSite();
        const saved = { label: given ?? label(), metrics: currentMetrics() };
        if (slot === 'A') state.compareA = saved;
        else state.compareB = saved;
        compareCalls = 0;
        return { slot, scenario: { label: saved.label, siteId: site.id, startUtc: isoUtc(state.windowStartMs + state.delayH * 3_600_000), durationH: state.windowDurationH, mastHeightM: state.mastHeightM } };
      },
    }),
    defineAction({
      name: 'compare', title: 'Compare A and B', description: 'Opens the comparison.', effect: 'command', params: none,
      run: () => {
        const missing = [!state.compareA && 'A', !state.compareB && 'B'].filter(Boolean);
        if (missing.length) throw new ActionError(`Save a scenario in slot ${missing.join(' and ')} first (saveScenario).`);
        state.comparing = true;
        const settle = options.compareSettleCalls ?? 0;
        const call = compareCalls++;
        const side = (s: NonNullable<FakeState['compareA']>) =>
          call < settle ? { state: 'idle' } : call < 2 * settle ? { state: 'loading', scenario: s.label } : { state: 'ready', scenario: s.label, ...s.metrics, warnings: [] };
        return { comparing: true, A: state.compareA!.label, B: state.compareB!.label, analysisA: side(state.compareA!), analysisB: side(state.compareB!) };
      },
    }),
    defineAction({ name: 'stopCompare', title: 'Close comparison', description: 'Closes.', effect: 'command', params: none, run: () => { state.comparing = false; return { comparing: false }; } }),
    defineAction<{ type: string; which?: 'next' | 'previous' }, unknown>({
      name: 'jumpToEvent', title: 'Jump to sunrise/sunset/Earthrise/Earthset', description: 'Moves the clock to an event.', effect: 'command',
      params: { type: 'object', properties: { type: { type: 'string', description: 'event', enum: ['sunrise', 'sunset', 'earthrise', 'earthset'] }, which: { type: 'string', description: 'which', enum: ['next', 'previous'] } }, required: ['type'] },
      run: ({ type, which = 'next' }) => {
        requireSite();
        const list = EVENTS.filter((e) => e.type === type);
        const hit = which === 'next' ? list.find((e) => e.timeMs > state.timeMs + 30_000) : [...list].reverse().find((e) => e.timeMs < state.timeMs - 30_000);
        if (!hit) throw new ActionError(`No ${which} ${type} inside the analysed mission window.`);
        state.playing = false;
        state.timeMs = hit.timeMs;
        return { event: type, timeUtc: isoUtc(hit.timeMs), azDeg: hit.azDeg };
      },
    }),
    defineAction({
      name: 'getState', title: 'Current state', description: 'Reads what is on screen now.', effect: 'query', params: none,
      run: () => ({
        view: state.view,
        ...timeOut(),
        lightMode: state.lightMode,
        site: siteOut(state.site),
        globeCenter: state.globeCenter,
        look: state.view === 'surface' ? state.look : null,
        missionWindow: { startUtc: isoUtc(state.windowStartMs), durationH: state.windowDurationH, delayH: state.delayH },
        mastHeightM: state.mastHeightM,
        slopeLimitDeg: state.slopeLimitDeg,
        maxEarthGapH: state.maxEarthGapH,
        sunBandDeg: state.sunBand,
        overlay: state.overlay,
        showMissions: state.showMissions,
        compare: { A: state.compareA?.label ?? null, B: state.compareB?.label ?? null, open: state.comparing },
        analysis: summary(),
      }),
    }),
  ];

  if (options.analysisActions) {
    actions.push(
      defineAction<{ radiusM?: number; spacingM?: number; slopeLimitDeg?: number }, unknown>({
        name: 'rankNearby', title: 'Rank nearby alternatives', description: 'Scans alternatives around the site.', effect: 'command',
        params: { type: 'object', properties: { radiusM: { type: 'number', description: 'm' }, spacingM: { type: 'number', description: 'm' }, slopeLimitDeg: { type: 'number', description: 'deg' } } },
        run: ({ radiusM = 2000, slopeLimitDeg = state.slopeLimitDeg }) => {
          const site = requireSite();
          const reference = { rank: 0, id: site.id, name: site.name, latDeg: site.latDeg, lonDegEast: site.lonDegEast, distanceM: 0, bearingDeg: 0, score: 0.6, isReference: true, ...currentMetrics() };
          const candidates = nearbyRows.filter((r) => r.distanceM <= radiusM && r.slopeDeg <= slopeLimitDeg);
          return { reference, candidates, rejected: { slope: nearbyRows.filter((r) => r.slopeDeg > slopeLimitDeg).length, noData: 0 }, basis: 'Slope and skyline from the 60 m grid: metre-scale hazards are not visible.' };
        },
      }),
      defineAction<{ rank?: number; id?: string; asB?: boolean }, unknown>({
        name: 'selectCandidate', title: 'Select a nearby candidate', description: 'Pins a ranked candidate.', effect: 'command',
        params: { type: 'object', properties: { rank: { type: 'integer', description: 'rank', minimum: 1 }, id: { type: 'string', description: 'id' }, asB: { type: 'boolean', description: 'load as B' } } },
        run: ({ rank, id }) => {
          const row = nearbyRows.find((r) => r.rank === rank || r.id === id);
          if (!row) throw new ActionError('No such candidate. Run rankNearby first.');
          state.site = { id: row.id, name: row.name, kind: 'candidate', latDeg: row.latDeg, lonDegEast: row.lonDegEast };
          state.view = 'globe';
          return viewOut();
        },
      }),
      defineAction<{ body: 'sun' | 'earth'; utc?: string }, unknown>({
        name: 'explainBlockage', title: 'Explain blocking terrain', description: 'Why the Sun or Earth is hidden.', effect: 'command',
        params: { type: 'object', properties: { body: { type: 'string', description: 'body', enum: ['sun', 'earth'] }, utc: { type: 'string', description: 'time' } }, required: ['body'] },
        run: ({ body }) => {
          requireSite();
          const azDeg = body === 'earth' ? 348.4 : 268.9;
          return {
            body, timeUtc: isoUtc(state.timeMs), blocked: true, bodyAzDeg: azDeg, bodyElDeg: 1.84, skylineElDeg: 2.31, clearanceDeg: -0.47,
            ridgeDistanceM: 4200, ridgeHeightM: 1385, ridge: { latDeg: -84.66, lonDegEast: 28.9 }, demName: 'LOLA 60 m polar grid', demResolutionM: 60,
            explanation: `${body === 'earth' ? 'Earth' : 'The Sun'} is hidden by a ridge 4.20 km away towards azimuth ${azDeg.toFixed(1)}°: the skyline there is at 2.31° and the centre of the disc at 1.84°.`,
          };
        },
      }),
    );
  }
  if (options.getAnalysis) {
    actions.push(
      defineAction<{ slot?: 'current' | 'A' | 'B' }, unknown>({
        name: 'getAnalysis', title: 'Read the site analysis', description: 'Waits for the analysis and returns it.', effect: 'query',
        params: { type: 'object', properties: { slot: { type: 'string', description: 'slot', enum: ['current', 'A', 'B'] } } },
        run: ({ slot = 'current' }) => {
          if (!state.site) return { slot, state: 'idle', error: 'No site is selected. Select a landing site or drop a pin first.' };
          const next = (type: string) => {
            const e = EVENTS.find((x) => x.type === type && x.timeMs > state.timeMs + 30_000);
            return e ? { timeUtc: isoUtc(e.timeMs), azDeg: e.azDeg, inHours: (e.timeMs - state.timeMs) / 3_600_000 } : null;
          };
          const m = currentMetrics();
          const terrain = { distanceKm: 4.2, heightM: 1385, latDeg: -84.66, lonDegEast: 28.9, demName: 'LOLA 60 m polar grid', demResolutionM: 60 };
          return {
            slot, state: 'ready', scenario: { label: label(), site: siteOut(state.site), durationH: state.windowDurationH, mastHeightM: state.mastHeightM },
            metrics: { illuminationPct: m.illuminationPct, longestDarknessH: m.longestDarknessH, earthVisiblePct: m.earthVisiblePct, longestEarthGapH: m.longestEarthGapH },
            slope: { slopeDeg: m.slopeDeg, demName: 'LOLA 60 m polar grid' },
            now: {
              timeUtc: isoUtc(state.timeMs),
              sun: { azDeg: 143.2, elDeg: 3.4, skylineElDeg: 2.3, clearanceDeg: 1.1, centreAboveSkyline: true, skylineTerrain: terrain, explanation: 'The Sun is 1.10° above the skyline at azimuth 143.2°.' },
              earth: { azDeg: 351.0, elDeg: 5.6, skylineElDeg: 6.4, clearanceDeg: -0.8, centreAboveSkyline: false, skylineTerrain: terrain, explanation: 'Earth is hidden by terrain 4.20 km away towards azimuth 351.0°: the skyline there is at 6.40° and the centre of the disc at 5.60°.' },
            },
            nextEvents: { sunrise: next('sunrise'), sunset: next('sunset'), earthrise: next('earthrise'), earthset: next('earthset') },
            requirements: {
              sunElevationBand: { minDeg: state.sunBand.min, maxDeg: state.sunBand.max, windowMinSunElDeg: -1.2, windowMaxSunElDeg: 4.6, metForWholeWindow: state.sunBand.min <= -1.2 && state.sunBand.max >= 4.6 },
              maxEarthGap: state.maxEarthGapH === null ? null : { limitH: state.maxEarthGapH, longestEarthGapH: m.longestEarthGapH, met: m.longestEarthGapH <= state.maxEarthGapH },
            },
            provenance: { ephemeris: 'model', elevationData: [{ name: 'LOLA 60 m polar grid', resolutionM: 60, fromKm: 0, toKm: 30 }, { name: 'LOLA whole-Moon grid', resolutionM: 1895, fromKm: 30, toKm: 400 }], assumptions: [] },
            warnings: [],
          };
        },
      }),
    );
  }
  if (options.landingActions) {
    actions.push(
      defineAction<{ panel: string; open: boolean }, unknown>({
        name: 'showPanel', title: 'Show or fold a panel', description: 'Folds the site details or the filters sheet.', effect: 'command',
        params: { type: 'object', properties: { panel: { type: 'string', description: 'panel', enum: ['site-details', 'filters'] }, open: { type: 'boolean', description: 'open' } }, required: ['panel', 'open'] },
        run: ({ panel, open }) => ({ panel, open }),
      }),
    );
  }
  return { state, actions };
}

/** Clears the registry and registers a fresh fake app. Returns its state for assertions. */
export function installFakeApp(options: FakeAppOptions = {}): FakeState {
  resetActions();
  const app = createFakeApp(options);
  registerActions(app.actions);
  return app.state;
}
