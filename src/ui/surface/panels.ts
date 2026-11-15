// Surface panels share a drag handle and a fold control. Existing panel contents keep
// their own visibility and state; leaving surface view restores the normal globe layout.
import { store } from '../../core/store';
import { runAction } from '../../core/actions';
import { button, el } from '../dom';
import { requestHudLayout } from './hudLayout';
import './panels.css';

interface Position { x: number; y: number; width: number }

/** Keep the entire panel within reach, including after resizing or expanding it. */
export function constrainPanel(p: Position, height: number, viewportW: number, viewportH: number): Position {
  const width = Math.min(p.width, Math.max(0, viewportW - 16));
  return {
    width,
    x: Math.max(8, Math.min(p.x, viewportW - width - 8)),
    y: Math.max(8, Math.min(p.y, viewportH - Math.min(height, viewportH - 16) - 8)),
  };
}

export function mountSurfacePanels(): void {
  const definitions = [
    ['.km', 'Key metrics'], ['.skc', 'Skyline chart'], ['.surface-hud', 'Surface controls'],
    ['.time-scrubber', 'Time'], ['.locator', 'Locator map'],
    ['.cmp-sheet', 'Compare'], ['.assistant-drawer', 'Assistant'],
  ];
  let front = 50;
  const resets: (() => void)[] = [];
  const refresh: (() => void)[] = [];

  for (const [selector, title] of definitions) {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) continue;
    const region = panel.closest<HTMLElement>('.region')!;
    panel.classList.add('sp-panel');
    let position: Position | null = null;
    let folded = false;
    const toolbar = el('div', 'sp-toolbar');
    const grip = button(`⠿ ${title}`, 'sp-grip');
    grip.setAttribute('aria-label', `Move ${title} panel`);
    grip.title = 'Drag to move. Use arrow keys to move, Shift for larger steps.';
    const fold = button('Fold', 'ly-btn ly-btn--small ly-btn--ghost sp-fold');
    fold.setAttribute('aria-expanded', 'true');
    fold.setAttribute('aria-label', `Fold ${title}`);
    toolbar.append(grip, fold);
    // Metrics already has a fold action, including support in the assistant.
    const metricsHead = panel.querySelector<HTMLElement>('.km-head');
    if (metricsHead) {
      metricsHead.prepend(grip);
      grip.classList.add('sp-metrics-grip');
      metricsHead.classList.add('sp-metrics-head');
    } else panel.prepend(toolbar);

    const raise = () => {
      if (store.get().view === 'surface') region.style.zIndex = String(++front);
    };
    const place = (p: Position) => {
      position = constrainPanel(p, panel.getBoundingClientRect().height, innerWidth, innerHeight);
      panel.style.setProperty('--sp-x', `${position.x}px`);
      panel.style.setProperty('--sp-y', `${position.y}px`);
      panel.style.setProperty('--sp-width', `${position.width}px`);
      panel.classList.add('sp-positioned');
      requestHudLayout();
    };
    const current = (): Position => {
      const r = panel.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width };
    };
    const reflow = () => {
      if (position && store.get().view === 'surface' && panel.getBoundingClientRect().height) {
        // The chart's own Expand/Shrink control still owns its width after a drag.
        place(selector === '.skc' ? { ...position, width: panel.getBoundingClientRect().width } : position);
      }
    };
    refresh.push(reflow);
    fold.addEventListener('click', () => {
      folded = !folded;
      panel.classList.toggle('sp-folded', folded);
      fold.textContent = folded ? 'Expand' : 'Fold';
      fold.setAttribute('aria-expanded', String(!folded));
      fold.setAttribute('aria-label', `${folded ? 'Expand' : 'Fold'} ${title}`);
      reflow();
      requestHudLayout();
    });

    let drag: { id: number; x: number; y: number; start: Position } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      if (store.get().view !== 'surface' || e.button !== 0) return;
      e.preventDefault();
      grip.focus({ preventScroll: true });
      raise();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: current() };
      grip.setPointerCapture(e.pointerId);
      panel.classList.add('sp-dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      place({ ...drag.start, x: drag.start.x + e.clientX - drag.x, y: drag.start.y + e.clientY - drag.y });
    });
    const finish = () => { drag = null; panel.classList.remove('sp-dragging'); };
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('lostpointercapture', finish);
    grip.addEventListener('keydown', (e) => {
      if (store.get().view !== 'surface') return;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!delta[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      const p = current(), step = e.shiftKey ? 40 : 10;
      raise();
      place({ ...p, x: p.x + delta[e.key][0] * step, y: p.y + delta[e.key][1] * step });
    });
    panel.addEventListener('pointerdown', raise);
    if (selector === '.assistant-drawer' || selector === '.cmp-sheet') {
      const key = selector === '.assistant-drawer' ? 'assistantOpen' : 'comparing';
      store.subscribe([key], () => { if (store.get()[key]) raise(); });
    }
    const observer = new ResizeObserver(reflow);
    observer.observe(panel);
    resets.push(() => {
      position = null;
      folded = false;
      panel.classList.remove('sp-positioned', 'sp-folded');
      for (const key of ['--sp-x', '--sp-y', '--sp-width']) panel.style.removeProperty(key);
      region.style.removeProperty('z-index');
      fold.textContent = 'Fold';
      fold.setAttribute('aria-expanded', 'true');
      fold.setAttribute('aria-label', `Fold ${title}`);
    });
  }
  const reset = button('Reset panels', 'ly-btn ly-btn--small sp-reset', () => {
    resets.forEach((fn) => fn());
    void runAction('showKeyMetrics', { open: true });
    requestHudLayout();
  });
  reset.title = 'Restore the default surface panel positions and unfold them';
  document.getElementById('region-close')?.append(reset);
  window.addEventListener('resize', () => refresh.forEach((fn) => fn()));
  store.subscribe(['view'], () => {
    if (store.get().view !== 'surface') {
      for (const region of document.querySelectorAll<HTMLElement>('.region')) region.style.removeProperty('z-index');
    } else requestAnimationFrame(() => refresh.forEach((fn) => fn()));
    requestHudLayout();
  });
}
