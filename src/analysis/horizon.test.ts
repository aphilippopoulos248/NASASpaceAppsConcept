import { describe, expect, it } from 'vitest';
import { computeHorizon, destination, skylineAt, slopeAt } from './horizon';
import { fnSource, radialSource, readSiteTerrain, stackOf } from './testing';

const R = 1_737_400;
const RAD = Math.PI / 180;
const flat = (h = 0) => stackOf(fnSource('sphere', 60, () => h));
const maxAbsDiff = (a: Float32Array, v: number) => a.reduce((m, x) => Math.max(m, Math.abs(x - v)), 0);

describe('computeHorizon on a smooth sphere', () => {
  for (const mast of [2, 10, 100]) {
    it(`mast ${mast} m: skyline = -acos(R/(R+h)) at every azimuth`, () => {
      const p = computeHorizon(flat(), { lat: 10, lon: 20 }, mast);
      const expected = -Math.acos(R / (R + mast)) / RAD;
      expect(p.elevDeg.length).toBe(720);
      expect(maxAbsDiff(p.elevDeg, expected)).toBeLessThan(0.002);
      expect(p.smoothDipDeg).toBeCloseTo(expected, 10);
      // Tangent distance sqrt(2Rh)
      const dExp = Math.sqrt(2 * R * mast);
      expect(Math.abs(p.distM[0] - dExp) / dExp).toBeLessThan(0.15);
    });
  }
  it('mast 0 on a sphere: skyline at 0 deg (grazing)', () => {
    const p = computeHorizon(flat(-500), { lat: -30, lon: 100 }, 0);
    expect(maxAbsDiff(p.elevDeg, 0)).toBeLessThan(0.01);
    expect(p.siteElevationM).toBe(-500);
  });
  it('works at both poles and across the antimeridian', () => {
    for (const site of [{ lat: 90, lon: 0 }, { lat: -90, lon: 45 }, { lat: 0, lon: 180 }, { lat: 5, lon: -179.999 }]) {
      const p = computeHorizon(flat(), site, 10);
      expect(maxAbsDiff(p.elevDeg, -Math.acos(R / (R + 10)) / RAD)).toBeLessThan(0.002);
    }
  });
  it('returns NaN with a warning when no data covers the site', () => {
    const p = computeHorizon(stackOf(fnSource('none', 60, () => 0, () => false)), { lat: 0, lon: 0 }, 2);
    expect(Number.isNaN(p.elevDeg[0])).toBe(true);
    expect(p.warnings[0]).toMatch(/No elevation data/);
  });
});

/** Exact elevation of a point at ground distance d, height h, from observer height h0. */
const elevOf = (d: number, h: number, h0: number) => {
  const th = d / R;
  return Math.atan2((R + h) * Math.cos(th) - (R + h0), (R + h) * Math.sin(th)) / RAD;
};

describe('computeHorizon with analytic relief', () => {
  it('a ridge 20 km away, 1500 m high, all round (ring) gives its exact angle', () => {
    const ring = radialSource('ring', 30, 0, 0, (d) => 1500 * Math.exp(-(((d - 20_000) / 600) ** 2)));
    const p = computeHorizon(stackOf(ring), { lat: 0, lon: 0 }, 2);
    const exp = elevOf(20_000, 1500, 2);
    expect(maxAbsDiff(p.elevDeg, exp)).toBeLessThan(0.02);
    expect(Math.abs(p.distM[100] - 20_000)).toBeLessThan(200);
    expect(Math.abs(p.heightM[100] - 1500)).toBeLessThan(5);
  });
  it('a ridge only to the east raises only the eastern skyline', () => {
    const site = { lat: 20, lon: 30 };
    const peak = destination(site, 90, 15_000);
    const src = fnSource('ridge', 30, (lat, lon) => {
      // ridge line running north-south through `peak`: height by east-west distance
      const dx = (lon - peak.lon) * RAD * R * Math.cos(lat * RAD);
      return 2000 * Math.exp(-((dx / 800) ** 2));
    });
    const p = computeHorizon(stackOf(src), site, 2);
    expect(skylineAt(p, 90)).toBeCloseTo(elevOf(15_000, 2000, 2), 1);
    expect(skylineAt(p, 270)).toBeLessThan(0);
  });
  it('bowl crater floor: rim at radius a, height H above the floor, seen from the centre', () => {
    const a = 5000, H = 800;
    const bowl = radialSource('bowl', 20, -60, 10, (d) => (d < a ? H * (d / a) ** 2 : H * Math.exp(-(((d - a) / 3000) ** 2))));
    const p = computeHorizon(stackOf(bowl), { lat: -60, lon: 10 }, 1);
    expect(maxAbsDiff(p.elevDeg, elevOf(a, H, 1))).toBeLessThan(0.05);
  });
  it('a taller mast lowers the near skyline and raises nothing above the ridge', () => {
    const ring = radialSource('ring', 30, 0, 0, (d) => 300 * Math.exp(-(((d - 10_000) / 400) ** 2)));
    const lo = computeHorizon(stackOf(ring), { lat: 0, lon: 0 }, 2);
    const hi = computeHorizon(stackOf(ring), { lat: 0, lon: 0 }, 100);
    expect(hi.elevDeg[0]).toBeLessThan(lo.elevDeg[0]);
    expect(hi.elevDeg[0]).toBeCloseTo(elevOf(10_000, 300, 100), 1);
  });
  it('mast height reveals the far horizon on a smooth sphere: the visible distance grows as sqrt(2Rh)', () => {
    const p1 = computeHorizon(flat(), { lat: 0, lon: 0 }, 10);
    const p2 = computeHorizon(flat(), { lat: 0, lon: 0 }, 40);
    expect(p2.distM[0] / p1.distM[0]).toBeCloseTo(2, 0);
  });
  it('uses the finest source near the site and records the layers by range', () => {
    const fine = fnSource('fine', 5, () => 0, (lat, lon) => Math.hypot(lat, lon) < 0.05);
    const coarse = fnSource('coarse', 500, () => 0);
    const p = computeHorizon(stackOf(fine, coarse), { lat: 0, lon: 0 }, 0, { maxRangeM: 50_000 });
    expect(p.layers.map((l) => l.name)).toEqual(['fine', 'coarse']);
    expect(p.layers[0].toM).toBeLessThan(1600);
    expect(p.layers[1].fromM).toBeGreaterThan(1400);
  });
  it('warns when only kilometre-scale data covers the near field', () => {
    const p = computeHorizon(stackOf(fnSource('global', 1900, () => 0)), { lat: 0, lon: 0 }, 2);
    expect(p.warnings.join(' ')).toMatch(/Only 1900 m elevation data within 30 km/);
  });
});

describe('slopeAt', () => {
  it('measures a 10 degree plane tilted down to the east', () => {
    const site = { lat: 0, lon: 0 };
    const src = fnSource('plane', 20, (_lat, lon) => -Math.tan(10 * RAD) * lon * RAD * R);
    const s = slopeAt(stackOf(src), site, 100);
    expect(s.slopeDeg).toBeCloseTo(10, 2);
    expect(s.aspectDeg).toBeCloseTo(90, 1);
    expect(s.baselineM).toBe(100);
    expect(s.demName).toMatch(/plane, 20 m/);
  });
  it('flat ground: slope 0, aspect undefined (NaN)', () => {
    const s = slopeAt(flat(), { lat: 45, lon: 45 }, 120);
    expect(s.slopeDeg).toBeCloseTo(0, 6);
    expect(Number.isNaN(s.aspectDeg)).toBe(true);
  });
  it('NaN without data', () => {
    expect(Number.isNaN(slopeAt(stackOf(fnSource('none', 60, () => 0, () => false)), { lat: 0, lon: 0 }, 120).slopeDeg)).toBe(true);
  });
});

describe('real terrain: Apollo 15 site window (public/terrain/apollo-15*.bin: LROC NAC 3 m, SLDEM2015 60 m and 480 m)', () => {
  // Published: "Two major Apennine massifs tower over the Hadley plain to heights of 4.5 and 3.5 km.
  // These are Mt. Hadley to the northeast and Hadley Delta just south of the landing site"
  // (NASA SP-289, Apollo 15 Preliminary Science Report, p. 5-4). LROC (lroc.im-ldi.com/images/783):
  // Mons Hadley ~4 km, Hadley Delta ~3.5 km; NASA SVS 4918: Mons Hadley 4.1 km above the plain.
  // Gazetteer feature centres: Mons Hadley 26.68N 4.12E (about 21 km at bearing ~38 deg from the LM),
  // Hadley Delta 25.72N 3.71E (about 12.7 km at ~170 deg).
  const sector = (p: ReturnType<typeof computeHorizon>, a: number, b: number) => {
    let bi = Math.round(a / p.azStepDeg);
    for (let i = bi; i <= Math.round(b / p.azStepDeg); i++) if (p.elevDeg[i] > p.elevDeg[bi]) bi = i;
    return { el: p.elevDeg[bi], az: bi * p.azStepDeg, d: p.distM[bi], rise: p.heightM[bi] - p.siteElevationM };
  };
  it('Mons Hadley (NE) and Hadley Delta (S) stand where the published heights and positions put them; < 1 s', async () => {
    const st = await readSiteTerrain('apollo-15');
    const t0 = performance.now();
    const p = computeHorizon(st, st, 2);
    const ms = performance.now() - t0;
    const ne = sector(p, 20, 60), s = sector(p, 150, 210);
    console.log(`apollo-15: ${ms.toFixed(0)} ms; Mons Hadley sector ${JSON.stringify(ne)}; Hadley Delta sector ${JSON.stringify(s)}`);
    expect(ms).toBeLessThan(1000);
    // Mons Hadley: 4.0-4.5 km above the plain, ~20 km away, NE.
    expect(ne.rise).toBeGreaterThan(3600);
    expect(ne.rise).toBeLessThan(4700);
    expect(ne.d).toBeGreaterThan(15_000);
    expect(ne.d).toBeLessThan(25_000);
    expect(ne.az).toBeGreaterThan(30);
    expect(ne.az).toBeLessThan(55);
    // Its elevation angle is what the exact formula gives for that terrain.
    expect(ne.el).toBeCloseTo(elevOf(ne.d, p.heightM[Math.round(ne.az / p.azStepDeg)], p.siteElevationM + 2), 3);
    expect(ne.el).toBeGreaterThan(10);
    expect(ne.el).toBeLessThan(12.5);
    // Hadley Delta: the skyline to the south is its north face, about 10-13 km away, 11-16 deg high.
    expect(s.d).toBeGreaterThan(8000);
    expect(s.d).toBeLessThan(14_000);
    expect(s.el).toBeGreaterThan(11);
    expect(s.el).toBeLessThan(16);
    // West, over the mare and Hadley Rille: low skyline.
    expect(sector(p, 240, 300).el).toBeLessThan(4);
  });
});
