// Left "Filters" panel of the globe view, as in the mockup: date/time (UTC), the point at the
// screen centre (live, editable), the solar elevation requirement, mission parameters,
// "Show previous missions" with their filters and country flags, and "Show optimal landing area"
// with a legend.
// Every control runs an action.
import { runAction } from '../../core/actions';
import { store } from '../../core/store';
import { isoUtc } from '../../core/time';
import { getLandings } from '../../data/catalog';
import { button, el } from '../dom';
import { mountMissionFilters } from '../filters';
import { OVERLAYS, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayLegend';
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

  // ---- Date and time (UTC) ----
  const dateId = `fp-${++uid}`;
  const dateLab = el('label', 'ly-label', 'Date and time (UTC)');
  dateLab.htmlFor = dateId;
  const date = el('input', 'ly-input');
  date.id = dateId;
  date.type = 'datetime-local';
  date.step = '60';
  date.addEventListener('change', async () => {
    if (!date.value) return;
    const r = await runAction('setTime', { utc: `${date.value}Z` });
    date.setAttribute('aria-invalid', String(!r.ok));
  });
  const dateField = el('div', 'ly-field');
  dateField.append(dateLab, date);
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
  for (const [h, label] of [[24, '24 hours'], [72, '3 days'], [168, '7 days'], [336, '14 days'], [708, '29.5 days (one lunar day)']] as const) win.append(new Option(label, String(h)));
  win.addEventListener('change', () => void runAction('setMissionWindow', { durationH: Number(win.value) }));
  const winField = el('div', 'fp-num');
  winField.append(winLab, win);
  const mission = el('div', 'fp-pair');
  mission.append(mast.wrap, winField);
  panel.append(mission);

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
    } else {
      const ramp = el('div', 'ly-legend-ramp');
      ramp.style.background = `linear-gradient(to right, ${OVERLAY_RAMP.join(', ')})`;
      const scale = el('div', 'ly-legend-scale');
      scale.append(el('span', undefined, '0 %'), el('span', undefined, '50 %'), el('span', undefined, '100 % of time'));
      legend.append(ramp, scale);
    }
    legend.append(el('p', 'ly-note', info.meaning(s.sunElMinDeg, s.sunElMaxDeg)));
  };

  let lastLegendMs = -Infinity;
  const sync = (changed?: ReadonlySet<string>) => {
    const s = store.get();
    set(date, isoUtc(s.timeMs).slice(0, 16));
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
  store.subscribe(['timeMs', 'globeCenter', 'sunElMinDeg', 'sunElMaxDeg', 'mastHeightM', 'windowDurationH', 'lightMode', 'showMissions', 'showFlags', 'overlay'], (_s, changed) => sync(changed));
  sync();
  if (flagsWanted()) void runAction('showFlags', { show: true });
  store.subscribe(['showFlags'], (s) => {
    try {
      localStorage.setItem(FLAGS_KEY, s.showFlags ? '1' : '0');
    } catch {
      /* not remembered; fine */
    }
  });

  // Narrow screens: the panel is a sheet opened from the "Filters" button.
  const toggle = document.getElementById('left-toggle');
  toggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('left-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}
