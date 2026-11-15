// Terrain access contract. Owned by the elevation-data worker (implementations
// live beside this file); consumed by the horizon and slope code in src/analysis.
//
// Heights are metres above the 1737.4 km sphere. Every source says what it is
// and how fine it is, so results can state honestly which data they rest on.

/** Plain, structured-clonable description of a height grid, so it can be posted to a Web Worker. */
export type HeightGridDescriptor =
  | {
      /** Square grid centred on (lat0, lon0); sample (i, j) lies (i - c) * spacingM east and (j - c) * spacingM north, c = (n - 1) / 2. */
      kind: 'local';
      name: string;
      resolutionM: number;
      lat0: number;
      lon0: number;
      n: number;
      spacingM: number;
      data: Float32Array;
    }
  | {
      /** Equirectangular grid: column 0 at lonW, row 0 at latN; pixel centres are half a pixel inside the bounds. */
      kind: 'equirect';
      name: string;
      resolutionM: number;
      width: number;
      height: number;
      latN: number;
      latS: number;
      lonW: number;
      lonE: number;
      /** height_m = raw * scale + offset. */
      data: Int16Array | Float32Array;
      scale: number;
      offset: number;
      nodata?: number;
    }
  | {
      /** Polar stereographic grid as in the LOLA polar products: square, pole at the centre. */
      kind: 'polar';
      name: string;
      resolutionM: number;
      pole: 'N' | 'S';
      size: number;
      metresPerPx: number;
      data: Int16Array | Float32Array;
      scale: number;
      offset: number;
      nodata?: number;
    };

/** Where a height grid came from, for credits and "about this data" panels. */
export interface HeightProvenance {
  /** Archive product(s), e.g. "LRO LOLA LDEM_16 (PDS, V3.1)". */
  product: string;
  /** Where the product can be downloaded. */
  url: string;
  /** What Lunyx did to it (cropping, averaging, rounding), in plain words. */
  processing: string;
  /** How to cite it. */
  citation: string;
}

export interface HeightSource {
  /** Human-readable product name, e.g. "SLDEM2015 512 ppd (site window)". Shown in provenance labels. */
  readonly name: string;
  /** Nominal ground sample distance, metres. */
  readonly resolutionM: number;
  /** The data behind this source, for transfer to a worker. */
  readonly descriptor: HeightGridDescriptor;
  /** Origin of the data, when known. Not carried by the descriptor: read it before posting to a worker. */
  readonly provenance?: HeightProvenance;
  /** True when the source has data at this point. */
  covers(lat: number, lon: number): boolean;
  /** Height in metres at a point (bilinear), or NaN where the source has no data. */
  sample(lat: number, lon: number): number;
}

/**
 * Where a square grid the site stands on ends and the next, coarser source takes over. The
 * two are separate measurements and never agree exactly there. Heights are "outer grid
 * minus inner grid" along the inner grid's edge.
 */
export interface TerrainSeam {
  /** The grid that ends here, and the one(s) that continue. */
  inner: string;
  outer: string;
  /**
   * Distance from the site to the nearest point of that edge, metres: half the grid's width
   * for the site's own grids (they are centred on it), less for a neighbouring site's grid.
   */
  distanceM: number;
  /** The mismatch as the stack has it now, both grids read at the same points of the edge: nothing where the edge was eased. */
  minM: number;
  maxM: number;
  rmsM: number;
  /** Skyline elevation that one metre of height makes at that distance, degrees. */
  degPerMetre: number;
  /**
   * Set when the inner grid was eased onto the outer one: over how many metres inside its
   * edge, and what the mismatch was before. Inside that band the heights are a blend of
   * the two grids; at the edge they are the outer grid's.
   */
  eased?: { overM: number; minM: number; maxM: number; rmsM: number };
}

/** The terrain available around one site, finest source first. The last entry should cover the whole Moon. */
export interface TerrainStack {
  sources: HeightSource[];
  /** Plain-language notes about gaps, e.g. "No high-resolution survey here: nearest relief finer than 1.9 km is not resolved". */
  notes: string[];
  /** Each hand-over between the site's own grids, nearest first: eased or not, and the mismatch (also stated in `notes`). */
  seams?: TerrainSeam[];
}

/** Where a class of terrain data exists, for the coverage display. */
export interface CoverageRegion {
  name: string;
  resolutionM: number;
  /** Either a latitude cap/band or a list of site windows. */
  latMin?: number;
  latMax?: number;
  sites?: { lat: number; lon: number; halfWidthM: number }[];
  /** Plain-language detail, e.g. the exact footprint of a square polar grid. */
  note?: string;
  /** True when the data is not bundled: the elevation server builds it on request (needs network access). */
  onDemand?: boolean;
}

/** Slope and roughness over the landing region around a site (decision engine, D-17; implemented in src/terrain/region.ts). */
export interface RegionTerrain {
  /** Centre of the region. */
  lat: number;
  lon: number;
  radiusM: number;
  /** Name and spacing of the finest elevation grid that covers the whole region. */
  demName: string;
  gridSpacingM: number;
  /** Number of grid samples inside the region. */
  samples: number;
  /** Slope criterion value (see definition in the design note), degrees; null when not measurable. */
  slopeDeg: number | null;
  /** Roughness / hazard proxy, metres (e.g. RMS height residual after a plane fit); null when the grid is too coarse to say anything about it. */
  roughnessM: number | null;
  /** Share of local slopes over the profile's slope threshold, 0..1, when measurable. Informative only. */
  hazardFraction?: number | null;
  /** Sentences: resolution caveats, what is invisible at this spacing. */
  notes: string[];
}
