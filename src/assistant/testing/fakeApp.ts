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
  /** Globe drawing (displayActions). */
  reliefFactor: number;
  coverage: boolean;
  iceTargets: boolean;
  locatorZoom: number;
  assistantOpen: boolean;
  /** Surface view (surfaceActions). */
  generated: boolean;
  position: { eastM: number; northM: number; liftM: number };
  annotations: { tracks: boolean; labels: boolean };
  /** Compare panel (comparePanel). */
  panelTab: 'compare' | 'nearby' | 'windows' | 'outlook';
  /** Mission presets and flags (presetActions). */
  preset: string | null;
  flags: boolean;
  /** Surface HUD (hudActions). */
  hud: { chart: 'hidden' | 'compact' | 'expanded'; mode: 'skyline' | 'time'; table: boolean; azimuthRange: 'full' | 'tracks'; metricsOpen: boolean; explanation: boolean };
  saved: { name: string; savedUtc: string; a: NonNullable<FakeState['compareA']>; b: NonNullable<FakeState['compareB']>; clockMs: number }[];
  /** Where the globe view was last asked to centre (option viewTarget); null after a hand turn. */
  viewTarget: { latDeg: number; lonDegEast: number } | null;
}

export const T0 = Date.UTC(2026, 2, 1, 12, 0);
/** The stand-in's real clock (what "real-now" means to it). */
export const REAL_NOW = Date.UTC(2026, 10, 15, 4, 0, 30);

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

const MIN = 60_000;
/**
 * The passage of each event's disc through the skyline (option eventSpans, as T-47's SpanReport):
 * a sunset is the last limb of a set that began with the first cut, a sunrise the first limb of a
 * rise, Earthset and Earthrise the centre crossing inside Earth's passage. The entry without an
 * event is a graze: the Sun partly hidden, never fully set.
 */
export const PASSAGES = [
  { event: 'sunrise', body: 'sun', kind: 'rise', startMs: T0 + 5 * 3_600_000, endMs: T0 + 5 * 3_600_000 + 40 * MIN, centreMs: [] as number[], startAz: 91.2, endAz: 91.5 },
  { event: 'earthset', body: 'earth', kind: 'set', startMs: T0 + 8 * 3_600_000 + 10 * MIN, endMs: T0 + 9 * 3_600_000 + 50 * MIN, centreMs: [T0 + 9 * 3_600_000], startAz: 348.1, endAz: 348.7 },
  { event: 'sunset', body: 'sun', kind: 'set', startMs: T0 + 19 * 3_600_000 + 10 * MIN, endMs: T0 + 20 * 3_600_000, centreMs: [] as number[], startAz: 268.0, endAz: 268.9 },
  { event: null, body: 'sun', kind: 'graze', startMs: T0 + 22 * 3_600_000, endMs: T0 + 23 * 3_600_000, centreMs: [] as number[], startAz: 270.4, endAz: 271.0 },
  { event: 'earthrise', body: 'earth', kind: 'rise', startMs: T0 + 29 * 3_600_000 + 20 * MIN, endMs: T0 + 30 * 3_600_000 + 40 * MIN, centreMs: [T0 + 30 * 3_600_000], startAz: 11.3, endAz: 12.1 },
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
  /** Globe drawing, compass, locator map and drawer: setReliefExaggeration, showCoverage, showIceTargets, resetNorth, setLocatorZoom, setAssistantOpen, clearConversation. */
  displayActions?: boolean;
  /** getSiteScience and nearestIceTargets. "t30" adds the Diviner and ShadowCam parts of the site-science module; true gives the earlier result without them. */
  scienceActions?: boolean | 't30';
  /** The surface view's own actions: setGeneratedDetail, setFieldOfView, lookAtBody, walkTo, setSkyAnnotations, getSurfaceView. */
  surfaceActions?: boolean;
  /** listSites. */
  catalogActions?: boolean;
  /** The compare panel: openCompare, compareDelayedArrival, compareMastHeights, swap/clear/save/load/delete/listComparisons; rankNearby then opens its "nearby" tab. */
  comparePanel?: boolean;
  /** Event results name their instant (decision D-8): jumpToEvent gives `label` and `instant`, getAnalysis gives a `label` per event and `eventDefinitions`. */
  eventLabels?: boolean;
  /** The surface HUD's actions: setChart, showKeyMetrics, dismissBlockageExplanation. */
  hudActions?: boolean;
  /** Mission presets (listPresets, loadPreset) and showFlags. */
  presetActions?: boolean;
  /**
   * T-47: both ends of each rise and set. jumpToEvent takes `instant` (event, start, end) and gives
   * the passage (`span`); getAnalysis gives `span` and `summary` per next event, `nextPassages`, and
   * Earth by any part of its disc (metrics.earthAnyPct, longestEarthAnyGapH); compare's diff gives earthAnyPct.
   */
  eventSpans?: boolean;
  /** getState.globeDisplay.viewTarget: where the view was last asked to centre; the drawn centre stops 0.1° short of a pole, as the globe does. */
  viewTarget?: boolean;
  /** T-46: the solar band at its default (0 to 90 deg) is no requirement: `required: false`, the "met" fields null, a `note`. Without it, the earlier core's `metForWholeWindow: false`. */
  bandRule?: boolean;
  /** T-44: getState.wallClockUtc, and a catalogued site's `ownership` and `exploredArea` (the card's "Belongs to", "Owner", "Explored"). */
  siteRecords?: boolean;
}

/** Stand-in records (not the real GCAT data): IM-2 has both, the other landings none. */
export const SITE_RECORDS: Record<string, { ownership: Record<string, unknown> | null; exploredArea: Record<string, unknown> | null }> = {
  'im-2': {
    ownership: { state: 'United States', stateCode: 'US', owner: 'Intuitive Machines', gcatId: 'fixture-im-2', labelDisagrees: false, source: 'GCAT stand-in record' },
    exploredArea: { description: 'about 40 m across', extentM: 40, areaM2: 1257, located: true, source: 'stand-in area' },
  },
};

/** As public/data/presets.json (ids, titles, sites, views). */
export const PRESETS = [
  { id: 'blue-ghost-landing', title: 'Blue Ghost Mission 1, Mare Crisium', siteId: 'blue-ghost-1', view: 'surface' },
  { id: 'im-2-landing', title: 'IM-2 Athena, Mons Mouton', siteId: 'im-2', view: 'surface' },
  { id: 'eclipse-2025-03-14', title: 'Eclipse of 14 March 2025 at the Blue Ghost site', siteId: 'blue-ghost-1', view: 'surface' },
] as const;

/** As src/core/skyEvents.ts EVENT_INFO. */
export const EVENT_INFO: Record<string, { label: string; instant: string }> = {
  sunrise: { label: 'Sun starts rising', instant: "the first part of the Sun's disc appears above the terrain skyline" },
  sunset: { label: 'Sun fully set', instant: "the last part of the Sun's disc goes behind the terrain skyline" },
  earthrise: { label: "Earth's centre rises", instant: "the centre of Earth's disc comes above the terrain skyline" },
  earthset: { label: "Earth's centre sets", instant: "the centre of Earth's disc goes behind the terrain skyline" },
};

/** Every option on: the stand-in has every action the real build has or is about to get. */
export const ALL_ACTIONS: FakeAppOptions = { analysisActions: true, getAnalysis: true, landingActions: true, displayActions: true, scienceActions: 't30', surfaceActions: true, catalogActions: true, comparePanel: true, eventLabels: true, hudActions: true, presetActions: true, eventSpans: true, viewTarget: true, bandRule: true, siteRecords: true };

export const NEARBY: FakeRow[] = [
  { rank: 1, id: 'cand-1', name: 'Candidate 1', latDeg: -84.801, lonDegEast: 29.26, distanceM: 640, bearingDeg: 152, slopeDeg: 6.8, illuminationPct: 71.5, longestDarknessH: 31.0, earthVisiblePct: 64.0, longestEarthGapH: 18.5, score: 0.91 },
  { rank: 2, id: 'cand-2', name: 'Candidate 2', latDeg: -84.779, lonDegEast: 29.11, distanceM: 910, bearingDeg: 341, slopeDeg: 2.1, illuminationPct: 66.2, longestDarknessH: 38.5, earthVisiblePct: 61.5, longestEarthGapH: 20.0, score: 0.84 },
  { rank: 3, id: 'cand-3', name: 'Candidate 3', latDeg: -84.795, lonDegEast: 29.31, distanceM: 1220, bearingDeg: 98, slopeDeg: 9.4, illuminationPct: 58.0, longestDarknessH: 52.0, earthVisiblePct: 57.0, longestEarthGapH: 26.0, score: 0.7 },
];

/** Rows shaped like the nearestIceTargets / getSiteScience ice rows. */
export const ICE_TARGETS = [
  { id: 'psr-107', label: 'Unnamed PSR 107', distanceKm: 6.6, distanceText: '6.6 km', insideOutline: false, bearingDeg: 212, nearestPoint: { latDeg: -84.83, lonDegEast: 28.7 }, measuredTo: 'outline', listedAreaKm2: 1.2, objectives: ['highest'] },
  { id: 'psr-033', label: 'Unnamed PSR 33', distanceKm: 10.4, distanceText: '10.4 km', insideOutline: false, bearingDeg: 145, nearestPoint: { latDeg: -84.86, lonDegEast: 30.1 }, measuredTo: 'outline', listedAreaKm2: 0.8, objectives: [] },
  { id: 'psr-012', label: 'Unnamed PSR 12', distanceKm: 16.2, distanceText: '16.2 km', insideOutline: false, bearingDeg: 301, nearestPoint: { latDeg: -84.71, lonDegEast: 27.9 }, measuredTo: 'outline', listedAreaKm2: 3.4, objectives: ['lateral'] },
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
    reliefFactor: 10,
    coverage: false,
    iceTargets: false,
    locatorZoom: 1,
    assistantOpen: true,
    generated: true,
    position: { eastM: 0, northM: 0, liftM: 0 },
    annotations: { tracks: true, labels: true },
    panelTab: 'compare',
    saved: [],
    hud: { chart: 'compact', mode: 'skyline', table: false, azimuthRange: 'full', metricsOpen: true, explanation: false },
    preset: null,
    flags: false,
    viewTarget: null,
  };
  let loadingPolls = options.analysisLoadingPolls ?? 0;
  let compareCalls = 0;
  const nearbyRows = options.nearby ?? NEARBY;
  const none = { type: 'object', properties: {} } as const;
  const siteOut = (s: FakeSite | null) => {
    if (!s) return null;
    const base = { id: s.id, name: s.name, kind: s.kind, latDeg: s.latDeg, lonDegEast: s.lonDegEast };
    // As the real site results: a catalogued landing carries its records, null where there are none.
    return options.siteRecords && s.kind === 'landing' ? { ...base, ownership: SITE_RECORDS[s.id]?.ownership ?? null, exploredArea: SITE_RECORDS[s.id]?.exploredArea ?? null } : base;
  };
  const viewOut = () => ({ view: state.view, site: siteOut(state.site) });
  const timeOut = () => ({ timeUtc: isoUtc(state.timeMs), playing: state.playing, rateSimSecondsPerSecond: state.rate });
  const requireSite = () => {
    if (!state.site) throw new ActionError('No site is selected. Select a landing site or drop a pin first.');
    return state.site;
  };
  const label = () => `${state.site!.name}, from ${isoUtc(state.windowStartMs + state.delayH * 3_600_000)} for ${state.windowDurationH} h, mast ${state.mastHeightM} m${state.delayH ? `, +${state.delayH} h delay` : ''}`;
  const currentMetrics = () => metricsFor(requireSite(), state.mastHeightM, state.delayH);
  /** Earth by any part of its disc: at least the centre figure, the whole-disc gap at most the centre gap. */
  const anyPart = (m: FakeMetrics) => ({ earthAnyPct: Math.min(100, m.earthVisiblePct + 8), longestEarthAnyGapH: Math.round(m.longestEarthGapH * 40) / 100 });
  const inWindow = (t: number) => t >= state.windowStartMs + state.delayH * 3_600_000 && t <= state.windowStartMs + (state.delayH + state.windowDurationH) * 3_600_000;
  const BODY_NAME = { sun: 'Sun', earth: 'Earth' } as const;
  /** As the science core's TRANSITION_WORDS (labels) and transitionSummary (the words before each time). */
  const EDGE_WORDS = {
    set: { label: ['starts setting', 'fully set'], instant: ['the terrain skyline starts to cut into DISC', 'the last part of DISC goes behind the terrain skyline'] },
    rise: { label: ['starts rising', 'fully risen'], instant: ['the first part of DISC appears above the terrain skyline', 'the whole of DISC is clear of the terrain skyline'] },
  } as const;
  /** As src/core/skyEvents.ts spanReport, with the science core's summary sentence (the date only when it changes). */
  const spanReport = (p: (typeof PASSAGES)[number]) => {
    let day = '';
    const at = (t: number, outside: string) => {
      const iso = isoUtc(t), d = iso.slice(0, 10), text = d === day ? iso.slice(11, 16) : `${d} ${iso.slice(11, 16)}`;
      day = d;
      return `${text}${inWindow(t) ? '' : ` (${outside})`}`;
    };
    const Body = BODY_NAME[p.body];
    const graze = p.kind === 'graze';
    const label = (i: 0 | 1) => (graze ? (i === 0 ? `${Body} partly hidden` : `${Body}'s whole disc clear again`) : `${Body} ${EDGE_WORDS[p.kind].label[i]}`);
    const centre = p.centreMs.map((t) => ({ label: `${Body}'s centre ${p.kind === 'set' ? 'sets' : 'rises'}`, timeUtc: isoUtc(t), inWindow: inWindow(t) }));
    const first = `${graze ? 'partly hidden from' : EDGE_WORDS[p.kind].label[0]} ${at(p.startMs, 'before the analysed window')}`;
    const mids = p.centreMs.map((t) => `centre ${p.kind === 'set' ? 'sets' : 'rises'} ${at(t, 'outside the analysed window')}`);
    const last = `${graze ? 'whole disc clear again' : EDGE_WORDS[p.kind].label[1]} ${at(p.endMs, 'after the analysed window')}`;
    return {
      body: p.body, kind: p.kind,
      start: { edge: p.kind === 'rise' ? 'first-limb' : 'first-cut', label: label(0), timeUtc: isoUtc(p.startMs), azDeg: p.startAz, inWindow: inWindow(p.startMs) },
      end: { edge: p.kind === 'set' ? 'last-limb' : 'whole-clear', label: label(1), timeUtc: isoUtc(p.endMs), azDeg: p.endAz, inWindow: inWindow(p.endMs) },
      hours: Math.round(((p.endMs - p.startMs) / 3_600_000) * 100) / 100,
      ...(centre.length && { centre }),
      summary: `${[first, ...mids, last].join(', ')} UTC${graze ? '; never fully set' : ''}`,
    };
  };
  /** The instant clause of an end of an event's passage ("the terrain skyline starts to cut into the Sun's disc"). */
  const edgeInstant = (p: (typeof PASSAGES)[number], i: 0 | 1) => (p.kind === 'graze' ? '' : EDGE_WORDS[p.kind].instant[i].replace('DISC', p.body === 'sun' ? "the Sun's disc" : "Earth's disc"));
  const passageOf = (type: string) => PASSAGES.find((p) => p.event === type)!;
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
    defineAction<{ site: string; surface?: boolean; atLanding?: boolean; fly?: boolean }, unknown>({
      name: 'selectSite', title: 'Select landing site', description: 'Selects a catalogued landing site by id or name.', effect: 'command',
      params: { type: 'object', properties: { site: { type: 'string', description: 'id or name' }, surface: { type: 'boolean', description: 'enter surface' }, fly: { type: 'boolean', description: 'fly the globe there' }, ...(options.landingActions ? { atLanding: { type: 'boolean' as const, description: 'at touchdown' } } : {}) }, required: ['site'] },
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
        // The real globe stops 0.1 degree short right over a pole; the view's target stays as asked.
        state.globeCenter = { latDeg: options.viewTarget ? Math.max(-89.9, Math.min(89.9, lat)) : lat, lonDegEast: lon, altitudeKm: altitudeKm ?? state.globeCenter.altitudeKm };
        if (options.viewTarget) state.viewTarget = { latDeg: lat, lonDegEast: lon };
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
    defineAction<{ startUtc?: string; durationH?: number; moveClock?: boolean }, unknown>({
      name: 'setMissionWindow', title: 'Set mission window', description: 'Window.', effect: 'command',
      params: { type: 'object', properties: { startUtc: { type: 'string', description: 'start' }, durationH: { type: 'number', description: 'h', minimum: 1, maximum: 8760 }, moveClock: { type: 'boolean', description: 'move the clock to the start' } } },
      run: ({ startUtc, durationH, moveClock }) => {
        if (startUtc === undefined && durationH === undefined && !moveClock) throw new ActionError('Give `startUtc` and/or `durationH`.');
        if (startUtc === 'landing' && options.landingActions) {
          const landing = LANDINGS.find((l) => l.id === state.site?.id);
          if (!landing) throw new ActionError('"landing" needs a selected catalogued landing.');
          state.windowStartMs = landing.landedMs;
        } else if (startUtc !== undefined) {
          try {
            state.windowStartMs = startUtc === 'now' ? state.timeMs : startUtc === 'real-now' ? Math.floor(REAL_NOW / 60_000) * 60_000 : parseUtc(startUtc);
          } catch (err) {
            throw new ActionError((err as Error).message);
          }
        }
        if (durationH !== undefined) state.windowDurationH = durationH;
        if (moveClock) state.timeMs = state.windowStartMs + state.delayH * 3_600_000;
        return { windowStartUtc: isoUtc(state.windowStartMs), windowDurationH: state.windowDurationH, delayH: state.delayH, timeUtc: isoUtc(state.timeMs) };
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
        // As the real panel: a successful compare shows its A/B tab.
        if (options.comparePanel) state.panelTab = 'compare';
        const settle = options.compareSettleCalls ?? 0;
        const call = compareCalls++;
        const side = (s: NonNullable<FakeState['compareA']>) =>
          call < settle ? { state: 'idle' } : call < 2 * settle ? { state: 'loading', scenario: s.label } : { state: 'ready', scenario: s.label, ...s.metrics, warnings: [] };
        const ready = call >= 2 * settle;
        // As the real result: B minus A, rounded to 2 decimals, once both sides are ready.
        const d = (k: keyof FakeMetrics) => Math.round((state.compareB!.metrics[k] - state.compareA!.metrics[k]) * 100) / 100;
        const dAny = () => Math.round((anyPart(state.compareB!.metrics).earthAnyPct - anyPart(state.compareA!.metrics).earthAnyPct) * 100) / 100;
        const diff = ready ? { meaning: 'B minus A', illuminationPct: d('illuminationPct'), longestDarknessH: d('longestDarknessH'), earthVisiblePct: d('earthVisiblePct'), ...(options.eventSpans && { earthAnyPct: dAny() }), longestEarthGapH: d('longestEarthGapH'), slopeDeg: d('slopeDeg'), highlights: [] as string[] } : null;
        return { comparing: true, A: state.compareA!.label, B: state.compareB!.label, analysisA: side(state.compareA!), analysisB: side(state.compareB!), diff };
      },
    }),
    defineAction({ name: 'stopCompare', title: 'Close comparison', description: 'Closes.', effect: 'command', params: none, run: () => { state.comparing = false; return { comparing: false }; } }),
    defineAction<{ type: string; which?: 'next' | 'previous'; instant?: 'event' | 'start' | 'end' }, unknown>({
      name: 'jumpToEvent', title: 'Jump to sunrise/sunset/Earthrise/Earthset', description: 'Moves the clock to an event.', effect: 'command',
      params: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'event', enum: ['sunrise', 'sunset', 'earthrise', 'earthset'] },
          which: { type: 'string', description: 'which', enum: ['next', 'previous'] },
          ...(options.eventSpans && { instant: { type: 'string' as const, description: 'the event, or the start or end of its passage', enum: ['event', 'start', 'end'] } }),
        },
        required: ['type'],
      },
      run: ({ type, which = 'next', instant = 'event' }) => {
        requireSite();
        // Each instant of this type: the event itself, or an end of its passage (T-47).
        const p = options.eventSpans ? passageOf(type) : null;
        const list = EVENTS.filter((e) => e.type === type).map((e) => {
          if (instant === 'event' || !p) return { timeMs: e.timeMs as number, azDeg: e.azDeg as number, ...(options.eventLabels && EVENT_INFO[type]) };
          const r = spanReport(p), end = instant === 'start' ? r.start : r.end;
          return { timeMs: instant === 'start' ? p.startMs : p.endMs, azDeg: end.azDeg, label: end.label, instant: edgeInstant(p, instant === 'start' ? 0 : 1) };
        });
        const hit = which === 'next' ? list.find((e) => e.timeMs > state.timeMs + 30_000) : [...list].reverse().find((e) => e.timeMs < state.timeMs - 30_000);
        if (!hit) throw new ActionError(`No ${which} ${type} inside the analysed mission window.`);
        state.playing = false;
        state.timeMs = hit.timeMs;
        const { timeMs, ...named } = hit;
        return { event: type, ...(options.eventSpans && { instantChoice: instant }), ...named, timeUtc: isoUtc(timeMs), ...(options.eventSpans && { span: spanReport(p!) }) };
      },
    }),
    defineAction({
      name: 'getState', title: 'Current state', description: 'Reads what is on screen now.', effect: 'query', params: none,
      run: () => ({
        view: state.view,
        ...timeOut(),
        ...(options.siteRecords && { wallClockUtc: new Date(REAL_NOW).toISOString().slice(0, 19) + 'Z' }),
        lightMode: state.lightMode,
        site: siteOut(state.site),
        globeCenter: state.globeCenter,
        ...(options.viewTarget && { globeDisplay: { viewTarget: state.viewTarget && { ...state.viewTarget, flying: false } } }),
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
          if (options.comparePanel) {
            state.panelTab = 'nearby';
            state.comparing = true;
          }
          return { reference, rankedCount: candidates.length, candidates, rejected: { slope: nearbyRows.filter((r) => r.slopeDeg > slopeLimitDeg).length, noData: 0 }, basis: 'Slope and skyline from the 60 m grid: metre-scale hazards are not visible.' };
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
            if (!e) return null;
            const span = options.eventSpans ? spanReport(passageOf(type)) : undefined;
            return { ...(options.eventLabels && { label: EVENT_INFO[type].label }), timeUtc: isoUtc(e.timeMs), azDeg: e.azDeg, inHours: (e.timeMs - state.timeMs) / 3_600_000, ...(span && { summary: `${type}: ${span.summary}`, span }) };
          };
          // The passage under way at the clock, else the next to start (grazes included).
          const passage = (body: 'sun' | 'earth') => {
            const p = PASSAGES.find((x) => x.body === body && x.endMs > state.timeMs);
            return p ? spanReport(p) : null;
          };
          const m = currentMetrics();
          const terrain = { distanceKm: 4.2, heightM: 1385, latDeg: -84.66, lonDegEast: 28.9, demName: 'LOLA 60 m polar grid', demResolutionM: 60 };
          return {
            slot, state: 'ready', scenario: { label: label(), site: siteOut(state.site), durationH: state.windowDurationH, mastHeightM: state.mastHeightM },
            metrics: { illuminationPct: m.illuminationPct, longestDarknessH: m.longestDarknessH, earthVisiblePct: m.earthVisiblePct, longestEarthGapH: m.longestEarthGapH, ...(options.eventSpans && { ...anyPart(m), earthAnyGapRunsIntoWindowEdge: false }) },
            slope: { slopeDeg: m.slopeDeg, demName: 'LOLA 60 m polar grid' },
            now: {
              timeUtc: isoUtc(state.timeMs),
              sun: { azDeg: 143.2, elDeg: 3.4, skylineElDeg: 2.3, clearanceDeg: 1.1, centreAboveSkyline: true, skylineTerrain: terrain, explanation: 'The Sun is 1.10° above the skyline at azimuth 143.2°.' },
              earth: { azDeg: 351.0, elDeg: 5.6, skylineElDeg: 6.4, clearanceDeg: -0.8, centreAboveSkyline: false, skylineTerrain: terrain, explanation: 'Earth is hidden by terrain 4.20 km away towards azimuth 351.0°: the skyline there is at 6.40° and the centre of the disc at 5.60°.' },
            },
            nextEvents: { sunrise: next('sunrise'), sunset: next('sunset'), earthrise: next('earthrise'), earthset: next('earthset') },
            ...(options.eventSpans && { nextPassages: { sun: passage('sun'), earth: passage('earth') } }),
            ...(options.eventLabels && { eventDefinitions: Object.fromEntries(Object.entries(EVENT_INFO).map(([k, v]) => [k, `${v.label}: ${v.instant}.`])) }),
            requirements: {
              sunElevationBand: (() => {
                const required = state.sunBand.min !== 0 || state.sunBand.max !== 90;
                const band = { minDeg: state.sunBand.min, maxDeg: state.sunBand.max, windowMinSunElDeg: -1.2, windowMaxSunElDeg: 4.6, metForWholeWindow: state.sunBand.min <= -1.2 && state.sunBand.max >= 4.6 };
                // As src/core/requirements.ts NO_SUN_BAND_TEXT.
                if (!options.bandRule) return band;
                return required ? { required, ...band } : { required, ...band, metForWholeWindow: null, note: 'No solar elevation band is required (the Filters panel is at its default, 0° to 90°), so there is nothing to check.' };
              })(),
              maxEarthGap: state.maxEarthGapH === null ? null : { limitH: state.maxEarthGapH, ...(options.eventSpans && { basis: "Earth's centre" }), longestEarthGapH: m.longestEarthGapH, met: m.longestEarthGapH <= state.maxEarthGapH },
            },
            provenance: { ephemeris: 'model', elevationData: [{ name: 'LOLA 60 m polar grid', resolutionM: 60, fromKm: 0, toKm: 30 }, { name: 'LOLA whole-Moon grid', resolutionM: 1895, fromKm: 30, toKm: 400 }], assumptions: [] },
            warnings: [],
          };
        },
      }),
    );
  }
  if (options.displayActions) {
    const display = () => ({
      reliefExaggeration: state.reliefFactor,
      reliefDrawnNow: state.reliefFactor,
      reliefRule: state.reliefFactor > 1 ? 'The chosen factor applies above 1,000 km camera altitude and eases to true scale (1) below 100 km.' : null,
      reliefDataSamplesPerDegree: 16,
      coverageShown: state.coverage,
      iceTargetsShown: state.iceTargets,
      polarCloseUp: null,
      averageMaps: { state: 'off' },
    });
    const bool = (name: string, title: string, key: 'coverage' | 'iceTargets') =>
      defineAction<{ show: boolean }, unknown>({ name, title, description: title, effect: 'command', params: { type: 'object', properties: { show: { type: 'boolean', description: 'show' } }, required: ['show'] }, run: ({ show }) => { state[key] = show; return display(); } });
    actions.push(
      defineAction<{ factor: number }, unknown>({ name: 'setReliefExaggeration', title: 'Relief exaggeration', description: 'Relief.', effect: 'command', params: { type: 'object', properties: { factor: { type: 'number', description: 'factor', minimum: 0, maximum: 30 } }, required: ['factor'] }, run: ({ factor }) => { state.reliefFactor = factor; return display(); } }),
      bool('showCoverage', 'Show elevation data coverage', 'coverage'),
      bool('showIceTargets', 'Show mapped ice targets', 'iceTargets'),
      defineAction({ name: 'resetNorth', title: 'North up', description: 'North up.', effect: 'command', params: none, run: () => ({ northAngleDeg: 0 }) }),
      defineAction<{ zoom: number }, unknown>({ name: 'setLocatorZoom', title: 'Zoom locator map', description: 'Zoom.', effect: 'command', params: { type: 'object', properties: { zoom: { type: 'number', description: 'zoom', minimum: 1, maximum: 16 } }, required: ['zoom'] }, run: ({ zoom }) => { state.locatorZoom = zoom; return { locatorZoom: zoom }; } }),
      defineAction<{ open: boolean }, unknown>({ name: 'setAssistantOpen', title: 'Open or close the assistant', description: 'Drawer.', effect: 'command', params: { type: 'object', properties: { open: { type: 'boolean', description: 'open' } }, required: ['open'] }, run: ({ open }) => { state.assistantOpen = open; return { assistantOpen: open }; } }),
      defineAction({ name: 'clearConversation', title: 'Clear the conversation', description: 'Clears the chat.', effect: 'command', params: none, run: () => ({ cleared: true }) }),
    );
  }
  if (options.scienceActions) {
    const ice = (lat: number, count = 3) => ({
      available: true,
      nearest: ICE_TARGETS.slice(0, count),
      mappedRegions: 169,
      distanceMeaning: 'Straight-line distance over a 1737.4 km sphere to the nearest edge of the mapped outline (0 inside): not a traverse, it ignores terrain, slope and lighting.',
      whatTheseAre: 'Permanently shaded regions with water-ice signatures in the south polar region, as mapped by the authors: targets of interest, not confirmed deposits at any one spot.',
      dataNotes: ['Outlines are about 0.3 km wider than the listed shadowed areas.'],
      credit: 'Lemelin et al. 2021. Licence: CC BY 4.0.',
      ...(lat > -60 && { nearest: [], note: 'No mapped region lies within 500 km: the database covers the south polar region only.' }),
    });
    actions.push(
      defineAction({
        name: 'getSiteScience', title: 'Site science readouts', description: 'Science layers for the site.', effect: 'query', params: none,
        run: () => {
          const site = requireSite();
          const contact = (pct: number, gap: number) => ({ pctOfWindow: pct, longestGapH: gap, gapRunsIntoWindowEdge: false });
          return {
            site: { id: site.id, name: site.name, latDeg: site.latDeg, lonDegEast: site.lonDegEast },
            dsn: {
              available: true, windowStartUtc: isoUtc(state.windowStartMs), windowEndUtc: isoUtc(state.windowStartMs + state.windowDurationH * 3_600_000), windowDurationH: state.windowDurationH,
              stations: [
                { id: 'DSS-14', name: 'Goldstone DSS-14', complex: 'Goldstone, USA', receive: contact(59.1, 9.8), transmit: contact(55.0, 10.4), receiveLimitDeg: 10, transmitLimitDeg: 10 },
                { id: 'DSS-43', name: 'Canberra DSS-43', complex: 'Canberra, Australia', receive: contact(32.7, 16.2), transmit: contact(30.1, 16.9), receiveLimitDeg: 10, transmitLimitDeg: 10 },
                { id: 'DSS-63', name: 'Madrid DSS-63', complex: 'Madrid, Spain', receive: contact(57.2, 10.1), transmit: contact(54.4, 10.7), receiveLimitDeg: 10, transmitLimitDeg: 10 },
              ],
              anyStation: { receive: contact(100, 0), transmit: contact(100, 0) },
              meaning: 'Geometric line of sight only: not a link budget, not a schedule, not antenna availability.',
              assumptions: ['Stations above their elevation limit and above the site\'s terrain skyline.'],
            },
            longTermAverages: site.latDeg < -80
              ? { available: true, sunlight: { available: true, pctOfTime: 45, neverInModel: false, cellM: 120, source: 'PGDA 69', text: 'Any sunlight 45 % of the time.' }, earthVisibility: { available: true, pctOfTime: 90, neverInModel: false, cellM: 120, source: 'PGDA 69', text: 'Any of Earth 90 % of the time.' }, kind: 'Multi-year average of a model (18.6 years of hourly steps), not the geometry of the simulated date or of the mission window.', averagingPeriod: '18.6 years', caveats: [], citation: 'Mazarico et al. 2011 (NASA PGDA product 69).' }
              : { available: false, sunlight: { available: false, pctOfTime: null, neverInModel: false, cellM: null, source: null, text: 'No published average map covers this point: the maps cover the polar regions only.' }, earthVisibility: { available: false, pctOfTime: null, neverInModel: false, cellM: null, source: null, text: 'n/a' }, kind: 'Multi-year average of a model.', averagingPeriod: '18.6 years', caveats: [], citation: 'NASA PGDA product 69.' },
            iceTargets: ice(site.latDeg),
            ...(options.scienceActions === 't30'
              ? {
                  surfaceTemperature: site.latDeg < -80
                    ? { available: true, status: 'ok', annualMaxK: 226, annualMeanK: 127, cellM: 240, measuredOver: 'July 2009 to February 2019', text: 'Annual maximum 226 K, annual mean 127 K (Diviner).', kind: 'Annual maximum and annual mean of the surface temperature, from many years of LRO Diviner measurements: not the temperature at the simulated date or during the mission window.', notIncluded: [], caveats: [], citation: 'Williams et al. 2019.', licence: 'public domain' }
                    : { available: false, status: 'outside', annualMaxK: null, annualMeanK: null, cellM: 240, measuredOver: 'July 2009 to February 2019', text: 'The Diviner polar maps cover only latitudes poleward of 80 degrees.', kind: 'Annual values.', notIncluded: [], caveats: [], citation: 'Williams et al. 2019.', licence: 'public domain' },
                  shadowCam: { available: false, mosaics: [], text: 'No ShadowCam controlled mosaic covers this point.', imagesBundled: false, credit: 'NASA/KARI/ASU', creditNote: '', licence: '', citation: [], archiveUrl: 'https://pds.shadowcam.asu.edu/', mosaicsInIndex: 26, coverageMeaning: '' },
                  notIncluded: ['Diviner temperatures are annual values: separate summer and winter maps are not included.', 'ShadowCam images are not bundled with the app: where a mosaic covers the site, the readout links to the product in the ShadowCam PDS archive.'],
                }
              : { notIncluded: ['Diviner seasonal temperatures and ShadowCam imagery are not packaged in this build.'] }),
          };
        },
      }),
      defineAction<{ lat?: number; lon?: number; count?: number; maxKm?: number }, unknown>({
        name: 'nearestIceTargets', title: 'Nearest ice targets', description: 'Ice targets near a point.', effect: 'query',
        params: { type: 'object', properties: { lat: { type: 'number', description: 'lat', minimum: -90, maximum: 90 }, lon: { type: 'number', description: 'lon', minimum: -360, maximum: 360 }, count: { type: 'integer', description: 'count', minimum: 1, maximum: 20 }, maxKm: { type: 'number', description: 'km', minimum: 1, maximum: 6000 } } },
        run: ({ lat, lon, count }) => {
          if ((lat === undefined) !== (lon === undefined)) throw new ActionError('Give both `lat` and `lon`, or neither to use the selected site.');
          const at = lat !== undefined ? { latDeg: lat, lonDegEast: lon! } : (({ latDeg, lonDegEast }) => ({ latDeg, lonDegEast }))(requireSite());
          return { from: at, ...ice(at.latDeg, count ?? 5) };
        },
      }),
    );
  }
  if (options.surfaceActions) {
    const requireSurface = () => {
      if (state.view !== 'surface') throw new ActionError('Enter the surface view first (enterSurface).');
    };
    const LIMIT_M = 2000;
    const positionOut = () => ({ eastM: state.position.eastM, northM: state.position.northM, distanceFromSiteM: Math.round(Math.hypot(state.position.eastM, state.position.northM) * 10) / 10, eyeHeightM: Math.max(0.2, state.mastHeightM) + state.position.liftM });
    const SKY = { sun: { azDeg: 143.2, elDeg: 3.4 }, earth: { azDeg: 351.0, elDeg: 5.6 } } as const;
    actions.push(
      defineAction<{ on: boolean }, unknown>({ name: 'setGeneratedDetail', title: 'Generated detail', description: 'Generated detail.', effect: 'command', params: { type: 'object', properties: { on: { type: 'boolean', description: 'on' } }, required: ['on'] }, run: ({ on }) => { state.generated = on; return { generatedDetail: on, whatIsGenerated: 'Rocks and sub-metre texture.' }; } }),
      defineAction<{ fovDeg: number }, unknown>({
        name: 'setFieldOfView', title: 'Zoom', description: 'Field of view.', effect: 'command', params: { type: 'object', properties: { fovDeg: { type: 'number', description: 'fov', minimum: 4, maximum: 100 } }, required: ['fovDeg'] },
        run: ({ fovDeg }) => { requireSurface(); state.look = { ...state.look, fovDeg }; return { look: state.look }; },
      }),
      defineAction<{ body: 'sun' | 'earth'; fovDeg?: number }, unknown>({
        name: 'lookAtBody', title: 'Face the Sun or Earth', description: 'Faces a body.', effect: 'command',
        params: { type: 'object', properties: { body: { type: 'string', description: 'body', enum: ['sun', 'earth'] }, fovDeg: { type: 'number', description: 'fov', minimum: 4, maximum: 100 } }, required: ['body'] },
        run: ({ body, fovDeg }) => {
          requireSurface();
          const b = SKY[body];
          state.look = { azDeg: b.azDeg, elDeg: b.elDeg, fovDeg: fovDeg ?? state.look.fovDeg };
          return { body, azDeg: b.azDeg, elDeg: b.elDeg, angularDiameterDeg: body === 'sun' ? 0.533 : 1.9, belowHorizontal: b.elDeg < 0, look: state.look, timeUtc: isoUtc(state.timeMs), directions: 'topocentric (for the site itself), airless' };
        },
      }),
      defineAction<{ eastM: number; northM: number; liftM?: number }, unknown>({
        name: 'walkTo', title: 'Walk to', description: 'Moves the viewer.', effect: 'command',
        params: { type: 'object', properties: { eastM: { type: 'number', description: 'east', minimum: -30000, maximum: 30000 }, northM: { type: 'number', description: 'north', minimum: -30000, maximum: 30000 }, liftM: { type: 'number', description: 'lift', minimum: 0, maximum: 500 } }, required: ['eastM', 'northM'] },
        run: ({ eastM, northM, liftM }) => {
          requireSurface();
          state.position = { eastM: Math.max(-LIMIT_M, Math.min(LIMIT_M, eastM)), northM: Math.max(-LIMIT_M, Math.min(LIMIT_M, northM)), liftM: liftM ?? 0 };
          const at = positionOut();
          return { position: at, clamped: Math.abs(at.eastM - eastM) > 0.5 || Math.abs(at.northM - northM) > 0.5 };
        },
      }),
      defineAction<{ tracks?: boolean; labels?: boolean }, unknown>({
        name: 'setSkyAnnotations', title: 'Sky paths and labels', description: 'Sky paths.', effect: 'command', params: { type: 'object', properties: { tracks: { type: 'boolean', description: 'tracks' }, labels: { type: 'boolean', description: 'labels' } } },
        run: ({ tracks, labels }) => {
          if (tracks === undefined && labels === undefined) throw new ActionError('Give `tracks` and/or `labels`.');
          state.annotations = { tracks: tracks ?? state.annotations.tracks, labels: labels ?? state.annotations.labels };
          return { ...state.annotations, markEvery: { sunH: 1, earthH: 2 } };
        },
      }),
      defineAction({
        name: 'getSurfaceView', title: 'Surface view state', description: 'What the surface view shows.', effect: 'query', params: none,
        run: () => ({
          active: state.view === 'surface',
          site: siteOut(state.site),
          look: state.look,
          position: positionOut(),
          sky: { timeUtc: isoUtc(state.timeMs), directions: 'topocentric (for the site itself), airless', sun: { ...SKY.sun, angularDiameterDeg: 0.533, discAboveDrawnTerrainPct: 100, discBehindEarthPct: 0 }, earth: { ...SKY.earth, angularDiameterDeg: 1.9, litPct: 48, centreBehindDrawnTerrain: true }, note: 'Visibility here is against the terrain as drawn, from where the viewer stands.' },
          lighting: 'real',
          ground: { summary: 'LOLA 40 m polar grid to 30 km, whole-Moon grid beyond', surveyed: false, drawnOutToKm: 246, bands: [{ fromM: 0, toM: 30000, gridSpacingM: 40, product: 'LOLA 40 m polar grid', productResolutionM: 40, interpolated: false }, { fromM: 30000, toM: 246000, gridSpacingM: 1895, product: 'LOLA whole-Moon grid', productResolutionM: 1895, interpolated: false }], generated: 'Rocks, craters a few metres across and finer texture near the viewer.', generatedDetailShown: state.generated, notes: [] },
          annotations: { ...state.annotations, window: null },
        }),
      }),
    );
  }
  if (options.hudActions) {
    const chartOut = () => ({ chart: state.hud.chart, mode: state.hud.mode, table: state.hud.table, azimuthRange: state.hud.azimuthRange });
    actions.push(
      defineAction<{ show?: boolean; expanded?: boolean; mode?: 'skyline' | 'time'; table?: boolean; azimuthRange?: 'full' | 'tracks' }, unknown>({
        name: 'setChart', title: 'Skyline chart', description: 'The chart.', effect: 'command',
        params: { type: 'object', properties: { show: { type: 'boolean', description: 'show' }, expanded: { type: 'boolean', description: 'large' }, mode: { type: 'string', description: 'mode', enum: ['skyline', 'time'] }, table: { type: 'boolean', description: 'table' }, azimuthRange: { type: 'string', description: 'range', enum: ['full', 'tracks'] } } },
        run: ({ show, expanded, mode, table, azimuthRange }) => {
          if ([show, expanded, mode, table, azimuthRange].every((v) => v === undefined)) throw new ActionError('Give at least one of `show`, `expanded`, `mode`, `table`, `azimuthRange`.');
          const h = state.hud;
          h.chart = show === false ? 'hidden' : expanded !== undefined ? (expanded ? 'expanded' : 'compact') : h.chart === 'hidden' ? 'compact' : h.chart;
          if (mode) h.mode = mode;
          if (table !== undefined) h.table = table;
          if (azimuthRange) h.azimuthRange = azimuthRange;
          return chartOut();
        },
      }),
      defineAction<{ open: boolean }, unknown>({ name: 'showKeyMetrics', title: 'Key metrics panel', description: 'Key metrics.', effect: 'command', params: { type: 'object', properties: { open: { type: 'boolean', description: 'open' } }, required: ['open'] }, run: ({ open }) => { state.hud.metricsOpen = open; return { keyMetricsOpen: open }; } }),
      defineAction({ name: 'dismissBlockageExplanation', title: 'Close the blockage explanation', description: 'Closes it.', effect: 'command', params: none, run: () => { state.hud.explanation = false; return { explanationShown: false }; } }),
    );
  }
  if (options.presetActions) {
    const T = Date.UTC(2025, 2, 14, 2, 0);
    const describe = (p: (typeof PRESETS)[number]) => ({ id: p.id, title: p.title, description: p.title, site: { id: p.siteId }, missionWindow: { startUtc: isoUtc(T), durationH: 12, endUtc: isoUtc(T + 12 * 3_600_000) }, clockStartsUtc: isoUtc(T), view: p.view, rateSimSecondsPerSecond: 600, playsOnLoad: true, sources: [] });
    actions.push(
      defineAction({ name: 'listPresets', title: 'Missions to replay', description: 'Lists the presets.', effect: 'query', params: none, run: () => ({ presets: PRESETS.map(describe), loaded: state.preset }) }),
      defineAction<{ id: string; play?: boolean }, unknown>({
        name: 'loadPreset', title: 'Replay a mission', description: 'Loads a preset.', effect: 'command',
        params: { type: 'object', properties: { id: { type: 'string', description: 'id' }, play: { type: 'boolean', description: 'play' } }, required: ['id'] },
        run: ({ id, play }) => {
          const p = PRESETS.find((x) => x.id === id.trim());
          if (!p) throw new ActionError(`There is no preset "${id}". Presets: ${PRESETS.map((x) => x.id).join(', ')}.`);
          const l = LANDINGS.find((x) => x.id === p.siteId) ?? { id: p.siteId, name: 'Blue Ghost Mission 1', kind: 'landing' as const, latDeg: 18.562, lonDegEast: 61.81 };
          state.site = { id: l.id, name: l.name, kind: 'landing', latDeg: l.latDeg, lonDegEast: l.lonDegEast };
          state.timeMs = T;
          state.windowStartMs = T;
          state.windowDurationH = 12;
          state.view = 'surface';
          state.playing = play ?? true;
          state.rate = 600;
          state.preset = p.id;
          return { preset: { id: p.id, title: p.title }, view: 'surface', site: siteOut(state.site), timeUtc: isoUtc(T), playing: state.playing, rateSimSecondsPerSecond: 600, missionWindow: { startUtc: isoUtc(T), durationH: 12, endUtc: isoUtc(T + 12 * 3_600_000) } };
        },
      }),
      defineAction<{ show: boolean }, unknown>({ name: 'showFlags', title: 'Show country flags', description: 'Flags.', effect: 'command', params: { type: 'object', properties: { show: { type: 'boolean', description: 'show' } }, required: ['show'] }, run: ({ show }) => { state.flags = show; return { showFlags: show }; } }),
    );
  }
  if (options.catalogActions) {
    actions.push(
      defineAction<{ shownOnly?: boolean }, unknown>({
        name: 'listSites', title: 'List the landing sites', description: 'The catalogue.', effect: 'query', params: { type: 'object', properties: { shownOnly: { type: 'boolean', description: 'only shown' } } },
        run: () => ({
          total: LANDINGS.length, shown: LANDINGS.length, listed: LANDINGS.length, filter: state.filter, markersOnGlobe: state.showMissions, selectedId: state.site?.id ?? null,
          sites: [...LANDINGS].sort((a, b) => a.landedMs - b.landedMs).map((l) => ({ id: l.id, name: l.name, latDeg: l.latDeg, lonDegEast: l.lonDegEast, program: l.program, country: l.country, landedUtc: isoUtc(l.landedMs), crewed: l.crewed, region: 'r', positionApproximate: false, summary: 's', shown: true })),
        }),
      }),
    );
  }
  if (options.comparePanel) {
    const labels = () => ({ A: state.compareA?.label ?? null, B: state.compareB?.label ?? null });
    const side = (x: FakeState['compareA']) => (x ? { state: 'ready', scenario: x.label, ...x.metrics, warnings: [] } : null);
    const compareOut = () => ({ comparing: state.comparing, ...labels(), analysisA: side(state.compareA), analysisB: side(state.compareB), diff: state.compareA && state.compareB ? { meaning: 'B minus A', illuminationPct: state.compareB.metrics.illuminationPct - state.compareA.metrics.illuminationPct, highlights: [] } : null });
    const showPair = (a: NonNullable<FakeState['compareA']>, b: NonNullable<FakeState['compareB']>) => {
      state.compareA = a;
      state.compareB = b;
      state.comparing = true;
      state.panelTab = 'compare';
    };
    const base = (basis?: 'A' | 'current') => {
      if (basis !== 'current' && state.compareA) return { a: state.compareA, from: 'A' as const };
      const site = requireSite();
      return { a: { label: label(), metrics: metricsFor(site, state.mastHeightM, state.delayH) }, from: 'current' as const };
    };
    const BASIS = { type: 'string', description: 'basis', enum: ['A', 'current'] } as const;
    const named = { type: 'object', properties: { name: { type: 'string', description: 'name' } }, required: ['name'] } as const;
    actions.push(
      defineAction<{ tab?: 'compare' | 'nearby' | 'windows' | 'outlook' }, unknown>({
        name: 'openCompare', title: 'Open the compare panel', description: 'Opens the panel.', effect: 'command', params: { type: 'object', properties: { tab: { type: 'string', description: 'tab', enum: ['compare', 'nearby', 'windows', 'outlook'] } } },
        run: ({ tab }) => { if (tab) state.panelTab = tab; state.comparing = true; return { open: true, tab: state.panelTab, ...labels(), comparison: state.compareA && state.compareB ? 'ready' : 'idle', ...(!(state.compareA && state.compareB) && { emptySlots: [!state.compareA && 'A', !state.compareB && 'B'].filter(Boolean) }) }; },
      }),
      defineAction<{ delayH?: number; basis?: 'A' | 'current' }, unknown>({
        name: 'compareDelayedArrival', title: 'Compare with a later arrival', description: 'B arrives later.', effect: 'command', params: { type: 'object', properties: { delayH: { type: 'number', description: 'h', minimum: 0.1, maximum: 720 }, basis: BASIS } },
        run: ({ delayH = 24, basis }) => {
          const b0 = base(basis);
          const site = requireSite();
          const start = state.windowStartMs + state.delayH * 3_600_000;
          showPair({ label: `${site.name} (earlier arrival)`, metrics: b0.a.metrics }, { label: `${site.name} (arrival ${delayH} h later)`, metrics: metricsFor(site, state.mastHeightM, state.delayH + delayH) });
          return { ...compareOut(), basis: b0.from, delayH, plannedArrivalUtc: isoUtc(start), revisedArrivalUtc: isoUtc(start + delayH * 3_600_000) };
        },
      }),
      defineAction<{ heightAM?: number; heightBM: number; basis?: 'A' | 'current' }, unknown>({
        name: 'compareMastHeights', title: 'Compare two mast heights', description: 'Two masts.', effect: 'command', params: { type: 'object', properties: { heightAM: { type: 'number', description: 'A', minimum: 0, maximum: 100 }, heightBM: { type: 'number', description: 'B', minimum: 0, maximum: 100 }, basis: BASIS }, required: ['heightBM'] },
        run: ({ heightAM, heightBM }) => {
          const site = requireSite();
          const a = heightAM ?? state.mastHeightM;
          if (a === heightBM) throw new ActionError(`Both sides would have a ${heightBM} m mast. Give two different heights.`);
          showPair({ label: `${site.name} (${a} m mast)`, metrics: metricsFor(site, a, state.delayH) }, { label: `${site.name} (${heightBM} m mast)`, metrics: metricsFor(site, heightBM, state.delayH) });
          return { ...compareOut(), basis: 'current', mastHeightAM: a, mastHeightBM: heightBM };
        },
      }),
      defineAction({
        name: 'swapComparison', title: 'Swap A and B', description: 'Swaps.', effect: 'command', params: none,
        run: () => { if (!state.compareA && !state.compareB) throw new ActionError('Both comparison slots are empty: there is nothing to swap.'); [state.compareA, state.compareB] = [state.compareB, state.compareA]; return state.compareA && state.compareB ? compareOut() : labels(); },
      }),
      defineAction<{ slot?: 'A' | 'B' }, unknown>({
        name: 'clearComparison', title: 'Empty the comparison slots', description: 'Empties.', effect: 'command', params: { type: 'object', properties: { slot: { type: 'string', description: 'slot', enum: ['A', 'B'] } } },
        run: ({ slot }) => { if (slot !== 'B') state.compareA = null; if (slot !== 'A') state.compareB = null; return labels(); },
      }),
      defineAction<{ name?: string }, unknown>({
        name: 'saveComparison', title: 'Save this comparison', description: 'Saves the pair.', effect: 'command', params: { type: 'object', properties: { name: { type: 'string', description: 'name' } } },
        run: ({ name }) => {
          if (!state.compareA || !state.compareB) throw new ActionError('A saved comparison holds both A and B.');
          const clean = (name ?? `${state.compareA.label} vs ${state.compareB.label}`).trim();
          const replaced = state.saved.some((c) => c.name === clean);
          state.saved = [{ name: clean, savedUtc: isoUtc(T0), a: state.compareA, b: state.compareB, clockMs: state.timeMs }, ...state.saved.filter((c) => c.name !== clean)];
          return { saved: { name: clean, savedUtc: isoUtc(T0), A: state.compareA.label, B: state.compareB.label, clockUtc: isoUtc(state.timeMs) }, replaced, count: state.saved.length, keptInBrowserStorage: true };
        },
      }),
      defineAction<{ name: string }, unknown>({
        name: 'loadComparison', title: 'Load a saved comparison', description: 'Loads.', effect: 'command', params: named,
        run: ({ name }) => {
          const c = state.saved.find((x) => x.name === name.trim());
          if (!c) throw new ActionError(`No saved comparison is called "${name.trim()}".`);
          state.timeMs = c.clockMs;
          state.playing = false;
          showPair(c.a, c.b);
          return { ...compareOut(), loaded: c.name, savedUtc: c.savedUtc, restored: { clockUtc: isoUtc(c.clockMs), requirements: null } };
        },
      }),
      defineAction<{ name: string }, unknown>({
        name: 'deleteComparison', title: 'Delete a saved comparison', description: 'Deletes.', effect: 'command', params: named,
        run: ({ name }) => { const before = state.saved.length; state.saved = state.saved.filter((c) => c.name !== name.trim()); if (state.saved.length === before) throw new ActionError(`No saved comparison is called "${name.trim()}".`); return { deleted: name.trim(), count: state.saved.length }; },
      }),
      defineAction<{ format: 'csv' | 'json'; slot?: string }, unknown>({
        name: 'exportResults', title: 'Download the mission-window results', description: 'Downloads a file.', effect: 'command',
        params: { type: 'object', properties: { format: { type: 'string', description: 'format', enum: ['csv', 'json'] }, slot: { type: 'string', description: 'slot', enum: ['current', 'A', 'B', 'AB'] } }, required: ['format'] },
        run: ({ format }) => {
          requireSite();
          return { format, filename: `lunyx-${state.site!.id}-window.${format}`, mimeType: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json', bytes: 2048, scenarios: [{ slot: 'current', label: label() }], spells: 6, downloaded: true };
        },
      }),
      defineAction<{ months?: number; slot?: string }, unknown>({
        name: 'showOutlook', title: 'Show the seasonal outlook', description: 'The long view.', effect: 'command',
        params: { type: 'object', properties: { months: { type: 'integer', description: 'months', minimum: 1, maximum: 24 }, slot: { type: 'string', description: 'slot', enum: ['current', 'A', 'B'] } } },
        run: ({ months = 12 }) => {
          requireSite();
          state.panelTab = 'outlook';
          state.comparing = true;
          const opt = (day: number, score: number) => ({ arrivalUtc: isoUtc(state.windowStartMs + day * 86_400_000), endUtc: isoUtc(state.windowStartMs + day * 86_400_000 + state.windowDurationH * 3_600_000), slipDays: day, score, illuminationPct: score - 5, earthVisiblePct: score + 5, longestDarknessH: 10 - day / 10 });
          return {
            scenario: { label: label() }, months, span: { startUtc: isoUtc(state.windowStartMs), endUtc: isoUtc(state.windowStartMs + months * 29.530589 * 86_400_000) }, rowLengthDays: 29.531,
            lunarDays: [], missionH: state.windowDurationH, planned: opt(0, 60), best: opt(9, 75.5), worst: opt(20, 31.25),
            slips: [{ ...opt(1, 61), scoreChange: 1, illuminationChangePct: 0.5, earthVisibleChangePct: 1.5, longestDarknessChangeH: -0.2 }],
            longestDarkness: { startUtc: isoUtc(state.windowStartMs), endUtc: isoUtc(state.windowStartMs + 40 * 3_600_000), hours: 40, startFound: true, endFound: true },
            longestEarthGap: null, scoring: 'score = mean of illuminationPct and earthVisiblePct over a mission of missionH hours from each arrival (arrivals every 2 h); higher is better',
            highlights: ['Arriving 9 days later gives the best score.'], assumptions: ['In-app Sun/Earth model, one skyline throughout.'], warnings: [],
          };
        },
      }),
      defineAction({
        name: 'listComparisons', title: 'List saved comparisons', description: 'Lists.', effect: 'query', params: none,
        run: () => ({ comparisons: state.saved.map((c) => ({ name: c.name, savedUtc: c.savedUtc, A: c.a.label, B: c.b.label, clockUtc: isoUtc(c.clockMs) })), keptInBrowserStorage: true }),
      }),
    );
  }
  if (options.landingActions) {
    actions.push(
      defineAction<{ panel: string; open: boolean }, unknown>({
        name: 'showPanel', title: 'Show or fold a panel', description: 'Folds the site details or the filters sheet.', effect: 'command',
        params: { type: 'object', properties: { panel: { type: 'string', description: 'panel', enum: ['site-details', 'filters', 'site-science'] }, open: { type: 'boolean', description: 'open' } }, required: ['panel', 'open'] },
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
