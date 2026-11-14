import { Camera, CanvasTexture, Group, SRGBColorSpace, Sprite, SpriteMaterial, Vector3 } from 'three';
import { flagCode, Ownership } from '../data/ownership';
import type { Marker } from './markers';

// Simplified national flags, drawn rather than loaded so there are no image assets to license.
// Keyed by GCAT state code, plus RU (Russia, shown for hardware launched by the USSR). Proportions are 3:2 for all, for a tidy row on the globe.

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rotation = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rotation + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const PAINTERS: Record<string, Painter> = {
  US(ctx, w, h) {
    for (let i = 0; i < 13; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#b22234' : '#ffffff';
      ctx.fillRect(0, (i * h) / 13, w, h / 13 + 0.5);
    }
    const cw = w * 0.4, ch = (h * 7) / 13;
    ctx.fillStyle = '#3c3b6e';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ffffff';
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 6; col++) {
        const x = (cw * (col + 0.5 + (row % 2) * 0.25)) / 6.25;
        const y = (ch * (row + 0.5)) / 5;
        star(ctx, x, y, ch * 0.075);
      }
    }
  },
  SU(ctx, w, h) {
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ctx.fillStyle = '#ffd700';
    // Star outline
    ctx.lineWidth = h * 0.025;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 === 0 ? h * 0.07 : h * 0.03;
      ctx.lineTo(w * 0.17 + Math.cos(a) * rr, h * 0.13 + Math.sin(a) * rr);
    }
    ctx.stroke();
    // Sickle: a thick arc
    ctx.lineWidth = h * 0.05;
    ctx.beginPath();
    ctx.arc(w * 0.17, h * 0.36, h * 0.12, Math.PI * 0.2, Math.PI * 1.35);
    ctx.stroke();
    // Hammer: handle and head
    ctx.save();
    ctx.translate(w * 0.17, h * 0.36);
    ctx.rotate(-Math.PI / 4);
    ctx.fillRect(-h * 0.02, -h * 0.13, h * 0.04, h * 0.26);
    ctx.fillRect(-h * 0.07, -h * 0.15, h * 0.14, h * 0.05);
    ctx.restore();
  },
  RU(ctx, w, h) {
    const colours = ['#ffffff', '#0039a6', '#d52b1e'];
    colours.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(0, (i * h) / 3, w, h / 3 + 0.5);
    });
  },
  CN(ctx, w, h) {
    ctx.fillStyle = '#de2910';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffde00';
    star(ctx, w * 0.17, h * 0.27, h * 0.16);
    const small: [number, number][] = [[0.33, 0.1], [0.4, 0.2], [0.4, 0.35], [0.33, 0.45]];
    for (const [x, y] of small) star(ctx, w * x, h * y, h * 0.055, Math.atan2(0.27 - y, 0.17 - x));
  },
  IN(ctx, w, h) {
    ctx.fillStyle = '#ff9933';
    ctx.fillRect(0, 0, w, h / 3);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, h / 3, w, h / 3);
    ctx.fillStyle = '#138808';
    ctx.fillRect(0, (2 * h) / 3, w, h / 3 + 0.5);
    ctx.strokeStyle = '#000080';
    ctx.lineWidth = Math.max(1, h * 0.02);
    const r = h * 0.14;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = Math.max(0.5, h * 0.008);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i * Math.PI) / 12;
      ctx.moveTo(w / 2, h / 2);
      ctx.lineTo(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r);
    }
    ctx.stroke();
  },
  J(ctx, w, h) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#bc002d';
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2);
    ctx.fill();
  },
};

/** A flag on its own, for the info card. Null for states without a drawing. */
export function flagCanvas(state: string, width = 36): HTMLCanvasElement | null {
  const paint = PAINTERS[state];
  if (!paint) return null;
  const scale = 2; // sharp on high-density screens
  const c = document.createElement('canvas');
  c.width = width * scale;
  c.height = Math.round((width * 2) / 3) * scale;
  const ctx = c.getContext('2d')!;
  paint(ctx, c.width, c.height);
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.lineWidth = scale;
  ctx.strokeRect(0, 0, c.width, c.height);
  c.style.width = `${width}px`;
  c.style.height = `${Math.round((width * 2) / 3)}px`;
  return c;
}

// Sprite image: a flag on a short pole, with the foot of the pole at the bottom-left corner.
const SPRITE = 128;
const POLE_X = 5;
const FLAG = { x: 7, y: 6, w: 84, h: 56 };

const textureCache = new Map<string, CanvasTexture>();
function flagOnPole(state: string): CanvasTexture | null {
  const cached = textureCache.get(state);
  if (cached) return cached;
  const paint = PAINTERS[state];
  if (!paint) return null;
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const ctx = c.getContext('2d')!;
  // Pole, with a dark edge so it reads against bright ground.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(POLE_X - 2, FLAG.y - 4, 5, SPRITE - FLAG.y + 4);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(POLE_X - 1, FLAG.y - 3, 3, SPRITE - FLAG.y + 3);
  ctx.save();
  ctx.translate(FLAG.x, FLAG.y);
  paint(ctx, FLAG.w, FLAG.h);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(FLAG.x, FLAG.y, FLAG.w, FLAG.h);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  textureCache.set(state, t);
  return t;
}

/** Height of a flag on screen, as a fraction of the view height. */
const SCREEN_SIZE = 0.055;

/** A small flag above each landing marker showing which state the hardware belongs to. */
export class FlagMarkers {
  readonly root = new Group();
  private readonly items: { marker: Marker; sprite: Sprite }[] = [];
  private enabled = false;
  private readonly tmp = new Vector3();

  constructor(markers: Marker[], ownerOf: (landingId: string) => Ownership | undefined) {
    for (const marker of markers) {
      const owner = ownerOf(marker.landing.id);
      const texture = owner ? flagOnPole(flagCode(owner)) : null;
      if (!texture) continue;
      const sprite = new Sprite(new SpriteMaterial({ map: texture, sizeAttenuation: false, depthTest: false, depthWrite: false, toneMapped: false }));
      sprite.center.set(POLE_X / SPRITE, 0); // foot of the pole sits on the site
      sprite.scale.setScalar(SCREEN_SIZE);
      sprite.position.copy(marker.dir).multiplyScalar(1.0004);
      sprite.renderOrder = 4;
      sprite.visible = false;
      this.root.add(sprite);
      this.items.push({ marker, sprite });
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) for (const { sprite } of this.items) sprite.visible = false;
  }

  /** Call every frame: shows a flag only for visible markers on the side of the Moon facing the camera. */
  update(camera: Camera): void {
    if (!this.enabled) return;
    for (const { marker, sprite } of this.items) {
      // A point on the unit sphere faces a camera at c when p·c > 1; a small margin hides flags at the very edge.
      sprite.visible = marker.group.visible && marker.dir.dot(this.tmp.copy(camera.position)) > 1.02;
    }
  }
}
