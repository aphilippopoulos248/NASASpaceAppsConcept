import {
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  formatCoords,
  formatDate,
  Landing,
  landingDate,
  loadLandings,
  programColor,
  quickmapUrl,
  trekUrl,
} from './data/landings';
import { createMoon, createStars } from './scene/globe';
import { Marker, Markers } from './scene/markers';
import { SITE_IMAGERY_CREDIT, SitePatch } from './scene/sitePatch';
import { LightMode, Sky } from './scene/sky';
import { elevation, moonGeometry, MoonGeometry, phaseName } from './astro/ephemeris';
import { SurfaceView } from './scene/surface';
import { Filters } from './ui/filters';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Camera distances from the Moon's centre, in Moon radii. */
const GLOBE_DISTANCE = 3.4;
const SITE_DISTANCE = 1.024; // about 42 km above the surface
const MIN_DISTANCE = 1.006;

const canvas = $<HTMLCanvasElement>('scene');
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true; // used by the surface view
renderer.shadowMap.type = PCFSoftShadowMap;

const scene = new Scene();
const camera = new PerspectiveCamera(40, 1, 0.01, 1200);
// +X is the sub-Earth point, so this is the familiar near-side view with north up.
camera.position.set(GLOBE_DISTANCE, 0.5, 0).setLength(GLOBE_DISTANCE);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = MIN_DISTANCE;
controls.maxDistance = 9;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

const sky = new Sky();
scene.add(sky.root);
scene.add(createStars());

// ---------- simulated time + lighting ----------
const MIN_TIME = Date.UTC(1950, 0, 1);
const MAX_TIME = Date.UTC(2100, 0, 1);
let simTime = Date.now();
let playing = false;
let geometry: MoonGeometry = moonGeometry(new Date(simTime));
let lightMode: LightMode = 'real';

const dateInput = $<HTMLInputElement>('light-date');
const playButton = $<HTMLButtonElement>('light-play');
const speedSelect = $<HTMLSelectElement>('light-speed');
dateInput.min = new Date(MIN_TIME).toISOString().slice(0, 16);
dateInput.max = new Date(MAX_TIME).toISOString().slice(0, 16);

function setTime(ms: number, fromInput = false) {
  simTime = Math.min(MAX_TIME, Math.max(MIN_TIME, ms));
  geometry = moonGeometry(new Date(simTime));
  sky.setGeometry(geometry);
  if (inSurface) surface.setSky(geometry);
  if (!fromInput && document.activeElement !== dateInput) {
    dateInput.value = new Date(simTime).toISOString().slice(0, 16);
  }
  const lit = Math.round(geometry.litFraction * 100);
  $('light-readout').textContent = `${phaseName(geometry)} · ${lit}% lit from Earth`;
  updateSiteSky();
}

function setPlaying(on: boolean) {
  playing = on;
  playButton.textContent = on ? 'Pause' : 'Play';
  playButton.setAttribute('aria-pressed', String(on));
}

function setLightMode(mode: LightMode) {
  lightMode = mode;
  sky.setMode(mode);
  surface.setMode(mode);
  if (inSurface) surface.setSky(geometry);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#light-mode button')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
  $('lighting').classList.toggle('even', mode === 'even');
  if (mode === 'even') setPlaying(false);
}

for (const b of document.querySelectorAll<HTMLButtonElement>('#light-mode button')) {
  b.addEventListener('click', () => setLightMode(b.dataset.mode as LightMode));
}
dateInput.addEventListener('input', () => {
  const ms = Date.parse(`${dateInput.value}:00Z`);
  if (Number.isFinite(ms)) {
    setPlaying(false);
    setTime(ms, true);
  }
});
$('light-now').addEventListener('click', () => {
  setPlaying(false);
  setTime(Date.now());
});
playButton.addEventListener('click', () => setPlaying(!playing));

/** Sun and Earth as seen from the selected site at the simulated time. */
function updateSiteSky() {
  const l = markers?.selection?.landing;
  if (!l) return;
  const describe = (deg: number, below: string) =>
    deg >= 0 ? `${deg.toFixed(1)}° above horizon` : `${below} (${Math.abs(deg).toFixed(1)}° below horizon)`;
  $('card-sun').textContent = describe(elevation(l.lat, l.lon, geometry.sunDir), 'Night');
  $('card-earth').textContent = describe(elevation(l.lat, l.lon, geometry.earthDir), 'Not visible');
}

let markers: Markers | null = null;
let sitePatch: SitePatch | null = null;

// ---------- surface (ground-level) view ----------
const surface = new SurfaceView(renderer.capabilities.getMaxAnisotropy());
let inSurface = false;
/** Set when a site was just chosen: enter the surface view as soon as the fly-in lands. */
let surfaceWanted = false;
let surfaceReady: Promise<boolean> = Promise.resolve(false);
const fade = $('fade');
const keysDown = new Set<string>();

function fadeThrough(change: () => void) {
  fade.classList.add('on');
  window.setTimeout(() => {
    change();
    fade.classList.remove('on');
  }, 320);
}

async function enterSurface() {
  surfaceWanted = false;
  const marker = markers?.selection;
  if (!marker || inSurface) return;
  const ok = await surfaceReady;
  if (!ok || markers?.selection !== marker || inSurface) return;
  fadeThrough(() => {
    inSurface = true;
    controls.enabled = false;
    keysDown.clear();
    surface.setMode(lightMode);
    surface.setSky(geometry);
    $('surface-note').textContent =
      surface.detail === 'measured'
        ? 'Built from orbital data, not a ground photograph: LROC high-resolution elevation and photo within about 770 m of the landing point, with finer relief worked out from shading in the photo; the 60 m model beyond. Rocks and texture finer than about a metre are generated, not real. The lander is not modelled in 3D.'
        : 'No high-resolution survey exists for this site. Hills and large craters are real (60 m model); the small craters, bumps and rocks within about 770 m are generated, not real.';
    document.body.classList.add('surface');
    $('card-surface').textContent = 'Orbit view';
    tooltip.hidden = true;
    canvas.style.cursor = 'grab';
  });
}

function exitSurface(instant = false) {
  surfaceWanted = false;
  if (!inSurface) return;
  const leave = () => {
    inSurface = false;
    controls.enabled = true;
    document.body.classList.remove('surface');
    $('card-surface').textContent = 'Surface view';
  };
  if (instant) leave();
  else fadeThrough(leave);
}

// ---------- camera fly-to ----------
let fly: { dir: Vector3; dist: number } | null = null;
const camDir = new Vector3();
const axis = new Vector3();

controls.addEventListener('start', () => {
  controls.autoRotate = false;
  fly = null;
});

function flyTo(dir: Vector3 | null, dist: number) {
  const d = (dir ?? camera.position).clone().normalize();
  // Keep the poles from ending up dead-centre, where orbiting gets twitchy.
  d.y = Math.max(-0.985, Math.min(0.985, d.y));
  fly = { dir: d.normalize(), dist };
  controls.autoRotate = false;
}

function stepFly(dt: number) {
  if (!fly) return;
  const alt = camera.position.length() - 1;
  const targetAlt = fly.dist - 1;
  camDir.copy(camera.position).normalize();
  const angle = camDir.angleTo(fly.dir);
  const logGap = Math.log(targetAlt / alt);
  if (angle < 0.001 && Math.abs(logGap) < 0.02) {
    fly = null;
    if (surfaceWanted) void enterSurface();
    return;
  }
  // Ease out: cover a fixed fraction of what remains each frame. Altitude is
  // eased on a log scale so the descent feels even all the way down.
  const t = Math.min(1, 1 - Math.exp(-dt * 3.2));
  axis.crossVectors(camDir, fly.dir);
  if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
  camDir.applyAxisAngle(axis.normalize(), angle * t);
  camera.position.copy(camDir).multiplyScalar(1 + alt * Math.exp(logGap * t));
}

// ---------- info card ----------
const card = $('card');

function showCard(l: Landing) {
  $('card-swatch').style.background = programColor(l.program);
  $('card-program').textContent = l.program;
  $('card-name').textContent = l.name;
  $('card-date').textContent = formatDate(l.date);
  $('card-country').textContent = l.country;
  $('card-type').textContent = l.crewed ? 'Crewed' : 'Robotic';
  $('card-region').textContent = l.region;
  $('card-coords').textContent = formatCoords(l.lat, l.lon) + (l.approx ? ' (approx.)' : '');
  $('card-summary').textContent = l.summary;
  $<HTMLAnchorElement>('card-quickmap').href = quickmapUrl(l);
  $<HTMLAnchorElement>('card-trek').href = trekUrl(l);
  updateSiteSky();
  $('card-credit').textContent = `Close-up imagery: ${SITE_IMAGERY_CREDIT}.`;
  updateCardNav();
  card.hidden = false;
}

function updateCardNav() {
  const visible = markers?.visible ?? [];
  const i = markers?.selection ? visible.indexOf(markers.selection) : -1;
  $('card-index').textContent = i >= 0 ? `${i + 1} of ${visible.length}` : '';
  $<HTMLButtonElement>('card-prev').disabled = i <= 0;
  $<HTMLButtonElement>('card-next').disabled = i < 0 || i >= visible.length - 1;
}

function step(offset: number) {
  const visible = markers?.visible ?? [];
  const i = markers?.selection ? visible.indexOf(markers.selection) : -1;
  const next = visible[i + offset];
  if (next) select(next);
}

function select(marker: Marker | null) {
  if (!markers) return;
  const changed = marker !== markers.selection;
  exitSurface(true);
  markers.select(marker);
  if (!marker) {
    card.hidden = true;
    flyTo(null, GLOBE_DISTANCE);
    return;
  }
  showCard(marker.landing);
  // Prepare the ground-level view while the camera flies down, then step into it on arrival.
  surfaceReady = surface.load(marker.landing).then(
    () => true,
    (err) => {
      console.warn('Surface view unavailable for this site', err);
      return false;
    },
  );
  surfaceWanted = true;
  if (changed) {
    sitePatch?.dispose();
    sitePatch = new SitePatch(marker.landing.lat, marker.landing.lon, renderer.capabilities.getMaxAnisotropy());
    scene.add(sitePatch.root);
  }
  flyTo(marker.dir, SITE_DISTANCE);
}

$('card-close').addEventListener('click', () => select(null));
$('card-globe').addEventListener('click', () => {
  exitSurface();
  flyTo(null, GLOBE_DISTANCE);
});
$('card-surface').addEventListener('click', () => {
  if (inSurface) exitSurface();
  else void enterSurface();
});
$('surface-exit').addEventListener('click', () => exitSurface());
const generatedToggle = $<HTMLButtonElement>('surface-generated');
generatedToggle.addEventListener('click', () => {
  surface.setGenerated(!surface.generated);
  generatedToggle.textContent = `Generated detail: ${surface.generated ? 'on' : 'off'}`;
  generatedToggle.setAttribute('aria-pressed', String(surface.generated));
});
$('card-prev').addEventListener('click', () => step(-1));
$('card-next').addEventListener('click', () => step(1));
$('card-landing-light').addEventListener('click', () => {
  const l = markers?.selection?.landing;
  if (!l) return;
  setPlaying(false);
  setLightMode('real');
  setTime(landingDate(l).getTime());
});

// ---------- hover + click ----------
const tooltip = $('tooltip');
let downAt: { x: number; y: number } | null = null;

function pickAt(e: PointerEvent): Marker[] {
  if (!markers) return [];
  const r = canvas.getBoundingClientRect();
  return markers.pick(e.clientX - r.left, e.clientY - r.top, camera, r.width, r.height);
}

canvas.addEventListener('pointermove', (e) => {
  if (inSurface) {
    // Hold the left mouse button (or drag a finger) to look around.
    if (e.buttons & 1) surface.look(-e.movementX, -e.movementY);
    return;
  }
  if (e.pointerType === 'touch' || e.buttons !== 0) {
    tooltip.hidden = true;
    return;
  }
  const hits = pickAt(e);
  canvas.style.cursor = hits.length ? 'pointer' : 'grab';
  if (!hits.length) {
    tooltip.hidden = true;
    return;
  }
  tooltip.replaceChildren(
    ...hits.map((m) => {
      const row = document.createElement('div');
      row.className = 'tip-row';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = programColor(m.landing.program);
      const date = document.createElement('span');
      date.className = 'tip-date';
      date.textContent = m.landing.date.slice(0, 4);
      row.append(sw, m.landing.name, date);
      return row;
    }),
  );
  tooltip.style.left = `${e.clientX}px`;
  tooltip.style.top = `${e.clientY}px`;
  tooltip.hidden = false;
});
canvas.addEventListener('pointerleave', () => (tooltip.hidden = true));

canvas.addEventListener('pointerdown', (e) => {
  downAt = { x: e.clientX, y: e.clientY };
  if (inSurface && e.button === 0) {
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});
canvas.addEventListener('wheel', (e) => {
  if (!inSurface) return;
  e.preventDefault();
  surface.zoom(e.deltaY);
}, { passive: false });
canvas.addEventListener('pointerup', (e) => {
  const moved = downAt ? Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) : Infinity;
  downAt = null;
  if (inSurface) {
    canvas.style.cursor = 'grab';
    return;
  }
  if (moved > 5) return; // it was a drag, not a click
  tooltip.hidden = true;
  const hits = pickAt(e);
  if (!hits.length) return; // clicking empty ground keeps the current selection
  // Clicking again on overlapping sites (e.g. Apollo 12 / Surveyor 3) cycles through them.
  const current = markers?.selection ? hits.indexOf(markers.selection) : -1;
  select(hits[(current + 1) % hits.length]);
});

const WALK_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight']);
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (inSurface && WALK_KEYS.has(e.code)) {
    keysDown.add(e.code);
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape' && inSurface) exitSurface();
  else if (e.key === 'Escape' && markers?.selection) select(null);
  else if (e.key === 'ArrowRight' && markers?.selection) step(1);
  else if (e.key === 'ArrowLeft' && markers?.selection) step(-1);
});

// ---------- filters ----------
const filtersPanel = $('filters');
const filtersToggle = $('filters-toggle');
filtersToggle.addEventListener('click', () => {
  const open = $('side').classList.toggle('open');
  filtersToggle.setAttribute('aria-expanded', String(open));
});

function applyFilter(matches: (l: Landing) => boolean) {
  if (!markers) return;
  markers.setFilter(matches);
  const n = markers.visible.length;
  $('subtitle').textContent = `${n} of ${markers.items.length} soft landings shown`;
  // A site that no longer passes the filters is deselected.
  if (markers.selection && !matches(markers.selection.landing)) select(null);
  else if (markers.selection) updateCardNav();
}

// ---------- surface HUD ----------
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let hudText = '';
function updateSurfaceHud() {
  const h = Math.round(surface.heading) % 360;
  const d = surface.distanceFromSite;
  const dist = d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`;
  const eye = 1.7 + surface.lift;
  const height = eye < 10 ? `${eye.toFixed(1)} m` : `${Math.round(eye)} m`;
  const text = `Facing ${COMPASS[Math.round(h / 45) % 8]} (${h}°) · ${dist} from the landing point · eye height ${height}`;
  if (text !== hudText) $('surface-status').textContent = hudText = text;
}

// ---------- render loop ----------
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Keep the whole globe in view on narrow (portrait) screens.
  camera.fov = w < h ? 40 * Math.min(1.6, h / w) : 40;
  camera.updateProjectionMatrix();
  surface.resize(w / h);
}
window.addEventListener('resize', resize);
resize();

const right = new Vector3();
const up = new Vector3();
let last = performance.now();

renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (playing) {
    setTime(simTime + dt * Number(speedSelect.value) * 1000);
    if (simTime >= MAX_TIME) setPlaying(false);
  }
  if (inSurface) {
    const key = (code: string) => (keysDown.has(code) ? 1 : 0);
    surface.step(dt, {
      forward: key('KeyW') - key('KeyS'),
      strafe: key('KeyD') - key('KeyA'),
      rise: Math.min(1, key('KeyE') + key('Space')) - key('KeyQ'),
      fast: keysDown.has('ShiftLeft') || keysDown.has('ShiftRight'),
    });
    updateSurfaceHud();
    renderer.render(surface.scene, surface.camera);
    return;
  }
  stepFly(dt);

  // Scale rotate and zoom speeds with altitude, so control stays fine near the surface.
  const alt = Math.max(camera.position.length() - 1, 1e-4);
  controls.rotateSpeed = Math.min(1, Math.max(0.004, alt / 2.2));
  controls.zoomSpeed = Math.log((1 + 1.08 * alt) / (1 + alt)) / 0.0513;
  controls.update();

  const altNow = Math.max(camera.position.length() - 1, 1e-4);
  camera.near = Math.max(0.0005, altNow * 0.2);
  camera.updateProjectionMatrix();

  camera.matrixWorld.extractBasis(right, up, camDir);
  sky.update(camera, right, up);

  markers?.update(camera, now / 1000);
  sitePatch?.update(altNow);
  renderer.render(scene, camera);
});

// ---------- boot ----------
async function boot() {
  const [moon, landings] = await Promise.all([createMoon(renderer), loadLandings()]);
  landings.sort((a, b) => a.date.localeCompare(b.date));
  scene.add(moon);
  markers = new Markers(landings);
  scene.add(markers.root);
  new Filters(landings, filtersPanel, $('timeline'), applyFilter);
  setLightMode(lightMode);
  setTime(simTime);

  // Deep links: ?site=apollo-11 opens a site, &view=surface drops straight to the ground,
  // &light=landing sets the Sun to where it was at touchdown.
  const params = new URLSearchParams(location.search);
  const linked = markers.items.find((m) => m.landing.id === params.get('site'));
  if (linked) {
    select(linked);
    if (params.get('light') === 'landing') setTime(landingDate(linked.landing).getTime());
    if (params.get('view') === 'surface') {
      camera.position.copy(linked.dir).multiplyScalar(SITE_DISTANCE);
      fly = null;
      void enterSurface();
    }
  }
  $('loading').classList.add('done');
}

boot().catch((err) => {
  console.error(err);
  $('loading').textContent = 'Could not load the Moon. Run "npm run fetch-textures" and reload.';
});
