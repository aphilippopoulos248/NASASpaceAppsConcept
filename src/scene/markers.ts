import {
  Camera,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { Landing, landingColor, latLonToVec3 } from '../data/landings';

/** Marker size as a fraction of camera distance, so markers stay a constant size on screen. */
const SCREEN_SCALE = 0.006;
const PICK_RADIUS_PX = 14;
/** Height of a marker above the terrain, Moon radii (about 350 m): clear of the surface without visibly floating. */
const LIFT = 0.0002;

export interface Marker {
  landing: Landing;
  /** Unit vector from the Moon's centre to the site. */
  dir: Vector3;
  group: Group;
  /** Passes the mission filter. The group itself is also hidden while the site is behind the Moon. */
  shown: boolean;
}

const Z = new Vector3(0, 0, 1);
const tmp = new Vector3();

export class Markers {
  readonly root = new Group();
  readonly items: Marker[] = [];
  private selected: Marker | null = null;
  private readonly selectionRing: Mesh;
  private revealProgress = Infinity;

  /** Number of landing symbols revealed during the intro handoff. */
  setRevealProgress(progress: number): void {
    this.revealProgress = progress;
  }

  get count(): number { return this.items.length; }

  constructor(landings: Landing[]) {
    const dotGeo = new SphereGeometry(1, 16, 12);
    const ringGeo = new RingGeometry(1.7, 2.1, 40);
    const crewRingGeo = new RingGeometry(2.6, 2.85, 40);

    for (const landing of landings) {
      const color = landingColor(landing);
      const dir = latLonToVec3(landing.lat, landing.lon);
      const group = new Group();
      group.position.copy(dir).multiplyScalar(1 + LIFT);
      group.quaternion.setFromUnitVectors(Z, dir);

      // Markers are symbols, not objects on the ground: they are drawn over the terrain (relief
      // would otherwise bury parts of them) and hidden as a whole when the site is behind the Moon.
      const flat = { color, toneMapped: false, side: DoubleSide, transparent: true, depthTest: false };
      group.add(new Mesh(dotGeo, new MeshBasicMaterial({ ...flat })));
      group.add(new Mesh(ringGeo, new MeshBasicMaterial({ ...flat, opacity: 0.85 })));
      // Crewed landings get a second, outer ring.
      if (landing.crewed) group.add(new Mesh(crewRingGeo, new MeshBasicMaterial({ ...flat, opacity: 0.7 })));

      // Draw after the high-resolution site imagery (render orders 1-2).
      group.traverse((o) => (o.renderOrder = 3));
      this.root.add(group);
      this.items.push({ landing, dir, group, shown: true });
    }

    this.selectionRing = new Mesh(
      new RingGeometry(3.6, 3.95, 48),
      new MeshBasicMaterial({ color: '#ffffff', toneMapped: false, side: DoubleSide, transparent: true, depthTest: false }),
    );
    this.selectionRing.visible = false;
    this.selectionRing.renderOrder = 3;
    this.root.add(this.selectionRing);
  }

  select(marker: Marker | null): void {
    this.selected = marker;
    this.selectionRing.visible = marker !== null && marker.group.visible;
    if (marker) {
      this.selectionRing.position.copy(marker.group.position);
      this.selectionRing.quaternion.copy(marker.group.quaternion);
    }
  }

  /**
   * Puts every marker on the drawn surface: `radius(marker)` is the distance of the terrain
   * from the Moon's centre at that site, in Moon radii, relief exaggeration included.
   */
  place(radius: (m: Marker) => number): void {
    for (const m of this.items) m.group.position.copy(m.dir).multiplyScalar(radius(m) + LIFT);
    if (this.selected) this.selectionRing.position.copy(this.selected.group.position);
  }

  /** Show only the markers whose landing passes the predicate. */
  setFilter(matches: (l: Landing) => boolean): void {
    for (const m of this.items) {
      m.shown = matches(m.landing);
      if (!m.shown) m.group.visible = false;
    }
  }

  /** Markers that pass the filter, in chronological order (whichever side of the Moon they are on). */
  get visible(): Marker[] {
    return this.items.filter((m) => m.shown);
  }

  get selection(): Marker | null {
    return this.selected;
  }

  /** Call every frame: keeps markers a constant on-screen size and pulses the selection ring. */
  update(camera: Camera, timeSec: number): void {
    for (const [i, m] of this.items.entries()) {
      // In front of the limb: the line of sight to the site does not pass through the Moon.
      m.group.visible = m.shown && i < this.revealProgress && m.dir.dot(camera.position) > 1;
      const s = camera.position.distanceTo(m.group.position) * SCREEN_SCALE;
      const entering = Math.min(1, Math.max(0, (this.revealProgress - i) / 0.9));
      const pop = entering >= 1 ? 1 : entering * (1 + 0.18 * Math.sin(Math.PI * entering));
      m.group.scale.setScalar((m === this.selected ? s * 1.25 : s) * pop);
    }
    this.selectionRing.visible = this.selected !== null && this.selected.group.visible;
    if (this.selected) {
      const s = camera.position.distanceTo(this.selectionRing.position) * SCREEN_SCALE;
      const pulse = 1 + 0.12 * Math.sin(timeSec * 3.5);
      this.selectionRing.scale.setScalar(s * pulse);
      (this.selectionRing.material as MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(timeSec * 3.5);
    }
  }

  /**
   * Markers under a pointer position (CSS pixels relative to the canvas),
   * nearest first. Sites on the far side of the Moon are ignored.
   */
  pick(x: number, y: number, camera: Camera, width: number, height: number): Marker[] {
    const hits: { m: Marker; d: number }[] = [];
    for (const m of this.items) {
      if (!m.group.visible) continue; // filtered out, or behind the Moon (see update)
      tmp.copy(m.group.position).project(camera);
      const d = Math.hypot((tmp.x * 0.5 + 0.5) * width - x, (-tmp.y * 0.5 + 0.5) * height - y);
      if (d <= PICK_RADIUS_PX) hits.push({ m, d });
    }
    return hits.sort((a, b) => a.d - b.d).map((h) => h.m);
  }
}
