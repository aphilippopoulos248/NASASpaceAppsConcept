// Owns the renderer and the frame loop, advances the clock while playing, and switches
// between the globe and the surface view when the store's `view` changes.
import { PCFSoftShadowMap, WebGLRenderer } from 'three';
import { moonGeometry, MoonGeometry } from '../../astro/ephemeris';
import { SITE_ALTITUDE_KM } from '../../core/coreActions';
import { MAX_TIME_MS, store } from '../../core/store';
import type { SiteRef } from '../../core/types';
import { SurfaceController } from '../surface/controller';
import { GlobeView } from './globeView';

export class SceneHost {
  readonly renderer: WebGLRenderer;
  readonly globe: GlobeView;
  readonly surface: SurfaceController;
  private geometry: MoonGeometry;
  private showing: 'globe' | 'surface' = 'globe';
  private readonly fade: HTMLElement;
  private readonly frameListeners = new Set<(dt: number) => void>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const r = (this.renderer = new WebGLRenderer({ canvas, antialias: true }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true; // used by the surface view
    r.shadowMap.type = PCFSoftShadowMap;
    this.globe = new GlobeView(r, canvas);
    this.surface = new SurfaceController(r.capabilities.getMaxAnisotropy(), canvas);
    this.geometry = moonGeometry(new Date(store.get().timeMs));

    this.fade = document.createElement('div');
    this.fade.className = 'scene-fade';
    document.body.append(this.fade);

    store.subscribe(['timeMs'], (s) => this.setTime(s.timeMs));
    store.subscribe(['lightMode'], () => this.surface.setSky(this.geometry));
    store.subscribe(['view'], (s) => this.switchView(s.view));
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

  private switchView(view: 'globe' | 'surface'): void {
    if (view === this.showing) return;
    const change = () => {
      this.showing = view;
      if (view === 'surface') {
        this.globe.active = false;
        this.globe.controls.enabled = false;
        this.globe.hideTooltip();
        this.surface.enter(this.geometry);
      } else {
        this.surface.leave();
        this.globe.active = true;
        this.globe.controls.enabled = true;
        this.canvas.style.cursor = 'grab';
      }
      document.body.dataset.view = view;
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    this.fade.classList.add('on');
    window.setTimeout(() => {
      change();
      this.fade.classList.remove('on');
    }, 320);
  }

  private start(): void {
    let last = performance.now();
    this.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const s = store.get();
      if (s.playing) {
        const t = Math.min(MAX_TIME_MS, s.timeMs + dt * s.rate * 1000);
        store.set({ timeMs: t, ...(t >= MAX_TIME_MS && { playing: false }) });
      }
      if (this.showing === 'surface') this.surface.render(dt, this.renderer);
      else this.globe.render(dt, now / 1000);
      for (const fn of this.frameListeners) fn(dt);
    });
  }
}
