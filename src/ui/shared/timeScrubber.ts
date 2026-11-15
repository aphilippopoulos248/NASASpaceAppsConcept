// Time scrubber along the bottom (both views): scrubs the shared clock across the mission
// window (29.5 days by default), with play/pause, speed, the exact UTC instant, the window length,
// and - once the site analysis is ready - clickable sunrise/sunset/Earthrise/Earthset marks.
// Every control runs through the action registry.
//
// A rise or a set is not one moment (decision D-8), so no mark, button or tooltip here names a
// "sunset" with a time on its own: tooltips and accessible labels say which instant it is,
// in the words of core/skyEvents.ts and the science core, which the actions use too.
// Each passage of a disc through the skyline has a span; its icon jumps to the marked instant.
import { eventText, transitionText } from '../../analysis/api';
import type { SiteAnalysis, SkyEvent } from '../../analysis/types';
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { RATE_PRESETS } from '../../core/coreActions';
import { moonPhaseAt, moonPhaseDetail, moonPhaseText } from '../../core/moonPhase';
import { effectiveStartMs, spanText } from '../../core/scenario';
import { eclipseSpans, eclipseText, EVENT_INFO } from '../../core/skyEvents';
import { MAX_TIME_MS, MIN_TIME_MS, store } from '../../core/store';
import { throttle } from '../../core/throttle';
import { formatUtc, isoUtc } from '../../core/time';
import { button, el } from '../dom';
import { showFieldOutcome } from '../fieldStatus';
import { layoutTimelineMarks, TIMELINE_MARK_ROW_HEIGHT } from './timelineMarks';
import './timeScrubber.css';

const GLYPH: Record<SkyEvent['type'], string> = { sunrise: '☀↑', sunset: '☀↓', earthrise: '⊕↑', earthset: '⊕↓' };
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
  marks.setAttribute('role', 'group');
  marks.setAttribute('aria-label', 'Timeline events');
  const markButtons: { button: HTMLButtonElement; fraction: number }[] = [];
  const layoutMarks = () => {
    const { positions, rows } = layoutTimelineMarks(markButtons.map(m => m.fraction), marks.clientWidth);
    markButtons.forEach((m, i) => {
      m.button.style.left = `${positions[i].x}px`;
      m.button.style.top = `${positions[i].row * TIMELINE_MARK_ROW_HEIGHT}px`;
    });
    track.style.setProperty('--ts-marks-height', `${rows * TIMELINE_MARK_ROW_HEIGHT}px`);
  };
  let marksWidth = -1;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === marksWidth) return;
    marksWidth = entry.contentRect.width;
    layoutMarks();
  }).observe(marks);
  const jumpToMark = async (timeMs: number) => {
    await runAction('pause');
    await runAction('setTime', { offsetHours: (timeMs - store.get().timeMs) / 3_600_000 });
  };
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

  const eventNote = el('span', 'ly-note ts-eventnote');
  const readout = el('span', 'ly-note ts-readout');

  const row = el('div', 'ts-row');
  row.append(when, now, rate, win, startHere, eventNote, readout);
  bar.append(play, sliderWrap, row);
  region.append(bar);
  // On narrow screens the regions above the scrubber stand on its real height (shell.css):
  // controls can wrap as the available width changes.
  new ResizeObserver(() => document.documentElement.style.setProperty('--scrubber-h', `${Math.round(bar.offsetHeight)}px`)).observe(bar);

  // The Moon's phase follows the clock without redrawing on every frame.
  const slowSync = throttle(() => {
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
    markButtons.length = 0;
    const events = 'events' in ev ? ev.events : null;
    const none = events !== null && events.length === 0;
    const eclipses = 'analysis' in ev ? eclipseSpans(ev.analysis) : [];
    const eclipseLine = eclipses.length ? ` ${eclipseText(eclipses)}` : '';
    eventNote.hidden = events !== null && !none;
    // Passages of a disc through the skyline in the window: sets and rises, and grazes and peeks, which have no event.
    const passes = 'analysis' in ev ? (ev.analysis.transitions ?? []).filter((tr) => tr.end.timeMs > start && tr.start.timeMs < start + span) : [];
    const touches = none && passes.length ? ` ${passes.map((tr) => transitionText(tr)).join(' ')}` : '';
    eventNote.textContent = 'reason' in ev ? ev.reason : none ? `Neither the Sun nor Earth's centre rises or sets in this ${spanText(s.windowDurationH, true)} window (measured against the terrain skyline).${touches}${eclipseLine}` : '';
    if (!events) {
      layoutMarks();
      return;
    }
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
      // The eclipse icon jumps to the middle of its visible span.
      const mid = (Math.max(start, e.startMs) + Math.min(start + span, e.endMs)) / 2;
      const m = button('◐', 'ts-mark ts-sun', () => void jumpToMark(mid));
      markButtons.push({ button: m, fraction: (mid - start) / span });
      m.title = `Jump to ${formatUtc(mid)}. ${eclipseText([e])}`;
      m.setAttribute('aria-label', m.title);
      marks.append(m);
    }
    // Each passage as a span under the glyphs: from its first cut (or first limb) to its last limb (or whole disc clear).
    for (const tr of passes) {
      const bar = el('span', `ts-pass ts-${tr.body}${tr.kind === 'graze' || tr.kind === 'peek' ? ' ts-pass--partial' : ''}`);
      if (!place(bar, tr.start.timeMs, tr.end.timeMs)) continue;
      bar.title = transitionText(tr);
      marks.append(bar);
    }
    for (const e of events) {
      const f = (e.timeMs - start) / span;
      if (f < 0 || f > 1) continue;
      const info = EVENT_INFO[e.type];
      const m = button(GLYPH[e.type], `ts-mark ts-${info.body}`, () => void jumpToMark(e.timeMs));
      markButtons.push({ button: m, fraction: f });
      m.title = `Jump to ${formatUtc(e.timeMs)}: ${eventText(e)}. Azimuth ${e.azDeg.toFixed(1)}° when ${info.instant}.`;
      m.setAttribute('aria-label', m.title);
      marks.append(m);
    }
    layoutMarks();
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
