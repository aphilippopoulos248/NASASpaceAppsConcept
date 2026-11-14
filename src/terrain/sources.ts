// HeightSource implementations for the three grid layouts of ./types.
// Pure maths over typed arrays: no fetch, no DOM, safe inside a Web Worker.
import type { HeightGridDescriptor, HeightProvenance, HeightSource } from './types';
import { R_MOON_M, localFrame } from './geo';

type LocalDescriptor = Extract<HeightGridDescriptor, { kind: 'local' }>;
type EquirectDescriptor = Extract<HeightGridDescriptor, { kind: 'equirect' }>;
type PolarDescriptor = Extract<HeightGridDescriptor, { kind: 'polar' }>;

const DEG = Math.PI / 180;

/**
 * Square window centred on a site. Sample (i, j) is the point reached by travelling
 * (i - c) * spacing east and (j - c) * spacing north over the sphere (see geo.offsetPoint),
 * so j increases northwards. Covers the square between the outermost samples.
 */
export class LocalSource implements HeightSource {
  readonly name: string;
  readonly resolutionM: number;
  readonly descriptor: LocalDescriptor;
  readonly provenance?: HeightProvenance;
  /** Half the width of the window, metres. */
  readonly halfWidthM: number;
  private readonly p: [number, number, number];
  private readonly e: [number, number, number];
  private readonly n: [number, number, number];

  constructor(descriptor: LocalDescriptor, provenance?: HeightProvenance) {
    this.provenance = provenance;
    if (descriptor.data.length !== descriptor.n * descriptor.n) throw new Error(`${descriptor.name}: expected ${descriptor.n}x${descriptor.n} samples, got ${descriptor.data.length}`);
    this.descriptor = descriptor;
    this.name = descriptor.name;
    this.resolutionM = descriptor.resolutionM;
    this.halfWidthM = ((descriptor.n - 1) / 2) * descriptor.spacingM;
    const f = localFrame(descriptor.lat0, descriptor.lon0);
    this.p = f.p;
    this.e = f.e;
    this.n = f.n;
  }

  /** Fractional grid position of a point, or null outside the window. Writes into `out` = [fx, fy]. */
  private locate(lat: number, lon: number, out: Float64Array): boolean {
    const φ = lat * DEG;
    const λ = lon * DEG;
    const cφ = Math.cos(φ);
    const qx = cφ * Math.cos(λ);
    const qy = cφ * Math.sin(λ);
    const qz = Math.sin(φ);
    const ce = qx * this.e[0] + qy * this.e[1] + qz * this.e[2];
    const cn = qx * this.n[0] + qy * this.n[1] + qz * this.n[2];
    const t = Math.hypot(ce, cn);
    const d = this.descriptor;
    const c = (d.n - 1) / 2;
    if (t < 1e-15) {
      // The centre itself, or its antipode.
      if (qx * this.p[0] + qy * this.p[1] + qz * this.p[2] < 0) return false;
      out[0] = c;
      out[1] = c;
      return true;
    }
    const k = (Math.atan2(t, qx * this.p[0] + qy * this.p[1] + qz * this.p[2]) * R_MOON_M) / (t * d.spacingM);
    const fx = ce * k + c;
    const fy = cn * k + c;
    // A whisker of tolerance so points computed onto the edge by round-trip maths still count.
    const eps = 1e-9 * d.n;
    if (!(fx >= -eps && fy >= -eps && fx <= d.n - 1 + eps && fy <= d.n - 1 + eps)) return false;
    out[0] = fx;
    out[1] = fy;
    return true;
  }

  covers(lat: number, lon: number): boolean {
    return this.locate(lat, lon, scratch);
  }

  sample(lat: number, lon: number): number {
    if (!this.locate(lat, lon, scratch)) return NaN;
    const { n, data } = this.descriptor;
    const fx = Math.min(n - 1, Math.max(0, scratch[0]));
    const fy = Math.min(n - 1, Math.max(0, scratch[1]));
    const x = Math.min(n - 2, Math.floor(fx));
    const y = Math.min(n - 2, Math.floor(fy));
    const a = fx - x;
    const b = fy - y;
    const i = y * n + x;
    return blend(data[i], data[i + 1], data[i + n], data[i + n + 1], a, b);
  }
}

/**
 * Equirectangular (simple cylindrical) grid. Row 0 is the northern edge, column 0 the
 * western edge; pixel centres sit half a pixel inside the bounds. A grid spanning 360
 * degrees wraps in longitude; where it reaches a pole, the pole gets the mean of the
 * last row and the half pixel in between eases towards it.
 */
export class EquirectSource implements HeightSource {
  readonly name: string;
  readonly resolutionM: number;
  readonly descriptor: EquirectDescriptor;
  readonly provenance?: HeightProvenance;
  private readonly full: boolean;
  private readonly lonSpan: number;
  private readonly pxPerDegX: number;
  private readonly pxPerDegY: number;
  private readonly hasNodata: boolean;
  private readonly nodata: number;
  /** Height at each pole the grid reaches (mean of the adjacent row). */
  private readonly capN?: number;
  private readonly capS?: number;

  constructor(descriptor: EquirectDescriptor, provenance?: HeightProvenance) {
    this.provenance = provenance;
    if (descriptor.data.length !== descriptor.width * descriptor.height) throw new Error(`${descriptor.name}: expected ${descriptor.width}x${descriptor.height} samples, got ${descriptor.data.length}`);
    this.descriptor = descriptor;
    this.name = descriptor.name;
    this.resolutionM = descriptor.resolutionM;
    this.lonSpan = descriptor.lonE - descriptor.lonW;
    if (!(this.lonSpan > 0) || !(descriptor.latN > descriptor.latS)) throw new Error(`${descriptor.name}: bounds must run west to east and south to north`);
    this.full = this.lonSpan >= 360 - 1e-9;
    this.pxPerDegX = descriptor.width / this.lonSpan;
    this.pxPerDegY = descriptor.height / (descriptor.latN - descriptor.latS);
    this.hasNodata = descriptor.nodata !== undefined;
    this.nodata = descriptor.nodata ?? NaN;
    if (this.full && descriptor.latN >= 90 - 1e-9) this.capN = this.rowMean(0);
    if (this.full && descriptor.latS <= -90 + 1e-9) this.capS = this.rowMean(descriptor.height - 1);
  }

  covers(lat: number, lon: number): boolean {
    const d = this.descriptor;
    if (!(lat >= d.latS && lat <= d.latN)) return false;
    if (this.full) return Number.isFinite(lon);
    const rel = mod360(lon - d.lonW);
    return rel <= this.lonSpan;
  }

  private at(row: number, col: number): number {
    const d = this.descriptor;
    row = Math.min(d.height - 1, Math.max(0, row));
    if (this.full) col = ((col % d.width) + d.width) % d.width;
    else col = Math.min(d.width - 1, Math.max(0, col));
    const raw = d.data[row * d.width + col];
    if (this.hasNodata && raw === this.nodata) return NaN;
    return raw * d.scale + d.offset;
  }

  /** Mean of a whole row, metres: the height given to a pole the grid reaches. */
  private rowMean(row: number): number {
    const d = this.descriptor;
    let sum = 0;
    let n = 0;
    for (let c = 0; c < d.width; c++) {
      const v = this.at(row, c);
      if (!Number.isNaN(v)) {
        sum += v;
        n++;
      }
    }
    return n ? sum / n : NaN;
  }

  sample(lat: number, lon: number): number {
    if (!this.covers(lat, lon)) return NaN;
    const d = this.descriptor;
    const fx = mod360(lon - d.lonW) * this.pxPerDegX - 0.5;
    const fy = (d.latN - lat) * this.pxPerDegY - 0.5;
    const x = Math.floor(fx);
    const a = fx - x;
    // Between the last row of pixel centres and a pole: ease from that row to the single
    // polar value, so the pole has one height whatever longitude it is asked at.
    if (fy < 0 && this.capN !== undefined) {
      const edge = blend(this.at(0, x), this.at(0, x + 1), 0, 0, a, 0);
      return edge + (this.capN - edge) * Math.min(1, -2 * fy);
    }
    if (fy > d.height - 1 && this.capS !== undefined) {
      const edge = blend(this.at(d.height - 1, x), this.at(d.height - 1, x + 1), 0, 0, a, 0);
      return edge + (this.capS - edge) * Math.min(1, 2 * (fy - (d.height - 1)));
    }
    const y = Math.floor(fy);
    return blend(this.at(y, x), this.at(y, x + 1), this.at(y + 1, x), this.at(y + 1, x + 1), a, fy - y);
  }
}

/**
 * Polar stereographic grid laid out like the LOLA polar products: square, the pole at the
 * centre (between the four middle pixels), true scale at the pole, longitude 0 towards
 * the top of the image for the south pole and towards the bottom for the north pole.
 * Covers the square between the outermost pixel centres.
 */
export class PolarSource implements HeightSource {
  readonly name: string;
  readonly resolutionM: number;
  readonly descriptor: PolarDescriptor;
  readonly provenance?: HeightProvenance;
  /** Half the width of the covered square, metres in the projection plane. */
  readonly halfWidthM: number;
  private readonly sign: number;
  private readonly hasNodata: boolean;
  private readonly nodata: number;

  constructor(descriptor: PolarDescriptor, provenance?: HeightProvenance) {
    this.provenance = provenance;
    if (descriptor.data.length !== descriptor.size * descriptor.size) throw new Error(`${descriptor.name}: expected ${descriptor.size}x${descriptor.size} samples, got ${descriptor.data.length}`);
    this.descriptor = descriptor;
    this.name = descriptor.name;
    this.resolutionM = descriptor.resolutionM;
    this.halfWidthM = ((descriptor.size - 1) / 2) * descriptor.metresPerPx;
    this.sign = descriptor.pole === 'S' ? 1 : -1;
    this.hasNodata = descriptor.nodata !== undefined;
    this.nodata = descriptor.nodata ?? NaN;
  }

  /** Fractional (sample, line) of a point; false when it falls outside the grid. */
  private locate(lat: number, lon: number, out: Float64Array): boolean {
    const d = this.descriptor;
    const colat = d.pole === 'S' ? 90 + lat : 90 - lat;
    // Points in the far hemisphere project to infinity; anything past 90 degrees is certainly outside.
    if (!(colat >= 0 && colat < 90)) return false;
    const r = (2 * R_MOON_M * Math.tan((colat / 2) * DEG)) / d.metresPerPx;
    const λ = lon * DEG;
    const c = d.size / 2 - 0.5;
    const fx = c + r * Math.sin(λ);
    const fy = c - this.sign * r * Math.cos(λ);
    const eps = 1e-9 * d.size;
    if (!(fx >= -eps && fy >= -eps && fx <= d.size - 1 + eps && fy <= d.size - 1 + eps)) return false;
    out[0] = fx;
    out[1] = fy;
    return true;
  }

  covers(lat: number, lon: number): boolean {
    return this.locate(lat, lon, scratch);
  }

  sample(lat: number, lon: number): number {
    if (!this.locate(lat, lon, scratch)) return NaN;
    const d = this.descriptor;
    const n = d.size;
    const fx = Math.min(n - 1, Math.max(0, scratch[0]));
    const fy = Math.min(n - 1, Math.max(0, scratch[1]));
    const x = Math.min(n - 2, Math.floor(fx));
    const y = Math.min(n - 2, Math.floor(fy));
    const i = y * n + x;
    const data = d.data;
    let v00 = data[i];
    let v10 = data[i + 1];
    let v01 = data[i + n];
    let v11 = data[i + n + 1];
    if (this.hasNodata) {
      const nd = this.nodata;
      v00 = v00 === nd ? NaN : v00;
      v10 = v10 === nd ? NaN : v10;
      v01 = v01 === nd ? NaN : v01;
      v11 = v11 === nd ? NaN : v11;
    }
    return blend(v00, v10, v01, v11, fx - x, fy - y) * d.scale + d.offset;
  }
}

/** Rebuilds a source from its plain description. */
export function createSource(descriptor: HeightGridDescriptor, provenance?: HeightProvenance): HeightSource {
  switch (descriptor.kind) {
    case 'local':
      return new LocalSource(descriptor, provenance);
    case 'equirect':
      return new EquirectSource(descriptor, provenance);
    case 'polar':
      return new PolarSource(descriptor, provenance);
    default:
      throw new Error(`unknown height grid kind: ${(descriptor as { kind: string }).kind}`);
  }
}

const scratch = new Float64Array(2);

function mod360(x: number): number {
  const m = x % 360;
  return m < 0 ? m + 360 : m;
}

/**
 * Bilinear blend of four corner values (v00 at the lower index in both axes).
 * A corner with no data only spoils the result if it really contributes: a weight that is
 * zero up to rounding (a point computed onto a pixel centre) is ignored.
 */
function blend(v00: number, v10: number, v01: number, v11: number, a: number, b: number): number {
  const w00 = (1 - a) * (1 - b);
  const w10 = a * (1 - b);
  const w01 = (1 - a) * b;
  const w11 = a * b;
  return (w00 > 1e-9 ? w00 * v00 : 0) + (w10 > 1e-9 ? w10 * v10 : 0) + (w01 > 1e-9 ? w01 * v01 : 0) + (w11 > 1e-9 ? w11 * v11 : 0);
}
