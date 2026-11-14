// Development harness for the surface scene (not part of the production build):
// open /src/scene/surface/dev/harness.html in `npm run dev`. It mounts SurfaceView alone,
// with the same renderer settings as the app, so the scene can be inspected, timed and
// screenshotted without the rest of the shell.
//
// Query: site=<landing id> | pin=<lat>,<lon>   t=<UTC ISO>   az= el= fov=   east= north= lift=
//        window=<hours>   gen=0 (generated detail off)   low=1 (weak-device mode)   even=1
//        sync (wait for the GPU each frame, so the frame time shown is the real cost)
import { PCFSoftShadowMap, WebGLRenderer } from 'three';
import { pinId } from '../../../core/types';
import { loadLandings } from '../../../data/landings';
import { SurfaceView } from '../../surface';
import type { SiteLike } from '../groundSource';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => (params.has(key) && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : fallback);
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLElement;
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
const sync = params.has('sync');
const gl = renderer.getContext();
const pixel = new Uint8Array(4);

const view = new SurfaceView(renderer.capabilities.getMaxAnisotropy(), { lowPower: params.get('low') === '1' });
const resize = () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  view.resize(window.innerWidth / window.innerHeight);
};
window.addEventListener('resize', resize);
resize();

async function boot() {
  let site: SiteLike;
  let t = params.get('t') ? Date.parse(params.get('t')!) : NaN;
  if (params.has('pin')) {
    const [lat, lon] = params.get('pin')!.split(',').map(Number);
    site = { id: pinId(lat, lon), name: `Pin ${lat}, ${lon}`, lat, lon, kind: 'custom' };
  } else {
    const landings = await loadLandings();
    const landing = landings.find((l) => l.id === (params.get('site') ?? 'apollo-11'));
    if (!landing) throw new Error('unknown site');
    site = { id: landing.id, name: landing.name, lat: landing.lat, lon: landing.lon, kind: 'landing' };
    if (!Number.isFinite(t)) t = Date.parse(`${landing.date}T${landing.time}:00Z`);
  }
  if (!Number.isFinite(t)) t = Date.UTC(2026, 10, 14);
  info.textContent = `Loading ${site.name}…`;
  if (params.get('gen') === '0') view.setGenerated(false);
  view.setMode(params.get('even') === '1' ? 'even' : 'real');
  const started = performance.now();
  await view.load(site);
  const loadMs = performance.now() - started;
  view.setTime(t);
  view.setPathWindow(t, num('window', 24));
  const sky = view.skyNow!;
  // Face the Sun unless told otherwise.
  view.setLook(num('az', sky.sun.azDeg), num('el', Math.max(0, Math.min(25, sky.sun.elDeg))), num('fov', 70));
  if (params.has('east') || params.has('north') || params.has('lift')) view.setPosition(num('east', 0), num('north', 0), num('lift', 0));

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => keys.add(e.code));
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons & 1) view.look(-e.movementX, -e.movementY);
  });
  canvas.addEventListener('wheel', (e) => view.zoom(e.deltaY));

  let frames = 0, acc = 0, last = performance.now();
  const stats = { frameMs: 0, frames: 0, loadMs };
  Object.assign(window, { view, renderer, stats });
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    acc += now - last;
    last = now;
    const key = (code: string) => (keys.has(code) ? 1 : 0);
    view.step(dt, { forward: key('KeyW') - key('KeyS'), strafe: key('KeyD') - key('KeyA'), rise: key('KeyE') - key('KeyQ'), fast: keys.has('ShiftLeft') });
    view.render(renderer);
    // ?sync waits for the GPU (or the software rasteriser) to finish, so the time shown is the real frame cost.
    if (sync) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    frames++;
    stats.frames++;
    if (frames >= 3) {
      stats.frameMs = acc / frames;
      const s = view.skyNow!, look = view.lookDirection;
      info.textContent =
        `${site.name} · ${new Date(t).toISOString()} · ${stats.frameMs.toFixed(0)} ms/frame · load ${loadMs.toFixed(0)} ms\n` +
        `Sun az ${s.sun.azDeg.toFixed(2)} el ${s.sun.elDeg.toFixed(2)} (${(s.sunAboveTerrain * 100).toFixed(0)}% above drawn terrain) · Earth az ${s.earth.azDeg.toFixed(2)} el ${s.earth.elDeg.toFixed(2)}, ${(s.earth.litFraction * 100).toFixed(0)}% lit · ${s.topocentric ? 'topocentric' : 'Moon-centre directions (interim)'}\n` +
        `look az ${look.azDeg.toFixed(1)} el ${look.elDeg.toFixed(1)} fov ${look.fovDeg.toFixed(1)}\n` +
        `Ground: ${view.ground?.summary}\n${view.ground?.generated}`;
      frames = 0;
      acc = 0;
    }
  });
}
boot().catch((e) => {
  console.error(e);
  info.textContent = String(e);
});
