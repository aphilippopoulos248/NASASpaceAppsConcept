// The "Nearby sites" tab: scan settings, progress, and the ranked list of alternatives around
// the site on screen. Choosing a row pins that candidate, or pins it and loads it as B.
// Everything shown is the scan's own result from the analysis store; the controls run the
// rankNearby and selectCandidate actions.
import type { NearbyCandidate } from '../../analysis/types';
import { analysis } from '../../core/analysisStore';
import { describeScenario, scenarioFromState } from '../../core/scenario';
import { store } from '../../core/store';
import { el } from '../dom';
import { MAX_NEARBY_CANDIDATES, nearbyPointCount } from './actions';
import { bearingText, coordsText, degText, distanceText, hoursText, NOT_AVAILABLE, pctText } from './format';
import { nearbyView, offsetName } from './nearbyView';
import type { PanelStore } from './state';
import type { TabKit } from './widgets';

/** Rows drawn at most; a scan can rank up to two thousand points. */
const MAX_ROWS = 200;

const COLUMNS = ['Rank', 'Where', 'Distance, bearing', 'Slope', 'Sunlight', 'Longest darkness', "Earth's centre in view", 'Longest Earth gap', 'Score', 'Choose'] as const;

export function mountNearbyTab(root: HTMLElement, panel: PanelStore, kit: TabKit): { render(): void } {
  const { act, numberField, button, status } = kit;

  const around = el('p', 'cmp-onscreen');
  const radius = numberField('Radius', 'm', { min: 50, max: 50_000, step: 100 });
  const spacing = numberField('Spacing', 'm', { min: 10, max: 10_000, step: 10 });
  const slope = numberField('Slope at most', '°', { min: 0, max: 45, step: 0.5 }, async (v) => (v === null ? { ok: false, error: 'Give a number.' } : kit.run('setSlopeLimit', { degrees: v })));
  const scan = button('Scan nearby sites', 'ly-btn ly-btn--small ly-btn--primary', () => {
    const r = radius.read(), s = spacing.read(), limit = slope.read();
    if (r === null || s === null || limit === null) return kit.complain('Give the radius, the spacing and the slope limit as numbers.');
    void act('rankNearby', { radiusM: r, spacingM: s, slopeLimitDeg: limit }, (res) => `Scanned ${res.scanned} points around ${res.scenario.site.name}: ${res.rankedCount} ranked alternative${res.rankedCount === 1 ? '' : 's'}.`);
  });
  const settings = el('div', 'cmp-req cmp-scan');
  settings.setAttribute('role', 'group');
  settings.setAttribute('aria-label', 'Scan settings');
  const scanWrap = el('div', 'cmp-field');
  scanWrap.append(scan);
  settings.append(radius.wrap, spacing.wrap, slope.wrap, scanWrap);
  const count = el('p', 'ly-note');
  for (const f of [radius, spacing, slope]) f.input.addEventListener('keydown', (e) => e.key === 'Enter' && scan.click());
  for (const f of [radius, spacing]) f.input.addEventListener('input', () => renderCount());

  const progress = el('div', 'cmp-progress');
  progress.setAttribute('role', 'status');
  const bar = el('progress');
  const progressText = el('span');
  progress.append(bar, progressText);
  const state = el('p', 'cmp-state');
  state.setAttribute('role', 'status');

  const result = el('div', 'cmp-nearbyresult');
  const summary = el('p', 'cmp-nearbysummary');
  const table = el('div', 'cmp-ntable');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Ranked nearby alternatives');
  const legend = el('p', 'ly-note', 'Ranked by score: the mean of sunlight % and Earth\'s-centre-in-view % over the mission window; higher is better. Distance and bearing are from the scanned site. Earth in view means geometric line of sight to Earth\'s centre, not a radio link.');
  const basis = el('p', 'ly-note');
  result.append(summary, table, legend, basis);

  root.append(around, settings, count, status, progress, state, result);

  const renderCount = () => {
    const hasSite = Boolean(store.get().site);
    const r = radius.read(), s = spacing.read();
    scan.disabled = !hasSite;
    const n = r === null || s === null ? NaN : nearbyPointCount(r, s);
    if (!Number.isFinite(n)) {
      count.textContent = 'Candidates are taken on a square grid with this spacing, out to this radius.';
    } else if (n > MAX_NEARBY_CANDIDATES) {
      count.textContent = `That grid has ${n.toLocaleString('en-US')} points; a scan takes at most ${MAX_NEARBY_CANDIDATES.toLocaleString('en-US')}. Widen the spacing or shorten the radius.`;
      scan.disabled = true;
    } else if (n < 2) {
      count.textContent = 'That grid holds only the site itself. Shorten the spacing or widen the radius.';
      scan.disabled = true;
    } else {
      count.textContent = `${n} points: the site itself and ${n - 1} candidate${n === 2 ? '' : 's'} on a ${s} m grid within ${distanceText(r!)}. Each one within the slope limit gets its own skyline and mission-window analysis.`;
    }
  };

  const cell = (role: string, className: string, label: string, content: string | Node) => {
    const c = el('div', className);
    c.setAttribute('role', role);
    c.dataset.label = label;
    c.append(content);
    return c;
  };

  const rowOf = (c: NearbyCandidate, rank: number | null, referenceName: string, pinnedId: string | undefined): HTMLElement => {
    const tr = el('div', `cmp-nrow${c.isReference ? ' is-reference' : ''}`);
    tr.setAttribute('role', 'row');
    const pinned = c.site.id === pinnedId;
    if (pinned) tr.setAttribute('aria-current', 'true');
    const m = c.metrics;
    const name = c.isReference ? `This site: ${c.site.name}` : offsetName(c, referenceName);
    const where = el('div');
    where.append(el('div', 'cmp-nwhere', name), el('div', 'ly-note ly-value', `${coordsText(c.site.lat, c.site.lon, 4)}${pinned ? ' · on screen' : ''}`));
    const spell = (h: number, runsOn: boolean) => `${hoursText(h)}${runsOn && h >= 0.05 ? ' or more' : ''}`;
    const choose = el('div', 'cmp-nbuttons');
    if (rank !== null) {
      const pin = button('Pin', 'ly-btn ly-btn--small', () => void act('selectCandidate', { rank }, (r) => `Pinned candidate ${rank}: ${r.site.name}. It is now the site on screen.`));
      pin.setAttribute('aria-label', `Pin candidate ${rank}, ${name}, as the site on screen`);
      const asB = button('Compare as B', 'ly-btn ly-btn--small', () => void act('selectCandidate', { rank, asB: true }, (r) => `Candidate ${rank} is pinned and loaded as B, against A: ${r.A}.`));
      asB.setAttribute('aria-label', `Pin candidate ${rank}, ${name}, and load it as scenario B`);
      choose.append(pin, asB);
    }
    tr.append(
      cell('cell', 'cmp-ntd cmp-nrank ly-value', COLUMNS[0], rank === null ? '—' : String(rank)),
      cell('rowheader', 'cmp-ntd cmp-nname', COLUMNS[1], where),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[2], c.isReference ? '0 m' : `${distanceText(c.distanceM)}, ${bearingText(c.bearingDeg ?? NaN)}`),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[3], Number.isFinite(c.slope.slopeDeg) ? degText(c.slope.slopeDeg) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[4], m ? pctText(m.illuminationPct) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[5], m ? spell(m.longestDarknessH, m.darknessOpenEnded) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[6], m ? pctText(m.earthVisiblePct) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[7], m ? spell(m.longestEarthGapH, m.earthGapOpenEnded) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd ly-value', COLUMNS[8], Number.isFinite(c.score) ? c.score.toFixed(1) : NOT_AVAILABLE),
      cell('cell', 'cmp-ntd cmp-nchoose', COLUMNS[9], choose),
    );
    return tr;
  };

  /** What the list on screen was drawn from: redrawn only for a new scan or a different site on screen. */
  let drawn: { value: NearbyCandidate[]; pinned: string } | null = null;

  const render = () => {
    const s = store.get();
    const current = scenarioFromState(s);
    around.replaceChildren(el('span', 'ly-label', 'Around: '), document.createTextNode(current ? describeScenario(current) : 'no site is selected. Select a landing site or drop a pin, then scan around it.'));
    radius.show(panel.get().nearbyRadiusM);
    spacing.show(panel.get().nearbySpacingM);
    slope.show(s.slopeLimitDeg);
    renderCount();

    const st = analysis.nearby();
    progress.hidden = st.state !== 'loading';
    if (st.state === 'loading') {
      const p = st.progress;
      if (p) {
        bar.max = p.total;
        bar.value = p.done;
        progressText.textContent = `Analysed ${p.done} of ${p.total} points around ${st.scenario.site.name}…`;
      } else {
        bar.removeAttribute('value');
        progressText.textContent = `Reading the terrain around ${st.scenario.site.name}…`;
      }
    }
    state.classList.toggle('is-error', st.state === 'error');
    state.textContent = st.state === 'error' ? `The scan is not available: ${st.error}` : st.state === 'idle' ? 'No scan has run yet. Set the radius, the spacing and the slope limit, then scan.' : '';
    result.hidden = st.state !== 'ready';
    if (st.state !== 'ready') {
      drawn = null;
      return;
    }

    const view = nearbyView(st.value);
    const pinned = s.site?.id ?? '';
    if (!drawn || drawn.value !== st.value || drawn.pinned !== pinned) {
      drawn = { value: st.value, pinned };
      const head = el('div', 'cmp-nrow cmp-nhead');
      head.setAttribute('role', 'row');
      head.append(...COLUMNS.map((c) => cell('columnheader', 'cmp-ntd', c, c)));
      const rows: HTMLElement[] = [head];
      const refName = st.scenario.site.name;
      if (view.reference) rows.push(rowOf(view.reference, null, refName, s.site?.id));
      for (const a of view.alternatives.slice(0, MAX_ROWS)) rows.push(rowOf(a.candidate, a.rank, refName, s.site?.id));
      table.replaceChildren(...rows);
    }

    const o = st.options;
    const parts = [`${view.total} points scanned around ${st.scenario.site.name}${o ? ` (within ${distanceText(o.radiusM)}, every ${o.spacingM} m, slope at most ${o.slopeLimitDeg}°)` : ''}: ${view.alternatives.length} alternative${view.alternatives.length === 1 ? '' : 's'} ranked`];
    if (view.rejected.slope) parts.push(`${view.rejected.slope} over the slope limit`);
    if (view.rejected.noData) parts.push(`${view.rejected.noData} without elevation data`);
    let text = `${parts.join(', ')}.`;
    if (view.betterThanReference !== null && view.alternatives.length) text += ` ${view.betterThanReference === 0 ? 'None scores' : view.betterThanReference === 1 ? '1 scores' : `${view.betterThanReference} score`} higher than the site itself.`;
    if (view.referenceOverSlopeLimit) text += ' The site itself is steeper than the slope limit; it is analysed all the same, for comparison.';
    if (view.alternatives.length > MAX_ROWS) text += ` The best ${MAX_ROWS} are listed.`;
    if (current?.id !== st.scenario.id) text += ` This list is for ${describeScenario(st.scenario)}; the scenario on screen is different now, and a new scan will be made around it.`;
    summary.textContent = text;
    basis.textContent = `${view.basis} A candidate that is pinned gets the full analysis, which is finer than the scan, so its figures can differ slightly from this list.`;
  };

  return { render };
}
