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
import { aimAtBody, createSurfaceActions, roundedLook, type TrackedBody } from './actions';
import { focusPlace, probeElement, surfaceCommand } from './keys';

const DEFAULT_FOV_DEG = 70;
/** Each arrow-key press (and each auto-repeat while it is held) turns the view by this fraction of the field of view. */
const KEY_TURN_STEP = 0.03;

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
  private previousRole: string | null = null;
  private trackedBody: TrackedBody | null = null;

  constructor(anisotropy: number, private readonly canvas: HTMLCanvasElement) {
    // ?quality=low|high overrides the automatic choice (for testing).
    const forced = new URLSearchParams(location.search).get('quality');
    const lowPower = forced === 'low' || (forced !== 'high' && isSoftwareRenderer(canvas));
    this.view = new SurfaceView(anisotropy, { lowPower });
    this.bindInput();

    onCommand('lookAt', ({ azDeg, elDeg }) => {
      // Turned somewhere on purpose (the assistant, the skyline chart, "Turn the view to it"): tracking ends, as with a drag.
      this.stopTracking();
      const look = store.get().look;
      this.view.setLook(azDeg, elDeg ?? look.elDeg, look.fovDeg);
    });
    store.subscribe(['mastHeightM'], (s) => this.view.setObserverHeight(s.mastHeightM));
    store.subscribe(['windowStartMs', 'windowDurationH', 'delayH'], () => this.syncWindow());
    registerActions(
      createSurfaceActions({
        store,
        view: this.view,
        active: () => this.active,
        trackingBody: () => this.trackedBody,
        setTrackingBody: (body) => this.setTrackingBody(body),
        changed: () => this.onChange?.(),
      }),
    );
  }

  /** Called when something the HUD shows changes outside the frame loop. */
  onChange: (() => void) | null = null;

  get trackingBody(): TrackedBody | null {
    return this.trackedBody;
  }

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
    this.followTrackedBody();
    this.canvas.style.cursor = 'grab';
    this.previousLabel = this.canvas.getAttribute('aria-label');
    this.canvas.setAttribute('aria-label', SURFACE_LABEL);
    // "application": screen readers pass the arrow keys on to the view instead of reading with them.
    this.previousRole = this.canvas.getAttribute('role');
    this.canvas.setAttribute('role', 'application');
    this.publishLook();
    this.onChange?.();
    // Opened from a control that is now hidden (the site card's button), the focus would be
    // nowhere: put it on the scene, whose label names the keys. Focus that is still somewhere
    // useful (the assistant's text box, the time scrubber) stays where it is.
    requestAnimationFrame(() => {
      if (!this.active) return;
      const focused = document.activeElement as HTMLElement | null;
      const visible = (el: HTMLElement) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
      if (!focused || focused === document.body || !visible(focused)) this.canvas.focus({ preventScroll: true });
    });
  }

  leave(): void {
    this.active = false;
    this.keysDown.clear();
    this.pointers.clear();
    if (this.previousLabel !== null) this.canvas.setAttribute('aria-label', this.previousLabel);
    if (this.previousRole === null) this.canvas.removeAttribute('role');
    else this.canvas.setAttribute('role', this.previousRole);
  }

  /** The shared clock or the lighting mode changed. (The scene computes the sky for the site itself, so the geometry passed in is not needed.) */
  setSky(_g: MoonGeometry): void {
    const s = store.get();
    this.view.setMode(s.lightMode);
    if (this.active) {
      this.view.setTime(s.timeMs);
      this.followTrackedBody();
      this.publishLook();
    }
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

  private setTrackingBody(body: TrackedBody | null): void {
    this.trackedBody = body;
  }

  private stopTracking(): void {
    if (!this.trackedBody) return;
    this.setTrackingBody(null);
    this.onChange?.();
  }

  private followTrackedBody(): void {
    if (this.trackedBody) aimAtBody(this.view, this.trackedBody);
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
        if (dx || dy) this.stopTracking();
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
    // Keys on the whole document (rules in keys.ts): looking, walking and zooming work wherever
    // the focus is, except in fields and in widgets with keys of their own.
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const command = surfaceCommand(e, focusPlace(probeElement(e.target, canvas)));
      if (!command) return;
      // Marked as handled, so the same key press does nothing else (Escape used to deselect the site too).
      e.preventDefault();
      if (command.kind === 'look') {
        // Applied per key event rather than per frame, so a tap is never lost between two slow frames.
        this.stopTracking();
        const look = this.view.lookDirection, step = look.fovDeg * KEY_TURN_STEP;
        this.view.setLook(look.azDeg + command.dAz * step, look.elDeg + command.dEl * step);
      } else if (command.kind === 'walk') this.keysDown.add(command.code);
      else if (command.kind === 'zoom') this.view.zoom(command.dir);
      else void runAction('exitSurface');
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
