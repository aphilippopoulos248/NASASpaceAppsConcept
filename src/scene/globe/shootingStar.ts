// Occasional decorative shooting star on the globe starfield. Not a catalogue object.
import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';

const MIN_GAP_S = 25;
const MAX_GAP_S = 45;
const MIN_FLIGHT_S = 0.85;
const MAX_FLIGHT_S = 1.2;
const RADIUS = 480;

export function nextShootingStarDelaySec(random = Math.random): number {
  return MIN_GAP_S + random() * (MAX_GAP_S - MIN_GAP_S);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Thin additive streak that crosses the far starfield every 25–45 s when motion is allowed. */
export class ShootingStar {
  readonly root = new Group();
  private readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly pos = new Vector3();
  private readonly along = new Vector3();
  private wait = nextShootingStarDelaySec();
  private flying = false;
  private t = 0;
  private duration = 1;
  private disposed = false;

  constructor() {
    // Long thin quad: head bright, tail dim (vertex colours). Opacity fades over the flight.
    const geo = new BufferGeometry();
    const hw = 0.45;
    const halfLen = 16;
    const positions = new Float32Array([
      -halfLen, -hw, 0,
      halfLen, -hw, 0,
      halfLen, hw, 0,
      -halfLen, -hw, 0,
      halfLen, hw, 0,
      -halfLen, hw, 0,
    ]);
    const colors = new Float32Array([
      0.2, 0.28, 0.45,
      0.9, 0.94, 1.0,
      0.9, 0.94, 1.0,
      0.2, 0.28, 0.45,
      0.9, 0.94, 1.0,
      0.2, 0.28, 0.45,
    ]);
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      toneMapped: false,
      side: DoubleSide,
      opacity: 0.75,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = -1;
    this.root.add(this.mesh);
    this.root.name = 'shooting-star';
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (prefersReducedMotion()) {
      this.mesh.visible = false;
      this.flying = false;
      return;
    }
    if (this.flying) {
      this.t += dt;
      const u = Math.min(1, this.t / this.duration);
      const e = 1 - (1 - u) * (1 - u);
      this.pos.lerpVectors(this.from, this.to, e);
      this.mesh.position.copy(this.pos);
      this.material.opacity = 0.75 * (1 - u);
      if (u >= 1) {
        this.flying = false;
        this.mesh.visible = false;
        this.wait = nextShootingStarDelaySec();
      }
      return;
    }
    this.wait -= dt;
    if (this.wait > 0) return;
    this.beginFlight();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mesh.visible = false;
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }

  private beginFlight(): void {
    randomOnSphere(this.from, RADIUS);
    randomOnSphere(this.along, 1);
    this.along.cross(this.from).normalize();
    if (this.along.lengthSq() < 1e-8) this.along.set(0, 1, 0);
    const span = 70 + Math.random() * 90;
    this.to.copy(this.from).addScaledVector(this.along, span).setLength(RADIUS);
    this.pos.copy(this.from);
    this.mesh.position.copy(this.from);
    this.mesh.lookAt(this.to);
    this.mesh.rotateY(-Math.PI / 2);
    this.duration = MIN_FLIGHT_S + Math.random() * (MAX_FLIGHT_S - MIN_FLIGHT_S);
    this.t = 0;
    this.material.opacity = 0.75;
    this.flying = true;
    this.mesh.visible = true;
  }
}

function randomOnSphere(out: Vector3, radius: number): Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a) * radius, z * radius, r * Math.sin(a) * radius);
}
