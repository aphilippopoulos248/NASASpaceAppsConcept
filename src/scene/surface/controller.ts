// Drives the surface (ground-level) view: loads a site, turns pointer, touch and keyboard
// input into looking and walking, keeps the scene in step with the shared state (clock,
// lighting, mast height, mission window) and writes the look direction back to it.
import type { WebGLRenderer } from 'three';
import type { MoonGeometry } from '../../astro/ephemeris';
import { registerActions, runAction } from '../../core/actions';
import { onCommand } from '../../core/bus';
import { effectiveStartMs } from '../../core/scenario';
import { store } from '../../core/store';
import type { SiteRef } from '../../core/types';
import { SurfaceView } from '../surface';
import { createSurfaceActions, roundedLook } from './actions';

const DEFAULT_FOV_DEG = 70;
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);
/** Each arrow-key press (and each auto-repeat while it is held) turns the view by this fraction of the field of view. */
const KEY_TURN_STEP = 0.03;
const LOOK_KEYS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

const SURFACE_LABEL =
  'Surface view of the Moon at the selected site. Drag or arrow keys to look around, scroll, pinch or plus/minus to zoom, W A S D to walk, E and Q to rise and descend, Escape to return to the globe.';

/** True when WebGL runs on the CPU (software rasteriser), where this scene needs its lighter settings. */
function isSoftwareRenderer(canvas: HTMLCanvasElement): boolean {
  try {
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export class SurfaceController {
  readonly view: SurfaceView;
  active = false;
  /** Site whose terrain is loaded or loading. */
  private loaded: { id: string; ready: Promise<void> } | null = null;
  /** Site the viewer was last put in front of the Sun for: entering it again keeps the look direction. */
  private facedSite = '';
  private readonly keysDown = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private lastLook = { azDeg: NaN, elDeg: NaN, fovDeg: NaN };
  private previousLabel: string | null = null;

  constructor(anisotropy: number, private readonly canvas: HTMLCanvasElement) {
    // ?quality=low|high overrides the automatic choice (for testing).
    const forced = new URLSearchParams(location.search).get('quality');
    const lowPower = forced === 'low' || (forced !== 'high' && isSoftwareRenderer(canvas));
    this.view = new SurfaceView(anisotropy, { lowPower });
    this.bindInput();

    onCommand('lookAt', ({ azDeg, elDeg }) => {
      const look = store.get().look;
      this.view.setLook(azDeg, elDeg ?? look.elDeg, look.fovDeg);
    });
    store.subscribe(['mastHeightM'], (s) => this.view.setObserverHeight(s.mastHeightM));
    store.subscribe(['windowStartMs', 'windowDurationH', 'delayH'], () => this.syncWindow());
    registerActions(createSurfaceActions({ store, view: this.view, active: () => this.active, changed: () => this.onChange?.() }));
  }

  /** Called when something the HUD shows changes outside the frame loop. */
  onChange: (() => void) | null = null;

  /** Loads the ground for any site: a catalogued landing or a custom pin. Rejects with a sentence when no elevation data can be had. */
  prepare(site: SiteRef): Promise<void> {
    if (this.loaded?.id === site.id) return this.loaded.ready;
    const ready = this.view.load(site).then(
      () => this.onChange?.(),
      (err) => {
        console.warn('Surface view unavailable for this site', err);
        if (this.loaded?.id === site.id) this.loaded = null;
        throw err instanceof Error ? err : new Error(String(err));
      },
    );
    this.loaded = { id: site.id, ready };
    ready.catch(() => undefined);
    return ready;
  }

  /** The surface view comes on screen. */
  enter(_g: MoonGeometry): void {
    const s = store.get();
    this.active = true;
    this.keysDown.clear();
    this.pointers.clear();
    this.view.setMode(s.lightMode);
    this.view.setObserverHeight(s.mastHeightM);
    this.syncWindow();
    this.view.setTime(s.timeMs);
    this.faceOnArrival();
    this.canvas.style.cursor = 'grab';
    this.previousLabel = this.canvas.getAttribute('aria-label');
    this.canvas.setAttribute('aria-label', SURFACE_LABEL);
    this.publishLook();
    this.onChange?.();
  }

  leave(): void {
    this.active = false;
    this.keysDown.clear();
    this.pointers.clear();
    if (this.previousLabel !== null) this.canvas.setAttribute('aria-label', this.previousLabel);
  }

  /** The shared clock or the lighting mode changed. (The scene computes the sky for the site itself, so the geometry passed in is not needed.) */
  setSky(_g: MoonGeometry): void {
    const s = store.get();
    this.view.setMode(s.lightMode);
    if (this.active) this.view.setTime(s.timeMs);
  }

  private syncWindow(): void {
    const s = store.get();
    this.view.setPathWindow(effectiveStartMs(s), s.windowDurationH);
  }

  /**
   * First arrival at a site: face the Sun (or Earth when the Sun is down) with the horizon in
   * view, which is what the view is for. Coming back to the same site, or switching sides of
   * a comparison, keeps the direction the viewer was looking in.
   */
  private faceOnArrival(): void {
    const s = store.get(), site = this.view.site, sky = this.view.skyNow;
    if (!site || !sky || site.id === this.facedSite) return;
    this.facedSite = site.id;
    if (s.comparing) return;
    // A new place starts at the normal field of view, whatever zoom the last one was left at.
    this.view.setFov(DEFAULT_FOV_DEG);
    const body = sky.sun.elDeg > -1 ? sky.sun : sky.earth.elDeg > 0 ? sky.earth : null;
    if (body) this.view.setLook(body.azDeg, Math.max(0, Math.min(30, body.elDeg - 20)));
  }

  private publishLook(): void {
    const look = roundedLook(this.view);
    const l = this.lastLook;
    if (look.azDeg === l.azDeg && look.elDeg === l.elDeg && look.fovDeg === l.fovDeg) return;
    this.lastLook = look;
    store.set({ look });
  }

  private bindInput(): void {
    const canvas = this.canvas;
    const drop = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinchDistance = 0;
      if (this.active && this.pointers.size === 0) canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinchDistance = 0;
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointerup', drop);
    canvas.addEventListener('pointercancel', drop);
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!this.active || !p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        // Drag (mouse or one finger): the scene follows the pointer, as in a street-level viewer.
        this.view.look(-dx, -dy);
      } else if (this.pointers.size === 2) {
        // Two fingers: pinch to zoom.
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDistance > 0 && d > 0) this.view.setFov(this.view.lookDirection.fovDeg * (this.pinchDistance / d));
        this.pinchDistance = d;
      }
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.view.zoom(e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener('keyup', (e) => this.keysDown.delete(e.code));
    window.addEventListener('blur', () => this.keysDown.clear());
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      // Leave keys alone while the user is in a field, a slider, a chart or pressing a button.
      if (t && t !== canvas && t !== document.body && t.closest('input, select, textarea, button, summary, a, [contenteditable], [tabindex], [role="slider"], [role="application"]')) return;
      const turn = LOOK_KEYS[e.code];
      if (turn) {
        // Applied per key event rather than per frame, so a tap is never lost between two slow frames.
        const look = this.view.lookDirection, step = look.fovDeg * KEY_TURN_STEP;
        this.view.setLook(look.azDeg + turn[0] * step, look.elDeg + turn[1] * step);
        e.preventDefault();
      } else if (WALK_KEYS.has(e.code)) {
        this.keysDown.add(e.code);
        e.preventDefault();
      } else if (e.key === '+' || e.key === '=') {
        this.view.zoom(-1);
        e.preventDefault();
      } else if (e.key === '-' || e.key === '_') {
        this.view.zoom(1);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        void runAction('exitSurface');
      }
    });
  }

  render(dt: number, renderer: WebGLRenderer): void {
    const key = (code: string) => (this.keysDown.has(code) ? 1 : 0);
    this.view.step(dt, {
      forward: key('KeyW') - key('KeyS'),
      strafe: key('KeyD') - key('KeyA'),
      rise: Math.min(1, key('KeyE') + key('Space')) - key('KeyQ'),
      fast: this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight'),
    });
    this.view.render(renderer);
    this.publishLook();
  }
}
