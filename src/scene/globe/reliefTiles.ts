// The globe's surface as a quadtree of latitude/longitude tiles: which tiles to draw for a
// camera, and the vertex arrays of one tile. Pure maths (no three.js), so it is unit-tested.
//
// Level 0 is 8 x 4 tiles of 45 degrees; each level halves the tile size. Every tile is a
// grid of SEGMENTS x SEGMENTS cells whose vertices lie on the unit sphere and carry their
// height as an attribute; the vertex shader moves them outwards by height x exaggeration.
// A skirt around each tile hides the gaps between neighbours of different levels.
//
// Scene axes as everywhere in the app: +Y north pole, +X at 0N 0E, east is -Z.
import { MOON_RADIUS_M } from '../../core/types';

export const SEGMENTS = 32;
const ROOT_DEG = 45;
const DEG = Math.PI / 180;
/** Greatest height above the reference sphere, in Moon radii (10.8 km), for horizon and bounding margins. */
export const MAX_HEIGHT_R = 10_800 / MOON_RADIUS_M;

export interface TileId {
  level: number;
  /** Column, 0 at 180W, eastwards. */
  x: number;
  /** Row, 0 at the north pole, southwards. */
  y: number;
}

export interface TileBounds {
  latN: number;
  latS: number;
  lonW: number;
  lonE: number;
}

export const tileKey = (t: TileId): string => `${t.level}/${t.x}/${t.y}`;
export const tileSizeDeg = (level: number): number => ROOT_DEG / 2 ** level;

export function tileBounds(t: TileId): TileBounds {
  const s = tileSizeDeg(t.level);
  return { latN: 90 - t.y * s, latS: 90 - (t.y + 1) * s, lonW: -180 + t.x * s, lonE: -180 + (t.x + 1) * s };
}

export function rootTiles(): TileId[] {
  const out: TileId[] = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) out.push({ level: 0, x, y });
  return out;
}

export function childTiles(t: TileId): TileId[] {
  const l = t.level + 1, x = t.x * 2, y = t.y * 2;
  return [{ level: l, x, y }, { level: l, x: x + 1, y }, { level: l, x, y: y + 1 }, { level: l, x: x + 1, y: y + 1 }];
}

/** Samples per degree a tile needs from the height data: one sample per cell. */
export const tilePpd = (level: number): number => SEGMENTS / tileSizeDeg(level);

/** The deepest level worth drawing with height data of a given resolution: the first whose cells are as fine as the data. */
export function maxLevelFor(ppd: number): number {
  if (!(ppd > 0)) return 2;
  return Math.max(0, Math.ceil(Math.log2((ppd * ROOT_DEG) / SEGMENTS)));
}

export function dirOf(lat: number, lon: number, out: number[] | Float32Array = [0, 0, 0], o = 0): number[] | Float32Array {
  const c = Math.cos(lat * DEG);
  out[o] = c * Math.cos(lon * DEG);
  out[o + 1] = Math.sin(lat * DEG);
  out[o + 2] = -c * Math.sin(lon * DEG);
  return out;
}

export interface TileArrays {
  /** Unit-sphere positions (also the normals). */
  position: Float32Array;
  uv: Float32Array;
  /** Height above the reference sphere in Moon radii. */
  height: Float32Array;
  /** How far the vertex is pulled towards the centre, Moon radii: 0 on the surface, the skirt depth on the skirt's lower edge. */
  skirt: Float32Array;
  index: Uint16Array;
}

/**
 * Vertex arrays of one tile. `sample(lat, lon)` gives the height in metres. Texture
 * coordinates are linear in longitude and latitude, matching the equirectangular colour and
 * normal maps (u = 0 at 180W, v = 0 at the south pole).
 */
export function buildTileArrays(t: TileId, sample: (lat: number, lon: number) => number): TileArrays {
  const S = SEGMENTS, n = S + 1;
  const b = tileBounds(t);
  const surface = n * n, total = surface + 4 * n;
  const position = new Float32Array(total * 3), uv = new Float32Array(total * 2), height = new Float32Array(total), skirt = new Float32Array(total);
  // Deep enough to close any gap between neighbouring levels, even with relief exaggerated 30 times.
  const depth = Math.min(0.05, tileSizeDeg(t.level) * DEG * 0.03);
  for (let r = 0; r < n; r++) {
    const lat = b.latN + ((b.latS - b.latN) * r) / S;
    for (let c = 0; c < n; c++) {
      const lon = b.lonW + ((b.lonE - b.lonW) * c) / S;
      const i = r * n + c;
      dirOf(lat, lon, position, i * 3);
      uv[i * 2] = (lon + 180) / 360;
      uv[i * 2 + 1] = (lat + 90) / 180;
      height[i] = sample(lat, lon) / MOON_RADIUS_M;
    }
  }
  // Skirt: a copy of each border vertex, pulled inwards. Order: north row, south row, west column, east column.
  const border: number[] = [];
  for (let c = 0; c < n; c++) border.push(c);
  for (let c = 0; c < n; c++) border.push(S * n + c);
  for (let r = 0; r < n; r++) border.push(r * n);
  for (let r = 0; r < n; r++) border.push(r * n + S);
  border.forEach((src, k) => {
    const i = surface + k;
    position.set(position.subarray(src * 3, src * 3 + 3), i * 3);
    uv.set(uv.subarray(src * 2, src * 2 + 2), i * 2);
    height[i] = height[src];
    skirt[i] = depth;
  });

  const index = new Uint16Array(S * S * 6 + 4 * S * 12);
  let o = 0;
  for (let r = 0; r < S; r++) {
    for (let c = 0; c < S; c++) {
      const a = r * n + c, bb = a + 1, cc = a + n, d = cc + 1;
      // Counter-clockwise seen from outside (north up, east to the right).
      index[o++] = a; index[o++] = cc; index[o++] = bb;
      index[o++] = bb; index[o++] = cc; index[o++] = d;
    }
  }
  // Skirt walls, both windings so they show from either side.
  for (let side = 0; side < 4; side++) {
    for (let k = 0; k < S; k++) {
      const top0 = border[side * n + k], top1 = border[side * n + k + 1];
      const low0 = surface + side * n + k, low1 = low0 + 1;
      index[o++] = top0; index[o++] = low0; index[o++] = top1;
      index[o++] = top1; index[o++] = low0; index[o++] = low1;
      index[o++] = top0; index[o++] = top1; index[o++] = low0;
      index[o++] = top1; index[o++] = low1; index[o++] = low0;
    }
  }
  return { position, uv, height, skirt, index };
}

// ---------------------------------------------------------------- choosing tiles

export interface LodView {
  /** Camera position in Moon radii, scene axes. */
  cam: readonly [number, number, number];
  /** Screen pixels per radian of viewing angle (viewport height / vertical field of view). */
  pxPerRad: number;
  /** A tile is split while one of its cells is larger than this on screen, pixels. */
  cellPx: number;
  maxLevel: number;
  /** Largest outward displacement being drawn, Moon radii (height x exaggeration): terrain this tall can show beyond the smooth horizon. */
  maxDisplacement: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Angle between two unit vectors given their dot product, radians. */
const angle = (dot: number) => Math.acos(clamp(dot, -1, 1));

/** Centre direction and angular radius (to the farthest corner) of a tile. */
export function tileCap(t: TileId): { centre: number[]; radius: number } {
  const b = tileBounds(t);
  const centre = dirOf((b.latN + b.latS) / 2, (b.lonW + b.lonE) / 2) as number[];
  let radius = 0;
  for (const lat of [b.latN, b.latS]) {
    for (const lon of [b.lonW, b.lonE]) {
      const d = dirOf(lat, lon) as number[];
      radius = Math.max(radius, angle(d[0] * centre[0] + d[1] * centre[1] + d[2] * centre[2]));
    }
  }
  return { centre, radius };
}

/** False when the whole tile lies behind the Moon's limb as seen from the camera (with room for tall terrain). */
export function tileFacesCamera(t: TileId, view: LodView): boolean {
  const [x, y, z] = view.cam;
  const dist = Math.hypot(x, y, z);
  if (dist <= 1) return true;
  const { centre, radius } = tileCap(t);
  const toTile = angle((centre[0] * x + centre[1] * y + centre[2] * z) / dist);
  // A point at height h is in view up to acos(1/dist) + acos(1/(1+h)) from the sub-camera point.
  const limb = Math.acos(1 / dist) + Math.acos(1 / (1 + Math.max(0, view.maxDisplacement)));
  return toTile - radius <= limb;
}

/** Distance from the camera to the nearest point of a tile on the unit sphere, Moon radii. */
export function distanceToTile(t: TileId, cam: readonly [number, number, number]): number {
  const b = tileBounds(t);
  const dist = Math.hypot(cam[0], cam[1], cam[2]);
  const lat = Math.asin(clamp(cam[1] / dist, -1, 1)) / DEG;
  const lon = Math.atan2(-cam[2], cam[0]) / DEG;
  // The tile's nearest point: the camera's own latitude and longitude, pulled into the tile.
  const mid = (b.lonW + b.lonE) / 2;
  let dLon = lon - mid;
  dLon -= 360 * Math.round(dLon / 360);
  const p = dirOf(clamp(lat, b.latS, b.latN), mid + clamp(dLon, -(b.lonE - b.lonW) / 2, (b.lonE - b.lonW) / 2)) as number[];
  return Math.hypot(p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]);
}

/** True when the tile's cells are still too large on screen and a finer level exists. */
export function tileWantsSplit(t: TileId, view: LodView): boolean {
  if (t.level >= view.maxLevel) return false;
  const cellRad = (tileSizeDeg(t.level) * DEG) / SEGMENTS;
  const px = (cellRad / Math.max(distanceToTile(t, view.cam), 1e-6)) * view.pxPerRad;
  return px > view.cellPx;
}

/**
 * The tiles to draw: a set that covers everything facing the camera exactly once.
 * `available(tile)` says whether a tile can be drawn now (built, or built on the spot);
 * where a wanted tile is not available its parent is drawn instead, so there is never a hole.
 * Root tiles must always be available.
 */
export function selectTiles(view: LodView, available: (t: TileId) => boolean, visible: (t: TileId) => boolean = () => true): TileId[] {
  const cover = (t: TileId): TileId[] | null => {
    if (!tileFacesCamera(t, view) || !visible(t)) return [];
    if (tileWantsSplit(t, view)) {
      const parts = childTiles(t).map(cover);
      if (parts.every((p): p is TileId[] => p !== null)) return parts.flat();
    }
    return available(t) ? [t] : null;
  };
  return rootTiles().flatMap((t) => cover(t) ?? []);
}

// ---------------------------------------------------------------- relief scale

/**
 * The relief scale actually drawn: 0 (smooth sphere) to 1 (true scale). Heights are never
 * stretched beyond their true size, whatever is asked for.
 */
export function effectiveRelief(factor: number): number {
  return clamp(factor, 0, 1);
}
