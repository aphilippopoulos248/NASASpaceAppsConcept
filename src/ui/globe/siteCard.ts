// The selected site's card (globe view): what the site is, who its hardware belongs to (GCAT),
// the area explored there, its elevation and the data behind it, where the Sun and Earth are now, the mission-window results, links, stepping through the
// visible landings, and the way down to the surface.
//
// Layout: a header that always shows (name, coordinates, fold and close buttons), a body that
// scrolls and can be folded away (the default on phones), and a footer with the actions.
import { blockageAt, skyAt } from '../../analysis/api';
import type { Blockage } from '../../analysis/types';
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { GLOBE_ALTITUDE_KM } from '../../core/coreActions';
import { matchesFilter, missionFilter } from '../../core/missionFilter';
import { spanText } from '../../core/scenario';
import { store } from '../../core/store';
import { throttle } from '../../core/throttle';
import { formatDuration, formatUtc } from '../../core/time';
import type { SiteRef } from '../../core/types';
import { getLandings } from '../../data/catalog';
import { formatCoords, formatDate, Landing, landingColor, landingDate, quickmapUrl, trekUrl } from '../../data/landings';
import { flagCode, labelDisagrees, loadOwnership, type OwnershipIndex, stateLabel } from '../../data/ownership';
import { flagCanvas } from '../../scene/flags';
import { globeDisplay } from '../../scene/globe/displayState';
import { AREA_DISPLAY_SCALE, describeExtent, loadSiteAreas, type SiteArea } from '../../scene/siteAreas';
import { IMAGERY_MAX_LAT, imageryText } from '../../scene/sitePatch';
import { loadTerrainFor } from '../../terrain/api';
import type { TerrainStack } from '../../terrain/types';
import { button, el, isTypingTarget } from '../dom';
import { mountSiteScience } from '../science/siteScience';
import { bindCardKeys } from './cardKeys';
import { initPanels, isPanelOpen, onPanelChange } from './panels';
import './siteCard.css';

type Row = { dt: HTMLElement; dd: HTMLElement };

let uid = 0;

/** "60 m", "1.9 km": the spacing of an elevation grid. */
export function resolutionText(metres: number): string {
  if (!Number.isFinite(metres)) return 'unknown resolution';
  return metres < 1000 ? `${Number(metres.toFixed(metres < 10 ? 1 : 0))} m` : `${(metres / 1000).toFixed(1)} km`;
}

const deg = (v: number, digits = 1) => `${v.toFixed(digits).replace('-', '−')}°`;

/** One body against the terrain skyline, in words. */
function bodyText(k: Blockage, hiddenWord: string): string {
  const where = `${deg(k.bodyElDeg)} elevation, azimuth ${deg(k.bodyAzDeg, 0)}`;
  if (!Number.isFinite(k.clearanceDeg)) return `${where} (no skyline: no elevation data here)`;
  return k.clearanceDeg > 0 ? `${where}; ${deg(k.clearanceDeg)} above the skyline` : `${hiddenWord}: ${where}; ${deg(-k.clearanceDeg)} below the skyline`;
}

/** A kv list whose rows can be shown and hidden by key. */
function factList(className: string, keys: readonly (readonly [string, string])[]) {
  const dl = el('dl', `ly-kv ${className}`);
  const rows: Record<string, Row> = {};
  for (const [key, label] of keys) {
    const dt = el('dt', undefined, label), dd = el('dd');
    dl.append(dt, dd);
    rows[key] = { dt, dd };
  }
  const set = (key: string, text: string | null) => {
    rows[key].dt.hidden = rows[key].dd.hidden = text === null;
    rows[key].dd.textContent = text ?? '';
  };
  return { dl, rows, set };
}

export function mountSiteCard(region: HTMLElement): void {
  initPanels();
  const card = el('article', 'ly-panel site-card');
  card.hidden = true;

  // ---------- header: always visible ----------
  const head = el('header', 'sc-head');
  const program = el('div', 'sc-program');
  const swatch = el('span', 'ly-swatch');
  const programName = el('span');
  program.append(swatch, programName);
  const title = el('h2', 'sc-title');
  const where = el('p', 'ly-value sc-where');
  const bodyId = `sc-body-${++uid}`;
  const fold = button('', 'ly-btn ly-btn--ghost ly-btn--icon sc-fold', () => void runAction('showPanel', { panel: 'site-details', open: !isPanelOpen('site-details') }));
  fold.setAttribute('aria-controls', bodyId);
  const close = button('×', 'ly-btn ly-btn--ghost ly-btn--icon sc-close', () => void runAction('clearSite'));
  close.setAttribute('aria-label', 'Close and return to the whole Moon');
  const headButtons = el('div', 'sc-headbuttons');
  headButtons.append(fold, close);
  const headText = el('div', 'sc-headtext');
  headText.append(program, title, where);
  head.append(headText, headButtons);

  // ---------- body: scrolls, can be folded away ----------
  const body = el('div', 'sc-body');
  body.id = bodyId;

  const facts = factList('sc-facts', [['date', 'Landed'], ['country', 'Belongs to'], ['owner', 'Owner'], ['type', 'Type'], ['region', 'Region'], ['coords', 'Coordinates'], ['area', 'Explored'], ['elevation', 'Elevation'], ['coverage', 'Elevation data']]);
  facts.rows.coverage.dd.classList.add('sc-oneline');
  const areaNote = el('p', 'ly-note sc-area-note');
  const mismatch = el('p', 'sc-mismatch');
  const dataMore = el('details', 'sc-more');
  const dataSummary = el('summary', undefined, 'Elevation data: every source and its limits');
  const dataList = el('ul', 'sc-sources');
  const dataNotes = el('div', 'ly-note sc-datanotes');
  dataMore.append(dataSummary, dataList, dataNotes);

  const skyTitle = el('h3', 'ly-section-title');
  const sky = factList('sc-sky', [['sun', 'Sun'], ['earth', 'Earth']]);
  const skyNote = el('p', 'ly-note sc-skynote');

  const winTitle = el('h3', 'ly-section-title', 'Mission window');
  const winWhen = el('p', 'ly-note sc-winwhen');
  const win = factList('sc-window', [['sunlight', 'Sunlight'], ['dark', 'Longest darkness'], ['earth', 'Earth in view'], ['gap', 'Longest Earth gap'], ['slope', 'Slope']]);
  const winStatus = el('p', 'sc-winstatus');
  winStatus.setAttribute('role', 'status');
  const winNote = el('p', 'ly-note sc-winnote');

  // Site science (@ice-targets' module, src/ui/science): Deep Space Network geometry, long-term
  // averages, ice targets, Diviner annual temperatures and ShadowCam links, each with its source
  // and caveat. It keeps itself current; here it only gets a place and a heading that folds it.
  const sciId = `sc-science-${uid}`;
  const sciTitle = el('h3', 'ly-section-title sc-scititle');
  const sciToggle = button('', 'sc-scitoggle', () => void runAction('showPanel', { panel: 'site-science', open: !isPanelOpen('site-science') }));
  sciToggle.setAttribute('aria-controls', sciId);
  const sciMark = el('span', 'sc-scimark');
  sciMark.setAttribute('aria-hidden', 'true');
  sciToggle.append(el('span', undefined, 'Site science'), sciMark);
  sciTitle.append(sciToggle);
  const sciHint = el('p', 'ly-note sc-scihint', 'Deep Space Network geometry, 18.6-year averages, nearest ice targets, annual surface temperatures and ShadowCam links for this site.');
  const sci = el('div', 'sc-science');
  sci.id = sciId;
  mountSiteScience(sci, { heading: false });

  const summary = el('p', 'sc-summary');
  const links = el('div', 'sc-links');
  const quickmap = el('a', undefined, 'Open in QuickMap ↗');
  const trek = el('a', undefined, 'Open in Moon Trek ↗');
  for (const a of [quickmap, trek]) {
    a.target = '_blank';
    a.rel = 'noopener';
  }
  links.append(quickmap, trek);
  const credit = el('p', 'ly-note sc-credit');
  const nav = el('div', 'sc-nav');
  const prev = button('← Earlier', 'ly-btn ly-btn--small', () => step(-1));
  const index = el('span', 'ly-label ly-value');
  const next = button('Later →', 'ly-btn ly-btn--small', () => step(1));
  nav.append(prev, index, next);
  body.append(facts.dl, mismatch, areaNote, dataMore, skyTitle, sky.dl, skyNote, winTitle, winWhen, winStatus, win.dl, winNote, sciTitle, sciHint, sci, summary, links, credit, nav);

  // ---------- footer: the actions ----------
  const foot = el('footer', 'sc-foot');
  const actions = el('div', 'sc-actions');
  const atLanding = button('At landing time', 'ly-btn ly-btn--small', () => {
    const l = currentLanding();
    if (l) void runAction('selectSite', { site: l.id, atLanding: true, fly: false });
  });
  const surface = button('Enter surface view', 'ly-btn ly-btn--small ly-btn--primary', async () => {
    const r = await runAction('enterSurface');
    if (!r.ok) status.textContent = r.error;
  });
  const whole = button('Whole Moon', 'ly-btn ly-btn--small', () => {
    const c = store.get().globeCenter;
    void runAction('setGlobeCamera', { lat: c.lat, lon: c.lon, altitudeKm: GLOBE_ALTITUDE_KM });
  });
  actions.append(atLanding, surface, whole);
  const status = el('p', 'ly-note sc-status');
  status.setAttribute('role', 'status');
  foot.append(actions, status);

  card.append(head, body, foot);
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

  const syncFold = () => {
    const open = isPanelOpen('site-details');
    body.hidden = !open;
    card.classList.toggle('folded', !open);
    fold.textContent = open ? '▾' : '▸';
    fold.setAttribute('aria-expanded', String(open));
    fold.setAttribute('aria-label', open ? 'Fold the site details away' : 'Show the site details');
    fold.title = open ? 'Fold the details away' : 'Show the details';
  };
  onPanelChange((panel) => panel === 'site-details' && syncFold());
  syncFold();

  const syncScience = () => {
    const open = isPanelOpen('site-science');
    sci.hidden = !open;
    sciHint.hidden = open;
    sciMark.textContent = open ? '▾' : '▸';
    sciToggle.setAttribute('aria-expanded', String(open));
    sciToggle.title = open ? 'Fold the site science away' : 'Show the site science';
  };
  onPanelChange((panel) => panel === 'site-science' && syncScience());
  syncScience();

  // ---------- what the close-up on the globe is made of ----------
  // Up to 80 degrees of latitude it is imagery fetched from NASA Moon Trek, which may not
  // arrive: the line says what is on screen, not what was asked for.
  const renderCredit = (site: SiteRef) => {
    if (Math.abs(site.lat) > IMAGERY_MAX_LAT) {
      credit.textContent =
        site.lat < 0
          ? 'Close-up on the globe: shaded relief computed from LOLA polar elevation (40, 80 and 160 m grids), with the shadows the terrain casts at the simulated time. Not a photograph: photographic maps are stretched this close to the pole.'
          : 'No close-up on the globe this close to the north pole: photographic maps are stretched here and no north-polar elevation layer is bundled.';
      return;
    }
    const closeUp = globeDisplay.getLive().closeUp;
    credit.textContent = imageryText(closeUp?.state ?? 'loading', closeUp?.credits ?? []);
    credit.classList.toggle('sc-credit--missing', closeUp?.state === 'unavailable');
  };
  globeDisplay.subscribe(() => {
    const site = store.get().site;
    if (site) renderCredit(site);
  });

  /** The finished analysis of the scenario on screen, or null while there is none for it. */
  const currentAnalysis = () => {
    const st = analysis.get('current');
    return st.state === 'ready' && st.scenario.id === analysis.wanted('current')?.id ? st.value : null;
  };

  // ---------- Sun and Earth at the simulated time ----------
  const renderSky = (site: SiteRef) => {
    const t = store.get().timeMs;
    skyTitle.textContent = `Sky at ${formatUtc(t)}`;
    const a = currentAnalysis();
    if (a) {
      sky.set('sun', bodyText(blockageAt(a, 'sun', t), 'Hidden'));
      sky.set('earth', bodyText(blockageAt(a, 'earth', t), 'Hidden'));
      skyNote.textContent = `Centre of each disc against the terrain skyline, seen from ${a.horizon.mastHeightM} m above the ground at the site. No atmosphere, so no refraction.`;
      return;
    }
    try {
      const s = skyAt(site, 0, t);
      const plain = (b: { elDeg: number; azDeg: number }) => `${deg(b.elDeg)} elevation, azimuth ${deg(b.azDeg, 0)}`;
      sky.set('sun', plain(s.sun));
      sky.set('earth', plain(s.earth));
      skyNote.textContent = 'Seen from the site on a smooth Moon: the terrain skyline is added when the site analysis is ready.';
    } catch (err) {
      sky.set('sun', null);
      sky.set('earth', null);
      skyNote.textContent = `The Sun and Earth positions are not available: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  // ---------- mission-window results ----------
  const renderAnalysis = () => {
    const st = analysis.get('current');
    const want = analysis.wanted('current');
    for (const key of Object.keys(win.rows)) win.set(key, null);
    winNote.textContent = '';
    if (!want) {
      winWhen.textContent = '';
      winStatus.textContent = '';
      return;
    }
    winWhen.textContent = `${formatUtc(want.startMs)}, ${spanText(want.durationH)}, ${want.mastHeightM} m above the ground`;
    if (st.state === 'idle' || st.scenario.id !== want.id || st.state === 'loading') {
      winStatus.textContent = 'Analysing the skyline, sunlight and Earth visibility…';
      return;
    }
    if (st.state === 'error') {
      winStatus.textContent = `Not available: ${st.error}`;
      return;
    }
    winStatus.textContent = '';
    const a = st.value, m = a.metrics;
    const pct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} %` : 'not available');
    const span = (h: number, open: boolean) => (Number.isFinite(h) ? `${h < 0.05 ? 'none' : formatDuration(h)}${open && h >= 0.05 ? ' or more (runs into the window edge)' : ''}` : 'not available');
    win.set('sunlight', `${pct(m.illuminationPct)} of the window`);
    win.set('dark', span(m.longestDarknessH, m.darknessOpenEnded));
    win.set('earth', `${pct(m.earthVisiblePct)} of the window`);
    win.set('gap', span(m.longestEarthGapH, m.earthGapOpenEnded));
    win.set('slope', Number.isFinite(a.slope.slopeDeg) ? `${deg(a.slope.slopeDeg)} over ${Math.round(a.slope.baselineM)} m` : 'not available: no elevation data here');
    winNote.textContent = 'Sunlight is the time-averaged visible part of the Sun\'s disc. Earth in view is geometric line of sight to Earth\'s centre, not a radio link. Both are measured against the terrain skyline.';
    if (store.get().site) renderSky(store.get().site!);
  };

  // ---------- elevation and the data behind it ----------
  let terrainToken = 0;
  const renderTerrain = async (site: SiteRef) => {
    const token = ++terrainToken;
    facts.set('elevation', 'Loading…');
    facts.set('coverage', null);
    dataMore.hidden = true;
    let stack: TerrainStack;
    try {
      stack = await loadTerrainFor(site);
    } catch (err) {
      if (token !== terrainToken) return;
      facts.set('elevation', `Not available: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (token !== terrainToken) return;
    const covering = stack.sources.filter((x) => x.covers(site.lat, site.lon));
    const finest = covering[0];
    const h = finest ? finest.sample(site.lat, site.lon) : NaN;
    facts.set('elevation', Number.isFinite(h) ? `${Math.round(h).toLocaleString('en-US').replace('-', '−')} m above the 1,737.4 km sphere` : 'No elevation data at this point');
    if (finest) {
      const line = `${resolutionText(finest.resolutionM)} grid: ${finest.name}`;
      facts.set('coverage', line);
      facts.rows.coverage.dd.title = line;
    }
    dataList.replaceChildren(
      ...stack.sources.map((src) => {
        const li = el('li');
        li.append(el('span', 'ly-value sc-res', resolutionText(src.resolutionM)), el('span', undefined, src.name));
        return li;
      }),
    );
    dataNotes.replaceChildren(...stack.notes.map((n) => el('p', undefined, n)));
    dataMore.hidden = !stack.sources.length && !stack.notes.length;
  };

  // Who the hardware belongs to (GCAT) and the area explored; both load once, then the card redraws.
  let owners: OwnershipIndex | null = null;
  let areas = new Map<string, SiteArea>();
  void Promise.all([loadOwnership(), loadSiteAreas()]).then(([o, a]) => {
    owners = o;
    areas = a;
    render();
  });
  const renderOwnership = (l: Landing | undefined) => {
    const o = l ? owners?.byLanding.get(l.id) : undefined;
    mismatch.hidden = true;
    if (!l) {
      facts.set('country', null);
      facts.set('owner', null);
      return;
    }
    if (!o || !owners) {
      facts.set('country', `${l.country} (not checked against a catalogue)`);
      facts.set('owner', null);
      return;
    }
    const link = el('a', undefined, 'GCAT');
    link.href = owners.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    const src = el('span', 'sc-source');
    src.append(' · source: ', link, ` ${o.jcat}`);
    const flag = flagCanvas(flagCode(o), 18);
    if (flag) flag.className = 'sc-flag';
    facts.set('country', '');
    facts.rows.country.dd.replaceChildren(...(flag ? [flag] : []), stateLabel(o), src);
    facts.set('owner', o.ownerName ?? o.owner);
    mismatch.hidden = !labelDisagrees(l.country, o);
    mismatch.textContent = `Check: this site's own data says "${l.country}", but the GCAT catalogue records ${o.stateFullName ?? o.state}.`;
  };
  const renderArea = (l: Landing | undefined) => {
    const area = l ? areas.get(l.id) : undefined;
    facts.set('area', !l ? null : area ? `${describeExtent(area)} (on the globe drawn up to ${AREA_DISPLAY_SCALE}× larger from orbit, true to size close to the ground)` : '—');
    areaNote.textContent = area?.note ?? '';
    areaNote.hidden = !area?.note;
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
      swatch.style.background = landingColor(l);
      programName.textContent = l.program;
    }
    // A scan candidate carries its own name ("Candidate 300 m W, 600 m S of ..."), as the nearby list and the assistant say it.
    title.textContent = l ? l.name : site.kind === 'candidate' ? site.name : 'Pinned location';
    const approx = l && (l as Landing & { approx?: boolean }).approx;
    where.textContent = `${formatCoords(site.lat, site.lon)}${approx ? ' (approx.)' : ''}`;
    facts.set('date', l ? `${formatDate(l.date)}, ${l.time} UTC` : null);
    renderOwnership(l);
    facts.set('type', l ? (l.crewed ? 'Crewed' : 'Robotic') : null);
    facts.set('region', l?.region ?? null);
    facts.set('coords', `${formatCoords(site.lat, site.lon)}${approx ? ' (approx.)' : ''}; longitude east-positive`);
    renderArea(l);
    renderCredit(site);
    summary.hidden = !l;
    summary.textContent = l?.summary ?? '';
    links.hidden = !l;
    atLanding.hidden = !l;
    nav.hidden = !l;
    if (l) {
      const when = formatUtc(landingDate(l).getTime());
      atLanding.title = `Set the clock and the start of the mission window to touchdown, ${when}`;
      atLanding.setAttribute('aria-label', `At landing time: set the clock and the mission window to touchdown, ${when}`);
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
    void renderTerrain(site);
  };

  store.subscribe(['site'], render);
  missionFilter.subscribe(render);
  // The window line follows the scenario at once; the numbers follow when the analysis lands.
  store.subscribe(['mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH'], () => store.get().site && renderAnalysis());
  analysis.subscribe((slot) => slot === 'current' && store.get().site && renderAnalysis());
  // While the clock runs, refresh Sun/Earth a few times a second rather than every frame. The
  // last change is always drawn: a change inside the quiet interval is drawn when it ends.
  const skyTick = throttle(() => {
    const site = store.get().site;
    if (site && !card.hidden && !body.hidden) renderSky(site);
  }, 250);
  store.subscribe(['timeMs'], skyTick);
  onPanelChange((panel, open) => panel === 'site-details' && open && store.get().site && renderSky(store.get().site!));
  render();

  // Escape closes the card, the left and right arrows step through the landings: globe view only,
  // and only a press nobody else has handled (see cardKeys.ts).
  bindCardKeys(window, {
    view: () => store.get().view,
    hasSite: () => store.get().site !== null,
    isTyping: (target) => isTypingTarget(target as EventTarget | null),
    act: (command) => {
      if (command === 'clearSite') void runAction('clearSite');
      else step(command === 'next' ? 1 : -1);
    },
  });
}
