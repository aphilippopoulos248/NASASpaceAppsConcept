// Top-right close button of the surface view: back to the globe.
import { runAction } from '../../core/actions';
import { button } from '../dom';

export function mountCloseButton(region: HTMLElement): void {
  const b = button('×', 'ly-btn ly-btn--icon close-surface', () => void runAction('exitSurface'));
  b.setAttribute('aria-label', 'Close the surface view and return to the globe');
  b.style.cssText = 'width:40px;height:40px;font-size:var(--fs-xl);background:var(--surface-1);backdrop-filter:var(--blur)';
  region.append(b);
}
