// The packaged Diviner annual-temperature maps (public/data/science/diviner), read from disk
// under vitest. Set LUNYX_LIVE=1 to also re-read the recorded cells from Harvard Dataverse.
import { describe, expect, it } from 'vitest';
import { surfaceDistanceM } from '../terrain/geo';
import { readTerrainFile } from '../terrain/reader';
import { loadPolarAverage, polarAverageUv, type Pole } from './polarAverages';
import { loadPolarTemperature, loadPolarTemperatureIndex, polarTemperatureAt, PolarTemperatureMap, type PolarTemperatureCheck } from './polarTemperatures';

const index = await loadPolarTemperatureIndex();
const maps = new Map<string, PolarTemperatureMap>();
for (const l of index.layers) maps.set(l.id, await loadPolarTemperature(l.quantity, l.pole));
const map = (id: string): PolarTemperatureMap => maps.get(id)!;
const R = 1_737_400;
const DEG = Math.PI / 180;

/** The projection of the source tables (x = r sin lon; y = r cos lon south, -r cos lon north), written out again for the tests. */
function tablePixel(pole: Pole, lat: number, lon: number, size: number, metresPerPx: number): { row: number; col: number } {
  const colat = pole === 'S' ? 90 + lat : 90 - lat;
  const r = (2 * R * Math.tan((colat / 2) * DEG)) / metresPerPx;
  const c = size / 2 - 0.5;
  return { row: c - (pole === 'S' ? 1 : -1) * r * Math.cos(lon * DEG), col: c + r * Math.sin(lon * DEG) };
}

describe('what is packaged', () => {
  it('four maps: annual maximum and annual mean for each pole, at the published 240 m grid', async () => {
    expect(index.layers.map((l) => l.id)).toEqual(['south-annual-max', 'south-annual-mean', 'north-annual-max', 'north-annual-mean']);
    let total = 0;
    for (const l of index.layers) {
      const bytes = await readTerrainFile(`data/science/diviner/${l.file}`);
      expect(bytes.byteLength, l.file).toBe(l.bytes);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
      expect(digest, l.file).toBe(l.sha256);
      expect(l.bytes).toBeLessThan(3.5e6);
      total += l.bytes;
      expect(l.size).toBe(2533);
      // 2533 cells across the 80-degree circle: 2 * 2 R tan(5 deg) / 2533 = 240.04 m.
      expect(l.metresPerPx).toBeCloseTo((4 * R * Math.tan(5 * DEG)) / 2533, 2);
      expect(l.halfWidthM).toBeCloseTo(2 * R * Math.tan(5 * DEG), 0);
      expect(l.latCompleteTo).toBe(l.pole === 'S' ? -80 : 80);
      expect(l.source.dataset).toBe('https://doi.org/10.7910/DVN/EGOOCL');
      expect(l.source.licence).toBe('CC0 1.0');
      expect(l.source.md5).toMatch(/^[0-9a-f]{32}$/);
      expect(l.period).toBe(l.pole === 'S' ? 'July 2009 to February 2019' : 'July 2009 to January 2024');
    }
    expect(total).toBe(index.totalBytes);
    expect(total).toBeLessThan(10e6);
  });

  it('says "annual", names the source, and says what is not included', () => {
    expect(index.title).toMatch(/Annual maximum and annual mean/);
    expect(index.notIncluded).toMatch(/Separate summer and winter maps are not included/);
    expect(index.quantities['annual-max'].label).toBe('Annual maximum temperature (Diviner)');
    expect(index.quantities['annual-mean'].label).toBe('Annual mean temperature (Diviner)');
    for (const q of Object.values(index.quantities)) {
      expect(q.unit).toBe('K');
      expect(q.meaning).toMatch(/240 m cells/);
      expect(q.meaning).toMatch(/separate summer and winter maps are not included/);
    }
    // The authors' own descriptions, word for word.
    expect(index.quantities['annual-max'].sourceDescription).toBe('Maximum temperature, after frequency-domain Fourier-filtering [K]');
    expect(index.quantities['annual-mean'].sourceDescription).toBe('Mean temperature, averaged over ecliptic and subsolar longitudes [K]');
    expect(index.licence).toMatch(/^CC0 1\.0/);
    expect(index.citation).toMatch(/Schorghofer.*Williams.*10\.7910\/DVN\/EGOOCL.*10\.3847\/PSJ\/abb6ff.*Williams, J\.-P\., et al\. \(2019\)/);
    expect(index.caveats.join(' ')).toMatch(/1\.8 % of the cells inside 80 degrees south, 0\.01 % of the cells inside 80 degrees north/);
    expect(index.what).toMatch(/not the temperature at the date on screen/);
  });

  it('each map decodes to what its description says, with the empty cells still empty', () => {
    for (const l of index.layers) {
      const m = map(l.id);
      const c = l.size / 2 - 0.5;
      const rim = l.halfWidthM / l.metresPerPx;
      let min = Infinity, max = -Infinity, sum = 0, filled = 0, emptyInside = 0, filledOutside = 0, inside = 0;
      for (let i = 0; i < m.data.length; i++) {
        const within = Math.hypot((i % l.size) - c, Math.floor(i / l.size) - c) <= rim;
        if (within) inside++;
        const v = m.data[i];
        if (v === l.noData) {
          if (within) emptyInside++;
          continue;
        }
        filled++;
        if (!within) filledOutside++;
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      expect([inside, emptyInside, filledOutside], l.id).toEqual([l.stats.cellsInside80, l.stats.emptyInside80, l.stats.filledOutside80]);
      expect(min).toBe(Math.round(l.stats.minK));
      expect(max).toBe(Math.round(l.stats.maxK));
      expect(Math.abs(sum / filled - l.stats.meanK)).toBeLessThan(0.05);
      // Physically sensible: nothing colder than 20 K, nothing hotter than local noon at the equator.
      expect(min).toBeGreaterThan(20);
      expect(max).toBeLessThan(400);
    }
    // Both quantities of a pole are empty in the same cells.
    for (const pole of ['south', 'north']) {
      const a = map(`${pole}-annual-max`);
      const b = map(`${pole}-annual-mean`);
      let differ = 0;
      for (let i = 0; i < a.data.length; i++) if ((a.data[i] === a.info.noData) !== (b.data[i] === b.info.noData)) differ++;
      expect(differ, pole).toBe(0);
    }
  });
});

describe('values agree with the source files', () => {
  it('at the recorded cells the stored value is the source value rounded to 1 K', () => {
    let count = 0;
    for (const l of index.layers) {
      const m = map(l.id);
      const check = (c: PolarTemperatureCheck, what: string): void => {
        const stored = m.data[c.row * l.size + c.col];
        if (c.sourceK === null) {
          expect(stored, what).toBe(l.noData);
          return;
        }
        expect(stored, what).toBe(c.storedK);
        expect(Math.abs(stored - c.sourceK), what).toBeLessThanOrEqual(0.5);
        // The module finds that cell from the coordinates, by the projection of the source tables.
        const p = tablePixel(l.pole, c.lat, c.lon, l.size, l.metresPerPx);
        const here = m.pixelOf(c.lat, c.lon)!;
        expect(here.x, what).toBeCloseTo(p.col, 3);
        expect(here.y, what).toBeCloseTo(p.row, 3);
        if (Math.abs(p.col - Math.round(p.col)) < 0.49 && Math.abs(p.row - Math.round(p.row)) < 0.49) {
          expect([Math.round(p.row), Math.round(p.col)], what).toEqual([c.row, c.col]);
          expect(m.kelvinAt(c.lat, c.lon), what).toBe(c.storedK);
        }
        count++;
      };
      l.checks.forEach((c) => check(c, `${l.id}: ${c.name}`));
      check(l.coldest, `${l.id}: coldest`);
      check(l.warmest, `${l.id}: warmest`);
      expect(m.data[l.coldest.row * l.size + l.coldest.col]).toBe(Math.round(l.stats.minK));
      expect(m.data[l.warmest.row * l.size + l.warmest.col]).toBe(Math.round(l.stats.maxK));
    }
    expect(count).toBe(30); // 22 named cells and the coldest and warmest cell of each of the four maps
  });

  it('known geography: a cold crater floor, a warm sunlit rim', () => {
    const tmax = map('south-annual-max');
    const tmean = map('south-annual-mean');
    // Shackleton's floor (IAU 89.67S 129.78E) never sees the Sun: it stays below 110 K all year.
    expect(tmax.kelvinAt(-89.67, 129.78)).toBe(92);
    expect(tmean.kelvinAt(-89.67, 129.78)).toBe(58);
    // The pole itself is on the sunlit rim.
    expect(tmax.kelvinAt(-90, 0)).toBe(244);
    // The warmest annual mean of the south map is on Shackleton's rim near 89.78S 204.27E, one of the
    // most illuminated places at the pole (Mazarico et al. 2011): warm on average because it is rarely dark.
    const w = tmean.info.warmest;
    expect(surfaceDistanceM(w.lat, w.lon, -89.78, 204.27 - 360)).toBeLessThan(1000);
    expect(w.storedK).toBe(191);
    // The mean is never above the maximum.
    for (const pole of ['south', 'north']) {
      const a = map(`${pole}-annual-max`);
      const b = map(`${pole}-annual-mean`);
      let wrong = 0;
      for (let i = 0; i < a.data.length; i += 3) if (a.data[i] !== a.info.noData && b.data[i] > a.data[i]) wrong++;
      expect(wrong, pole).toBe(0);
    }
  });

  it('is the right way round at both poles: cold where the PGDA maps say the Sun never shines', async () => {
    // Two independent products: an illumination model (PGDA 69) and temperature measurements (Diviner).
    for (const pole of ['S', 'N'] as const) {
      const sun = await loadPolarAverage('illumination', pole, 'wide');
      const tmax = map(`${pole === 'S' ? 'south' : 'north'}-annual-max`);
      const contrast = (mirror: number): { dark: number; lit: number } => {
        let dark = 0, nDark = 0, lit = 0, nLit = 0;
        for (let y = 0; y < sun.size; y += 2) {
          for (let x = 0; x < sun.size; x += 2) {
            const p = sun.latLonOf(x, y);
            if (Math.abs(p.lat) < 80.2) continue;
            const k = tmax.kelvinAt(p.lat, mirror * p.lon);
            if (Number.isNaN(k)) continue;
            const v = sun.data[y * sun.size + x];
            if (v === 0) { dark += k; nDark++; } else if (v >= 30) { lit += k; nLit++; }
          }
        }
        expect(nDark).toBeGreaterThan(1500);
        return { dark: dark / nDark, lit: lit / nLit };
      };
      const right = contrast(1);
      const mirrored = contrast(-1);
      expect(right.dark, `${pole} never-lit cells`).toBeLessThan(130); // measured 101 K (S), 122 K (N)
      expect(right.lit, `${pole} sunlit cells`).toBeGreaterThan(235); // measured 253 K (S), 246 K (N)
      expect(mirrored.dark, `${pole} mirrored`).toBeGreaterThan(190); // measured 211 K (S), 221 K (N): the contrast is gone
    }
  });
});

describe('positions and textures', () => {
  it('cells and coordinates convert both ways; the map is a circle inside its square', () => {
    for (const l of index.layers) {
      const m = map(l.id);
      const c = l.size / 2 - 0.5;
      const pole = l.pole === 'S' ? -90 : 90;
      expect(m.pixelOf(pole, 0)!.x).toBeCloseTo(c, 3);
      expect(m.pixelOf(pole, 0)!.y).toBeCloseTo(c, 3);
      for (const [x, y] of [[c, c], [c + 300, c - 200], [10.5, 2000.25], [l.size - 1, c]]) {
        const p = m.latLonOf(x, y);
        const back = m.pixelOf(p.lat, p.lon)!;
        expect(back.x).toBeCloseTo(x, 3);
        expect(back.y).toBeCloseTo(y, 3);
      }
      // Longitude 0 is up for the south, down for the north; 90E is right for both.
      const lat = l.pole === 'S' ? -85 : 85;
      expect(l.pole === 'S' ? m.pixelOf(lat, 0)!.y < c : m.pixelOf(lat, 0)!.y > c).toBe(true);
      expect(m.pixelOf(lat, 90)!.x).toBeGreaterThan(c);
      // The corners of the square lie beyond 80 degrees and are empty; the other hemisphere has no position at all.
      const corner = m.latLonOf(3, 3);
      expect(Math.abs(corner.lat)).toBeLessThan(80);
      expect(m.covers(corner.lat, corner.lon)).toBe(true);
      expect(m.kelvinAt(corner.lat, corner.lon)).toBeNaN();
      expect(m.pixelOf(-lat, 0)).toBeNull();
      expect(m.kelvinAt(-lat, 0)).toBeNaN();
      // Same texture coordinates as the PGDA maps.
      const uv = polarAverageUv(l.pole, lat, 30, l.halfWidthM)!;
      expect(m.pixelOf(lat, 30)!.x).toBeCloseTo(uv.u * l.size - 0.5, 9);
    }
  });

  it('texture(): 0 where there is no value, 1..255 across the stated range', () => {
    const m = map('south-annual-max');
    const t = m.texture(40, 400);
    expect(t.length).toBe(m.data.length);
    const at = (lat: number, lon: number): number => {
      const p = m.pixelOf(lat, lon)!;
      return t[Math.round(p.y) * m.size + Math.round(p.x)];
    };
    expect(t[0]).toBe(0); // a corner of the square
    expect(at(-89.67, 129.78)).toBe(1 + Math.round(((92 - 40) * 254) / 360));
    expect(at(-90, 0)).toBe(1 + Math.round(((244 - 40) * 254) / 360));
    // Clamped, never 0 for a real value.
    const narrow = m.texture(200, 201);
    expect(narrow[Math.round(m.pixelOf(-89.67, 129.78)!.y) * m.size + Math.round(m.pixelOf(-89.67, 129.78)!.x)]).toBe(1);
    expect(narrow[Math.round(m.pixelOf(-90, 0)!.y) * m.size + Math.round(m.pixelOf(-90, 0)!.x)]).toBe(255);
    expect(() => m.texture(300, 300)).toThrow(/maxK/);
    expect(() => new PolarTemperatureMap(m.info, new Int16Array(4))).toThrow(/expected 2533x2533/);
  });
});

describe('polarTemperatureAt', () => {
  it('gives both annual values with wording that cannot be mistaken for a seasonal or dated value', async () => {
    const floor = await polarTemperatureAt(-89.67, 129.78);
    expect(floor).toMatchObject({ status: 'ok', annualMaxK: 92, annualMeanK: 58, cellM: 240, period: 'July 2009 to February 2019' });
    expect(floor.text).toBe(
      'Annual maximum temperature 92 K, annual mean 58 K here (LRO Diviner, 240 m cell, measurements from July 2009 to February 2019; Schorghofer & Williams, Harvard Dataverse, CC0). Annual values, not the temperature on the date shown; separate summer and winter maps are not included.',
    );
    const north = await polarTemperatureAt(88, 30);
    expect(north).toMatchObject({ status: 'ok', period: 'July 2009 to January 2024' });
    expect(north.annualMaxK!).toBeGreaterThan(north.annualMeanK!);
  });

  it('keeps an empty cell empty', async () => {
    // A cell inside 80S that the published maps leave without a value.
    const m = map('south-annual-max');
    const c = m.size / 2 - 0.5;
    let found: { lat: number; lon: number } | null = null;
    for (let i = 0; i < m.data.length && !found; i += 7) {
      if (m.data[i] !== m.info.noData) continue;
      const x = i % m.size;
      const y = Math.floor(i / m.size);
      if (Math.hypot(x - c, y - c) < 1200) found = m.latLonOf(x, y);
    }
    expect(found).not.toBeNull();
    const r = await polarTemperatureAt(found!.lat, found!.lon);
    expect(r).toMatchObject({ status: 'empty', annualMaxK: null, annualMeanK: null, cellM: 240 });
    expect(r.text).toMatch(/^The published Diviner maps of annual maximum and annual mean temperature have no value for this 240 m cell; nothing is filled in/);
  });

  it('has nothing equatorward of 80 degrees, and says so', async () => {
    for (const [lat, lon] of [[-79.9, 0], [0.67, 23.47], [79.99, 100], [-84.79, Number.NaN]]) {
      const r = await polarTemperatureAt(lat, lon);
      expect(r).toMatchObject({ status: 'outside', annualMaxK: null, annualMeanK: null, cellM: null });
      expect(r.text).toBe('No Diviner temperature map for this point: the annual maximum and annual mean maps cover only latitudes poleward of 80° (Schorghofer & Williams, Harvard Dataverse).');
    }
    expect((await polarTemperatureAt(-80.0, 45)).status).not.toBe('outside');
  });
});

// ------------------------------------------------------------------------------------------

describe.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LUNYX_LIVE)('live: the source files on Harvard Dataverse', () => {
  it('the recorded cells are what the repository holds today', async () => {
    let read = 0;
    for (const l of index.layers) {
      for (const c of [...l.checks, l.coldest, l.warmest]) {
        if (c.sourceK === null) continue;
        // Big-endian float32; the file's rows run from the bottom of this layout to the top.
        const start = l.source.dataOffset + ((l.size - 1 - c.row) * l.size + c.col) * 4;
        const res = await fetch(l.source.url, { headers: { Range: `bytes=${start}-${start + 3}` } });
        expect(res.status, l.source.url).toBe(206);
        const k = new DataView(await res.arrayBuffer()).getFloat32(0, false);
        expect(k, `${l.id}: ${c.name ?? 'extreme'}`).toBeCloseTo(c.sourceK, 2);
        read++;
      }
    }
    console.log(`read ${read} cells from Harvard Dataverse: all as recorded`);
    expect(read).toBeGreaterThan(25);
  }, 180_000);
});
