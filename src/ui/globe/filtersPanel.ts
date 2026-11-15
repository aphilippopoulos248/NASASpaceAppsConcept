// Left "Filters" panel of the globe view, as in the mockup: the date (arrival, UTC), the point
// at the screen centre (live, editable), the solar elevation requirement, mission parameters,
// "Show previous missions" with their filters and country flags, and "Show optimal landing area" with a legend.
// Every control runs an action.
//
// The date at the top is the arrival: it starts the mission window and brings the clock there,
// so the analysis, the time slider and the lighting are all about the date that was typed.
import { runAction } from '../../core/actions';
import { effectiveStartMs } from '../../core/scenario';
import { store } from '../../core/store';
import { formatUtc, isoUtc } from '../../core/time';
import { getLandings } from '../../data/catalog';
import { button, el } from '../dom';
import { mountMissionFilters } from '../filters';
import { DEFAULT_RELIEF, globeDisplay, RELIEF_CHOICES, reliefText } from '../../scene/globe/displayState';
import { ICE_COLOUR } from '../../scene/globe/iceOutlines';
import { COVERAGE_STYLE } from '../../scene/globe/overlayStyle';
import { FULL_EXAGGERATION_KM, TRUE_SCALE_BELOW_KM } from '../../scene/globe/reliefTiles';
import { OVERLAYS, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayLegend';
import { initPanels, isPanelOpen, onPanelChange } from './panels';
import { mountPresetList } from './presetList';
import './filtersPanel.css';

let uid = 0;

/** The flags choice is remembered per browser; a link with ?flags=1 turns them on. */
const FLAGS_KEY = 'moon-landings:flags';
function flagsWanted(): boolean {
  if (new URLSearchParams(location.search).get('flags') === '1') return true;
  try {
    return localStorage.getItem(FLAGS_KEY) === '1';
  } catch {
    return false; // storage unavailable: start with flags off
  }
}

/** A labelled number input that runs `onCommit` on change and shows action errors inline. */
function numberField(label: string, unit: string, opts: { min?: number; max?: number; step?: number; width?: string }, onCommit: (v: number) => Promise<{ ok: boolean; error?: string }>) {
  const id = `fp-${++uid}`;
  const wrap = el('div', 'fp-num');
  const lab = el('label', 'ly-label', label);
  lab.htmlFor = id;
  const input = el('input', 'ly-input');
  input.id = id;
  input.type = 'number';
  input.inputMode = 'decimal';
  if (opts.min !== undefined) input.min = String(opts.min);
  if (opts.max !== undefined) input.max = String(opts.max);
  input.step = String(opts.step ?? 'any');
  if (opts.width) input.style.width = opts.width;
  const u = el('span', 'ly-unit', unit);
  const row = el('div', 'fp-num-row');
  row.append(input, u);
  wrap.append(lab, row);
  input.addEventListener('change', async () => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) return;
    const r = await onCommit(v);
    input.setAttribute('aria-invalid', String(!r.ok));
    input.title = r.ok ? '' : (r.error ?? '');
  });
  return { wrap, input, label: lab };
}

const set = (input: HTMLInputElement, value: string) => {
  if (document.activeElement !== input) input.value = value;
};

export function mountFiltersPanel(region: HTMLElement): void {
  const panel = el('div', 'ly-panel filters-panel');
  panel.append(el('h2', 'ly-panel-title', 'Filters'));

  // ---- Missions to replay: a real site, date and window in one step ----
  mountPresetList(panel);

  // ---- Arrival date and time (UTC): the start of the mission window ----
  const dateId = `fp-${++uid}`;
  const dateLab = el('label', 'ly-label', 'Arrival date and time (UTC)');
  dateLab.htmlFor = dateId;
  const date = el('input', 'ly-input');
  date.id = dateId;
  date.type = 'datetime-local';
  date.step = '60';
  date.title = 'Start of the mission window (UTC). Changing it also sets the clock to the arrival; the time slider then scrubs through the window.';
  date.addEventListener('change', async () => {
    if (!date.value) return;
    const r = await runAction('setMissionWindow', { startUtc: `${date.value}Z`, moveClock: true });
    date.setAttribute('aria-invalid', String(!r.ok));
  });
  const dateNote = el('p', 'ly-note fp-datenote');
  const dateField = el('div', 'ly-field');
  dateField.append(dateLab, date, dateNote);
  panel.append(dateField);

  // ---- Point at the screen centre ----
  panel.append(el('h3', 'ly-section-title', 'Centre of view'));
  const goto = (lat: number, lon: number) => runAction('setGlobeCamera', { lat, lon });
  // The other field's value is what the user sees (the camera may still be flying to an earlier target).
  const other = (input: HTMLInputElement, fallback: number) => (Number.isFinite(Number(input.value)) && input.value !== '' ? Number(input.value) : fallback);
  const lat = numberField('Latitude', '°N', { min: -90, max: 90, step: 0.01 }, (v) => goto(v, other(lon.input, store.get().globeCenter.lon)));
  const lon = numberField('Longitude', '°E', { min: -180, max: 180, step: 0.01 }, (v) => goto(other(lat.input, store.get().globeCenter.lat), v));
  const centreRow = el('div', 'fp-pair');
  centreRow.append(lat.wrap, lon.wrap);
  const pinHere = button('Drop pin at centre', 'ly-btn ly-btn--small fp-pin', () => {
    const c = store.get().globeCenter;
    void runAction('dropPin', { lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round(c.lon * 1e5) / 1e5 });
  });
  const altNote = el('p', 'ly-note fp-alt');
  panel.append(centreRow, pinHere, altNote);

  // ---- Solar elevation requirement ----
  panel.append(el('h3', 'ly-section-title', 'Solar elevation requirement'));
  const band = el('div', 'fp-band');
  const minF = numberField('Minimum', '°', { min: -90, max: 90, step: 0.5, width: '4.5em' }, (v) => runAction('setSunBand', { minDeg: v, maxDeg: store.get().sunElMaxDeg }));
  const maxF = numberField('Maximum', '°', { min: -90, max: 90, step: 0.5, width: '4.5em' }, (v) => runAction('setSunBand', { minDeg: store.get().sunElMinDeg, maxDeg: v }));
  for (const f of [minF, maxF]) f.label.classList.add('ly-visually-hidden');
  const alpha = el('span', 'fp-alpha', '< α <');
  alpha.setAttribute('aria-hidden', 'true');
  band.append(minF.wrap, alpha, maxF.wrap);
  band.setAttribute('role', 'group');
  band.setAttribute('aria-label', 'Solar elevation α must be above the minimum and below the maximum, degrees');
  panel.append(band, el('p', 'ly-note', 'α = Sun elevation above the local horizontal, degrees.'));

  // ---- Mission parameters ----
  panel.append(el('h3', 'ly-section-title', 'Mission'));
  const mast = numberField('Mast height', 'm', { min: 0, max: 100, step: 0.5, width: '5em' }, (v) => runAction('setMastHeight', { metres: v }));
  const winId = `fp-${++uid}`;
  const winLab = el('label', 'ly-label', 'Mission window');
  winLab.htmlFor = winId;
  const win = el('select', 'ly-select');
  win.id = winId;
  for (const [h, label] of [[24, '24 hours'], [72, '3 days'], [168, '7 days'], [336, '14 days'], [708, '29.5 days (lunar day)']] as const) win.append(new Option(label, String(h)));
  win.addEventListener('change', () => void runAction('setMissionWindow', { durationH: Number(win.value) }));
  const winField = el('div', 'fp-num');
  winField.append(winLab, win);
  const delay = numberField('Arrival delay', 'h', { min: 0, max: 720, step: 1, width: '5em' }, (v) => runAction('setDelay', { hours: v }));
  delay.input.title = 'Explore a late arrival at the same site: the mission window starts this many hours after the arrival date.';
  const mission = el('div', 'fp-pair');
  mission.append(mast.wrap, winField, delay.wrap);
  panel.append(mission);

  // ---- Terrain relief ----
  panel.append(el('h3', 'ly-section-title', 'Terrain relief'));
  const reliefId = `fp-${++uid}`;
  const reliefLab = el('label', 'ly-label', 'Exaggeration');
  reliefLab.htmlFor = reliefId;
  const relief = el('select', 'ly-select');
  relief.id = reliefId;
  const reliefLabel = (f: number) => (f === 0 ? 'Off (smooth sphere)' : f === 1 ? 'True scale (×1)' : `×${f}${f === DEFAULT_RELIEF ? ' (default)' : ''}`);
  for (const f of RELIEF_CHOICES) relief.append(new Option(reliefLabel(f), String(f)));
  relief.addEventListener('change', () => void runAction('setReliefExaggeration', { factor: Number(relief.value) }));
  const reliefField = el('div', 'fp-num');
  reliefField.append(reliefLab, relief);
  const reliefNote = el('p', 'ly-note');
  const cover = el('label', 'ly-check');
  const coverBox = el('input');
  coverBox.type = 'checkbox';
  coverBox.addEventListener('change', () => void runAction('showCoverage', { show: coverBox.checked }));
  cover.append(coverBox, el('span', undefined, 'Show elevation data coverage'));
  const coverLegend = el('div', 'ly-legend fp-coverlegend');
  for (const c of COVERAGE_STYLE) {
    const row = el('div', 'ly-legend-row');
    const sw = el('span', 'ly-swatch fp-outline');
    sw.style.borderColor = c.colour;
    row.append(sw, el('span', undefined, c.label));
    coverLegend.append(row);
  }
  coverLegend.append(
    el('p', 'ly-note', 'Squares show where each elevation grid exists: three around the south pole (LRO LOLA polar grids) and one set around each of the 28 catalogued landing sites (SLDEM2015, LOLA and LROC NAC models). Everywhere else rests on the LOLA whole-Moon grid (1.9 km per sample); for a pin, a 60 m window is built on request when the elevation server can be reached. No north-polar grid is bundled.'),
  );
  // Mapped ice targets (a science layer, not elevation data).
  const ice = el('label', 'ly-check');
  const iceBox = el('input');
  iceBox.type = 'checkbox';
  iceBox.addEventListener('change', () => void runAction('showIceTargets', { show: iceBox.checked }));
  ice.append(iceBox, el('span', undefined, 'Show mapped ice targets'));
  const iceLegend = el('div', 'ly-legend fp-coverlegend');
  const iceRow = el('div', 'ly-legend-row');
  const iceSwatch = el('span', 'ly-swatch fp-outline');
  iceSwatch.style.borderColor = ICE_COLOUR;
  iceRow.append(iceSwatch, el('span', undefined, 'Permanently shaded regions with water-ice signatures'));
  iceLegend.append(
    iceRow,
    el('p', 'ly-note', 'South polar region only: 169 regions of interest, outlined about 0.3 km wider than the listed shadowed areas. Targets for study, not confirmed deposits. Lemelin et al. 2021 (Zenodo 4646092), CC BY 4.0. Distances from a site are in its card.'),
  );
  panel.append(reliefField, reliefNote, cover, coverLegend, ice, iceLegend);

  // ---- Lighting ----
  panel.append(el('h3', 'ly-section-title', 'Sunlight on the globe'));
  const seg = el('div', 'ly-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Lighting');
  const modeButtons = (
    [
      ['real', 'Real', 'Sunlight from the true direction at the simulated time'],
      ['even', 'Even', 'Even lighting from the viewer, for readability (not real)'],
    ] as const
  ).map(([mode, label, title]) => {
    const b = button(label, 'ly-btn ly-btn--small', () => void runAction('setLightMode', { mode }));
    b.title = title;
    seg.append(b);
    return [mode, b] as const;
  });
  panel.append(seg);

  // ---- Show previous missions ----
  panel.append(el('hr', 'ly-divider'));
  const show = el('label', 'ly-check');
  const showBox = el('input');
  showBox.type = 'checkbox';
  showBox.addEventListener('change', () => void runAction('showMissions', { show: showBox.checked }));
  show.append(showBox, el('span', undefined, 'Show previous missions'));
  const flags = el('label', 'ly-check fp-flags');
  const flagsBox = el('input');
  flagsBox.type = 'checkbox';
  flagsBox.addEventListener('change', () => void runAction('showFlags', { show: flagsBox.checked }));
  flags.append(flagsBox, el('span', undefined, 'Show country flags'));
  flags.title = 'A flag on each landing for the state its hardware belongs to (GCAT catalogue)';
  const missions = el('details', 'fp-missions');
  missions.append(el('summary', 'fp-summary', 'Mission filters'));
  const body = el('div', 'fp-mission-body');
  missions.append(body);
  panel.append(show, flags, missions);

  // ---- Show optimal landing area ----
  const opt = el('label', 'ly-check');
  const optBox = el('input');
  optBox.type = 'checkbox';
  opt.append(optBox, el('span', undefined, 'Show optimal landing area'));
  const overlayId = `fp-${++uid}`;
  const overlay = el('select', 'ly-select');
  overlay.id = overlayId;
  overlay.setAttribute('aria-label', 'Landing-area overlay');
  for (const o of OVERLAYS) overlay.append(new Option(o.label, o.mode));
  let lastOverlay: string = OVERLAYS[0].mode;
  optBox.addEventListener('change', () => void runAction('setOverlay', { mode: optBox.checked ? overlay.value : 'off' }));
  overlay.addEventListener('change', () => {
    lastOverlay = overlay.value;
    void runAction('setOverlay', { mode: overlay.value });
  });
  const legend = el('div', 'ly-legend fp-legend');
  const overlayBox = el('div', 'fp-overlay');
  overlayBox.append(overlay, legend);
  panel.append(el('hr', 'ly-divider'), opt, overlayBox);

  region.append(panel);
  mountMissionFilters(body, getLandings());

  const renderLegend = () => {
    const s = store.get();
    const info = OVERLAYS.find((o) => o.mode === s.overlay);
    legend.replaceChildren();
    if (!info) return;
    if (info.kind === 'band') {
      const row = el('div', 'ly-legend-row');
      const sw = el('span', 'ly-swatch');
      sw.style.background = SUN_BAND_COLOUR;
      row.append(sw, el('span', undefined, `Sun between ${s.sunElMinDeg}° and ${s.sunElMaxDeg}° at ${isoUtc(s.timeMs)}`));
      legend.append(row);
      legend.append(el('p', 'ly-note', info.meaning(s.sunElMinDeg, s.sunElMaxDeg)));
      return;
    }
    // The multi-year average maps: their own legend, in the words of the data's own index.
    const avg = globeDisplay.getLive().averages;
    const ramp = el('div', 'ly-legend-ramp');
    ramp.style.background = `linear-gradient(to right, ${OVERLAY_RAMP.join(', ')})`;
    const scale = el('div', 'ly-legend-scale');
    scale.append(el('span', undefined, '0 % (never)'), el('span', undefined, '50 %'), el('span', undefined, '100 % of time'));
    legend.append(ramp, scale);
    if (avg.state !== 'ready') {
      const status = el('p', 'ly-note fp-avgstatus', avg.state === 'missing' ? avg.reason : 'Loading the map…');
      status.setAttribute('role', 'status');
      legend.append(status, el('p', 'ly-note', info.meaning(s.sunElMinDeg, s.sunElMaxDeg)));
      return;
    }
    const l = avg.legend;
    legend.append(el('p', 'ly-note', l.meaning), el('p', 'ly-note', `Where: ${l.extent}`));
    const more = el('details', 'fp-avgmore');
    more.append(el('summary', undefined, 'Source, averaging period and limits'));
    for (const text of [`Averaging period: ${l.period}`, `Source: ${l.source}`, ...l.processing, ...l.caveats, l.citation]) more.append(el('p', 'ly-note', text));
    legend.append(more);
  };

  let lastLegendMs = -Infinity;
  const sync = (changed?: ReadonlySet<string>) => {
    const s = store.get();
    set(date, isoUtc(s.windowStartMs).slice(0, 16));
    dateNote.hidden = s.delayH === 0;
    dateNote.textContent = s.delayH === 0 ? '' : `With the ${s.delayH} h delay the mission window starts ${formatUtc(effectiveStartMs(s))}.`;
    set(delay.input, String(s.delayH));
    set(lat.input, s.globeCenter.lat.toFixed(2));
    set(lon.input, s.globeCenter.lon.toFixed(2));
    const alt = s.globeCenter.altitudeKm;
    altNote.textContent = `Camera altitude ${alt >= 100 ? Math.round(alt).toLocaleString('en-US') : alt.toFixed(1)} km · longitude east-positive`;
    set(minF.input, String(s.sunElMinDeg));
    set(maxF.input, String(s.sunElMaxDeg));
    set(mast.input, String(s.mastHeightM));
    if (![...win.options].some((o) => Number(o.value) === s.windowDurationH)) win.append(new Option(`${s.windowDurationH} hours`, String(s.windowDurationH)));
    win.value = String(s.windowDurationH);
    for (const [mode, b] of modeButtons) b.setAttribute('aria-pressed', String(s.lightMode === mode));
    showBox.checked = s.showMissions;
    flagsBox.checked = s.showFlags;
    flagsBox.disabled = !s.showMissions;
    flags.classList.toggle('off', !s.showMissions);
    missions.classList.toggle('off', !s.showMissions);
    optBox.checked = s.overlay !== 'off';
    overlay.value = s.overlay !== 'off' ? s.overlay : lastOverlay;
    overlayBox.hidden = s.overlay === 'off';
    // The sun-band legend names the time: refresh it at most a few times a second while playing.
    const timeOnly = changed && changed.size === 1 && changed.has('timeMs');
    if (!timeOnly || (s.overlay === 'sun-band' && performance.now() - lastLegendMs > 500)) {
      renderLegend();
      lastLegendMs = performance.now();
    }
  };
  const syncDisplay = () => {
    const d = globeDisplay.get(), live = globeDisplay.getLive();
    if (![...relief.options].some((o) => Number(o.value) === d.reliefFactor)) relief.append(new Option(reliefLabel(d.reliefFactor), String(d.reliefFactor)));
    relief.value = String(d.reliefFactor);
    const data = live.reliefPpd ? `LOLA whole-Moon elevation, ${live.reliefPpd} samples per degree (${live.reliefPpd >= 16 ? '1.9' : '7.6'} km).` : live.reliefProblem ?? 'Loading the elevation grid…';
    const rule = d.reliefFactor > 1 ? ` Drawn now: ${reliefText(live.reliefNow)}. The stretch applies above ${FULL_EXAGGERATION_KM.toLocaleString('en-US')} km camera altitude and eases to true scale below ${TRUE_SCALE_BELOW_KM} km.` : '';
    reliefNote.textContent = `${data}${rule}`;
    coverBox.checked = d.coverage;
    coverLegend.hidden = !d.coverage;
    iceBox.checked = d.iceTargets;
    iceLegend.hidden = !d.iceTargets;
  };
  let shownAverages = globeDisplay.getLive().averages;
  globeDisplay.subscribe(() => {
    syncDisplay();
    // The average map's legend follows its loading state.
    if (globeDisplay.getLive().averages !== shownAverages) {
      shownAverages = globeDisplay.getLive().averages;
      renderLegend();
    }
  });
  syncDisplay();

  // A field is not overwritten while it has the focus (someone may be typing in it); bring it
  // back in step when the focus leaves.
  panel.addEventListener('focusout', () => queueMicrotask(() => sync()));
  store.subscribe(['timeMs', 'globeCenter', 'sunElMinDeg', 'sunElMaxDeg', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH', 'lightMode', 'showMissions', 'showFlags', 'overlay'], (_s, changed) => sync(changed));
  sync();
  if (flagsWanted()) void runAction('showFlags', { show: true });
  store.subscribe(['showFlags'], (s) => {
    try {
      localStorage.setItem(FLAGS_KEY, s.showFlags ? '1' : '0');
    } catch {
      /* not remembered; fine */
    }
  });

  // Narrow screens: the panel is a sheet opened from the "Filters" button (the showPanel action).
  initPanels();
  const toggle = document.getElementById('left-toggle');
  const syncSheet = () => {
    const open = isPanelOpen('filters');
    document.body.classList.toggle('left-open', open);
    toggle?.setAttribute('aria-expanded', String(open));
  };
  toggle?.addEventListener('click', () => void runAction('showPanel', { panel: 'filters', open: !document.body.classList.contains('left-open') }));
  onPanelChange((which) => which === 'filters' && syncSheet());
  window.matchMedia('(max-width: 700px)').addEventListener('change', syncSheet);
  syncSheet();
}
