// Left "Filters" panel of the globe view, as in the mockup: the date (arrival, UTC), the point
// selected for analysis (editable), the solar elevation requirement, mission parameters,
// and "Show previous missions" with their filters and country flags.
// Every control runs an action.
//
// The date at the top is the arrival: it starts the mission window and brings the clock there,
// so the analysis, the time slider and the lighting are all about the date that was typed.
import { runAction } from '../../core/actions';
import { effectiveStartMs } from '../../core/scenario';
import { DEFAULT_SELECTED_POINT, store } from '../../core/store';
import { formatUtc, isoUtc } from '../../core/time';
import { getLandings } from '../../data/catalog';
import { button, el } from '../dom';
import { showFieldOutcome } from '../fieldStatus';
import { mountMissionFilters } from '../filters';
import { globeDisplay, reliefText } from '../../scene/globe/displayState';
import { ICE_COLOUR } from '../../scene/globe/iceOutlines';
import { initPanels, isPanelOpen, onPanelChange } from './panels';
import { fieldText, fieldValue, pinPoint, type Written } from './centreFields';
import { mountLandingSearch } from './landingSearch';
import { mountLandingPicker } from './landingPicker';
import { mountPresetList } from './presetList';
import './filtersPanel.css';

let uid = 0;

/** The flags choice is remembered per browser; a link with ?flags=1 turns them on. */
const FLAGS_KEY = 'moon-landings:flags';
/** The flags are on unless `?flags=0` or a remembered choice says otherwise. */
function flagsWanted(): boolean {
  const param = new URLSearchParams(location.search).get('flags');
  if (param === '1') return true;
  if (param === '0') return false;
  try {
    return localStorage.getItem(FLAGS_KEY) !== '0';
  } catch {
    return true; // storage unavailable: start with the default, flags on
  }
}

/** A labelled number input that runs `onCommit` on change and shows action errors inline. */
function numberField(label: string, unit: string, opts: { min?: number; max?: number; step?: number; width?: string }, onCommit?: (v: number) => Promise<{ ok: boolean; error?: string }>) {
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
  if (onCommit) input.addEventListener('change', async () => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v)) return;
    const r = await onCommit(v);
    showFieldOutcome(input, r);
  });
  return { wrap, input, label: lab };
}

const set = (input: HTMLInputElement, value: string) => {
  if (document.activeElement !== input) input.value = value;
};

export function mountFiltersPanel(region: HTMLElement): void {
  const panel = el('div', 'ly-panel filters-panel');
  panel.append(el('h2', 'ly-panel-title', 'Filters'));

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
    showFieldOutcome(date, r);
  });
  const dateNote = el('p', 'ly-note fp-datenote');
  const dateField = el('div', 'ly-field');
  dateField.append(dateLab, date, dateNote);
  panel.append(dateField);

  // ---- Selected point ----
  panel.append(el('h3', 'ly-section-title', 'Selected point'));
  // Camera movement must never change the selected coordinates or the search centre.
  const written: Record<'lat' | 'lon', Written | null> = { lat: null, lon: null };
  const selectedPoint = () => store.get().site ?? DEFAULT_SELECTED_POINT;
  const lat = numberField('Latitude', '°N', { min: -90, max: 90, step: 0.01 });
  const lon = numberField('Longitude', '°E', { min: -180, max: 180, step: 0.01 });
  const centreRow = el('div', 'fp-pair');
  centreRow.append(lat.wrap, lon.wrap);
  const enteredPoint = () => {
    const latitude = fieldValue(lat.input.value, written.lat);
    const longitude = fieldValue(lon.input.value, written.lon);
    const latError = latitude === null || latitude < -90 || latitude > 90 ? 'Enter a latitude between -90 and 90 degrees.' : '';
    const lonError = longitude === null || longitude < -180 || longitude > 180 ? 'Enter a longitude between -180 and 180 degrees.' : '';
    showFieldOutcome(lat.input, { ok: !latError, error: latError });
    showFieldOutcome(lon.input, { ok: !lonError, error: lonError });
    if (latitude === null || longitude === null || latError || lonError) throw new Error(latError || lonError);
    return pinPoint({ lat: latitude, lon: longitude });
  };
  const pinHere = button('Drop pin', 'ly-btn ly-btn--small fp-pin', async () => {
    try {
      const outcome = await runAction('dropPin', { ...enteredPoint(), fly: true });
      showFieldOutcome(pinHere, outcome);
    } catch (err) {
      showFieldOutcome(pinHere, { ok: false, error: err instanceof Error ? err.message : 'Check the coordinates above.' });
    }
  });
  pinHere.title = 'Select the entered latitude and longitude and fly the globe to the pin.';
  panel.append(centreRow);
  mountLandingSearch(panel, enteredPoint);
  panel.append(pinHere);

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
  const reliefNote = el('p', 'ly-note');
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
  iceLegend.append(iceRow);
  panel.append(reliefNote, ice, iceLegend);

  // ---- Show previous missions ----
  panel.append(el('hr', 'ly-divider'));
  const show = el('label', 'ly-check');
  const showBox = el('input');
  showBox.type = 'checkbox';
  showBox.addEventListener('change', () => void runAction('showMissions', { show: showBox.checked }));
  show.append(showBox, el('span', undefined, 'Show previous missions'));
  show.title = 'Marks each catalogued landing on the globe.';
  const territories = el('label', 'ly-check fp-flags');
  const territoriesBox = el('input');
  territoriesBox.type = 'checkbox';
  territoriesBox.addEventListener('change', () => void runAction('showTerritories', { show: territoriesBox.checked }));
  territories.append(territoriesBox, el('span', undefined, 'Show country territories'));
  territories.title = 'Colours the whole Moon by the country of the nearest landing shown: neighbouring landings of one country share one territory. Not a legal boundary: no country owns lunar ground.';
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
  panel.append(show, territories, flags, missions);
  // The keyboard and screen-reader way to a landing: the markers answer only to the pointer.
  mountLandingPicker(panel);

  // ---- Missions to replay, last in the panel: a real site, date and window in one step ----
  panel.append(el('hr', 'ly-divider'));
  mountPresetList(panel);

  region.append(panel);
  mountMissionFilters(body, getLandings());

  /** Only a new selection replaces the fields; drafts survive camera moves and focus changes. */
  const syncPoint = () => {
    const p = selectedPoint();
    for (const [which, input] of [['lat', lat.input], ['lon', lon.input]] as const) {
      const text = fieldText(p[which]);
      input.value = text;
      written[which] = { text, value: p[which] };
      showFieldOutcome(input, { ok: true });
    }
  };
  store.subscribe(['site'], syncPoint);
  syncPoint();

  const sync = () => {
    const s = store.get();
    set(date, isoUtc(s.windowStartMs).slice(0, 16));
    dateNote.hidden = s.delayH === 0;
    dateNote.textContent = s.delayH === 0 ? '' : `With the ${s.delayH} h delay the mission window starts ${formatUtc(effectiveStartMs(s))}.`;
    set(delay.input, String(s.delayH));
    set(minF.input, String(s.sunElMinDeg));
    set(maxF.input, String(s.sunElMaxDeg));
    set(mast.input, String(s.mastHeightM));
    if (![...win.options].some((o) => Number(o.value) === s.windowDurationH)) win.append(new Option(`${s.windowDurationH} hours`, String(s.windowDurationH)));
    win.value = String(s.windowDurationH);
    showBox.checked = s.showMissions;
    territoriesBox.checked = s.showTerritories;
    territoriesBox.disabled = !s.showMissions;
    territories.classList.toggle('off', !s.showMissions);
    flagsBox.checked = s.showFlags;
    flagsBox.disabled = !s.showMissions;
    flags.classList.toggle('off', !s.showMissions);
    missions.classList.toggle('off', !s.showMissions);
  };
  const syncDisplay = () => {
    const d = globeDisplay.get(), live = globeDisplay.getLive();
    const data = live.reliefPpd ? `LOLA whole-Moon elevation, ${live.reliefPpd} samples per degree (${live.reliefPpd >= 16 ? '1.9' : '7.6'} km).` : live.reliefProblem ?? 'Loading the elevation grid…';
    reliefNote.textContent = live.reliefPpd ? `${data} Drawn now: ${reliefText(live.reliefNow)}.` : data;
    iceBox.checked = d.iceTargets;
    iceLegend.hidden = !d.iceTargets;
  };
  globeDisplay.subscribe(syncDisplay);
  syncDisplay();

  // A field is not overwritten while it has the focus (someone may be typing in it); bring it
  // back in step when the focus leaves.
  panel.addEventListener('focusout', () => queueMicrotask(() => sync()));
  store.subscribe(['sunElMinDeg', 'sunElMaxDeg', 'mastHeightM', 'windowStartMs', 'windowDurationH', 'delayH', 'showMissions', 'showTerritories', 'showFlags'], () => sync());
  sync();
  if (flagsWanted() !== store.get().showFlags) void runAction('showFlags', { show: flagsWanted() });
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
