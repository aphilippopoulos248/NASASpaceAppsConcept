// SIMULATED rovers in the surface view: vehicles driving the circuits of
// public/data/rovers.json (src/data/rovers.ts). Nothing here is data; every rover is labelled
// "simulated" on screen, and the whole group is part of the generated detail.
//
// The vehicle drawn is "NASA Opportunity Rover" by clgreene86 (Sketchfab, CC BY 4.0;
// public/models/opportunity-rover, prepared by scripts/build-rover-model.mjs): an artist's
// model of a Mars rover, used as a stand-in shape for every invented rover here, scaled to
// the rover's size. Until it has loaded, or if it cannot be, a plain box on wheels is drawn.
import { Box3, BoxGeometry, Color, CylinderGeometry, DoubleSide, Group, Matrix4, Mesh, MeshLambertMaterial, Vector3, type Material, type MeshStandardMaterial, type PerspectiveCamera } from 'three';
import { roverStateAt, type Rover, type RoverTrack } from '../../data/rovers';
import type { Ground } from './ground';
import { Label } from './skyPaths';

const LABEL_COLOR = '#ffcf7a';
/** A rover's name is shown within this distance, metres (further for the crewed vehicle, which roams further). */
const LABEL_REACH_M = { robotic: 400, crewed: 1500 };
/** The rock shadow map covers about this far around the viewer, metres. */
const SHADOW_REACH_M = 90;
/** A rover's shadow is redrawn once it has moved this far, metres. */
const SHADOW_STEP_M = 0.03;

const BODY = new Color(0.5, 0.48, 0.43);
const WHEEL = new Color(0.1, 0.1, 0.11);
const PANEL = new Color(0.05, 0.08, 0.2);
/** Tint of the model's own colours: a little under full, as the ground's are. */
const MODEL = new Color(0.85, 0.85, 0.85);

export const ROVER_MODEL_CREDIT = 'Rover model: "NASA Opportunity Rover" by clgreene86 (Sketchfab), CC BY 4.0, textures reduced';
const MODEL_URL = `${import.meta.env.BASE_URL}models/opportunity-rover/scene.gltf`;

/** The model, facing -Z, standing on y = 0, centred; `lengthUnits` is its length in its own units. */
interface Template {
  root: Group;
  lengthUnits: number;
}

let template: Promise<Template | null> | null = null;
/** Loads the model once; null where it cannot be loaded (no browser, file missing): the box is drawn instead. */
function roverTemplate(): Promise<Template | null> {
  template ??=
    typeof document === 'undefined'
      ? Promise.resolve(null)
      : import('three/examples/jsm/loaders/GLTFLoader.js')
          .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(MODEL_URL))
          .then((gltf) => {
            // The file's own transform makes it Y-up with its front (camera mast, arm) towards -Z.
            gltf.scene.updateMatrixWorld(true);
            const box = new Box3().setFromObject(gltf.scene);
            gltf.scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
            const root = new Group();
            root.add(gltf.scene);
            return { root, lengthUnits: box.max.z - box.min.z };
          })
          .catch((err) => {
            console.warn('Rover model:', err instanceof Error ? err.message : err);
            return null;
          });
  return template;
}

/** A copy of the model `L` metres long, with materials of its own (each rover is shaded separately). The geometry and textures stay shared. */
function modelInstance(t: Template, L: number): { model: Group; materials: Shown['materials'] } {
  const model = t.root.clone(true);
  model.scale.setScalar(L / t.lengthUnits);
  const materials: Shown['materials'] = [];
  const own = new Map<Material, MeshLambertMaterial>();
  model.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const source = mesh.material as MeshStandardMaterial;
    let material = own.get(source);
    if (!material) {
      // Plain diffuse shading, like the ground: the scene has no surroundings for a metal to reflect.
      material = new MeshLambertMaterial({ map: source.map, color: MODEL.clone(), side: DoubleSide });
      own.set(source, material);
      materials.push({ material, base: MODEL });
    }
    mesh.material = material;
    mesh.castShadow = true;
  });
  return { model, materials };
}

/** Length of the vehicle, metres, from its mass: 12 kg gives 0.8 m, 140 kg 1.9 m, 900 kg 3.5 m. */
export function roverLengthM(rover: Pick<Rover, 'massKg'>): number {
  return Math.min(3.6, Math.max(0.7, 0.36 * Math.cbrt(rover.massKg)));
}

interface Shown {
  track: RoverTrack;
  body: Group;
  label: Label;
  /** Label variant for each halt activity; 0 is "driving". */
  variantOf: Map<string, number>;
  materials: { material: MeshLambertMaterial; base: Color }[];
  lengthM: number;
  /** True while the stand-in box is drawn, whose geometry is this rover's own. */
  ownGeometry: boolean;
  /** Where the rover stood when its shadow was last drawn. */
  shadowAt: { east: number; north: number };
}

/** The stand-in while the model loads: a box on wheels facing -Z (north at heading 0), standing on y = 0. */
function buildBox(rover: Rover, L: number): { model: Group; materials: Shown['materials'] } {
  const materials: Shown['materials'] = [];
  const mat = (base: Color) => {
    const material = new MeshLambertMaterial({ color: base.clone() });
    materials.push({ material, base });
    return material;
  };
  const bodyMat = mat(BODY), wheelMat = mat(WHEEL), panelMat = mat(PANEL);
  const body = new Group();
  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    body.add(mesh);
    return mesh;
  };
  const crewed = rover.kind === 'crewed';
  const W = 0.62 * L, rw = 0.14 * L, deckY = rw + 0.17 * L;
  const wheel = new CylinderGeometry(rw, rw, 0.12 * L, 14);
  wheel.rotateZ(Math.PI / 2);
  for (const z of crewed ? [-0.36 * L, 0.36 * L] : [-0.38 * L, 0, 0.38 * L]) for (const x of [-W / 2, W / 2]) add(new Mesh(wheel, wheelMat), x, rw, z);
  add(new Mesh(new BoxGeometry(0.8 * W, (crewed ? 0.12 : 0.22) * L, 0.9 * L), bodyMat), 0, deckY, 0);
  const top = deckY + (crewed ? 0.06 : 0.11) * L;
  if (crewed) {
    // Two seats, a console in front of them and a dish on a mast behind.
    for (const x of [-0.2 * W, 0.2 * W]) {
      add(new Mesh(new BoxGeometry(0.26 * W, 0.04 * L, 0.16 * L), bodyMat), x, top + 0.06 * L, 0.05 * L);
      add(new Mesh(new BoxGeometry(0.26 * W, 0.2 * L, 0.03 * L), bodyMat), x, top + 0.14 * L, 0.14 * L);
    }
    add(new Mesh(new BoxGeometry(0.5 * W, 0.1 * L, 0.05 * L), panelMat), 0, top + 0.09 * L, -0.2 * L);
    add(new Mesh(new CylinderGeometry(0.012 * L, 0.012 * L, 0.5 * L, 6), bodyMat), 0, top + 0.25 * L, 0.38 * L);
    const dish = add(new Mesh(new CylinderGeometry(0.14 * L, 0.03 * L, 0.05 * L, 16), bodyMat), 0, top + 0.52 * L, 0.38 * L);
    dish.rotation.x = -0.5;
  } else {
    // A solar panel over the deck and a camera mast at the front.
    add(new Mesh(new BoxGeometry(1.05 * W, 0.015 * L, 0.6 * L), panelMat), 0, top + 0.02 * L, 0.1 * L);
    add(new Mesh(new CylinderGeometry(0.02 * L, 0.02 * L, 0.5 * L, 6), bodyMat), 0, top + 0.25 * L, -0.36 * L);
    add(new Mesh(new BoxGeometry(0.2 * L, 0.07 * L, 0.07 * L), bodyMat), 0, top + 0.52 * L, -0.36 * L);
  }
  return { model: body, materials };
}

export class SurfaceRovers {
  readonly group = new Group();
  private shown: Shown[] = [];
  /** Counts setTracks calls, so a model that finishes loading late is not given to rovers no longer on show. */
  private generation = 0;
  private readonly at = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly basis = new Matrix4();

  /** @param meshLayers render layers the vehicles are drawn in. @param labelLayer the layer of their names. */
  constructor(private readonly meshLayers: number[], private readonly labelLayer: number) {}

  /** The rovers on show, for display next to the picture. */
  get names(): string[] {
    return this.shown.map((s) => s.track.rover.name);
  }

  /** Replaces the rovers on show. Tracks are laid out around the current site. */
  setTracks(tracks: RoverTrack[]): void {
    for (const s of this.shown) {
      s.label.dispose();
      this.discard(s);
    }
    this.group.clear();
    const generation = ++this.generation;
    this.shown = tracks.map((track) => {
      const rover = track.rover;
      const lengthM = roverLengthM(rover);
      const { model, materials } = buildBox(rover, lengthM);
      const body = new Group();
      body.add(model);
      this.inLayers(body);
      const activities = [...new Set(rover.path.map((p) => p.activity).filter((v): v is string => !!v))];
      const title = `${rover.name} · simulated rover`;
      const label = new Label([title, ...activities.map((v) => `${title} · ${v.toLowerCase()}`)], LABEL_COLOR, -0.9);
      label.sprite.layers.enable(this.labelLayer);
      this.group.add(body, label.sprite);
      return { track, body, label, variantOf: new Map(activities.map((v, i) => [v, i + 1])), materials, lengthM, ownGeometry: true, shadowAt: { east: NaN, north: NaN } };
    });
    if (!this.shown.length) return;
    void roverTemplate().then((t) => {
      if (!t || generation !== this.generation) return;
      for (const s of this.shown) {
        this.discard(s);
        s.body.clear();
        const { model, materials } = modelInstance(t, s.lengthM);
        s.body.add(model);
        this.inLayers(s.body);
        s.materials = materials;
        s.ownGeometry = false;
        s.shadowAt.east = NaN; // its shadow has a new shape
      }
      this.usingModel = true;
    });
  }

  /** True once the rovers on show are drawn with the Opportunity model (which must then be credited). */
  usingModel = false;

  private inLayers(body: Group): void {
    body.traverse((o) => {
      for (const layer of this.meshLayers) o.layers.enable(layer);
    });
  }

  /** Frees what a rover's drawing owns: its materials, and the stand-in's geometry (the model's is shared). */
  private discard(s: Shown): void {
    for (const m of s.materials) m.material.dispose();
    if (s.ownGeometry) s.body.traverse((o) => (o as Mesh).geometry?.dispose());
  }

  /**
   * Puts every rover where it is at `timeMs`, standing on the ground as drawn and tilted with it.
   * `sunlit` is the sunlit fraction (0..1) at a point, from the terrain shadows.
   * Returns true when a rover near the viewer has moved far enough for its shadow to be redrawn.
   */
  update(timeMs: number, ground: Ground, camera: PerspectiveCamera, viewportHeightPx: number, sunlit: (east: number, north: number) => number): boolean {
    let shadowStale = false;
    for (const s of this.shown) {
      const state = roverStateAt(s.track, timeMs);
      const h = (state.headingDeg * Math.PI) / 180;
      const fe = Math.sin(h), fn = Math.cos(h), half = s.lengthM * 0.4, side = s.lengthM * 0.3;
      const spot = (east: number, north: number, out: Vector3) => ground.point(east, north, ground.heightAt(east, north), out);
      spot(state.eastM, state.northM, this.at);
      // Tilt with the ground under the wheels: front minus back, right minus left.
      this.forward.copy(spot(state.eastM + fe * half, state.northM + fn * half, this.a)).sub(spot(state.eastM - fe * half, state.northM - fn * half, this.b)).normalize();
      this.right.copy(spot(state.eastM + fn * side, state.northM - fe * side, this.a)).sub(spot(state.eastM - fn * side, state.northM + fe * side, this.b)).normalize();
      this.up.crossVectors(this.right, this.forward).normalize();
      this.right.crossVectors(this.forward, this.up);
      s.body.quaternion.setFromRotationMatrix(this.basis.makeBasis(this.right, this.up, this.forward.negate()));
      s.body.position.copy(this.at);

      const lit = 0.04 + 0.96 * sunlit(state.eastM, state.northM);
      for (const m of s.materials) m.material.color.copy(m.base).multiplyScalar(lit);

      const d = this.at.distanceTo(camera.position);
      s.label.sprite.visible = d < LABEL_REACH_M[s.track.rover.kind];
      if (s.label.sprite.visible) {
        this.a.copy(this.at).addScaledVector(this.up, s.lengthM * 0.9 + 0.4);
        s.label.place(camera, this.a, state.activity ? (s.variantOf.get(state.activity) ?? 0) : 0, viewportHeightPx);
      }
      if (d < SHADOW_REACH_M && !(Math.hypot(state.eastM - s.shadowAt.east, state.northM - s.shadowAt.north) < SHADOW_STEP_M)) {
        s.shadowAt.east = state.eastM;
        s.shadowAt.north = state.northM;
        shadowStale = true;
      }
    }
    return shadowStale;
  }
}
