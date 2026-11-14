// Drives the surface (ground-level) view: loading a site, mouse look, walking keys,
// zoom, lookAt commands, and writing the look direction back to the store.
// Created by @globe with the app shell; owned by @surface from here on.
import type { MoonGeometry } from '../../astro/ephemeris';
import { defineAction, registerActions, runAction } from '../../core/actions';
import { onCommand } from '../../core/bus';
import { store } from '../../core/store';
import type { SiteRef } from '../../core/types';
import { getLandings } from '../../data/catalog';
import { SurfaceView } from '../surface';

const DEG = Math.PI / 180;
const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);

export class SurfaceController {
  readonly view: SurfaceView;
  active = false;
  private readonly keysDown = new Set<string>();
  private loaded: { id: string; ready: Promise<void> } | null = null;
  private lastLook = { azDeg: NaN, elDeg: NaN, fovDeg: NaN };

  constructor(anisotropy: number, private readonly canvas: HTMLCanvasElement) {
    this.view = new SurfaceView(anisotropy);
    this.bindInput();
    onCommand('lookAt', ({ azDeg, elDeg }) => this.setLook(azDeg, elDeg ?? store.get().look.elDeg, store.get().look.fovDeg));
    registerActions([
      defineAction<{ on: boolean }, unknown>({
        name: 'setGeneratedDetail',
        title: 'Generated detail',
        description: 'In the surface view, shows or hides generated (not measured) detail: rocks and sub-metre texture. Measured terrain is always shown.',
        effect: 'command',
        params: { type: 'object', properties: { on: { type: 'boolean', description: 'Show generated detail.' } }, required: ['on'] },
        run: ({ on }) => {
          this.view.setGenerated(on);
          this.onChange?.();
          return { generatedDetail: this.view.generated };
        },
      }),
    ]);
  }

  /** Called when something the HUD shows changes outside the frame loop. */
  onChange: (() => void) | null = null;

  /** Loads terrain for a site. Rejects with a sentence when no surface model exists for it. */
  prepare(site: SiteRef): Promise<void> {
    if (this.loaded?.id === site.id) return this.loaded.ready;
    const landing = site.kind === 'landing' ? getLandings().find((l) => l.id === site.id) : undefined;
    const ready = landing
      ? this.view.load(landing).catch((err) => {
          console.warn('Surface view unavailable for this site', err);
          this.loaded = null;
          throw new Error(`No surface terrain is available for ${site.name}.`);
        })
      : Promise.reject(new Error('The surface view is available for the catalogued landing sites; custom pins need the elevation service, which is not merged yet.'));
    this.loaded = { id: site.id, ready };
    ready.catch(() => undefined);
    return ready;
  }

  enter(g: MoonGeometry): void {
    this.active = true;
    this.keysDown.clear();
    this.view.setMode(store.get().lightMode);
    this.view.setSky(g);
    this.canvas.style.cursor = 'grab';
    this.onChange?.();
  }

  leave(): void {
    this.active = false;
    this.keysDown.clear();
  }

  setSky(g: MoonGeometry): void {
    this.view.setMode(store.get().lightMode);
    if (this.active) this.view.setSky(g);
  }

  /** Absolute look direction (degrees). SurfaceView keeps pitch private, so pitch is set through look(). */
  private setLook(azDeg: number, elDeg: number, fovDeg: number): void {
    const v = this.view;
    v.heading = ((azDeg % 360) + 360) % 360;
    v.camera.fov = fovDeg;
    v.camera.updateProjectionMatrix();
    const k = (v.camera.fov / 70) * 0.0028;
    const pitchNow = v.camera.rotation.x / DEG;
    v.look(0, ((pitchNow - elDeg) * DEG) / k);
  }

  private publishLook(): void {
    const v = this.view;
    const look = { azDeg: Math.round(v.heading * 10) / 10, elDeg: Math.round((v.camera.rotation.x / DEG) * 10) / 10, fovDeg: Math.round(v.camera.fov * 10) / 10 };
    const l = this.lastLook;
    if (look.azDeg === l.azDeg && look.elDeg === l.elDeg && look.fovDeg === l.fovDeg) return;
    this.lastLook = look;
    store.set({ look });
  }

  private bindInput(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointerup', () => {
      if (this.active) canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('pointermove', (e) => {
      // Hold the left mouse button (or drag a finger) to look around.
      if (this.active && e.buttons & 1) this.view.look(-e.movementX, -e.movementY);
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
      if (!this.active) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, select, textarea, [contenteditable]') || (t.closest('button') && (e.code === 'Space' || e.key === 'Enter')))) return;
      if (WALK_KEYS.has(e.code)) {
        this.keysDown.add(e.code);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        void runAction('exitSurface');
      }
    });
  }

  render(dt: number, renderer: { render(scene: unknown, camera: unknown): void }): void {
    const key = (code: string) => (this.keysDown.has(code) ? 1 : 0);
    this.view.step(dt, {
      forward: key('KeyW') - key('KeyS'),
      strafe: key('KeyD') - key('KeyA'),
      rise: Math.min(1, key('KeyE') + key('Space')) - key('KeyQ'),
      fast: this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight'),
    });
    renderer.render(this.view.scene, this.view.camera);
    this.publishLook();
  }
}
