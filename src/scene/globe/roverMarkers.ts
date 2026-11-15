// SIMULATED rovers on the globe (public/data/rovers.json; not data, see docs/DATA_SOURCES.md
// section 12): where each rover is now, and the circuit it drives, so that the ground it
// occupies beside a landing site can be seen and avoided.
//
// A rover works within a few hundred metres of its lander, which is less than a pixel from most
// altitudes. So a site with rovers is drawn in one of two ways:
//   - from far away, a bold amber ring around the landing marker and, beside it, an amber
//     badge with a rover on it and the number of rovers: "rovers here", at every altitude,
//     and named once the camera is within a few hundred kilometres;
//   - once the circuits are wide enough on screen to read, each circuit as a line, and each
//     rover as an amber diamond on it, moving, with its name.
// The camera comes no closer than about 10 km, where a pixel is about 8 m: circuits that stay
// within some 60 m of their lander never open up, and keep the ring. The site card gives every
// rover's distance and bearing from the lander in numbers.
// Symbols, like the landing markers: drawn over the terrain, a constant size on screen, hidden
// while the site is behind the Moon.
import { BufferGeometry, CanvasTexture, CircleGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, Matrix4, Mesh, MeshBasicMaterial, RingGeometry, Sprite, SpriteMaterial, Vector3, type PerspectiveCamera } from 'three';
import { latLonToVec3, type Landing } from '../../data/landings';
import { buildTrack, roverStateAt, trackReachM, type RoverFile, type RoverTrack } from '../../data/rovers';
import { Label } from '../surface/skyPaths';

export const ROVER_COLOR = '#ffcf7a';
const MOON_RADIUS_M = 1_737_400;
const DEG = Math.PI / 180;
/** As the landing markers: symbol size as a fraction of camera distance, and height above the terrain in Moon radii. */
const SCREEN_SCALE = 0.006;
const LIFT = 0.0002;
/** The circuits are drawn once the widest reaches this many marker radii from the lander on screen (the landing dot is one radius). */
const DETAIL_AT = 1;
/** The ring is named within this distance of the camera, Moon radii (about 350 km). */
const NAME_WITHIN = 0.2;
/** Outer radius of the ring, marker radii, and the badge's height on screen, CSS pixels. */
const RING_OUTER = 5.2;
const BADGE_PX = 24;

/**
 * The badge: an amber pill with a small rover drawn on it and, for more than one, how many.
 * Returns its picture and width / height; no picture where there is no canvas to draw on.
 */
function badgeTexture(count: number): { texture: CanvasTexture | null; aspect: number } {
  const aspect = count > 1 ? 2.1 : 1.5;
  if (typeof document === 'undefined') return { texture: null, aspect };
  const k = 4, h = BADGE_PX * k, w = Math.round(h * aspect);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const pad = 2 * k;
  ctx.beginPath();
  ctx.roundRect(pad, pad, w - 2 * pad, h - 2 * pad, (h - 2 * pad) / 2);
  ctx.fillStyle = ROVER_COLOR;
  ctx.fill();
  ctx.lineWidth = 1.5 * k;
  ctx.strokeStyle = '#1a1408';
  ctx.stroke();
  // The rover, side on: deck, mast with a camera head, three wheels.
  const u = h / 24, x0 = 8.5 * u, ink = '#1a1408';
  ctx.fillStyle = ink;
  ctx.fillRect(x0, 11 * u, 13 * u, 3.2 * u);
  ctx.fillRect(x0 + 2.2 * u, 6 * u, 1.4 * u, 5 * u);
  ctx.fillRect(x0 + 0.6 * u, 4.8 * u, 4.6 * u, 2 * u);
  for (const wx of [1.8, 6.5, 11.2]) {
    ctx.beginPath();
    ctx.arc(x0 + wx * u, 16.6 * u, 2.1 * u, 0, Math.PI * 2);
    ctx.fill();
  }
  if (count > 1) {
    ctx.font = `700 ${11 * u}px "Inter Variable", Inter, system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(String(count), x0 + 16.5 * u, 12.6 * u);
  }
  return { texture: new CanvasTexture(c), aspect };
}

interface SiteRovers {
  landing: Landing;
  /** Unit vector from the Moon's centre to the landing. */
  dir: Vector3;
  /** At the landing, axes east / north / up, in Moon radii. */
  frame: Group;
  ring: Mesh;
  /** Circuits and rover symbols, shown close up. */
  detail: Group;
  /** How far the widest circuit reaches from the lander, Moon radii. */
  reach: number;
  rovers: { track: RoverTrack; symbol: Mesh; label: Label }[];
  /** Names the ring: the rover, or how many. */
  ringLabel: Label;
  /** The rover badge beside the ring. */
  badge: Sprite;
  badgeAspect: number;
  shown: boolean;
}

/** True when circuits reaching `reachM` from a lander are wide enough to draw, seen from `distanceM` away. */
export function circuitsReadable(reachM: number, distanceM: number): boolean {
  return reachM > DETAIL_AT * SCREEN_SCALE * distanceM;
}

export class RoverMarkers {
  readonly root = new Group();
  private readonly sites: SiteRovers[] = [];
  private readonly world = new Vector3();

  constructor(file: RoverFile, landings: readonly Landing[]) {
    const flat = { color: ROVER_COLOR, toneMapped: false, side: DoubleSide, transparent: true, depthTest: false };
    const ringGeo = new RingGeometry(RING_OUTER - 0.9, RING_OUTER, 56);
    // A square on its corner: unlike the round landing markers at a glance.
    const diamondGeo = new CircleGeometry(1.25, 4);
    const edgeGeo = new CircleGeometry(1.7, 4);
    for (const landing of landings) {
      const here = file.rovers.filter((r) => r.siteId === landing.id);
      if (!here.length) continue;
      const la = landing.lat * DEG, lo = landing.lon * DEG;
      const dir = latLonToVec3(landing.lat, landing.lon);
      // East and north at the site, in the globe's axes (see latLonToVec3).
      const east = new Vector3(-Math.sin(lo), 0, -Math.cos(lo));
      const north = new Vector3(-Math.sin(la) * Math.cos(lo), Math.cos(la), Math.sin(la) * Math.sin(lo));
      const frame = new Group();
      frame.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(east, north, dir));
      frame.position.copy(dir).multiplyScalar(1 + LIFT);
      const ring = new Mesh(ringGeo, new MeshBasicMaterial({ ...flat, opacity: 0.9 }));
      const detail = new Group();
      frame.add(ring, detail);

      const tracks = here.map((r) => buildTrack(r, landing, file.epochMs));
      const rovers = tracks.map((track) => {
        const route = new BufferGeometry();
        route.setAttribute('position', new Float32BufferAttribute(track.points.flatMap((p) => [p.eastM / MOON_RADIUS_M, p.northM / MOON_RADIUS_M, 0]), 3));
        const line = new LineLoop(route, new LineBasicMaterial({ color: ROVER_COLOR, toneMapped: false, transparent: true, opacity: 0.75, depthTest: false }));
        const symbol = new Mesh(edgeGeo, new MeshBasicMaterial({ ...flat, color: '#1a1408', opacity: 0.9 }));
        symbol.add(new Mesh(diamondGeo, new MeshBasicMaterial(flat)));
        detail.add(line, symbol);
        const label = new Label([`${track.rover.name} · simulated rover`], ROVER_COLOR, -1.1);
        this.root.add(label.sprite);
        return { track, symbol, label };
      });
      frame.traverse((o) => {
        o.renderOrder = 4; // over the landing markers (3)
        o.frustumCulled = false;
      });
      this.root.add(frame);
      const ringLabel = new Label([here.length === 1 ? `${here[0].name} · simulated rover` : `${here.map((r) => r.name).join(', ')} · simulated rovers`], ROVER_COLOR, 3.2);
      this.root.add(ringLabel.sprite);
      const picture = badgeTexture(here.length);
      const badge = new Sprite(new SpriteMaterial({ map: picture.texture, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      badge.renderOrder = 12;
      badge.frustumCulled = false;
      this.root.add(badge);
      this.sites.push({ landing, dir, frame, ring, detail, reach: Math.max(...tracks.map(trackReachM)) / MOON_RADIUS_M, rovers, ringLabel, badge, badgeAspect: picture.aspect, shown: true });
    }
  }

  /** Landings that have rovers beside them. */
  get siteIds(): string[] {
    return this.sites.map((s) => s.landing.id);
  }

  /** Puts every site's rovers on the drawn surface: `radius(landing)` is the terrain's distance from the Moon's centre there, Moon radii. */
  place(radius: (l: Landing) => number): void {
    for (const s of this.sites) s.frame.position.copy(s.dir).multiplyScalar(radius(s.landing) + LIFT);
  }

  /** Rovers are shown with their landing: only where it passes the mission filter. */
  setFilter(matches: (l: Landing) => boolean): void {
    for (const s of this.sites) s.shown = matches(s.landing);
  }

  /** Call every frame: places each rover for the instant `nowMs` and keeps the symbols a constant size on screen. */
  update(camera: PerspectiveCamera, nowMs: number, viewportHeightPx: number): void {
    for (const s of this.sites) {
      const visible = s.shown && s.dir.dot(camera.position) > 1;
      s.frame.visible = visible;
      const distance = camera.position.distanceTo(s.frame.position);
      const size = distance * SCREEN_SCALE;
      const close = visible && s.reach > DETAIL_AT * size;
      s.ring.visible = !close;
      s.detail.visible = close;
      s.ring.scale.setScalar(size);
      // The badge sits at the ring's upper right, a constant size, at every altitude.
      s.badge.visible = visible && !close;
      if (s.badge.visible) {
        const perPx = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, viewportHeightPx);
        const ringPx = (RING_OUTER * SCREEN_SCALE) / perPx, shift = ringPx * 0.72 + BADGE_PX * 0.45;
        s.badge.position.copy(s.frame.position);
        s.badge.scale.set(BADGE_PX * s.badgeAspect * perPx, BADGE_PX * perPx, 1);
        s.badge.center.set(0.5 - shift / (BADGE_PX * s.badgeAspect), 0.5 - shift / BADGE_PX);
      }
      s.ringLabel.sprite.visible = visible && !close && distance < NAME_WITHIN;
      if (s.ringLabel.sprite.visible) s.ringLabel.place(camera, s.frame.position, 0, viewportHeightPx);
      for (const r of s.rovers) {
        r.label.sprite.visible = close;
        if (!close) continue;
        const state = roverStateAt(r.track, nowMs);
        r.symbol.position.set(state.eastM / MOON_RADIUS_M, state.northM / MOON_RADIUS_M, 0);
        r.symbol.scale.setScalar(size * 0.5);
        r.label.place(camera, s.frame.localToWorld(this.world.copy(r.symbol.position)), 0, viewportHeightPx);
      }
    }
  }
}
