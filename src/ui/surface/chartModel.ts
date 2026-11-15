// The data behind the surface chart, taken from the shared site analysis. Pure: no DOM.
//
// Skyline mode: the terrain skyline around the compass, with the Sun's and Earth's samples
// over the mission window placed on it by azimuth and elevation.
// Time mode: the same samples as elevation and clearance against time.
import type { SiteAnalysis } from '../../analysis/types';

export type Body = 'sun' | 'earth';

/** One instant of the analysed series for one body. */
export interface TrackSample {
  body: Body;
  /** Index into the analysis series. */
  index: number;
  timeMs: number;
  azDeg: number;
  elDeg: number;
  /** Elevation of the centre minus the skyline at its azimuth, degrees. */
  clearanceDeg: number;
  /** Fraction of the disc above the skyline, 0..1 (for the Sun, less what Earth covers). */
  visible: number;
  /** Sun: any part of the disc shows. Earth: its centre is above the skyline (line of sight). */
  up: boolean;
}

export interface SkylineData {
  azStepDeg: number;
  /** Skyline elevation at azimuth i * azStepDeg, degrees above the horizontal. */
  elDeg: Float32Array;
  minDeg: number;
  maxDeg: number;
  /** Where a smooth Moon's horizon would sit for this observer height, degrees (negative). */
  smoothDipDeg: number;
}

export interface ChartData {
  scenarioId: string;
  startMs: number;
  endMs: number;
  stepMs: number;
  skyline: SkylineData | null;
  sun: TrackSample[];
  earth: TrackSample[];
}

/** The up/down rule for a sample, shared with the mission-window figures. */
function isUp(body: Body, visible: number, clearance: number): boolean {
  return body === 'sun' ? visible > 0 : clearance >= 0;
}

export function chartData(a: SiteAnalysis): ChartData {
  const s = a.series, h = a.horizon;
  const track = (body: Body): TrackSample[] => {
    const az = body === 'sun' ? s.sunAz : s.earthAz, el = body === 'sun' ? s.sunEl : s.earthEl;
    const clear = body === 'sun' ? s.sunClearance : s.earthClearance, vis = body === 'sun' ? s.sunVisible : s.earthVisible;
    const out: TrackSample[] = [];
    for (let i = 0; i < s.n; i++) {
      if (!Number.isFinite(az[i]) || !Number.isFinite(el[i])) continue;
      out.push({ body, index: i, timeMs: s.startMs + i * s.stepMs, azDeg: az[i], elDeg: el[i], clearanceDeg: clear[i], visible: vis[i], up: isUp(body, vis[i], clear[i]) });
    }
    return out;
  };
  let skyline: SkylineData | null = null;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < h.elevDeg.length; i++) {
    const v = h.elevDeg[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (Number.isFinite(min)) skyline = { azStepDeg: h.azStepDeg, elDeg: h.elevDeg, minDeg: min, maxDeg: max, smoothDipDeg: h.smoothDipDeg };
  return { scenarioId: a.scenario.id, startMs: s.startMs, endMs: s.startMs + (s.n - 1) * s.stepMs, stepMs: s.stepMs, skyline, sun: track('sun'), earth: track('earth') };
}

/** Skyline elevation at any azimuth, interpolated between samples; NaN without a skyline. */
export function skylineAtAz(skyline: SkylineData | null, azDeg: number): number {
  if (!skyline) return NaN;
  const n = skyline.elDeg.length;
  const x = ((((azDeg % 360) + 360) % 360) / skyline.azStepDeg) % n;
  const i = Math.floor(x), f = x - i;
  return skyline.elDeg[i] + (skyline.elDeg[(i + 1) % n] - skyline.elDeg[i]) * f;
}

export interface Range {
  min: number;
  max: number;
}

/**
 * Elevation range of the skyline chart: the whole skyline, and the tracks where they are
 * within reach of it. A body far below the horizon (night) is not chased: the range stops
 * a little under the lowest skyline, and samples below it are simply not drawn.
 */
export function skylineRange(d: ChartData): Range {
  const lowSkyline = d.skyline ? Math.min(d.skyline.minDeg, d.skyline.smoothDipDeg) : 0;
  const highSkyline = d.skyline ? d.skyline.maxDeg : 0;
  let min = lowSkyline - 0.5, max = highSkyline + 0.5;
  for (const sample of [...d.sun, ...d.earth]) {
    if (sample.elDeg > max) max = sample.elDeg;
    // Follow a body a little way under the skyline, so a blocked spell is visible as such.
    if (sample.elDeg < min && sample.elDeg > lowSkyline - 3) min = sample.elDeg;
  }
  const pad = Math.max(0.2, (max - min) * 0.06);
  return { min: Math.max(-90, min - pad), max: Math.min(90, max + pad) };
}

/** Azimuth range for the "tracks" fit: the azimuths the two bodies cross while near or above the skyline, padded; the full circle when that is most of it anyway. */
export function trackAzRange(d: ChartData, yMin: number): Range {
  // Largest empty gap around the circle: the tracks then occupy the rest.
  const azs = [...d.sun, ...d.earth].filter((s) => s.elDeg >= yMin).map((s) => ((s.azDeg % 360) + 360) % 360).sort((a, b) => a - b);
  if (azs.length < 2) return { min: 0, max: 360 };
  let gap = azs[0] + 360 - azs[azs.length - 1], gapEnd = azs[0];
  for (let i = 1; i < azs.length; i++) {
    if (azs[i] - azs[i - 1] > gap) {
      gap = azs[i] - azs[i - 1];
      gapEnd = azs[i];
    }
  }
  const span = 360 - gap;
  if (span > 240) return { min: 0, max: 360 };
  const pad = Math.max(10, span * 0.15), width = Math.max(40, span + 2 * pad);
  const centre = gapEnd + span / 2;
  // May run below 0 or past 360: the chart wraps azimuths into this window.
  return { min: centre - width / 2, max: centre + width / 2 };
}

/** Round tick values covering a range, about `target` of them. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Of the round steps around the ideal one, the one whose tick count comes closest to the target.
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).reduce((best, s) => (Math.abs(span / s - target) < Math.abs(span / best - target) ? s : best));
  const out: number[] = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(10)));
  return out;
}

/** Tick instants for a time axis: whole hours or days (UTC), about `target` of them. */
export function timeTicks(startMs: number, endMs: number, target = 6): { ms: number; label: string }[] {
  const H = 3_600_000;
  const spanH = (endMs - startMs) / H;
  const stepH = [1, 2, 3, 6, 12, 24, 48, 72, 120, 240, 480].find((s) => spanH / s <= target) ?? 720;
  const out: { ms: number; label: string }[] = [];
  for (let t = Math.ceil(startMs / (stepH * H)) * stepH * H; t <= endMs; t += stepH * H) {
    const iso = new Date(t).toISOString();
    // Days as "03-07", hours as "18:00"; midnight shows the date.
    out.push({ ms: t, label: stepH >= 24 || iso.slice(11, 16) === '00:00' ? iso.slice(5, 10) : iso.slice(11, 16) });
  }
  return out;
}

/** The sample of a track nearest in time. */
export function sampleAtTime(track: TrackSample[], timeMs: number): TrackSample | null {
  if (!track.length) return null;
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }
  return Math.abs(track[lo].timeMs - timeMs) <= Math.abs(track[hi].timeMs - timeMs) ? track[lo] : track[hi];
}

/**
 * Thins a track for drawing: keeps a sample when it is at least `minGap` (in the caller's
 * pixel units) from the last one kept, and always where the body comes up or goes down, so
 * the change from filled to hollow marks falls in the right place.
 */
export function thin<T extends TrackSample>(track: T[], position: (s: T) => { x: number; y: number } | null, minGap: number): T[] {
  const out: T[] = [];
  let last: { x: number; y: number } | null = null, lastUp: boolean | null = null;
  for (const s of track) {
    const p = position(s);
    if (!p) {
      last = null;
      continue;
    }
    if (last === null || s.up !== lastUp || Math.hypot(p.x - last.x, p.y - last.y) >= minGap) {
      out.push(s);
      last = p;
      lastUp = s.up;
    }
  }
  return out;
}

export interface TableRow {
  timeMs: number;
  sun: TrackSample | null;
  earth: TrackSample | null;
}

/** Rows for the table view: the series at a readable step, at most `maxRows` rows. */
export function tableRows(d: ChartData, maxRows = 120): { rows: TableRow[]; stepMs: number } {
  const n = Math.max(d.sun.length, d.earth.length);
  if (!n) return { rows: [], stepMs: d.stepMs };
  const H = 3_600_000;
  const spanMs = d.endMs - d.startMs;
  // The smallest of these steps that keeps the table within its size.
  const stepMs = [d.stepMs, H / 2, H, 2 * H, 3 * H, 6 * H, 12 * H, 24 * H].filter((s) => s >= d.stepMs).find((s) => spanMs / s + 1 <= maxRows) ?? 24 * H;
  const rows: TableRow[] = [];
  for (let t = d.startMs; t <= d.endMs + 1; t += stepMs) rows.push({ timeMs: t, sun: sampleAtTime(d.sun, t), earth: sampleAtTime(d.earth, t) });
  return { rows, stepMs };
}

/** How a sample's state reads in words (tooltip, table, screen reader). */
export function stateText(s: TrackSample): string {
  if (s.body === 'sun') {
    if (s.visible >= 0.995) return 'above the skyline';
    if (s.visible > 0) return `${Math.round(s.visible * 100)} % of the disc showing`;
    return 'hidden';
  }
  return s.up ? 'in line of sight' : 'hidden';
}
