import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
} from 'three';
import { latLonToVec3 } from '../data/landings';
import { applyLunarShading } from './sky';

// NASA Moon Trek WMTS (equirectangular, 2 x 1 tiles at level 0, 256 px tiles).
const TREK = 'https://trek.nasa.gov/tiles/Moon/EQ';

export interface ImageryLayer {
  id: string;
  ext: 'jpg' | 'png';
  zoom: number;
  /** Tile rows to load (north-south extent). Columns are derived from latitude. */
  rows: number;
  radius: number;
  /** Brightness multiplier, to sit closer to the global colour map. */
  gain: number;
  credit: string;
}

/** Wide context first, sharp detail on top. */
export const CONTEXT_LAYER: ImageryLayer = {
  id: 'LRO_WAC_Mosaic_Global_303ppd_v02', ext: 'jpg', zoom: 8, rows: 4, radius: 1.00005, gain: 1.15, credit: 'LROC WAC (NASA/GSFC/ASU)',
};
export const DETAIL_LAYER: ImageryLayer = {
  id: 'Kaguya_TCortho_Mosaic_Global_4096ppd', ext: 'png', zoom: 10, rows: 8, radius: 1.0001, gain: 1.8, credit: 'Kaguya TC (JAXA/SELENE)',
};
const LAYERS = [CONTEXT_LAYER, DETAIL_LAYER];

export const SITE_IMAGERY_CREDIT = `${LAYERS.map((l) => l.credit).join(' · ')}, via NASA Moon Trek`;

const MAX_COLS = 40;
const TILE = 256;

/** A block of map tiles around a point, stitched into one texture. */
export interface TileMosaic {
  texture: CanvasTexture;
  /** Geographic bounds of the texture, degrees. lonW/lonE continue past ±180 rather than wrapping. */
  latN: number;
  latS: number;
  lonW: number;
  lonE: number;
  /** Resolves once every tile has loaded or failed; false if nothing loaded. */
  ready: Promise<boolean>;
  dispose(): void;
}

export function createTileMosaic(lat: number, lon: number, layer: ImageryLayer, anisotropy: number): TileMosaic {
  const tilesY = 2 ** layer.zoom;
  const tilesX = tilesY * 2;
  const deg = 180 / tilesY;

  // Near the poles tiles get narrow east-west, so take more columns to keep the block roughly square.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  const rows = layer.rows;
  const cols = Math.min(MAX_COLS, Math.ceil(rows / cosLat));
  const row0 = Math.min(tilesY - rows, Math.max(0, Math.round((90 - lat) / deg - rows / 2)));
  const col0 = Math.round((lon + 180) / deg - cols / 2); // may run past the ±180° seam; wrapped per tile

  const latN = 90 - row0 * deg;
  const lonW = -180 + col0 * deg;

  // Squash tiles horizontally at high latitude so the canvas stays a sane size.
  const tileW = Math.max(24, Math.round(TILE * Math.min(1, (rows / cols) * 1.5)));
  const canvas = document.createElement('canvas');
  canvas.width = cols * tileW;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;

  let disposed = false;
  const ready = new Promise<boolean>((resolve) => {
    let pending = rows * cols;
    let drawn = 0;
    // Publish the texture only once every tile has settled, so it never shows half-filled.
    const settle = () => {
      if (--pending > 0) return;
      if (!disposed) texture.needsUpdate = true;
      resolve(!disposed && drawn > 0);
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const col = (((col0 + c) % tilesX) + tilesX) % tilesX;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (!disposed) ctx.drawImage(img, c * tileW, r * TILE, tileW, TILE);
          drawn++;
          settle();
        };
        // Missing tiles (no coverage) simply stay transparent.
        img.onerror = settle;
        img.src = `${TREK}/${layer.id}/1.0.0/default/default028mm/${layer.zoom}/${row0 + r}/${col}.${layer.ext}`;
      }
    }
  });

  return {
    texture,
    latN,
    latS: latN - rows * deg,
    lonW,
    lonE: lonW + cols * deg,
    ready,
    dispose() {
      disposed = true;
      texture.dispose();
    },
  };
}

let featherTexture: Texture | null = null;

/** Soft-edged alpha mask so a patch blends into the global map. */
function feather(): Texture {
  if (featherTexture) return featherTexture;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const edge = size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(x, y, size - 1 - x, size - 1 - y);
      const t = Math.min(1, d / edge);
      const a = t * t * (3 - 2 * t) * 255;
      const o = (y * size + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = a;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  featherTexture = new CanvasTexture(c);
  return featherTexture;
}

function buildLayer(lat: number, lon: number, layer: ImageryLayer, anisotropy: number): { mesh: Mesh; mosaic: TileMosaic } {
  const mosaic = createTileMosaic(lat, lon, layer, anisotropy);
  const { latN, latS, lonW, lonE } = mosaic;

  const material = new MeshStandardMaterial({
    map: mosaic.texture,
    alphaMap: feather(),
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  material.color.setScalar(layer.gain);
  applyLunarShading(material);
  mosaic.ready.then((ok) => (material.userData.loaded = ok));

  // Curved grid following the sphere; UVs are linear in lat/lon, matching the tile grid.
  const seg = 32;
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const v = j / seg;
      const p = latLonToVec3(latS + (latN - latS) * v, lonW + (lonE - lonW) * u);
      pos.push(p.x * layer.radius, p.y * layer.radius, p.z * layer.radius);
      nrm.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1;
      const c = a + seg + 1;
      const d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);

  return { mesh: new Mesh(geo, material), mosaic };
}

/** High-resolution imagery draped over the globe around one landing site. */
export class SitePatch {
  readonly root = new Group();
  private readonly mosaics: TileMosaic[] = [];

  constructor(lat: number, lon: number, anisotropy: number) {
    LAYERS.forEach((layer, i) => {
      const { mesh, mosaic } = buildLayer(lat, lon, layer, anisotropy);
      mesh.renderOrder = 1 + i;
      this.root.add(mesh);
      this.mosaics.push(mosaic);
    });
  }

  /** Fade the patch in as the camera descends; it is invisible from globe distance. */
  update(cameraAltitude: number): void {
    // Fully visible below ~140 km altitude, gone by ~520 km.
    const t = Math.min(1, Math.max(0, (0.3 - cameraAltitude) / 0.22));
    const opacity = t * t * (3 - 2 * t);
    for (const child of this.root.children) {
      const m = (child as Mesh).material as MeshStandardMaterial;
      // Ease in over roughly half a second once the tiles are ready.
      const reveal = m.userData.loaded ? Math.min(1, (m.userData.reveal ?? 0) + 0.04) : 0;
      m.userData.reveal = reveal;
      m.opacity = opacity * reveal;
      child.visible = m.opacity > 0.001;
    }
  }

  dispose(): void {
    for (const m of this.mosaics) m.dispose();
    for (const child of this.root.children) {
      const mesh = child as Mesh;
      (mesh.material as MeshStandardMaterial).dispose();
      mesh.geometry.dispose();
    }
    this.root.removeFromParent();
  }
}
