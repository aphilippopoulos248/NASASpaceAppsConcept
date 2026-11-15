import { BufferGeometry, Group, LineBasicMaterial, LineLoop, Vector3, type PerspectiveCamera } from 'three';
import { destination } from '../../analysis/horizon';
import { runAction } from '../../core/actions';
import { landingSearchMap, onLandingSearchMap, type LandingSearchPoint } from '../../core/landingSearch';
import { store } from '../../core/store';
import { latLonToVec3 } from '../../data/landings';
import './landingSearchMarkers.css';

/** Search circle on the terrain, with accessible, clickable rank badges above it. */
export class LandingSearchMarkers {
  readonly root = new Group();
  private readonly layer = document.createElement('div');
  private badges: { point: LandingSearchPoint; button: HTMLButtonElement }[] = [];
  private readonly projected = new Vector3();
  private ring: LineLoop | null = null;
  private readonly outline: { lat: number; lon: number }[] = [];

  constructor() {
    this.layer.className = 'landing-search-markers';
    this.layer.setAttribute('aria-label', 'Landing search results on the globe');
    document.body.append(this.layer);
    store.subscribe(['view'], state => { this.layer.hidden = state.view !== 'globe' || !landingSearchMap(); });
    onLandingSearchMap(() => this.rebuild());
    this.rebuild();
  }

  private rebuild(): void {
    this.layer.replaceChildren();
    this.badges = [];
    if (this.ring) {
      this.root.remove(this.ring);
      this.ring.geometry.dispose();
      (this.ring.material as LineBasicMaterial).dispose();
      this.ring = null;
    }
    this.outline.length = 0;
    const result = landingSearchMap();
    if (!result) return;
    for (let az = 0; az < 360; az += 3) this.outline.push(destination(result.centre, az, result.radiusM));
    this.ring = new LineLoop(new BufferGeometry(), new LineBasicMaterial({ color: '#73dfff', transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, toneMapped: false }));
    this.ring.renderOrder = 5;
    this.ring.frustumCulled = false;
    this.root.add(this.ring);
    for (const point of result.points) {
      const button = document.createElement('button');
      button.className = `landing-search-marker is-${point.evaluation.feasibility}`;
      button.textContent = point.label;
      const { site, feasibility, utility } = point.evaluation;
      button.title = `${feasibility === 'feasible' ? `Rank ${point.label}, utility ${utility?.toFixed(2)}` : feasibility}: ${site.lat.toFixed(5)}°, ${site.lon.toFixed(5)}°`;
      button.setAttribute('aria-label', button.title);
      button.addEventListener('click', () => {
        void runAction('dropPin', { lat: site.lat, lon: site.lon });
        void runAction('showPanel', { panel: 'site-details', open: true });
      });
      this.layer.append(button);
      this.badges.push({ point, button });
    }
  }

  update(camera: PerspectiveCamera, canvas: HTMLCanvasElement, surfaceRadius: (lat: number, lon: number) => number): void {
    const result = landingSearchMap();
    const active = store.get().view === 'globe' && result !== null;
    this.layer.hidden = !active;
    this.root.visible = active;
    if (!active) return;
    if (this.ring) {
      const centre = latLonToVec3(result.centre.lat, result.centre.lon).multiplyScalar(surfaceRadius(result.centre.lat, result.centre.lon));
      this.ring.visible = centre.dot(camera.position) > centre.lengthSq();
      this.ring.geometry.setFromPoints(this.outline.map(p => latLonToVec3(p.lat, p.lon).multiplyScalar(surfaceRadius(p.lat, p.lon) + 0.00001)));
    }
    const rect = canvas.getBoundingClientRect();
    for (const { point, button } of this.badges) {
      const { lat, lon } = point.evaluation.site;
      const world = latLonToVec3(lat, lon).multiplyScalar(surfaceRadius(lat, lon) + 0.00001);
      this.projected.copy(world).project(camera);
      button.hidden = world.dot(camera.position) <= world.lengthSq() || Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1 || Math.abs(this.projected.z) > 1;
      if (!button.hidden) {
        button.style.left = `${rect.left + (this.projected.x + 1) * rect.width / 2}px`;
        button.style.top = `${rect.top + (1 - this.projected.y) * rect.height / 2}px`;
      }
    }
  }
}
