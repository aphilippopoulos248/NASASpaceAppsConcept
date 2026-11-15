// "Missions to replay", at the top of the Filters panel: the presets of
// public/data/presets.json, each a button that runs loadPreset (and nothing else), with what
// plays in one line and where its data comes from. Under the list, the source of the Sun and
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

export function mountPresetList(parent: HTMLElement): void {
  const box = el('details', 'pl');
  box.open = true;
  const summary = el('summary', 'ly-section-title pl-title', 'Missions to replay');
  const intro = el('p', 'ly-note', 'Real landings on their real dates, played in one step from data that comes with the app: no network needed.');
  const list = el('ul', 'pl-list');
  const status = el('p', 'ly-note pl-status');
  status.setAttribute('role', 'status');
  const ephemeris = el('p', 'ly-note pl-ephemeris');
  box.append(summary, intro, list, status, ephemeris);
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
    status.textContent = r.ok ? (r.result.note ?? (r.result.playing ? `Playing "${p.title}". It stops at the end of the window; pause or scrub at any time.` : `"${p.title}" is loaded.`)) : `Could not load "${p.title}": ${r.error}`;
    syncActive();
  };

  const render = () => {
    buttons.clear();
    const presets = getPresets();
    const problem = presetProblem();
    intro.hidden = presets.length === 0;
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
        b.title = `${presetTiming(p)}. Opens the ${p.view} view.`;
        b.addEventListener('click', () => void load(p));
        buttons.set(p.id, b);
        const more = el('details', 'pl-more');
        more.append(el('summary', undefined, 'Timing and data sources'), el('p', 'ly-note', `${presetTiming(p)}.`));
        if (p.sunBehindEarth) more.append(el('p', 'ly-note', p.sunBehindEarth.reported));
        more.append(...p.sources.map((s) => el('p', 'ly-note', s)));
        li.append(b, more);
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
