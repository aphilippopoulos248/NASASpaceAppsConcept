// "Missions to replay", at the bottom of the Filters panel: the presets of
// public/data/presets.json, each a button that runs loadPreset (and nothing else), with what
// plays in one line. Each preset's timing is in its button's tooltip; its data sources are not
// shown here: they stay in presets.json (`sources`, `sunBehindEarth.reported`) and in what
// listPresets and loadPreset return. Under the list, the source of the Sun and
// Earth positions for the window on screen, as the analysis itself reports it: inside the
// bundled windows it must read "JPL Horizons table bundled with the app".
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { activePreset, ephemerisStatement } from '../../core/presetActions';
import { spanText } from '../../core/scenario';
import { store } from '../../core/store';
import { formatUtc } from '../../core/time';
import { getPresets, onPresetsChange, presetProblem, type MissionPreset } from '../../data/presets';
import { el } from '../dom';
import './presetList.css';

const HOUR_MS = 3_600_000;

/** "14 days from 2025-03-02 08:34 UTC, played in about 28 s". */
export function presetTiming(p: MissionPreset): string {
  const seconds = Math.round((p.windowStartMs + p.windowDurationH * HOUR_MS - p.clockMs) / 1000 / p.rate);
  const from = p.clockMs === p.windowStartMs ? `${spanText(p.windowDurationH)} from ${formatUtc(p.windowStartMs)}` : `${formatUtc(p.clockMs)} to ${formatUtc(p.windowStartMs + p.windowDurationH * HOUR_MS).slice(11)}`;
  return `${from}, played in about ${seconds} s`;
}

/** What in a preset is uncertain or computed rather than reported: its caveat and, for an eclipse, what was reported. */
export function presetCaveats(p: Pick<MissionPreset, 'caveat' | 'sunBehindEarth'>): string[] {
  return [p.caveat, p.sunBehindEarth?.reported].filter((s): s is string => Boolean(s));
}

/**
 * The status line once a preset has loaded: that it plays (or is loaded), then its caveats, so
 * they are on screen and read out (role="status") although the list no longer shows the sources.
 */
export function loadedText(p: Pick<MissionPreset, 'title' | 'caveat' | 'sunBehindEarth'>, r: { playing: boolean; note?: string }): string {
  const done = r.note ?? (r.playing ? `Playing "${p.title}". It stops at the end of the window; pause or scrub at any time.` : `"${p.title}" is loaded.`);
  return [done, ...presetCaveats(p)].join(' ');
}

export function mountPresetList(parent: HTMLElement): void {
  const box = el('details', 'pl');
  box.open = true;
  const summary = el('summary', 'ly-section-title pl-title', 'Missions to replay');
  const list = el('ul', 'pl-list');
  const status = el('p', 'ly-note pl-status');
  status.setAttribute('role', 'status');
  const ephemeris = el('p', 'ly-note pl-ephemeris');
  box.append(summary, list, status, ephemeris);
  parent.append(box);

  let loading: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  const syncActive = () => {
    const active = activePreset(store.get(), getPresets());
    for (const [id, b] of buttons) {
      b.setAttribute('aria-pressed', String(active?.id === id));
      b.disabled = loading !== null;
      b.classList.toggle('pl-loading', loading === id);
    }
  };

  const load = async (p: MissionPreset) => {
    if (loading) return;
    loading = p.id;
    status.textContent = p.view === 'surface' ? `Loading "${p.title}": the surface view and the site analysis…` : `Loading "${p.title}"…`;
    syncActive();
    const r = await runAction<{ playing: boolean; note?: string }>('loadPreset', { id: p.id });
    loading = null;
    status.textContent = r.ok ? loadedText(p, r.result) : `Could not load "${p.title}": ${r.error}`;
    syncActive();
  };

  const render = () => {
    buttons.clear();
    const presets = getPresets();
    const problem = presetProblem();
    if (!presets.length) status.textContent = problem ? `The mission presets could not be read: ${problem}` : 'No mission presets are packaged with this build.';
    list.replaceChildren(
      ...presets.map((p) => {
        const li = el('li', 'pl-item');
        const b = el('button', 'pl-button');
        b.type = 'button';
        const mark = el('span', 'pl-mark', '▶');
        mark.setAttribute('aria-hidden', 'true');
        const text = el('span', 'pl-text');
        text.append(el('span', 'pl-name', p.title), el('span', 'pl-desc', p.description));
        b.append(mark, text);
        b.title = [`${presetTiming(p)}. Opens the ${p.view} view.`, ...presetCaveats(p)].join(' ');
        b.addEventListener('click', () => void load(p));
        buttons.set(p.id, b);
        li.append(b);
        return li;
      }),
    );
    syncActive();
  };

  // Where the Sun and Earth positions of the window on screen come from, in the analysis' own words.
  const syncEphemeris = () => {
    const st = analysis.get('current');
    const current = st.state === 'ready' && st.scenario.id === analysis.wanted('current')?.id ? st.value : null;
    if (!store.get().site || !current) {
      ephemeris.textContent = '';
      ephemeris.title = '';
      return;
    }
    const e = ephemerisStatement(current);
    ephemeris.textContent = e.text;
    ephemeris.title = e.note ?? '';
    ephemeris.classList.toggle('pl-ephemeris--bundled', e.source === 'horizons');
  };

  onPresetsChange(render);
  store.subscribe(['site', 'windowStartMs', 'windowDurationH', 'delayH'], () => {
    syncActive();
    syncEphemeris();
  });
  analysis.subscribe((slot) => slot === 'current' && syncEphemeris());
  render();
  syncEphemeris();
}
