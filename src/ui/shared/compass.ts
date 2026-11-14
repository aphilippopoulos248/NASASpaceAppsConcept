// Compass (lower left of the globe view): the needle points to lunar north on screen.
// Clicking it turns the view back to north-up (resetNorth).
import { runAction } from '../../core/actions';
import { button } from '../dom';
import './compass.css';

const ROSE = `<svg viewBox="-24 -24 48 48" width="48" height="48" aria-hidden="true">
  <circle r="22" fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="1.5"/>
  <g class="compass-needle">
    <path d="M0 -17 L5 0 L0 3 L-5 0 Z" fill="var(--danger)"/>
    <path d="M0 17 L5 0 L0 -3 L-5 0 Z" fill="currentColor" fill-opacity="0.55"/>
    <text y="-19" text-anchor="middle" font-size="7" font-weight="600" fill="currentColor" dominant-baseline="auto">N</text>
  </g>
</svg>`;

/** `northAngle` returns the screen angle of lunar north, degrees clockwise from up. */
export function mountCompass(region: HTMLElement, northAngle: () => number, onFrame: (fn: () => void) => void): void {
  const b = button('', 'ly-btn compass');
  b.innerHTML = ROSE;
  b.setAttribute('aria-label', 'Compass: lunar north is up. Click to turn the view north-up.');
  region.append(b);
  b.addEventListener('click', () => void runAction('resetNorth'));
  const needle = b.querySelector<SVGGElement>('.compass-needle')!;
  let last = NaN;
  onFrame(() => {
    if (region.offsetParent === null) return; // hidden (surface view)
    const a = Math.round(northAngle() * 2) / 2;
    if (a === last) return;
    last = a;
    needle.setAttribute('transform', `rotate(${a})`);
    b.setAttribute('aria-label', `Compass: lunar north is ${Math.abs(a) < 1 ? 'up' : `${Math.abs(a).toFixed(0)}° ${a > 0 ? 'clockwise' : 'anticlockwise'} from up`}. Click to turn the view north-up.`);
  });
}
