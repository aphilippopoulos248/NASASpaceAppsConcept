import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBundledTable, horizonsEphemeris, modelEphemeris, setBundleReader, skyAt, type HorizonsTable } from './sky';

const RAD = Math.PI / 180;
const sep = (az1: number, el1: number, az2: number, el2: number) => {
  const c = Math.sin(el1 * RAD) * Math.sin(el2 * RAD) + Math.cos(el1 * RAD) * Math.cos(el2 * RAD) * Math.cos((az1 - az2) * RAD);
  return Math.acos(Math.min(1, c)) / RAD;
};
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

/** Tolerance for agreement with JPL Horizons (degrees). Target from the brief: 0.05 deg. Measured worst case is about 0.0034 deg. */
const TOL_DEG = 0.01;

setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));

interface Row { site: string; lat: number; lon: number; heightM: number; utc: string; sun: { az: number; el: number; distKm: number }; earth: { az: number; el: number; distKm: number } }
const check = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'horizons-topo-check.json'), 'utf8')) as { rows: Row[] };

describe('skyAt vs JPL Horizons (topocentric, airless), own reference set', () => {
  const worst = { sun: 0, earth: 0, sunEl: 0, earthEl: 0 };
  it(`agrees within ${TOL_DEG} deg for ${check.rows.length} site/date pairs 1969-2035`, () => {
    for (const r of check.rows) {
      const s = skyAt({ lat: r.lat, lon: r.lon }, r.heightM, Date.parse(r.utc));
      for (const body of ['sun', 'earth'] as const) {
        const ref = r[body];
        const e = sep(s[body].azDeg, s[body].elDeg, ref.az, ref.el);
        worst[body] = Math.max(worst[body], e);
        worst[body === 'sun' ? 'sunEl' : 'earthEl'] = Math.max(worst[body === 'sun' ? 'sunEl' : 'earthEl'], Math.abs(s[body].elDeg - ref.el));
        expect(e, `${r.site} ${r.utc} ${body}`).toBeLessThan(TOL_DEG);
      }
      expect(Math.abs(s.earth.distanceKm - r.earth.distKm)).toBeLessThan(30);
      expect(Math.abs(s.sun.distanceKm - r.sun.distKm) / r.sun.distKm).toBeLessThan(2e-5);
    }
    console.log(`worst angular error vs Horizons: sun ${(worst.sun * 3600).toFixed(1)}", earth ${(worst.earth * 3600).toFixed(1)}"; elevation only: sun ${(worst.sunEl * 3600).toFixed(1)}", earth ${(worst.earthEl * 3600).toFixed(1)}"`);
  });

  it('pole azimuth convention (north = limit along the site meridian) matches Horizons at exactly +-90', () => {
    const rows = check.rows.filter((x) => Math.abs(x.lat) === 90);
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) {
      const s = skyAt({ lat: r.lat, lon: r.lon }, r.heightM, Date.parse(r.utc));
      expect(azDiff(s.sun.azDeg, r.sun.az)).toBeLessThan(0.01);
      expect(azDiff(s.earth.azDeg, r.earth.az)).toBeLessThan(0.01);
    }
  });
});

describe('skyAt behaviour', () => {
  const t = Date.parse('2025-03-06T17:28:00Z');
  it('returns topocentric quantities with sizes and phase', () => {
    const s = skyAt({ lat: 0, lon: 0 }, 0, t);
    expect(s.source).toBe('model');
    expect(s.sun.angularRadiusDeg).toBeGreaterThan(0.26);
    expect(s.sun.angularRadiusDeg).toBeLessThan(0.275);
    expect(s.earth.angularRadiusDeg).toBeGreaterThan(0.88);
    expect(s.earth.angularRadiusDeg).toBeLessThan(1.0);
    expect(s.earthLitFraction).toBeGreaterThanOrEqual(0);
    expect(s.earthLitFraction).toBeLessThanOrEqual(1);
    // Near-side centre: Earth high in the sky.
    expect(s.earth.elDeg).toBeGreaterThan(75);
  });
  it('Earth parallax: sites 90 deg apart see Earth displaced by up to ~0.26 deg relative to the Moon-centre direction', () => {
    const a = skyAt({ lat: 0, lon: 0 }, 0, t), b = skyAt({ lat: 0, lon: 89 }, 0, t);
    // elevation at the limb site differs from the geocentric-direction value by the parallax term
    const geoEl = Math.asin(Math.cos(b.subEarth.lat * RAD) * Math.cos((b.subEarth.lon - 89) * RAD)) / RAD;
    expect(Math.abs(b.earth.elDeg - geoEl)).toBeGreaterThan(0.2);
    expect(Math.abs(b.earth.elDeg - geoEl)).toBeLessThan(0.27);
    expect(a.subEarth.lat).toBeCloseTo(b.subEarth.lat, 9);
  });
  it('far side: Earth never rises over a month', () => {
    let maxEl = -90;
    for (let k = 0; k < 30 * 24; k += 6) maxEl = Math.max(maxEl, skyAt({ lat: 0, lon: 180 }, 0, t + k * 3600e3).earth.elDeg);
    expect(maxEl).toBeLessThan(-75);
  });
  it('limb: libration carries Earth across the horizon at 89 E within a month', () => {
    let lo = 90, hi = -90;
    for (let k = 0; k < 30 * 24; k += 3) {
      const e = skyAt({ lat: 0, lon: 89 }, 0, t + k * 3600e3).earth.elDeg;
      lo = Math.min(lo, e); hi = Math.max(hi, e);
    }
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
  it('antimeridian: lon 180 and -180 agree', () => {
    const a = skyAt({ lat: 10, lon: 180 }, 0, t), b = skyAt({ lat: 10, lon: -180 }, 0, t);
    expect(sep(a.sun.azDeg, a.sun.elDeg, b.sun.azDeg, b.sun.elDeg)).toBeLessThan(1e-9);
  });
  it('poles: azimuth continuous approaching the pole along the meridian', () => {
    const a = skyAt({ lat: -90, lon: 30 }, 0, t), b = skyAt({ lat: -89.9999, lon: 30 }, 0, t);
    expect(azDiff(a.sun.azDeg, b.sun.azDeg)).toBeLessThan(0.01);
    expect(a.sun.elDeg).toBeCloseTo(b.sun.elDeg, 3);
  });
  it('time range: works 1900-2100 and rejects invalid input', () => {
    expect(Number.isFinite(skyAt({ lat: 0, lon: 0 }, 0, Date.parse('1900-01-01T00:00:00Z')).sun.elDeg)).toBe(true);
    expect(Number.isFinite(skyAt({ lat: 0, lon: 0 }, 0, Date.parse('2100-01-01T00:00:00Z')).sun.elDeg)).toBe(true);
    expect(() => skyAt({ lat: 0, lon: 0 }, 0, NaN)).toThrow(RangeError);
    expect(() => skyAt({ lat: 91, lon: 0 }, 0, t)).toThrow(RangeError);
  });
});

describe('bundled Horizons windows', () => {
  for (const [id, lat, lon, start, end] of [
    ['blue-ghost-1', 18.562, 61.81, '2025-03-02T08:30:00Z', '2025-03-16T08:00:00Z'],
    ['im-2', -84.79, 29.2, '2025-03-06T17:28:00Z', '2025-03-20T17:00:00Z'],
  ] as const) {
    it(`${id}: found for a scenario inside the window, and the model agrees with every row`, async () => {
      const table = (await findBundledTable({ lat, lon }, Date.parse(start), Date.parse(end))) as HorizonsTable;
      expect(table).not.toBeNull();
      expect(table.n).toBeGreaterThan(2000);
      let worst = 0;
      for (let i = 0; i < table.n; i += 1) {
        const tm = table.startMs + i * table.stepMs;
        const s = skyAt(table.site, table.site.heightM, tm);
        worst = Math.max(worst, sep(s.sun.azDeg, s.sun.elDeg, table.sun.az[i], table.sun.el[i]), sep(s.earth.azDeg, s.earth.elDeg, table.earth.az[i], table.earth.el[i]));
      }
      console.log(`${id}: worst model-vs-Horizons over ${table.n} rows: ${(worst * 3600).toFixed(1)}"`);
      expect(worst).toBeLessThan(TOL_DEG);
      // Interpolated table between rows stays close to the model.
      const eph = horizonsEphemeris(table, table.site, table.site.heightM);
      const m = modelEphemeris(table.site, table.site.heightM);
      const o1 = new Float64Array(4), o2 = new Float64Array(4);
      const tm = table.startMs + 1000.5 * table.stepMs;
      eph.at(tm, o1); m.at(tm, o2);
      expect(sep(o1[0], o1[1], o2[0], o2[1])).toBeLessThan(TOL_DEG);
      expect(eph.instant(tm).source).toBe('horizons');
      expect(() => eph.at(table.startMs - 1, o1)).toThrow(RangeError);
    });
  }
  it('not used outside the window or away from the site', async () => {
    expect(await findBundledTable({ lat: 18.562, lon: 61.81 }, Date.parse('2025-04-01T00:00:00Z'), Date.parse('2025-04-02T00:00:00Z'))).toBeNull();
    expect(await findBundledTable({ lat: 18.6, lon: 61.81 }, Date.parse('2025-03-03T00:00:00Z'), Date.parse('2025-03-04T00:00:00Z'))).toBeNull();
  });
});
