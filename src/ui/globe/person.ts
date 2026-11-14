// The "little person" from the mockup: click it to stand on the surface at the selected site
// (or at the centre of the view), or drag it onto the globe to drop a pin there and step down.
import { runAction } from '../../core/actions';
import { store } from '../../core/store';
import { button, el } from '../dom';
import './person.css';

const FIGURE = `<svg viewBox="0 0 24 32" width="22" height="30" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="3.2"/><path d="M12 9v11M5 13.5l7-2 7 2M12 20l-5 9M12 20l5 9"/></svg>`;

export type PickLatLon = (clientX: number, clientY: number) => { lat: number; lon: number } | null;

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export function mountPerson(region: HTMLElement, pick: PickLatLon): void {
  const b = button('', 'ly-btn ly-btn--icon person-btn');
  b.innerHTML = FIGURE;
  const describe = () => {
    const site = store.get().site;
    const label = site ? `Stand on the surface at ${site.name}` : 'Stand on the surface at the centre of the view (or drag me onto the globe)';
    b.setAttribute('aria-label', label);
    b.title = label;
  };
  store.subscribe(['site'], describe);
  describe();
  const hint = el('span', 'ly-note person-hint', 'Drag onto the Moon');
  region.append(b, hint);

  const enterAt = async (lat: number, lon: number) => {
    const r = await runAction('dropPin', { lat: round5(lat), lon: round5(lon) });
    if (r.ok) await runAction('enterSurface');
  };

  let suppressClick = false;
  let drag: { id: number; x: number; y: number; moved: boolean; ghost: HTMLElement | null } | null = null;
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    b.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, ghost: null };
  });
  b.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
      drag.moved = true;
      drag.ghost = el('div', 'person-ghost');
      drag.ghost.innerHTML = FIGURE;
      document.body.append(drag.ghost);
    }
    if (drag.ghost) {
      drag.ghost.style.left = `${e.clientX}px`;
      drag.ghost.style.top = `${e.clientY}px`;
      drag.ghost.classList.toggle('on-moon', Boolean(pick(e.clientX, e.clientY)));
    }
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    d.ghost?.remove();
    if (!d.moved || cancelled) return;
    suppressClick = true;
    const at = pick(e.clientX, e.clientY);
    if (at) void enterAt(at.lat, at.lon);
  };
  b.addEventListener('pointerup', (e) => end(e, false));
  b.addEventListener('pointercancel', (e) => end(e, true));
  // Click (mouse without drag, or keyboard Enter/Space). A finished drag also fires a click: ignore it.
  b.addEventListener('click', () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const site = store.get().site;
    if (site) void runAction('enterSurface');
    else {
      const c = store.get().globeCenter;
      void enterAt(c.lat, c.lon);
    }
  });
}
