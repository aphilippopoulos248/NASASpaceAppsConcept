// The "Outlook" tab: the seasonal outlook of outlook() for the scenario on screen (or A or B).
// A compact chart of sunlight and Earth's centre in view per lunar day across the span, with
// the best and worst arrival marked; the planned, best and worst arrival in figures; what a slip
// costs; the headline sentences; and the chart's values as a table. Controls run showOutlook.
import type { Outlook, OutlookRow } from '../../analysis/types';
import { analysis } from '../../core/analysisStore';
import { describeScenario, spanText } from '../../core/scenario';
import { store } from '../../core/store';
import { formatUtc } from '../../core/time';
import { el } from '../dom';
import { hoursText, pctText, signedText } from './format';
import { rangeOf, slipRows } from './outlookView';
import { TABLE_SLOTS, type PanelStore, type TableSlot } from './state';
import type { TabKit } from './widgets';

const SVG = 'http://www.w3.org/2000/svg';
const SLOT_TEXT: Record<TableSlot, string> = { current: 'On screen', A: 'A', B: 'B' };
const MONTH_CHOICES = [3, 6, 12, 24] as const;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const day = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
};

export function mountOutlookTab(root: HTMLElement, panel: PanelStore, kit: TabKit): { render(): void } {
  const { act, button, status } = kit;

  // ---------- controls ----------
  const pick = el('div', 'ly-seg cmp-slotpick');
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', 'Whose scenario the outlook is for');
  const pickButtons = new Map<TableSlot, HTMLButtonElement>();
  for (const slot of TABLE_SLOTS) {
    const b = button(SLOT_TEXT[slot], 'ly-btn ly-btn--small', () => void act('showOutlook', { slot }, (r) => `Outlook for ${r.scenario.label}: ${r.lunarDays.length} lunar days.`));
    b.setAttribute('aria-label', slot === 'current' ? 'Outlook for the scenario on screen' : `Outlook for scenario ${slot}`);
    pick.append(b);
    pickButtons.set(slot, b);
  }
  const monthsId = `cmp-months-${Math.random().toString(36).slice(2, 8)}`;
  const monthsLabel = el('label', 'ly-label', 'Span');
  monthsLabel.htmlFor = monthsId;
  const months = el('select', 'ly-select cmp-scope');
  months.id = monthsId;
  for (const m of MONTH_CHOICES) months.append(new Option(`${m} lunar months`, String(m)));
  months.addEventListener('change', () => void act('showOutlook', { months: Number(months.value) }, (r) => `Outlook over ${r.months} lunar months.`));
  const refresh = button('Show the outlook', 'ly-btn ly-btn--small ly-btn--primary', () => void act('showOutlook', {}, (r) => `Outlook for ${r.scenario.label}: ${r.lunarDays.length} lunar days.`));
  const controls = el('div', 'cmp-tablehead');
  const right = el('div', 'cmp-buttons cmp-export');
  right.append(monthsLabel, months, refresh);
  controls.append(pick, right);

  const which = el('p', 'cmp-onscreen');
  const state = el('p', 'cmp-state');
  state.setAttribute('role', 'status');
  const stale = el('p', 'ly-note cmp-stale');

  // ---------- chart ----------
  const figure = el('figure', 'cmp-chart');
  const caption = el('figcaption', 'cmp-chartcaption');
  const legend = el('div', 'cmp-chartlegend');
  const key = (cls: string, text: string) => {
    const item = el('span', 'cmp-key');
    const mark = el('span', `cmp-keymark ${cls}`);
    mark.setAttribute('aria-hidden', 'true');
    item.append(mark, document.createTextNode(text));
    return item;
  };
  legend.append(key('is-sun', 'Sunlight'), key('is-earth', "Earth's centre in view"), key('is-arrival', 'Best and worst arrival'));
  const plot = el('div', 'cmp-plot');
  plot.tabIndex = 0;
  plot.setAttribute('role', 'group');
  const readout = el('div', 'ly-tooltip cmp-readout');
  readout.hidden = true;
  const live = el('div', 'ly-visually-hidden');
  live.setAttribute('aria-live', 'polite');
  plot.append(readout, live);
  figure.append(caption, legend, plot);

  // ---------- arrivals, slips, words ----------
  const arrivals = el('dl', 'cmp-arrivals');
  const slipsTitle = el('h3', 'ly-section-title', 'Cost of a slip');
  const slips = el('div', 'cmp-ntable');
  slips.setAttribute('role', 'table');
  slips.setAttribute('aria-label', 'What a later arrival changes, against the planned arrival');
  const highlights = el('ul', 'cmp-highlights');
  const tableMore = el('details', 'cmp-more');
  const tableSummary = el('summary', undefined, 'The chart as a table');
  const table = el('div', 'cmp-ntable');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Sunlight and Earth\'s centre in view per lunar day');
  tableMore.append(tableSummary, table);
  const basisMore = el('details', 'cmp-more');
  const basisList = el('ul', 'cmp-assumelist');
  basisMore.append(el('summary', undefined, 'How the outlook is computed'), basisList);
  const result = el('div', 'cmp-outlook');
  result.append(figure, el('h3', 'ly-section-title', 'Arrival'), arrivals, slipsTitle, slips, el('h3', 'ly-section-title', 'In words'), highlights, tableMore, basisMore);

  root.append(controls, status, which, state, stale, result);

  // ---------- drawing ----------
  let shown: Outlook | null = null;
  let focusIndex = -1;
  let geometry: { x: (t: number) => number; y: (v: number) => number; rows: OutlookRow[]; left: number; right: number; top: number; bottom: number } | null = null;

  const mid = (r: OutlookRow) => (r.startMs + r.endMs) / 2;

  const draw = () => {
    plot.querySelector('svg')?.remove();
    const o = shown;
    if (!o || !o.rows.length) return;
    const width = Math.max(280, Math.round(plot.clientWidth || 600));
    const narrow = width < 520;
    const height = narrow ? 200 : 230;
    const left = 40, right = width - (narrow ? 12 : 104), top = 14, bottom = height - 40;
    const t0 = o.startMs, t1 = o.endMs;
    const x = (t: number) => left + ((t - t0) / (t1 - t0)) * (right - left);
    const y = (v: number) => bottom - (Math.max(0, Math.min(100, v)) / 100) * (bottom - top);
    geometry = { x, y, rows: o.rows, left, right, top, bottom };
    const s = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'cmp-svg', 'aria-hidden': 'true' });
    // Grid and the one axis: percent of each lunar day.
    for (const v of [0, 25, 50, 75, 100]) {
      s.append(svg('line', { x1: left, x2: right, y1: y(v), y2: y(v), class: 'cmp-grid' }));
      const t = svg('text', { x: left - 6, y: y(v) + 4, class: 'cmp-tick', 'text-anchor': 'end' });
      t.textContent = `${v}`;
      s.append(t);
    }
    const unit = svg('text', { x: left - 6, y: top - 4, class: 'cmp-tick', 'text-anchor': 'end' });
    unit.textContent = '%';
    s.append(unit);
    // Month ticks along the bottom, at the first of each month (thinned on a narrow chart).
    const first = new Date(t0);
    let m = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    const spanMonths = (t1 - t0) / (30.44 * 86_400_000);
    const every = spanMonths > 14 ? (narrow ? 4 : 2) : narrow ? 2 : 1;
    let k = 0;
    while (m < t1) {
      if (k % every === 0) {
        s.append(svg('line', { x1: x(m), x2: x(m), y1: bottom, y2: bottom + 4, class: 'cmp-axis' }));
        const d = new Date(m);
        const t = svg('text', { x: x(m), y: bottom + 16, class: 'cmp-tick', 'text-anchor': 'middle' });
        t.textContent = d.getUTCMonth() === 0 || k === 0 ? `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}` : MONTH[d.getUTCMonth()];
        s.append(t);
      }
      k++;
      const d = new Date(m);
      m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
    s.append(svg('line', { x1: left, x2: right, y1: bottom, y2: bottom, class: 'cmp-axis' }));
    // Best and worst arrival of the span: thin rules with a label at the top.
    for (const [a, label] of [[o.best, 'best'], [o.worst, 'worst']] as const) {
      if (!a) continue;
      s.append(svg('line', { x1: x(a.startMs), x2: x(a.startMs), y1: top, y2: bottom, class: 'cmp-arrival' }));
      const t = svg('text', { x: x(a.startMs) + 3, y: bottom + 30, class: 'cmp-tick cmp-arrivaltext', 'text-anchor': x(a.startMs) > right - 40 ? 'end' : 'start' });
      t.textContent = `${label} arrival`;
      s.append(t);
    }
    // The two series: 2 px lines, markers with a ring of the surface colour; a circle for the Sun, a square for Earth.
    const line = (key: 'illuminationPct' | 'earthVisiblePct', cls: string) => {
      const pts = o.rows.filter((r) => Number.isFinite(r[key]));
      if (pts.length > 1) s.append(svg('polyline', { points: pts.map((r) => `${x(mid(r)).toFixed(1)},${y(r[key]).toFixed(1)}`).join(' '), class: `cmp-line ${cls}` }));
      for (const r of pts) {
        if (key === 'illuminationPct') s.append(svg('circle', { cx: x(mid(r)), cy: y(r[key]), r: 4, class: `cmp-dot ${cls}` }));
        else s.append(svg('rect', { x: x(mid(r)) - 4, y: y(r[key]) - 4, width: 8, height: 8, class: `cmp-dot ${cls}` }));
      }
      return pts;
    };
    const sun = line('illuminationPct', 'is-sun');
    const earth = line('earthVisiblePct', 'is-earth');
    // Direct labels at the right end, kept apart (and dropped on a narrow chart: the legend names them).
    if (!narrow && sun.length && earth.length) {
      let ys = y(sun[sun.length - 1].illuminationPct), ye = y(earth[earth.length - 1].earthVisiblePct);
      if (Math.abs(ys - ye) < 14) {
        const c = (ys + ye) / 2;
        [ys, ye] = ys <= ye ? [c - 7, c + 7] : [c + 7, c - 7];
      }
      for (const [yy, text] of [[ys, 'Sunlight'], [ye, "Earth's centre"]] as const) {
        const t = svg('text', { x: right + 8, y: yy + 4, class: 'cmp-direct' });
        t.textContent = text;
        s.append(t);
      }
    }
    // The crosshair of the lunar day under the pointer or the keyboard.
    if (focusIndex >= 0 && o.rows[focusIndex]) {
      const r = o.rows[focusIndex];
      s.append(svg('line', { x1: x(mid(r)), x2: x(mid(r)), y1: top, y2: bottom, class: 'cmp-cross' }));
    }
    plot.prepend(s);
  };

  const readoutText = (r: OutlookRow) =>
    `Lunar day ${r.index}, ${day(r.startMs)} to ${day(r.endMs)} ${new Date(r.endMs).getUTCFullYear()}: sunlight ${pctText(r.illuminationPct)}, Earth's centre in view ${pctText(r.earthVisiblePct)}, longest darkness ${r.darknessComplete ? '' : 'at least '}${hoursText(r.longestDarknessH)}.`;

  const focusRow = (i: number, announce: boolean) => {
    const o = shown;
    if (!o || !geometry || !o.rows.length) return;
    focusIndex = Math.max(0, Math.min(o.rows.length - 1, i));
    draw();
    const r = o.rows[focusIndex];
    readout.hidden = false;
    readout.replaceChildren(el('strong', undefined, `${pctText(r.illuminationPct)} sunlight · ${pctText(r.earthVisiblePct)} Earth's centre`), el('div', 'ly-note', `Lunar day ${r.index}: ${day(r.startMs)} to ${day(r.endMs)}`));
    const px = geometry.x(mid(r));
    readout.style.left = `${Math.min(px + 12, plot.clientWidth - 220)}px`;
    readout.style.top = `${geometry.top}px`;
    if (announce) live.textContent = readoutText(r);
  };
  const nearest = (clientX: number) => {
    if (!shown || !geometry) return -1;
    const box = plot.getBoundingClientRect();
    const px = clientX - box.left;
    let best = 0, dist = Infinity;
    shown.rows.forEach((r, i) => {
      const d = Math.abs(geometry!.x(mid(r)) - px);
      if (d < dist) { dist = d; best = i; }
    });
    return best;
  };
  plot.addEventListener('pointermove', (e) => focusRow(nearest(e.clientX), false));
  plot.addEventListener('pointerleave', () => {
    if (document.activeElement === plot) return;
    focusIndex = -1;
    readout.hidden = true;
    draw();
  });
  plot.addEventListener('focus', () => focusRow(focusIndex >= 0 ? focusIndex : 0, true));
  plot.addEventListener('blur', () => {
    focusIndex = -1;
    readout.hidden = true;
    draw();
  });
  plot.addEventListener('keydown', (e) => {
    const n = shown?.rows.length ?? 0;
    const to = e.key === 'ArrowRight' ? focusIndex + 1 : e.key === 'ArrowLeft' ? focusIndex - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    focusRow(to, true);
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => shown && draw()).observe(plot);

  const cell = (role: string, className: string, label: string, content: string) => {
    const c = el('div', className, content);
    c.setAttribute('role', role);
    c.dataset.label = label;
    return c;
  };
  const tableOf = (target: HTMLElement, columns: readonly string[], rows: string[][], rowClass: string) => {
    const head = el('div', `${rowClass} cmp-ohead`);
    head.setAttribute('role', 'row');
    head.append(...columns.map((c) => cell('columnheader', 'cmp-ntd', c, c)));
    target.replaceChildren(
      head,
      ...rows.map((values) => {
        const tr = el('div', rowClass);
        tr.setAttribute('role', 'row');
        tr.append(...values.map((v, i) => cell(i === 0 ? 'rowheader' : 'cell', `cmp-ntd${i === 0 ? ' cmp-nname' : ' ly-value'}`, columns[i], v)));
        return tr;
      }),
    );
  };

  const renderValue = (o: Outlook) => {
    const sun = rangeOf(o.rows.map((r) => r.illuminationPct)), earth = rangeOf(o.rows.map((r) => r.earthVisiblePct));
    caption.textContent = `Sunlight and Earth's centre in view per lunar day, ${o.rows.length} lunar days from ${formatUtc(o.startMs)}, at ${describeScenario(o.scenario).split(', arrival')[0]}`;
    plot.setAttribute(
      'aria-label',
      `Chart of ${o.rows.length} lunar days: sunlight from ${sun ? `${pctText(sun.min)} to ${pctText(sun.max)}` : 'not available'}, Earth's centre in view from ${earth ? `${pctText(earth.min)} to ${pctText(earth.max)}` : 'not available'}. Use the left and right arrow keys to read each lunar day; the same values are in the table below the chart.`,
    );
    draw();

    // Planned, best, worst.
    const mission = spanText(o.arrivals.missionH, true);
    arrivals.replaceChildren();
    for (const [label, a] of [['Planned', o.planned], ['Best in the span', o.best], ['Worst in the span', o.worst]] as const) {
      const dd = el('dd');
      dd.textContent = a
        ? `${formatUtc(a.startMs)}: score ${a.score.toFixed(1)}; sunlight ${pctText(a.illuminationPct)}, Earth's centre in view ${pctText(a.earthVisiblePct)}, longest darkness ${hoursText(a.longestDarknessH)}`
        : 'not available';
      arrivals.append(el('dt', undefined, label), dd);
    }
    arrivals.setAttribute('aria-label', `Arrival for a ${mission} mission`);
    slipsTitle.textContent = `Cost of a slip (a ${mission} mission)`;

    const rows = slipRows(o);
    if (rows.length) {
      tableOf(
        slips,
        ['Arrival', 'Score', 'Sunlight', "Earth's centre in view", 'Longest darkness'],
        rows.map((s) => [
          `${s.slipDays} day${s.slipDays === 1 ? '' : 's'} late: ${formatUtc(s.option.startMs)}`,
          `${s.option.score.toFixed(1)} (${signedText(s.scoreChange)})`,
          `${pctText(s.option.illuminationPct)} (${signedText(s.illuminationChange)} points)`,
          `${pctText(s.option.earthVisiblePct)} (${signedText(s.earthChange)} points)`,
          `${hoursText(s.option.longestDarknessH)} (${signedText(s.darknessChange)} h)`,
        ]),
        'cmp-orow cmp-orow--slip',
      );
    } else slips.replaceChildren(el('p', 'ly-unavailable', 'Not available: no slip fits in this span.'));

    highlights.replaceChildren(...o.highlights.map((h) => el('li', undefined, h)));
    tableOf(
      table,
      ['Lunar day', 'Sunlight', 'Any Sun', "Earth's centre in view", 'Longest darkness', 'Longest Earth gap'],
      o.rows.map((r) => [
        `${r.index}: ${formatUtc(r.startMs).replace(' UTC', '')} to ${formatUtc(r.endMs)}`,
        pctText(r.illuminationPct),
        pctText(r.sunAnyPct),
        pctText(r.earthVisiblePct),
        `${r.darknessComplete ? '' : 'at least '}${hoursText(r.longestDarknessH)}`,
        `${r.earthGapComplete ? '' : 'at least '}${hoursText(r.longestEarthGapH)}`,
      ]),
      'cmp-orow',
    );
    tableSummary.textContent = `The chart as a table (${o.rows.length} lunar days)`;
    basisList.replaceChildren(...[...o.assumptions, ...o.warnings.map((w) => `Warning: ${w}`)].map((t) => el('li', undefined, t)));
  };

  const render = () => {
    const p = panel.get();
    const s = store.get();
    for (const [k, b] of pickButtons) {
      b.setAttribute('aria-pressed', String(k === p.outlookSlot));
      b.disabled = k === 'A' ? !s.compareA : k === 'B' ? !s.compareB : !s.site;
    }
    if (document.activeElement !== months) months.value = String(MONTH_CHOICES.includes(p.outlookMonths as (typeof MONTH_CHOICES)[number]) ? p.outlookMonths : 12);
    const want = analysis.wanted(p.outlookSlot);
    refresh.disabled = !want;
    const st = p.outlook;
    const whose = p.outlookSlot === 'current' ? 'The scenario on screen' : `Scenario ${p.outlookSlot}`;
    which.replaceChildren(el('span', 'ly-label', `${whose}: `), document.createTextNode(want ? describeScenario(want) : 'none'));
    state.classList.toggle('is-error', st.state === 'error');
    state.textContent =
      st.state === 'idle'
        ? 'Sunlight and Earth\'s centre in view for every lunar day of the coming months from the arrival, and which arrival dates suit a mission of this length. Press "Show the outlook".'
        : st.state === 'loading'
          ? `Computing ${st.months} lunar months of sunlight and Earth visibility at ${st.scenario.site.name}…`
          : st.state === 'error'
            ? `The outlook is not available: ${st.error}`
            : '';
    stale.textContent = st.state === 'ready' && want && st.scenario.id !== want.id ? `This outlook is for ${describeScenario(st.scenario)}. The scenario has changed since: press "Show the outlook" to update it.` : '';
    const value = st.state === 'ready' ? st.value : null;
    result.hidden = !value;
    // Keep the last chart while a new outlook is computed for the same site (no flash).
    result.classList.toggle('is-refreshing', st.state === 'loading');
    if (st.state === 'loading' && shown) {
      result.hidden = false;
      return;
    }
    if (value && value !== shown) {
      shown = value;
      focusIndex = -1;
      readout.hidden = true;
      renderValue(value);
    } else if (!value) shown = null;
  };

  return { render };
}
