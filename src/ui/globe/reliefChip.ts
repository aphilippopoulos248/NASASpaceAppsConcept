// The on-screen statement of how the terrain is being drawn, beside the compass: the
// relief exaggeration in force right now, and - when the south-polar close-up is on screen -
// that it is shaded relief computed from elevation data, not a photograph.
import { globeDisplay, reliefText } from '../../scene/globe/displayState';
import { el } from '../dom';
import './reliefChip.css';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function mountReliefChip(region: HTMLElement): void {
  const box = el('div', 'relief-chip');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'off');
  const factor = el('span', 'ly-value relief-factor');
  const note = el('span', 'ly-note relief-note');
  box.append(factor, note);
  region.append(box);

  const sync = () => {
    const d = globeDisplay.get(), live = globeDisplay.getLive();
    if (live.reliefProblem) {
      factor.textContent = 'Relief not available';
      note.textContent = live.reliefProblem;
    } else if (!live.reliefPpd) {
      factor.textContent = 'Loading relief…';
      note.textContent = '';
    } else {
      factor.textContent = capital(reliefText(live.reliefNow));
      // Say when what is drawn differs from what was chosen (it eases to true scale near the ground).
      const eased = d.reliefFactor > 1 && Math.abs(live.reliefNow - d.reliefFactor) > 0.05;
      note.textContent = live.polar ? live.polar.note : eased ? `Set to ×${d.reliefFactor}; true scale near the ground` : live.reliefNow > 0 ? 'LOLA elevation' : '';
    }
    box.title = 'How much the terrain relief is stretched in this view. Change it under Filters, Terrain relief.';
  };
  globeDisplay.subscribe(sync);
  sync();
}
