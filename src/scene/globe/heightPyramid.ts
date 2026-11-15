// The whole-Moon elevation grid at several resolutions, for drawing relief on the globe.
//
// A coarse globe tile must not read a fine grid at a few scattered points (that turns
// real relief into noise), so each tile samples the level whose spacing matches its own.
// Coarser levels are 2x2 means of the next finer one. Pure maths over typed arrays.
//
// Layout of every level: equirectangular, row 0 at 90N, column 0 at 180W, pixel centres
// half a pixel inside the bounds (the layout of the bundled LOLA grids, src/terrain).

/** The part of an equirectangular height grid this module needs (see src/terrain/types.ts). */
export interface EquirectGrid {
  width: number;
  height: number;
  data: Int16Array | Float32Array;
  /** height_m = raw * scale + offset. */
  scale: number;
  offset: number;
}

export interface HeightLevel extends EquirectGrid {
  /** Samples per degree. */
  ppd: number;
  /** Mean height of the northernmost and southernmost rows, metres: the single value each pole gets. */
  poleN: number;
  poleS: number;
}

function rowMean(g: EquirectGrid, row: number): number {
  let sum = 0;
  const o = row * g.width;
  for (let c = 0; c < g.width; c++) sum += g.data[o + c];
  return (sum / g.width) * g.scale + g.offset;
}

function asLevel(g: EquirectGrid): HeightLevel {
  if (g.width !== g.height * 2 || g.data.length !== g.width * g.height) throw new Error(`height grid: expected a whole-Moon grid twice as wide as high, got ${g.width} x ${g.height}`);
  return { ...g, ppd: g.width / 360, poleN: rowMean(g, 0), poleS: rowMean(g, g.height - 1) };
}

/** The next coarser level: each sample is the mean of 2x2 samples. */
export function halve(g: EquirectGrid): EquirectGrid {
  if (g.width % 2 || g.height % 2) throw new Error('height grid: cannot halve an odd-sized grid');
  const w = g.width / 2, h = g.height / 2;
  const out = new Float32Array(w * h);
  const src = g.data;
  for (let y = 0; y < h; y++) {
    const a = 2 * y * g.width, b = a + g.width, o = y * w;
    for (let x = 0; x < w; x++) out[o + x] = (src[a + 2 * x] + src[a + 2 * x + 1] + src[b + 2 * x] + src[b + 2 * x + 1]) * 0.25;
  }
  return { width: w, height: h, data: out, scale: g.scale, offset: g.offset };
}

export class HeightPyramid {
  /** Coarsest first. */
  private levels: HeightLevel[] = [];

  /** Finest resolution held, samples per degree (0 when empty). */
  get maxPpd(): number {
    return this.levels.length ? this.levels[this.levels.length - 1].ppd : 0;
  }

  get ppds(): number[] {
    return this.levels.map((l) => l.ppd);
  }

  /**
   * Adds a whole-Moon grid and the coarser levels below it, down to `minPpd` or to the
   * finest level already held (levels that exist are kept: they come from their own product).
   */
  add(grid: EquirectGrid, minPpd = 1): void {
    let level = asLevel(grid);
    const have = (ppd: number) => this.levels.some((l) => Math.abs(l.ppd - ppd) < 1e-9);
    const added: HeightLevel[] = [];
    for (;;) {
      if (!have(level.ppd)) added.push(level);
      const next = level.ppd / 2;
      if (next < minPpd - 1e-9 || have(next) || level.width % 2 || level.height % 2) break;
      level = asLevel(halve(level));
    }
    this.levels = [...this.levels, ...added].sort((a, b) => a.ppd - b.ppd);
  }

  /** The level to read for a wanted resolution: the coarsest one at least that fine, else the finest. */
  levelFor(ppd: number): HeightLevel | null {
    if (!this.levels.length) return null;
    return this.levels.find((l) => l.ppd >= ppd - 1e-9) ?? this.levels[this.levels.length - 1];
  }

  /**
   * Height in metres above the 1737.4 km sphere (bilinear), read at about `ppd` samples per
   * degree (finest level when omitted). 0 when no grid is loaded. East-positive longitude.
   */
  sample(lat: number, lon: number, ppd = Infinity): number {
    const g = this.levelFor(ppd);
    if (!g) return 0;
    const fy = (90 - lat) * g.ppd - 0.5;
    let fx = (lon + 180) * g.ppd - 0.5;
    fx -= Math.floor(fx / g.width) * g.width; // wrap into 0..width
    const x0 = Math.floor(fx);
    const a = fx - x0;
    const x1 = x0 + 1 === g.width ? 0 : x0 + 1;
    const xa = x0 === g.width ? 0 : x0;
    const row = (y: number) => {
      const o = y * g.width;
      return (g.data[o + xa] * (1 - a) + g.data[o + x1] * a) * g.scale + g.offset;
    };
    // Between the last row of pixel centres and a pole: ease to the pole's single value,
    // so the pole has one height whatever longitude it is asked at.
    if (fy <= 0) {
      const edge = row(0);
      return edge + (g.poleN - edge) * Math.min(1, -2 * fy);
    }
    if (fy >= g.height - 1) {
      const edge = row(g.height - 1);
      return edge + (g.poleS - edge) * Math.min(1, 2 * (fy - (g.height - 1)));
    }
    const y0 = Math.floor(fy);
    const b = fy - y0;
    return row(y0) * (1 - b) + row(y0 + 1) * b;
  }
}
