// Upper-left "Key metrics" of the surface view: where the Sun and Earth are now and how far
// they clear the skyline, countdowns to the next sunset, sunrise, Earthset and Earthrise,
// the mission-window figures, unmet requirements in words, and where the numbers come from.
// Everything is read from the shared analysis store and the shared clock (metricsModel.ts);
// nothing here keeps a time or a result of its own.
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { store } from '../../core/store';
import { formatUtc } from '../../core/time';
import { button, el } from '../dom';
import { ensureHudActions } from './hudActions';
import { hudLayoutPart, requestHudLayout } from './hudLayout';
import { applyPhoneDefaults, hudState, onHudState } from './hudState';
import { buildMetrics, type BodyNow, type MetricsView } from './metricsModel';
import './metrics.css';

const signed = (v: number, digits: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}°`;
const pct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} %` : 'not available');

export function mountKeyMetrics(region: HTMLElement): void {
  ensureHudActions({ store, analysis });
  applyPhoneDefaults();

  const panel = el('div', 'ly-panel km');
  const head = el('div', 'km-head');
  const title = el('h2', 'ly-panel-title', 'Key metrics');
  const fold = button('', 'ly-btn ly-btn--small ly-btn--ghost km-fold', () => void runAction('showKeyMetrics', { open: !hudState().metricsOpen }));
  fold.setAttribute('aria-controls', 'km-body');
  head.append(title, fold);
  const body = el('div', 'km-body');
  body.id = 'km-body';

  const site = el('p', 'km-site ly-note');
  const source = el('p', 'km-source ly-note');
  const message = el('p', 'km-message');
  message.setAttribute('role', 'status');

  // Now: one row per body.
  const nowTitle = el('h3', 'ly-section-title');
  const nowTable = el('table', 'km-now');
  nowTable.innerHTML = '<caption class="ly-visually-hidden">Sun and Earth as seen from the site now</caption><thead><tr><th scope="col"></th><th scope="col">Azimuth</th><th scope="col">Elevation</th><th scope="col">Above skyline</th></tr></thead>';
  const nowBody = el('tbody');
  nowTable.append(nowBody);
  const rows = (['sun', 'earth'] as const).map((which) => {
    const tr = el('tr');
    const name = el('th');
    name.scope = 'row';
    const face = button(which === 'sun' ? 'Sun' : 'Earth', 'km-body-btn', () => void runAction('lookAtBody', { body: which }));
    face.title = `Turn the view to ${which === 'sun' ? 'the Sun' : 'Earth'}`;
    face.prepend(el('span', `ly-swatch km-swatch km-swatch--${which}`));
    name.append(face);
    const az = el('td', 'ly-value'), elv = el('td', 'ly-value'), clear = el('td', 'ly-value');
    tr.append(name, az, elv, clear);
    const state = el('tr', 'km-state');
    const stateCell = el('td');
    stateCell.colSpan = 4;
    // The state in words is the button that explains it.
    const why = button('', 'km-why', () => void runAction('explainBlockage', { body: which }));
    why.title = 'Explain what forms the skyline in that direction';
    const stateText = el('span', 'km-state-text');
    why.append(stateText, el('span', 'km-why-ask', 'why?'));
    const stateOnly = el('span', 'km-state-text');
    stateCell.append(why, stateOnly);
    state.append(stateCell);
    nowBody.append(tr, state);
    return { az, elv, clear, why, stateText, stateOnly, tr, state };
  });
  const windowNote = el('p', 'ly-note km-outside');

  // Countdowns: each is a button that jumps the clock to the event.
  const countTitle = el('h3', 'ly-section-title', 'Next events · over the terrain skyline');
  const countList = el('ul', 'km-count');
  const counts = (['sunset', 'sunrise', 'earthset', 'earthrise'] as const).map((type) => {
    const li = el('li');
    const go = button('', 'km-count-btn', () => void runAction('jumpToEvent', { type }));
    const label = el('span', 'km-count-label'), when = el('span', 'ly-value km-count-in'), at = el('span', 'ly-note km-count-at');
    go.append(label, when, at);
    li.append(go);
    countList.append(li);
    return { go, label, when, at };
  });

  // Mission window.
  const winTitle = el('h3', 'ly-section-title');
  const win = el('dl', 'ly-kv km-win');
  const field = (name: string, hint?: string) => {
    const dt = el('dt', undefined, name), dd = el('dd');
    if (hint) dt.title = hint;
    win.append(dt, dd);
    return dd;
  };
  const sunlight = field('Sunlight', 'Time-averaged visible part of the Sun\'s disc over the mission window');
  const darkness = field('Longest darkness', 'Longest spell with the Sun entirely hidden');
  const earthSight = field('Earth\'s centre in sight', 'Share of the window with geometric line of sight to Earth\'s centre: not a radio link');
  const earthGap = field('Longest Earth gap', 'Longest spell without line of sight to Earth\'s centre');
  const slope = field('Slope');
  const sunRange = field('Sun elevation', 'Lowest and highest elevation of the Sun\'s centre during the window');

  const flags = el('ul', 'km-flags');
  flags.setAttribute('aria-label', 'Requirements not met');
  const warnings = el('ul', 'km-warnings ly-note');

  const prov = el('details', 'km-prov');
  const provSummary = el('summary', 'km-prov-summary');
  const provBody = el('div', 'ly-note km-prov-body');
  prov.append(provSummary, provBody);

  // Unmet requirements come first: they are what a planner must not miss.
  body.append(site, source, message, flags, nowTitle, nowTable, windowNote, countTitle, countList, winTitle, win, warnings, prov);
  // Where the panel is cut by what sits under it, say that there is more.
  const more = el('div', 'km-more');
  more.setAttribute('aria-hidden', 'true');
  more.append(el('span', undefined, 'More below ↓'));
  panel.append(head, body, more);
  region.append(panel);
  const syncMore = () => {
    more.hidden = body.hidden || body.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom - 4;
  };
  panel.addEventListener('scroll', syncMore, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const sizes = new ResizeObserver(syncMore);
    sizes.observe(panel);
    sizes.observe(body);
  }
  // The panel ends above the chart (or whatever else sits under it) and scrolls beyond that.
  hudLayoutPart('metrics', panel);

  const fillBody = (row: (typeof rows)[number], b: BodyNow | null) => {
    row.tr.hidden = row.state.hidden = !b;
    if (!b) return;
    row.az.textContent = `${b.azDeg.toFixed(1)}°`;
    row.elv.textContent = signed(b.elDeg, 2);
    row.clear.textContent = b.clearanceDeg === null ? 'n/a' : signed(b.clearanceDeg, 2);
    row.clear.title = b.skylineElDeg === null ? 'No skyline available yet' : `Skyline at that azimuth: ${signed(b.skylineElDeg, 2)}`;
    // The explanation needs the skyline: without one the state is plain text.
    const explainable = b.state !== 'unknown';
    row.why.hidden = !explainable;
    row.stateOnly.hidden = explainable;
    for (const text of [row.stateText, row.stateOnly]) {
      text.textContent = b.stateText;
      text.className = `km-state-text km-state-text--${b.state}`;
    }
  };

  const render = (v: MetricsView) => {
    const s = store.get();
    site.textContent = s.site ? `${s.site.name} · ${Math.abs(s.site.lat).toFixed(3)}° ${s.site.lat >= 0 ? 'N' : 'S'}, ${Math.abs(s.site.lon).toFixed(3)}° ${s.site.lon >= 0 ? 'E' : 'W'}` : '';
    source.hidden = !v.provenanceShort;
    source.textContent = source.title = v.provenanceShort;
    message.hidden = v.message === null;
    message.textContent = v.message ?? '';
    message.className = `km-message${v.status === 'error' ? ' km-message--error' : ' ly-unavailable'}`;

    const anyNow = Boolean(v.sun || v.earth);
    nowTitle.hidden = nowTable.hidden = !anyNow;
    nowTitle.textContent = `Now · ${formatUtc(v.timeMs)}`;
    fillBody(rows[0], v.sun);
    fillBody(rows[1], v.earth);
    windowNote.hidden = v.insideWindow !== false;
    windowNote.textContent = 'The clock is outside the analysed mission window: these two rows come from the sky model against the same skyline.';

    countTitle.hidden = countList.hidden = !v.countdowns;
    v.countdowns?.forEach((c, k) => {
      const row = counts[k];
      row.label.textContent = c.label;
      row.when.textContent = c.text;
      // Second line: which instant of the setting or rising this is, and when (UTC).
      row.at.textContent = c.timeMs === null ? '' : `${c.instant} · ${formatUtc(c.timeMs)}`;
      row.go.disabled = c.timeMs === null;
      row.go.classList.toggle('km-count-btn--none', c.timeMs === null);
      row.go.title = c.timeMs === null ? c.detail : `${c.detail}. Click to move the clock there.`;
    });

    const w = v.window;
    winTitle.hidden = win.hidden = !w;
    if (w) {
      winTitle.textContent = `Mission window · ${formatUtc(w.startMs)} for ${w.durationH} h`;
      sunlight.textContent = `${pct(w.illuminationPct)} (any Sun ${pct(w.sunAnyPct)})`;
      darkness.textContent = w.longestDarknessText;
      earthSight.textContent = pct(w.earthVisiblePct);
      earthGap.textContent = w.longestEarthGapText;
      slope.textContent = w.slopeText;
      slope.title = w.slopeDetail;
      sunRange.textContent = w.sunElRangeText;
    }

    flags.hidden = v.flags.length === 0;
    flags.replaceChildren(
      ...v.flags.map((text) => {
        const li = el('li');
        li.append(el('span', 'km-flag-mark', '⚠'), el('strong', undefined, 'Requirement not met. '), text);
        return li;
      }),
    );
    warnings.hidden = v.warnings.length === 0;
    warnings.replaceChildren(...v.warnings.map((text) => el('li', undefined, text)));

    prov.hidden = v.provenance.length === 0;
    provSummary.textContent = 'Where these numbers come from';
    provBody.replaceChildren(...v.provenance.map((text) => el('p', undefined, text)));
    syncMore();
  };

  let last = 0, timer: ReturnType<typeof setTimeout> | null = null;
  const update = () => {
    timer = null;
    last = performance.now();
    if (store.get().view !== 'surface') return;
    const s = store.get();
    render(buildMetrics(analysis.get('current'), analysis.wanted('current')?.id ?? null, s));
  };
  /** At most five times a second, so a running clock does not rebuild the panel every frame. */
  const schedule = () => {
    if (timer !== null) return;
    const wait = Math.max(0, 200 - (performance.now() - last));
    timer = setTimeout(update, wait);
  };

  const syncFold = () => {
    const open = hudState().metricsOpen;
    body.hidden = !open;
    fold.textContent = open ? 'Fold' : 'Open';
    fold.setAttribute('aria-expanded', String(open));
    requestHudLayout();
    syncMore();
  };
  onHudState(syncFold);
  syncFold();

  store.subscribe(['timeMs', 'site', 'mastHeightM', 'sunElMinDeg', 'sunElMaxDeg', 'maxEarthGapH', 'view'], schedule);
  analysis.subscribe((slot) => slot === 'current' && schedule());
  update();
}
