// Run: npm run test:science   (node --experimental-strip-types --test tests/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MOON_RADIUS_KM,
  distanceToTarget,
  formatDistance,
  greatCircleKm,
  nearestIceTargets,
  parseIceTargets,
  targetsContaining,
  type IceTarget,
  type LatLon,
} from '../src/science/iceTargets.ts';

const close = (a: number, b: number, tol: number, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b} ± ${tol}, got ${a}`);

function area(id: string, rings: [number, number][][], center: LatLon = { lat: 0, lon: 0 }): IceTarget {
  return {
    id,
    fid: 0,
    name: id,
    label: id,
    kind: 'area',
    center,
    polygons: [rings.map((r) => r.map(([lon, lat]) => ({ lat, lon })))],
    areaKm2: null,
    objectives: { highest: false, lateral: false, vertical: false, fastest: false },
    totalObjectives: 0,
    flags: [],
    properties: {},
  };
}

const square = (lon0: number, lat0: number, h: number): [number, number][] => [
  [lon0 - h, lat0 - h],
  [lon0 + h, lat0 - h],
  [lon0 + h, lat0 + h],
  [lon0 - h, lat0 + h],
  [lon0 - h, lat0 - h],
];

test('great-circle basics', () => {
  close(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }), (Math.PI / 2) * MOON_RADIUS_KM, 1e-9);
  close(greatCircleKm({ lat: -90, lon: 0 }, { lat: -89, lon: 123 }), (Math.PI / 180) * MOON_RADIUS_KM, 1e-9);
  close(greatCircleKm({ lat: 10, lon: 179.9 }, { lat: 10, lon: -179.9 }), 0.2 * (Math.PI / 180) * MOON_RADIUS_KM * Math.cos(10 * (Math.PI / 180)), 1e-3);
});

test('area: inside is 0, edge distance is perpendicular (not to a vertex)', () => {
  const t = area('sq', [square(0, 0, 1)]);
  const inside = distanceToTarget({ lat: 0.2, lon: -0.3 }, t);
  assert.equal(inside.inside, true);
  assert.equal(inside.distanceKm, 0);
  assert.equal(inside.measuredTo, 'area-outline');
  // East of the square at the equator: nearest point is on the lon=+1 edge, at lat 0.
  const d = distanceToTarget({ lat: 0, lon: 3 }, t);
  assert.equal(d.inside, false);
  close(d.distanceKm, 2 * (Math.PI / 180) * MOON_RADIUS_KM, 1e-6);
  close(d.nearest.lat, 0, 1e-9);
  close(d.nearest.lon, 1, 1e-9);
  assert.match(d.assumption, /not a traverse/);
});

test('area: matches brute-force sampling of the outline', () => {
  const t = area('tri', [[[10, -80], [40, -82], [25, -86], [10, -80]]]);
  const queries: LatLon[] = [{ lat: -70, lon: 25 }, { lat: -89, lon: -150 }, { lat: -83, lon: 0 }, { lat: -81, lon: 60 }];
  const ring = t.polygons[0][0];
  for (const q of queries) {
    let brute = Infinity;
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      // Sample the great-circle arc between a and b via slerp.
      const va = vec(a);
      const vb = vec(b);
      const om = Math.acos(va.reduce((s, x, k) => s + x * vb[k], 0));
      for (let s = 0; s <= 2000; s++) {
        const f = s / 2000;
        const w1 = Math.sin((1 - f) * om) / Math.sin(om);
        const w2 = Math.sin(f * om) / Math.sin(om);
        const v = va.map((x, k) => w1 * x + w2 * vb[k]);
        const ll = { lat: (Math.asin(v[2]) * 180) / Math.PI, lon: (Math.atan2(v[1], v[0]) * 180) / Math.PI };
        brute = Math.min(brute, greatCircleKm(q, ll));
      }
    }
    const d = distanceToTarget(q, t);
    assert.ok(d.distanceKm <= brute + 1e-6, `exact ${d.distanceKm} > sampled ${brute}`);
    close(d.distanceKm, brute, 0.2, `query ${JSON.stringify(q)}`);
  }
});

test('area: holes and antimeridian', () => {
  const t = area('donut', [square(180, -60, 2).map(([lo, la]) => [lo > 180 ? lo - 360 : lo, la] as [number, number]), square(180, -60, 0.5).reverse()]);
  assert.equal(distanceToTarget({ lat: -61, lon: 179.5 }, t).inside, true);
  assert.equal(distanceToTarget({ lat: -61, lon: -179.5 }, t).inside, true);
  const inHole = distanceToTarget({ lat: -60, lon: 180 }, t);
  assert.equal(inHole.inside, false);
  assert.ok(inHole.distanceKm > 0 && inHole.distanceKm < 0.6 * (Math.PI / 180) * MOON_RADIUS_KM);
});

test('area enclosing the south pole', () => {
  const ring: [number, number][] = [];
  for (let k = 0; k <= 36; k++) ring.push([-180 + k * 10, -88]);
  ring[36] = ring[0];
  const t = area('cap', [ring], { lat: -90, lon: 0 });
  assert.equal(distanceToTarget({ lat: -90, lon: 0 }, t).inside, true);
  // At a vertex longitude (edges between vertices are great-circle arcs that bow poleward).
  close(distanceToTarget({ lat: -86, lon: 40 }, t).distanceKm, 2 * (Math.PI / 180) * MOON_RADIUS_KM, 1e-6);
});

test('point targets are labelled as points', () => {
  const p: IceTarget = { ...area('p', []), kind: 'point', polygons: [], center: { lat: -85, lon: 0 } };
  const d = distanceToTarget({ lat: -86, lon: 0 }, p);
  assert.equal(d.measuredTo, 'point');
  assert.equal(d.inside, false);
  close(d.distanceKm, (Math.PI / 180) * MOON_RADIUS_KM, 1e-9);
});

test('formatDistance', () => {
  assert.equal(formatDistance({ distanceKm: 0, inside: true }), 'inside');
  assert.equal(formatDistance({ distanceKm: 0.4321, inside: false }), '432 m');
  assert.equal(formatDistance({ distanceKm: 12.34, inside: false }), '12.3 km');
  assert.equal(formatDistance({ distanceKm: 1234.5, inside: false }), '1235 km');
});

// ------------------------------------------------------------- real dataset

const layer = parseIceTargets(
  JSON.parse(readFileSync(new URL('../public/data/ice-targets/lemelin2021-psr.geojson', import.meta.url), 'utf8')),
);

test('packaged layer: shape, attribution, flags', () => {
  assert.equal(layer.targets.length, 169);
  assert.ok(layer.targets.every((t) => t.kind === 'area'));
  assert.equal(layer.attribution.license, 'CC-BY-4.0');
  assert.match(layer.attribution.citation, /10\.5281\/zenodo\.4646092/);
  assert.equal(layer.targets.filter((t) => t.name).length, 31);
  assert.equal(layer.targets.filter((t) => t.totalObjectives >= 2).length, 11); // "11 most promising PSRs"
  const wj = layer.targets.find((t) => t.name === 'Wiechert J')!;
  assert.deepEqual(wj.flags, ['center-outside-polygon']);
  assert.ok(layer.targets.filter((t) => t.flags.length).length === 1);
  // Blank cells stay null rather than becoming 0.
  assert.equal(layer.targets[0].properties.MIN_dist_5deg, null);
});

test('packaged layer: each listed centre lies inside or near its outline (except the flagged one)', () => {
  for (const t of layer.targets) {
    const d = distanceToTarget(t.center, t);
    if (t.flags.includes('center-outside-polygon')) assert.ok(d.distanceKm > 50, `${t.label}: ${d.distanceKm}`);
    else assert.ok(d.distanceKm < 2, `${t.label}: centre ${d.distanceKm} km from outline`);
  }
});

test('packaged layer: nearest lookup', () => {
  const shack = layer.targets.find((t) => t.name === 'Shackleton')!;
  const inShack = nearestIceTargets(layer.targets, shack.center, { limit: 3 });
  assert.equal(inShack[0].target, shack);
  assert.equal(inShack[0].inside, true);
  assert.deepEqual(targetsContaining(layer.targets, shack.center), [shack]);
  // Sorted, limited and consistent with the one-target function.
  const q = { lat: -84.5, lon: 30 };
  const res = nearestIceTargets(layer.targets, q, { limit: 10 });
  assert.equal(res.length, 10);
  for (let i = 1; i < res.length; i++) assert.ok(res[i].distanceKm >= res[i - 1].distanceKm);
  const all = layer.targets.map((t) => distanceToTarget(q, t).distanceKm).sort((a, b) => a - b);
  res.forEach((r, i) => close(r.distanceKm, all[i], 1e-9));
  // maxKm and filter.
  assert.ok(nearestIceTargets(layer.targets, q, { maxKm: 5, limit: 50 }).every((r) => r.distanceKm <= 5));
  const named = nearestIceTargets(layer.targets, q, { filter: (t) => t.name !== null });
  assert.ok(named.every((r) => r.target.name));
  // From Apollo 11 (equatorial) everything is ~2400+ km away; still well-defined.
  const far = nearestIceTargets(layer.targets, { lat: 0.674, lon: 23.473 }, { limit: 1 });
  assert.ok(far[0].distanceKm > 2000 && far[0].distanceKm < 3000);
});

function vec({ lat, lon }: LatLon): number[] {
  const φ = (lat * Math.PI) / 180;
  const λ = (lon * Math.PI) / 180;
  return [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
}
