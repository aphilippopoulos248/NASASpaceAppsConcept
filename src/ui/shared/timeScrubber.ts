// Time scrubber along the bottom (both views): scrubs the shared clock across the mission
// window (24 h by default), with play/pause, speed, the exact UTC instant, the window length,
// and - once the site analysis is ready - sunrise/sunset/Earthrise/Earthset marks and
// jump-to-event buttons. Every control is an action (jumpToEvent is in core/coreActions.ts).
//
// A rise or a set is not one moment (decision D-8), so no mark, button or tooltip here names a
// "sunset" with a time on its own: each says which instant it is ("Sun fully set"), in the
// words of core/skyEvents.ts, which the actions use too.
import type { SiteAnalysis, SkyEvent } from '../../analysis/types';
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { RATE_PRESETS } from '../../core/coreActions';
import { moonPhaseAt, moonPhaseDetail, moonPhaseText } from '../../core/moonPhase';
import { effectiveStartMs, spanText } from '../../core/scenario';
import { eclipseSpans, eclipseText, EVENT_INFO, EVENT_TYPES, findEvent } from '../../core/skyEvents';
import { MAX_TIME_MS, MIN_TIME_MS, store } from '../../core/store';
import { throttle } from '../../core/throttle';
import { formatUtc, isoUtc } from '../../core/time';
import { button, el } from '../dom';
import { showFieldOutcome } from '../fieldStatus';
import './timeScrubber.css';

const GLYPH: Record<SkyEvent['type'], string> = { sunrise: '☀↑', sunset: '☀↓', earthrise: '⊕↑', earthset: '⊕↓' };
const EVENTS = EVENT_TYPES.map((type) => ({ type, glyph: GLYPH[type], ...EVENT_INFO[type] }));
export const WINDOW_CHOICES = [
  [24, '24 h'],
  [72, '3 days'],
  [168, '7 days'],
  [336, '14 days'],
  [708, '29.5 days'],
] as const;

/** Events of the current analysis, or why there are none. */
function currentEvents(): { events: SkyEvent[]; analysis: SiteAnalysis } | { reason: string } {
  const st = analysis.get('current');
  // Just after a change the published result still belongs to the previous scenario.
  if (st.state !== 'idle' && st.scenario.id !== analysis.wanted('current')?.id) return { reason: 'Analysing the site…' };
  switch (st.state) {
    case 'idle': return { reason: 'Select a site or drop a pin to see when the Sun and Earth rise and set there.' };
    case 'loading': return { reason: 'Analysing the site…' };
    case 'error': return { reason: `No rise and set marks: the site analysis is not available (${st.error})` };
    case 'ready': return { events: st.value.events, analysis: st.value };
  }
}

export function mountTimeScrubber(region: HTMLElement): void {
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
  // Under the track: when Earth is in front of the Sun (lighter), and when the Sun is entirely hidden (full).
  const bands = el('div', 'ts-bands');
  bands.setAttribute('aria-hidden', 'true');
  track.append(marks, slider, bands);
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
  date.setAttribute('aria-label', 'Simulated date and time, UTC');
  date.title = 'The simulated instant shown in every view (UTC). The mission window keeps its own start.';
  when.append(date, el('span', 'ly-label', 'UTC'));
  date.addEventListener('change', async () => {
    if (!date.value) return;
    const r = await runAction('setTime', { utc: `${date.value}Z` });
    showFieldOutcome(date, r);
  });
  const now = button('Now', 'ly-btn ly-btn--small', () => void runAction('setMissionWindow', { startUtc: isoUtc(Date.now()), moveClock: true }));
  now.title = 'Start the mission window at the current real time and set the clock there';
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
  jumps.setAttribute('aria-label', 'Jump to the next rise or set');
  const jumpButtons = EVENTS.map((e) => {
    const b = button(`${e.glyph} ${e.label}`, `ly-btn ly-btn--small ts-jump ts-${e.body}`, () => void runAction('jumpToEvent', { type: e.type }));
    jumps.append(b);
    return { ...e, button: b };
  });
  const eventNote = el('span', 'ly-note ts-eventnote');
  const readout = el('span', 'ly-note ts-readout');

  const row = el('div', 'ts-row');
  row.append(when, now, rate, win, startHere, jumps, eventNote, readout);
  bar.append(play, sliderWrap, row);
  region.append(bar);
  // On narrow screens the regions above the scrubber stand on its real height (shell.css):
  // it grows by a row or two when the jump buttons show.
  new ResizeObserver(() => document.documentElement.style.setProperty('--scrubber-h', `${Math.round(bar.offsetHeight)}px`)).observe(bar);

  /** Events of the finished analysis (null while there is none). */
  let events: SkyEvent[] | null = null;
  const syncJumps = () => {
    if (!events) return;
    const t = store.get().timeMs;
    for (const j of jumpButtons) {
      const next = findEvent(events, j.type, 'next', t);
      j.button.disabled = !next;
      const text = next
        ? `Jump to ${formatUtc(next.timeMs)}: ${j.label} (${j.instant})`
        : `${j.label}: not after the simulated time inside the mission window (${j.instant})`;
      j.button.setAttribute('aria-label', text);
      j.button.title = text;
    }
  };
  // What follows the clock but need not be redrawn on every frame: the jump buttons' targets and
  // the Moon's phase. The last clock change is always drawn (throttle runs once more at the end).
  const slowSync = throttle(() => {
    syncJumps();
    const phase = moonPhaseAt(store.get().timeMs);
    readout.textContent = moonPhaseText(phase);
    readout.title = moonPhaseDetail(phase);
  }, 250);
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
    bands.replaceChildren();
    events = 'events' in ev ? ev.events : null;
    const none = events !== null && events.length === 0;
    const eclipses = 'analysis' in ev ? eclipseSpans(ev.analysis) : [];
    const eclipseLine = eclipses.length ? ` ${eclipseText(eclipses)}` : '';
    jumps.hidden = events === null || none;
    eventNote.hidden = events !== null && !none;
    eventNote.textContent = 'reason' in ev ? ev.reason : none ? `Neither the Sun nor Earth's centre rises or sets in this ${spanText(s.windowDurationH, true)} window (measured against the terrain skyline).${eclipseLine}` : '';
    if (!events) return;
    syncJumps();
    const place = (node: HTMLElement, fromMs: number, toMs: number) => {
      const a = Math.max(0, (fromMs - start) / span), b = Math.min(1, (toMs - start) / span);
      if (b <= a) return false;
      node.style.left = `${a * 100}%`;
      node.style.width = `${(b - a) * 100}%`;
      return true;
    };
    for (const e of eclipses) {
      const band = el('span', 'ts-band ts-eclipse');
      if (!place(band, e.startMs, e.endMs)) continue;
      bands.append(band);
      for (const h of e.hidden) {
        const full = el('span', 'ts-band ts-totality');
        if (place(full, h.startMs, h.endMs)) bands.append(full);
      }
      // A mark above the middle of the passage carries the times as a tooltip, like the rise and set marks.
      const mid = (Math.max(start, e.startMs) + Math.min(start + span, e.endMs)) / 2;
      const m = el('span', 'ts-mark ts-sun', '◐');
      m.style.left = `${((mid - start) / span) * 100}%`;
      m.title = eclipseText([e]);
      marks.append(m);
    }
    for (const e of events) {
      const f = (e.timeMs - start) / span;
      if (f < 0 || f > 1) continue;
      const info = EVENT_INFO[e.type];
      const m = el('span', `ts-mark ts-${info.body}`, GLYPH[e.type]);
      m.style.left = `${f * 100}%`;
      m.title = `${info.label} ${formatUtc(e.timeMs)}, azimuth ${e.azDeg.toFixed(1)}° (${info.instant})`;
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
    slowSync();
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
