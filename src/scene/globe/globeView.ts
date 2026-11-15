// The 3D globe: Moon, stars, Sun/Earth, landing markers (coloured by country) with their explored
// areas and optional country flags, custom pin, close-up imagery, orbit controls and fly-to. It follows the store (time, light, site, filters) and writes
// the camera pose back (globeCenter); clicks and picks go out as actions.
import { Camera, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Ray, RingGeometry, Scene, Sphere, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { defineAction, registerActions, runAction } from '../../core/actions';
import { onCommand } from '../../core/bus';
import { GLOBE_ALTITUDE_KM, MAX_ALTITUDE_KM, MIN_ALTITUDE_KM } from '../../core/coreActions';
import { matchesFilter, missionFilter } from '../../core/missionFilter';
import { store } from '../../core/store';
import { MOON_RADIUS_KM, SiteRef, wrapLon } from '../../core/types';
import type { MoonGeometry } from '../../astro/ephemeris';
import { getLandings } from '../../data/catalog';
import { landingColor, latLonToVec3 } from '../../data/landings';
import { loadOwnership } from '../../data/ownership';
import { FlagMarkers } from '../flags';
import { createMoon, createStars } from '../globe';
import { Marker, Markers } from '../markers';
import { loadSiteAreas, SiteAreaLayer } from '../siteAreas';
import { SitePatch } from '../sitePatch';
import { Sky } from '../sky';

const GLOBE_DISTANCE = 1 + GLOBE_ALTITUDE_KM / MOON_RADIUS_KM;
const MIN_DISTANCE = 1.006;
const Z = new Vector3(0, 0, 1);
const MOON = new Sphere(new Vector3(), 1);

/** Scene direction to selenographic lat/lon (inverse of latLonToVec3). */
const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export function vec3ToLatLon(v: Vector3): { lat: number; lon: number } {
  const n = v.clone().normalize();
  return { lat: (Math.asin(Math.max(-1, Math.min(1, n.y))) * 180) / Math.PI, lon: wrapLon((Math.atan2(-n.z, n.x) * 180) / Math.PI) };
}

export class GlobeView {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.01, 1200);
  readonly controls: OrbitControls;
  private readonly sky = new Sky();
  private markers: Markers | null = null;
  private areas: SiteAreaLayer | null = null;
  private flags: FlagMarkers | null = null;
  private sitePatch: SitePatch | null = null;
  private patchSiteId = '';
  private readonly pin = new Group();
  private fly: { dir: Vector3; dist: number; done: (() => void)[] } | null = null;
  private readonly camDir = new Vector3();
  private readonly axis = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private lastCenter = { lat: NaN, lon: NaN, altitudeKm: NaN };
  private readonly tooltip: HTMLElement;
  private downAt: { x: number; y: number } | null = null;
  active = true;

  constructor(private readonly renderer: WebGLRenderer, private readonly canvas: HTMLCanvasElement) {
    // +X is the sub-Earth point, so this is the familiar near-side view with north up.
    this.camera.position.set(GLOBE_DISTANCE, 0.5, 0).setLength(GLOBE_DISTANCE);
    const c = (this.controls = new OrbitControls(this.camera, canvas));
    c.enableDamping = true;
    c.enablePan = false;
    c.minDistance = MIN_DISTANCE;
    c.maxDistance = 9;
    c.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    c.autoRotateSpeed = 0.35;
    c.addEventListener('start', () => {
      c.autoRotate = false;
      this.cancelFly();
    });
    this.scene.add(this.sky.root, createStars());

    const pinMat = new MeshBasicMaterial({ color: '#ffd479', toneMapped: false, side: DoubleSide, transparent: true });
    const ring = new Mesh(new RingGeometry(1.6, 2.3, 40), pinMat);
    const dot = new Mesh(new RingGeometry(0, 0.7, 24), pinMat);
    this.pin.add(ring, dot);
    this.pin.traverse((o) => (o.renderOrder = 4));
    this.pin.visible = false;
    this.scene.add(this.pin);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'ly-tooltip globe-tooltip';
    this.tooltip.hidden = true;
    this.tooltip.setAttribute('role', 'presentation');
    document.body.append(this.tooltip);

    onCommand('flyTo', ({ lat, lon, altitudeKm }) => {
      this.flyTo(latLonToVec3(lat, lon), altitudeKm === undefined ? undefined : 1 + altitudeKm / MOON_RADIUS_KM);
    });
    this.bindPointer();
    this.bindKeyboard();
    registerActions([
      defineAction({
        name: 'resetNorth',
        title: 'North up',
        description: 'Turns the globe view so that lunar north points up on screen (what clicking the compass does).',
        effect: 'command',
        params: { type: 'object', properties: {} },
        run: () => {
          this.resetNorth();
          return { northAngleDeg: Math.round(this.northAngleDeg() * 10) / 10 };
        },
      }),
    ]);
  }

  /** Keyboard on the focused globe: arrows turn, +/- zoom, Enter drops a pin at the centre. */
  private bindKeyboard(): void {
    this.canvas.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const c = store.get().globeCenter;
      // Turn by about a tenth of the visible width.
      const stepDeg = Math.min(20, Math.max(0.02, (c.altitudeKm / MOON_RADIUS_KM) * 12));
      let lat = c.lat, lon = c.lon, alt = c.altitudeKm;
      switch (e.key) {
        case 'ArrowUp': lat = Math.min(89, lat + stepDeg); break;
        case 'ArrowDown': lat = Math.max(-89, lat - stepDeg); break;
        case 'ArrowLeft': lon = wrapLon(lon - stepDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180))); break;
        case 'ArrowRight': lon = wrapLon(lon + stepDeg / Math.max(0.2, Math.cos((lat * Math.PI) / 180))); break;
        case '+': case '=': alt = Math.max(MIN_ALTITUDE_KM, alt / 1.5); break;
        case '-': case '_': alt = Math.min(MAX_ALTITUDE_KM, alt * 1.5); break;
        case 'Enter':
          e.preventDefault();
          void runAction('dropPin', { lat: round5(c.lat), lon: round5(c.lon) });
          return;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      void runAction('setGlobeCamera', { lat, lon, altitudeKm: alt });
    });
  }

  async load(): Promise<void> {
    const [moon, owners, areas] = await Promise.all([createMoon(this.renderer), loadOwnership(), loadSiteAreas()]);
    this.scene.add(moon);
    this.markers = new Markers([...getLandings()]);
    this.scene.add(this.markers.root);
    // Explored area of each site in its country's colour (globe view only), and the optional flags.
    this.areas = new SiteAreaLayer(this.markers.items, areas);
    this.flags = new FlagMarkers(this.markers.items, (id) => owners?.byLanding.get(id));
    this.scene.add(this.areas.root, this.flags.root);
    const s = store.get();
    this.applyFilter();
    this.applySite(s.site);
    this.applyMissions(s.showMissions, s.showFlags);
    this.sky.setMode(s.lightMode);
    store.subscribe(['site'], (st) => this.applySite(st.site));
    store.subscribe(['showMissions', 'showFlags'], (st) => this.applyMissions(st.showMissions, st.showFlags));
    store.subscribe(['lightMode'], (st) => this.sky.setMode(st.lightMode));
    missionFilter.subscribe(() => this.applyFilter());
  }

  setGeometry(g: MoonGeometry): void {
    this.sky.setGeometry(g);
  }

  /** Markers in display order (filtered), for picking and stepping. */
  get visibleMarkers(): Marker[] {
    return this.markers?.visible ?? [];
  }

  /** Markers, their explored areas and flags show together; flags only when also asked for. */
  private applyMissions(showMissions: boolean, showFlags: boolean): void {
    if (this.markers) this.markers.root.visible = showMissions;
    if (this.areas) this.areas.root.visible = showMissions;
    this.flags?.setEnabled(showMissions && showFlags);
  }

  private applyFilter(): void {
    const f = missionFilter.get();
    this.markers?.setFilter((l) => matchesFilter(f, l));
  }

  private applySite(site: SiteRef | null): void {
    const marker = site?.kind === 'landing' ? (this.markers?.items.find((m) => m.landing.id === site.id) ?? null) : null;
    this.markers?.select(marker);
    this.pin.visible = site?.kind === 'custom';
    if (site?.kind === 'custom') {
      const dir = latLonToVec3(site.lat, site.lon);
      this.pin.position.copy(dir).multiplyScalar(1.0002);
      this.pin.quaternion.setFromUnitVectors(Z, dir);
    }
    if (!site) {
      this.sitePatch?.dispose();
      this.sitePatch = null;
      this.patchSiteId = '';
    } else if (site.id !== this.patchSiteId) {
      this.sitePatch?.dispose();
      this.sitePatch = new SitePatch(site.lat, site.lon, this.renderer.capabilities.getMaxAnisotropy());
      this.patchSiteId = site.id;
      this.scene.add(this.sitePatch.root);
    }
  }

  /** Places the camera above a point at once (deep links straight to the surface). */
  jumpTo(lat: number, lon: number, altitudeKm: number): void {
    this.cancelFly();
    this.controls.autoRotate = false;
    this.camera.position.copy(latLonToVec3(lat, lon)).multiplyScalar(1 + altitudeKm / MOON_RADIUS_KM);
  }

  /** Resolves when the current flight (if any) has arrived or was interrupted. */
  arrived(): Promise<void> {
    if (!this.fly) return Promise.resolve();
    return new Promise((r) => this.fly!.done.push(r));
  }

  private cancelFly(): void {
    const f = this.fly;
    this.fly = null;
    f?.done.forEach((d) => d());
  }

  private flyTo(dir: Vector3, dist?: number): void {
    const d = dir.clone().normalize();
    // Keep the poles from ending up dead-centre, where orbiting gets twitchy.
    d.y = Math.max(-0.985, Math.min(0.985, d.y));
    const waiting = this.fly?.done ?? [];
    this.fly = { dir: d.normalize(), dist: dist ?? this.camera.position.length(), done: waiting };
    this.controls.autoRotate = false;
  }

  private stepFly(dt: number): void {
    const fly = this.fly;
    if (!fly) return;
    const cam = this.camera;
    const alt = cam.position.length() - 1;
    const targetAlt = fly.dist - 1;
    this.camDir.copy(cam.position).normalize();
    const angle = this.camDir.angleTo(fly.dir);
    const logGap = Math.log(targetAlt / alt);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || (angle < 0.001 && Math.abs(logGap) < 0.02)) {
      cam.position.copy(fly.dir).multiplyScalar(fly.dist);
      this.cancelFly();
      return;
    }
    // Ease out: cover a fixed fraction of what remains each frame; altitude eased on a log scale.
    const t = Math.min(1, 1 - Math.exp(-dt * 3.2));
    this.axis.crossVectors(this.camDir, fly.dir);
    if (this.axis.lengthSq() < 1e-12) this.axis.set(0, 1, 0);
    this.camDir.applyAxisAngle(this.axis.normalize(), angle * t);
    cam.position.copy(this.camDir).multiplyScalar(1 + alt * Math.exp(logGap * t));
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    // Keep the whole globe in view on narrow (portrait) screens.
    this.camera.fov = w < h ? 40 * Math.min(1.6, h / w) : 40;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number, nowSec: number): void {
    const cam = this.camera;
    this.stepFly(dt);
    // Scale rotate and zoom speeds with altitude, so control stays fine near the surface.
    const alt = Math.max(cam.position.length() - 1, 1e-4);
    this.controls.rotateSpeed = Math.min(1, Math.max(0.004, alt / 2.2));
    this.controls.zoomSpeed = Math.log((1 + 1.08 * alt) / (1 + alt)) / 0.0513;
    this.controls.update();
    const altNow = Math.max(cam.position.length() - 1, 1e-4);
    cam.near = Math.max(0.0005, altNow * 0.2);
    cam.updateProjectionMatrix();
    cam.matrixWorld.extractBasis(this.right, this.up, this.camDir);
    this.sky.update(cam, this.right, this.up);
    this.markers?.update(cam, nowSec);
    this.areas?.update(cam);
    this.flags?.update(cam, nowSec, this.sky.litDirection);
    const s = this.pin.visible ? cam.position.distanceTo(this.pin.position) * 0.006 : 0;
    if (s) this.pin.scale.setScalar(s);
    this.sitePatch?.update(altNow);
    this.renderer.render(this.scene, cam);
    this.publishCenter(altNow);
  }

  /** Writes the point under the screen centre and the altitude to the store, when they change visibly. */
  private publishCenter(altitude: number): void {
    const { lat, lon } = vec3ToLatLon(this.camera.position);
    const altitudeKm = altitude * MOON_RADIUS_KM;
    const c = this.lastCenter;
    if (Math.abs(lat - c.lat) < 1e-4 && Math.abs(wrapLon(lon - c.lon)) < 1e-4 && Math.abs(altitudeKm - c.altitudeKm) < altitudeKm * 1e-4) return;
    this.lastCenter = { lat, lon, altitudeKm };
    store.set({ globeCenter: { lat, lon, altitudeKm } });
  }

  // ---------- hover + click ----------
  private pickAt(e: PointerEvent, camera: Camera): Marker[] {
    if (!this.markers?.root.visible) return [];
    const r = this.canvas.getBoundingClientRect();
    return this.markers.pick(e.clientX - r.left, e.clientY - r.top, camera, r.width, r.height);
  }

  private bindPointer(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (e.pointerType === 'touch' || e.buttons !== 0) {
        this.tooltip.hidden = true;
        return;
      }
      const hits = this.pickAt(e, this.camera);
      canvas.style.cursor = hits.length ? 'pointer' : 'grab';
      if (!hits.length) {
        this.tooltip.hidden = true;
        return;
      }
      this.tooltip.replaceChildren(
        ...hits.map((m) => {
          const row = document.createElement('div');
          row.className = 'tip-row';
          const sw = document.createElement('span');
          sw.className = 'ly-swatch';
          sw.style.background = landingColor(m.landing);
          const date = document.createElement('span');
          date.className = 'ly-value tip-date';
          date.textContent = m.landing.date.slice(0, 4);
          row.append(sw, m.landing.name, date);
          return row;
        }),
      );
      this.tooltip.style.left = `${e.clientX}px`;
      this.tooltip.style.top = `${e.clientY}px`;
      this.tooltip.hidden = false;
    });
    canvas.addEventListener('pointerleave', () => (this.tooltip.hidden = true));
    canvas.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.active) return;
      const moved = this.downAt ? Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) : Infinity;
      this.downAt = null;
      if (moved > 5) return; // a drag, not a click
      this.tooltip.hidden = true;
      const hits = this.pickAt(e, this.camera);
      if (!hits.length) {
        // Empty ground: drop a pin there.
        const at = this.latLonAt(e.clientX, e.clientY);
        if (at) void runAction('dropPin', { lat: round5(at.lat), lon: round5(at.lon) });
        return;
      }
      // Clicking again on overlapping sites (e.g. Apollo 12 / Surveyor 3) cycles through them.
      const current = hits.findIndex((m) => m.landing.id === store.get().site?.id);
      const next = hits[(current + 1) % hits.length];
      void runAction('selectSite', { site: next.landing.id, surface: true });
    });
  }

  /** The surface point under a screen position (client pixels), or null off the Moon. */
  latLonAt(clientX: number, clientY: number): { lat: number; lon: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const hit = new Ray(this.camera.position.clone(), dir).intersectSphere(MOON, new Vector3());
    return hit ? vec3ToLatLon(hit) : null;
  }

  /** Screen angle of lunar north at the screen centre, degrees clockwise from screen-up. */
  northAngleDeg(): number {
    const c = this.camera.position.clone().normalize();
    const north = new Vector3(0, 1, 0).addScaledVector(c, -c.y);
    if (north.lengthSq() < 1e-10) return 0; // looking straight down a pole
    this.camera.matrixWorld.extractBasis(this.right, this.up, this.camDir);
    return (Math.atan2(north.dot(this.right), north.dot(this.up)) * 180) / Math.PI;
  }

  /** Restores the default orientation: lunar north up on screen. */
  resetNorth(): void {
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  hideTooltip(): void {
    this.tooltip.hidden = true;
  }
}
