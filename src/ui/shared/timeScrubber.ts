// Time scrubber along the bottom (both views): scrubs the shared clock across the mission
// window (24 h by default), with play/pause, speed, the exact UTC instant, the window length,
// and - once the site analysis is ready - sunrise/sunset/Earthrise/Earthset marks and
// jump-to-event buttons. Every control is an action.
import type { SkyEvent } from '../../analysis/types';
import { moonGeometry, phaseName } from '../../astro/ephemeris';
import { ActionError, defineAction, registerActions, runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { RATE_PRESETS } from '../../core/coreActions';
import { effectiveStartMs } from '../../core/scenario';
import { findEvent } from '../../core/skyEvents';
import { MAX_TIME_MS, MIN_TIME_MS, store } from '../../core/store';
import { formatUtc, isoUtc } from '../../core/time';
import { button, el } from '../dom';
import './timeScrubber.css';

type EventType = SkyEvent['type'];
const EVENTS: { type: EventType; label: string; glyph: string; body: 'sun' | 'earth' }[] = [
  { type: 'sunrise', label: 'Sunrise', glyph: '☀↑', body: 'sun' },
  { type: 'sunset', label: 'Sunset', glyph: '☀↓', body: 'sun' },
  { type: 'earthrise', label: 'Earthrise', glyph: '⊕↑', body: 'earth' },
  { type: 'earthset', label: 'Earthset', glyph: '⊕↓', body: 'earth' },
];
export const WINDOW_CHOICES = [
  [24, '24 h'],
  [72, '3 days'],
  [168, '7 days'],
  [336, '14 days'],
  [708, '29.5 days'],
] as const;

/** Events of the current analysis, or why there are none. */
function currentEvents(): { events: SkyEvent[] } | { reason: string } {
  const st = analysis.get('current');
  switch (st.state) {
    case 'idle': return { reason: 'Select a site or drop a pin to see sunrise, sunset, Earthrise and Earthset.' };
    case 'loading': return { reason: 'Analysing the site…' };
    case 'error': return { reason: st.notAvailable ? 'Sunrise/sunset marks appear when the site analysis is available (not merged yet).' : `No event marks: ${st.error}` };
    case 'ready': return { events: st.value.events };
  }
}

export function mountTimeScrubber(region: HTMLElement): void {
  registerActions([
    defineAction<{ type: EventType; which?: 'next' | 'previous' }, unknown>({
      name: 'jumpToEvent',
      title: 'Jump to sunrise/sunset/Earthrise/Earthset',
      description: 'Moves the clock to the next (or previous) sunrise, sunset, Earthrise or Earthset at the selected site, from the site analysis (terrain skyline included). Needs a site whose analysis is ready.',
      effect: 'command',
      params: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'Event type.', enum: EVENTS.map((e) => e.type) },
          which: { type: 'string', description: 'next (default) or previous, relative to the current simulated time.', enum: ['next', 'previous'] },
        },
        required: ['type'],
      },
      run: async ({ type, which = 'next' }) => {
        const ev = currentEvents();
        if ('reason' in ev) throw new ActionError(ev.reason);
        const t = store.get().timeMs;
        const hit = findEvent(ev.events, type, which, t);
        if (!hit) throw new ActionError(`No ${which} ${type} inside the analysed mission window.`);
        await runAction('pause');
        const r = await runAction('setTime', { utc: new Date(hit.timeMs).toISOString().slice(0, 19) + 'Z' });
        if (!r.ok) throw new ActionError(r.error);
        return { event: type, timeUtc: isoUtc(hit.timeMs), azDeg: hit.azDeg };
      },
    }),
  ]);

  const bar = el('div', 'ly-panel time-scrubber');
  const play = button('', 'ly-btn ly-btn--icon ts-play');
  play.addEventListener('click', () => void runAction(store.get().playing ? 'pause' : 'play'));

  // ---- the slider across the mission window ----
  const track = el('div', 'ts-track');
  const slider = el('input', 'ts-range');
  slider.type = 'range';
  slider.min = '0';
  slider.setAttribute('aria-label', 'Time within the mission window');
  const marks = el('div', 'ts-marks');
  marks.setAttribute('aria-hidden', 'true');
  track.append(marks, slider);
  const scale = el('div', 'ts-scale');
  const scaleStart = el('span', 'ly-value');
  const scaleMid = el('span', 'ly-value ts-now');
  const scaleEnd = el('span', 'ly-value');
  scale.append(scaleStart, scaleMid, scaleEnd);
  const sliderWrap = el('div', 'ts-slider');
  sliderWrap.append(track, scale);
  slider.addEventListener('input', () => {
    const s = store.get();
    const ms = effectiveStartMs(s) + Number(slider.value) * 60_000;
    void runAction('setTime', { utc: new Date(ms).toISOString().slice(0, 19) + 'Z' });
  });

  // ---- controls row ----
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
  const win = el('select', 'ly-select ts-window');
  win.setAttribute('aria-label', 'Mission window length');
  for (const [h, label] of WINDOW_CHOICES) win.append(new Option(`Window ${label}`, String(h)));
  win.addEventListener('change', () => void runAction('setMissionWindow', { durationH: Number(win.value) }));
  const startHere = button('Start window here', 'ly-btn ly-btn--small', () => void runAction('setMissionWindow', { startUtc: 'now' }));
  startHere.title = 'Make the current simulated time the start of the mission window';

  const jumps = el('div', 'ts-jumps');
  jumps.setAttribute('role', 'group');
  jumps.setAttribute('aria-label', 'Jump to the next event');
  for (const e of EVENTS) {
    const b = button(`${e.glyph} ${e.label}`, `ly-btn ly-btn--small ts-jump ts-${e.body}`, () => void runAction('jumpToEvent', { type: e.type }));
    b.setAttribute('aria-label', `Jump to the next ${e.label.toLowerCase()}`);
    jumps.append(b);
  }
  const eventNote = el('span', 'ly-note ts-eventnote');
  const readout = el('span', 'ly-note ts-readout');

  const row = el('div', 'ts-row');
  row.append(when, now, rate, win, startHere, jumps, eventNote, readout);
  bar.append(play, sliderWrap, row);
  region.append(bar);

  let lastPhase = -Infinity;
  const syncWindow = () => {
    const s = store.get();
    const start = effectiveStartMs(s);
    const minutes = Math.round(s.windowDurationH * 60);
    slider.max = String(minutes);
    slider.step = s.windowDurationH <= 24 ? '1' : '10';
    scaleStart.textContent = `0 h · ${formatUtc(start)}`;
    scaleEnd.textContent = `${s.windowDurationH} h`;
    if (![...win.options].some((o) => Number(o.value) === s.windowDurationH)) win.append(new Option(`Window ${s.windowDurationH} h`, String(s.windowDurationH)));
    win.value = String(s.windowDurationH);
    renderMarks();
  };
  const renderMarks = () => {
    const s = store.get();
    const start = effectiveStartMs(s), span = s.windowDurationH * 3_600_000;
    const ev = currentEvents();
    marks.replaceChildren();
    const ready = 'events' in ev;
    jumps.hidden = !ready;
    eventNote.hidden = ready;
    eventNote.textContent = ready ? '' : ev.reason;
    if (!ready) return;
    for (const e of ev.events) {
      const f = (e.timeMs - start) / span;
      if (f < 0 || f > 1) continue;
      const info = EVENTS.find((x) => x.type === e.type)!;
      const m = el('span', `ts-mark ts-${info.body}`, info.glyph);
      m.style.left = `${f * 100}%`;
      m.title = `${info.label} ${formatUtc(e.timeMs)}, azimuth ${e.azDeg.toFixed(1)}°`;
      marks.append(m);
    }
  };
  const sync = () => {
    const s = store.get();
    play.textContent = s.playing ? '❚❚' : '▶';
    play.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    play.setAttribute('aria-pressed', String(s.playing));
    const start = effectiveStartMs(s);
    const offMin = (s.timeMs - start) / 60_000;
    const inside = offMin >= 0 && offMin <= Number(slider.max);
    if (document.activeElement !== slider || s.playing) slider.value = String(Math.max(0, Math.min(Number(slider.max), offMin)));
    bar.classList.toggle('outside', !inside);
    const hrs = offMin / 60;
    scaleMid.textContent = inside ? `+${hrs.toFixed(hrs < 10 ? 1 : 0)} h · ${formatUtc(s.timeMs)}` : `${formatUtc(s.timeMs)} (outside the window)`;
    slider.setAttribute('aria-valuetext', inside ? `${hrs.toFixed(1)} hours into the window, ${formatUtc(s.timeMs)}` : `${formatUtc(s.timeMs)}, outside the mission window`);
    startHere.hidden = inside && offMin < 1;
    if (document.activeElement !== date) date.value = isoUtc(s.timeMs).slice(0, 16);
    if (![...rate.options].some((o) => Number(o.value) === s.rate)) rate.append(new Option(`${s.rate} s/s`, String(s.rate)));
    rate.value = String(s.rate);
    bar.classList.toggle('even', s.lightMode === 'even');
    if (performance.now() - lastPhase > 250) {
      const g = moonGeometry(new Date(s.timeMs));
      readout.textContent = `${phaseName(g)} · ${Math.round(g.litFraction * 100)}% lit from Earth`;
      lastPhase = performance.now();
    }
  };
  store.subscribe(['windowStartMs', 'windowDurationH', 'delayH'], () => {
    syncWindow();
    sync();
  });
  store.subscribe(['timeMs', 'playing', 'rate', 'lightMode'], sync);
  analysis.subscribe((slot) => slot === 'current' && renderMarks());
  syncWindow();
  sync();
}
