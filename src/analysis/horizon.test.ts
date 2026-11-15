/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeHorizon, destination, sampleStack, skylineAt, slopeAt } from './horizon';
import { loadTerrainFor } from '../terrain/api';
import type { SiteRef } from '../core/types';
import type { TerrainStack } from '../terrain/types';
import { fnSource, radialSource, stackOf } from './testing';

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

describe('the skyline does not depend on the marching step', () => {
  it('a narrow ridge between two marching samples is found at its crest', () => {
    // A ring ridge 500 m high and about 190 m wide (FWHM) at 20.03 km, on 100 m data. With steps of 1 % of
    // the distance the march advances 200 m per sample out there, so no sample needs to land on the crest.
    const ridge = radialSource('narrow ridge', 100, 0, 0, (d) => 500 * Math.exp(-(((d - 20_030) / 80) ** 2)));
    const exact = elevOf(20_030, 500, 2);
    const coarse = computeHorizon(stackOf(ridge), { lat: 0, lon: 0 }, 2, { azStepDeg: 5, growth: 0.01, refine: false });
    const fine = computeHorizon(stackOf(ridge), { lat: 0, lon: 0 }, 2, { azStepDeg: 5, growth: 0.01 });
    const worst = (p: typeof fine) => p.elevDeg.reduce((m, v) => Math.max(m, Math.abs(v - exact)), 0);
    expect(worst(coarse)).toBeGreaterThan(0.3); // the plain march misses most of the ridge
    expect(worst(fine)).toBeLessThan(0.05);
    expect(Math.abs(fine.distM[3] - 20_030)).toBeLessThan(30);
    expect(fine.heightM[3]).toBeGreaterThan(480);
  });

  it.each([
    ['im-2', 'landing', -84.79, 29.2],
    ['apollo-15', 'landing', 26.13239, 3.6333],
    ['pin: Shackleton rim', 'custom', -89.45, -137.2],
    ['pin: Malapert massif', 'custom', -86.0, 2.9],
  ] as const)('%s: default settings agree with a march twenty times finer', async (id, kind, lat, lon) => {
    const site = { id, name: id, kind, lat, lon };
    const st = await loadTerrainFor(site, { remote: false });
    // Reference: steps of 0.035 of a grid cell, 0.1 % of distance far out and 1 % close in, searched between them as well.
    const ref = computeHorizon(st, site, 2, { azStepDeg: 2, resFraction: 0.035, growth: 0.001, nearFraction: 0.01 });
    const def = computeHorizon(st, site, 2, { azStepDeg: 2 });
    // The plain march: the highest of its samples, a grid step apart from the start.
    const plain = computeHorizon(st, site, 2, { azStepDeg: 2, refine: false, nearFraction: Infinity });
    const scan = computeHorizon(st, site, 2, { azStepDeg: 2, growth: 0.01, nearFraction: 0.1, searchPoints: 3 });
    const stat = (p: typeof ref) => {
      let max = 0, sum2 = 0;
      for (let i = 0; i < p.elevDeg.length; i++) {
        const dv = p.elevDeg[i] - ref.elevDeg[i];
        max = Math.max(max, Math.abs(dv));
        sum2 += dv * dv;
      }
      return { max, rms: Math.sqrt(sum2 / p.elevDeg.length) };
    };
    const a = stat(def), b = stat(plain), c = stat(scan);
    console.log(`${id}: against a 20x finer march, default ${a.max.toFixed(3)} deg max / ${a.rms.toFixed(4)} rms; scan settings ${c.max.toFixed(3)} / ${c.rms.toFixed(4)}; without the fine search ${b.max.toFixed(3)} / ${b.rms.toFixed(4)}`);
    expect(a.max).toBeLessThan(0.01);
    expect(a.rms).toBeLessThan(0.002);
    expect(c.max).toBeLessThan(0.04);
    expect(c.rms).toBeLessThan(0.008);
    expect(a.rms).toBeLessThan(b.rms);
  }, 120_000);
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

describe('real terrain: Apollo 15 (loadTerrainFor: LROC NAC 3 m window, SLDEM2015 60 m and 480 m windows, LOLA 16 px/deg beyond)', () => {
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
  it('Mons Hadley (NE) and Hadley Delta (S) stand where the published heights and positions put them', async () => {
    const site = { id: 'apollo-15', name: 'Apollo 15', kind: 'landing' as const, lat: 26.13239, lon: 3.6333 };
    const st = await loadTerrainFor(site);
    computeHorizon(st, site, 2); // warm-up, so the timing below is of the march itself
    const t0 = performance.now();
    const p = computeHorizon(st, site, 2);
    const ms = performance.now() - t0;
    const ne = sector(p, 20, 60), s = sector(p, 150, 210);
    console.log(`apollo-15: full profile ${ms.toFixed(0)} ms; Mons Hadley sector ${JSON.stringify(ne)}; Hadley Delta sector ${JSON.stringify(s)}; layers ${p.layers.map((l) => `${Math.round(l.resolutionM)} m: ${(l.fromM / 1000).toFixed(1)}-${(l.toM / 1000).toFixed(1)} km`).join(', ')}`);
    expect(p.siteElevationM).toBeGreaterThan(-1940);
    expect(p.siteElevationM).toBeLessThan(-1915);
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
    // The whole-Moon grid takes over beyond the site windows and the search ends well short of the 400 km cap.
    expect(p.layers.length).toBe(4);
    expect(p.maxRangeM).toBeGreaterThan(100_000);
    expect(p.maxRangeM).toBeLessThan(400_000);
  });
});

// ---------- observer on or near the ground (T-31, from the independent validation T-26) ----------

/**
 * The skyline along one azimuth by brute force: every point of the ray out to `maxD`, a few
 * centimetres apart near the observer, through HeightSource.sample() only. Slow and simple: a
 * check on the marching and its fine search, not on the terrain data.
 */
function bruteSkyline(stack: TerrainStack, site: { lat: number; lon: number }, mast: number, azDeg: number, maxD: number): number {
  const h0 = sampleStack(stack, site.lat, site.lon).h + mast;
  let best = -Infinity;
  for (let d = 0.02; d <= maxD; d += Math.max(0.02, 0.002 * d)) {
    const p = destination(site, azDeg, d);
    const h = sampleStack(stack, p.lat, p.lon).h;
    if (!Number.isFinite(h)) continue;
    const th = d / R;
    const t = ((R + h) * Math.cos(th) - (R + h0)) / ((R + h) * Math.sin(th));
    if (t > best) best = t;
  }
  return Math.atan(best) / RAD;
}

describe('observer on or near the ground: synthetic convex and concave ground', () => {
  // A dome, h = A - k r^2 out to 150 m from its top, on a plain 90 m below the top. The observer
  // stands on its flank, 30 m west of the top: the ground rises towards the east at 13.5 deg.
  const K = 0.004, R0 = 30, A = 500, EDGE = 150;
  const site = { lat: 0, lon: 0 };
  const top = destination(site, 90, R0);
  const dome = stackOf(radialSource('dome', 40, top.lat, top.lon, (r) => A - K * Math.min(r, EDGE) ** 2));
  /** Along azimuth az: tan(elevation) = 2 K R0 sin(az) - (K + 1/2R) d - H / d, largest at d = sqrt(H / (K + 1/2R)). */
  const expected = (azDeg: number, mast: number) => {
    const k = K + 1 / (2 * R);
    const near = Math.atan(2 * K * R0 * Math.sin(azDeg * RAD) - 2 * Math.sqrt(mast * k)) / RAD;
    // Looking downhill, the horizon of the plain shows above the falling slope.
    const drop = (A - K * R0 * R0) - (A - K * EDGE * EDGE) + mast;
    return Math.max(near, -Math.acos(R / (R + drop)) / RAD);
  };

  it('mast 0: the skyline is the slope of the ground at the observer\'s feet, uphill and downhill', () => {
    const p = computeHorizon(dome, site, 0);
    let worst = 0;
    for (let i = 0; i < 720; i++) worst = Math.max(worst, Math.abs(p.elevDeg[i] - expected(i / 2, 0)));
    expect(worst).toBeLessThan(0.01);
    expect(p.elevDeg[180]).toBeCloseTo(Math.atan(2 * K * R0) / RAD, 2); // east, uphill: 13.50 deg
    expect(p.distM[180]).toBe(0); // "0 m away": the ground itself
    expect(p.heightM[180]).toBeCloseTo(A - K * R0 * R0, 3);
    expect(p.elevDeg[0]).toBeCloseTo(0, 2); // north, along the contour
    expect(p.elevDeg[540]).toBeCloseTo(-Math.acos(R / (R + 86.4)) / RAD, 2); // west, downhill: the plain's horizon
    expect(p.distM[540]).toBeGreaterThan(10_000);
    expect(p.warnings.join(' ')).toMatch(/With the observer on the ground, the skyline in \d+ of 720 directions is the ground within 28 m of the observer: the slope of the 40 m elevation grid there/);
  });

  for (const mast of [0.05, 0.5, 2]) {
    it(`mast ${mast} m: the nearby convex ground still forms the skyline, lower by 2 sqrt(H k)`, () => {
      const p = computeHorizon(dome, site, mast);
      let worst = 0;
      for (let i = 0; i < 720; i++) worst = Math.max(worst, Math.abs(p.elevDeg[i] - expected(i / 2, mast)));
      expect(worst).toBeLessThan(0.01);
      // East: formed sqrt(H / k) from the observer, between the observer and the first grid step.
      expect(p.distM[180]).toBeGreaterThan(0.8 * Math.sqrt(mast / K));
      expect(p.distM[180]).toBeLessThan(1.25 * Math.sqrt(mast / K));
      expect(p.elevDeg[180]).toBeLessThan(computeHorizon(dome, site, 0).elevDeg[180]);
    });
  }

  it('the result does not depend on the fast lookup or on the near-field step', () => {
    const a = computeHorizon(dome, site, 0), b = computeHorizon(dome, site, 0, { fast: false, nearFraction: 0.02 });
    let worst = 0;
    for (let i = 0; i < 720; i++) worst = Math.max(worst, Math.abs(a.elevDeg[i] - b.elevDeg[i]));
    expect(worst).toBeLessThan(0.002);
  });

  it('concave ground (a bowl): the rim is the skyline at any mast height, never the ground at the feet', () => {
    // h = k r^2 inside 400 m, flat beyond; the observer 100 m west of the bottom.
    const KB = 0.0005, RB = 400, r0 = 100;
    const bottom = destination(site, 90, r0);
    const bowl = stackOf(radialSource('bowl', 40, bottom.lat, bottom.lon, (r) => KB * Math.min(r, RB) ** 2));
    for (const mast of [0, 0.5, 2]) {
      const p = computeHorizon(bowl, site, mast);
      let worst = 0;
      for (let i = 0; i < 720; i += 4) {
        const az = (i / 2) * RAD;
        const dRim = r0 * Math.sin(az) + Math.sqrt(RB * RB - (r0 * Math.cos(az)) ** 2);
        const rim = Math.atan((KB * (RB * RB - r0 * r0) - mast) / dRim - dRim / (2 * R)) / RAD;
        worst = Math.max(worst, Math.abs(p.elevDeg[i] - rim));
        expect(p.distM[i]).toBeGreaterThan(250);
      }
      // The rim is a crease: the search finds it to about half a metre along the ray.
      expect(worst).toBeLessThan(0.02);
      expect(p.warnings.join(' ')).not.toMatch(/the ground within/);
    }
  });

  it('a smooth sphere is unchanged: the horizon dip at every mast height, 0 deg on the ground', () => {
    for (const mast of [0, 0.5, 2]) {
      const p = computeHorizon(flat(), { lat: -20, lon: 30 }, mast);
      expect(maxAbsDiff(p.elevDeg, -Math.acos(R / (R + mast)) / RAD)).toBeLessThan(0.002);
      // An eye on smooth ground has the ground beside it for a horizon, and the profile says so; half a metre up it is 1.3 km away.
      if (mast === 0) expect(p.warnings).toEqual([expect.stringMatching(/^With the observer on the ground, the skyline in 720 of 720 directions is the ground within 42 m of the observer/)]);
      else expect(p.warnings).toEqual([]);
    }
  });
});

describe('observer on or near the ground: the two polar pins of the independent validation (T-26)', () => {
  const FIXTURES = join(process.cwd(), 'tests/fixtures/validation/ephemeris-check/skyline');
  /** A skyline computed by @ephemeris-check's own ray march over the bundled grids (nothing from src/). */
  const reference = (id: string) => JSON.parse(readFileSync(join(FIXTURES, `reference-${id}.json`), 'utf8')) as { site: SiteRef; mastHeightM: number; elevDeg: number[]; distM: number[] };
  const compare = async (id: string) => {
    const ref = reference(id);
    const p = computeHorizon(await loadTerrainFor(ref.site), ref.site, ref.mastHeightM);
    let worst = 0, over = 0, atFeet = 0;
    for (let i = 0; i < 720; i++) {
      const d = Math.abs(p.elevDeg[i] - ref.elevDeg[i]);
      worst = Math.max(worst, d);
      if (d > 0.01) over++;
      if (p.distM[i] === 0) atFeet++;
    }
    return { worst, over, atFeet, p };
  };

  // Before this change the app read 1.09 and 1.23 deg low here (first sample 12 m out).
  for (const [id, was] of [['connecting-ridge@0m', 1.09], ['rim-top@0m', 1.23], ['ridge-top@0m', 0.26], ['shackleton-rim@0m', 0.03], ['im-2@0m', 0.002]] as const) {
    it(`${id}: within 0.01 deg of the independent skyline at all 720 azimuths (was ${was} deg)`, async () => {
      const r = await compare(id);
      console.log(`${id}: worst ${r.worst.toFixed(4)} deg, ${r.over} azimuths over 0.01, ${r.atFeet} formed at the observer's feet`);
      expect(r.worst).toBeLessThan(0.01);
      if (id !== 'im-2@0m' && id !== 'shackleton-rim@0m') expect(r.atFeet).toBeGreaterThan(100); // convex ground under the pin
    });
  }
  for (const [id, limit] of [['connecting-ridge', 0.02], ['shackleton-rim', 0.01], ['im-2', 0.01], ['apollo-15', 0.01], ['chandrayaan-3', 0.01]] as const) {
    it(`${id}, 2 m mast: within ${limit} deg of the independent skyline`, async () => {
      const r = await compare(id);
      console.log(`${id} @2m: worst ${r.worst.toFixed(4)} deg, ${r.over} azimuths over 0.01`);
      expect(r.worst).toBeLessThan(limit);
      expect(r.atFeet).toBe(0);
    });
  }

  for (const id of ['connecting-ridge@0m', 'rim-top@0m'] as const) {
    it(`${id.replace('@0m', '')}: 0 m, 0.5 m and 2 m agree with a brute-force march of the near field`, async () => {
      const { site } = reference(id);
      const stack = await loadTerrainFor(site);
      const lines: string[] = [];
      for (const mast of [0, 0.5, 2]) {
        const p = computeHorizon(stack, site, mast);
        let worst = 0, near = 0;
        for (let i = 0; i < 720; i += 9) {
          const brute = bruteSkyline(stack, site, mast, i / 2, 3000);
          // The skyline is never below what the first 3 km show, and equals it where it is formed there.
          expect(p.elevDeg[i]).toBeGreaterThan(brute - 0.005);
          if (p.distM[i] < 2900) {
            near++;
            worst = Math.max(worst, Math.abs(p.elevDeg[i] - brute));
          }
        }
        lines.push(`${mast} m: worst ${worst.toFixed(4)} deg over ${near} of 80 azimuths formed within 3 km`);
        expect(worst).toBeLessThan(0.005);
        expect(near).toBeGreaterThan(10);
      }
      console.log(`${id.replace('@0m', '')}: ${lines.join('; ')}`);
    }, 120_000);
  }

  it('a 0 m observer on the connecting ridge sees a higher skyline than a 2 m one, and the profile says what it rests on', async () => {
    const { site } = reference('connecting-ridge@0m');
    const stack = await loadTerrainFor(site);
    const ground = computeHorizon(stack, site, 0), mast = computeHorizon(stack, site, 2);
    let higher = 0;
    for (let i = 0; i < 720; i++) if (ground.elevDeg[i] > mast.elevDeg[i] + 0.1) higher++;
    expect(higher).toBeGreaterThan(200);
    expect(ground.warnings.join(' ')).toMatch(/With the observer on the ground, the skyline in \d+ of 720 directions is the ground within 28 m of the observer/);
    expect(mast.warnings.join(' ')).not.toMatch(/the ground within/);
  });
});
