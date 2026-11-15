// Both ends of every rise and set (task T-31 item 2; decision D-8 of the Lunyx hub).
//
// A rise or a set is not one moment. The Sun's disc (0.53 deg) takes about an hour to cross the
// skyline at mid latitudes and many hours near the poles; Earth's (1.9 deg), slow in the lunar sky,
// a day or more. The window's events name one instant each: sunset = last limb, sunrise = first
// limb, Earthset / Earthrise = Earth's centre. Here every passage of a disc through the terrain
// skyline is described from end to end:
//
//   whole disc clear --first cut--> partly hidden --last limb--> wholly hidden    'set'
//   wholly hidden --first limb--> partly visible --whole disc clear--> clear     'rise'
//   clear --first cut--> partly hidden --whole disc clear--> clear               'graze'
//   hidden --first limb--> partly visible --last limb--> hidden                  'peek'
//
// Instants that are already results are reused unchanged: the Sun's first and last limb are its
// sunrise and sunset events, Earth's first and last limb the ends of the any-part spans of
// evaluateWindow(), Earth's centre crossings its earthrise / earthset events. New here: the first
// cut and the whole-disc-clear instants of both bodies (the lowest point of the disc, over the
// strips discVisibility() integrates, crossing the skyline: sampled at the analysis' step and
// refined to 10 s, as the events are) and the Sun's centre crossings. A passage cut by a window
// edge is followed outward with the in-app model, as the darkness in full is (extend.ts).
//
// Terrain only: Earth in front of the Sun is an eclipse (metrics.eclipseIntervals), not a set.
import type { Scenario } from '../core/types';
import { EXTEND_LIMIT_DAYS, followOff } from './extend';
import { skylineAt } from './horizon';
import { EVENT_PRECISION_MS, intervalsOf, refine } from './intervals';
import { modelEphemeris, tabulatedEphemeris, type Ephemeris } from './sky';
import type { HorizonProfile, Interval, SiteAnalysis, SkyEvent, SkyTransition, TransitionEdge, TransitionInstant, TransitionKind, WindowMetrics } from './types';
import { discVisibility, sampleTimes } from './window';

type Body = 'sun' | 'earth';
const BODIES: readonly Body[] = ['sun', 'earth'];
const DAY = 86_400_000;
const H = 3_600_000;
/** Steps of the search beyond a window edge (as for the darkness in full): the Sun can slip past a ridge within the hour, Earth barely moves. */
const FOLLOW_STEP_MS: Record<Body, number> = { sun: 20 * 60_000, earth: 60 * 60_000 };

/** The disc of one body against the skyline at an instant: clearance (deg) of its highest point, its lowest point and its centre; visible fraction; azimuth. */
function discAt(p: HorizonProfile, eph: Ephemeris, body: Body, t: number, o: Float64Array) {
  eph.at(t, o);
  const az = body === 'sun' ? o[0] : o[2];
  const el = body === 'sun' ? o[1] : o[3];
  const d = discVisibility(p, az, el, body === 'sun' ? o[4] : o[5]);
  return { top: d.topClearance, bottom: d.bottomClearance, centre: el - skylineAt(p, az), fraction: d.fraction, az };
}

/** Sign changes of a continuous indicator between two instants, found at `stepMs` and refined to 10 s. */
function crossingsIn(g: (t: number) => number, a: number, b: number, stepMs: number): { t: number; up: boolean }[] {
  const out: { t: number; up: boolean }[] = [];
  if (!(b > a)) return out;
  let t0 = a;
  let v0 = g(a) > 0;
  const steps = Math.ceil((b - a) / stepMs - 1e-9);
  for (let k = 1; k <= steps; k++) {
    const t1 = Math.min(b, a + k * stepMs);
    const v1 = g(t1) > 0;
    if (v1 !== v0) out.push({ t: refine(g, t0, t1, v1), up: v1 });
    t0 = t1;
    v0 = v1;
  }
  return out;
}

/** One end of a passage while it is being assembled; `edge` null = cut by the window edge (to be followed). */
interface RawEnd {
  t: number;
  edge: TransitionEdge | null;
  event?: SkyEvent;
}

const kindOf = (start: TransitionEdge, end: TransitionEdge): TransitionKind =>
  start === 'unresolved' || end === 'unresolved' ? 'unresolved' : start === 'first-cut' ? (end === 'last-limb' ? 'set' : 'graze') : end === 'whole-clear' ? 'rise' : 'peek';

export interface TransitionOptions {
  /**
   * An ephemeris valid before and after the window, to follow a passage cut by a window edge to its
   * real end (the in-app model: see outsideEphemeris). Null or absent: not followed; such an end is
   * then 'unresolved' at the window edge.
   */
  outside?: Ephemeris | null;
  /** How far beyond each window edge an end is searched for, days (default 60, as for the darkness in full). */
  limitDays?: number;
}

/**
 * Every passage of the Sun's and Earth's discs through the skyline that overlaps the scenario's
 * window, sorted by start. `w` is what evaluateWindow() returned for the same scenario, skyline and
 * ephemeris: its events and Earth's any-part spans are reused, and `span` is set on each of its events.
 */
export function buildTransitions(s: Scenario, p: HorizonProfile, eph: Ephemeris, w: { metrics: WindowMetrics; events: SkyEvent[] }, options: TransitionOptions = {}): SkyTransition[] {
  const { startMs, stepMs, n, endMs } = sampleTimes(s);
  if (!Number.isFinite(p.siteElevationM) || !(endMs > startMs)) return [];
  const limitDays = options.limitDays ?? EXTEND_LIMIT_DAYS;
  const outside = options.outside ?? null;
  const lastSampleMs = startMs + (n - 1) * stepMs;
  const count = lastSampleMs < endMs ? n + 1 : n;
  const timeAt = (i: number) => (i < n ? startMs + i * stepMs : endMs);
  const o = new Float64Array(6);
  const all: SkyTransition[] = [];

  for (const body of BODIES) {
    // The disc at every sample (as evaluateWindow samples it, the partial last step included).
    const bottom = new Float64Array(count), centre = new Float64Array(count), fraction = new Float64Array(count);
    let top0 = NaN;
    for (let i = 0; i < count; i++) {
      const d = discAt(p, eph, body, timeAt(i), o);
      bottom[i] = d.bottom;
      centre[i] = d.centre;
      fraction[i] = d.fraction;
      if (i === 0) top0 = d.top;
    }
    const inside = (key: 'top' | 'bottom' | 'centre') => (t: number) => discAt(p, eph, body, t, o)[key];
    const azIn = (t: number) => discAt(p, eph, body, t, o).az;

    // Crossings of "any part above the skyline" (existing results) and "whole disc above it" (new).
    const crosses: { t: number; kind: 'any' | 'whole'; up: boolean; event?: SkyEvent }[] = [];
    let anyOn: boolean;
    if (body === 'sun') {
      const ev = w.events.filter((e) => e.type === 'sunrise' || e.type === 'sunset');
      // The same state evaluateWindow starts from (its per-sample values are stored as 32-bit floats).
      anyOn = ev.length ? ev[0].type === 'sunset' : Math.fround(top0) > 0;
      for (const e of ev) crosses.push({ t: e.timeMs, kind: 'any', up: e.type === 'sunrise', event: e });
    } else {
      const on: Interval[] = w.metrics.earthAnyIntervals ?? intervalsOf((i) => fraction[i] > 0, inside('top'), timeAt, count, startMs, endMs).on;
      anyOn = on.length > 0 && !!on[0].openStart;
      for (const iv of on) {
        if (!iv.openStart) crosses.push({ t: iv.startMs, kind: 'any', up: true });
        if (!iv.openEnd) crosses.push({ t: iv.endMs, kind: 'any', up: false });
      }
    }
    const whole = intervalsOf((i) => bottom[i] > 0, inside('bottom'), timeAt, count, startMs, endMs);
    for (const c of whole.crossings) crosses.push({ t: c.t, kind: 'whole', up: c.up });
    // Same instant: rising, any part before the whole disc; setting, the whole disc before the last part.
    const order = (c: { kind: 'any' | 'whole'; up: boolean }) => (c.up === (c.kind === 'any') ? 0 : 1);
    crosses.sort((a, b) => a.t - b.t || order(a) - order(b));

    // Sweep: level 2 = whole disc clear, 1 = partly hidden, 0 = wholly hidden. A passage is a stay at level 1.
    let wholeOn = bottom[0] > 0;
    if (wholeOn) anyOn = true;
    const level = () => (wholeOn ? 2 : anyOn ? 1 : 0);
    let lv = level();
    const raw: { start: RawEnd; end: RawEnd }[] = [];
    let open: RawEnd | null = lv === 1 ? { t: startMs, edge: null } : null;
    for (const c of crosses) {
      // A disc wholly clear is partly clear; one with nothing above the skyline has no whole disc above it.
      if (c.kind === 'any') {
        anyOn = c.up;
        if (!anyOn) wholeOn = false;
      } else {
        wholeOn = c.up;
        if (wholeOn) anyOn = true;
      }
      const next = level();
      if (next === lv) continue;
      if (lv === 1) {
        raw.push({ start: open!, end: { t: c.t, edge: next === 2 ? 'whole-clear' : 'last-limb', event: c.event } });
        open = null;
      } else if (next !== 1) {
        // From wholly clear to wholly hidden (or back) between two refinements: a passage of no length.
        raw.push({ start: { t: c.t, edge: lv === 2 ? 'first-cut' : 'first-limb', event: lv === 0 ? c.event : undefined }, end: { t: c.t, edge: lv === 2 ? 'last-limb' : 'whole-clear', event: lv === 2 ? c.event : undefined } });
      }
      if (next === 1) open = { t: c.t, edge: lv === 2 ? 'first-cut' : 'first-limb', event: c.event };
      lv = next;
    }
    if (open) raw.push({ start: open, end: { t: endMs, edge: null } });

    // Centre crossings inside the window: Earth's are its events; the Sun's are found here.
    const centreIn: { t: number; up: boolean; event?: SkyEvent }[] =
      body === 'earth'
        ? w.events.filter((e) => e.type === 'earthrise' || e.type === 'earthset').map((e) => ({ t: e.timeMs, up: e.type === 'earthrise', event: e }))
        : intervalsOf((i) => centre[i] > 0, inside('centre'), timeAt, count, startMs, endMs).crossings;

    // Passages cut by a window edge: followed outward with the model, to the first instant the disc is wholly clear or wholly hidden.
    const o2 = new Float64Array(6);
    const beyond = (t: number) => discAt(p, outside!, body, t, o2);
    const follow = (from: number, dir: 1 | -1): { end: RawEnd; centre: { t: number; up: boolean }[] } => {
      if (!outside) return { end: { t: from, edge: 'unresolved' }, centre: [] };
      const r = followOff((t) => { const d = beyond(t); return Math.max(-d.top, d.bottom); }, from, dir, limitDays * DAY, FOLLOW_STEP_MS[body]);
      const lo = dir > 0 ? from : r.timeMs, hi = dir > 0 ? r.timeMs : from;
      const centre = crossingsIn((t) => beyond(t).centre, lo, hi, FOLLOW_STEP_MS[body]);
      if (!r.found) return { end: { t: r.timeMs, edge: 'unresolved' }, centre };
      // Just beyond the found instant the disc is wholly clear or wholly hidden: which one names the edge.
      const past = beyond(r.timeMs + dir * EVENT_PRECISION_MS);
      const clear = past.bottom > 0;
      const edge: TransitionEdge = dir < 0 ? (clear ? 'first-cut' : 'first-limb') : clear ? 'whole-clear' : 'last-limb';
      return { end: { t: r.timeMs, edge }, centre };
    };

    const made: SkyTransition[] = [];
    for (const r of raw) {
      let { start, end } = r;
      const extraCentre: { t: number; up: boolean }[] = [];
      if (start.edge === null) {
        const f = follow(startMs, -1);
        start = f.end;
        extraCentre.push(...f.centre);
      }
      if (end.edge === null) {
        const f = follow(endMs, 1);
        end = f.end;
        extraCentre.push(...f.centre);
      }
      const instant = (x: RawEnd): TransitionInstant => {
        const inWindow = x.t >= startMs && x.t <= endMs;
        const az = x.event ? x.event.azDeg : inWindow ? azIn(x.t) : outside ? beyond(x.t).az : azIn(x.t);
        return { timeMs: x.t, azDeg: az, inWindow };
      };
      // Samples strictly inside the passage: those of the regular grid in its span, and the window's last instant.
      let minF = Infinity, maxF = -Infinity;
      const i0 = Math.max(0, Math.floor((start.t - startMs) / stepMs)), i1 = Math.min(n - 1, Math.ceil((end.t - startMs) / stepMs));
      const take = (i: number) => {
        const t = timeAt(i);
        if (t <= start.t || t >= end.t) return;
        if (fraction[i] < minF) minF = fraction[i];
        if (fraction[i] > maxF) maxF = fraction[i];
      };
      for (let i = i0; i <= i1; i++) take(i);
      if (count > n) take(n);
      const tr: SkyTransition = {
        body,
        kind: kindOf(start.edge!, end.edge!),
        start: { ...instant(start), edge: start.edge as 'first-cut' | 'first-limb' | 'unresolved' },
        end: { ...instant(end), edge: end.edge as 'last-limb' | 'whole-clear' | 'unresolved' },
        hours: (end.t - start.t) / H,
        centre: extraCentre.map((c) => ({ timeMs: c.t, up: c.up, azDeg: beyond(c.t).az, inWindow: false })),
        minVisibleFraction: minF === Infinity ? NaN : minF,
        maxVisibleFraction: maxF === -Infinity ? NaN : maxF,
        limitDays,
      };
      if (start.event) start.event.span = tr;
      if (end.event) end.event.span = tr;
      made.push(tr);
    }

    // Each centre crossing in the window goes to the passage it lies in (or the nearest: only numerical noise can put it outside).
    for (const c of centreIn) {
      let best: SkyTransition | null = null, dist = Infinity;
      for (const tr of made) {
        const d = c.t < tr.start.timeMs ? tr.start.timeMs - c.t : c.t > tr.end.timeMs ? c.t - tr.end.timeMs : 0;
        if (d < dist) { dist = d; best = tr; }
      }
      // The Sun's centre crossings are only extra information: kept when they belong to a passage.
      if (!best || (!c.event && dist > EVENT_PRECISION_MS)) continue;
      best.centre.push({ timeMs: c.t, up: c.up, azDeg: c.event ? c.event.azDeg : azIn(c.t), inWindow: true });
      if (c.event) c.event.span = best;
    }
    for (const tr of made) tr.centre.sort((a, b) => a.timeMs - b.timeMs);

    // A sunrise or sunset the sweep could not place (only possible through numerical noise) goes to the nearest passage.
    for (const e of w.events) {
      if (e.span || (body === 'sun') !== (e.type === 'sunrise' || e.type === 'sunset')) continue;
      let best: SkyTransition | null = null, dist = Infinity;
      for (const tr of made) {
        const d = Math.min(Math.abs(e.timeMs - tr.start.timeMs), Math.abs(e.timeMs - tr.end.timeMs));
        if (d < dist) { dist = d; best = tr; }
      }
      if (best) e.span = best;
    }
    all.push(...made);
  }
  return all.sort((a, b) => a.start.timeMs - b.start.timeMs || (a.body === b.body ? 0 : a.body === 'sun' ? -1 : 1));
}

/**
 * The ephemeris used to follow a passage beyond the window: the window's own inside it, the in-app
 * model (tabulated, as for the darkness in full) before and after it.
 */
export function outsideEphemeris(s: Scenario, p: HorizonProfile, inside: Ephemeris, limitDays = EXTEND_LIMIT_DAYS): Ephemeris {
  const { startMs, endMs } = sampleTimes(s);
  const limitMs = limitDays * DAY + DAY;
  const obsH = p.siteElevationM + p.mastHeightM;
  const direct = modelEphemeris(p.site, obsH);
  let before: Ephemeris | null = null, after: Ephemeris | null = null;
  return {
    source: 'model',
    note: direct.note,
    at(t, out) {
      if (t < startMs) (before ??= tabulatedEphemeris(p.site, obsH, startMs - limitMs, startMs)).at(t, out);
      else if (t > endMs) (after ??= tabulatedEphemeris(p.site, obsH, endMs, endMs + limitMs)).at(t, out);
      else inside.at(t, out);
    },
    instant: direct.instant,
  };
}

/** Adds `transitions` to an analysis made with `eph` (and `span` to its events). No skyline: no passages. */
export function withTransitions(a: SiteAnalysis, eph: Ephemeris, options: TransitionOptions = {}): SiteAnalysis {
  if (!Number.isFinite(a.horizon.siteElevationM)) {
    a.transitions = [];
    return a;
  }
  const outside = options.outside !== undefined ? options.outside : outsideEphemeris(a.scenario, a.horizon, eph, options.limitDays);
  a.transitions = buildTransitions(a.scenario, a.horizon, eph, a, { ...options, outside });
  return a;
}

/**
 * The passage of each body in progress at `timeMs` (start <= timeMs < end), or else the next one to
 * start after it; null when there is none. Unlike nextEvents() this includes passages whose end lies
 * beyond the analysed window (followed with the model; see each instant's `inWindow`).
 */
export function nextTransitions(a: SiteAnalysis, timeMs: number): Record<Body, SkyTransition | null> {
  const out: Record<Body, SkyTransition | null> = { sun: null, earth: null };
  for (const tr of a.transitions ?? []) if (!out[tr.body] && tr.end.timeMs > timeMs) out[tr.body] = tr;
  return out;
}

// ---------- words (D-8: no rise or set time without the instant it is) ----------

/** Label (buttons, marks, countdowns) and clause (sentences) of each end of a set or a rise. A graze or a peek is worded by transitionSummary(). */
export const TRANSITION_WORDS: Record<Body, Record<Exclude<TransitionEdge, 'unresolved'>, { label: string; instant: string }>> = {
  sun: {
    'first-cut': { label: 'Sun starts setting', instant: "the terrain skyline starts to cut into the Sun's disc" },
    'last-limb': { label: 'Sun fully set', instant: "the last part of the Sun's disc goes behind the terrain skyline" },
    'first-limb': { label: 'Sun starts rising', instant: "the first part of the Sun's disc appears above the terrain skyline" },
    'whole-clear': { label: 'Sun fully risen', instant: "the whole of the Sun's disc is clear of the terrain skyline" },
  },
  earth: {
    'first-cut': { label: 'Earth starts setting', instant: "the terrain skyline starts to cut into Earth's disc" },
    'last-limb': { label: 'Earth fully set', instant: "the last part of Earth's disc goes behind the terrain skyline" },
    'first-limb': { label: 'Earth starts rising', instant: "the first part of Earth's disc appears above the terrain skyline" },
    'whole-clear': { label: 'Earth fully risen', instant: "the whole of Earth's disc is clear of the terrain skyline" },
  },
};

const EVENT_NAME: Record<SkyEvent['type'], string> = { sunrise: 'Sunrise', sunset: 'Sunset', earthrise: 'Earthrise', earthset: 'Earthset' };
const EVENT_LABEL: Record<SkyEvent['type'], string> = { sunrise: 'Sun starts rising', sunset: 'Sun fully set', earthrise: "Earth's centre rises", earthset: "Earth's centre sets" };
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const utcMinute = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

/** Writes times in order: the date only when it differs from the previous time written. */
function clock() {
  let day = '';
  return (t: number) => {
    const d = utcDay(t);
    const text = d === day ? utcMinute(t).slice(11) : utcMinute(t);
    day = d;
    return text;
  };
}

/**
 * The D-8 short form of a passage: "starts setting 2025-03-16 18:23, fully set 19:30 UTC". Earth's
 * centre crossings are named in between ("centre sets ..."). Grazes and peeks are not called a set or a
 * rise; an end beyond the window says so, and an end not found is never given a time.
 */
export function transitionSummary(tr: SkyTransition): string {
  const at = clock();
  let timed = false;
  const time = (x: TransitionInstant, outsideWords: string) => {
    timed = true;
    return `${at(x.timeMs)}${x.inWindow ? '' : ` (${outsideWords})`}`;
  };
  const START: Record<TransitionKind, string> = { set: 'starts setting', rise: 'starts rising', graze: 'partly hidden from', peek: 'partly visible from', unresolved: tr.start.edge === 'first-cut' ? 'starts setting' : 'starts rising' };
  const END: Record<TransitionKind, string> = { set: 'fully set', rise: 'fully risen', graze: 'whole disc clear again', peek: 'last part gone again', unresolved: tr.end.edge === 'last-limb' ? 'fully set' : 'fully risen' };
  const parts: string[] = [];
  // An unresolved end inside the window was not searched for (no ephemeris to follow it with); outside it, the search ran out.
  const days = `${tr.limitDays} day${tr.limitDays === 1 ? '' : 's'}`;
  const startUnresolved = tr.start.inWindow ? 'already under way when the analysed window starts' : `began more than ${days} before the analysed window`;
  const endUnresolved = tr.end.inWindow ? 'still under way when the analysed window ends' : `not over within ${days} after the analysed window`;
  parts.push(tr.start.edge === 'unresolved' ? startUnresolved : `${START[tr.kind]} ${time(tr.start, 'before the analysed window')}`);
  if (tr.body === 'earth') for (const c of tr.centre) parts.push(`centre ${c.up ? 'rises' : 'sets'} ${time(c, 'outside the analysed window')}`);
  const endPart = tr.end.edge === 'unresolved' ? endUnresolved : `${END[tr.kind]} ${time(tr.end, 'after the analysed window')}`;
  // "UTC" closes the last time written; an unresolved end carries no time.
  let text = tr.end.edge === 'unresolved' ? `${parts.join(', ')}${timed ? ' UTC' : ''}, ${endPart}` : `${[...parts, endPart].join(', ')} UTC`;
  if (tr.kind === 'graze') text += '; never fully set';
  if (tr.kind === 'peek') text += '; never fully risen';
  return text;
}

/** One sentence for a passage, naming what each instant is. */
export function transitionText(tr: SkyTransition): string {
  const The = tr.body === 'sun' ? 'The Sun' : 'Earth';
  const its = tr.body === 'sun' ? "the Sun's" : "Earth's";
  const pctOf = (f: number) => `${Math.round(f * 100)} %`;
  let detail: string;
  switch (tr.kind) {
    case 'set': detail = `from the moment the terrain skyline starts to cut into ${its} disc to the moment its last part goes behind the skyline`; break;
    case 'rise': detail = `from the moment the first part of ${its} disc appears above the terrain skyline to the moment the whole disc is clear of it`; break;
    case 'graze': detail = `the terrain skyline cuts into ${its} disc and lets go of it again without hiding it completely${Number.isFinite(tr.minVisibleFraction) ? `; at most ${pctOf(1 - tr.minVisibleFraction)} of the disc is hidden at the analysis' samples` : ''}`; break;
    case 'peek': detail = `part of ${its} disc comes above the terrain skyline and goes again without the whole disc clearing it${Number.isFinite(tr.maxVisibleFraction) ? `; at most ${pctOf(tr.maxVisibleFraction)} of the disc shows at the analysis' samples` : ''}`; break;
    default: detail = 'one end of this passage lies beyond the searched span';
  }
  return `${The}: ${transitionSummary(tr)} (${detail}).`;
}

/** An event with its whole passage, for lists and the assistant: "Sunset: starts setting ..., fully set ... UTC". */
export function eventText(e: SkyEvent): string {
  if (!e.span) return `${EVENT_NAME[e.type]} (${EVENT_LABEL[e.type]}): ${utcMinute(e.timeMs)} UTC`;
  return `${EVENT_NAME[e.type]}: ${transitionSummary(e.span)}`;
}
