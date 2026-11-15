// The mission-window results table and its exports: every sunlit and dark spell, every spell
// with Earth's centre in view and hidden, and every passage of Earth in front of the Sun, with
// UTC start, end and duration. A spell that runs past an edge of the window is given in full
// (followed to its real start or end by edgeSpells()) and says so; the part inside the window is
// kept beside it. Pure: tested without a browser; the panel and exportResults both use it.
import { TRANSITION_WORDS, transitionSummary, transitionText } from '../../analysis/api';
import { edgeSpells, type SpellList } from '../../analysis/edges';
import type { FullSpan, Interval, SiteAnalysis, SkyTransition, TransitionKind } from '../../analysis/types';
import { checkRequirements, reportDiff, scenarioFacts } from '../../core/analysisReport';
import { rounded } from '../../core/analysisStore';
import { EVENT_INFO } from '../../core/skyEvents';
import type { AppState } from '../../core/types';
import { formatUtc } from '../../core/time';
import type { ComparisonDiff } from '../../analysis/types';

const HOUR_MS = 3_600_000;

export type RowKind = SpellList | 'eclipse';
export type RowGroup = 'sun' | 'earth';

export const KIND_TEXT: Record<RowKind, string> = {
  sunlit: 'Sunlit',
  dark: 'Dark',
  eclipse: 'Earth in front of the Sun',
  earth: "Earth's centre in view",
  earthGap: "Earth's centre hidden",
};

export interface SpellRow {
  group: RowGroup;
  kind: RowKind;
  /** The spell in full: equal to the window part unless it runs past an edge. */
  startMs: number;
  endMs: number;
  hours: number;
  /** False when the search beyond the window stopped before the real start (end): then `hours` is a lower bound. */
  startFound: boolean;
  endFound: boolean;
  /** The part inside the mission window. */
  windowStartMs: number;
  windowEndMs: number;
  windowHours: number;
  runsPastStart: boolean;
  runsPastEnd: boolean;
  /** What a reader needs to know about this row, in words; empty for a spell wholly inside the window. */
  note: string;
}

/** "2025-03-16T19:30:11Z": ISO 8601 UTC to the second (events are refined to 10 s). */
export const isoSeconds = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;

const h1 = (h: number) => `${h.toFixed(1)} h${Math.abs(h) >= 48 ? ` (${(h / 24).toFixed(1)} d)` : ''}`;

function noteOf(kind: RowKind, iv: Interval, full: FullSpan | null, windowHours: number): string {
  if (!iv.openStart && !iv.openEnd) return '';
  if (!full) return `Runs past the window ${iv.openStart && iv.openEnd ? 'start and end' : iv.openStart ? 'start' : 'end'}; the part inside the window is shown.`;
  const inWindow = `${h1(windowHours)} of it inside the window`;
  const limit = `${full.limitDays} days`;
  const parts: string[] = [];
  if (iv.openStart) parts.push(full.startFound ? `began before the window, at ${formatUtc(full.startMs)}` : `began more than ${limit} before the window (no start found)`);
  if (iv.openEnd) parts.push(full.endFound ? `goes on after the window, to ${formatUtc(full.endMs)}` : `goes on more than ${limit} after the window (no end found)`);
  const length = full.startFound && full.endFound ? `${h1(full.hours)} in full` : `at least ${h1(full.hours)}`;
  const what = kind === 'eclipse' ? 'The passage' : 'The spell';
  return `${what} ${parts.join(' and ')}: ${length}, ${inWindow}.`;
}

/** The rows of one analysis: the Sun group (sunlit and dark in time order, then Earth in front of the Sun), then Earth. */
export function spellRows(a: SiteAnalysis): SpellRow[] {
  const m = a.metrics;
  const full = new Map<string, FullSpan>();
  for (const e of edgeSpells(a)) full.set(`${e.list}:${e.index}`, e.full);
  const rows: SpellRow[] = [];
  const add = (group: RowGroup, kind: RowKind, list: readonly Interval[]) =>
    list.map((iv, index) => {
      const f = kind === 'eclipse' ? null : (full.get(`${kind}:${index}`) ?? null);
      const windowHours = (iv.endMs - iv.startMs) / HOUR_MS;
      const span = f ?? { startMs: iv.startMs, endMs: iv.endMs, hours: windowHours, startFound: true, endFound: true };
      return {
        group, kind,
        startMs: span.startMs, endMs: span.endMs, hours: span.hours, startFound: span.startFound, endFound: span.endFound,
        windowStartMs: iv.startMs, windowEndMs: iv.endMs, windowHours,
        runsPastStart: Boolean(iv.openStart), runsPastEnd: Boolean(iv.openEnd),
        note: noteOf(kind, iv, f, windowHours),
      } satisfies SpellRow;
    });
  const byTime = (x: SpellRow, y: SpellRow) => x.windowStartMs - y.windowStartMs;
  rows.push(...[...add('sun', 'sunlit', m.sunIntervals), ...add('sun', 'dark', m.darkIntervals)].sort(byTime));
  rows.push(...add('sun', 'eclipse', m.eclipseIntervals ?? []));
  rows.push(...[...add('earth', 'earth', m.earthIntervals), ...add('earth', 'earthGap', m.earthGapIntervals)].sort(byTime));
  return rows;
}

// ---------- passages: both ends of every rise and set (decision D-8) ----------

/** One end of a passage: the instant it is, and when (null when that end was not found). */
export interface PassageEnd {
  /** "Sun starts setting", "Earth fully risen", ... or that the end was not found. */
  instant: string;
  timeMs: number | null;
  inWindow: boolean;
  azDeg: number;
}

/** A passage of the Sun's or Earth's disc through the terrain skyline, with both ends named. */
export interface PassageRow {
  body: 'sun' | 'earth';
  kind: TransitionKind;
  /** What the disc does: "Sun setting", "Earth rising", "Sun partly hidden, never fully set", ... */
  state: string;
  start: PassageEnd;
  end: PassageEnd;
  /** end - start; a lower bound when an end was not found. */
  hours: number;
  /** The part inside the mission window. */
  windowStartMs: number;
  windowEndMs: number;
  windowHours: number;
  runsPastStart: boolean;
  runsPastEnd: boolean;
  /** Earth's centre crossing the skyline during the passage ("Earth's centre sets"): Earth only. */
  centre: { instant: string; timeMs: number; inWindow: boolean }[];
  /** The D-8 short form: "starts setting 2025-03-16 18:23, fully set 19:30 UTC". */
  summary: string;
  /** One sentence naming each instant. */
  text: string;
  /** How much of the disc a graze hides or a peek shows; empty otherwise. */
  note: string;
}

const BODY_NAME = { sun: 'Sun', earth: 'Earth' } as const;

function passageState(tr: SkyTransition): string {
  const body = BODY_NAME[tr.body];
  switch (tr.kind) {
    case 'set': return `${body} setting`;
    case 'rise': return `${body} rising`;
    case 'graze': return `${body} partly hidden, never fully set`;
    case 'peek': return `${body} partly visible, never fully risen`;
    default: return `${body} ${tr.start.edge === 'first-cut' || tr.end.edge === 'last-limb' ? 'setting' : 'rising'} (an end not found)`;
  }
}

function endOf(tr: SkyTransition, which: 'start' | 'end'): PassageEnd {
  const x = tr[which];
  const own = `${BODY_NAME[tr.body]}'s`;
  let instant: string;
  if (x.edge === 'unresolved') instant = which === 'start' ? 'start not found' : 'end not found';
  else if (tr.kind === 'graze') instant = which === 'start' ? `${BODY_NAME[tr.body]} starts to be partly hidden` : `${own} whole disc clear again`;
  else if (tr.kind === 'peek') instant = which === 'start' ? `${BODY_NAME[tr.body]} starts to be partly visible` : `${own} last part gone again`;
  else instant = TRANSITION_WORDS[tr.body][x.edge].label;
  return { instant, timeMs: x.edge === 'unresolved' ? null : x.timeMs, inWindow: x.inWindow, azDeg: x.azDeg };
}

/** How much of the disc a graze hides or a peek shows (the summary already says what an end not found means). */
function passageNote(tr: SkyTransition): string {
  const pct = (f: number) => `${Math.round(f * 100)} %`;
  if (tr.kind === 'graze' && Number.isFinite(tr.minVisibleFraction)) return `At most ${pct(1 - tr.minVisibleFraction)} of the disc is hidden at the analysis' samples.`;
  if (tr.kind === 'peek' && Number.isFinite(tr.maxVisibleFraction)) return `At most ${pct(tr.maxVisibleFraction)} of the disc shows at the analysis' samples.`;
  return '';
}

/** Every passage of the Sun and Earth through the skyline that overlaps the window, in time order (empty without a skyline). */
export function passageRows(a: SiteAnalysis): PassageRow[] {
  const w0 = a.scenario.startMs, w1 = w0 + a.scenario.durationH * HOUR_MS;
  return (a.transitions ?? []).map((tr) => {
    const windowStartMs = Math.max(tr.start.timeMs, w0), windowEndMs = Math.min(tr.end.timeMs, w1);
    return {
      body: tr.body,
      kind: tr.kind,
      state: passageState(tr),
      start: endOf(tr, 'start'),
      end: endOf(tr, 'end'),
      hours: tr.hours,
      windowStartMs, windowEndMs, windowHours: Math.max(0, (windowEndMs - windowStartMs) / HOUR_MS),
      runsPastStart: !tr.start.inWindow || tr.start.edge === 'unresolved',
      runsPastEnd: !tr.end.inWindow || tr.end.edge === 'unresolved',
      centre: tr.body === 'earth' ? tr.centre.map((c) => ({ instant: c.up ? "Earth's centre rises" : "Earth's centre sets", timeMs: c.timeMs, inWindow: c.inWindow })) : [],
      summary: transitionSummary(tr),
      text: transitionText(tr),
      note: passageNote(tr),
    } satisfies PassageRow;
  });
}

// ---------- exports ----------

export interface ExportSide {
  slot: 'current' | 'A' | 'B';
  analysis: SiteAnalysis;
}

const CSV_COLUMNS = [
  'slot', 'scenario', 'site_id', 'site_name', 'lat_deg', 'lon_deg_east', 'mast_height_m', 'window_start_utc', 'window_end_utc',
  'group', 'state', 'start_utc', 'end_utc', 'duration_h', 'start_found', 'end_found',
  'in_window_start_utc', 'in_window_end_utc', 'in_window_h', 'runs_past_window_start', 'runs_past_window_end', 'note',
  // Passages only (rises and sets with both ends, D-8): which instant each end is, and Earth's centre crossings.
  'start_instant', 'end_instant', 'earth_centre_crossings',
] as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break (RFC 4180). */
const field = (v: string | number | boolean | null): string => {
  const s = v === null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The table as CSV: one row per spell, then one per passage, the scenario repeated on each row so A and B can sit in one file. */
export function toCsv(sides: readonly ExportSide[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const { slot, analysis: a } of sides) {
    const sc = a.scenario;
    const end = sc.startMs + sc.durationH * HOUR_MS;
    const scenario = [slot, sc.label, sc.site.id, sc.site.name, sc.site.lat, sc.site.lon, sc.mastHeightM, isoSeconds(sc.startMs), isoSeconds(end)];
    for (const r of spellRows(a)) {
      const values: (string | number | boolean | null)[] = [
        ...scenario,
        r.group, KIND_TEXT[r.kind], isoSeconds(r.startMs), isoSeconds(r.endMs), rounded(r.hours, 4), r.startFound, r.endFound,
        isoSeconds(r.windowStartMs), isoSeconds(r.windowEndMs), rounded(r.windowHours, 4), r.runsPastStart, r.runsPastEnd, r.note,
        '', '', '',
      ];
      lines.push(values.map(field).join(','));
    }
    for (const p of passageRows(a)) {
      // An end that was not found gets no time (D-8): its column stays empty and *_found says why.
      const values: (string | number | boolean | null)[] = [
        ...scenario,
        p.body, p.state, p.start.timeMs === null ? '' : isoSeconds(p.start.timeMs), p.end.timeMs === null ? '' : isoSeconds(p.end.timeMs), rounded(p.hours, 4), p.start.timeMs !== null, p.end.timeMs !== null,
        isoSeconds(p.windowStartMs), isoSeconds(p.windowEndMs), rounded(p.windowHours, 4), p.runsPastStart, p.runsPastEnd, [p.summary, p.note].filter(Boolean).join('. '),
        p.start.instant, p.end.instant, p.centre.map((c) => `${c.instant} ${isoSeconds(c.timeMs)}`).join('; '),
      ];
      lines.push(values.map(field).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

const CONVENTIONS =
  'Times UTC (ISO 8601). Latitude north-positive, longitude east-positive (Moon Mean Earth / Polar Axis frame), heights in metres above the 1737.4 km sphere, azimuth clockwise from north, elevation above the local horizontal with no refraction (airless). ' +
  "Sunlight: time-averaged visible part of the Sun's disc against the terrain skyline. Earth in view: Earth's centre above the terrain skyline, geometric line of sight only (not a radio link); the figures for any part of Earth's disc (PGDA product 69's definition) are named so. " +
  'A spell that runs past an edge of the mission window is given in full, followed with the in-app model up to 60 days beyond the edge; start_found / end_found false means the search stopped there and the duration is a lower bound. ' +
  "A passage is a rise or a set with both ends (the disc neither wholly clear of the terrain skyline nor wholly behind it): start_instant and end_instant say which instant each end is (for example \"Sun starts setting\" and \"Sun fully set\"); an end not found within the search has no time.";

/** Everything behind the table as JSON: scenario, metrics, events, every spell and passage, requirements, data sources, assumptions and warnings. */
export function toJson(sides: readonly ExportSide[], s: Pick<AppState, 'sunElMinDeg' | 'sunElMaxDeg' | 'maxEarthGapH' | 'slopeLimitDeg'>, sunElNowDeg: (a: SiteAnalysis) => number, diff: ComparisonDiff | null, nowMs: number): string {
  const r3 = (v: number) => rounded(v, 3);
  const doc = {
    generator: 'Lunyx, lunar landing site navigator',
    exportedUtc: isoSeconds(nowMs),
    conventions: CONVENTIONS,
    eventDefinitions: Object.fromEntries(Object.entries(EVENT_INFO).map(([type, info]) => [type, `${info.label}: ${info.instant}.`])),
    // The two ends of each passage (a set runs from "starts setting" to "fully set", a rise from "starts rising" to "fully risen").
    passageInstantDefinitions: Object.fromEntries(Object.values(TRANSITION_WORDS).flatMap((edges) => Object.values(edges).map((w) => [w.label, `${w.instant}.`]))),
    scenarios: sides.map(({ slot, analysis: a }) => {
      const m = a.metrics;
      return {
        slot,
        scenario: scenarioFacts(a.scenario),
        metrics: {
          illuminationPct: r3(m.illuminationPct), sunAnyPct: r3(m.sunAnyPct),
          longestDarknessH: r3(m.longestDarknessH), darknessRunsIntoWindowEdge: m.darknessOpenEnded,
          earthCentreVisiblePct: r3(m.earthVisiblePct), longestEarthGapH: r3(m.longestEarthGapH), earthGapRunsIntoWindowEdge: m.earthGapOpenEnded,
          // Any part of Earth's disc above the skyline (PGDA product 69's definition), beside the centre figures; null where the analysis has none.
          earthAnyPartVisiblePct: r3(m.earthAnyPct ?? NaN), longestEarthWhollyHiddenH: r3(m.longestEarthAnyGapH ?? NaN), earthWhollyHiddenRunsIntoWindowEdge: m.earthAnyGapOpenEnded ?? null,
          minSunElDeg: r3(m.minSunElDeg), maxSunElDeg: r3(m.maxSunElDeg),
        },
        slope: { slopeDeg: r3(a.slope.slopeDeg), downhillAzDeg: rounded(a.slope.aspectDeg, 1), baselineM: rounded(a.slope.baselineM, 1), elevationData: a.slope.demName },
        siteElevationM: rounded(a.horizon.siteElevationM, 1),
        events: a.events.map((e) => ({ type: e.type, label: EVENT_INFO[e.type].label, timeUtc: isoSeconds(e.timeMs), azDeg: rounded(e.azDeg, 2), ...(e.span && { passage: transitionSummary(e.span) }) })),
        passages: passageRows(a).map((p) => ({
          body: p.body, kind: p.kind, state: p.state,
          start: { instant: p.start.instant, timeUtc: p.start.timeMs === null ? null : isoSeconds(p.start.timeMs), inWindow: p.start.inWindow, azDeg: rounded(p.start.azDeg, 2) },
          end: { instant: p.end.instant, timeUtc: p.end.timeMs === null ? null : isoSeconds(p.end.timeMs), inWindow: p.end.inWindow, azDeg: rounded(p.end.azDeg, 2) },
          hours: rounded(p.hours, 4), hoursIsLowerBound: p.start.timeMs === null || p.end.timeMs === null,
          ...(p.centre.length && { earthCentre: p.centre.map((c) => ({ instant: c.instant, timeUtc: isoSeconds(c.timeMs), inWindow: c.inWindow })) }),
          summary: p.summary, text: p.text, ...(p.note && { note: p.note }),
        })),
        spells: spellRows(a).map((r) => ({
          group: r.group, state: KIND_TEXT[r.kind],
          startUtc: isoSeconds(r.startMs), endUtc: isoSeconds(r.endMs), hours: rounded(r.hours, 4), startFound: r.startFound, endFound: r.endFound,
          inWindow: { startUtc: isoSeconds(r.windowStartMs), endUtc: isoSeconds(r.windowEndMs), hours: rounded(r.windowHours, 4) },
          runsPastWindowStart: r.runsPastStart, runsPastWindowEnd: r.runsPastEnd,
          ...(r.note && { note: r.note }),
        })),
        requirements: {
          // A band left at the Filters default (0 to 90 deg) is no requirement: sunElevationBand.required is false.
          ...checkRequirements(a, s, sunElNowDeg(a)),
          slopeLimitDeg: s.slopeLimitDeg,
          slopeWithinLimit: Number.isFinite(a.slope.slopeDeg) ? a.slope.slopeDeg <= s.slopeLimitDeg : null,
        },
        provenance: {
          ephemeris: a.provenance.ephemeris,
          ephemerisNote: a.provenance.ephemerisNote,
          elevationData: a.provenance.dem.map((d) => ({ name: d.name, resolutionM: rounded(d.resolutionM, 1), fromKm: rounded(d.fromM / 1000, 2), toKm: rounded(d.toM / 1000, 2) })),
          assumptions: a.provenance.assumptions,
          ...(a.provenance.terrainNotes && { terrainNotes: a.provenance.terrainNotes }),
        },
        warnings: a.warnings,
      };
    }),
    ...(diff && { comparison: reportDiff(diff) }),
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}

/** "lunyx_im-2_2025-03-06T1728Z_168h_2m.csv": site, arrival, length and mast; both sides for a comparison. */
export function exportFilename(sides: readonly ExportSide[], format: 'csv' | 'json'): string {
  const part = (a: SiteAnalysis) => {
    const sc = a.scenario;
    const id = sc.site.id.replace(/^pin:/, 'pin_').replace(/[^A-Za-z0-9._-]+/g, '_');
    const when = new Date(sc.startMs).toISOString().slice(0, 16).replace(/:/g, '');
    return `${id}_${when}Z_${Number(sc.durationH.toFixed(2))}h_${sc.mastHeightM}m`;
  };
  const name = sides.length === 2 ? `lunyx_compare_A_${part(sides[0].analysis)}_B_${part(sides[1].analysis)}` : `lunyx_${part(sides[0].analysis)}`;
  return `${name.slice(0, 180)}.${format}`;
}
