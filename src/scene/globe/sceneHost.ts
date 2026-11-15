// Owns the renderer and the frame loop, advances the clock while playing, and switches
// between the globe and the surface view when the store's `view` changes.
import { PCFShadowMap, WebGLRenderer } from 'three';
import { moonGeometry, MoonGeometry } from '../../astro/ephemeris';
import { emitCommand } from '../../core/bus';
import { advanceClock } from '../../core/clock';
import { SITE_ALTITUDE_KM } from '../../core/coreActions';
import { store } from '../../core/store';
import type { SiteRef, ViewMode } from '../../core/types';
import { surfaceResolution } from '../autoResolution';
import { SurfaceController } from '../surface/controller';
import { GlobeView } from './globeView';
import { guardSceneZoom } from './zoomGuard';

export class SceneHost {
  readonly renderer: WebGLRenderer;
  readonly globe: GlobeView;
  readonly surface: SurfaceController;
  private geometry: MoonGeometry;
  private showing: ViewMode = 'globe';
  /** Callers waiting for a view to be the one on screen (see viewShown). */
  private readonly viewWaiters: { view: ViewMode; resolve: () => void }[] = [];
  /** The fade to the other view, while it runs. */
  private switchTimer: number | null = null;
  private readonly fade: HTMLElement;
  private readonly frameListeners = new Set<(dt: number) => void>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    guardSceneZoom(canvas);
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    const basePixelRatio = Math.min(window.devicePixelRatio, 2);
    r.setPixelRatio(basePixelRatio);
    // The surface view is drawn a little smaller when frames run slow (see autoResolution.ts).
    surfaceResolution.attach((scale) => r.setPixelRatio(basePixelRatio * scale));
    r.shadowMap.enabled = true; // used by the surface view
    r.shadowMap.type = PCFShadowMap; // the cheaper filter; shadows here are small and sharp anyway
    this.globe = new GlobeView(r, canvas);
    this.surface = new SurfaceController(r.capabilities.getMaxAnisotropy(), canvas);
    // Dev builds only: lets the surface view be inspected from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __surface: unknown }).__surface = this.surface.view;
    this.geometry = moonGeometry(new Date(store.get().timeMs));

    this.fade = document.createElement('div');
    this.fade.className = 'scene-fade';
    document.body.append(this.fade);

    store.subscribe(['timeMs'], (s) => this.setTime(s.timeMs));
    store.subscribe(['lightMode'], () => this.surface.setSky(this.geometry));
    store.subscribe(['view'], () => this.switchView());
    this.setTime(store.get().timeMs);

    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      r.setSize(w, h, false);
      this.globe.resize(w, h);
      this.surface.view.resize(w / h);
    };
    window.addEventListener('resize', resize);
    resize();
  }

  get moonGeometry(): MoonGeometry {
    return this.geometry;
  }

  async load(): Promise<void> {
    await this.globe.load();
    this.start();
  }

  /** Hook for the enterSurface action: terrain loaded and the camera has arrived. */
  prepareSurface = async (site: SiteRef): Promise<void> => {
    await Promise.all([this.surface.prepare(site), this.globe.arrived()]);
  };

  /**
   * Resolves when `view` is the one on screen. The switch fades over about a third of a second
   * and the surface scene only takes commands once it shows, so an action that enters the
   * surface waits for this before it reports back. Also resolves when the app has moved on to
   * the other view meanwhile (nothing is left to wait for; the caller reads the state).
   */
  viewShown = (view: ViewMode): Promise<void> => {
    if (this.showing === view || store.get().view !== view) return Promise.resolve();
    return new Promise<void>((resolve) => this.viewWaiters.push({ view, resolve }));
  };

  /** Deep links straight to the surface: put the globe camera over the site at once. */
  jumpTo = (lat: number, lon: number): void => this.globe.jumpTo(lat, lon, SITE_ALTITUDE_KM);

  onFrame(fn: (dt: number) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  private setTime(ms: number): void {
    this.geometry = moonGeometry(new Date(ms));
    this.globe.setGeometry(this.geometry);
    this.surface.setSky(this.geometry);
  }

  /**
   * The store asks for the other view: fade over to it. What goes on screen is decided when
   * the fade is dark, from the store as it is then, so a view asked for and taken back within
   * the fade (enter, then Escape or the close button at once) leaves the scene where the
   * store says, never one view on screen and the other in the state.
   */
  private switchView(): void {
    if (store.get().view === this.showing || this.switchTimer !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.applyView();
      return;
    }
    this.fade.classList.add('on');
    this.switchTimer = window.setTimeout(() => {
      this.switchTimer = null;
      this.applyView();
      this.fade.classList.remove('on');
    }, 320);
  }

  /** Puts the view the store asks for on screen, if it is not there already, and tells whoever waited for it. */
  private applyView(): void {
    const view = store.get().view;
    if (view !== this.showing) {
      this.showing = view;
      if (view === 'surface') {
        this.globe.active = false;
        this.globe.controls.enabled = false;
        this.globe.hideTooltip();
        this.surface.enter(this.geometry);
      } else {
        this.surface.leave();
        surfaceResolution.reset();
        this.globe.active = true;
        this.globe.controls.enabled = true;
        this.canvas.style.cursor = 'grab';
      }
      document.body.dataset.view = view;
    }
    for (const w of this.viewWaiters.splice(0)) w.resolve();
  }

  private start(): void {
    let last = performance.now();
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = store.get();
      if (s.playing) {
        const step = advanceClock(s, dt);
        store.set({ timeMs: step.timeMs, ...(!step.playing && { playing: false }) });
        if (step.stopped === 'window-end') emitCommand('toast', { text: 'End of the mission window: paused. Press play to go on past it.' });
      }
      if (this.showing === 'surface') {
        surfaceResolution.tune(dt, now);
        this.surface.render(dt, this.renderer);
      } else this.globe.render(dt, now / 1000);
      for (const fn of this.frameListeners) fn(dt);
    });
  }
}
