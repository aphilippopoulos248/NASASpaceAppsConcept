// Surface view status strip: where the viewer faces and stands, quick view controls, and a
// plain statement of what the picture is built from (elevation products and resolution, what
// is generated, how the Sun and Earth are placed), and who the hardware at the site belongs to.
import { runAction } from '../../core/actions';
import { analysis } from '../../core/analysisStore';
import { store } from '../../core/store';
import { loadOwnership, stateShortName } from '../../data/ownership';
import { formatUtc } from '../../core/time';
import { surfaceResolution } from '../../scene/autoResolution';
import type { SurfaceController } from '../../scene/surface/controller';
import { button, el } from '../dom';
import { ensureHudActions } from './hudActions';
import { hudLayoutPart, requestHudLayout } from './hudLayout';
import { hudState, onHudState } from './hudState';
import './hud.css';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const metres = (m: number): string => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 9950 ? 1 : 0)} km`);
const stepText = (h: number): string => (h < 1 ? `${Math.round(h * 60)} min` : h === 1 ? 'hour' : h < 24 ? `${h} h` : h === 24 ? 'day' : `${h / 24} days`);

export function mountSurfaceHud(region: HTMLElement, surface: SurfaceController, onFrame: (fn: () => void) => void): void {
  ensureHudActions({ store, analysis });
  const view = surface.view;
  const hud = el('div', 'ly-panel surface-hud');

  // Row 1: status and quick controls.
  const head = el('div', 'sh-head');
  const status = el('span', 'ly-value sh-status');
  const controls = el('div', 'sh-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Surface view controls');
  const trackSun = button('Track Sun', 'ly-btn ly-btn--small', () => void runAction('setBodyTracking', { body: 'sun', on: surface.trackingBody !== 'sun' }));
  trackSun.title = 'Continuously face the Sun as simulated time changes; drag or arrow keys stop tracking';
  const trackEarth = button('Track Earth', 'ly-btn ly-btn--small', () => void runAction('setBodyTracking', { body: 'earth', on: surface.trackingBody !== 'earth' }));
  trackEarth.title = 'Continuously face Earth as simulated time changes; drag or arrow keys stop tracking';
  const paths = button('Sky paths', 'ly-btn ly-btn--small', () => {
    const on = !view.annotations.tracks;
    void runAction('setSkyAnnotations', { tracks: on, labels: on });
  });
  paths.title = 'Dotted tracks of the Sun and Earth over the mission window, and their name labels';
  const generated = button('Generated detail', 'ly-btn ly-btn--small', () => void runAction('setGeneratedDetail', { on: !view.generated }));
  generated.title = 'Rocks, sub-metre texture and (where no survey exists) small craters: generated, not measured';
  const chart = button('Skyline chart', 'ly-btn ly-btn--small', () => void runAction('setChart', { show: hudState().chart === 'hidden' }));
  chart.title = 'The terrain skyline around the site with the Sun and Earth over the mission window';
  const home = button('Return to site', 'ly-btn ly-btn--small', () => void runAction('walkTo', { eastM: 0, northM: 0 }));
  controls.append(trackSun, trackEarth, paths, generated, chart, home);
  head.append(el('strong', 'sh-title', 'Surface view'), status, controls);

  // Row 2: what the ground is built from, always on screen.
  const ground = el('p', 'ly-note sh-ground');

  // Folded: the rest of the provenance and the keys.
  const more = el('details', 'sh-more');
  const summary = el('summary', 'sh-summary', 'About this view');
  const body = el('div', 'sh-body ly-note');
  more.append(summary, body);
  // Row 3: who the hardware at this site belongs to (filled in by syncOwner below).
  const owner = el('p', 'ly-note sh-owner');
  // On windows up to 800 px tall these two lines move into "About this view" (hud.css), so the
  // strip stays below the horizon at the centre of the screen, where a low Sun stands.
  const groundCompact = el('p', 'sh-compact-only');
  const ownerCompact = el('p', 'sh-compact-only');
  hud.append(head, ground, owner, more);
  region.append(hud);

  // The chart shares the lower part of the screen: the strip says whether it is on, and
  // steps aside where the chart (or, on a phone, the blockage explanation) takes its place.
  const syncChart = () => {
    const h = hudState();
    chart.setAttribute('aria-pressed', String(h.chart !== 'hidden'));
    hud.classList.toggle('surface-hud--chart-open', h.chart !== 'hidden');
    hud.classList.toggle('surface-hud--chart-expanded', h.chart === 'expanded');
    hud.classList.toggle('surface-hud--explaining', h.explanation !== null);
    requestHudLayout();
  };
  onHudState(syncChart);
  syncChart();
  hudLayoutPart('strip', hud);

  const line = (label: string, text: string): HTMLElement => {
    const p = el('p');
    p.append(el('strong', undefined, `${label}: `), text);
    return p;
  };

  const syncStatic = () => {
    const g = view.ground;
    for (const [b, on] of [[paths, view.annotations.tracks], [generated, view.generated]] as const) b.setAttribute('aria-pressed', String(on));
    trackSun.setAttribute('aria-pressed', String(surface.trackingBody === 'sun'));
    trackEarth.setAttribute('aria-pressed', String(surface.trackingBody === 'earth'));
    ground.replaceChildren();
    if (!g) {
      ground.textContent = 'Ground: loading elevation data…';
      body.replaceChildren();
      return;
    }
    ground.append(el('strong', undefined, 'Ground (elevation data): '), `${g.summary}. `);
    ground.append(el('span', g.surveyed ? undefined : 'sh-flag', view.generated ? g.generated : 'Generated detail is off: only measured or interpolated terrain is drawn.'));
    groundCompact.replaceChildren(...[...ground.childNodes].map((n) => n.cloneNode(true)));

    const sky = view.skyNow, steps = view.pathSteps;
    const parts: HTMLElement[] = [groundCompact, ownerCompact];
    if (sky) {
      const ratio = sky.earth.radiusDeg / sky.sun.radiusDeg;
      parts.push(
        line(
          'Sun and Earth',
          `placed for this site at ${Number.isFinite(sky.timeMs) ? formatUtc(sky.timeMs) : 'the simulated time'}, ${sky.topocentric ? 'as seen from the site itself (topocentric)' : 'from the Moon\'s centre (interim, Earth up to 0.26° off)'}, with no atmosphere and no refraction. ` +
            `Discs are at true size: Sun ${(sky.sun.radiusDeg * 2).toFixed(2)}°, Earth ${(sky.earth.radiusDeg * 2).toFixed(2)}° across (${ratio.toFixed(1)} times wider). Zoom in to see them large. ` +
            'Earth\'s phase and the face it shows are computed; its picture is NASA\'s cloud-free Blue Marble, so real clouds are not shown. The Sun\'s glare is a display aid, not a measurement. ' +
            'While Earth hides the Sun (an eclipse seen from the Moon), the thin orange ring drawn around Earth stands for sunlight passing through Earth\'s air: it is schematic, and its brightness and colour are not computed.',
        ),
      );
    }
    parts.push(
      line(
        'Shadows',
        store.get().lightMode === 'real'
          ? 'cast by the terrain as drawn, for the Sun\'s real direction and disc size (soft edges are the penumbra). They are as detailed as the elevation data above, no more. Shadowed ground is shown with a faint fill light so its relief stays readable.'
          : 'none: "even" lighting is an artificial light for readability, not the real Sun.',
      ),
    );
    if (steps) {
      parts.push(
        line(
          'Sky paths',
          `the Sun (circles, one per ${stepText(steps.sunH)}) and Earth's libration path (diamonds, one per ${stepText(steps.earthH)}) over the mission window from ${formatUtc(steps.startMs)} for ${steps.durationH} h. ` +
            'Filled marks are above the skyline as drawn; hollow marks are where the track runs behind terrain. Earth visibility is geometric line of sight, not a radio link.',
        ),
      );
    }
    for (const note of g.notes) parts.push(line('Elevation data note', note));
    const keys = el('p', 'sh-keys');
    keys.innerHTML =
      '<strong>Controls: </strong>drag or <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> look · scroll, pinch or <kbd>+</kbd><kbd>−</kbd> zoom · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>E</kbd>/<kbd>Q</kbd> rise and descend · <kbd>Shift</kbd> faster · <kbd>Esc</kbd> back to the globe';
    parts.push(keys);
    body.replaceChildren(...parts);
  };
  surface.onChange = syncStatic;
  store.subscribe(['view', 'lightMode', 'windowStartMs', 'windowDurationH', 'delayH'], (s) => s.view === 'surface' && syncStatic());
  // The folded text quotes the simulated time: bring it up to date when it is opened.
  more.addEventListener('toggle', () => more.open && syncStatic());
  syncStatic();

  // Whose hardware is at this site (GCAT): going near another state's hardware matters.
  const syncOwner = async () => {
    const site = store.get().site;
    const o = site?.kind === 'landing' ? (await loadOwnership())?.byLanding.get(site.id) : undefined;
    owner.textContent = ownerCompact.textContent = o ? `Hardware at this site belongs to ${stateShortName(o)} (GCAT).` : '';
    owner.hidden = ownerCompact.hidden = !o;
  };
  store.subscribe(['site', 'view'], () => void syncOwner());
  void syncOwner();

  let text = '';
  let awayShown: boolean | null = null;
  let lastFrameAt = 0, frameMs = 0;
  onFrame(() => {
    const now = performance.now();
    if (!surface.active) {
      lastFrameAt = 0;
      return;
    }
    // Frame rate as it really is, slow frames included (the resolution tuner leaves those out of its own figure).
    if (lastFrameAt) frameMs = frameMs ? frameMs + (now - lastFrameAt - frameMs) * 0.2 : now - lastFrameAt;
    lastFrameAt = now;
    const fps = frameMs ? 1000 / frameMs : 0;
    const speed = fps ? ` · ${fps >= 10 ? Math.round(fps) : fps.toFixed(1)} fps${surfaceResolution.scale < 1 ? `, ${Math.round(surfaceResolution.scale * 100)}% resolution` : ''}` : '';
    const look = view.lookDirection;
    const h = Math.round(look.azDeg) % 360;
    const d = view.distanceFromSite;
    const where = d < 1 ? 'at the site' : `${metres(d)} from the site`;
    const eye = view.position.eyeHeightM;
    const zoom = Math.abs(look.fovDeg - 70) > 0.5 ? ` · field of view ${look.fovDeg < 10 ? look.fovDeg.toFixed(1) : Math.round(look.fovDeg)}°` : '';
    const next = `Facing ${COMPASS[Math.round(h / 45) % 8]} ${h}°, ${look.elDeg >= 0 ? '+' : '−'}${Math.abs(look.elDeg).toFixed(0)}° · ${where} · eye ${eye < 10 ? eye.toFixed(1) : Math.round(eye)} m above ground${zoom}${speed}`;
    if (next !== text) status.textContent = text = next;
    const away = d > 1 || view.lift > 0.5;
    if (away !== awayShown) home.hidden = !(awayShown = away);
  });
}
