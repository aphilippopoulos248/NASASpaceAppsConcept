// The seasonal outlook as the panel and the showOutlook action present it: the per-lunar-day
// figures, the planned, best and worst arrival for a mission of the scenario's length, and what
// a slip of 1 to 28 days costs. Pure: every number is outlook()'s own.
import type { ArrivalOption, FullSpan, Outlook } from '../../analysis/types';
import { scenarioFacts } from '../../core/analysisReport';
import { rounded } from '../../core/analysisStore';
import { isoUtc } from '../../core/time';

export interface SlipRow {
  slipDays: number;
  option: ArrivalOption;
  /** Slip minus planned: score points, sunlight and Earth percentage points, darkness hours. */
  scoreChange: number;
  illuminationChange: number;
  earthChange: number;
  darknessChange: number;
}

export function slipRows(o: Outlook): SlipRow[] {
  const p = o.planned;
  if (!p) return [];
  return o.slips.map((s) => ({
    slipDays: s.slipDays,
    option: s,
    scoreChange: s.score - p.score,
    illuminationChange: s.illuminationPct - p.illuminationPct,
    earthChange: s.earthVisiblePct - p.earthVisiblePct,
    darknessChange: s.longestDarknessH - p.longestDarknessH,
  }));
}

const arrival = (a: ArrivalOption | null) =>
  a && {
    arrivalUtc: isoUtc(a.startMs),
    endUtc: isoUtc(a.endMs),
    slipDays: rounded(a.slipDays, 2),
    score: rounded(a.score),
    illuminationPct: rounded(a.illuminationPct),
    earthVisiblePct: rounded(a.earthVisiblePct),
    longestDarknessH: rounded(a.longestDarknessH),
  };

const span = (f: FullSpan | null) => f && { startUtc: isoUtc(f.startMs), endUtc: isoUtc(f.endMs), hours: rounded(f.hours), startFound: f.startFound, endFound: f.endFound };

/** The showOutlook result: small JSON, units in the key names, null where a value does not exist. */
export function outlookResult(o: Outlook) {
  return {
    scenario: scenarioFacts(o.scenario),
    months: o.months,
    span: { startUtc: isoUtc(o.startMs), endUtc: isoUtc(o.endMs) },
    rowLengthDays: rounded(o.windowDays, 3),
    lunarDays: o.rows.map((r) => ({
      index: r.index,
      startUtc: isoUtc(r.startMs),
      endUtc: isoUtc(r.endMs),
      illuminationPct: rounded(r.illuminationPct),
      sunAnyPct: rounded(r.sunAnyPct),
      earthVisiblePct: rounded(r.earthVisiblePct),
      longestDarknessH: rounded(r.longestDarknessH),
      darknessComplete: r.darknessComplete,
      longestEarthGapH: rounded(r.longestEarthGapH),
      earthGapComplete: r.earthGapComplete,
    })),
    missionH: o.arrivals.missionH,
    planned: arrival(o.planned),
    best: arrival(o.best),
    worst: arrival(o.worst),
    slips: slipRows(o).map((s) => ({
      ...arrival(s.option)!,
      scoreChange: rounded(s.scoreChange),
      illuminationChangePct: rounded(s.illuminationChange),
      earthVisibleChangePct: rounded(s.earthChange),
      longestDarknessChangeH: rounded(s.darknessChange),
    })),
    longestDarkness: span(o.longestDarkness),
    longestEarthGap: span(o.longestEarthGap),
    scoring: 'score = mean of illuminationPct and earthVisiblePct over a mission of missionH hours from each arrival (arrivals every 2 h); higher is better',
    highlights: o.highlights,
    assumptions: o.assumptions,
    warnings: o.warnings,
  };
}

/** The range of a figure over the rows, ignoring values that do not exist. */
export function rangeOf(values: readonly number[]): { min: number; max: number } | null {
  const ok = values.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok) } : null;
}
