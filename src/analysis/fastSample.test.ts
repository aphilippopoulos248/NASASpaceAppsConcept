/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import type { SiteRef } from '../core/types';
import { loadTerrainFor, sourceFromDescriptor } from '../terrain/api';
import type { HeightSource } from '../terrain/types';
import { fastSamplerFor } from './fastSample';
import { computeHorizon, destination, sourceReach } from './horizon';
import { fnSource } from './testing';

const RAD = Math.PI / 180;
const unit = (lat: number, lon: number) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const landing = (id: string, lat: number, lon: number): SiteRef => ({ id, name: id, kind: 'landing', lat, lon });
const pin = (lat: number, lon: number): SiteRef => ({ id: `pin:${lat},${lon}`, name: 'pin', kind: 'custom', lat, lon });

// Real bundled terrain (public/terrain, public/data/dem) through the terrain module's own loader.
const SITES: SiteRef[] = [
  landing('im-2', -84.79, 29.2),
  landing('apollo-15', 26.13239, 3.6333),
  landing('chandrayaan-3', -69.3733, 32.319),
  landing('change-4', -45.4446, 177.5991),
  pin(-89.45, -137.2), // Shackleton rim: 40, 80 and 160 m polar layers
  pin(-90, 0),
  pin(90, 0),
  pin(-85.02, -45), // at the corner region of the 85S square
  pin(-79.9, 60), // just outside the 80S square's inscribed circle
  pin(-45.5, -179.99), // antimeridian, whole-Moon grid only
];

/** A deterministic pseudo-random sequence. */
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

describe('unit-vector samplers reproduce the terrain module', () => {
  it('every projected grid of every test site: same heights as HeightSource.sample at 3000 points each', async () => {
    const seen = new Set<HeightSource>();
    let grids = 0, points = 0, withData = 0;
    for (const site of SITES) {
      const stack = await loadTerrainFor(site, { remote: false });
      for (const src of stack.sources) {
        if (seen.has(src)) continue;
        seen.add(src);
        const fast = fastSamplerFor(src);
        if (src.descriptor.kind === 'equirect') {
          expect(fast, `${src.name}: whole-Moon grids keep the ordinary lookup`).toBeNull();
          continue;
        }
        expect(fast, `${src.name}: a fast sampler should validate`).not.toBeNull();
        grids++;
        const d = src.descriptor;
        const reachM = d.kind === 'local' ? ((d.n - 1) / 2) * d.spacingM * 1.6 : ((d.size - 1) / 2) * d.metresPerPx * 1.6;
        const centre = d.kind === 'local' ? { lat: d.lat0, lon: d.lon0 } : { lat: d.pole === 'S' ? -90 : 90, lon: 0 };
        const rnd = lcg(grids * 7919);
        for (let k = 0; k < 3000; k++) {
          // Uniform over a disc that overlaps the grid's edges and corners.
          const p = destination(centre, rnd() * 360, Math.sqrt(rnd()) * reachM);
          const u = unit(p.lat, p.lon);
          const a = fast!(u[0], u[1], u[2]);
          const b = src.sample(p.lat, p.lon);
          points++;
          if (Number.isNaN(b)) {
            // Within a billionth of a pixel of an edge the two may differ in which side they fall; nowhere else.
            if (!Number.isNaN(a)) expect(src.covers(p.lat, p.lon), `${src.name} at ${p.lat},${p.lon}: fast ${a}, source NaN`).toBe(true);
          } else {
            withData++;
            expect(Math.abs(a - b), `${src.name} at ${p.lat},${p.lon}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));
          }
        }
      }
    }
    console.log(`fast samplers: ${grids} grids, ${points} points (${withData} with data) agree with HeightSource.sample`);
    expect(grids).toBeGreaterThanOrEqual(10);
    expect(withData).toBeGreaterThan(points * 0.3);
  });

  it('refuses sources it cannot reproduce: synthetic sources, and a descriptor that does not describe the data served', async () => {
    expect(fastSamplerFor(fnSource('synthetic', 60, () => 123))).toBeNull();
    const stack = await loadTerrainFor(landing('apollo-15', 26.13239, 3.6333));
    const real = stack.sources.find((s) => s.descriptor.kind === 'local')!;
    expect(fastSamplerFor(real)).not.toBeNull();
    // Same descriptor, different behaviour: 1 m higher everywhere.
    const liar: HeightSource = { name: 'liar', resolutionM: real.resolutionM, descriptor: real.descriptor, covers: (a, b) => real.covers(a, b), sample: (a, b) => real.sample(a, b) + 1 };
    expect(fastSamplerFor(liar)).toBeNull();
    // Same descriptor, mirrored east-west.
    const mirrored: HeightSource = { name: 'mirrored', resolutionM: real.resolutionM, descriptor: real.descriptor, covers: (a, b) => real.covers(a, 2 * 3.6333 - b), sample: (a, b) => real.sample(a, 2 * 3.6333 - b) };
    expect(fastSamplerFor(mirrored)).toBeNull();
    // A rebuilt source from the same plain description validates again (what a Web Worker would hold).
    expect(fastSamplerFor(sourceFromDescriptor(real.descriptor))).not.toBeNull();
  });
});

describe('source reach (which distances from a site a grid can cover)', () => {
  it('never excludes a point the source covers', async () => {
    let checked = 0, bounded = 0;
    for (const site of SITES) {
      const stack = await loadTerrainFor(site, { remote: false });
      const rnd = lcg(4242);
      for (const src of stack.sources) {
        const r = sourceReach(src, site);
        if (r.rMin > 0 || Number.isFinite(r.rOut)) bounded++;
        for (let k = 0; k < 1500; k++) {
          const dist = rnd() ** 2 * 900_000;
          const p = destination(site, rnd() * 360, dist);
          if (src.covers(p.lat, p.lon)) {
            checked++;
            expect(dist >= r.rMin && dist <= r.rOut, `${src.name} from ${site.id}: covered point at ${dist.toFixed(0)} m outside [${r.rMin.toFixed(0)}, ${r.rOut.toFixed(0)}]`).toBe(true);
          }
        }
      }
    }
    console.log(`source reach: ${checked} covered points all inside their predicted band; ${bounded} source/site pairs have a finite band`);
    expect(bounded).toBeGreaterThan(15);
  });

  it('applies no pruning to sources whose description cannot be trusted', () => {
    const s = fnSource('synthetic', 60, () => 0);
    expect(sourceReach(s, { lat: 10, lon: 20 })).toEqual({ rMin: 0, rOut: Infinity });
    // A descriptor that claims a small window while covers() says "everywhere".
    const claims: HeightSource = { ...s, descriptor: { kind: 'local', name: 'x', resolutionM: 60, lat0: 10, lon0: 20, n: 129, spacingM: 60, data: new Float32Array(129 * 129) } };
    expect(sourceReach(claims, { lat: 10, lon: 20 })).toEqual({ rMin: 0, rOut: Infinity });
  });
});

describe('skyline: fast lookups and pruning leave the result unchanged', () => {
  it.each(SITES.map((s) => [s.id, s] as const))('%s: same profile with and without them', async (_id, site) => {
    const stack = await loadTerrainFor(site, { remote: false });
    // "Reference" stack: wrappers the fast path cannot see through, with descriptors that carry no usable geometry.
    const plain = { sources: stack.sources.map((s) => fnSource(s.name, s.resolutionM, (a, b) => s.sample(a, b), (a, b) => s.covers(a, b))), notes: [] };
    for (const opt of [{}, { azStepDeg: 1, growth: 0.01 }]) {
      const a = computeHorizon(stack, site, 2, opt);
      const b = computeHorizon(plain, site, 2, opt);
      const c = computeHorizon(stack, site, 2, { ...opt, fast: false });
      let dEl = 0, dElSlow = 0, moved = 0;
      for (let i = 0; i < a.elevDeg.length; i++) {
        dEl = Math.max(dEl, Math.abs(a.elevDeg[i] - b.elevDeg[i]));
        dElSlow = Math.max(dElSlow, Math.abs(c.elevDeg[i] - b.elevDeg[i]));
        if (a.distM[i] !== b.distM[i]) moved++;
      }
      expect(dElSlow, 'pruning alone changes nothing at all').toBe(0);
      expect(dEl, 'fast lookups agree to rounding').toBeLessThan(5e-6);
      expect(moved).toBeLessThanOrEqual(2); // exact ties may resolve to a neighbouring sample
      expect(a.layers).toEqual(b.layers);
      expect(a.maxRangeM).toBe(b.maxRangeM);
      expect(Array.from(a.skylineLayer)).toEqual(Array.from(b.skylineLayer));
    }
  });
});
