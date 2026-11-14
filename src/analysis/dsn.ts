// Extension (task T-21): geometric contact opportunities between a lunar site and the three
// complexes of NASA's Deep Space Network over a mission window.
//
// An "opportunity" is a time span in which the straight line between a station's antenna and
// the site is clear on both ends: the site stands above the station's elevation limit, and the
// station stands above the site's terrain skyline. The direction to the station itself is
// used at the site, not the direction to Earth's centre: the stations sit up to 0.95 deg from
// the centre of Earth's disc, which decides the matter when Earth hangs at the skyline.
//
// GEOMETRY ONLY. Nothing here says a link would work: no link budget, no frequency or
// antenna pattern, no scheduling or availability of the antennas, no station terrain mask.
//
// Station facts: DSN Telecommunications Link Design Handbook, JPL document 810-005,
// Module 301 "Coverage and Geometry", Rev. N, 15 April 2022
// (https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf):
//   Table 2  Cartesian coordinates, ITRF93, epoch 2003.0
//   Table 5  geodetic coordinates on the WGS 84 ellipsoid
//   2.2.3    "generic elevation limits ... 6.0 degrees for receive, 10.0 degrees for low-power
//            transmit, and 13.5 degrees for high-power transmit"
//   2.2.3.2  the 70 m transmit coverage chart uses "a 10.4-degree transmit elevation limit at
//            DSS 14 and a 10.2-degree transmit elevation limit at DSS 43 and DSS 63"
// JPL Horizons lists the same coordinates for its sites -14, -43 and -63 (to its printed digits).
import type { LatLon, Scenario } from '../core/types';
import { linkEpoch, linkGeometry, siteFrame, stationFrame, type LinkGeometry } from '../astro/groundStation';
import { skylineAt } from './horizon';
import { intervalsOf, longest, totalHours } from './intervals';
import type { ContactSummary, DsnOpportunities, GroundStation, HorizonProfile, SiteAnalysis, StationInstant, StationOpportunities } from './types';

const dms = (d: number, m: number, s: number) => Math.sign(d || 1) * (Math.abs(d) + m / 60 + s / 3600);
const east180 = (lon: number) => (lon > 180 ? lon - 360 : lon);

/** The 70 m antenna of each DSN complex (810-005 Module 301 Rev. N, Tables 2 and 5). */
export const DSN_STATIONS: readonly GroundStation[] = [
  {
    id: 'DSS-14', name: 'Goldstone DSS-14 (70 m)', complex: 'Goldstone, California, USA',
    latDeg: dms(35, 25, 33.24312), lonDeg: east180(dms(243, 6, 37.66244)), heightM: 1001.390,
    xyzM: [-2353621.420, -4641341.472, 3677052.318], receiveMaskDeg: 6.0, transmitMaskDeg: 10.4,
  },
  {
    id: 'DSS-43', name: 'Canberra DSS-43 (70 m)', complex: 'Tidbinbilla, near Canberra, Australia',
    latDeg: dms(-35, 24, 8.72724), lonDeg: east180(dms(148, 58, 52.56231)), heightM: 688.867,
    xyzM: [-4460894.917, 2682361.507, -3674748.152], receiveMaskDeg: 6.0, transmitMaskDeg: 10.2,
  },
  {
    id: 'DSS-63', name: 'Madrid DSS-63 (70 m)', complex: 'Robledo de Chavela, near Madrid, Spain',
    latDeg: dms(40, 25, 52.35510), lonDeg: east180(dms(355, 45, 7.16924)), heightM: 864.816,
    xyzM: [4849092.518, -360180.3480, 4115109.251], receiveMaskDeg: 6.0, transmitMaskDeg: 10.2,
  },
];

export const DSN_ASSUMPTIONS: readonly string[] = [
  'Geometry only: an opportunity is an unobstructed straight line between the station and the site, with the site above the station\'s elevation limit and the station above the site\'s terrain skyline. It is not a statement about a working radio link: no link budget, frequency, antenna pattern, antenna scheduling or availability is considered.',
  'Stations: the 70 m antennas DSS-14 (Goldstone), DSS-43 (Canberra) and DSS-63 (Madrid). Coordinates from the DSN Telecommunications Link Design Handbook, 810-005, Module 301 Rev. N (15 April 2022), Tables 2 and 5 (ITRF93 epoch 2003.0; WGS 84).',
  'Elevation limits: 6.0 deg for receiving (the handbook\'s generic receive limit; the antennas\' mechanical limit is about 6 deg) and, for transmitting, 10.4 deg at DSS-14 and 10.2 deg at DSS-43 and DSS-63 (the limits of the handbook\'s 70 m transmit coverage chart). The stations\' own azimuth-dependent horizon masks are not applied: for instance the handbook keeps DSS-63 above 20.2 deg towards high ground to its north-west when transmitting, and high-power transmitters have higher limits.',
  'At the site the direction to the station itself is tested against the skyline (the stations are up to 0.95 deg from the centre of Earth\'s disc).',
  'Positions are geometric and airless (no tropospheric refraction); Earth\'s rotation uses UT1 = UTC without polar motion. Checked against JPL Horizons, the site as seen from each station: elevation within 0.0013 deg over 1154 instants (1971, 2025, 2034) and rise and set times through the limits within 0.3 s on the day compared; UT1 - UTC, at most 0.9 s, is the limit in general.',
];

/** The line between each station and the site at one instant. */
export function dsnGeometryAt(site: LatLon, siteHeightM: number, timeMs: number, stations: readonly GroundStation[] = DSN_STATIONS): (LinkGeometry & { station: GroundStation })[] {
  const epoch = linkEpoch(timeMs);
  const sf = siteFrame(site.lat, site.lon, siteHeightM);
  return stations.map((station) => ({ ...linkGeometry(epoch, sf, stationFrame(station)), station }));
}

function summarise(spans: { on: ContactSummary['intervals']; off: ContactSummary['intervals'] }, windowH: number): ContactSummary {
  const gap = longest(spans.off);
  return { intervals: spans.on, gapIntervals: spans.off, pct: windowH > 0 ? (100 * totalHours(spans.on)) / windowH : NaN, longestGapH: gap.h, gapOpenEnded: gap.open };
}

/**
 * Opportunities over the scenario's window, sampled like its series (and at the window's end
 * when that falls between samples), with rise and set times refined to 10 s.
 * `horizon` is the site's skyline profile; the observer is at its site height plus mast.
 */
export function dsnOpportunities(scenario: Scenario, horizon: HorizonProfile, stations: readonly GroundStation[] = DSN_STATIONS): DsnOpportunities {
  const stepMs = Math.max(1, scenario.stepMin) * 60_000;
  const startMs = scenario.startMs;
  const endMs = startMs + scenario.durationH * 3_600_000;
  const n = Math.floor((endMs - startMs) / stepMs + 1e-9) + 1;
  const hasTail = startMs + (n - 1) * stepMs < endMs;
  const count = hasTail ? n + 1 : n;
  const timeAt = (i: number) => (i < n ? startMs + i * stepMs : endMs);
  const windowH = (endMs - startMs) / 3_600_000;

  const sf = siteFrame(horizon.site.lat, horizon.site.lon, horizon.siteElevationM + horizon.mastHeightM);
  const frames = stations.map(stationFrame);
  const g = {} as LinkGeometry;
  /** Station elevation of the site, and the station's clearance above the site's skyline, at one instant. */
  const at = (k: number, t: number, out: Float64Array) => {
    linkGeometry(linkEpoch(t), sf, frames[k], g);
    out[0] = g.stationElDeg;
    out[1] = g.siteElDeg - skylineAt(horizon, g.siteAzDeg);
  };

  // Sample every station at every instant once (the instant's Moon and Earth orientation is shared).
  const el = stations.map(() => new Float32Array(count));
  const clr = stations.map(() => new Float32Array(count));
  for (let i = 0; i < count; i++) {
    const epoch = linkEpoch(timeAt(i));
    for (let k = 0; k < stations.length; k++) {
      linkGeometry(epoch, sf, frames[k], g);
      el[k][i] = g.stationElDeg;
      clr[k][i] = g.siteElDeg - skylineAt(horizon, g.siteAzDeg);
    }
  }

  const o = new Float64Array(2);
  /** Positive while station k has the line of sight with the given elevation limit. */
  const indicator = (k: number, mask: number) => (t: number) => {
    at(k, t, o);
    return Math.min(o[0] - mask, o[1]);
  };
  const spansFor = (mask: (s: GroundStation) => number) => stations.map((s, k) => {
    const m = mask(s);
    return intervalsOf((i) => el[k][i] > m && clr[k][i] > 0, indicator(k, m), timeAt, count, startMs, endMs);
  });
  const anyOf = (mask: (s: GroundStation) => number) => {
    const inds = stations.map((s, k) => indicator(k, mask(s)));
    return intervalsOf(
      (i) => stations.some((s, k) => el[k][i] > mask(s) && clr[k][i] > 0),
      (t) => Math.max(...inds.map((f) => f(t))),
      timeAt, count, startMs, endMs,
    );
  };

  const rx = spansFor((s) => s.receiveMaskDeg);
  const tx = spansFor((s) => s.transmitMaskDeg);
  const result: StationOpportunities[] = stations.map((station, k) => ({
    station: { ...station, xyzM: [...station.xyzM] as [number, number, number] },
    receive: summarise(rx[k], windowH),
    transmit: summarise(tx[k], windowH),
    // Per-sample arrays line up with the series: the extra end-of-window value is not part of them.
    stationElDeg: el[k].subarray(0, n).slice(),
    siteClearanceDeg: clr[k].subarray(0, n).slice(),
  }));
  return {
    stations: result,
    anyReceive: summarise(anyOf((s) => s.receiveMaskDeg), windowH),
    anyTransmit: summarise(anyOf((s) => s.transmitMaskDeg), windowH),
    assumptions: [...DSN_ASSUMPTIONS],
  };
}

/**
 * Each station at one instant, for an analysed site: where the site is in the station's sky,
 * where the station is in the site's sky against the skyline, and what (if anything) is in the way.
 */
export function dsnInstant(analysis: SiteAnalysis, timeMs: number): StationInstant[] {
  const p = analysis.horizon;
  const stations = analysis.dsn ? analysis.dsn.stations.map((s) => s.station) : [...DSN_STATIONS];
  const heightM = (Number.isFinite(p.siteElevationM) ? p.siteElevationM : 0) + p.mastHeightM;
  return dsnGeometryAt(p.site, heightM, timeMs, stations).map((g) => {
    const skyline = skylineAt(p, g.siteAzDeg);
    const clearance = g.siteElDeg - skyline;
    const terrainClear = clearance > 0;
    const receive = terrainClear && g.stationElDeg > g.station.receiveMaskDeg;
    const transmit = terrainClear && g.stationElDeg > g.station.transmitMaskDeg;
    const stationLow = !(g.stationElDeg > g.station.receiveMaskDeg);
    return {
      station: g.station,
      timeMs,
      stationElDeg: g.stationElDeg,
      stationAzDeg: g.stationAzDeg,
      siteElDeg: g.siteElDeg,
      siteAzDeg: g.siteAzDeg,
      siteClearanceDeg: clearance,
      rangeKm: g.rangeKm,
      receive,
      transmit,
      blockedBy: receive ? 'nothing' : stationLow && !terrainClear ? 'both' : stationLow ? 'station-horizon' : Number.isFinite(clearance) ? 'lunar-terrain' : 'unknown',
    };
  });
}
