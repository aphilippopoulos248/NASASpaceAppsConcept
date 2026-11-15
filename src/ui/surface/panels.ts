// Surface panels share a drag handle and a fold control (the teammate's design from GitHub main
// 48ffb71). Existing panel contents keep their own visibility and state; leaving surface view
// restores the normal globe layout, except the assistant can move and fold in either view.
// The rules for moving and folding are in panelLayout.ts, and
// every change a user makes goes through the registered actions in panelActions.ts (D-3), so the
// assistant can do the same: the grip's keys, the Fold buttons and "Reset panels" run them, and
// a drag shows the panel moving and is recorded as one action when the pointer is let go.
import { registerActions, runAction } from '../../core/actions';
import { store } from '../../core/store';
import { button, el } from '../dom';
import { requestHudLayout } from './hudLayout';
import { hudState, setHudState } from './hudState';
import { createPanelActions } from './panelActions';
import { PanelLayout, SURFACE_PANELS, type PanelHost, type PanelId, type Position } from './panelLayout';
import './panels.css';

export { constrainPanel } from './panelLayout';

/** The one layout of the page (the actions and the controls share it). */
export const surfacePanels = new PanelLayout();

export function mountSurfacePanels(): void {
  let front = 50;
  const refresh: (() => void)[] = [];
  const isSurface = () => store.get().view === 'surface';

  for (const { id, title, selector } of SURFACE_PANELS) {
    const panel = document.querySelector<HTMLElement>(selector);
    if (!panel) continue;
    const region = panel.closest<HTMLElement>('.region')!;
    const canMove = () => id === 'assistant' || isSurface();
    panel.classList.add('sp-panel');
    const toolbar = el('div', 'sp-toolbar');
    const grip = button(`⠿ ${title}`, 'sp-grip');
    grip.setAttribute('aria-label', `Move ${title} panel`);
    grip.title = 'Drag to move. Use arrow keys to move, Shift for larger steps.';
    const fold = button('Fold', 'ly-btn ly-btn--small ly-btn--ghost sp-fold');
    fold.setAttribute('aria-expanded', 'true');
    fold.setAttribute('aria-label', `Fold ${title}`);
    toolbar.append(grip, fold);
    // Metrics already has a fold control and action (showKeyMetrics): it keeps it, and gets the grip only.
    const metricsHead = id === 'key-metrics' ? panel.querySelector<HTMLElement>('.km-head') : null;
    if (metricsHead) {
      metricsHead.prepend(grip);
      grip.classList.add('sp-metrics-grip');
      metricsHead.classList.add('sp-metrics-head');
    } else panel.prepend(toolbar);

    // In front of the other panels; once is enough while it is the front one (a drag raises on every move).
    const raise = () => {
      if (canMove() && region.style.zIndex !== String(front)) region.style.zIndex = String(++front);
    };
    const showFolded = (folded: boolean) => {
      panel.classList.toggle('sp-folded', folded);
      fold.textContent = folded ? 'Expand' : 'Fold';
      fold.setAttribute('aria-expanded', String(!folded));
      fold.setAttribute('aria-label', `${folded ? 'Expand' : 'Fold'} ${title}`);
    };
    const host: PanelHost = {
      shown: () => {
        if (!canMove() || panel.getAttribute('aria-hidden') === 'true' || panel.closest('[inert]')) return false;
        const r = panel.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      },
      box: () => {
        const r = panel.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      viewport: () => ({ width: innerWidth, height: innerHeight }),
      place: (p: Position | null) => {
        if (p) {
          panel.style.setProperty('--sp-x', `${p.x}px`);
          panel.style.setProperty('--sp-y', `${p.y}px`);
          panel.style.setProperty('--sp-width', `${p.width}px`);
          panel.classList.add('sp-positioned');
        } else {
          panel.classList.remove('sp-positioned');
          for (const key of ['--sp-x', '--sp-y', '--sp-width']) panel.style.removeProperty(key);
          region.style.removeProperty('z-index');
        }
        requestHudLayout();
      },
      // The key metrics fold through their own state (the same as showKeyMetrics); the others with the panel's class.
      setFolded: (folded) => {
        if (metricsHead) setHudState({ metricsOpen: !folded });
        else showFolded(folded);
        requestHudLayout();
      },
      folded: () => (metricsHead ? !hudState().metricsOpen : panel.classList.contains('sp-folded')),
      raise,
    };
    surfacePanels.register(id, host);

    // The chart's own Expand/Shrink control still owns its width after a drag.
    const reflow = () => surfacePanels.reflow(id, id === 'skyline-chart' ? panel.getBoundingClientRect().width : undefined);
    refresh.push(reflow);
    fold.addEventListener('click', () => void runAction('setSurfacePanel', { panel: id, folded: !host.folded() }));

    let drag: { id: number; x: number; y: number; start: { x: number; y: number }; moved: boolean } | null = null;
    grip.addEventListener('pointerdown', (e) => {
      if (!canMove() || e.button !== 0) return;
      e.preventDefault();
      grip.focus({ preventScroll: true });
      raise();
      const r = panel.getBoundingClientRect();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: { x: r.x, y: r.y }, moved: false };
      grip.setPointerCapture(e.pointerId);
      panel.classList.add('sp-dragging');
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.moved = true;
      // Shown as it goes; recorded once, as an action, when the pointer is let go.
      surfacePanels.move(id, { x: drag.start.x + e.clientX - drag.x, y: drag.start.y + e.clientY - drag.y });
    });
    const finish = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      panel.classList.remove('sp-dragging');
      const p = surfacePanels.position(id);
      if (moved && p) void runAction('setSurfacePanel', { panel: id, xPx: Math.round(p.x), yPx: Math.round(p.y) });
    };
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
    grip.addEventListener('lostpointercapture', finish);
    grip.addEventListener('keydown', (e) => {
      if (!canMove()) return;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!delta[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      const r = panel.getBoundingClientRect(), step = e.shiftKey ? 40 : 10;
      void runAction('setSurfacePanel', { panel: id, xPx: Math.round(r.x + delta[e.key][0] * step), yPx: Math.round(r.y + delta[e.key][1] * step) });
    });
    panel.addEventListener('pointerdown', raise);
    if (id === 'assistant' || id === 'compare') {
      const key = id === 'assistant' ? 'assistantOpen' : 'comparing';
      store.subscribe([key], () => {
        if (store.get()[key]) {
          raise();
          requestAnimationFrame(reflow);
        }
      });
    }
    new ResizeObserver(reflow).observe(panel);
  }

  registerActions(createPanelActions({ layout: surfacePanels, isSurface }));

  const reset = button('Reset panels', 'ly-btn ly-btn--small sp-reset', () => void runAction('resetSurfacePanels'));
  reset.title = 'Restore the default surface panel positions and unfold them';
  document.getElementById('region-close')?.append(reset);
  window.addEventListener('resize', () => refresh.forEach((fn) => fn()));
  store.subscribe(['view'], () => {
    if (!isSurface()) {
      for (const region of document.querySelectorAll<HTMLElement>('.region')) region.style.removeProperty('z-index');
    } else requestAnimationFrame(() => refresh.forEach((fn) => fn()));
    requestHudLayout();
  });
}

export type { PanelId };
