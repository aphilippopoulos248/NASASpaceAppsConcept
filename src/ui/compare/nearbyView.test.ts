import { describe, expect, it } from 'vitest';
import type { NearbyCandidate } from '../../analysis/types';
import { nearbyRow, nearbyView, offsetName } from './nearbyView';

const REF = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing' as const, lat: -84.79, lon: 29.2 };

/** A scan row as the science core returns it (only the fields the view reads carry real values). */
function row(over: { e?: number; n?: number; slope?: number; sun?: number; earth?: number; dark?: number; gap?: number; rank?: number; rejected?: NearbyCandidate['rejected']; ref?: boolean }): NearbyCandidate {
  const e = over.e ?? 0, n = over.n ?? 0, isReference = over.ref ?? false;
  const scored = over.sun !== undefined;
  const name = isReference ? REF.name : `Candidate ${Math.abs(e)} m ${e >= 0 ? 'E' : 'W'}, ${Math.abs(n)} m ${n >= 0 ? 'N' : 'S'} of ${REF.name}`;
  return {
    site: isReference ? REF : { id: `pin:${(-84.79 + n / 30000).toFixed(5)},${(29.2 + e / 3000).toFixed(5)}`, name, kind: 'candidate', lat: -84.79 + n / 30000, lon: 29.2 + e / 3000 },
    eastM: e, northM: n, distanceM: Math.hypot(e, n), bearingDeg: isReference ? NaN : (Math.atan2(e, n) * 180 / Math.PI + 360) % 360, elevationM: 5321.4,
    slope: { slopeDeg: over.slope ?? 3, aspectDeg: 0, baselineM: 120, demName: 'LOLA' },
    metrics: scored ? ({ illuminationPct: over.sun, earthVisiblePct: over.earth ?? 100, longestDarknessH: over.dark ?? 0, longestEarthGapH: over.gap ?? 0 } as NearbyCandidate['metrics']) : null,
    rejected: over.rejected ?? null,
    score: scored ? (over.sun! + (over.earth ?? 100)) / 2 : NaN,
    rank: over.rank ?? 0, isReference, basis: 'Slope over 120 m from LOLA (60 m grid), the same measure for every candidate. Skyline every 1 deg.',
  };
}

// The order the science core returns: ranked rows by score (the site itself among them), then the rest.
const SCAN: NearbyCandidate[] = [
  row({ e: 300, n: 0, sun: 90, slope: 2.5, rank: 1 }),
  row({ ref: true, sun: 80, dark: 6.25, slope: 2.1, rank: 2 }),
  row({ e: -300, n: 600, sun: 70, earth: 90, gap: 12, slope: 7.99, rank: 3 }),
  row({ e: 0, n: -300, sun: 60, slope: 4, rank: 4 }),
  row({ e: 600, n: 0, slope: 14, rejected: 'slope' }),
  row({ e: 900, n: 0, slope: 21, rejected: 'slope' }),
  row({ e: 0, n: 900, slope: NaN, rejected: 'no-data' }),
];

describe('the ranked list of nearby alternatives', () => {
  it('numbers the alternatives without the site itself and counts what was left out', () => {
    const v = nearbyView(SCAN);
    expect(v.total).toBe(7);
    expect(v.reference?.site.id).toBe('im-2');
    expect(v.alternatives.map((a) => [a.rank, a.candidate.eastM, a.candidate.northM])).toEqual([[1, 300, 0], [2, -300, 600], [3, 0, -300]]);
    expect(v.betterThanReference).toBe(1);
    expect(v.rejected).toEqual({ slope: 2, noData: 1 });
    expect(v.referenceOverSlopeLimit).toBe(false);
    expect(v.basis).toMatch(/^Slope over 120 m from LOLA/);
  });

  it('keeps the site itself for comparison when it is over the slope limit or has no data', () => {
    const steep = nearbyView([row({ e: 300, sun: 50, rank: 1 }), row({ ref: true, sun: 80, slope: 12, rejected: 'slope' }), row({ e: 600, slope: 30, rejected: 'slope' })]);
    expect(steep.referenceOverSlopeLimit).toBe(true);
    expect(steep.rejected).toEqual({ slope: 1, noData: 0 }); // the site itself is not counted as a rejected alternative
    expect(steep.alternatives).toHaveLength(1);
    expect(steep.betterThanReference).toBe(0);
    const blind = nearbyView([row({ ref: true, slope: NaN, rejected: 'no-data' }), row({ e: 300, slope: NaN, rejected: 'no-data' })]);
    expect(blind).toMatchObject({ alternatives: [], betterThanReference: null, rejected: { slope: 0, noData: 1 } });
    expect(nearbyView([])).toMatchObject({ total: 0, reference: null, alternatives: [], betterThanReference: null, basis: '' });
  });

  it('gives each row as plain JSON with units in the names and null for what does not exist', () => {
    const v = nearbyView(SCAN);
    expect(nearbyRow(v.alternatives[1].candidate, 2)).toEqual({
      rank: 2, id: 'pin:-84.77000,29.10000', name: 'Candidate 300 m W, 600 m N of IM-2 Athena', latDeg: -84.77, lonDegEast: 29.1,
      distanceM: 671, bearingDeg: 333, elevationM: 5321, slopeDeg: 7.99, illuminationPct: 70, longestDarknessH: 0, earthVisiblePct: 90, longestEarthGapH: 12, score: 80,
    });
    expect(nearbyRow(v.reference!, 0)).toMatchObject({ rank: 0, id: 'im-2', isReference: true, distanceM: 0, bearingDeg: null, longestDarknessH: 6.25, score: 90 });
    const rejected = nearbyRow(SCAN[6], 0);
    expect(rejected).toMatchObject({ slopeDeg: null, illuminationPct: null, longestDarknessH: null, earthVisiblePct: null, longestEarthGapH: null, score: null });
    expect(JSON.parse(JSON.stringify(rejected))).toEqual(rejected);
  });

  it('shortens a candidate name to its offset from the scanned site', () => {
    expect(offsetName(SCAN[2], 'IM-2 Athena')).toBe('300 m W, 600 m N');
    expect(offsetName(SCAN[1], 'IM-2 Athena')).toBe('IM-2 Athena');
    expect(offsetName(SCAN[2], 'Another site')).toBe('300 m W, 600 m N of IM-2 Athena');
  });
});
