// The packaged PGDA 69 maps (public/data/heatmap), read from disk under vitest.
// Set LUNYX_LIVE=1 to also run the last test, which reads the same pixels straight from
// the LOLA team's server.
import { describe, expect, it } from 'vitest';
import { loadGlobalGrid } from '../terrain/api';
import { offsetPoint } from '../terrain/geo';
import { readTerrainFile } from '../terrain/reader';
import { loadPolarAverage, loadPolarAverageIndex, polarAverageAt, polarAverageUv, PolarAverageMap, type PolarAverageCheck, type Pole } from './polarAverages';

const index = await loadPolarAverageIndex();
const maps = new Map<string, PolarAverageMap>();
for (const l of index.layers) maps.set(l.id, await loadPolarAverage(l.quantity, l.pole, l.role));
const map = (id: string): PolarAverageMap => maps.get(id)!;
const R = 1_737_400;
const DEG = Math.PI / 180;
const shift = (p: { lat: number; lon: number }, eastM: number, northM: number): [number, number] => {
  const q = offsetPoint(p.lat, p.lon, eastM, northM);
  return [q.lat, q.lon];
};

/** The projection as the PDS labels give it, written out again here so the module is not checked against itself. */
function labelPixel(pole: Pole, lat: number, lon: number, size: number, metresPerPx: number): { line: number; sample: number } {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = (2 * R * Math.tan((colat / 2) * DEG)) / metresPerPx;
  const c = size / 2 - 0.5;
  return { line: c - (pole === 'S' ? 1 : -1) * r * Math.cos(lon * DEG), sample: c + r * Math.sin(lon * DEG) };
}

describe('what is packaged', () => {
  it('eight small maps: both poles, both quantities, a wide and a detail layer each', async () => {
    expect(index.layers.map((l) => l.id).sort()).toEqual(
      ['north', 'south'].flatMap((p) => ['earth-visibility', 'illumination'].flatMap((q) => ['detail', 'wide'].map((r) => `${p}-${q}-${r}`))).sort(),
    );
    let total = 0;
    for (const l of index.layers) {
      const bytes = await readTerrainFile(`data/heatmap/${l.file}`);
      expect(bytes.byteLength, l.file).toBe(l.bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(digest, l.file).toBe(l.sha256);
      expect(l.bytes, l.file).toBeLessThan(3e6);
      total += l.bytes;
      expect([l.size, l.metresPerPx, l.halfWidthM]).toEqual(l.role === 'wide' ? [1605, 960, 770400] : [2529, 120, 151740]);
      const sign = l.pole === 'S' ? -1 : 1;
      expect([l.latCompleteTo, l.latCornersTo]).toEqual(l.role === 'wide' ? [sign * 65, sign * 55.2] : [sign * 85, sign * 83]);
      expect(l.source.url).toMatch(/^https:\/\/imbrium\.mit\.edu\/EXTRAS\/ILLUMINATION\/IMG\/AVGVISIB_(65|85)[NS]_(240|060)M_201608(_EARTH)?\.IMG$/);
      expect(l.source.url.includes('_EARTH')).toBe(l.quantity === 'earth-visibility');
      expect(l.source.basedOn).toMatch(/^LDEM_(65|85)[NS]_(240|060)M$/);
    }
    expect(total).toBe(index.totalBytes);
    expect(total).toBeLessThan(14e6);
  });

  it('carries the wording that keeps the numbers honest', () => {
    // Multi-year averages, not dated geometry.
    expect(index.what).toMatch(/Multi-year averages/);
    expect(index.what).toMatch(/not the geometry of any date/);
    expect(index.averagingPeriod).toMatch(/18\.6 years/);
    expect(index.averagingPeriod).toMatch(/do not state the calendar dates/);
    for (const q of Object.values(index.quantities)) {
      expect(q.label).toMatch(/multi-year/);
      expect(q.meaning).toMatch(/any part of/);
      expect(q.meaning).toMatch(/multi-year average/i);
      expect(q.unit).toBe('percent of time');
    }
    expect(index.quantities.illumination.meaning).toMatch(/not how much of the disc or of its energy/);
    expect(index.quantities['earth-visibility'].meaning).toMatch(/not a link budget/);
    expect(index.caveats.join(' ')).toMatch(/not supported by the PDS or the LOLA Science Team/);
    expect(index.citation).toMatch(/Mazarico.*2011.*10\.1016\/j\.icarus\.2010\.10\.030/);
    expect(index.usage).toMatch(/NASA/);
    expect(index.projection).toMatch(/Polar stereographic.*1737\.4 km.*true scale at the pole/);
  });

  it('each map decodes to what its description says', () => {
    for (const l of index.layers) {
      const m = map(l.id);
      expect(m.data.length).toBe(l.size * l.size);
      let zeros = 0;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < m.data.length; i++) {
        const v = m.data[i];
        if (v === 0) zeros++;
        if (v > max) max = v;
        sum += v;
      }
      expect(max, l.id).toBe(l.stats.maxPercent);
      expect(max).toBeLessThanOrEqual(100);
      expect(zeros / m.data.length).toBeCloseTo(l.stats.neverLitFraction, 4);
      // Whole-percent storage moves the mean by well under half a point.
      expect(Math.abs(sum / m.data.length / 100 - l.stats.meanFraction), l.id).toBeLessThan(0.004);
    }
  });
});

describe('values agree with the source files', () => {
  const sameCell = (l: { id: string; pole: Pole; size: number; metresPerPx: number }, c: PolarAverageCheck, what: string): void => {
    const m = map(l.id);
    // 1. The module finds the cell the build script found, by the projection of the PDS label.
    const viaLabel = labelPixel(l.pole, c.lat, c.lon, l.size, l.metresPerPx);
    const here = m.pixelOf(c.lat, c.lon)!;
    expect(here.x, what).toBeCloseTo(viaLabel.sample, 6);
    expect(here.y, what).toBeCloseTo(viaLabel.line, 6);
    // 2. The stored value is the one recorded from the source, and is the cell mean to the whole percent.
    expect(m.data[c.line * l.size + c.sample], what).toBe(c.storedPercent);
    if (c.cellMeanFraction === 0) expect(c.storedPercent).toBe(0);
    else if (c.cellMeanFraction < 0.005) expect(c.storedPercent).toBe(1);
    else expect(Math.abs(c.storedPercent - 100 * c.cellMeanFraction), what).toBeLessThanOrEqual(0.5 + 1e-3);
  };

  it('at the recorded places, the packaged cell holds the mean of its source pixels', () => {
    let count = 0;
    for (const l of index.layers) {
      for (const c of l.checks) {
        sameCell(l, c, `${l.id}: ${c.name}`);
        // A named place is looked up by its coordinates; the cell found must be the recorded one
        // unless the point sits within a hair of a cell edge.
        const p = map(l.id).pixelOf(c.lat, c.lon)!;
        if (Math.abs(p.x - Math.round(p.x)) < 0.49 && Math.abs(p.y - Math.round(p.y)) < 0.49) {
          const block = l.source.sizePx / l.size;
          const src = labelPixel(l.pole, c.lat, c.lon, l.source.sizePx, l.source.resolutionM);
          // (The script takes the source pixel first and then its cell: the same cell away from edges.)
          if (Math.floor(Math.round(src.line) / block) === Math.round(p.y) && Math.floor(Math.round(src.sample) / block) === Math.round(p.x)) {
            expect(map(l.id).percentAt(c.lat, c.lon), `${l.id}: ${c.name}`).toBe(c.storedPercent);
            count++;
          }
        }
      }
      sameCell(l, l.brightest, `${l.id}: brightest`);
    }
    expect(count).toBeGreaterThan(25);
  });

  it('known geography: Shackleton floor in permanent shadow, the bright ridge beside it, Earth seen from the near side only', () => {
    const sunD = map('south-illumination-detail');
    const sunW = map('south-illumination-wide');
    const earthD = map('south-earth-visibility-detail');
    // Shackleton (IAU 89.67S 129.78E, 20.9 km across): never sunlit on the floor, and Earth never in view from it.
    expect(sunD.percentAt(-89.67, 129.78)).toBe(0);
    expect(sunW.percentAt(-89.67, 129.78)).toBe(0);
    expect(earthD.percentAt(-89.67, 129.78)).toBe(0);
    for (const [dx, dy] of [[0, 2000], [1500, -1500], [-2500, 0]]) {
      const p = offsetPoint(-89.67, 129.78, dx, dy);
      expect(sunD.percentAt(p.lat, p.lon), `floor ${dx},${dy}`).toBe(0);
    }
    // The brightest pixel of the 60 m source map (88.4 %) is on the ridge between Shackleton and de Gerlache,
    // where Mazarico et al. (2011) put the most illuminated south-polar site (89.45S 222.69E).
    const top = sunD.info.brightest;
    expect(top.sourceFraction).toBeCloseTo(0.88444, 4);
    expect(Math.abs(top.lat - -89.45)).toBeLessThan(0.05);
    expect(Math.abs(top.lon - (222.69 - 360))).toBeLessThan(0.5);
    // Its 120 m cell averages that pixel with dimmer neighbours.
    expect(sunD.percentAt(top.lat, top.lon)).toBe(81);
    expect(top.cellMeanFraction).toBeCloseTo(0.806, 2);
    // The 240 m source map peaks at the same ridge (93.5 %); a 960 m cell dilutes it to 60 %.
    expect(sunW.info.brightest.sourceFraction).toBeCloseTo(0.93476, 4);
    expect(Math.abs(sunW.info.brightest.lat - -89.45)).toBeLessThan(0.02);
    expect(sunW.percentAt(sunW.info.brightest.lat, sunW.info.brightest.lon)).toBe(60);
    // Nothing on the Moon is sunlit all the time.
    for (const l of index.layers) if (l.quantity === 'illumination') expect(l.stats.maxPercent).toBeLessThan(95);
    // Earth: always in view from 70 degrees on the near-side meridian, never continuous at the far side.
    expect(map('south-earth-visibility-wide').percentAt(-70, 0)).toBe(100);
    expect(map('north-earth-visibility-wide').percentAt(70, 0)).toBe(100);
    expect(map('south-earth-visibility-wide').percentAt(-70, 180)).toBe(0);
    expect(map('north-earth-visibility-wide').percentAt(70, 180)).toBe(0);
  });

  it('is the right way round at both poles, judged from data that does not share its projection code', async () => {
    const dem = await loadGlobalGrid(16);
    for (const pole of ['S', 'N'] as const) {
      const name = pole === 'S' ? 'south' : 'north';
      // Earth is seen from the near side: the sector around longitude 0 against the one around 180.
      const earth = map(`${name}-earth-visibility-wide`);
      let near = 0, nNear = 0, far = 0, nFar = 0, east = 0, nEast = 0, west = 0, nWest = 0;
      for (let y = 0; y < earth.size; y += 3) {
        for (let x = 0; x < earth.size; x += 3) {
          const p = earth.latLonOf(x, y);
          const colat = 90 - Math.abs(p.lat);
          if (colat < 2 || colat > 12) continue;
          const v = earth.data[y * earth.size + x];
          if (Math.abs(p.lon) < 45) { near += v; nNear++; } else if (Math.abs(p.lon) > 135) { far += v; nFar++; } else if (p.lon > 0) { east += v; nEast++; } else { west += v; nWest++; }
        }
      }
      expect(near / nNear, `${pole} near side`).toBeGreaterThan(55); // measured 62 (S), 74 (N)
      expect(far / nFar, `${pole} far side`).toBeLessThan(8); // measured 4
      expect(Math.abs(east / nEast - west / nWest), `${pole} east vs west`).toBeLessThan(5); // symmetric: 27-33 both sides

      // Permanent shadow sits in holes. Against the whole-Moon LOLA grid, never-lit cells lie far below
      // their surroundings; swap east and west and the effect is gone.
      const sun = map(`${name}-illumination-wide`);
      const relief = (mirror: number): number => {
        let sum = 0, n = 0, k = 0;
        for (let i = 0; i < sun.data.length; i++) {
          if (sun.data[i] !== 0 || k++ % 9) continue;
          const p = sun.latLonOf(i % sun.size, Math.floor(i / sun.size));
          if (90 - Math.abs(p.lat) > 20) continue;
          const lon = mirror * p.lon;
          let ring = 0;
          for (let a = 0; a < 8; a++) {
            const q = offsetPoint(p.lat, lon, 12000 * Math.sin((a * Math.PI) / 4), 12000 * Math.cos((a * Math.PI) / 4));
            ring += dem.sample(q.lat, q.lon);
          }
          sum += dem.sample(p.lat, lon) - ring / 8;
          n++;
        }
        expect(n).toBeGreaterThan(1000);
        return sum / n;
      };
      expect(relief(1), `${pole} as packaged`).toBeLessThan(-500); // measured -824 m (S), -697 m (N)
      expect(Math.abs(relief(-1)), `${pole} mirrored`).toBeLessThan(100); // measured -21 m, -29 m
    }
  });
});

describe('positions', () => {
  it('latitude/longitude and cells convert both ways', () => {
    for (const l of index.layers) {
      const m = map(l.id);
      const c = l.size / 2 - 0.5;
      // The pole is the centre of the middle cell (both sizes are odd).
      expect(m.pixelOf(l.pole === 'S' ? -90 : 90, 0)).toEqual({ x: c, y: c });
      expect(Number.isInteger(c)).toBe(true);
      for (const [x, y] of [[0, 0], [l.size - 1, 0], [0, l.size - 1], [c + 1, c], [c, c - 1], [123.25, 987.75], [l.size - 1, l.size - 1]]) {
        const p = m.latLonOf(x, y);
        const back = m.pixelOf(p.lat, p.lon)!;
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
        expect(m.covers(p.lat, p.lon)).toBe(true);
      }
      // Longitude 0 is up for the south and down for the north; 90E is to the right for both.
      const lat = l.pole === 'S' ? -89 : 89;
      const up = m.pixelOf(lat, 0)!;
      expect(up.x).toBeCloseTo(c, 6);
      expect(l.pole === 'S' ? up.y < c : up.y > c).toBe(true);
      const right = m.pixelOf(lat, 90)!;
      expect(right.y).toBeCloseTo(c, 6);
      expect(right.x).toBeGreaterThan(c);
      // One degree from the pole is 30.3 km on the ground: 2 R tan(0.5 deg) in the map.
      expect((right.x - c) * l.metresPerPx).toBeCloseTo(2 * R * Math.tan(0.5 * DEG), 3);
      // Outside the square, and the other hemisphere.
      const outside = m.latLonOf(-0.6, c);
      expect(m.covers(outside.lat, outside.lon)).toBe(false);
      expect(m.percentAt(outside.lat, outside.lon)).toBeNaN();
      expect(m.pixelOf(-lat, 0)).toBeNull();
      expect(m.percentAt(-lat, 0)).toBeNaN();
      expect(m.valueAt(l.brightest.lat, l.brightest.lon)).toBeCloseTo(m.percentAt(l.brightest.lat, l.brightest.lon) / 100, 9);
    }
  });

  it('texture coordinates put row 0 at v = 0 and match the cells', () => {
    const m = map('south-illumination-wide');
    const h = m.info.halfWidthM;
    expect(polarAverageUv('S', -90, 0, h)).toEqual({ u: 0.5, v: 0.5 });
    const p = m.latLonOf(200, 300);
    const uv = polarAverageUv('S', p.lat, p.lon, h)!;
    expect(uv.u).toBeCloseTo((200 + 0.5) / m.size, 9);
    expect(uv.v).toBeCloseTo((300 + 0.5) / m.size, 9);
    // Longitude 0: towards v = 0 for the south, towards v = 1 for the north.
    expect(polarAverageUv('S', -80, 0, h)!.v).toBeLessThan(0.5);
    expect(polarAverageUv('N', 80, 0, h)!.v).toBeGreaterThan(0.5);
    expect(polarAverageUv('N', 80, 90, h)!.u).toBeGreaterThan(0.5);
    expect(polarAverageUv('S', 10, 0, h)).toBeNull();
    // The edge of complete coverage: 65 degrees lies on the edge of the wide square.
    expect(polarAverageUv('S', -65, 90, h)!.u).toBeCloseTo(1, 3);
  });
});

describe('texture()', () => {
  it('hands the map over untouched when it fits', () => {
    const m = map('south-illumination-wide');
    const t = m.texture(2048);
    expect(t.data).toBe(m.data);
    expect([t.size, t.metresPerPx, t.halfWidthM, t.factor]).toEqual([1605, 960, 770400, 1]);
    expect(m.texture().data).toBe(m.data);
  });

  it('merges cells about the pole when it does not, and keeps the map where it was', () => {
    const m = map('south-illumination-detail');
    const t = m.texture(2048);
    expect([t.size, t.metresPerPx, t.factor]).toEqual([1265, 240, 2]);
    // 1265 cells of 240 m span 303.6 km: the source's 303.48 km plus half a source cell all round.
    expect(t.halfWidthM).toBe(151800);
    expect(t.data.length).toBe(1265 * 1265);
    // Same place, same value: a broad never-lit floor stays 0, and bright ground keeps its level.
    const texel = (lat: number, lon: number): number => {
      const uv = polarAverageUv('S', lat, lon, t.halfWidthM)!;
      return t.data[Math.floor(uv.v * t.size) * t.size + Math.floor(uv.u * t.size)];
    };
    expect(texel(-89.67, 129.78)).toBe(0); // Shackleton's floor
    expect(texel(-90, 0)).toBeGreaterThan(10); // the rim at the pole
    let diff = 0;
    let count = 0;
    for (let lat = -89.9; lat < -85.2; lat += 0.137) {
      for (let lon = -180; lon < 180; lon += 7.3) {
        // Mean of the source cells in a 720 m box against the mean of the texture there.
        let a = 0;
        let b = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const p = offsetPoint(lat, lon, i * 240, j * 240);
            a += (m.percentAt(p.lat, p.lon) + m.percentAt(...shift(p, 120, 0)) + m.percentAt(...shift(p, 0, 120)) + m.percentAt(...shift(p, 120, 120))) / 4;
            b += texel(p.lat, p.lon);
          }
        }
        diff += Math.abs(a - b) / 9;
        count++;
      }
    }
    expect(count).toBeGreaterThan(1000);
    expect(diff / count).toBeLessThan(3); // percent points: the same picture at half the resolution
    // The overall level is unchanged.
    const mean = (d: Uint8Array): number => d.reduce((x, v) => x + v, 0) / d.length;
    expect(Math.abs(mean(t.data) - mean(m.data))).toBeLessThan(0.3);
  });

  it('weights cells by the area they share with the merged cell, and keeps 0 for "never lit"', () => {
    const info = { ...map('south-illumination-detail').info, size: 5, metresPerPx: 100, halfWidthM: 250 };
    const cells = new Uint8Array(25);
    cells[12] = 100; // the cell on the pole
    const small = new PolarAverageMap(info, cells);
    const t = small.texture(3);
    expect([t.size, t.factor, t.metresPerPx, t.halfWidthM]).toEqual([3, 2, 200, 300]);
    // The centre cell of the result covers the pole cell and half of each neighbour: 100 / 4 = 25.
    expect(Array.from(t.data)).toEqual([0, 0, 0, 0, 25, 0, 0, 0, 0]);
    // A faint cell is never rounded away to "never lit".
    const faint = new Uint8Array(25);
    faint[0] = 1;
    expect(new PolarAverageMap(info, faint).texture(3).data[0]).toBe(1);
    // A uniform map stays uniform, edges included.
    expect(Array.from(new PolarAverageMap(info, new Uint8Array(25).fill(40)).texture(3).data)).toEqual(new Array(9).fill(40));
    expect(new PolarAverageMap(info, cells).texture(1).size).toBe(1);
    expect(() => small.texture(0)).toThrow(/maxSize/);
  });
});

describe('polarAverageAt', () => {
  it('uses the 120 m map near the pole and the 960 m map farther out, and says what the number is', async () => {
    const ridge = map('south-illumination-detail').info.brightest;
    const r = await polarAverageAt('illumination', ridge.lat, ridge.lon);
    expect(r).toMatchObject({ available: true, percent: 81, neverLit: false, cellM: 120, layerId: 'south-illumination-detail' });
    expect(r.text).toBe("Any part of the Sun's disc is above the terrain horizon 81 % of the time here (multi-year average over 18.6 years, mean of a 120 m cell, NASA PGDA product 69; not the Sun's position on the date shown).");
    expect(r.sourceProduct).toMatch(/^AVGVISIB_85S_060M_201608 /);

    const floor = await polarAverageAt('illumination', -89.67, 129.78);
    expect(floor).toMatchObject({ available: true, percent: 0, neverLit: true, cellM: 120 });
    expect(floor.text).toBe('Never sunlit in the long-term model here: permanent shadow (multi-year average over 18.6 years, mean of a 120 m cell, NASA PGDA product 69).');

    const earth = await polarAverageAt('earth-visibility', -70, 0);
    expect(earth).toMatchObject({ available: true, percent: 100, cellM: 960, layerId: 'south-earth-visibility-wide' });
    expect(earth.text).toBe("Any part of Earth's disc is above the terrain horizon 100 % of the time here (multi-year average over 18.6 years, mean of a 960 m cell, NASA PGDA product 69; not Earth's position on the date shown).");
    const hidden = await polarAverageAt('earth-visibility', -89.67, 129.78);
    expect(hidden.text).toMatch(/^Earth is never above the terrain horizon here in the long-term model/);

    // 84.79S 29.2E (IM-2) is outside the 85-degree circle but inside the detail square's corner.
    expect((await polarAverageAt('illumination', -84.79, 29.2)).cellM).toBe(120);
    // 84S on an axis is outside the detail square: the wide map answers.
    expect((await polarAverageAt('illumination', -84, 0)).cellM).toBe(960);
    expect((await polarAverageAt('illumination', 88, -120)).layerId).toBe('north-illumination-detail');
  });

  it('has no number away from the poles, and says why', async () => {
    for (const [lat, lon] of [[0.67, 23.47], [-40, 100], [54, 0]]) {
      const r = await polarAverageAt('illumination', lat, lon);
      expect(r).toMatchObject({ available: false, percent: null, cellM: null, layerId: null });
      expect(r.text).toBe(`No long-term average is published for this point: NASA PGDA product 69 maps only the polar regions (complete poleward of 65°${lat < 0 ? 'S' : 'N'}).`);
    }
    // Between 65 and 55.2 degrees the square's corners still hold data.
    expect((await polarAverageAt('illumination', -58, 45)).available).toBe(true);
    expect((await polarAverageAt('illumination', -58, 0)).available).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------

describe.skipIf(!import.meta.env.LUNYX_LIVE && !(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LUNYX_LIVE)('live: the source files on the LOLA team server', () => {
  it('the recorded source pixels are what the server holds today', async () => {
    let read = 0;
    for (const l of index.layers) {
      for (const c of [...l.checks, l.brightest]) {
        const start = (c.sourceLine * l.source.sizePx + c.sourceSample) * 2;
        const res = await fetch(l.source.url, { headers: { Range: `bytes=${start}-${start + 1}` } });
        expect(res.status, l.source.url).toBe(206);
        const dn = new DataView(await res.arrayBuffer()).getInt16(0, true);
        expect(dn * 0.00004, `${l.id}: ${c.name ?? 'brightest'}`).toBeCloseTo(c.sourceFraction, 5);
        read++;
      }
    }
    console.log(`read ${read} pixels from the source files: all as recorded`);
    expect(read).toBeGreaterThan(40);
  }, 120_000);
});
