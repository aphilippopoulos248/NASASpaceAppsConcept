// The mission-window results table and its exports: every sunlit and dark spell, every spell
// with Earth's centre in view and hidden, and every passage of Earth in front of the Sun, with
// UTC start, end and duration. A spell that runs past an edge of the window is given in full
// (followed to its real start or end by edgeSpells()) and says so; the part inside the window is
// kept beside it. Pure: tested without a browser; the panel and exportResults both use it.
import { edgeSpells, type SpellList } from '../../analysis/edges';
import type { FullSpan, Interval, SiteAnalysis } from '../../analysis/types';
import { checkRequirements, reportDiff, scenarioFacts } from '../../core/analysisReport';
import { rounded } from '../../core/analysisStore';
import { EVENT_INFO } from '../../core/skyEvents';
import type { AppState } from '../../core/types';
import { formatUtc } from '../../core/time';
import type { ComparisonDiff } from '../../analysis/types';
import { sunBandSet } from './model';

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

// ---------- exports ----------

export interface ExportSide {
  slot: 'current' | 'A' | 'B';
  analysis: SiteAnalysis;
}

const CSV_COLUMNS = [
  'slot', 'scenario', 'site_id', 'site_name', 'lat_deg', 'lon_deg_east', 'mast_height_m', 'window_start_utc', 'window_end_utc',
  'group', 'state', 'start_utc', 'end_utc', 'duration_h', 'start_found', 'end_found',
  'in_window_start_utc', 'in_window_end_utc', 'in_window_h', 'runs_past_window_start', 'runs_past_window_end', 'note',
] as const;

/** One CSV field: quoted when it holds a comma, a quote or a line break (RFC 4180). */
const field = (v: string | number | boolean | null): string => {
  const s = v === null ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The table as CSV: one row per spell, the scenario repeated on each row so A and B can sit in one file. */
export function toCsv(sides: readonly ExportSide[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const { slot, analysis: a } of sides) {
    const sc = a.scenario;
    const end = sc.startMs + sc.durationH * HOUR_MS;
    for (const r of spellRows(a)) {
      const values: (string | number | boolean | null)[] = [
        slot, sc.label, sc.site.id, sc.site.name, sc.site.lat, sc.site.lon, sc.mastHeightM, isoSeconds(sc.startMs), isoSeconds(end),
        r.group, KIND_TEXT[r.kind], isoSeconds(r.startMs), isoSeconds(r.endMs), rounded(r.hours, 4), r.startFound, r.endFound,
        isoSeconds(r.windowStartMs), isoSeconds(r.windowEndMs), rounded(r.windowHours, 4), r.runsPastStart, r.runsPastEnd, r.note,
      ];
      lines.push(values.map(field).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

const CONVENTIONS =
  'Times UTC (ISO 8601). Latitude north-positive, longitude east-positive (Moon Mean Earth / Polar Axis frame), heights in metres above the 1737.4 km sphere, azimuth clockwise from north, elevation above the local horizontal with no refraction (airless). ' +
  "Sunlight: time-averaged visible part of the Sun's disc against the terrain skyline. Earth in view: Earth's centre above the terrain skyline, geometric line of sight only (not a radio link). " +
  'A spell that runs past an edge of the mission window is given in full, followed with the in-app model up to 60 days beyond the edge; start_found / end_found false means the search stopped there and the duration is a lower bound.';

/** Everything behind the table as JSON: scenario, metrics, events, every spell, requirements, data sources, assumptions and warnings. */
export function toJson(sides: readonly ExportSide[], s: Pick<AppState, 'sunElMinDeg' | 'sunElMaxDeg' | 'maxEarthGapH' | 'slopeLimitDeg'>, sunElNowDeg: (a: SiteAnalysis) => number, diff: ComparisonDiff | null, nowMs: number): string {
  const r3 = (v: number) => rounded(v, 3);
  const doc = {
    generator: 'Lunyx, lunar landing site navigator',
    exportedUtc: isoSeconds(nowMs),
    conventions: CONVENTIONS,
    eventDefinitions: Object.fromEntries(Object.entries(EVENT_INFO).map(([type, info]) => [type, `${info.label}: ${info.instant}.`])),
    scenarios: sides.map(({ slot, analysis: a }) => {
      const m = a.metrics;
      return {
        slot,
        scenario: scenarioFacts(a.scenario),
        metrics: {
          illuminationPct: r3(m.illuminationPct), sunAnyPct: r3(m.sunAnyPct),
          longestDarknessH: r3(m.longestDarknessH), darknessRunsIntoWindowEdge: m.darknessOpenEnded,
          earthCentreVisiblePct: r3(m.earthVisiblePct), longestEarthGapH: r3(m.longestEarthGapH), earthGapRunsIntoWindowEdge: m.earthGapOpenEnded,
          minSunElDeg: r3(m.minSunElDeg), maxSunElDeg: r3(m.maxSunElDeg),
        },
        slope: { slopeDeg: r3(a.slope.slopeDeg), downhillAzDeg: rounded(a.slope.aspectDeg, 1), baselineM: rounded(a.slope.baselineM, 1), elevationData: a.slope.demName },
        siteElevationM: rounded(a.horizon.siteElevationM, 1),
        events: a.events.map((e) => ({ type: e.type, label: EVENT_INFO[e.type].label, timeUtc: isoSeconds(e.timeMs), azDeg: rounded(e.azDeg, 2) })),
        spells: spellRows(a).map((r) => ({
          group: r.group, state: KIND_TEXT[r.kind],
          startUtc: isoSeconds(r.startMs), endUtc: isoSeconds(r.endMs), hours: rounded(r.hours, 4), startFound: r.startFound, endFound: r.endFound,
          inWindow: { startUtc: isoSeconds(r.windowStartMs), endUtc: isoSeconds(r.windowEndMs), hours: rounded(r.windowHours, 4) },
          runsPastWindowStart: r.runsPastStart, runsPastWindowEnd: r.runsPastEnd,
          ...(r.note && { note: r.note }),
        })),
        requirements: {
          ...checkRequirements(a, s, sunElNowDeg(a)),
          // 0 to 90 deg is the Filters default: no band was asked for, so "met" there says nothing.
          sunElevationBandSet: sunBandSet(s),
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
