// The ranked list of nearby alternatives as the panel and the rankNearby action present it:
// the scanned site itself apart from the alternatives, the alternatives numbered 1..n by score,
// and the counts of what was rejected. Pure: every figure is the scan's own.
import type { NearbyCandidate } from '../../analysis/types';
import { rounded } from '../../core/analysisStore';

export interface RankedAlternative {
  /** 1 = best among the alternatives (the scanned site itself is not counted). */
  rank: number;
  candidate: NearbyCandidate;
}

export interface NearbyView {
  /** Points scanned, the site itself included. */
  total: number;
  /** The scanned site itself; null only for an empty scan. */
  reference: NearbyCandidate | null;
  /** Alternatives within the slope limit, best first. */
  alternatives: RankedAlternative[];
  /** Alternatives that score higher than the site itself; null when the site has no score (no elevation data). */
  betterThanReference: number | null;
  /** Alternatives left out, by reason. */
  rejected: { slope: number; noData: number };
  /** True when the site itself is steeper than the slope limit (it is still analysed, for comparison). */
  referenceOverSlopeLimit: boolean;
  /** What the slope and the skylines of the scan rest on, in words. */
  basis: string;
}

export function nearbyView(rows: readonly NearbyCandidate[]): NearbyView {
  const reference = rows.find((r) => r.isReference) ?? null;
  const ranked = rows
    .filter((r) => !r.isReference && !r.rejected && r.rank > 0 && Number.isFinite(r.score))
    .sort((a, b) => a.rank - b.rank);
  const others = rows.filter((r) => !r.isReference);
  const refScore = reference && Number.isFinite(reference.score) ? reference.score : null;
  return {
    total: rows.length,
    reference,
    alternatives: ranked.map((candidate, i) => ({ rank: i + 1, candidate })),
    betterThanReference: refScore === null ? null : ranked.filter((r) => r.score > refScore).length,
    rejected: { slope: others.filter((r) => r.rejected === 'slope').length, noData: others.filter((r) => r.rejected === 'no-data').length },
    referenceOverSlopeLimit: reference?.rejected === 'slope',
    basis: reference?.basis ?? ranked[0]?.basis ?? '',
  };
}

/** A row of the scan as a small JSON object (the shape agreed with the assistant): units in the key names, null for what does not exist. */
export function nearbyRow(c: NearbyCandidate, rank: number) {
  const m = c.metrics;
  return {
    rank,
    id: c.site.id,
    name: c.site.name,
    latDeg: rounded(c.site.lat, 5),
    lonDegEast: rounded(c.site.lon, 5),
    distanceM: rounded(c.distanceM, 0),
    bearingDeg: c.isReference ? null : rounded(c.bearingDeg ?? NaN, 0),
    elevationM: rounded(c.elevationM, 0),
    slopeDeg: rounded(c.slope.slopeDeg),
    illuminationPct: rounded(m ? m.illuminationPct : NaN),
    longestDarknessH: rounded(m ? m.longestDarknessH : NaN),
    earthVisiblePct: rounded(m ? m.earthVisiblePct : NaN),
    longestEarthGapH: rounded(m ? m.longestEarthGapH : NaN),
    score: rounded(c.score),
    ...(c.isReference && { isReference: true }),
  };
}

/** "300 m W, 600 m S": where a candidate lies from the scanned site (the part of its name before " of <site>"). */
export function offsetName(c: NearbyCandidate, referenceName: string): string {
  const tail = ` of ${referenceName}`;
  const name = c.site.name.startsWith('Candidate ') ? c.site.name.slice('Candidate '.length) : c.site.name;
  return name.endsWith(tail) ? name.slice(0, -tail.length) : name;
}
