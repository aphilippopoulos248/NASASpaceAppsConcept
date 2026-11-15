// What the key-metrics panel says, worked out from the shared analysis and the shared clock.
// Pure: no DOM. Every number comes from the science core (blockageAt, nextEvents, the
// analysis' metrics); where something is not available the text says so and why.
import { blockageAt, nextEvents, nextTransitions, skyAt, TRANSITION_WORDS, transitionSummary, transitionText } from '../../analysis/api';
import type { Blockage, FullSpan, SiteAnalysis, SkyEvent, SkyTransition } from '../../analysis/types';
import type { AnalysisStatus } from '../../core/analysisStore';
import { formatDuration, formatUtc } from '../../core/time';
import type { AppState } from '../../core/types';

export type BodyState = 'visible' | 'partial' | 'hidden' | 'behind-earth' | 'unknown';

export interface BodyNow {
  body: 'sun' | 'earth';
  azDeg: number;
  elDeg: number;
  /** Elevation of the body's centre minus the skyline at its azimuth; null while no skyline is available. */
  clearanceDeg: number | null;
  skylineElDeg: number | null;
  state: BodyState;
  /** The state in words, e.g. "above the skyline", "behind terrain", "41 % of the disc above the skyline". */
  stateText: string;
}

export interface Countdown {
  type: SkyEvent['type'];
  label: string;
  /** The instant the jump goes to (the event's own, decision D-8), e.g. "Sun fully set". */
  instant: string;
  /** Both ends of the passage (D-8), e.g. "starts setting 2025-03-19 22:15, fully set 23:17 UTC"; empty when there is none to show. */
  span: string;
  /** Null when no such event lies ahead inside the analysed window. */
  timeMs: number | null;
  inHours: number | null;
  /** The next instant of the passage still ahead, named: "Sun starts setting in 3 d 04 h"; or, briefly, why there is none. */
  text: string;
  /** The longer statement of the same (for a hint). */
  detail: string;
}

export interface WindowFigures {
  startMs: number;
  durationH: number;
  illuminationPct: number;
  sunAnyPct: number;
  longestDarknessText: string;
  earthVisiblePct: number;
  longestEarthGapText: string;
  /** Any part of Earth's disc above the skyline (PGDA product 69's definition); null when the analysis does not give it. */
  earthAnyPct: number | null;
  /** Longest spell with Earth's disc wholly hidden. */
  longestEarthAnyGapText: string;
  slopeText: string;
  /** How the slope was measured and which way the ground falls; empty when there is no slope. */
  slopeDetail: string;
  sunElRangeText: string;
}

export interface MetricsView {
  status: 'idle' | 'loading' | 'error' | 'ready';
  /** What to say instead of results (idle, loading, error). */
  message: string | null;
  timeMs: number;
  /** False when the clock is outside the analysed mission window (then "now" comes from the sky model against the same skyline). */
  insideWindow: boolean | null;
  sun: BodyNow | null;
  earth: BodyNow | null;
  countdowns: Countdown[] | null;
  window: WindowFigures | null;
  /** Requirements that are not met, in words. */
  flags: string[];
  /** One compact line: observer height, ephemeris source, elevation data and its resolution. Empty until an analysis is ready. */
  provenanceShort: string;
  provenance: string[];
  warnings: string[];
}

type Requirements = Pick<AppState, 'timeMs' | 'site' | 'mastHeightM' | 'sunElMinDeg' | 'sunElMaxDeg' | 'maxEarthGapH'>;

const EVENT_LABELS: Record<SkyEvent['type'], string> = { sunset: 'Sunset', sunrise: 'Sunrise', earthset: 'Earthset', earthrise: 'Earthrise' };
/**
 * A setting or rising takes time (about an hour for the Sun at low latitudes, far longer near
 * the poles), so every event time says which instant it is. The science core's events are:
 * the Sun's last limb going behind the skyline, its first limb appearing, and Earth's centre
 * crossing the skyline.
 */
const EVENT_INSTANT: Record<SkyEvent['type'], string> = { sunset: 'Sun fully set', sunrise: 'Sun starts rising', earthset: 'Earth\'s centre sets', earthrise: 'Earth\'s centre rises' };
const EVENT_MEANING: Record<SkyEvent['type'], string> = {
  sunset: 'the last limb of the Sun goes behind the terrain skyline (the Sun is fully set; the skyline starts to cut its disc before that)',
  sunrise: 'the first limb of the Sun appears over the terrain skyline (the whole disc is clear later)',
  earthset: 'Earth\'s centre goes below the terrain skyline (geometric line of sight, not a radio link)',
  earthrise: 'Earth\'s centre comes up over the terrain skyline (geometric line of sight, not a radio link)',
};
/** The order the design lists them in. */
export const EVENT_ORDER: readonly SkyEvent['type'][] = ['sunset', 'sunrise', 'earthset', 'earthrise'];

const deg = (v: number, digits = 2) => `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(digits)}°`;
const COMPASS16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const km = (m: number) => (m >= 9950 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`);
const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

/** `underHorizon`: the body is below where a smooth Moon's horizon would be (so it is night, or Earth has set, rather than a ridge being in the way). */
function bodyFromBlockage(b: Blockage, underHorizon: boolean): BodyNow {
  const hasSkyline = Number.isFinite(b.skylineElDeg);
  const visible = b.discVisibleFraction;
  let state: BodyState = 'unknown', stateText = 'skyline not available';
  if (hasSkyline) {
    if (b.body === 'sun' && (b.eclipsedFraction ?? 0) >= 0.995) {
      state = 'behind-earth';
      stateText = 'behind Earth (eclipse)';
    } else if (b.body === 'sun') {
      // Power needs the disc: say how much of it shows.
      if (visible !== undefined && Number.isFinite(visible) && visible > 0.005 && visible < 0.995) {
        state = 'partial';
        stateText = `${Math.round(visible * 100)} % of the disc above the skyline`;
      } else if ((visible !== undefined && Number.isFinite(visible) ? visible >= 0.995 : b.clearanceDeg > 0)) {
        state = 'visible';
        stateText = 'above the skyline';
      } else {
        state = 'hidden';
        stateText = underHorizon ? 'below the horizon' : 'behind terrain';
      }
      if ((b.eclipsedFraction ?? 0) > 0.005 && state !== 'hidden') stateText += `, ${Math.round((b.eclipsedFraction ?? 0) * 100)} % covered by Earth`;
    } else {
      // Earth: line of sight is to its centre, as in the mission-window figures.
      state = b.clearanceDeg >= 0 ? 'visible' : 'hidden';
      stateText = b.clearanceDeg >= 0 ? 'in line of sight' : underHorizon ? 'below the horizon' : 'behind terrain';
    }
  }
  return { body: b.body, azDeg: b.bodyAzDeg, elDeg: b.bodyElDeg, clearanceDeg: hasSkyline ? b.clearanceDeg : null, skylineElDeg: hasSkyline ? b.skylineElDeg : null, state, stateText };
}

function spanText(hours: number, openEnded: boolean, full: FullSpan | undefined): string {
  if (!Number.isFinite(hours)) return 'not available';
  if (hours < 0.05) return 'none';
  let text = formatDuration(hours);
  if (openEnded) {
    text += ' or more inside the window';
    if (full && full.hours > hours + 0.05) {
      text += `; ${formatDuration(full.hours)}${full.startFound && full.endFound ? '' : ' or more'} in full${full.endFound ? `, to ${formatUtc(full.endMs)}` : ''}`;
    }
  }
  return text;
}

/** The passage a countdown row is about when its event lies beyond the window: a set (or rise) that has begun, or begins, before the window ends. */
export function rowPassage(type: SkyEvent['type'], tr: SkyTransition | null, endMs: number): SkyTransition | null {
  if (!tr || tr.start.timeMs >= endMs) return null;
  const setting = type === 'sunset' || type === 'earthset';
  const kind = tr.kind === 'unresolved' ? (tr.start.edge === 'first-cut' ? 'set' : 'rise') : tr.kind;
  return kind === (setting ? 'set' : 'rise') ? tr : null;
}

/** The instants of a passage in time order, each with its D-8 label; ends that were not found carry no time and are left out. */
export function passageInstants(tr: SkyTransition): { label: string; timeMs: number; inWindow: boolean }[] {
  const words = TRANSITION_WORDS[tr.body];
  const out: { label: string; timeMs: number; inWindow: boolean }[] = [];
  if (tr.start.edge !== 'unresolved') out.push({ label: words[tr.start.edge].label, timeMs: tr.start.timeMs, inWindow: tr.start.inWindow });
  if (tr.body === 'earth') for (const c of tr.centre) out.push({ label: `Earth's centre ${c.up ? 'rises' : 'sets'}`, timeMs: c.timeMs, inWindow: c.inWindow });
  if (tr.end.edge !== 'unresolved') out.push({ label: words[tr.end.edge].label, timeMs: tr.end.timeMs, inWindow: tr.end.inWindow });
  return out;
}

function countdowns(a: SiteAnalysis, timeMs: number): Countdown[] {
  const next = nextEvents(a, timeMs);
  const passing = nextTransitions(a, timeMs);
  const endMs = a.scenario.startMs + a.scenario.durationH * 3_600_000;
  return EVENT_ORDER.map((type): Countdown => {
    const e = next[type];
    const body = type === 'sunset' || type === 'sunrise' ? 'sun' : 'earth';
    // The event's own passage; failing that, one under way (or starting) before the window ends whose event lies beyond it.
    const tr = e?.span ?? rowPassage(type, passing[body], endMs);
    const base = { type, label: EVENT_LABELS[type], instant: EVENT_INSTANT[type], timeMs: e?.timeMs ?? null, inHours: e ? (e.timeMs - timeMs) / 3_600_000 : null };
    if (tr) {
      const ahead = passageInstants(tr).find((x) => x.timeMs > timeMs);
      const under = tr.start.timeMs <= timeMs && timeMs < tr.end.timeMs;
      const text = ahead
        ? `${ahead.label} in ${formatDuration((ahead.timeMs - timeMs) / 3_600_000)}${ahead.inWindow ? '' : ' (after the analysed window)'}${under ? `, ${type === 'sunset' || type === 'earthset' ? 'setting' : 'rising'} now` : ''}`
        : 'under way past the analysed window';
      return { ...base, text, span: transitionSummary(tr), detail: `${transitionText(tr)}${e ? ` Clicking moves the clock to "${EVENT_INSTANT[type]}" (${formatUtc(e.timeMs)}).` : ''}` };
    }
    if (e) {
      // An event without its passage (an analysis made before passages existed): the instant alone, named.
      return { ...base, text: `${EVENT_INSTANT[type]} in ${formatDuration(base.inHours!)}`, span: '', detail: `${EVENT_LABELS[type]} at ${formatUtc(e.timeMs)}: ${EVENT_MEANING[type]}` };
    }
    const past = timeMs >= endMs;
    return {
      ...base,
      text: past ? 'none: clock past the window' : 'none before the window ends',
      span: '',
      detail: past
        ? `The clock is past the analysed mission window, which ended ${formatUtc(endMs)}. Events are only searched inside it.`
        : `No ${EVENT_LABELS[type].toLowerCase()} between now and the end of the analysed mission window (${formatUtc(endMs)}). ${EVENT_LABELS[type]} here means: ${EVENT_MEANING[type]}.`,
    };
  });
}

function provenanceLines(a: SiteAnalysis): string[] {
  const p = a.provenance, h = a.horizon;
  const dem = (p.dem.length ? p.dem : h.layers).map((l) => `${l.name} (${metres(l.resolutionM)} per sample, ${km(l.fromM)} to ${km(l.toM)})`);
  return [
    `Sun and Earth: ${p.ephemeris === 'horizons' ? 'JPL Horizons table for this site' : 'in-app sky model'}, as seen from the site (topocentric), no atmosphere. Times are UTC.`,
    ...(p.ephemerisNote ? [p.ephemerisNote] : []),
    `Skyline from ${dem.length ? dem.join('; ') : 'no elevation data'}, searched to ${km(h.maxRangeM)}.`,
    `Observer ${h.mastHeightM} m above the ground, at ${Number.isFinite(h.siteElevationM) ? `${Math.round(h.siteElevationM)} m` : 'unknown height'} above the 1737.4 km sphere.`,
    'Earth figures are geometric line of sight to Earth\'s centre, not a radio link.',
  ];
}

/** Observer height, where the Sun and Earth come from, and what the skyline is made of, in one line. */
function provenanceShort(a: SiteAnalysis): string {
  const p = a.provenance, h = a.horizon;
  const layers = [...(p.dem.length ? p.dem : h.layers)].sort((x, y) => x.resolutionM - y.resolutionM);
  const finest = layers[0];
  const dem = finest ? `${finest.name}, ${metres(finest.resolutionM)} per sample${layers.length > 1 ? `, and ${layers.length - 1} coarser grid${layers.length > 2 ? 's' : ''} farther out` : ''}` : 'no elevation data';
  return `Observer ${h.mastHeightM} m above the ground · ${p.ephemeris === 'horizons' ? 'JPL Horizons table' : 'in-app sky model'} · skyline from ${dem}`;
}

function flags(a: SiteAnalysis, sun: BodyNow | null, req: Requirements): string[] {
  const out: string[] = [];
  const m = a.metrics;
  const band = `${req.sunElMinDeg}° to ${req.sunElMaxDeg}°`;
  if (sun && (sun.elDeg < req.sunElMinDeg || sun.elDeg > req.sunElMaxDeg)) {
    out.push(`Sun elevation now ${deg(sun.elDeg)} is ${sun.elDeg < req.sunElMinDeg ? 'below' : 'above'} the required band (${band}).`);
  }
  if (Number.isFinite(m.minSunElDeg) && (m.minSunElDeg < req.sunElMinDeg || m.maxSunElDeg > req.sunElMaxDeg)) {
    out.push(`Over the mission window the Sun's elevation runs from ${deg(m.minSunElDeg)} to ${deg(m.maxSunElDeg)}: outside the required band (${band}) for part of it.`);
  }
  if (req.maxEarthGapH !== null && Number.isFinite(m.longestEarthGapH) && m.longestEarthGapH > req.maxEarthGapH) {
    out.push(`Longest gap without line of sight to Earth is ${formatDuration(m.longestEarthGapH)}${m.earthGapOpenEnded ? ' or more' : ''}: longer than the allowed ${formatDuration(req.maxEarthGapH)}.`);
  }
  return out;
}

/** Sun and Earth now from the sky model alone, for the time before a skyline exists. */
function bodiesWithoutSkyline(req: Requirements): { sun: BodyNow; earth: BodyNow } | null {
  if (!req.site) return null;
  try {
    const s = skyAt(req.site, req.mastHeightM, req.timeMs);
    const make = (body: 'sun' | 'earth'): BodyNow => ({ body, azDeg: s[body].azDeg, elDeg: s[body].elDeg, clearanceDeg: null, skylineElDeg: null, state: 'unknown', stateText: 'skyline not available yet' });
    return { sun: make('sun'), earth: make('earth') };
  } catch {
    return null;
  }
}

/**
 * Everything the key-metrics panel shows. `wantedId` is the id of the scenario the app state
 * asks for now: a result for another scenario (still on its way out) is treated as loading.
 */
export function buildMetrics(st: AnalysisStatus, wantedId: string | null, req: Requirements): MetricsView {
  const base: MetricsView = { status: 'idle', message: null, timeMs: req.timeMs, insideWindow: null, sun: null, earth: null, countdowns: null, window: null, flags: [], provenanceShort: '', provenance: [], warnings: [] };
  if (!req.site || st.state === 'idle') return { ...base, message: 'No site is selected. Select a landing site or drop a pin to see its sky.' };
  const stale = wantedId !== null && st.scenario.id !== wantedId;
  if (st.state === 'loading' || stale) {
    const bodies = bodiesWithoutSkyline(req);
    return { ...base, status: 'loading', message: 'Working out the skyline and the mission window…', sun: bodies?.sun ?? null, earth: bodies?.earth ?? null };
  }
  if (st.state === 'error') {
    const bodies = bodiesWithoutSkyline(req);
    return { ...base, status: 'error', message: `The site analysis is not available: ${st.error}`, sun: bodies?.sun ?? null, earth: bodies?.earth ?? null };
  }
  const a = st.value, m = a.metrics;
  const endMs = a.scenario.startMs + a.scenario.durationH * 3_600_000;
  const now = (body: 'sun' | 'earth') => {
    const b = blockageAt(a, body, req.timeMs);
    return bodyFromBlockage(b, b.bodyElDeg < a.horizon.smoothDipDeg);
  };
  const sun = now('sun'), earth = now('earth');
  const slope = a.slope;
  return {
    status: 'ready',
    message: null,
    timeMs: req.timeMs,
    insideWindow: req.timeMs >= a.scenario.startMs && req.timeMs <= endMs,
    sun,
    earth,
    countdowns: countdowns(a, req.timeMs),
    window: {
      startMs: a.scenario.startMs,
      durationH: a.scenario.durationH,
      illuminationPct: m.illuminationPct,
      sunAnyPct: m.sunAnyPct,
      longestDarknessText: spanText(m.longestDarknessH, m.darknessOpenEnded, m.longestDarknessFull),
      earthVisiblePct: m.earthVisiblePct,
      longestEarthGapText: spanText(m.longestEarthGapH, m.earthGapOpenEnded, m.longestEarthGapFull),
      earthAnyPct: m.earthAnyPct !== undefined && Number.isFinite(m.earthAnyPct) ? m.earthAnyPct : null,
      longestEarthAnyGapText: m.longestEarthAnyGapH === undefined ? 'not available' : spanText(m.longestEarthAnyGapH, m.earthAnyGapOpenEnded ?? false, m.longestEarthAnyGapFull),
      slopeText: Number.isFinite(slope.slopeDeg) ? `${slope.slopeDeg.toFixed(1)}° over ${metres(slope.baselineM)}` : 'not available: no elevation data covers the site',
      slopeDetail: Number.isFinite(slope.slopeDeg)
        ? `Slope of the ground at the site: ${slope.slopeDeg.toFixed(1)}° from horizontal, measured over ${metres(slope.baselineM)} on ${slope.demName}${Number.isFinite(slope.aspectDeg) ? `; the ground falls towards ${COMPASS16[Math.round((((slope.aspectDeg % 360) + 360) % 360) / 22.5) % 16]} (${Math.round(((slope.aspectDeg % 360) + 360) % 360)}°)` : ''}.`
        : '',
      sunElRangeText: Number.isFinite(m.minSunElDeg) ? `${deg(m.minSunElDeg)} to ${deg(m.maxSunElDeg)}` : 'not available',
    },
    flags: flags(a, sun, req),
    provenanceShort: provenanceShort(a),
    provenance: [...provenanceLines(a), ...(Number.isFinite(slope.slopeDeg) ? [`Slope measured over ${metres(slope.baselineM)} on ${slope.demName}.`] : [])],
    warnings: a.warnings,
  };
}
