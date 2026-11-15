// The ShadowCam mosaic index (public/data/science/shadowcam), read from disk under vitest.
// Set LUNYX_LIVE=1 to also check that every linked product still answers in the archive.
import { describe, expect, it } from 'vitest';
import { polarLatLon, polarXY } from '../terrain/geo';
import { readTerrainFile } from '../terrain/reader';
import { loadShadowCam, shadowCamMosaicsAt, ShadowCamLayer } from './shadowCam';

const layer = await loadShadowCam();
const { index } = layer;
const byId = (id: string) => index.mosaics.find((m) => m.id === id)!;

describe('what is packaged', () => {
  it('an index of the 26 controlled mosaics, and no imagery', async () => {
    expect(index.mosaics).toHaveLength(26);
    expect(index.mosaics.filter((m) => m.pole === 'S')).toHaveLength(20);
    expect(index.mosaics.filter((m) => m.pole === 'N')).toHaveLength(6);
    expect(new Set(index.mosaics.map((m) => m.id)).size).toBe(26);
    expect([...new Set(index.mosaics.map((m) => m.site))].sort()).toEqual([
      'Amundsen Crater', 'Cabeus B Crater', 'Faustini Crater', 'Hermite A Crater', 'Hinshelwood Crater', "Idel'son L Crater", 'Kocher Crater', 'Kuhn Crater',
      'Lovelace E Crater', 'Shackleton Crater', 'Shoemaker Crater', 'Sylvester N Crater', 'Unnamed PSR within Rozhdestvenskiy Crater', 'Wiechert J Crater',
    ]);
    // Small: tens of kilobytes, because it holds outlines and links, not pictures.
    const coverage = await readTerrainFile(`data/science/shadowcam/${index.coverage.file}`);
    expect(coverage.byteLength).toBe(index.coverage.bytes);
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', coverage))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(digest).toBe(index.coverage.sha256);
    expect(coverage.byteLength).toBeLessThan(100_000);
    expect((await readTerrainFile('data/science/shadowcam/index.json')).byteLength).toBeLessThan(80_000);
    expect(index.what).toMatch(/No ShadowCam imagery is bundled/);
  });

  it('records the credit line, the missing licence statement and how to cite', () => {
    expect(index.credit).toBe('NASA/KARI/Arizona State University');
    expect(index.creditNote).toMatch(/NASA\/KARI\/Intuitive Machines/);
    expect(index.licence).toMatch(/No licence or usage statement was found in the archive/);
    expect(index.licence).toMatch(/links to the products and bundles none of the imagery/);
    expect(index.archive).toMatchObject({ doi: '10.17189/y89z-kt98', url: 'https://pds.shadowcam.im-ldi.com/' });
    expect(index.citation[0]).toMatch(/^Grieser, S\. A\., Collins, W\. M\., Henriksen, M\. R\., Mahanti, P\., & Robinson, M\. S\. \(2025\)\. ShadowCam Controlled Mosaics/);
    expect(index.citation.join(' ')).toMatch(/10\.3390\/rs18030525/);
    expect(index.release).toMatch(/released up through September 2026/);
    expect(index.seasonDefinition).toMatch(/summer when the subsolar latitude is more than 1 degree into that pole's hemisphere/);
  });

  it('every entry is complete and links into the ShadowCam PDS archive', () => {
    for (const m of index.mosaics) {
      expect(m.productId, m.id).toMatch(new RegExp(`^shadowcam_cmosaic_${m.id}_p\\d{3}[ns]\\d{4}_(summer|winter|spring|fall)_\\d{2}(am|pm)$`));
      expect(m.lid).toBe(`urn:nasa:pds:kplo-shadowcam:derived-cmosaic:${m.productId}`);
      expect(m.productUrl).toBe(`https://pds.shadowcam.im-ldi.com/derived/cmosaic/${m.id}/`);
      expect(m.readmeUrl).toBe(`${m.productUrl}${m.productId}_readme.txt`);
      expect(m.preview20m?.url).toBe(`${m.productUrl}${m.productId}_20m_cog.tif`);
      expect(m.preview20m!.bytes).toBeGreaterThan(1e6);
      // The product id encodes the pole, the centre, the season and the hour: they must agree with the fields.
      const code = /_p(\d{3})([ns])(\d{4})_(\w+)_(\d{2}(?:am|pm))$/.exec(m.productId)!;
      expect(code[2] === 's' ? 'S' : 'N').toBe(m.pole);
      expect(Math.abs(Number(code[1]) / 10 - Math.abs(m.center.lat)), m.id).toBeLessThan(0.06);
      const lon360 = ((m.center.lon % 360) + 360) % 360;
      expect(Math.abs(Number(code[3]) / 10 - lon360), m.id).toBeLessThan(0.06);
      expect(code[4]).toBe(m.season);
      expect(code[5]).toBe(m.localTime);
      expect(m.imageStart, m.id).toMatch(/^20\d\d-\d\d-\d\d$/);
      expect(m.imageStop! >= m.imageStart!).toBe(true);
      // The archive's title names the month of the images; the readme's dates begin or end in it.
      const month = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      const monthAgrees = m.title.includes(month(m.imageStart!)) || m.title.includes(month(m.imageStop!));
      // ...except where the archive contradicts itself, which the entry then states.
      expect(monthAgrees, `${m.id}: ${m.title} / ${m.imageStart}..${m.imageStop}`).toBe(!m.sourceDisagreements?.some((d) => d.startsWith('month of the images')));
      expect(m.title).toContain(m.imageStop!.slice(0, 4));
      expect(m.images).toBeGreaterThan(2);
      expect(m.pixelScaleM).toBeGreaterThan(1);
      expect(m.pixelScaleM).toBeLessThanOrEqual(2);
      // Links to the LROC PSR atlas, exactly as each readme writes them (by number, or by the PSR's own id).
      for (const p of m.psr) expect(p.url).toMatch(/^https:\/\/lroc\.im-ldi\.com\/atlases\/psr\/(\d+|[NS]P_\d+_\d+)$/);
    }
    // Where the archive contradicts itself, the entry says so rather than choosing silently.
    expect(byId('amundsen01').sourceDisagreements).toEqual(['pixel scale: outline table 2 m, product readme 1.00 m/px']);
    expect(byId('shoemaker01').sourceDisagreements).toEqual(['number of images: outline table 34, product readme 35']);
    expect(byId('cabeusb01').sourceDisagreements).toEqual(["month of the images: the outline table's title says August 2023, the product readme dates them 2023-09-02 to 2023-09-03"]);
    expect(index.mosaics.filter((m) => m.sourceDisagreements)).toHaveLength(3);
  });
});

describe('coverage', () => {
  it('the 200 m grids reproduce the area of the published footprints', () => {
    for (const m of index.mosaics) {
      const km2 = (layer.coveredCells(m) * index.coverage.cellM ** 2) / 1e6;
      expect(km2, m.id).toBeCloseTo(m.sampledCoverageKm2, 1);
      expect(Math.abs(km2 - m.footprintKm2) / m.footprintKm2, m.id).toBeLessThan(0.01);
      // The table's own area figure is close to its polygon, but not identical (up to 3.4 % for the simpler outlines).
      expect(Math.abs(m.footprintKm2 - m.statedCoverageKm2) / m.statedCoverageKm2, m.id).toBeLessThan(0.04);
    }
  });

  it('is the right way round at both poles: the grids fill the latitude/longitude boxes the archive states', () => {
    // The authors trimmed each mosaic to a box given in latitude and longitude. In the projection that box
    // becomes a rectangle; the coverage must sit inside it, and its mirror image must not.
    let mirroredOutside = 0;
    for (const m of index.mosaics) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k <= 200; k++) {
        const f = k / 200;
        const lon = m.trim.minLon + f * (m.trim.maxLon - m.trim.minLon);
        const lat = m.trim.minLat + f * (m.trim.maxLat - m.trim.minLat);
        for (const [la, lo] of [[m.trim.minLat, lon], [m.trim.maxLat, lon], [lat, m.trim.minLon], [lat, m.trim.maxLon]]) {
          const p = polarXY(m.pole, la, lo);
          x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
        }
      }
      const c = m.coverage;
      const cell = index.coverage.cellM;
      let total = 0, inside = 0, mirrored = 0;
      for (let row = 0; row < c.rows; row++) {
        for (let col = 0; col < c.cols; col++) {
          const x = c.left + (col + 0.5) * cell;
          const y = c.top - (row + 0.5) * cell;
          const p = polarLatLon(m.pole, x, y);
          if (!layer.covers(m, p.lat, p.lon)) continue;
          total++;
          // Half a cell of slack: the grid is aligned to whole multiples of 200 m, the trim box is not.
          if (x >= x0 - cell / 2 && x <= x1 + cell / 2 && y >= y0 - cell / 2 && y <= y1 + cell / 2) inside++;
          if (-x >= x0 && -x <= x1 && y >= y0 && y <= y1) mirrored++;
        }
      }
      expect(total, m.id).toBe(layer.coveredCells(m));
      expect(inside / total, m.id).toBe(1);
      if (mirrored / total < 0.01) mirroredOutside++;
      else expect(mirrored / total, m.id).toBeLessThan(0.7); // near the pole or the 0/180 meridian a mirror image overlaps
    }
    // Measured: 23 of the 26 footprints have no mirrored cell inside their box at all (the others are
    // Shackleton, at the pole, and Wiechert J, on the 180-degree meridian).
    expect(mirroredOutside).toBe(23);
  });

  it('finds the mosaics that cover well-known shadowed craters, and nothing where there is none', () => {
    const ids = (lat: number, lon: number): string[] => layer.mosaicsAt(lat, lon).map((m) => m.id);
    // Shackleton (IAU 89.67S 129.78E): both mosaics, newest images first.
    expect(ids(-89.67, 129.78)).toEqual(['shackleton02', 'shackleton01']);
    // Faustini (IAU 87.18S 84.31E): all eleven lightings of it.
    expect(ids(-87.18, 84.31)).toHaveLength(11);
    expect(ids(-87.18, 84.31).every((id) => id.startsWith('faustini'))).toBe(true);
    // Hermite A, north pole.
    expect(ids(87.99, 308.2 - 360).sort()).toEqual(['hermitea01', 'hermitea02']);
    // The same latitude and longitude mirrored into the other hemisphere, the equator, a landing site.
    expect(ids(89.67, 129.78)).toEqual([]);
    expect(ids(0, 0)).toEqual([]);
    expect(ids(-84.79, 29.2)).toEqual([]); // IM-2 on Mons Mouton: sunlit ground, no shadow mosaic
    expect(ids(Number.NaN, 0)).toEqual([]);
    // A footprint follows the image strips: Amundsen's stated centre falls in a gap of its own mosaic.
    const amundsen = byId('amundsen01');
    expect(layer.covers(amundsen, amundsen.center.lat, amundsen.center.lon)).toBe(false);
    // Every other mosaic covers its stated centre.
    for (const m of index.mosaics) if (m.id !== 'amundsen01') expect(layer.covers(m, m.center.lat, m.center.lon), m.id).toBe(true);
  });

  it('gives the authors\' bounding outline as latitude and longitude for drawing', () => {
    for (const m of index.mosaics) {
      const ring = layer.outlineLatLon(m);
      expect(ring.length, m.id).toBeGreaterThanOrEqual(10);
      expect(ring[0].lat).toBeCloseTo(ring[ring.length - 1].lat, 9); // closed
      expect(ring[0].lon).toBeCloseTo(ring[ring.length - 1].lon, 9);
      expect(ring.every((p) => (m.pole === 'S' ? p.lat < -80 : p.lat > 80))).toBe(true);
      // The outline is a loose hull: it contains the footprint grid's covered cells' bounding box centre.
      const xs = m.outline.filter((_, i) => i % 2 === 0);
      const ys = m.outline.filter((_, i) => i % 2 === 1);
      const c = m.coverage;
      const gx = c.left + (c.cols * index.coverage.cellM) / 2;
      const gy = c.top - (c.rows * index.coverage.cellM) / 2;
      expect(gx > Math.min(...xs) && gx < Math.max(...xs) && gy > Math.min(...ys) && gy < Math.max(...ys), m.id).toBe(true);
    }
  });

  it('refuses a coverage file that does not match the index', () => {
    expect(() => new ShadowCamLayer(index, [new Uint8Array(4)])).toThrow(/does not match the index/);
  });
});

describe('shadowCamMosaicsAt', () => {
  it('lists the mosaics with what a reader needs: place, lighting, dates, resolution, link, credit', async () => {
    const r = await shadowCamMosaicsAt(-89.67, 129.78);
    expect(r.hits).toHaveLength(2);
    expect(r.credit).toBe('NASA/KARI/Arizona State University');
    expect(r.text).toBe('2 ShadowCam controlled mosaics cover this point. The images are not included in the app: follow the link to the ShadowCam PDS archive. Credit: NASA/KARI/Arizona State University.');
    expect(r.hits[1]).toMatchObject({
      label: 'ShadowCam mosaic: Shackleton Crater, summer, 11 am',
      url: 'https://pds.shadowcam.im-ldi.com/derived/cmosaic/shackleton01/',
      text: 'ShadowCam controlled mosaic of Shackleton Crater: local summer, about 11 am local time, images of 2023-02-22 to 2023-02-23, 2 m per pixel.',
    });
    expect(r.hits[0].text).toBe('ShadowCam controlled mosaic of Shackleton Crater: local fall, about 3 pm local time, images of 2025-04-05 to 2025-04-06, 1.1 m per pixel.');
    const one = await shadowCamMosaicsAt(byId('kuhn01').center.lat, byId('kuhn01').center.lon);
    expect(one.text).toMatch(/^One ShadowCam controlled mosaic covers this point\./);
    expect(one.hits[0].text).toBe('ShadowCam controlled mosaic of Kuhn Crater: local fall, about 10 am local time, images of 2026-03-13, 2 m per pixel.');
  });

  it('says plainly when nothing covers the point', async () => {
    const r = await shadowCamMosaicsAt(0.67, 23.47);
    expect(r.hits).toEqual([]);
    expect(r.text).toBe('No ShadowCam controlled mosaic covers this point (the archive index lists 26 mosaics of 14 permanently shadowed sites).');
  });
});

// ------------------------------------------------------------------------------------------

describe.skipIf(!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.LUNYX_LIVE)('live: the ShadowCam PDS archive', () => {
  it('every linked product folder, readme and 20 m version still answers', async () => {
    let checked = 0;
    for (const m of index.mosaics) {
      for (const url of [m.productUrl, m.readmeUrl, m.preview20m!.url]) {
        const res = await fetch(url, { method: 'HEAD' });
        expect(res.status, url).toBe(200);
        checked++;
      }
      expect(Number((await fetch(m.preview20m!.url, { method: 'HEAD' })).headers.get('content-length')), m.id).toBe(m.preview20m!.bytes);
    }
    console.log(`checked ${checked} links into the ShadowCam PDS archive: all answer`);
    expect(checked).toBe(78);
  }, 240_000);
});
