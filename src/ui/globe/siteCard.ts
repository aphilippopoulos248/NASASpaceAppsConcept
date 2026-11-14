// The selected site's card (globe view): what the site is, Sun and Earth now, analysis
// status, links, stepping through the visible landings, and the way down to the surface.
import { skyAt } from '../../analysis/api';
import { elevation, moonGeometry } from '../../astro/ephemeris';
import { runAction } from '../../core/actions';
import { analysis, AnalysisStatus } from '../../core/analysisStore';
import { GLOBE_ALTITUDE_KM } from '../../core/coreActions';
import { matchesFilter, missionFilter } from '../../core/missionFilter';
import { store } from '../../core/store';
import { isoUtc } from '../../core/time';
import type { SiteRef } from '../../core/types';
import { getLandings } from '../../data/catalog';
import { formatCoords, formatDate, Landing, landingDate, programColor, quickmapUrl, trekUrl } from '../../data/landings';
import { SITE_IMAGERY_CREDIT } from '../../scene/sitePatch';
import { button, el, isTypingTarget } from '../dom';
import './siteCard.css';

type Row = { dt: HTMLElement; dd: HTMLElement };

function describeElevation(deg: number, below: string): string {
  return deg >= 0 ? `${deg.toFixed(1)}° above horizon` : `${below} (${Math.abs(deg).toFixed(1)}° below horizon)`;
}

function analysisText(st: AnalysisStatus): string {
  switch (st.state) {
    case 'idle': return '';
    case 'loading': return 'Analysing…';
    case 'error': return st.error;
    case 'ready': {
      const m = st.value.metrics;
      return `${m.illuminationPct.toFixed(0)}% sunlit, Earth in view ${m.earthVisiblePct.toFixed(0)}% of the ${st.scenario.durationH} h window`;
    }
  }
}

export function mountSiteCard(region: HTMLElement): void {
  const card = el('article', 'ly-panel site-card');
  card.hidden = true;
  const close = button('×', 'ly-btn ly-btn--ghost ly-btn--icon sc-close', () => void runAction('clearSite'));
  close.setAttribute('aria-label', 'Close and return to the whole Moon');
  const program = el('div', 'sc-program');
  const swatch = el('span', 'ly-swatch');
  const programName = el('span');
  program.append(swatch, programName);
  const title = el('h2', 'sc-title');
  const dl = el('dl', 'ly-kv sc-facts');
  const rows: Record<string, Row> = {};
  for (const [key, label] of [['date', 'Landed'], ['country', 'Country'], ['type', 'Type'], ['region', 'Region'], ['coords', 'Coordinates'], ['sun', 'Sun'], ['earth', 'Earth'], ['analysis', 'Analysis']] as const) {
    const dt = el('dt', undefined, label), dd = el('dd');
    dl.append(dt, dd);
    rows[key] = { dt, dd };
  }
  const skyNote = el('p', 'ly-note sc-skynote');
  const summary = el('p', 'sc-summary');
  const links = el('div', 'sc-links');
  const quickmap = el('a', undefined, 'Open in QuickMap ↗');
  const trek = el('a', undefined, 'Open in Moon Trek ↗');
  for (const a of [quickmap, trek]) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  links.append(quickmap, trek);
  const credit = el('p', 'ly-note sc-credit', `Close-up imagery: ${SITE_IMAGERY_CREDIT}.`);
  const nav = el('div', 'sc-nav');
  const prev = button('← Earlier', 'ly-btn ly-btn--small', () => step(-1));
  const index = el('span', 'ly-label ly-value');
  const next = button('Later →', 'ly-btn ly-btn--small', () => step(1));
  nav.append(prev, index, next);
  const actions = el('div', 'sc-actions');
  const landingLight = button('Lighting at landing', 'ly-btn ly-btn--small', async () => {
    const l = currentLanding();
    if (!l) return;
    await runAction('pause');
    await runAction('setLightMode', { mode: 'real' });
    await runAction('setTime', { utc: isoUtc(landingDate(l).getTime()) });
  });
  const surface = button('Surface view', 'ly-btn ly-btn--small ly-btn--primary', async () => {
    const r = await runAction('enterSurface');
    if (!r.ok) status.textContent = r.error;
  });
  const whole = button('Whole Moon', 'ly-btn ly-btn--small', () => {
    const c = store.get().globeCenter;
    void runAction('setGlobeCamera', { lat: c.lat, lon: c.lon, altitudeKm: GLOBE_ALTITUDE_KM });
  });
  actions.append(landingLight, surface, whole);
  const status = el('p', 'ly-note sc-status');
  status.setAttribute('role', 'status');
  card.append(close, program, title, dl, skyNote, summary, links, credit, nav, actions, status);
  region.append(card);

  const visible = () => getLandings().filter((l) => matchesFilter(missionFilter.get(), l));
  const currentLanding = (): Landing | undefined => {
    const s = store.get().site;
    return s?.kind === 'landing' ? getLandings().find((l) => l.id === s.id) : undefined;
  };
  function step(offset: number) {
    const list = visible();
    const i = list.findIndex((l) => l.id === store.get().site?.id);
    const target = list[i + offset];
    if (i >= 0 && target) void runAction('selectSite', { site: target.id, surface: true });
  }

  const setRow = (key: string, text: string | null) => {
    rows[key].dt.hidden = rows[key].dd.hidden = text === null;
    rows[key].dd.textContent = text ?? '';
  };

  let lastSkyMs = -Infinity;
  const renderSky = (site: SiteRef) => {
    const t = store.get().timeMs;
    try {
      const sky = skyAt(site, 0, t);
      setRow('sun', describeElevation(sky.sun.elDeg, 'Night'));
      setRow('earth', describeElevation(sky.earth.elDeg, 'Not visible'));
      skyNote.textContent = `At ${isoUtc(t)}, topocentric, smooth horizon (no terrain).`;
    } catch {
      // Science core not merged yet: the existing Moon-centre estimate, labelled as such.
      const g = moonGeometry(new Date(t));
      setRow('sun', describeElevation(elevation(site.lat, site.lon, g.sunDir), 'Night'));
      setRow('earth', describeElevation(elevation(site.lat, site.lon, g.earthDir), 'Not visible'));
      skyNote.textContent = `At ${isoUtc(t)}. Approximate: seen from the Moon's centre over a smooth horizon (up to about 0.3° off; terrain not included).`;
    }
    lastSkyMs = performance.now();
  };

  const render = () => {
    const site = store.get().site;
    status.textContent = '';
    if (!site) {
      card.hidden = true;
      return;
    }
    const l = currentLanding();
    card.hidden = false;
    program.hidden = !l;
    if (l) {
      swatch.style.background = programColor(l.program);
      programName.textContent = l.program;
    }
    title.textContent = l ? l.name : 'Custom pin';
    setRow('date', l ? formatDate(l.date) : null);
    setRow('country', l?.country ?? null);
    setRow('type', l ? (l.crewed ? 'Crewed' : 'Robotic') : null);
    setRow('region', l?.region ?? null);
    const approx = l && (l as Landing & { approx?: boolean }).approx;
    setRow('coords', `${formatCoords(site.lat, site.lon)}${approx ? ' (approx.)' : ''}`);
    summary.hidden = !l;
    summary.textContent = l?.summary ?? '';
    links.hidden = !l;
    landingLight.hidden = !l;
    nav.hidden = !l;
    if (l) {
      quickmap.href = quickmapUrl(l);
      trek.href = trekUrl(l);
      const list = visible();
      const i = list.findIndex((x) => x.id === l.id);
      index.textContent = i >= 0 ? `${i + 1} of ${list.length}` : '';
      prev.disabled = i <= 0;
      next.disabled = i < 0 || i >= list.length - 1;
    }
    renderSky(site);
    renderAnalysis();
  };
  const renderAnalysis = () => setRow('analysis', analysisText(analysis.get('current')) || null);

  store.subscribe(['site'], render);
  missionFilter.subscribe(render);
  analysis.subscribe((slot) => slot === 'current' && renderAnalysis());
  // While the clock runs, refresh Sun/Earth a few times a second rather than every frame.
  store.subscribe(['timeMs'], (s) => {
    if (s.site && !card.hidden && performance.now() - lastSkyMs > 250) renderSky(s.site);
  });
  render();

  window.addEventListener('keydown', (e) => {
    if (store.get().view !== 'globe' || !store.get().site || isTypingTarget(e.target)) return;
    if (e.key === 'Escape') void runAction('clearSite');
    else if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
  });
}
