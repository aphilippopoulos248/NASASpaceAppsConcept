/// <reference types="node" />
// skyAt() against the INDEPENDENT Horizons fixture built by @ephemeris-check (task T-18):
// tests/fixtures/horizons/ephemeris-check/ (1008 instants, 12 sites, 1969-2035; cross-checked
// there against an offline SPICE computation to 0.000002 deg). The tolerances are the fixture's
// own (index.json -> tolerance), not chosen here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBundledTable, horizonsEphemeris, setBundleReader, skyAt } from './sky';

const DIR = join(process.cwd(), 'tests', 'fixtures', 'horizons', 'ephemeris-check');
const RAD = Math.PI / 180;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const arc = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const c = Math.sin(a.lat * RAD) * Math.sin(b.lat * RAD) + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((a.lon - b.lon) * RAD);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
};

interface Body { az: number; el: number; angDiamArcsec: number; rangeKm: number; illumPct?: number }
interface Row { utc: string; sun: Body; earth: Body; subEarth: { lat: number; lon: number }; subSolar: { lat: number; lon: number } }
interface SetFile { id: string; site: { lat: number; lon: number; altKm: number }; rows: Row[] }
interface Index {
  rows: number;
  sets: { id: string; file: string }[];
  tolerance: {
    topocentricModel: { elDeg: number; azArcDeg: number };
    angularDiameter: { relative: number };
    range: { relative: number };
    illumPct: { absolute: number };
    subPoints: { arcDeg: number };
  };
}

describe.skipIf(!existsSync(join(DIR, 'index.json')))('skyAt vs the independent Horizons fixture (tests/fixtures/horizons/ephemeris-check)', () => {
  const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')) as Index;
  const tol = index.tolerance;

  it('every row of every set is inside the fixture\'s tolerances', () => {
    const worst = { sunEl: 0, sunAz: 0, earthEl: 0, earthAz: 0, sunDiam: 0, earthDiam: 0, sunRange: 0, earthRange: 0, lit: 0, subEarth: 0, subSolar: 0 };
    const up = (k: keyof typeof worst, v: number) => { if (v > worst[k]) worst[k] = v; };
    let rows = 0;
    const failures: string[] = [];
    for (const entry of index.sets) {
      const set = JSON.parse(readFileSync(join(DIR, entry.file), 'utf8')) as SetFile;
      for (const row of set.rows) {
        rows++;
        const sky = skyAt({ lat: set.site.lat, lon: set.site.lon }, set.site.altKm * 1000, Date.parse(row.utc));
        expect(sky.source).toBe('model');
        for (const body of ['sun', 'earth'] as const) {
          const ref = row[body], got = sky[body];
          const dEl = Math.abs(got.elDeg - ref.el);
          const dAz = Math.abs(wrap180(got.azDeg - ref.az)) * Math.cos(ref.el * RAD);
          const dDiam = Math.abs(got.angularRadiusDeg - ref.angDiamArcsec / 7200) / (ref.angDiamArcsec / 7200);
          const dRange = Math.abs(got.distanceKm - ref.rangeKm) / ref.rangeKm;
          up(`${body}El`, dEl); up(`${body}Az`, dAz); up(`${body}Diam`, dDiam); up(`${body}Range`, dRange);
          if (dEl > tol.topocentricModel.elDeg || dAz > tol.topocentricModel.azArcDeg || dDiam > tol.angularDiameter.relative || dRange > tol.range.relative) {
            failures.push(`${set.id} ${row.utc} ${body}: dEl ${dEl.toFixed(5)} dAzArc ${dAz.toFixed(5)} dDiam ${dDiam.toExponential(2)} dRange ${dRange.toExponential(2)}`);
          }
        }
        const dLit = Math.abs(sky.earthLitFraction * 100 - (row.earth.illumPct as number));
        const dSubE = arc(sky.subEarth, row.subEarth), dSubS = arc(sky.subSolar, row.subSolar);
        up('lit', dLit); up('subEarth', dSubE); up('subSolar', dSubS);
        if (dLit > tol.illumPct.absolute || dSubE > tol.subPoints.arcDeg || dSubS > tol.subPoints.arcDeg) {
          failures.push(`${set.id} ${row.utc}: lit ${dLit.toFixed(4)} subEarth ${dSubE.toFixed(5)} subSolar ${dSubS.toFixed(5)}`);
        }
      }
    }
    console.log(
      `independent fixture, ${rows} rows: worst Sun el ${worst.sunEl.toFixed(4)} / az arc ${worst.sunAz.toFixed(4)} deg; Earth el ${worst.earthEl.toFixed(4)} / az arc ${worst.earthAz.toFixed(4)} deg ` +
      `(limit ${tol.topocentricModel.elDeg}); angular radius ${worst.sunDiam.toExponential(2)} / ${worst.earthDiam.toExponential(2)} (limit ${tol.angularDiameter.relative}); ` +
      `distance ${worst.sunRange.toExponential(2)} / ${worst.earthRange.toExponential(2)} (limit ${tol.range.relative}); Earth lit ${worst.lit.toFixed(4)} points (limit ${tol.illumPct.absolute}); ` +
      `subEarth ${worst.subEarth.toFixed(4)}, subSolar ${worst.subSolar.toFixed(4)} deg (limit ${tol.subPoints.arcDeg})`,
    );
    expect(rows).toBe(index.rows);
    expect(failures, failures.slice(0, 10).join('\n')).toEqual([]);
  });

  // The bundled Horizons tables (public/data/horizons/, fetched by scripts/build-horizons-bundle.mjs)
  // against the fixture's rows for the same site, height and instants: two separate downloads
  // of the same Horizons quantity must agree to the table's rounding (1e-4 deg).
  it.each([
    ['blue-ghost-1.surface-2025-03', 352],
    ['blue-ghost-1.eclipse-2025-03-14', 49],
    ['im-2.surface-2025-03', 247],
  ])('bundled Horizons table reproduces the fixture set %s', async (setId, count) => {
    setBundleReader(async (p) => readFileSync(join(process.cwd(), 'public', p), 'utf8'));
    const entry = index.sets.find((s) => s.id === setId)!;
    const set = JSON.parse(readFileSync(join(DIR, entry.file), 'utf8')) as SetFile;
    expect(set.rows.length).toBe(count);
    const t0 = Date.parse(set.rows[0].utc), t1 = Date.parse(set.rows[set.rows.length - 1].utc);
    const table = await findBundledTable(set.site, t0, t1);
    expect(table, 'a bundled table covers this set').not.toBeNull();
    expect(table!.site.heightM).toBeCloseTo(set.site.altKm * 1000, 6);
    const eph = horizonsEphemeris(table!, set.site, set.site.altKm * 1000);
    const o = new Float64Array(6);
    let worst = 0, worstR = 0;
    for (const row of set.rows) {
      eph.at(Date.parse(row.utc), o);
      worst = Math.max(
        worst,
        Math.abs(o[1] - row.sun.el), Math.abs(wrap180(o[0] - row.sun.az)) * Math.cos(row.sun.el * RAD),
        Math.abs(o[3] - row.earth.el), Math.abs(wrap180(o[2] - row.earth.az)) * Math.cos(row.earth.el * RAD),
      );
      worstR = Math.max(worstR, Math.abs(o[4] - row.sun.angDiamArcsec / 7200), Math.abs(o[5] - row.earth.angDiamArcsec / 7200));
    }
    console.log(`${setId}: bundled table vs fixture, worst az/el difference ${worst.toExponential(2)} deg, worst angular radius difference ${worstR.toExponential(2)} deg`);
    expect(worst).toBeLessThan(2e-4);
    expect(worstR).toBeLessThan(2e-5);
  });
});
