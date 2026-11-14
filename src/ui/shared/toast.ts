// Short, non-blocking messages (the bus "toast" command), plus failed UI actions.
import { onAction } from '../../core/actions';
import { onCommand } from '../../core/bus';
import { el } from '../dom';

export function mountToasts(region: HTMLElement): void {
  const show = (text: string, kind: 'info' | 'warn' | 'error' = 'info') => {
    const t = el('div', `ly-panel toast toast--${kind}`, text);
    t.style.cssText = `padding:var(--sp-2) var(--sp-3);max-width:min(520px,90vw);border-color:${kind === 'info' ? 'var(--border)' : kind === 'warn' ? 'var(--warn)' : 'var(--danger)'}`;
    region.append(t);
    window.setTimeout(() => t.remove(), kind === 'info' ? 3500 : 6000);
  };
  onCommand('toast', ({ text, kind }) => show(text, kind));
  // A control whose action failed tells the user why (the assistant reads the same message).
  onAction((e) => {
    if (!e.ok && e.origin === 'ui' && e.error) show(e.error, 'warn');
  });
}
