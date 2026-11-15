// The 3D globe: the Moon with real relief (LOLA elevation), stars, Sun/Earth, landing
// markers (coloured by country), the country territories and optional country flags, custom
// pin, close-up imagery, colour overlays, orbit controls and fly-to. It
// follows the store (time, light, site, filters, overlay) and writes the camera pose back
// (globeCenter); clicks and picks go out as actions.
import { AmbientLight, Box3, Camera, CanvasTexture, DirectionalLight, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Ray, RingGeometry, Scene, Sphere, SphereGeometry, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { defineAction, registerActions, runAction } from '../../core/actions';
import { onCommand } from '../../core/bus';
import { iceTargetLayer } from '../../science/siteScience';
import { GLOBE_ALTITUDE_KM } from '../../core/coreActions';
import { matchesFilter, missionFilter } from '../../core/missionFilter';
import { store } from '../../core/store';
import { MOON_RADIUS_KM, MOON_RADIUS_M, SiteRef, wrapLon } from '../../core/types';
import type { MoonGeometry } from '../../astro/ephemeris';
import { getLandings } from '../../data/catalog';
import { landingColor, latLonToVec3 } from '../../data/landings';
import { loadOwnership } from '../../data/ownership';
import { roverNowMs, simulatedRovers } from '../../data/rovers';
import { coverageRegions, demLayers } from '../../terrain/api';
import { FlagMarkers } from '../flags';
import { createMoonMaterial, createStars } from '../globe';
import { Marker, Markers } from '../markers';
import { IMAGERY_MAX_LAT, SitePatch } from '../sitePatch';
import { Sky } from '../sky';
import { AverageMaps } from './averageMaps';
import { CoverageOutlines, windowClasses } from './coverageOutlines';
import { globeDisplay, registerDisplayActions } from './displayState';
import { MarkerClicks } from './markerClicks';
import { IceOutlines } from './iceOutlines';
import { COVERAGE_STYLE, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayStyle';
import { PolarCloseUp } from './polarCloseUp';
import { ReliefGlobe } from './reliefGlobe';
import { RoverMarkers } from './roverMarkers';
import { LandingSearchMarkers } from './landingSearchMarkers';
import { effectiveRelief } from './reliefTiles';
import { handleGlobeKey } from './globeKeys';
import { flyDirection } from './flyTarget';
import { vec3ToLatLon } from './latLon';
import { createSurfaceUniforms, OVERLAY_CODE, patchSurfaceMaterial, setSurfaceFeatures } from './surfaceShader';
import { setTerritories, territoryFill } from './territories';
import { ShootingStar } from './shootingStar';

const GLOBE_DISTANCE = 1 + GLOBE_ALTITUDE_KM / MOON_RADIUS_KM;
const INTRO_DISTANCE = 6;
/** The camera comes no closer to the terrain under the screen centre than this, Moon radii (about 10 km). */
const MIN_CLEARANCE = 0.006;
const MIN_DISTANCE = 1 + MIN_CLEARANCE;

const Z = new Vector3(0, 0, 1);
const MOON = new Sphere(new Vector3(), 1);

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;

export { vec3ToLatLon };

export class GlobeView {
  readonly scene = new Scene();
  private readonly introStationScene = new Scene();
  readonly camera = new PerspectiveCamera(40, 1, 0.01, 1200);
  readonly controls: OrbitControls;
  private readonly sky = new Sky();
  private markers: Markers | null = null;
  /** SIMULATED rovers beside some landings (not data): shown and filtered with the landing markers. */
  private rovers: RoverMarkers | null = null;
  private sitePatch: SitePatch | null = null;
  private patchSiteId = '';
  private readonly pin = new Group();
  private readonly landingSearch = new LandingSearchMarkers();
  /** The flight under way: where to, and the point asked for (the keyboard steps on from it). */
  private fly: { dir: Vector3; dist: number; done: (() => void)[]; asked: { lat: number; lon: number } } | null = null;
  private readonly camDir = new Vector3();
  private readonly axis = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private lastCenter = { lat: NaN, lon: NaN, altitudeKm: NaN };
  private readonly tooltip: HTMLElement;
  private downAt: { x: number; y: number } | null = null;
  /** Click, double-click and taking turns on the landing markers (markerClicks.ts). */
  private readonly markerClicks = new MarkerClicks({
    act: (a) => {
      if (!this.active) return; // a turn that came due after the surface view opened
      if (a.kind === 'surface') {
        void runAction('selectSite', { site: a.id, surface: true });
        return;
      }
      void runAction('selectSite', { site: a.id, fly: false });
      void runAction('showPanel', { panel: 'site-details', open: true });
    },
    shown: () => store.get().site?.id ?? null,
  });
  /** Shared by every surface material: exaggeration, Sun direction, overlay, coverage. */
  private readonly uniforms = createSurfaceUniforms(OVERLAY_RAMP, SUN_BAND_COLOUR, COVERAGE_STYLE.map((c) => c.colour));
  private relief: ReliefGlobe | null = null;
  /** Outlines of the elevation windows around the landing sites (shown with the coverage display). */
  private coverage: CoverageOutlines | null = null;
  /** Outlines of the mapped ice-bearing shadowed regions, loaded the first time they are asked for. */
  private ice: IceOutlines | null = null;
  /** The optional country flags. (The country territories are drawn by the surface shader: territories.ts.) */
  private flags: FlagMarkers | null = null;
  private iceRequested = false;
  /** Poleward of about 80S the surface is drawn from the polar elevation layers, with real Sun shadows. */
  private readonly polar = new PolarCloseUp(this.uniforms);
  /** The multi-year average maps, as textures for the avg-* overlays. */
  private readonly averages: AverageMaps;
  /** Unit vector to the Sun, Moon-fixed axes (x: 0N 0E, y: 0N 90E, z: north). */
  private sunMoonFixed: [number, number, number] = [1, 0, 0];
  /** What the markers, pin and patches were last placed for: exaggeration, height data version, close-up on or off. */
  private placed = { relief: NaN, version: -1, site: '', polar: false };
  private patchVersion = -1;
  private readonly shootingStar = new ShootingStar();
  private introPresentation: 'hidden' | 'zooming' | 'revealing' | 'flags' | 'done' = 'done';
  private introRevealSeconds = 0;
  private introStation: Group | null = null;
  private introStationLoading = false;
  private introStationDrift = 0;
  private introBeacon: Mesh | null = null;
  private introStationEntrance = 0;
  active = true;

  /** Keep map annotations off the Moon until the visitor enters. */
  setIntroPresentation(enabled: boolean): void {
    this.introPresentation = enabled ? 'hidden' : 'done';
    this.introRevealSeconds = 0;
    this.markers?.setRevealProgress(enabled ? 0 : Infinity);
    this.flags?.setRevealProgress(enabled ? 0 : Infinity);
    if (enabled) {
      this.camera.position.setLength(INTRO_DISTANCE);
      this.loadIntroStation();
    }
    if (this.introStation) this.introStation.visible = enabled;
    this.applyMissions();
    this.applyOverlay();
  }

  /** Reveal landing symbols in sequence, then restore the supporting map layers. */
  revealIntroMarkers(): void {
    if (this.introPresentation !== 'hidden') return;
    this.introPresentation = 'zooming';
    this.introRevealSeconds = 0;
    this.applyMissions();
  }

  private loadIntroStation(): void {
    if (this.introStation || this.introStationLoading) return;
    this.introStationLoading = true;
    const draco = new DRACOLoader();
    draco.setDecoderPath('/models/iss/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load('/models/iss/iss.glb', (gltf) => {
      draco.dispose();
      const content = gltf.scene;
      const panelCanvas = document.createElement('canvas');
      panelCanvas.width = 512;
      panelCanvas.height = 512;
      const ctx = panelCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#101d31';
        ctx.fillRect(0, 0, 512, 512);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 10; x++) {
          ctx.fillStyle = (x + y) % 3 === 0 ? '#26466c' : '#1b3455';
          ctx.fillRect(x * 51 + 2, y * 64 + 2, 47, 60);
          ctx.strokeStyle = 'rgba(160, 191, 221, 0.25)';
          ctx.strokeRect(x * 51 + 2, y * 64 + 2, 47, 60);
        }
      }
      const panelTexture = new CanvasTexture(panelCanvas);
      panelTexture.colorSpace = 'srgb';
      content.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.layers.set(1);
        if (object.name === 'polySurfa2_9') {
          const geometry = object.geometry;
          geometry.computeBoundingBox();
          const bounds = geometry.boundingBox!;
          const position = geometry.getAttribute('position');
          const uv = new Float32Array(position.count * 2);
          for (let i = 0; i < position.count; i++) {
            uv[i * 2] = (position.getZ(i) - bounds.min.z) / Math.max(0.001, bounds.max.z - bounds.min.z);
            uv[i * 2 + 1] = (position.getY(i) - bounds.min.y) / Math.max(0.001, bounds.max.y - bounds.min.y);
          }
          geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
          object.material = new MeshStandardMaterial({ map: panelTexture, side: DoubleSide, metalness: 0.18, roughness: 0.72, emissive: 0x071626, emissiveIntensity: 0.3 });
        } else if (object.material instanceof MeshStandardMaterial) {
          object.material = object.material.clone();
          object.material.color.set('#a9b8c6');
          object.material.metalness = 0.55;
          object.material.roughness = 0.4;
        }
      });
      const bounds = new Box3().setFromObject(content);
      const size = bounds.getSize(new Vector3());
      const centre = bounds.getCenter(new Vector3());
      content.position.sub(centre);
      const station = new Group();
      station.add(content);
      const beacon = new Mesh(new SphereGeometry(0.45, 12, 8), new MeshBasicMaterial({ color: 0xff3333, toneMapped: false }));
      beacon.position.set(0, 0, 0);
      beacon.layers.set(1);
      station.add(beacon);
      this.introBeacon = beacon;
      station.scale.setScalar(1.85 / Math.max(size.x, size.y, size.z, 1));
      station.rotation.set(-0.85, 0.35, -1.05);
      station.position.set(-4.2, -1.45, -4);
      const stationFill = new AmbientLight(0xdceaff, 1.6);
      stationFill.layers.set(1);
      station.add(stationFill);
      const key = new DirectionalLight(0xffffff, 2.2);
      key.layers.set(1);
      key.position.set(-2, 3, 4);
      station.add(key);
      station.visible = this.introPresentation === 'hidden';
      this.camera.add(station);
      this.camera.layers.enable(1);
      this.introStationScene.add(this.camera);
      this.introStation = station;
    }, undefined, (err) => {
      draco.dispose();
      this.introStationLoading = false;
      console.warn('ISS intro model could not load', err);
    });
  }

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
      // Turned by hand: the fields and "Drop pin at centre" follow the camera again.
      globeDisplay.setLive({ viewTarget: null });
    });
    this.scene.add(this.sky.root, createStars(), this.shootingStar.root);

    // A symbol drawn over the terrain, like the landing markers; hidden while behind the Moon (see render).
    const pinMat = new MeshBasicMaterial({ color: '#ffd479', toneMapped: false, side: DoubleSide, transparent: true, depthTest: false });
    const ring = new Mesh(new RingGeometry(1.6, 2.3, 40), pinMat);
    const dot = new Mesh(new RingGeometry(0, 0.7, 24), pinMat);
    this.pin.add(ring, dot);
    this.pin.traverse((o) => (o.renderOrder = 4));
    this.pin.visible = false;
    this.scene.add(this.pin, this.landingSearch.root);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'ly-tooltip globe-tooltip';
    this.tooltip.hidden = true;
    this.tooltip.setAttribute('role', 'presentation');
    document.body.append(this.tooltip);

    onCommand('flyTo', ({ lat, lon, altitudeKm }) => {
      this.flyTo(latLonToVec3(lat, lon), altitudeKm === undefined ? undefined : 1 + altitudeKm / MOON_RADIUS_KM, { lat, lon: wrapLon(lon) });
    });
    this.averages = new AverageMaps(this.uniforms, Math.min(4096, renderer.capabilities.maxTextureSize));
    this.averages.onChange = () => globeDisplay.setLive({ averages: this.averages.state });
    this.bindPointer();
    this.bindKeyboard();
    registerDisplayActions();
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
  /** Keyboard on the focused globe: arrows turn, +/- zoom, Enter drops a pin at the centre (globeKeys.ts). */
  private bindKeyboard(): void {
    this.canvas.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const used = handleGlobeKey(e.key, {
        // Step from where the globe is going, so presses within one drawn frame add up (F-7).
        pose: () => {
          const f = this.fly;
          return f ? { lat: f.asked.lat, lon: f.asked.lon, altitudeKm: (f.dist - 1) * MOON_RADIUS_KM } : store.get().globeCenter;
        },
        go: (to) => void runAction('setGlobeCamera', { lat: to.lat, lon: to.lon, altitudeKm: to.altitudeKm }),
        pin: () => {
          const p = globeDisplay.getLive().viewTarget ?? store.get().globeCenter;
          void runAction('dropPin', { lat: round5(p.lat), lon: round5(p.lon) });
        },
      });
      if (!used) return;
      e.preventDefault();
      // The arrows are the globe's here, not the site card's (Earlier / Later).
      if (e.key !== 'Enter') e.stopPropagation();
    });
  }

  async load(): Promise<void> {
    const material = await createMoonMaterial(this.renderer);
    patchSurfaceMaterial(material, this.uniforms, { hole: true });
    this.relief = new ReliefGlobe(material);
    this.scene.add(this.relief.root, this.polar.root);
    this.polar.onData = () => (this.placed.version = -1);
    // The small whole-Moon grid first (1.5 MB); the full grid follows when the camera comes closer.
    void this.relief.loadOverview();
    void this.loadCoverage();
    this.applyOverlay();
    store.subscribe(['overlay', 'sunElMinDeg', 'sunElMaxDeg'], () => this.applyOverlay());
    globeDisplay.subscribe(() => {
      this.applyOverlay();
    });
    this.markers = new Markers([...getLandings()]);
    this.markers.setRevealProgress(this.introPresentation === 'done' ? Infinity : 0);
    this.scene.add(this.markers.root);
    void this.loadMissionLayers(this.markers);
    void this.loadRovers();
    const s = store.get();
    this.applyFilter();
    this.applySite(s.site);
    this.applyMissions();
    this.sky.setMode(s.lightMode);
    store.subscribe(['site'], (st) => this.applySite(st.site));
    store.subscribe(['showMissions', 'showTerritories', 'showFlags'], () => this.applyMissions());
    store.subscribe(['lightMode'], (st) => this.sky.setMode(st.lightMode));
    missionFilter.subscribe(() => this.applyFilter());
  }

  /** The flags: built once the ownership record is in, then placed with the markers. */
  private async loadMissionLayers(markers: Markers): Promise<void> {
    const owners = await loadOwnership();
    this.flags = new FlagMarkers(markers.items, (id) => owners?.byLanding.get(id));
    this.flags.setRevealProgress(this.introPresentation === 'done' ? Infinity : 0);
    this.scene.add(this.flags.root);
    this.applyMissions();
    this.placed.version = -1; // place them with the markers
  }

  private async loadRovers(): Promise<void> {
    const file = await simulatedRovers();
    if (!file) return;
    this.rovers = new RoverMarkers(file, getLandings());
    this.scene.add(this.rovers.root);
    this.applyFilter();
    this.applyMissions();
    this.placed.version = -1; // place them with the markers
  }

  /** Markers, the country territories and flags show together; flags only when also asked for. */
  private applyMissions(): void {
    const { showMissions, showFlags } = store.get();
    if (this.markers) this.markers.root.visible = showMissions && this.introPresentation !== 'hidden';
    if (this.rovers) this.rovers.root.visible = showMissions && this.introPresentation === 'done';
    this.applyFeatures();
    this.flags?.setEnabled(showMissions && showFlags && (this.introPresentation === 'flags' || this.introPresentation === 'done'));
    setTerritories(this.uniforms, showMissions && this.introPresentation === 'done' ? this.visibleMarkers.map((m) => m.landing) : []);
  }

  setGeometry(g: MoonGeometry): void {
    this.sky.setGeometry(g);
    this.sunMoonFixed = [g.sunDir[0], g.sunDir[1], g.sunDir[2]];
    // Moon-fixed (x: 0E, y: 90E, z: north) to scene axes.
    this.uniforms.uSunDir.value.set(g.sunDir[0], g.sunDir[2], -g.sunDir[1]).normalize();
  }

  private applyOverlay(): void {
    const s = store.get();
    this.applyFeatures();
    if (this.coverage) this.coverage.root.visible = this.introPresentation === 'done' && globeDisplay.get().coverage;
    this.applyIce();
    this.uniforms.uBand.value.set(s.sunElMinDeg, s.sunElMaxDeg);
  }

  /** What the surface shader is compiled with: the overlay, the coverage squares, the territories (shown with the missions). */
  private applyFeatures(): void {
    const s = store.get();
    setSurfaceFeatures(this.introPresentation === 'done' ? OVERLAY_CODE[s.overlay] : 0, this.introPresentation === 'done' && globeDisplay.get().coverage, this.introPresentation === 'done' && s.showMissions && s.showTerritories);
  }

  /** Shows or hides the ice-target outlines; the database is read the first time they are shown. */
  private applyIce(): void {
    const show = this.introPresentation === 'done' && globeDisplay.get().iceTargets;
    if (this.ice) this.ice.root.visible = show;
    if (!show || this.iceRequested) return;
    this.iceRequested = true;
    iceTargetLayer().then(
      (layer) => {
        this.ice = new IceOutlines(layer);
        this.ice.root.visible = this.introPresentation === 'done' && globeDisplay.get().iceTargets;
        this.scene.add(this.ice.root);
        this.placed.version = -1; // place them with the markers
      },
      (err) => {
        this.iceRequested = false;
        console.warn('The ice-target database could not be read', err);
      },
    );
  }

  /** Where each class of elevation data exists, for the coverage outlines (from the terrain module's own list). */
  private async loadCoverage(): Promise<void> {
    try {
      const [regions, layers] = await Promise.all([coverageRegions(), demLayers()]);
      const u = this.uniforms;
      // South-polar squares: half-widths in the projection plane (Moon radii), finest first.
      const polar = layers.filter((l) => l.role === 'polar' && l.pole === 'S' && l.halfWidthM).sort((a, b) => a.resolutionM - b.resolutionM);
      const half = (i: number) => (polar[i] ? polar[i].halfWidthM! / MOON_RADIUS_M : 0);
      u.uPolarHalf.value.set(half(0), half(1), half(2));
      // The windows around the landing sites: outlines of their own, in the legend's colours (480 m, 60 m, 3 m).
      this.coverage = new CoverageOutlines(windowClasses(regions, COVERAGE_STYLE.slice(3).map((c) => c.colour)));
      this.coverage.root.visible = this.introPresentation === 'done' && globeDisplay.get().coverage;
      this.scene.add(this.coverage.root);
      this.placed.version = -1; // place them with the markers
    } catch (err) {
      console.warn('Elevation coverage could not be read', err);
    }
  }

  /** Height of the drawn terrain above the reference sphere, metres (0 until elevation data has loaded). */
  heightM(lat: number, lon: number): number {
    // Under the polar close-up the surface on screen is the polar layer, not the whole-Moon grid.
    const polar = this.polar.covers(lat) ? this.polar.heightM(lat, lon) : null;
    return polar ?? this.relief?.heightM(lat, lon) ?? 0;
  }

  /** Distance of the drawn surface from the Moon's centre at a point, Moon radii, exaggeration included. */
  private surfaceRadius(lat: number, lon: number): number {
    return 1 + (this.uniforms.uRelief.value * this.heightM(lat, lon)) / MOON_RADIUS_M;
  }

  /** Markers in display order (filtered), for picking and stepping. */
  get visibleMarkers(): Marker[] {
    return this.markers?.visible ?? [];
  }

  private applyFilter(): void {
    const f = missionFilter.get();
    this.markers?.setFilter((l) => matchesFilter(f, l));
    this.rovers?.setFilter((l) => matchesFilter(f, l));
    // The Moon is divided among the sites shown: hiding a site hands its ground to its neighbours.
    setTerritories(this.uniforms, this.introPresentation === 'done' ? this.visibleMarkers.map((m) => m.landing) : []);
  }

  private applySite(site: SiteRef | null): void {
    const marker = site?.kind === 'landing' ? (this.markers?.items.find((m) => m.landing.id === site.id) ?? null) : null;
    this.markers?.select(marker);
    if (site?.kind === 'custom') {
      const dir = latLonToVec3(site.lat, site.lon);
      this.pin.quaternion.setFromUnitVectors(Z, dir);
      this.pin.position.copy(dir).multiplyScalar(this.surfaceRadius(site.lat, site.lon) + 0.0002);
    }
    this.placed.site = ''; // place the markers and the pin again
    if (site?.id !== this.patchSiteId) {
      this.sitePatch?.dispose();
      this.sitePatch = null;
      this.patchSiteId = site?.id ?? '';
      if (site && Math.abs(site.lat) <= IMAGERY_MAX_LAT) {
        this.sitePatch = new SitePatch(site.lat, site.lon, this.renderer.capabilities.getMaxAnisotropy(), this.uniforms, (lat, lon) => this.heightM(lat, lon));
        this.patchVersion = this.relief?.dataVersion ?? -1;
        this.scene.add(this.sitePatch.root);
      }
    }
  }

  /** Places the camera above a point at once (deep links straight to the surface). */
  jumpTo(lat: number, lon: number, altitudeKm: number): void {
    this.cancelFly();
    this.stopMomentum();
    this.camera.position.copy(flyDirection(latLonToVec3(lat, lon), this.camera.position)).multiplyScalar(1 + altitudeKm / MOON_RADIUS_KM);
    globeDisplay.setLive({ viewTarget: { lat, lon: wrapLon(lon) } });
  }

  /**
   * Stops the auto-rotation and the turn the orbit controls still owe it: with damping on, a
   * turn is paid out over the following frames, so after the first flight the camera kept
   * turning and ended east of the point asked for (lunyx-experience Q-3: 0.013 deg on a 1 deg hop).
   */
  private stopMomentum(): void {
    const c = this.controls;
    c.autoRotate = false;
    // One undamped update pays out the rest of the turn at once (a small fraction of a degree,
    // before the flight starts) and leaves nothing for later frames.
    c.enableDamping = false;
    c.update();
    c.enableDamping = true;
  }

  /** Resolves when the current flight (if any) has arrived or was interrupted. */
  arrived(): Promise<void> {
    if (!this.fly) return Promise.resolve();
    return new Promise((r) => this.fly!.done.push(r));
  }

  private cancelFly(): void {
    const f = this.fly;
    this.fly = null;
    if (f) globeDisplay.setLive({ flying: false });
    f?.done.forEach((d) => d());
  }

  private flyTo(dir: Vector3, dist?: number, asked?: { lat: number; lon: number }): void {
    this.stopMomentum();
    // Exactly over the point asked for; only right over a pole it stops 0.1 degree short (flyTarget.ts).
    const d = flyDirection(dir, this.camera.position);
    const waiting = this.fly?.done ?? [];
    const target = asked ?? vec3ToLatLon(dir);
    this.fly = { dir: d, dist: dist ?? this.camera.position.length(), done: waiting, asked: target };
    globeDisplay.setLive({ viewTarget: target, flying: true });
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
    if (this.introStation?.visible) {
      this.introStationDrift += dt;
      if (this.introBeacon) this.introBeacon.visible = this.introStationDrift % 2.8 < 0.22;
      this.introStation.rotation.y = 0.35 + Math.sin(this.introStationDrift * 0.4) * 0.07;
      if (this.introPresentation === 'hidden' && document.getElementById('loading')?.classList.contains('done')) {
        this.introStationEntrance = Math.min(1, this.introStationEntrance + dt / 2.4);
        const t = 1 - (1 - this.introStationEntrance) ** 3;
        this.introStation.position.set(-4.2 + 2.85 * t, -1.45 + 0.8 * t + Math.sin(this.introStationDrift * 0.7) * 0.015 * t, -4);
      }
    }
    if (this.introPresentation === 'zooming') {
      this.introRevealSeconds += dt;
      const t = Math.min(1, this.introRevealSeconds / 1.15);
      const eased = 1 - (1 - t) ** 3;
      cam.position.setLength(INTRO_DISTANCE + (GLOBE_DISTANCE - INTRO_DISTANCE) * eased);
      if (this.introStation) {
        const entry = 1 - (1 - this.introStationEntrance) ** 3;
        this.introStation.position.set(-4.2 + 2.85 * entry - 2.5 * eased, -1.45 + 0.8 * entry - eased, -4);
      }
      if (t === 1) {
        if (this.introStation) this.introStation.visible = false;
        this.introPresentation = 'revealing';
        this.introRevealSeconds = 0;
        this.applyMissions();
      }
    } else if (this.introPresentation === 'revealing') {
      this.introRevealSeconds += dt;
      this.markers?.setRevealProgress(this.introRevealSeconds / 0.075);
      if (this.introRevealSeconds > (this.markers?.count ?? 28) * 0.075 + 0.25) {
        this.introPresentation = 'flags';
        this.introRevealSeconds = 0;
        this.markers?.setRevealProgress(Infinity);
        this.applyMissions();
      }
    } else if (this.introPresentation === 'flags') {
      this.introRevealSeconds += dt;
      this.flags?.setRevealProgress(this.introRevealSeconds / 0.065);
      if (this.introRevealSeconds > (this.flags?.count ?? 28) * 0.065 + 0.2) {
        this.introPresentation = 'done';
        this.flags?.setRevealProgress(Infinity);
        this.applyMissions();
        this.applyOverlay();
      }
    }
    this.stepFly(dt);
    // Scale rotate and zoom speeds with altitude, so control stays fine near the surface.
    const alt = Math.max(cam.position.length() - 1, 1e-4);
    this.controls.rotateSpeed = Math.min(1, Math.max(0.004, alt / 2.2));
    this.controls.zoomSpeed = Math.log((1 + 1.08 * alt) / (1 + alt)) / 0.0513;
    // Stay clear of the terrain under the screen centre (true scale near the ground, so this is real height).
    const under = vec3ToLatLon(cam.position);
    this.controls.minDistance = Math.max(MIN_DISTANCE, this.surfaceRadius(under.lat, under.lon) + MIN_CLEARANCE);
    this.controls.update();
    const altNow = Math.max(cam.position.length() - 1, 1e-4);
    cam.near = Math.max(0.0005, Math.min(altNow, Math.max(cam.position.length() - this.surfaceRadius(under.lat, under.lon), 1e-4)) * 0.2);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    cam.matrixWorld.extractBasis(this.right, this.up, this.camDir);
    this.sky.update(cam, this.right, this.up);
    this.shootingStar.update(dt);
    this.updateRelief(altNow * MOON_RADIUS_KM);
    this.uniforms.uTerrFill.value = territoryFill(altNow * MOON_RADIUS_KM);
    this.markers?.update(cam, nowSec);
    if (this.rovers?.root.visible) this.rovers.update(cam, roverNowMs(), this.renderer.domElement.clientHeight);
    this.flags?.update(cam, nowSec, this.sky.litDirection);
    if (this.coverage?.root.visible) this.coverage.update(cam);
    if (this.ice?.root.visible) this.ice.update(cam);
    const pinned = store.get().site;
    this.pin.visible = this.introPresentation === 'done' && pinned?.kind === 'custom' && this.pin.position.dot(cam.position) > this.pin.position.lengthSq();
    if (this.pin.visible) this.pin.scale.setScalar(cam.position.distanceTo(this.pin.position) * 0.006);
    this.sitePatch?.update(altNow);
    this.landingSearch.update(cam, this.canvas, (lat, lon) => this.surfaceRadius(lat, lon));
    this.renderer.render(this.scene, cam);
    if (this.introStation?.visible) {
      const autoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.introStationScene, cam);
      this.renderer.autoClear = autoClear;
    }
    this.publishCenter(altNow);
  }

  /** Relief for this frame: the exaggeration at this altitude, the tiles to draw, and everything that sits on the surface. */
  private updateRelief(altitudeKm: number): void {
    const relief = this.relief;
    if (!relief) return;
    const hasData = relief.pyramid.maxPpd > 0;
    const drawn = hasData ? effectiveRelief(globeDisplay.get().reliefFactor) : 0;
    this.uniforms.uRelief.value = drawn;
    relief.update(this.camera, this.renderer.domElement.height / this.renderer.getPixelRatio(), drawn);
    const site = store.get().site;
    const centre = vec3ToLatLon(this.camera.position);
    const realLight = store.get().lightMode === 'real';
    // The fine average map is fetched once the camera is low over a polar region.
    this.averages.update(store.get().overlay, altitudeKm < 1500 && Math.abs(centre.lat) > 70 ? (centre.lat < 0 ? 'S' : 'N') : null);
    const polar = this.polar.update({ altitudeKm, centre, site, sunDir: this.sunMoonFixed, realLight, nowMs: performance.now() });
    globeDisplay.setLive({
      reliefNow: drawn,
      reliefPpd: relief.pyramid.maxPpd,
      reliefProblem: relief.problem,
      polar: polar && {
        ...polar,
        note: `South-polar close-up: shaded relief from LOLA elevation (${polar.resolutionM} m grid), ${polar.shadows ? 'with the shadows the terrain casts at the simulated time' : 'evenly lit, without shadows'}. Not a photograph.`,
      },
      closeUp: this.sitePatch ? { state: this.sitePatch.state, credits: this.sitePatch.credits } : null,
    });

    // Markers, the pin and site imagery follow the surface when the exaggeration or the data changes.
    const key = { relief: drawn, version: relief.dataVersion, site: site?.id ?? '', polar: this.polar.covers(-90) };
    if (Math.abs(key.relief - this.placed.relief) > 1e-4 || key.version !== this.placed.version || key.site !== this.placed.site || key.polar !== this.placed.polar) {
      this.placed = key;
      this.markers?.place((m) => this.surfaceRadius(m.landing.lat, m.landing.lon));
      this.rovers?.place((l) => this.surfaceRadius(l.lat, l.lon));
      this.coverage?.place((lat, lon) => this.surfaceRadius(lat, lon));
      this.ice?.place((lat, lon) => this.surfaceRadius(lat, lon));
      if (site?.kind === 'custom') this.pin.position.copy(latLonToVec3(site.lat, site.lon)).multiplyScalar(this.surfaceRadius(site.lat, site.lon) + 0.0002);
    }
    if (this.sitePatch && this.patchVersion !== relief.dataVersion) {
      this.patchVersion = relief.dataVersion;
      this.sitePatch.refreshHeights((lat, lon) => this.heightM(lat, lon));
    }
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
      const hint = document.createElement('div');
      hint.className = 'ly-note';
      hint.textContent = 'Click for mission details · Double-click for surface view';
      this.tooltip.append(hint);
      this.tooltip.style.left = `${e.clientX}px`;
      this.tooltip.style.top = `${e.clientY}px`;
      this.tooltip.hidden = false;
    });
    canvas.addEventListener('pointerleave', () => (this.tooltip.hidden = true));
    canvas.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    canvas.addEventListener('pointerup', (e) => {
      if (!this.active || e.button !== 0) return;
      const moved = this.downAt ? Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) : Infinity;
      this.downAt = null;
      if (moved > 5) {
        this.markerClicks.reset();
        return; // a drag, not a click
      }
      this.tooltip.hidden = true;
      const hits = this.pickAt(e, this.camera);
      if (!hits.length) {
        this.markerClicks.reset();
        // Empty ground: drop a pin there.
        const at = this.latLonAt(e.clientX, e.clientY);
        if (at) void runAction('dropPin', { lat: round5(at.lat), lon: round5(at.lon) });
        return;
      }
      // A click shows a landing's details without moving the camera, so a second click hits the
      // same marker; a double-click opens the surface view of the landing shown; slower clicks on
      // overlapping markers (Apollo 12 / Surveyor 3) take turns.
      this.markerClicks.click(hits.map((m) => m.landing.id), e.clientX, e.clientY, e.timeStamp);
    });
  }

  /** The surface point under a screen position (client pixels), or null off the Moon. */
  latLonAt(clientX: number, clientY: number): { lat: number; lon: number } | null {
    const r = this.canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const dir = new Vector3(ndc.x, ndc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
    const ray = new Ray(this.camera.position.clone(), dir);
    const hit = new Vector3();
    if (!ray.intersectSphere(MOON, hit)) {
      // Past the smooth limb the ray can still meet raised terrain: try the tallest sphere the relief reaches.
      const tall = new Sphere(MOON.center, 1 + this.uniforms.uRelief.value * 0.0062);
      if (!ray.intersectSphere(tall, hit)) return null;
    }
    // The drawn surface is not the unit sphere: step to the sphere through the terrain height found, a few times.
    const shell = new Sphere(MOON.center, 1);
    for (let i = 0; i < 4; i++) {
      const at = vec3ToLatLon(hit);
      shell.radius = this.surfaceRadius(at.lat, at.lon);
      if (!ray.intersectSphere(shell, hit)) break;
    }
    return vec3ToLatLon(hit);
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
