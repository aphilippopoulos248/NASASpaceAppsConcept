// Left "Filters" panel of the globe view: lighting, previous missions and their filters.
// (T-12 adds centre latitude/longitude, the solar elevation band and the landing-area overlay.)
import { runAction } from '../../core/actions';
import { store } from '../../core/store';
import { getLandings } from '../../data/catalog';
import { button, el } from '../dom';
import { mountMissionFilters } from '../filters';
import './filtersPanel.css';

export function mountFiltersPanel(region: HTMLElement): void {
  const panel = el('div', 'ly-panel filters-panel');
  panel.append(el('h2', 'ly-panel-title', 'Filters'));

  // Lighting
  panel.append(el('h3', 'ly-section-title', 'Sunlight'));
  const seg = el('div', 'ly-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Lighting');
  const modes = [
    ['real', 'Real', 'Sunlight from the true direction at the simulated time'],
    ['even', 'Even', 'Even lighting from the viewer, for readability (not real)'],
  ] as const;
  const modeButtons = modes.map(([mode, label, title]) => {
    const b = button(label, 'ly-btn ly-btn--small', () => void runAction('setLightMode', { mode }));
    b.title = title;
    seg.append(b);
    return [mode, b] as const;
  });
  panel.append(seg);

  // Previous missions
  const missions = el('details', 'fp-missions');
  missions.open = true;
  const summary = el('summary', 'fp-summary');
  const show = el('label', 'ly-check');
  const box = el('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => void runAction('showMissions', { show: box.checked }));
  // Clicking the checkbox must not also toggle the <details>.
  show.addEventListener('click', (e) => e.stopPropagation());
  show.append(box, el('span', undefined, 'Show previous missions'));
  summary.append(show);
  missions.append(summary);
  const body = el('div', 'fp-mission-body');
  missions.append(body);
  panel.append(missions);
  region.append(panel);

  mountMissionFilters(body, getLandings());

  const sync = () => {
    const s = store.get();
    for (const [mode, b] of modeButtons) b.setAttribute('aria-pressed', String(s.lightMode === mode));
    box.checked = s.showMissions;
    body.classList.toggle('off', !s.showMissions);
  };
  store.subscribe(['lightMode', 'showMissions'], sync);
  sync();

  // Narrow screens: the panel is a sheet opened from the "Filters" button.
  const toggle = document.getElementById('left-toggle');
  toggle?.addEventListener('click', () => {
    const open = document.body.classList.toggle('left-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}
