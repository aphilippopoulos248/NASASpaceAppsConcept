// Lower-left chart of the surface view. Two modes on the same analysed series:
//   skyline: the terrain skyline around the compass (elevation above the horizontal), with
//            the Sun's and Earth's samples over the mission window on it. Filled marks are
//            above the skyline, hollow ones hidden; circles are the Sun, diamonds Earth.
//   time:    their elevation, and their clearance above the skyline, against time.
// Pointing at a mark tells its time and numbers; clicking it moves the shared clock there,
// turns the view to it and, if it is hidden, shows what hides it. The same data is available
// as a table. Nothing here keeps its own clock: time, look direction and site come from the
// store, and every change goes through a registered action.
import { blockageAt } from '../../analysis/api';
import type { Blockage, SiteAnalysis } from '../../analysis/types';
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { store } from '../../core/store';
import { formatUtc } from '../../core/time';
import { button, el } from '../dom';
import { chartData, niceTicks, sampleAtTime, skylineAtAz, skylineRange, stateText, tableRows, thin, timeTicks, trackAzRange, type Body, type ChartData, type Range, type TrackSample } from './chartModel';
import { ensureHudActions } from './hudActions';
import { hudLayoutPart, requestHudLayout } from './hudLayout';
import { applyPhoneDefaults, hudState, onHudState, setHudState } from './hudState';
import './skylineChart.css';

const NS = 'http://www.w3.org/2000/svg';
function S<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
  if (text !== undefined) node.textContent = text;
  return node;
}

const COMPASS: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W', 360: 'N' };
const signed = (v: number, digits = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}°`;
const degrees = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v)}°`;
/** UTC to the second, in the form the setTime action reads. */
const utcParam = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;
const wrap360 = (az: number) => ((az % 360) + 360) % 360;
const clampEl = (v: number) => Math.max(-85, Math.min(85, v));
const px = (v: number) => v.toFixed(1);

interface Placed {
  x: number;
  y: number;
  sample: TrackSample;
}

interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** What the drawing on screen needs to turn pointer positions back into data. */
interface SkyGeometry extends Frame {
  mode: 'skyline';
  az: Range;
  el: Range;
  /** Null when the azimuth is outside the range on show. */
  x(azDeg: number): number | null;
  y(elDeg: number): number;
  marks: Placed[];
}
interface TimePanel {
  top: number;
  bottom: number;
  range: Range;
  y(v: number): number;
}
interface TimeGeometry extends Frame {
  mode: 'time';
  x(timeMs: number): number;
  elevation: TimePanel;
  clearance: TimePanel;
}
type Geometry = SkyGeometry | TimeGeometry;

function markNode(body: Body, x: number, y: number, r: number, up: boolean, extra = ''): SVGElement {
  const d = r + 0.8;
  const node = body === 'sun' ? S('circle', { cx: px(x), cy: px(y), r }) : S('path', { d: `M${px(x)},${px(y - d)}L${px(x + d)},${px(y)}L${px(x)},${px(y + d)}L${px(x - d)},${px(y)}Z` });
  node.setAttribute('class', `skc-mark skc-mark--${body} ${up ? 'skc-up' : 'skc-down'}${extra}`);
  return node;
}

/** Whether a body counts as showing at an instant, by the same rule as the samples: any of the Sun's disc; Earth's centre. */
function showing(b: Blockage): boolean {
  if (b.body === 'earth') return !b.blocked;
  const disc = b.discVisibleFraction ?? (b.blocked ? 0 : 1);
  return disc > 0 && (b.eclipsedFraction ?? 0) < 0.995;
}

export function mountSkylineChart(region: HTMLElement): void {
  ensureHudActions({ store, analysis });
  applyPhoneDefaults();

  // ---------------------------------------------------------------- DOM
  const panel = el('div', 'ly-panel skc');
  panel.hidden = true;
  const head = el('div', 'skc-head');
  const title = el('h2', 'skc-title');
  const modes = el('div', 'ly-seg skc-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'What the chart plots');
  const modeSkyline = button('Skyline', 'ly-btn ly-btn--small', () => void runAction('setChart', { mode: 'skyline' }));
  modeSkyline.title = 'The terrain skyline around the compass, with the Sun and Earth over the mission window';
  const modeTime = button('Time', 'ly-btn ly-btn--small', () => void runAction('setChart', { mode: 'time' }));
  modeTime.title = 'Elevation of the Sun and Earth, and their clearance above the skyline, against time';
  modes.append(modeSkyline, modeTime);
  const tools = el('div', 'skc-tools');
  const fit = button('', 'ly-btn ly-btn--small skc-fit', () => void runAction('setChart', { azimuthRange: hudState().chartFit === 'full' ? 'tracks' : 'full' }));
  const asTable = button('Table', 'ly-btn ly-btn--small', () => void runAction('setChart', { table: !hudState().chartTable }));
  asTable.title = 'The same numbers as a table';
  const size = button('', 'ly-btn ly-btn--small', () => void runAction('setChart', { expanded: hudState().chart !== 'expanded' }));
  const hide = button('×', 'ly-btn ly-btn--small ly-btn--ghost skc-hide', () => void runAction('setChart', { show: false }));
  hide.setAttribute('aria-label', 'Hide the chart');
  hide.title = 'Hide the chart';
  tools.append(fit, asTable, size, hide);
  head.append(title, modes, tools);

  const subtitle = el('p', 'ly-note skc-sub');
  const status = el('p', 'skc-status ly-unavailable');
  status.setAttribute('role', 'status');
  const plot = el('div', 'skc-plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  plot.setAttribute('aria-roledescription', 'interactive chart');
  const svg = S('svg', { class: 'skc-svg', role: 'img' });
  const staticLayer = S('g'), overlay = S('g');
  svg.append(staticLayer, overlay);
  plot.append(svg);
  const legend = el('div', 'skc-legend');
  const help = el('p', 'ly-note skc-help');
  const tableWrap = el('div', 'skc-table');
  tableWrap.tabIndex = 0;
  tableWrap.setAttribute('role', 'region');
  tableWrap.setAttribute('aria-label', 'Chart data as a table');

  // Blockage explanation: its own block, also shown when the chart itself is hidden.
  const explain = el('section', 'skc-explain');
  explain.setAttribute('aria-live', 'polite');
  explain.setAttribute('aria-label', 'What forms the skyline there');
  explain.hidden = true;
  const explainTitle = el('h3', 'skc-explain-title');
  const explainText = el('p', 'skc-explain-text');
  const explainFacts = el('dl', 'ly-kv skc-facts');
  const explainStale = el('p', 'ly-note skc-explain-stale', 'The clock has moved on since.');
  const explainActions = el('div', 'skc-explain-actions');
  const explainTurn = button('Turn the view to it', 'ly-btn ly-btn--small');
  const explainGo = button('Set the clock to that time', 'ly-btn ly-btn--small');
  const explainNow = button('Explain the current time', 'ly-btn ly-btn--small');
  const explainClose = button('Close', 'ly-btn ly-btn--small ly-btn--ghost', () => void runAction('dismissBlockageExplanation'));
  explainActions.append(explainTurn, explainGo, explainNow, explainClose);
  explain.append(explainTitle, explainText, explainFacts, explainStale, explainActions);

  panel.append(head, subtitle, status, plot, legend, help, tableWrap, explain);
  region.append(panel);
  hudLayoutPart('chart', panel);

  const tip = el('div', 'ly-tooltip skc-tip');
  tip.hidden = true;
  document.body.append(tip);

  // ---------------------------------------------------------------- state
  let data: ChartData | null = null;
  let current: SiteAnalysis | null = null;
  let geometry: Geometry | null = null;
  let renderQueued = false, overlayQueued = false;
  let hover: Placed | { x: number; timeMs: number } | null = null;
  let nowMemo: { a: SiteAnalysis; timeMs: number; sun: Blockage; earth: Blockage } | null = null;
  const nowAt = (a: SiteAnalysis, timeMs: number) => {
    if (!nowMemo || nowMemo.a !== a || nowMemo.timeMs !== timeMs) nowMemo = { a, timeMs, sun: blockageAt(a, 'sun', timeMs), earth: blockageAt(a, 'earth', timeMs) };
    return nowMemo;
  };

  /** Reads the analysis on show, if it is the one the app state asks for. Returns what to say when there is nothing to draw. */
  const readAnalysis = (): string | null => {
    const st = analysis.get('current'), wanted = analysis.wanted('current');
    const none = (text: string) => {
      current = null;
      data = null;
      return text;
    };
    if (!wanted || st.state === 'idle') return none('No site is selected.');
    if (st.state === 'error') return none(`The site analysis is not available: ${st.error}`);
    if (st.state === 'loading' || st.scenario.id !== wanted.id) return none('Working out the skyline and the mission window…');
    if (current !== st.value) {
      current = st.value;
      data = chartData(st.value);
    }
    if (!data!.skyline) return 'No elevation data covers this site, so there is no skyline to draw. The Sun and Earth over the mission window are in the table.';
    if (!data!.sun.length && !data!.earth.length) return 'The mission window has no samples.';
    return null;
  };

  // ---------------------------------------------------------------- drawing: skyline mode
  function drawSkyline(d: ChartData, w: number, h: number, compact: boolean): SkyGeometry {
    const left = 32, right = w - 6, top = compact ? 6 : 16, bottom = h - 17;
    const elRange = skylineRange(d);
    const azRange: Range = hudState().chartFit === 'tracks' ? trackAzRange(d, elRange.min) : { min: 0, max: 360 };
    const xRaw = (a: number) => left + ((a - azRange.min) / (azRange.max - azRange.min)) * (right - left);
    const x = (azDeg: number): number | null => {
      let a = wrap360(azDeg);
      while (a < azRange.min) a += 360;
      while (a > azRange.max && a - 360 >= azRange.min) a -= 360;
      return a < azRange.min || a > azRange.max ? null : xRaw(a);
    };
    const y = (elev: number): number => bottom - ((elev - elRange.min) / (elRange.max - elRange.min)) * (bottom - top);

    // Grid and axes: hairlines, labels in the muted ink.
    const g = S('g', { class: 'skc-grid' });
    for (const tick of niceTicks(elRange.min, elRange.max, compact ? 3 : 5)) {
      g.append(S('line', { x1: left, x2: right, y1: px(y(tick)), y2: px(y(tick)), class: tick === 0 ? 'skc-zero' : 'skc-hair' }));
      g.append(S('text', { x: left - 5, y: px(y(tick) + 3.5), class: 'skc-tick', 'text-anchor': 'end' }, degrees(tick)));
    }
    const full = azRange.min === 0 && azRange.max === 360;
    const azTicks = full ? (compact ? [0, 90, 180, 270, 360] : [0, 45, 90, 135, 180, 225, 270, 315, 360]) : niceTicks(azRange.min, azRange.max, compact ? 4 : 7);
    for (const tick of azTicks) {
      const at = xRaw(tick);
      g.append(S('line', { x1: px(at), x2: px(at), y1: top, y2: bottom, class: 'skc-hair' }));
      const a = tick === 360 ? 360 : wrap360(tick);
      const label = COMPASS[a] ? (compact ? COMPASS[a] : `${COMPASS[a]} ${a === 360 ? 0 : a}°`) : `${a}°`;
      g.append(S('text', { x: px(at), y: bottom + 12, class: 'skc-tick', 'text-anchor': at < left + 8 ? 'start' : at > right - 8 ? 'end' : 'middle' }, label));
    }
    staticLayer.append(g);

    // Terrain: a quiet area up to the skyline, with the skyline itself as a line.
    if (d.skyline) {
      const step = Math.max(d.skyline.azStepDeg / 2, (azRange.max - azRange.min) / (right - left));
      let line = '';
      for (let az = azRange.min; az < azRange.max + step; az += step) {
        const a = Math.min(az, azRange.max);
        const elev = Math.max(elRange.min, Math.min(elRange.max, skylineAtAz(d.skyline, a)));
        line += `${line ? 'L' : 'M'}${px(xRaw(a))},${px(y(elev))}`;
      }
      staticLayer.append(S('path', { d: `${line}L${right},${bottom}L${left},${bottom}Z`, class: 'skc-terrain' }));
      staticLayer.append(S('path', { d: line, class: 'skc-skyline' }));
    }

    // Tracks: Earth first, the Sun on top.
    const r = 4;
    const marks: Placed[] = [];
    const place = (s: TrackSample) => {
      const at = x(s.azDeg);
      return at === null || s.elDeg < elRange.min || s.elDeg > elRange.max ? null : { x: at, y: y(s.elDeg) };
    };
    for (const body of ['earth', 'sun'] as const) {
      const layer = S('g');
      for (const s of thin(body === 'sun' ? d.sun : d.earth, place, 2 * r + 2)) {
        const p = place(s)!;
        layer.append(markNode(body, p.x, p.y, r, s.up));
        marks.push({ ...p, sample: s });
      }
      staticLayer.append(layer);
    }
    return { mode: 'skyline', left, right, top, bottom, az: azRange, el: elRange, x, y, marks };
  }

  // ---------------------------------------------------------------- drawing: time mode
  function drawTime(d: ChartData, w: number, h: number, compact: boolean): TimeGeometry {
    const left = 32, right = w - (compact ? 6 : 44), top = 4, bottom = h - 17;
    const split = top + (bottom - top) * 0.5;
    const span = (get: (s: TrackSample) => number, include?: number): Range => {
      let min = include ?? Infinity, max = include ?? -Infinity;
      for (const track of [d.sun, d.earth]) {
        for (const s of track) {
          const v = get(s);
          if (!Number.isFinite(v)) continue;
          min = Math.min(min, v);
          max = Math.max(max, v);
        }
      }
      if (!Number.isFinite(min)) return { min: -1, max: 1 };
      const pad = Math.max(0.3, (max - min) * 0.1);
      return { min: min - pad, max: max + pad };
    };
    const panelOf = (pTop: number, pBottom: number, range: Range): TimePanel => ({ top: pTop, bottom: pBottom, range, y: (v) => pBottom - ((v - range.min) / (range.max - range.min)) * (pBottom - pTop) });
    const elevation = panelOf(top + 12, split - 4, span((s) => s.elDeg, 0));
    const clearance = panelOf(split + 16, bottom, span((s) => s.clearanceDeg, 0));
    const x = (t: number) => left + ((t - d.startMs) / Math.max(1, d.endMs - d.startMs)) * (right - left);

    const g = S('g', { class: 'skc-grid' });
    // Below zero clearance the body is hidden: a quiet band says so.
    if (clearance.range.min < 0) g.append(S('rect', { x: left, y: px(clearance.y(0)), width: right - left, height: px(clearance.bottom - clearance.y(0)), class: 'skc-hidden-zone' }));
    for (const [p, name] of [[elevation, compact ? 'Elevation' : 'Elevation above the horizontal'], [clearance, compact ? 'Clearance above skyline (below 0°: hidden)' : 'Clearance above the skyline (below 0°: hidden)']] as const) {
      for (const tick of niceTicks(p.range.min, p.range.max, compact ? 2 : 3)) {
        g.append(S('line', { x1: left, x2: right, y1: px(p.y(tick)), y2: px(p.y(tick)), class: tick === 0 ? 'skc-zero' : 'skc-hair' }));
        g.append(S('text', { x: left - 5, y: px(p.y(tick) + 3.5), class: 'skc-tick', 'text-anchor': 'end' }, degrees(tick)));
      }
      g.append(S('text', { x: left, y: p.top - 4, class: 'skc-panel-name' }, name));
    }
    for (const tick of timeTicks(d.startMs, d.endMs, compact ? 4 : 8)) {
      g.append(S('line', { x1: px(x(tick.ms)), x2: px(x(tick.ms)), y1: elevation.top, y2: bottom, class: 'skc-hair' }));
      // A label right at the left end would run into "UTC".
      if (x(tick.ms) > left + 22) g.append(S('text', { x: px(x(tick.ms)), y: bottom + 12, class: 'skc-tick', 'text-anchor': 'middle' }, tick.label));
    }
    g.append(S('text', { x: left - 5, y: bottom + 12, class: 'skc-tick', 'text-anchor': 'end' }, 'UTC'));
    staticLayer.append(g);

    const stride = Math.max(1, Math.floor(Math.max(d.sun.length, d.earth.length) / Math.max(1, (right - left) * 2)));
    const line = (track: TrackSample[], p: TimePanel, get: (s: TrackSample) => number, body: Body) => {
      let path = '', pen = false;
      for (let k = 0; k < track.length; k += stride) {
        const v = get(track[k]);
        if (!Number.isFinite(v)) {
          pen = false;
          continue;
        }
        path += `${pen ? 'L' : 'M'}${px(x(track[k].timeMs))},${px(p.y(v))}`;
        pen = true;
      }
      if (path) staticLayer.append(S('path', { d: path, class: `skc-line skc-line--${body}` }));
    };
    for (const [p, get] of [[elevation, (s: TrackSample) => s.elDeg], [clearance, (s: TrackSample) => s.clearanceDeg]] as const) {
      line(d.earth, p, get, 'earth');
      line(d.sun, p, get, 'sun');
      // Where there is room, each line carries its name at its end (the legend stays).
      if (!compact) {
        const ends = ([['sun', d.sun], ['earth', d.earth]] as const).flatMap(([body, track]) => {
          const last = [...track].reverse().find((s) => Number.isFinite(get(s)));
          return last ? [{ body, y: p.y(get(last)) }] : [];
        });
        if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 11) {
          const mid = (ends[0].y + ends[1].y) / 2, first = ends[0].y <= ends[1].y ? 0 : 1;
          ends[first].y = mid - 5.5;
          ends[1 - first].y = mid + 5.5;
        }
        for (const e of ends) staticLayer.append(S('text', { x: right + 5, y: px(Math.max(p.top + 4, Math.min(p.bottom, e.y)) + 3.5), class: 'skc-end-label' }, e.body === 'sun' ? 'Sun' : 'Earth'));
      }
    }
    return { mode: 'time', left, right, top, bottom, x, elevation, clearance };
  }

  // ---------------------------------------------------------------- overlay: now, look direction, hover
  function drawOverlay(): void {
    overlayQueued = false;
    overlay.replaceChildren();
    syncExplanationTime();
    const d = data, g = geometry, a = current;
    if (!d || !g || !a || plot.hidden) return;
    const s = store.get();
    const compact = hudState().chart !== 'expanded';
    if (g.mode === 'skyline') {
      // Where the surface view looks: a band as wide as the picture, a line at its centre.
      const halfFov = Math.min(89, (Math.atan(Math.tan((s.look.fovDeg * Math.PI) / 360) * (window.innerWidth / Math.max(1, window.innerHeight))) * 180) / Math.PI);
      const centre = wrap360(s.look.azDeg);
      const perDeg = (g.right - g.left) / (g.az.max - g.az.min);
      for (const turn of [-360, 0, 360]) {
        const lo = Math.max(g.az.min, centre - halfFov + turn), hi = Math.min(g.az.max, centre + halfFov + turn);
        if (hi > lo) overlay.append(S('rect', { x: px(g.left + (lo - g.az.min) * perDeg), y: g.top, width: px((hi - lo) * perDeg), height: g.bottom - g.top, class: 'skc-look-band' }));
      }
      const lookX = g.x(centre);
      if (lookX !== null) {
        overlay.append(S('line', { x1: px(lookX), x2: px(lookX), y1: g.top, y2: g.bottom, class: 'skc-look' }));
        if (s.look.elDeg >= g.el.min && s.look.elDeg <= g.el.max) {
          const lookY = g.y(s.look.elDeg);
          overlay.append(S('path', { d: `M${px(lookX - 6)},${px(lookY)}H${px(lookX + 6)}`, class: 'skc-look' }));
        }
        overlay.append(S('path', { d: `M${px(lookX - 4)},${g.top}L${px(lookX + 4)},${g.top}L${px(lookX)},${g.top + 6}Z`, class: 'skc-look-head' }));
      }
      // The Sun and Earth at the simulated time, wherever the clock is.
      const now = nowAt(a, s.timeMs);
      for (const body of ['earth', 'sun'] as const) {
        const b = now[body];
        const at = g.x(b.bodyAzDeg);
        if (at === null || !(b.bodyElDeg >= g.el.min && b.bodyElDeg <= g.el.max)) continue;
        const py = g.y(b.bodyElDeg);
        overlay.append(S('circle', { cx: px(at), cy: px(py), r: 8.5, class: 'skc-now' }));
        overlay.append(markNode(body, at, py, 4, showing(b), ' skc-mark--now'));
        if (!compact) overlay.append(S('text', { x: px(at), y: px(py - 12), class: 'skc-now-label', 'text-anchor': at > g.right - 34 ? 'end' : at < g.left + 34 ? 'start' : 'middle' }, body === 'sun' ? 'Sun now' : 'Earth now'));
      }
      if (hover && 'sample' in hover) overlay.append(S('circle', { cx: px(hover.x), cy: px(hover.y), r: 7, class: 'skc-hover' }));
    } else {
      const dots = (t: number, cls: string) => {
        for (const [track, body] of [[d.earth, 'earth'], [d.sun, 'sun']] as const) {
          const sample = sampleAtTime(track, t);
          if (!sample) continue;
          if (Number.isFinite(sample.elDeg)) overlay.append(S('circle', { cx: px(g.x(sample.timeMs)), cy: px(g.elevation.y(sample.elDeg)), r: 4, class: `${cls} skc-dot--${body}` }));
          if (Number.isFinite(sample.clearanceDeg)) overlay.append(S('circle', { cx: px(g.x(sample.timeMs)), cy: px(g.clearance.y(sample.clearanceDeg)), r: 4, class: `${cls} skc-dot--${body}` }));
        }
      };
      if (s.timeMs >= d.startMs && s.timeMs <= d.endMs) {
        const at = g.x(s.timeMs), flip = at > g.right - 28;
        overlay.append(S('line', { x1: px(at), x2: px(at), y1: g.elevation.top, y2: g.bottom, class: 'skc-look' }));
        overlay.append(S('text', { x: px(at + (flip ? -4 : 4)), y: g.elevation.top + 9, class: 'skc-now-label', 'text-anchor': flip ? 'end' : 'start' }, 'now'));
        dots(s.timeMs, 'skc-dot');
      }
      if (hover && 'timeMs' in hover) {
        overlay.append(S('line', { x1: px(hover.x), x2: px(hover.x), y1: g.elevation.top, y2: g.bottom, class: 'skc-cross' }));
        dots(hover.timeMs, 'skc-dot skc-dot--hover');
      }
    }
  }
  const queueOverlay = () => {
    if (overlayQueued) return;
    overlayQueued = true;
    requestAnimationFrame(drawOverlay);
  };

  // ---------------------------------------------------------------- legend, table, explanation
  const key = (cls: string, text: string): HTMLElement => {
    const row = el('span', 'skc-legend-row');
    row.append(el('span', `skc-key ${cls}`), text);
    return row;
  };
  function drawLegend(compact: boolean): void {
    legend.replaceChildren(
      ...(hudState().chartMode === 'skyline'
        ? [
            key('skc-key--sun', 'Sun'),
            key('skc-key--earth', 'Earth'),
            key('skc-key--hollow', compact ? 'hidden' : 'hollow mark: hidden behind the skyline (Sun: the whole disc; Earth: its centre)'),
            // At the small size the grey area needs no key: the chart is named "Skyline".
            ...(compact ? [] : [key('skc-key--terrain', 'terrain, up to the skyline')]),
            key('skc-key--now', compact ? 'now' : 'at the simulated time'),
            key('skc-key--look', compact ? 'view' : 'where the view looks (band: its width)'),
          ]
        : [key('skc-key--sun-line', 'Sun'), key('skc-key--earth-line', 'Earth'), key('skc-key--look', compact ? 'now' : 'the simulated time')]),
    );
  }

  function drawTable(d: ChartData): void {
    const { rows, stepMs } = tableRows(d, 150);
    const table = el('table', 'skc-data');
    const every = stepMs >= 3_600_000 ? `${stepMs / 3_600_000} h` : `${Math.round(stepMs / 60_000)} min`;
    const caption = el('caption', undefined, `Sun and Earth over the mission window, every ${every}. Azimuth clockwise from north, elevation above the horizontal, clearance above the skyline, all in degrees. Times are UTC.`);
    const thead = el('thead');
    const headRow = el('tr');
    for (const name of ['Time (UTC)', 'Sun azimuth', 'Sun elevation', 'Sun clearance', 'Sun', 'Earth azimuth', 'Earth elevation', 'Earth clearance', 'Earth']) {
      const th = el('th', undefined, name);
      th.scope = 'col';
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = el('tbody');
    const cell = (text: string, numeric = true) => el('td', numeric ? 'ly-value' : undefined, text);
    const bare = (v: number, digits: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
    for (const row of rows) {
      const tr = el('tr');
      const th = el('th', 'ly-value', formatUtc(row.timeMs).replace(' UTC', ''));
      th.scope = 'row';
      tr.append(th);
      for (const s of [row.sun, row.earth]) {
        if (!s) tr.append(cell('n/a'), cell('n/a'), cell('n/a'), cell('n/a', false));
        else tr.append(cell(s.azDeg.toFixed(1)), cell(bare(s.elDeg, 2)), cell(Number.isFinite(s.clearanceDeg) ? bare(s.clearanceDeg, 2) : 'n/a'), cell(stateText(s), false));
      }
      tbody.append(tr);
    }
    table.append(caption, thead, tbody);
    tableWrap.replaceChildren(table);
  }

  /** The explanation on show, if it belongs to the scenario the app is on. */
  const liveExplanation = () => {
    const e = hudState().explanation, wanted = analysis.wanted('current');
    return e && wanted && e.scenarioId === wanted.id ? e : null;
  };
  let shownExplanation: object | null = null;
  function drawExplanation(): void {
    const e = liveExplanation();
    explain.hidden = !e;
    if (!e) {
      shownExplanation = null;
      return;
    }
    const b = e.blockage;
    explainTitle.textContent = `${b.body === 'sun' ? 'The Sun' : 'Earth'} at ${formatUtc(b.timeMs)}`;
    explainText.textContent = b.explanation;
    explainFacts.replaceChildren();
    const fact = (name: string, value: string) => explainFacts.append(el('dt', undefined, name), el('dd', undefined, value));
    if (Number.isFinite(b.ridgeDistanceM) && Number.isFinite(b.ridgeHeightM)) {
      const aboveSite = Number.isFinite(e.siteElevationM) ? Math.round(b.ridgeHeightM - e.siteElevationM) : null;
      fact('Skyline terrain', `${(b.ridgeDistanceM / 1000).toFixed(1)} km away${aboveSite === null ? '' : `, ${Math.abs(aboveSite)} m ${aboveSite >= 0 ? 'above' : 'below'} the site's ground`}`);
      if (Number.isFinite(b.ridge.lat) && Number.isFinite(b.ridge.lon)) fact('Where it is', `${Math.abs(b.ridge.lat).toFixed(3)}° ${b.ridge.lat >= 0 ? 'N' : 'S'}, ${Math.abs(b.ridge.lon).toFixed(3)}° ${b.ridge.lon >= 0 ? 'E' : 'W'}`);
    }
    if (b.body === 'earth') fact('Note', 'Geometric line of sight to Earth\'s centre, not a radio link.');
    explainTurn.onclick = () => void runAction('lookAt', { azDeg: wrap360(b.bodyAzDeg), elDeg: clampEl(Number.isFinite(b.skylineElDeg) ? Math.max(b.bodyElDeg, b.skylineElDeg) : b.bodyElDeg) });
    explainGo.onclick = () => void runAction('setTime', { utc: utcParam(b.timeMs) });
    explainNow.onclick = () => void runAction('explainBlockage', { body: b.body });
    syncExplanationTime();
    // A new explanation must be in sight even where the panel has to scroll.
    if (shownExplanation !== e) {
      shownExplanation = e;
      // Only the panel is scrolled (scrollIntoView could also move the page under the fixed layout).
      requestAnimationFrame(() => {
        const over = explain.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom + 10;
        if (over > 0) panel.scrollTop += over;
      });
    }
  }
  /** An explanation is for one instant: once the clock has left it, say so and offer both ways back. */
  function syncExplanationTime(): void {
    const e = liveExplanation();
    if (!e) return;
    const moved = Math.abs(store.get().timeMs - e.blockage.timeMs) > 30_000;
    explainStale.hidden = explainGo.hidden = explainNow.hidden = !moved;
  }

  // ---------------------------------------------------------------- render
  function render(): void {
    renderQueued = false;
    const h = hudState();
    const inSurface = store.get().view === 'surface';
    const chartOn = inSurface && h.chart !== 'hidden';
    const explaining = inSurface && liveExplanation() !== null;
    panel.hidden = !chartOn && !explaining;
    if (panel.hidden) {
      tip.hidden = true;
      geometry = null;
      requestHudLayout();
      return;
    }
    const compact = h.chart !== 'expanded';
    panel.dataset.size = compact ? 'compact' : 'expanded';
    panel.dataset.mode = h.chartMode;

    // Chart hidden but an explanation asked for: the panel carries the explanation alone.
    head.hidden = !chartOn;
    drawExplanation();
    const message = chartOn ? readAnalysis() : null;
    const d = chartOn ? data : null;
    title.textContent = h.chartMode === 'skyline' ? 'Skyline, Sun and Earth' : 'Elevation and clearance over time';
    modeSkyline.setAttribute('aria-pressed', String(h.chartMode === 'skyline'));
    modeTime.setAttribute('aria-pressed', String(h.chartMode === 'time'));
    fit.hidden = h.chartMode !== 'skyline' || h.chartTable;
    fit.textContent = h.chartFit === 'full' ? 'Zoom to the tracks' : 'Whole compass';
    fit.title = h.chartFit === 'full' ? 'Show only the azimuths the Sun and Earth cross during the mission window' : 'Show all azimuths, 0 to 360 degrees';
    asTable.textContent = h.chartTable ? 'Chart' : 'Table';
    asTable.setAttribute('aria-pressed', String(h.chartTable));
    size.textContent = compact ? 'Expand' : 'Shrink';
    size.setAttribute('aria-expanded', String(!compact));

    const sc = analysis.wanted('current');
    subtitle.textContent =
      d && sc
        ? `${sc.site.name} · mission window from ${formatUtc(d.startMs)} for ${sc.durationH} h, analysed every ${Math.round(d.stepMs / 60_000)} min · observer ${sc.mastHeightM} m above the ground · azimuth clockwise from north, elevation above the horizontal, no atmosphere`
        : '';
    subtitle.hidden = !chartOn || !subtitle.textContent || compact;
    status.hidden = message === null;
    status.textContent = message ?? '';
    const showTable = Boolean(d) && h.chartTable;
    const showPlot = Boolean(d && d.skyline) && !h.chartTable && message === null;
    plot.hidden = legend.hidden = !showPlot;
    help.hidden = !showPlot || compact;
    tableWrap.hidden = !showTable;

    if (showTable && d) drawTable(d);
    else tableWrap.replaceChildren();
    if (showPlot && d) {
      const w = Math.max(220, Math.floor(plot.clientWidth));
      const hh = compact ? (h.chartMode === 'time' ? 156 : 132) : h.chartMode === 'time' ? 316 : 268;
      svg.setAttribute('viewBox', `0 0 ${w} ${hh}`);
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(hh));
      staticLayer.replaceChildren();
      geometry = h.chartMode === 'skyline' ? drawSkyline(d, w, hh, compact) : drawTime(d, w, hh, compact);
      const sky = d.skyline!;
      const up = (track: TrackSample[]) => (track.length ? Math.round((track.filter((s) => s.up).length / track.length) * 100) : 0);
      svg.setAttribute(
        'aria-label',
        h.chartMode === 'skyline'
          ? `Skyline around the site, between ${sky.minDeg.toFixed(2)} and ${sky.maxDeg.toFixed(2)} degrees above the horizontal. Over the mission window some of the Sun's disc is above it in ${up(d.sun)} percent of the samples, and Earth's centre in ${up(d.earth)} percent. The table gives every value.`
          : 'Elevation of the Sun and Earth, and their clearance above the skyline, over the mission window. The table gives every value.',
      );
      plot.setAttribute('aria-label', `${title.textContent}. Left and right arrows move the clock by one sample, with Shift by an hour. Home and End go to the start and end of the mission window. Enter turns the view to the Sun, E to Earth. X explains what hides the Sun, Escape closes the explanation.`);
      help.textContent =
        h.chartMode === 'skyline'
          ? 'Click a mark to move the clock there and turn the view to it; a hollow mark also explains what hides it. Click anywhere else to look that way. With the chart focused: ← → move the clock, Home and End jump to the ends of the window, Enter faces the Sun, E faces Earth, X explains what hides the Sun.'
          : 'Click or drag to move the clock; clicking where a line is below 0° clearance also explains what hides that body. With the chart focused: ← → move the clock, Home and End jump to the ends of the window.';
      drawLegend(compact);
      drawOverlay();
    } else {
      geometry = null;
      tip.hidden = true;
    }
    requestHudLayout();
  }
  const queueRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  };

  // ---------------------------------------------------------------- pointer and keyboard
  const pointerPos = (e: PointerEvent) => {
    const box = svg.getBoundingClientRect();
    return { x: e.clientX - box.left, y: e.clientY - box.top };
  };
  const nearestMark = (p: { x: number; y: number }, reach: number): Placed | null => {
    let best: Placed | null = null, bestD = reach;
    if (geometry?.mode !== 'skyline') return null;
    for (const m of geometry.marks) {
      const dist = Math.hypot(m.x - p.x, m.y - p.y);
      // On a tie the Sun wins: it is drawn on top.
      if (dist < bestD || (dist === bestD && m.sample.body === 'sun')) {
        bestD = dist;
        best = m;
      }
    }
    return best;
  };
  const tipRow = (cls: string, value: string, name: string) => {
    const row = el('div', 'skc-tip-row');
    row.append(el('span', `skc-key ${cls}`), el('strong', 'ly-value', value), el('span', 'skc-tip-name', name));
    return row;
  };
  const showTip = (e: PointerEvent, heading: string, rows: HTMLElement[]) => {
    tip.replaceChildren(el('div', 'skc-tip-head', heading), ...rows);
    tip.hidden = false;
    tip.style.left = `${Math.max(0, Math.min(e.clientX, window.innerWidth - tip.offsetWidth - 22))}px`;
    tip.style.top = `${Math.max(0, Math.min(e.clientY, window.innerHeight - tip.offsetHeight - 22))}px`;
  };
  /** Time mode: the samples at a pointer position, and which body's line the pointer is on (if any). */
  const timePick = (g: TimeGeometry, d: ChartData, p: { x: number; y: number }) => {
    const t = d.startMs + ((Math.max(g.left, Math.min(g.right, p.x)) - g.left) / Math.max(1, g.right - g.left)) * (d.endMs - d.startMs);
    const sun = sampleAtTime(d.sun, t), earth = sampleAtTime(d.earth, t);
    const at = sun ?? earth;
    if (!at) return null;
    // The line under the pointer, in the panel under the pointer.
    const panelUnder = p.y <= g.elevation.bottom + 6 ? g.elevation : g.clearance;
    const value = (s: TrackSample) => (panelUnder === g.elevation ? s.elDeg : s.clearanceDeg);
    let on: TrackSample | null = null, reach = 24;
    for (const s of [sun, earth]) {
      if (!s || !Number.isFinite(value(s))) continue;
      const dist = Math.abs(panelUnder.y(value(s)) - p.y);
      if (dist < reach) {
        reach = dist;
        on = s;
      }
    }
    return { timeMs: at.timeMs, index: at.index, x: g.x(at.timeMs), sun, earth, on };
  };

  let dragging = false, moved = false, lastChosen = -1, downAt = { x: 0, y: 0 };
  const chooseMark = (s: TrackSample) => {
    void runAction('setTime', { utc: utcParam(s.timeMs) }).then((done) => {
      if (!done.ok || store.get().view !== 'surface') return;
      // A hidden body is behind terrain: look at the skyline in front of it rather than into the ground.
      const skyline = data ? skylineAtAz(data.skyline, s.azDeg) : NaN;
      void runAction('lookAt', { azDeg: wrap360(s.azDeg), elDeg: clampEl(Number.isFinite(skyline) ? Math.max(s.elDeg, skyline) : s.elDeg) });
      if (!s.up) void runAction('explainBlockage', { body: s.body, utc: utcParam(s.timeMs) });
    });
  };
  plot.addEventListener('pointermove', (e) => {
    const g = geometry, d = data;
    if (!g || !d) return;
    const p = pointerPos(e);
    if (dragging && Math.hypot(p.x - downAt.x, p.y - downAt.y) > 4) moved = true;
    if (g.mode === 'skyline') {
      const m = nearestMark(p, dragging && moved ? 60 : 24);
      hover = m;
      if (m) {
        const s = m.sample;
        showTip(e, `${s.body === 'sun' ? 'Sun' : 'Earth'} · ${formatUtc(s.timeMs)}`, [
          tipRow(`skc-key--${s.body}${s.up ? '' : ' skc-key--down'}`, `${s.azDeg.toFixed(1)}°, ${signed(s.elDeg)}`, 'azimuth, elevation'),
          tipRow('skc-key--terrain', Number.isFinite(s.clearanceDeg) ? signed(s.clearanceDeg) : 'n/a', 'centre against the skyline'),
          el('div', 'skc-tip-state', s.up ? (s.body === 'earth' ? 'Centre in line of sight' : s.visible >= 0.995 ? 'Whole disc above the skyline' : `${Math.round(s.visible * 100)} % of the disc showing`) : 'Hidden. Click to see what hides it.'),
        ]);
        if (dragging && moved && s.index !== lastChosen) {
          lastChosen = s.index;
          void runAction('setTime', { utc: utcParam(s.timeMs) });
        }
      } else tip.hidden = true;
    } else {
      const pick = timePick(g, d, p);
      if (!pick) return;
      hover = { x: pick.x, timeMs: pick.timeMs };
      const rows: HTMLElement[] = [];
      for (const s of [pick.sun, pick.earth]) {
        if (s) rows.push(tipRow(`skc-key--${s.body}-line`, `${signed(s.elDeg)} · ${Number.isFinite(s.clearanceDeg) ? signed(s.clearanceDeg) : 'n/a'}`, `${s.body === 'sun' ? 'Sun' : 'Earth'}: elevation · clearance (${stateText(s)})`));
      }
      showTip(e, formatUtc(pick.timeMs), rows);
      if (dragging && moved && pick.index !== lastChosen) {
        lastChosen = pick.index;
        void runAction('setTime', { utc: utcParam(pick.timeMs) });
      }
    }
    queueOverlay();
  });
  const leave = () => {
    hover = null;
    tip.hidden = true;
    queueOverlay();
  };
  plot.addEventListener('pointerleave', () => !dragging && leave());
  plot.addEventListener('pointercancel', () => {
    dragging = false;
    leave();
  });
  plot.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    lastChosen = -1;
    downAt = pointerPos(e);
    plot.setPointerCapture(e.pointerId);
  });
  plot.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    // A mouse click must not leave the keyboard with the chart: the arrow keys go back to the view.
    if (document.activeElement === plot && !plot.matches(':focus-visible')) plot.blur();
    const g = geometry, d = data;
    // A click moves the clock and may open the explanation, which shifts the chart under the pointer: drop the tooltip until the pointer moves again.
    if (e.pointerType !== 'mouse' || !moved) leave();
    if (!g || !d || moved) return;
    const p = pointerPos(e);
    if (g.mode === 'skyline') {
      const m = nearestMark(p, 24);
      if (m) chooseMark(m.sample);
      else if (p.x >= g.left && p.x <= g.right && p.y >= g.top && p.y <= g.bottom) {
        // Empty part of the chart: look that way.
        const az = g.az.min + ((p.x - g.left) / (g.right - g.left)) * (g.az.max - g.az.min);
        const elev = g.el.min + ((g.bottom - p.y) / (g.bottom - g.top)) * (g.el.max - g.el.min);
        void runAction('lookAt', { azDeg: wrap360(az), elDeg: clampEl(elev) });
      }
    } else {
      const pick = timePick(g, d, p);
      if (!pick) return;
      void runAction('setTime', { utc: utcParam(pick.timeMs) });
      if (pick.on && !pick.on.up) void runAction('explainBlockage', { body: pick.on.body, utc: utcParam(pick.timeMs) });
    }
  });
  plot.addEventListener('keydown', (e) => {
    const d = data;
    if (!d || e.ctrlKey || e.metaKey || e.altKey) return;
    const stepH = e.shiftKey ? 1 : d.stepMs / 3_600_000;
    let handled = true;
    if (e.key === 'ArrowRight') void runAction('setTime', { offsetHours: stepH });
    else if (e.key === 'ArrowLeft') void runAction('setTime', { offsetHours: -stepH });
    else if (e.key === 'Home') void runAction('setTime', { utc: utcParam(d.startMs) });
    else if (e.key === 'End') void runAction('setTime', { utc: utcParam(d.endMs) });
    else if (e.key === 'Enter') void runAction('lookAtBody', { body: 'sun' });
    else if (e.key === 'e' || e.key === 'E') void runAction('lookAtBody', { body: 'earth' });
    else if (e.key === 'x' || e.key === 'X') void runAction('explainBlockage', { body: 'sun' });
    else if (e.key === 'Escape' && hudState().explanation) void runAction('dismissBlockageExplanation');
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  // ---------------------------------------------------------------- wiring
  onHudState(queueRender);
  analysis.subscribe((slot) => {
    if (slot !== 'current') return;
    // An explanation belongs to one scenario: another site or window drops it.
    const e = hudState().explanation, wanted = analysis.wanted('current');
    if (e && (!wanted || wanted.id !== e.scenarioId)) setHudState({ explanation: null });
    queueRender();
  });
  store.subscribe(['view', 'site'], queueRender);
  store.subscribe(['timeMs', 'look'], () => {
    if (!panel.hidden && store.get().view === 'surface') queueOverlay();
  });
  // The drawing is sized in pixels: follow the plot's width (window size, expanding).
  let lastWidth = 0;
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const w = Math.floor(plot.clientWidth);
      if (w && w !== lastWidth) {
        lastWidth = w;
        queueRender();
      }
    }).observe(plot);
  }
  window.addEventListener('resize', queueRender);
  render();
}
