// Time scrubber along the bottom (both views): play/pause, a 0-24 h slider across the
// current UTC day, the exact UTC date/time, "now" and playback speed. Every control is an
// action; the clock itself lives in the store.
// (T-12 / @surface add sunrise/sunset marks for the selected site.)
import { moonGeometry, phaseName } from '../../astro/ephemeris';
import { runAction } from '../../core/actions';
import { RATE_PRESETS } from '../../core/coreActions';
import { MAX_TIME_MS, MIN_TIME_MS, store } from '../../core/store';
import { isoUtc } from '../../core/time';
import { button, el } from '../dom';
import './timeScrubber.css';

const DAY_MS = 86_400_000;
const STEP_MIN = 10;

export function mountTimeScrubber(region: HTMLElement): void {
  const bar = el('div', 'ly-panel time-scrubber');
  const play = button('Play', 'ly-btn ly-btn--icon ts-play');
  play.addEventListener('click', () => void runAction(store.get().playing ? 'pause' : 'play'));

  const sliderWrap = el('div', 'ts-slider');
  const slider = el('input', 'ts-range');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(24 * 60);
  slider.step = String(STEP_MIN);
  slider.setAttribute('aria-label', 'Time of day, UTC');
  const scale = el('div', 'ts-scale');
  scale.append(el('span', 'ly-value', '0 h'), el('span', 'ly-value', '12 h'), el('span', 'ly-value', '24 h UTC'));
  sliderWrap.append(slider, scale);
  slider.addEventListener('input', () => {
    const day = Math.floor(store.get().timeMs / DAY_MS) * DAY_MS;
    void runAction('setTime', { utc: isoUtc(day + Number(slider.value) * 60_000) });
  });

  const when = el('label', 'ts-when');
  const date = el('input', 'ly-input ts-date');
  date.type = 'datetime-local';
  date.step = '60';
  date.min = new Date(MIN_TIME_MS).toISOString().slice(0, 16);
  date.max = new Date(MAX_TIME_MS).toISOString().slice(0, 16);
  date.setAttribute('aria-label', 'Date and time, UTC');
  when.append(date, el('span', 'ly-label', 'UTC'));
  date.addEventListener('change', async () => {
    if (!date.value) return;
    const r = await runAction('setTime', { utc: `${date.value}Z` });
    date.setAttribute('aria-invalid', String(!r.ok));
    date.title = r.ok ? '' : r.error;
  });

  const now = button('Now', 'ly-btn ly-btn--small', () => void runAction('setTime', { utc: isoUtc(Date.now()) }));
  now.title = 'Set the clock to the current real time';
  const rate = el('select', 'ly-select ts-rate');
  rate.setAttribute('aria-label', 'Playback speed');
  for (const p of RATE_PRESETS) rate.append(new Option(p.label, String(p.secondsPerSecond)));
  rate.addEventListener('change', () => void runAction('setRate', { secondsPerSecond: Number(rate.value) }));

  const readout = el('p', 'ly-note ts-readout');
  readout.setAttribute('aria-live', 'off');

  const row = el('div', 'ts-row');
  row.append(when, now, rate, readout);
  bar.append(play, sliderWrap, row);
  region.append(bar);

  let lastPhase = -Infinity;
  const sync = () => {
    const s = store.get();
    play.textContent = s.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    play.setAttribute('aria-pressed', String(s.playing));
    const minutes = Math.round((s.timeMs % DAY_MS) / 60_000 / STEP_MIN) * STEP_MIN;
    if (document.activeElement !== slider || s.playing) slider.value = String(minutes);
    slider.setAttribute('aria-valuetext', `${isoUtc(s.timeMs).slice(11, 16)} UTC, ${isoUtc(s.timeMs).slice(0, 10)}`);
    if (document.activeElement !== date) date.value = isoUtc(s.timeMs).slice(0, 16);
    if (!RATE_PRESETS.some((p) => p.secondsPerSecond === s.rate)) {
      if (![...rate.options].some((o) => Number(o.value) === s.rate)) rate.append(new Option(`${s.rate} s/s`, String(s.rate)));
    }
    rate.value = String(s.rate);
    bar.classList.toggle('even', s.lightMode === 'even');
    if (performance.now() - lastPhase > 250) {
      const g = moonGeometry(new Date(s.timeMs));
      readout.textContent = `${phaseName(g)} · ${Math.round(g.litFraction * 100)}% lit from Earth`;
      lastPhase = performance.now();
    }
  };
  store.subscribe(['timeMs', 'playing', 'rate', 'lightMode'], sync);
  sync();
}
