// The long view (task T-29): how sunlight and Earth line of sight at one site change from one
// lunar day to the next across a span of months, and how a mission of the scenario's length
// fares for every arrival date in that span.
//
// One skyline is computed for the site and mast height; the Sun and Earth come from the in-app
// model (validated against JPL Horizons, docs/lunyx/validation.md) for the whole span. Rows and
// arrival windows are cut from one long evaluation, so they agree with each other and, to the
// sampling, with analyse() for the same windows. Nothing here speaks about power or temperature.
import type { Scenario } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { EXTEND_LIMIT_DAYS, fullSpans, longestFull } from './extend';
import { computeHorizon } from './horizon';
import { nearbyScore } from './nearby';
import { modelEphemeris, tabulatedEphemeris, type Ephemeris } from './sky';
import type { ArrivalOption, FullSpan, Interval, Outlook, OutlookOptions, OutlookRow } from './types';
import { evaluateWindow, indicators } from './window';

/** Mean length of the lunar day (synodic month), days. */
export const SYNODIC_DAYS = 29.530589;
const DAY = 86_400_000;
const H = 3_600_000;

export const DEFAULT_OUTLOOK_OPTIONS: Required<Omit<OutlookOptions, 'windowDays'>> = { months: 12, stepMin: 20, weightSun: 1, weightEarth: 1 };

/** Arrivals are evaluated about this far apart. */
const ARRIVAL_STEP_MS = 2 * H;
/** The outlook evaluates beyond its span by the mission length, up to this much, so late arrivals have whole missions. */
const MAX_TAIL_DAYS = 90;
const SLIP_DAYS = [1, 3, 7, 14, 28];

const utcMinute = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const f1 = (v: number) => v.toFixed(1);
/** A fraction as a percentage, with the rounding noise of the running sums removed at the two ends. */
const pct = (fraction: number) => {
  const v = 100 * fraction;
  return v > 100 - 1e-9 ? 100 : v < 1e-9 ? 0 : v;
};

/** Fraction of each sampling cell [start + i*step, start + (i+1)*step) covered by the given spans. */
function cellCoverage(spans: Interval[], startMs: number, stepMs: number, cells: number): Float64Array {
  const c = new Float64Array(cells);
  for (const iv of spans) {
    const a = (iv.startMs - startMs) / stepMs, b = (iv.endMs - startMs) / stepMs;
    const i0 = Math.max(0, Math.floor(a)), i1 = Math.min(cells - 1, Math.ceil(b) - 1);
    for (let i = i0; i <= i1; i++) {
      const lo = a > i ? a : i, hi = b < i + 1 ? b : i + 1;
      if (hi > lo) c[i] += hi - lo;
    }
  }
  return c;
}

/** Running sums of per-cell values, and the integral (in cells) between two instants. */
function integrator(cellValue: Float64Array, startMs: number, stepMs: number) {
  const n = cellValue.length;
  const sum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + cellValue[i];
  const upTo = (t: number) => {
    const x = (t - startMs) / stepMs;
    if (x <= 0) return 0;
    if (x >= n) return sum[n];
    const i = Math.floor(x);
    return sum[i] + (x - i) * cellValue[i];
  };
  /** Mean value over [a, b]. */
  return (a: number, b: number) => ((upTo(b) - upTo(a)) * stepMs) / (b - a);
}

/** Longest stretch of the given (sorted) spans inside [a, b], hours; `from` is where to start looking and is advanced. */
function longestInside(spans: Interval[], a: number, b: number, cursor: { i: number }): number {
  while (cursor.i < spans.length && spans[cursor.i].endMs <= a) cursor.i++;
  let best = 0;
  for (let k = cursor.i; k < spans.length && spans[k].startMs < b; k++) {
    const len = Math.min(spans[k].endMs, b) - Math.max(spans[k].startMs, a);
    if (len > best) best = len;
  }
  return best / H;
}

function emptyOutlook(scenario: Scenario, months: number, windowDays: number, stepMin: number, endMs: number, warnings: string[]): Outlook {
  const none = new Float32Array(0);
  return {
    scenario, startMs: scenario.startMs, endMs, months, windowDays, stepMin, rows: [],
    arrivals: { startMs: scenario.startMs, stepMs: ARRIVAL_STEP_MS, n: 0, missionH: scenario.durationH, score: none, illuminationPct: none, earthVisiblePct: none, longestDarknessH: none },
    planned: null, best: null, worst: null, slips: [], longestDarkness: null, longestEarthGap: null,
    highlights: [], dem: [], assumptions: [], warnings,
  };
}

/** The outlook for a scenario with terrain already loaded. Synchronous; see `outlook()` in api.ts for the entry point. */
export function outlookWith(scenario: Scenario, stack: TerrainStack, options: OutlookOptions = {}): Outlook {
  const months = options.months ?? DEFAULT_OUTLOOK_OPTIONS.months;
  const windowDays = options.windowDays ?? SYNODIC_DAYS;
  const stepMin = options.stepMin ?? DEFAULT_OUTLOOK_OPTIONS.stepMin;
  const weights = { weightSun: options.weightSun ?? DEFAULT_OUTLOOK_OPTIONS.weightSun, weightEarth: options.weightEarth ?? DEFAULT_OUTLOOK_OPTIONS.weightEarth };
  if (!(months > 0 && months <= 60)) throw new RangeError('outlook: months must be above 0 and at most 60');
  if (!(windowDays > 0)) throw new RangeError('outlook: windowDays must be positive');
  if (!(stepMin >= 1 && stepMin <= 120)) throw new RangeError('outlook: stepMin must be within 1..120');
  if (!Number.isFinite(scenario.startMs) || !(scenario.durationH > 0)) throw new RangeError('outlook: the scenario needs a start time and a positive duration');
  if (!(weights.weightSun >= 0 && weights.weightEarth >= 0 && weights.weightSun + weights.weightEarth > 0)) throw new RangeError('outlook: the weights must be non-negative and not both zero');

  const site = { lat: scenario.site.lat, lon: scenario.site.lon };
  const startMs = scenario.startMs;
  const spanMs = months * SYNODIC_DAYS * DAY;
  const endMs = startMs + spanMs;
  const stepMs = stepMin * 60_000;
  const missionMs = scenario.durationH * H;
  const windowMs = windowDays * DAY;

  const horizon = computeHorizon(stack, site, scenario.mastHeightM);
  if (!Number.isFinite(horizon.siteElevationM)) {
    return emptyOutlook(scenario, months, windowDays, stepMin, endMs, ['No elevation data covers this site: without a skyline no outlook can be computed.']);
  }
  const warnings = [...horizon.warnings, ...stack.notes.filter((n) => !/^Elevation data at this point, finest first/.test(n))];
  const obsH = horizon.siteElevationM + horizon.mastHeightM;

  // Evaluate the span plus one mission length (bounded), so that every arrival in the span has its whole mission.
  const tailMs = Math.min(missionMs, MAX_TAIL_DAYS * DAY);
  const cells = Math.ceil((spanMs + tailMs) / stepMs - 1e-9);
  const evalEndMs = startMs + cells * stepMs;
  const eph = tabulatedEphemeris(site, obsH, startMs, evalEndMs);
  const long: Scenario = { ...scenario, durationH: (evalEndMs - startMs) / H, stepMin };
  const { series, metrics } = evaluateWindow(long, horizon, eph);

  // Per-cell values and their running sums.
  const sunCell = new Float64Array(cells);
  for (let i = 0; i < cells; i++) sunCell[i] = (series.sunVisible[i] + series.sunVisible[i + 1]) / 2;
  const meanSun = integrator(sunCell, startMs, stepMs);
  const meanAny = integrator(cellCoverage(metrics.sunIntervals, startMs, stepMs, cells), startMs, stepMs);
  const meanEarth = integrator(cellCoverage(metrics.earthIntervals, startMs, stepMs, cells), startMs, stepMs);
  const meanEarthAny = integrator(cellCoverage(metrics.earthAnyIntervals ?? [], startMs, stepMs, cells), startMs, stepMs);

  // Dark spells and Earth gaps in full: the first and last are followed beyond what was evaluated.
  const limitMs = EXTEND_LIMIT_DAYS * DAY;
  let before: Ephemeris | null = null, after: Ephemeris | null = null;
  const direct = modelEphemeris(site, obsH);
  const anywhere: Ephemeris = {
    source: 'model',
    note: direct.note,
    at(t, out) {
      if (t < startMs) (before ??= tabulatedEphemeris(site, obsH, startMs - limitMs, startMs)).at(t, out);
      else if (t > evalEndMs) (after ??= tabulatedEphemeris(site, obsH, evalEndMs, evalEndMs + limitMs)).at(t, out);
      else eph.at(t, out);
    },
    instant: direct.instant,
  };
  const ind = indicators(horizon, anywhere);
  const darkFull = fullSpans(metrics.darkIntervals, ind.sunAny, stepMs);
  const gapFull = fullSpans(metrics.earthGapIntervals, ind.earth, 3 * stepMs);

  /** Longest full span among those overlapping [a, b], and the longest stretch inside [a, b]. */
  const spansOver = (clipped: Interval[], full: FullSpan[], a: number, b: number) => {
    let fullH = 0, complete = true, inside = 0;
    for (let k = 0; k < clipped.length; k++) {
      if (clipped[k].endMs <= a || clipped[k].startMs >= b) continue;
      const len = (Math.min(clipped[k].endMs, b) - Math.max(clipped[k].startMs, a)) / H;
      if (len > inside) inside = len;
      if (full[k].hours > fullH) {
        fullH = full[k].hours;
        complete = full[k].startFound && full[k].endFound;
      }
    }
    return { fullH, complete, inside };
  };

  // Rows: consecutive windows across the span.
  const rows: OutlookRow[] = [];
  const nRows = Math.floor(spanMs / windowMs + 1e-9);
  for (let k = 0; k < nRows; k++) {
    const a = startMs + k * windowMs, b = a + windowMs;
    let maxEl = -Infinity, minEl = Infinity;
    for (let i = Math.max(0, Math.ceil((a - startMs) / stepMs)); i <= Math.min(cells, Math.floor((b - startMs) / stepMs)); i++) {
      const el = series.sunEl[i];
      if (el > maxEl) maxEl = el;
      if (el < minEl) minEl = el;
    }
    const dark = spansOver(metrics.darkIntervals, darkFull, a, b);
    const gap = spansOver(metrics.earthGapIntervals, gapFull, a, b);
    rows.push({
      index: k + 1, startMs: a, endMs: b,
      illuminationPct: pct(meanSun(a, b)),
      sunAnyPct: pct(meanAny(a, b)),
      longestDarknessH: dark.fullH, darknessComplete: dark.complete, longestDarknessInWindowH: dark.inside,
      earthVisiblePct: pct(meanEarth(a, b)),
      earthAnyPct: pct(meanEarthAny(a, b)),
      longestEarthGapH: gap.fullH, earthGapComplete: gap.complete, longestEarthGapInWindowH: gap.inside,
      maxSunElDeg: maxEl, minSunElDeg: minEl,
    });
  }

  // Arrivals: a mission-length window from every arrival time whose whole mission was evaluated.
  const arrivalStepMs = Math.max(1, Math.round(ARRIVAL_STEP_MS / stepMs)) * stepMs;
  const lastArrivalMs = Math.min(endMs, evalEndMs - missionMs);
  const nArr = lastArrivalMs >= startMs ? Math.floor((lastArrivalMs - startMs) / arrivalStepMs + 1e-9) + 1 : 0;
  const score = new Float32Array(nArr), illum = new Float32Array(nArr), earthPct = new Float32Array(nArr), darkH = new Float32Array(nArr);
  const cursor = { i: 0 };
  const optionAt = (a: number, cur: { i: number }): ArrivalOption => {
    const b = a + missionMs;
    const illuminationPct = pct(meanSun(a, b)), earthVisiblePct = pct(meanEarth(a, b));
    return {
      startMs: a, endMs: b, slipDays: (a - startMs) / DAY, illuminationPct, sunAnyPct: pct(meanAny(a, b)), earthVisiblePct,
      longestDarknessH: longestInside(metrics.darkIntervals, a, b, cur),
      score: nearbyScore(illuminationPct, earthVisiblePct, weights),
    };
  };
  let bestI = -1, worstI = -1;
  for (let j = 0; j < nArr; j++) {
    const o = optionAt(startMs + j * arrivalStepMs, cursor);
    score[j] = o.score; illum[j] = o.illuminationPct; earthPct[j] = o.earthVisiblePct; darkH[j] = o.longestDarknessH;
    if (bestI < 0 || o.score > score[bestI]) bestI = j;
    if (worstI < 0 || o.score < score[worstI]) worstI = j;
  }
  const exact = (j: number) => optionAt(startMs + j * arrivalStepMs, { i: 0 });
  const planned = nArr > 0 ? exact(0) : null;
  const best = nArr > 0 ? exact(bestI) : null;
  const worst = nArr > 0 ? exact(worstI) : null;
  const slips = SLIP_DAYS.filter((d) => startMs + d * DAY <= lastArrivalMs).map((d) => optionAt(startMs + d * DAY, { i: 0 }));

  const longestDarkness = longestFull(darkFull);
  const longestEarthGap = longestFull(gapFull);

  // ---- words
  const highlights: string[] = [];
  const unit = options.windowDays === undefined ? 'lunar day' : `${f1(windowDays)}-day window`;
  if (rows.length) {
    const by = (key: 'illuminationPct' | 'earthVisiblePct', pick: (x: number, y: number) => boolean) => rows.reduce((p, c) => (pick(c[key], p[key]) ? c : p));
    const lo = by('illuminationPct', (x, y) => x < y), hi = by('illuminationPct', (x, y) => x > y);
    highlights.push(
      hi.illuminationPct - lo.illuminationPct < 0.5
        ? `Sunlight stays between ${f1(lo.illuminationPct)} % and ${f1(hi.illuminationPct)} % in every ${unit} of the ${rows.length} from ${utcDay(startMs)}.`
        : `Sunlight per ${unit} ranges from ${f1(lo.illuminationPct)} % (${unit} ${lo.index}, from ${utcDay(lo.startMs)}) to ${f1(hi.illuminationPct)} % (${unit} ${hi.index}, from ${utcDay(hi.startMs)}) over the ${rows.length} from ${utcDay(startMs)}.`,
    );
    const elo = by('earthVisiblePct', (x, y) => x < y), ehi = by('earthVisiblePct', (x, y) => x > y);
    highlights.push(
      ehi.earthVisiblePct <= 0
        ? `Earth's centre is never above the skyline in this span (geometric line of sight).`
        : elo.earthVisiblePct >= 99.95
          ? `Earth's centre is above the skyline throughout the span (geometric line of sight).`
          : f1(elo.earthVisiblePct) === f1(ehi.earthVisiblePct)
            ? `Earth's centre is in view ${f1(elo.earthVisiblePct)} % of every ${unit} (geometric line of sight).`
            : ehi.earthVisiblePct - elo.earthVisiblePct < 0.5
              ? `Earth's centre is in view ${f1(elo.earthVisiblePct)} to ${f1(ehi.earthVisiblePct)} % of every ${unit} (geometric line of sight).`
              : `Earth's centre is in view from ${f1(elo.earthVisiblePct)} % (${unit} ${elo.index}) to ${f1(ehi.earthVisiblePct)} % (${unit} ${ehi.index}) of a ${unit} (geometric line of sight).`,
    );
  }
  if (longestDarkness && longestDarkness.hours > 0) {
    highlights.push(
      longestDarkness.startFound && longestDarkness.endFound
        ? `The longest darkness in the span lasts ${f1(longestDarkness.hours)} h (${f1(longestDarkness.hours / 24)} days), from ${utcMinute(longestDarkness.startMs).replace(' UTC', '')} to ${utcMinute(longestDarkness.endMs)}.`
        : `The longest darkness in the span lasts at least ${f1(longestDarkness.hours)} h (${f1(longestDarkness.hours / 24)} days): no ${!longestDarkness.endFound ? 'end' : 'start'} was found within ${EXTEND_LIMIT_DAYS} days beyond the span.`,
    );
  } else if (rows.length) {
    highlights.push('The Sun is never entirely hidden in this span.');
  }
  const missionText = scenario.durationH % 24 === 0 ? `${scenario.durationH / 24}-day` : `${f1(scenario.durationH)}-hour`;
  if (best && worst && planned) {
    const describe = (o: ArrivalOption) => `${f1(o.score)} (${f1(o.illuminationPct)} % sunlight, ${f1(o.earthVisiblePct)} % Earth line of sight, longest darkness ${f1(o.longestDarknessH)} h)`;
    highlights.push(
      best.score - worst.score < 0.5
        ? `For a ${missionText} mission the arrival date makes little difference in this span: the score stays between ${f1(worst.score)} and ${f1(best.score)}.`
        : `For a ${missionText} mission, arriving ${utcMinute(best.startMs)} scores highest in this span, ${describe(best)}; arriving ${utcMinute(worst.startMs)} scores lowest, ${describe(worst)}. The planned arrival, ${utcMinute(planned.startMs)}, scores ${describe(planned)}.`,
    );
    const week = slips.find((s) => s.slipDays === 7) ?? slips[slips.length - 1];
    if (week) {
      highlights.push(`A slip of ${week.slipDays} days from the planned arrival changes sunlight from ${f1(planned.illuminationPct)} % to ${f1(week.illuminationPct)} %, Earth line of sight from ${f1(planned.earthVisiblePct)} % to ${f1(week.earthVisiblePct)} % and the longest darkness from ${f1(planned.longestDarknessH)} h to ${f1(week.longestDarknessH)} h.`);
    }
  }

  const layersText = horizon.layers.map((l) => `${l.name} (${Math.round(l.resolutionM)} m) from ${(l.fromM / 1000).toFixed(1)} to ${(l.toM / 1000).toFixed(1)} km`).join('; ');
  const assumptions = [
    `Span: ${months} lunar months of ${SYNODIC_DAYS} days from ${utcMinute(startMs)}; rows are consecutive ${options.windowDays === undefined ? 'lunar days' : `${f1(windowDays)}-day windows`} from that instant${nRows * windowMs < spanMs - stepMs ? ' (a last partial window is left out)' : ''}.`,
    `Observer ${horizon.mastHeightM} m above the terrain at ${site.lat.toFixed(4)}, ${site.lon.toFixed(4)} (degrees, east-positive). One skyline for the whole span, ${horizon.azStepDeg} deg in azimuth, from: ${layersText || 'no data'}.`,
    `Sun and Earth from the in-app model for the whole span (${eph.note}), sampled every ${stepMin} min; rise and set times refined to 10 s. Topocentric and airless.`,
    'Sunlight is the time-averaged visible fraction of the Sun\'s disc; Earth passing in front of the Sun is included. Earth line of sight means Earth\'s centre above the skyline: geometry only, not a radio link. Each row\'s earthAnyPct counts any part of Earth\'s disc instead (the definition of PGDA product 69\'s long-term Earth map).',
    `Darkness and Earth gaps are measured in full: they are not cut at a row's edges, and at the ends of the span they are followed up to ${EXTEND_LIMIT_DAYS} days further.`,
    `Arrivals: a mission of ${f1(scenario.durationH)} h starting every ${f1(arrivalStepMs / H)} h across the span; score = weighted mean of sunlight % and Earth line-of-sight % (weights ${weights.weightSun} and ${weights.weightEarth}), the score of the nearby ranking.`,
    'These are geometric conditions only; nothing here is a statement about power or temperature.',
  ];
  if (missionMs > tailMs) warnings.push(`The mission is longer than ${MAX_TAIL_DAYS} days: arrivals are evaluated only where the whole mission lies within ${MAX_TAIL_DAYS} days after the span.`);

  return {
    scenario, startMs, endMs, months, windowDays, stepMin, rows,
    arrivals: { startMs, stepMs: arrivalStepMs, n: nArr, missionH: scenario.durationH, score, illuminationPct: illum, earthVisiblePct: earthPct, longestDarknessH: darkH },
    planned, best, worst, slips, longestDarkness, longestEarthGap, highlights, dem: horizon.layers, assumptions, warnings,
  };
}
