/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Scenario, SiteRef } from '../core/types';
import { linkEpoch, linkGeometry, siteFrame, stationFrame } from '../astro/groundStation';
import { loadTerrainFor } from '../terrain/api';
import { analyseStack, dsnAt } from './api';
import { DSN_EDGE_PRECISION_MS, DSN_STATIONS, dsnGeometryAt, dsnOpportunities, refineEdges } from './dsn';
import { computeHorizon, skylineAt } from './horizon';
import { EVENT_PRECISION_MS, intervalsOf } from './intervals';
import { setBundleReader, skyAt } from './sky';
import { fnSource, radialSource, stackOf } from './testing';
import type { Interval } from './types';

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
const RAD = Math.PI / 180;
const H = 3_600_000;
const iso = (t: number) => `${new Date(t).toISOString().slice(0, 19)}Z`;

interface FixtureSet {
  station: string;
  site: { id: string; lat: number; lon: number; altKm: number };
  span: string;
  centerGeodetic: string;
  centerName: string;
  targetFrame: string;
  /** [UTC ms, azimuth deg, elevation deg, range km] */
  rows: [number, number, number, number][];
}
// JPL Horizons: a point on the Moon's surface seen from each DSN station, apparent and airless
// (built by scripts/fetch-horizons-dsn-check.mjs; the file's `source` gives the exact query).
const fixture = JSON.parse(readFileSync(join(process.cwd(), 'src', 'analysis', '__fixtures__', 'horizons-dsn-check.json'), 'utf8')) as { sets: FixtureSet[] };
const station = (id: string) => DSN_STATIONS.find((s) => s.id === id)!;

describe('DSN station facts', () => {
  it('coordinates are those of 810-005 Module 301 Rev. N, and JPL Horizons holds the same for its sites', () => {
    expect(DSN_STATIONS.map((s) => s.id)).toEqual(['DSS-14', 'DSS-43', 'DSS-63']);
    for (const s of DSN_STATIONS) {
      const set = fixture.sets.find((x) => x.station === s.id)!;
      // "243.1104618,35.4259009,1.00139" = east longitude (deg), geodetic latitude (deg), altitude (km)
      const [lonE, lat, altKm] = set.centerGeodetic.split(',').map(Number);
      expect(set.centerName).toMatch(new RegExp(`^${s.id} \\(70-m\\)`));
      expect(Math.abs(s.latDeg - lat)).toBeLessThan(6e-8);
      expect(Math.abs(((s.lonDeg - lonE + 540) % 360) - 180)).toBeLessThan(6e-8);
      expect(Math.abs(s.heightM / 1000 - altKm)).toBeLessThan(6e-6);
      // The Cartesian and the geodetic coordinates of the handbook describe the same point (WGS 84).
      const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
      const sl = Math.sin(s.latDeg * RAD), cl = Math.cos(s.latDeg * RAD);
      const N = a / Math.sqrt(1 - e2 * sl * sl);
      const x = (N + s.heightM) * cl * Math.cos(s.lonDeg * RAD), y = (N + s.heightM) * cl * Math.sin(s.lonDeg * RAD), z = (N * (1 - e2) + s.heightM) * sl;
      expect(Math.hypot(x - s.xyzM[0], y - s.xyzM[1], z - s.xyzM[2])).toBeLessThan(0.01);
      expect(s.receiveMaskDeg).toBe(6.0);
      expect(s.transmitMaskDeg).toBe(s.id === 'DSS-14' ? 10.4 : 10.2);
    }
  });
});

describe('station geometry vs JPL Horizons', () => {
  it('azimuth and elevation of the lunar site at each station agree within 0.003 deg (1154 rows, 1971-2034)', () => {
    let worstEl = 0, worstAz = 0, rows = 0;
    for (const set of fixture.sets) {
      expect(set.targetFrame).toMatch(/MEAN_ME/);
      const sf = siteFrame(set.site.lat, set.site.lon, set.site.altKm * 1000);
      const st = stationFrame(station(set.station));
      for (const [t, az, el] of set.rows) {
        const g = linkGeometry(linkEpoch(t), sf, st);
        worstEl = Math.max(worstEl, Math.abs(g.stationElDeg - el));
        worstAz = Math.max(worstAz, Math.abs(((g.stationAzDeg - az + 540) % 360) - 180) * Math.cos(el * RAD));
        rows++;
      }
    }
    console.log(`DSN geometry vs Horizons: ${rows} rows, worst elevation difference ${worstEl.toFixed(5)} deg, worst azimuth arc ${worstAz.toFixed(5)} deg`);
    expect(rows).toBeGreaterThan(1000);
    expect(worstEl).toBeLessThan(0.003);
    expect(worstAz).toBeLessThan(0.003);
  });

  it('rise and set times through the elevation limits agree within 5 s', () => {
    let worstS = 0, crossings = 0;
    for (const set of fixture.sets.filter((s) => s.span === 'minute')) {
      const s = station(set.station);
      const sf = siteFrame(set.site.lat, set.site.lon, set.site.altKm * 1000);
      const st = stationFrame(s);
      const mine = (t: number) => linkGeometry(linkEpoch(t), sf, st).stationElDeg;
      for (const mask of [s.receiveMaskDeg, s.transmitMaskDeg]) {
        for (let i = 1; i < set.rows.length; i++) {
          const [t0, , e0] = set.rows[i - 1], [t1, , e1] = set.rows[i];
          if (t1 - t0 !== 60_000 || (e0 - mask) * (e1 - mask) > 0) continue;
          // Horizons: linear between two rows one minute apart (curvature moves this by well under 0.1 s).
          const tRef = t0 + ((mask - e0) / (e1 - e0)) * 60_000;
          // Ours: bisection on the same minute.
          let a = t0, b = t1;
          const rising = e1 > e0;
          for (let k = 0; k < 20; k++) {
            const m = (a + b) / 2;
            if ((mine(m) > mask) === rising) b = m;
            else a = m;
          }
          worstS = Math.max(worstS, Math.abs((a + b) / 2 - tRef) / 1000);
          crossings++;
        }
      }
    }
    console.log(`DSN rise/set through the 6.0 and 10.2/10.4 deg limits vs Horizons: ${crossings} crossings, worst difference ${worstS.toFixed(2)} s`);
    expect(crossings).toBeGreaterThanOrEqual(20);
    expect(worstS).toBeLessThan(5);
  });

  it('at the site, a station is found within Earth\'s disc and Earth\'s centre where skyAt puts it', () => {
    const site = { lat: -84.79, lon: 29.2 };
    for (const tIso of ['2025-03-06T17:28:00Z', '2025-03-13T06:00:00Z', '1971-07-31T12:00:00Z']) {
      const t = Date.parse(tIso);
      const sky = skyAt(site, 5321, t);
      // A "station" at Earth's centre must come out at Earth's own direction (the sky model is light-time
      // corrected, this geometry is not: they differ by well under 0.01 deg).
      const centre = linkGeometry(linkEpoch(t), siteFrame(site.lat, site.lon, 5321), stationFrame({ xyzM: [0, 0, 0], latDeg: 0, lonDeg: 0 }));
      expect(Math.abs(centre.siteElDeg - sky.earth.elDeg)).toBeLessThan(0.01);
      expect(Math.abs(((centre.siteAzDeg - sky.earth.azDeg + 540) % 360) - 180) * Math.cos(sky.earth.elDeg * RAD)).toBeLessThan(0.01);
      for (const g of dsnGeometryAt(site, 5321, t)) {
        const c = Math.sin(g.siteElDeg * RAD) * Math.sin(sky.earth.elDeg * RAD) + Math.cos(g.siteElDeg * RAD) * Math.cos(sky.earth.elDeg * RAD) * Math.cos((g.siteAzDeg - sky.earth.azDeg) * RAD);
        const sep = Math.acos(Math.min(1, c)) / RAD;
        expect(sep, `${g.station.id} lies on Earth's disc`).toBeLessThan(sky.earth.angularRadiusDeg + 0.01);
        expect(g.rangeKm).toBeGreaterThan(350_000);
        expect(g.rangeKm).toBeLessThan(415_000);
      }
    }
  });
});

const total = (l: Interval[]) => l.reduce((a, iv) => a + iv.endMs - iv.startMs, 0);
const pin = (lat: number, lon: number): SiteRef => ({ id: `pin:${lat},${lon}`, name: 'pin', kind: 'custom', lat, lon });
const scen = (site: SiteRef, start: string, durationH: number, stepMin = 10): Scenario => ({ id: `${site.id}|${start}`, label: site.name, site, mastHeightM: 2, startMs: Date.parse(start), durationH, stepMin });
const sphere = () => stackOf(fnSource('sphere', 60, () => 0));

describe('DSN opportunities over a window', () => {
  it('near side, smooth sphere, 28 days: each station part of the time, together almost always', () => {
    const sc = scen(pin(0, 0), '2025-03-01T00:00:00Z', 28 * 24);
    const d = dsnOpportunities(sc, computeHorizon(sphere(), sc.site, 2));
    for (const s of d.stations) {
      expect(s.receive.pct).toBeGreaterThan(35);
      expect(s.receive.pct).toBeLessThan(60);
      expect(s.transmit.pct).toBeLessThan(s.receive.pct); // a higher limit can only shorten a pass
      expect(s.receive.intervals.length).toBeGreaterThanOrEqual(26);
      expect(total(s.receive.intervals) + total(s.receive.gapIntervals)).toBeCloseTo(28 * 24 * H, -1);
      expect(s.stationElDeg.length).toBe(28 * 24 * 6 + 1);
      expect(Math.min(...s.siteClearanceDeg)).toBeGreaterThan(70); // Earth is near the zenith here
      // every transmit span lies inside a receive span
      for (const tx of s.transmit.intervals) expect(s.receive.intervals.some((rx) => rx.startMs <= tx.startMs && rx.endMs >= tx.endMs)).toBe(true);
    }
    expect(d.anyReceive.pct).toBeGreaterThan(98);
    expect(d.anyReceive.pct).toBeGreaterThanOrEqual(Math.max(...d.stations.map((s) => s.receive.pct)));
    expect(d.anyTransmit.pct).toBeLessThanOrEqual(d.anyReceive.pct);
    expect(d.assumptions.join(' ')).toMatch(/Geometry only/);
    expect(d.assumptions.join(' ')).toMatch(/810-005/);
  });

  it('far side: never', () => {
    const sc = scen(pin(0, 180), '2025-03-01T00:00:00Z', 7 * 24);
    const d = dsnOpportunities(sc, computeHorizon(sphere(), sc.site, 2));
    for (const s of d.stations) {
      expect(s.receive.pct).toBe(0);
      expect(s.receive.intervals).toEqual([]);
      expect(Math.max(...s.siteClearanceDeg)).toBeLessThan(-70);
    }
    expect(d.anyReceive.longestGapH).toBeCloseTo(7 * 24, 6);
    expect(d.anyReceive.gapOpenEnded).toBe(true);
  });

  it('a crater rim hides the stations although the Moon is up at them', () => {
    // Near side, inside a bowl whose rim stands about 17 deg high all round; Earth is about 12 deg up.
    const site = pin(0, 78);
    const bowl = radialSource('bowl', 20, site.lat, site.lon, (dd) => (dd < 5000 ? 1500 * (dd / 5000) ** 2 : 1500));
    const sc = scen(site, '2025-03-01T00:00:00Z', 3 * 24);
    const hp = computeHorizon(stackOf(bowl), site, 2);
    expect(Math.min(...hp.elevDeg)).toBeGreaterThan(15);
    const d = dsnOpportunities(sc, hp);
    for (const s of d.stations) {
      expect(Math.max(...s.stationElDeg)).toBeGreaterThan(20); // the Moon does rise at the station
      expect(Math.max(...s.siteClearanceDeg)).toBeLessThan(0); // but the rim is in the way
      expect(s.receive.pct).toBe(0);
    }
    // Without the bowl the same site has opportunities.
    const open = dsnOpportunities(sc, computeHorizon(sphere(), site, 2));
    expect(open.anyReceive.pct).toBeGreaterThan(90);
  });

  it('a window that ends between samples is covered to its end', () => {
    const sc = scen(pin(0, 0), '2025-03-01T00:00:00Z', 30.4, 60);
    const d = dsnOpportunities(sc, computeHorizon(sphere(), sc.site, 2));
    for (const s of d.stations) {
      expect(total(s.receive.intervals) + total(s.receive.gapIntervals)).toBeCloseTo(30.4 * H, -1);
      expect(s.stationElDeg.length).toBe(31);
    }
  });
});

describe('DSN opportunities with real terrain (part of analyse())', () => {
  it('IM-2, 14 days: Earth near the skyline, so the terrain and the station\'s place on Earth\'s disc matter', async () => {
    const site: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 };
    const a = await analyseStack(scen(site, '2025-03-06T17:28:00Z', 14 * 24), await loadTerrainFor(site));
    const d = a.dsn!;
    console.log(`IM-2 14 d, DSN geometry: ${d.stations.map((s) => `${s.station.id} receive ${s.receive.pct.toFixed(1)} % / transmit ${s.transmit.pct.toFixed(1)} % (${s.receive.intervals.length} passes; station above the lunar skyline by ${Math.min(...s.siteClearanceDeg).toFixed(2)}..${Math.max(...s.siteClearanceDeg).toFixed(2)} deg)`).join('; ')}; any station receive ${d.anyReceive.pct.toFixed(2)} % (longest gap ${d.anyReceive.longestGapH.toFixed(1)} h${d.anyReceive.gapOpenEnded ? ', open-ended' : ''}), transmit ${d.anyTransmit.pct.toFixed(2)} %; Earth-centre line of sight ${a.metrics.earthVisiblePct.toFixed(2)} %; first DSS-63 pass ${iso(d.stations[2].receive.intervals[0].startMs)} to ${iso(d.stations[2].receive.intervals[0].endMs)}`);
    expect(d.stations.length).toBe(3);
    // The union cannot exceed the time some part of Earth's disc is above the skyline, and is close to the centre's figure.
    expect(Math.abs(d.anyReceive.pct - a.metrics.earthVisiblePct)).toBeLessThan(3);
    for (const s of d.stations) {
      expect(s.receive.pct).toBeGreaterThan(25);
      expect(s.receive.pct).toBeLessThan(55);
      expect(s.stationElDeg.length).toBe(a.series.n);
      expect(s.siteClearanceDeg.length).toBe(a.series.n);
    }
    // From a south-polar site Earth's southern hemisphere is the upper part of the disc: Canberra stands higher.
    const mean = (x: Float32Array) => x.reduce((p, c) => p + c, 0) / x.length;
    expect(mean(d.stations[1].siteClearanceDeg)).toBeGreaterThan(mean(d.stations[0].siteClearanceDeg) + 0.5);
    expect(mean(d.stations[1].siteClearanceDeg)).toBeGreaterThan(mean(d.stations[2].siteClearanceDeg) + 0.5);
  });

  it('Blue Ghost Mission 1, 14 days: Earth high in the sky, so only the stations\' own horizons limit it', async () => {
    const site: SiteRef = { id: 'blue-ghost-1', name: 'Blue Ghost Mission 1', kind: 'landing', lat: 18.562, lon: 61.81 };
    const a = await analyseStack(scen(site, '2025-03-02T08:34:00Z', 14 * 24), await loadTerrainFor(site));
    const d = a.dsn!;
    console.log(`Blue Ghost 14 d, DSN geometry: ${d.stations.map((s) => `${s.station.id} receive ${s.receive.pct.toFixed(1)} % / transmit ${s.transmit.pct.toFixed(1)} %`).join('; ')}; any station receive ${d.anyReceive.pct.toFixed(2)} % (longest gap ${d.anyReceive.longestGapH.toFixed(2)} h), transmit ${d.anyTransmit.pct.toFixed(2)} % (longest gap ${d.anyTransmit.longestGapH.toFixed(2)} h)`);
    for (const s of d.stations) expect(Math.min(...s.siteClearanceDeg)).toBeGreaterThan(20);
    expect(d.anyReceive.pct).toBeGreaterThan(99);
    expect(d.anyTransmit.pct).toBeGreaterThan(95);
    // March 2025: the Moon ran far north and south (declination beyond 28 deg), which the northern stations feel.
    expect(d.stations[0].receive.pct).toBeGreaterThan(d.stations[1].receive.pct);
  });

  it('dsnAt: the stations at an instant agree with the spans of the window and say what is in the way', async () => {
    const site: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 };
    const a = await analyseStack(scen(site, '2025-03-06T17:28:00Z', 14 * 24), await loadTerrainFor(site));
    const inside = (list: Interval[], t: number) => list.some((iv) => t >= iv.startMs && t < iv.endMs);
    const seen = new Set<string>();
    for (let k = 0; k < 14 * 24; k += 5) {
      const t = a.scenario.startMs + k * H + 7 * 60_000;
      const now = dsnAt(a, t);
      expect(now.map((x) => x.station.id)).toEqual(['DSS-14', 'DSS-43', 'DSS-63']);
      now.forEach((x, i) => {
        const o = a.dsn!.stations[i];
        // Away from the refined edges (10 s) the instant answer and the spans must agree.
        const nearEdge = [...o.receive.intervals, ...o.transmit.intervals].some((iv) => Math.abs(iv.startMs - t) < 20_000 || Math.abs(iv.endMs - t) < 20_000);
        if (!nearEdge) {
          expect(x.receive).toBe(inside(o.receive.intervals, t));
          expect(x.transmit).toBe(inside(o.transmit.intervals, t));
        }
        expect(x.blockedBy === 'nothing').toBe(x.receive);
        if (x.blockedBy === 'station-horizon') expect(x.stationElDeg).toBeLessThanOrEqual(6);
        if (x.blockedBy === 'lunar-terrain') expect(x.siteClearanceDeg).toBeLessThanOrEqual(0);
        seen.add(x.blockedBy);
      });
    }
    // Over two weeks at this site every case occurs.
    expect([...seen].sort()).toEqual(['both', 'lunar-terrain', 'nothing', 'station-horizon']);
  });

  it('is absent when there is no terrain to build a skyline from', async () => {
    const site = pin(0, 0);
    const a = await analyseStack(scen(site, '2025-03-01T00:00:00Z', 24), stackOf(fnSource('none', 60, () => 0, () => false)));
    expect(a.dsn).toBeUndefined();
  });
});

describe('opportunity edges placed to 0.25 s (lunyx-science T-9)', () => {
  it('a synthetic elevation curve: each crossing of the limit within 0.25 s of the analytic instant', () => {
    // Elevation 12 sin(2 pi t / 24 h) deg through a 6.3 deg limit: up at 2.11 h, down at 9.89 h (between samples).
    const T = Date.UTC(2025, 2, 1), P = 24 * H, A = 12, limit = 6.3;
    const g = (t: number) => A * Math.sin((2 * Math.PI * (t - T)) / P) - limit;
    const step = 10 * 60_000, n = 24 * 6 + 1;
    const timeAt = (i: number) => T + i * step;
    const coarse = intervalsOf((i) => g(timeAt(i)) > 0, g, timeAt, n, T, T + P);
    const fine = refineEdges(coarse, g);
    const up = T + (P / (2 * Math.PI)) * Math.asin(limit / A), down = T + P / 2 - (up - T);
    expect(fine.crossings.map((c) => c.up)).toEqual([true, false]);
    expect(Math.abs(fine.crossings[0].t - up)).toBeLessThanOrEqual(DSN_EDGE_PRECISION_MS);
    expect(Math.abs(fine.crossings[1].t - down)).toBeLessThanOrEqual(DSN_EDGE_PRECISION_MS);
    // The window's own search stops at 10 s: its crossings are only known to within 5 s.
    expect(Math.max(Math.abs(coarse.crossings[0].t - up), Math.abs(coarse.crossings[1].t - down))).toBeLessThanOrEqual(EVENT_PRECISION_MS / 2);
    // The spans are rebuilt on the refined instants, with the same structure and open window edges.
    expect(fine.on).toEqual([{ startMs: fine.crossings[0].t, endMs: fine.crossings[1].t }]);
    expect(fine.off).toEqual([{ startMs: T, endMs: fine.crossings[0].t, openStart: true }, { startMs: fine.crossings[1].t, endMs: T + P, openEnd: true }]);
    // Asking for no more than the window's precision leaves the spans as they were.
    expect(refineEdges(coarse, g, EVENT_PRECISION_MS)).toBe(coarse);
  });

  it('real geometry, IM-2, 14 days: every edge within 0.25 s of the indicator\'s change of sign; what it costs', async () => {
    const site: SiteRef = { id: 'im-2', name: 'IM-2 Athena', kind: 'landing', lat: -84.79, lon: 29.2 };
    const a = await analyseStack(scen(site, '2025-03-06T17:28:00Z', 14 * 24), await loadTerrainFor(site));
    const d = a.dsn!, p = a.horizon;
    const h = p.siteElevationM + p.mastHeightM;
    // The opportunity indicator, as dsnOpportunities() builds it: positive while the line is open at both ends.
    const ind = (k: number, mask: number) => (t: number) => {
      const x = dsnGeometryAt(p.site, h, t)[k];
      return Math.min(x.stationElDeg - mask, x.siteElDeg - skylineAt(p, x.siteAzDeg));
    };
    const probe = DSN_EDGE_PRECISION_MS + 10;
    let edges = 0;
    d.stations.forEach((s, k) => {
      for (const [list, mask] of [[s.receive.intervals, s.station.receiveMaskDeg], [s.transmit.intervals, s.station.transmitMaskDeg]] as const) {
        const g = ind(k, mask);
        for (const iv of list) {
          if (!iv.openStart) {
            expect(g(iv.startMs - probe), `${s.station.id} opens ${iso(iv.startMs)}`).toBeLessThanOrEqual(0);
            expect(g(iv.startMs + probe)).toBeGreaterThan(0);
            edges++;
          }
          if (!iv.openEnd) {
            expect(g(iv.endMs - probe), `${s.station.id} closes ${iso(iv.endMs)}`).toBeGreaterThan(0);
            expect(g(iv.endMs + probe)).toBeLessThanOrEqual(0);
            edges++;
          }
        }
      }
    });
    const best = (options: { edgePrecisionMs?: number }) => {
      let ms = Infinity;
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now();
        dsnOpportunities(a.scenario, p, DSN_STATIONS, options);
        ms = Math.min(ms, performance.now() - t0);
      }
      return ms;
    };
    const coarseMs = best({ edgePrecisionMs: EVENT_PRECISION_MS }), fineMs = best({});
    console.log(`IM-2 14 d: ${edges} station edges, each within ${DSN_EDGE_PRECISION_MS / 1000} s of the indicator's change of sign; dsnOpportunities() ${coarseMs.toFixed(1)} ms with edges at the window's 10 s, ${fineMs.toFixed(1)} ms placed to 0.25 s (best of 3; load average ${loadavg()[0].toFixed(2)})`);
    expect(edges).toBeGreaterThan(20);
  });
});
