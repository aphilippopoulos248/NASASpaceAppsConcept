// The on-screen statement of how the terrain is being drawn, beside the compass: relief at
// true scale or off, and - when the south-polar close-up is on screen -
// that it is shaded relief computed from elevation data, not a photograph.
import { store } from '../../core/store';
import { BACKGROUND_STARS_NOTE } from '../../scene/globe';
import { globeDisplay, reliefText } from '../../scene/globe/displayState';
import { el } from '../dom';
import './reliefChip.css';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Above this camera altitude the sky around the Moon is in view (km). */
const STARS_NOTE_ABOVE_KM = 1000;

export function mountReliefChip(region: HTMLElement): void {
  const box = el('div', 'relief-chip');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'off');
  const factor = el('span', 'ly-value relief-factor');
  const note = el('span', 'ly-note relief-note');
  // Where the sky behind the Moon is in view, say that its stars are generated (brief, rule 1).
  const stars = el('span', 'ly-note relief-note relief-stars', BACKGROUND_STARS_NOTE);
  box.append(factor, note, stars);
  region.append(box);
  const syncStars = () => {
    const show = store.get().view === 'globe' && store.get().globeCenter.altitudeKm >= STARS_NOTE_ABOVE_KM;
    if (stars.hidden === show) stars.hidden = !show;
  };
  store.subscribe(['globeCenter', 'view'], syncStars);
  syncStars();

  const sync = () => {
    const live = globeDisplay.getLive();
    if (live.reliefProblem) {
      factor.textContent = 'Relief not available';
      note.textContent = live.reliefProblem;
    } else if (!live.reliefPpd) {
      factor.textContent = 'Loading relief…';
      note.textContent = '';
    } else {
      factor.textContent = capital(reliefText(live.reliefNow));
      note.textContent = live.polar ? live.polar.note : live.reliefNow > 0 ? 'LOLA elevation' : '';
    }
    box.title = 'How the terrain relief is drawn in this view. Heights are never exaggerated.';
  };
  globeDisplay.subscribe(sync);
  sync();
}
