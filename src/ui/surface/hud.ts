// Surface view status strip: heading, distance from the landing point, eye height, the
// generated-detail toggle, walking help, who the hardware here belongs to and the data note.
// Created by @globe with the app shell (moved out of main.ts); owned by @surface from here on.
import { runAction } from '../../core/actions';
import { store } from '../../core/store';
import { loadOwnership, stateShortName } from '../../data/ownership';
import type { SurfaceController } from '../../scene/surface/controller';
import { surfaceResolution } from '../../scene/autoResolution';
import { button, el } from '../dom';
import './hud.css';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function mountSurfaceHud(region: HTMLElement, surface: SurfaceController, onFrame: (fn: () => void) => void): void {
  const hud = el('div', 'ly-panel surface-hud');
  const head = el('div', 'sh-head');
  const status = el('span', 'ly-value sh-status');
  const generated = button('', 'ly-btn ly-btn--small', () => void runAction('setGeneratedDetail', { on: !surface.view.generated }));
  const back = button('Back to orbit', 'ly-btn ly-btn--small', () => void runAction('exitSurface'));
  head.append(el('strong', undefined, 'Surface view'), status, generated, back);
  const help = el('p', 'sh-help');
  help.innerHTML =
    '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>E</kbd>/<kbd>Q</kbd> rise and descend · <kbd>Shift</kbd> faster · drag to look · scroll to zoom · <kbd>Esc</kbd> to leave';
  const owner = el('p', 'sh-owner');
  const note = el('p', 'ly-note sh-note');
  hud.append(head, help, owner, note);
  region.append(hud);

  const syncDetail = () => {
    const v = surface.view;
    generated.textContent = `Generated detail: ${v.generated ? 'on' : 'off'}`;
    generated.setAttribute('aria-pressed', String(v.generated));
    note.textContent =
      v.detail === 'measured'
        ? 'Built from orbital data, not a ground photograph: LROC high-resolution elevation and photo within about 770 m of the landing point, with finer relief worked out from shading in the photo; the 60 m model beyond. Rocks and texture finer than about a metre are generated, not real. The lander is not modelled in 3D.'
        : 'No high-resolution survey exists for this site. Hills and large craters are real (60 m model); the small craters, bumps and rocks within about 770 m are generated, not real.';
  };
  surface.onChange = syncDetail;
  store.subscribe(['view'], (s) => s.view === 'surface' && syncDetail());
  syncDetail();

  // Whose hardware is at this site (GCAT): going near another state's hardware matters.
  const syncOwner = async () => {
    const site = store.get().site;
    const o = site?.kind === 'landing' ? (await loadOwnership())?.byLanding.get(site.id) : undefined;
    owner.textContent = o ? `Hardware at this site belongs to ${stateShortName(o)} (GCAT).` : '';
    owner.hidden = !o;
  };
  store.subscribe(['site', 'view'], () => void syncOwner());
  void syncOwner();

  let text = '';
  onFrame(() => {
    if (!surface.active) return;
    const v = surface.view;
    const h = Math.round(v.heading) % 360;
    const d = v.distanceFromSite;
    const dist = d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
    const eye = 1.7 + v.lift;
    const height = eye < 10 ? `${eye.toFixed(1)} m` : `${Math.round(eye)} m`;
    const next = `Facing ${COMPASS[Math.round(h / 45) % 8]} (${h}°) · ${dist} from the landing point · eye height ${height} · ${surfaceResolution.statusText}`;
    if (next !== text) status.textContent = text = next;
  });
}
