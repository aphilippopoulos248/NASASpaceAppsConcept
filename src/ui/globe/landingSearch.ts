// Search directly from the coordinate fields. The engine and the existing Rank sites
// results use the same action; the centre is the entered point, never an old selected site.
import { runAction } from '../../core/actions';
import { decisionRun, NEARBY_MAX_RADIUS_M, NEARBY_MIN_SPACING_M, onDecisionRun } from '../../core/decisionActions';
import { landingSearchPoints, setLandingSearchMap } from '../../core/landingSearch';
import { MAX_NEARBY_CANDIDATES, nearbyPointCount } from '../compare/actions';
import { readRanking } from '../decision/results';
import { button, el } from '../dom';
import type { Point } from './centreFields';

let nextId = 0;

export function mountLandingSearch(parent: HTMLElement, centre: () => Point): void {
  const section = el('section', 'fp-landing-search');
  section.setAttribute('aria-label', 'Find landing sites around these coordinates');
  const fields = el('div', 'fp-pair');
  const field = (label: string, value: number, min: number) => {
    const id = `fp-search-${++nextId}`;
    const wrap = el('div', 'fp-num');
    const lab = el('label', 'ly-label', label);
    lab.htmlFor = id;
    const input = el('input', 'ly-input');
    input.id = id;
    input.type = 'number';
    input.min = String(min);
    input.max = String(NEARBY_MAX_RADIUS_M);
    input.step = 'any';
    input.value = String(value);
    const row = el('div', 'fp-num-row');
    row.append(input, el('span', 'ly-unit', 'm'));
    wrap.append(lab, row);
    fields.append(wrap);
    return input;
  };
  const radius = field('Search radius', 2000, 100);
  const spacing = field('Sample spacing', 600, NEARBY_MIN_SPACING_M);
  radius.title = 'Radius of the circular search area around the latitude and longitude above.';
  spacing.title = 'Distance between sampled points inside the circle. Smaller spacing checks more points.';
  const faster = button('Use faster spacing', 'ly-btn ly-btn--small ly-btn--ghost', () => {
    const r = Number(radius.value);
    if (r >= 100 && r <= NEARBY_MAX_RADIUS_M) {
      spacing.value = String(Math.max(NEARBY_MIN_SPACING_M, Math.ceil(r / 3 / 50) * 50));
    }
  });
  faster.title = 'Check about 25 points across the circle. Larger spacing can miss small favourable areas.';
  const status = el('p', 'ly-note fp-search-status');
  status.setAttribute('role', 'status');
  const say = (text: string, error = false) => {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  };
  let busy = false;
  let started = 0;
  let progressLabel = '';
  const showProgress = () => say(`${progressLabel} · ${Math.round((performance.now() - started) / 1000)} s elapsed`);
  const progressBar = el('progress', 'fp-search-progress');
  progressBar.hidden = true;
  progressBar.setAttribute('aria-label', 'Landing search progress');
  const resultBox = el('div', 'fp-search-results');
  resultBox.hidden = true;
  const rank = button('Find best landing sites', 'ly-btn ly-btn--small ly-btn--primary', () => void search());
  rank.id = 'find-best-landing-sites';
  const settings = button('Ranking settings', 'ly-btn ly-btn--small ly-btn--ghost', () => void runAction('openCompare', { tab: 'rank' }));
  const buttons = el('div', 'fp-search-buttons');
  buttons.append(rank, settings);

  const renderBusy = () => {
    rank.disabled = busy || decisionRun().running;
    rank.textContent = busy ? 'Searching…' : 'Find best landing sites';
    section.setAttribute('aria-busy', String(busy));
    radius.disabled = spacing.disabled = faster.disabled = busy;
    progressBar.hidden = !busy;
  };
  async function search() {
    if (busy || decisionRun().running) return;
    let point: Point;
    try { point = centre(); } catch (err) { return say(err instanceof Error ? err.message : 'Check the coordinates above.', true); }
    const r = radius.value.trim() ? Number(radius.value) : NaN;
    const s = spacing.value.trim() ? Number(spacing.value) : NaN;
    const radiusOK = Number.isFinite(r) && r >= 100 && r <= NEARBY_MAX_RADIUS_M;
    const spacingOK = Number.isFinite(s) && s >= NEARBY_MIN_SPACING_M && s <= NEARBY_MAX_RADIUS_M;
    radius.setAttribute('aria-invalid', String(!radiusOK));
    spacing.setAttribute('aria-invalid', String(!spacingOK));
    if (!radiusOK) return say(`Enter a search radius from 100 to ${NEARBY_MAX_RADIUS_M.toLocaleString('en-US')} m.`, true);
    if (!spacingOK) return say(`Enter sample spacing from ${NEARBY_MIN_SPACING_M} to ${NEARBY_MAX_RADIUS_M.toLocaleString('en-US')} m.`, true);
    const count = nearbyPointCount(r, s);
    if (count < 2) return say('Sample spacing must be no greater than the radius to check locations around the centre.', true);
    if (count > MAX_NEARBY_CANDIDATES) return say(`This grid exceeds ${MAX_NEARBY_CANDIDATES.toLocaleString('en-US')} points. Increase spacing or reduce the radius.`, true);
    busy = true;
    started = performance.now();
    resultBox.hidden = true;
    resultBox.replaceChildren();
    progressBar.removeAttribute('value');
    setLandingSearchMap({ centre: point, radiusM: r, points: [] });
    void runAction('setGlobeCamera', { ...point, altitudeKm: Math.max(15, r / 1000 * 5) });
    renderBusy();
    progressLabel = `Loading terrain for ${count} points within ${r.toLocaleString('en-US')} m…`;
    showProgress();
    const timer = window.setInterval(showProgress, 1000);
    try {
      const outcome = await runAction('findBestSites', {
        candidates: { from: 'nearby', around: point, radiusM: r, spacingM: s },
        limit: 5, detail: 'full',
      });
      if (!outcome.ok) return say(outcome.error, true);
      const result = readRanking(outcome.result);
      if (!result) return say('The search returned no readable ranking. Open Ranking settings to try again.', true);
      const points = landingSearchPoints(result);
      setLandingSearchMap({ centre: point, radiusM: r, points });
      say('');
      resultBox.hidden = false;
      if (result.ranked.length) {
        resultBox.append(el('strong', undefined, 'Best landing points'));
        resultBox.append(el('p', 'ly-note', 'Numbers match the globe. Utility is scored from 0 to 1.'));
      }
      const list = el('ol', 'fp-search-list');
      for (const { label, evaluation: e } of points) {
        const item = el('li');
        const go = button(`${label} · ${e.site.lat.toFixed(5)}°, ${e.site.lon.toFixed(5)}°`, 'ly-btn ly-btn--small', () => {
          void runAction('dropPin', { lat: e.site.lat, lon: e.site.lon });
          void runAction('setGlobeCamera', { lat: e.site.lat, lon: e.site.lon, altitudeKm: Math.max(15, r / 1000 * 5) });
          void runAction('showPanel', { panel: 'site-details', open: true });
        });
        const detail = e.feasibility === 'feasible' ? `Utility ${e.utility?.toFixed(2)}` : e.criteria.filter(c => c.verdict !== 'pass').map(c => `${c.id}: ${c.verdict}`).join(' · ');
        item.append(go, el('span', 'ly-note', detail));
        list.append(item);
      }
      const clear = button('Clear map results', 'ly-btn ly-btn--small ly-btn--ghost', () => { setLandingSearchMap(null); resultBox.hidden = true; say(''); });
      resultBox.append(list, button('Full ranking details', 'ly-btn ly-btn--small', () => void runAction('openCompare', { tab: 'rank' })), clear);
    } catch (err) {
      say(err instanceof Error ? err.message : 'The search could not finish.', true);
    } finally {
      window.clearInterval(timer);
      busy = false;
      renderBusy();
    }
  }
  for (const input of [radius, spacing]) {
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void search();
    });
    input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); if (!busy) say(''); });
  }
  onDecisionRun((progress) => {
    renderBusy();
    if (busy && progress.running) {
      if (progress.total > 0) { progressBar.max = progress.total; progressBar.value = progress.done; }
      else progressBar.removeAttribute('value');
      progressLabel = progress.label;
      showProgress();
    }
  });
  section.append(fields, faster, buttons, progressBar, status, resultBox);
  parent.append(section);
  renderBusy();
}
