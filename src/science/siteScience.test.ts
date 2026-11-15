// The site-science readouts on the bundled data (no network).
import { describe, expect, it } from 'vitest';
import { averagesReadout, bearingDeg, dsnReadout, iceReadout, NOT_INCLUDED, shadowCamReadout, siteScience, temperatureReadout } from './siteScience';

const IM2 = { lat: -84.79, lon: 29.2 };
/** The most sunlit ground on Shackleton's rim in the 120 m average map (10.7 km from the crater's centre). */
const SHACKLETON_RIM = { lat: -89.686, lon: -163.457 };
const SHACKLETON_FLOOR = { lat: -89.67, lon: 129.78 };
const APOLLO_11 = { lat: 0.67416, lon: 23.47314 };

const plainJson = (v: unknown): void => expect(JSON.parse(JSON.stringify(v))).toEqual(v);

describe('long-term averages', () => {
  it('reads the published averages near the south pole and says there are none elsewhere', async () => {
    const rim = await averagesReadout(SHACKLETON_RIM);
    if (!('sunlight' in rim)) throw new Error(rim.reason);
    expect(rim.available).toBe(true);
    // The rim of Shackleton is among the most sunlit ground at the pole (73 % in the 120 m cells); Earth is in view part of the time.
    expect(rim.sunlight).toMatchObject({ available: true, pctOfTime: 73, neverInModel: false, cellM: 120 });
    expect(rim.earthVisibility).toMatchObject({ available: true, pctOfTime: 52, cellM: 120 });
    expect(rim.sunlight.text).toContain('multi-year average');
    expect(rim.sunlight.source).toMatch(/^AVGVISIB_85S_060M_201608 /);
    expect(rim.kind).toContain('not the geometry of the simulated date');
    expect(rim.averagingPeriod).toContain('18.6 years');
    expect(rim.citation).toContain('Mazarico');
    // Shackleton's floor: never sunlit in the model.
    const floor = await averagesReadout(SHACKLETON_FLOOR);
    expect('sunlight' in floor && floor.sunlight).toMatchObject({ available: true, pctOfTime: 0, neverInModel: true });
    // Tranquility Base: no such map.
    const equator = await averagesReadout(APOLLO_11);
    expect(equator.available).toBe(false);
    expect('sunlight' in equator && equator.sunlight.text).toContain('only the polar regions');
    plainJson(rim);
  });
});

describe('ice targets', () => {
  it('lists the nearest mapped regions with distance, bearing, credit and the data notes', async () => {
    const r = await iceReadout(SHACKLETON_RIM, 5);
    if (!r.available) throw new Error(r.reason);
    expect(r.mappedRegions).toBe(169);
    expect(r.nearest).toHaveLength(5);
    // Shackleton itself is mapped: the rim point lies within a few kilometres of its outline.
    const shackleton = r.nearest.find((t) => t.label === 'Shackleton');
    expect(shackleton?.distanceKm).toBeLessThan(5);
    for (let i = 1; i < r.nearest.length; i++) expect(r.nearest[i].distanceKm!).toBeGreaterThanOrEqual(r.nearest[i - 1].distanceKm!);
    for (const t of r.nearest) {
      if (!t.insideOutline) {
        expect(t.bearingDeg!).toBeGreaterThanOrEqual(0);
        expect(t.bearingDeg!).toBeLessThan(360);
      }
      expect(t.measuredTo).toBe('area-outline');
    }
    expect(r.distanceMeaning).toContain('not a traverse');
    expect(r.credit).toContain('Lemelin');
    expect(r.credit).toContain('CC-BY-4.0');
    expect(r.dataNotes.join(' ')).toContain('Wiechert J');
    plainJson(r);
    // Far from the south pole nothing is within reach, and the readout says so instead of listing distant regions.
    expect(await iceReadout(APOLLO_11, 3)).toMatchObject({ available: true, nearest: [], note: expect.stringContaining('south polar region only') });
  });

  it('gives compass bearings', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -10 })).toBeCloseTo(270, 6);
  });
});

describe('surface temperature (Diviner)', () => {
  it('gives the annual maximum and annual mean, labelled as annual, with source and licence', async () => {
    const floor = await temperatureReadout(SHACKLETON_FLOOR);
    if (!('status' in floor)) throw new Error(floor.reason);
    expect(floor).toMatchObject({ available: true, status: 'ok', annualMaxK: 92, annualMeanK: 58, cellM: 240, measuredOver: 'July 2009 to February 2019' });
    expect(floor.text).toMatch(/^Annual maximum temperature 92 K, annual mean 58 K here \(LRO Diviner, 240 m cell/);
    expect(floor.text).toContain('separate summer and winter maps are not included');
    expect(floor.kind).toContain('not the temperature at the simulated date');
    expect(floor.notIncluded).toContain('Separate summer and winter maps are not included');
    expect(floor.licence).toMatch(/^CC0 1\.0/);
    expect(floor.citation).toContain('10.7910/DVN/EGOOCL');
    // IM-2 on Mons Mouton: sunlit ground, far warmer than the crater floor.
    const im2 = await temperatureReadout(IM2);
    expect(im2).toMatchObject({ available: true, status: 'ok', annualMaxK: 226, annualMeanK: 127 });
    plainJson(floor);
  });

  it('keeps the three "no value" cases apart', async () => {
    // Equatorward of 80 degrees there is no map.
    const equator = await temperatureReadout(APOLLO_11);
    expect(equator).toMatchObject({ available: false, status: 'outside', annualMaxK: null, annualMeanK: null, cellM: null });
    expect('text' in equator && equator.text).toContain('poleward of 80°');
    // A cell the authors left empty stays empty (80.5378S 0.622E is one of them).
    const empty = await temperatureReadout({ lat: -80.5378, lon: 0.622 });
    expect(empty).toMatchObject({ available: false, status: 'empty', annualMaxK: null, annualMeanK: null, cellM: 240 });
    expect('text' in empty && empty.text).toContain('nothing is filled in');
  });
});

describe('ShadowCam', () => {
  it('links to the mosaics that cover a point and bundles no image', async () => {
    const r = await shadowCamReadout(SHACKLETON_FLOOR);
    if (!('mosaics' in r)) throw new Error(r.reason);
    expect(r.available).toBe(true);
    expect(r.imagesBundled).toBe(false);
    expect(r.mosaics.map((m) => m.id)).toEqual(['shackleton02', 'shackleton01']); // newest images first
    expect(r.mosaics[1]).toMatchObject({
      site: 'Shackleton Crater',
      url: 'https://pds.shadowcam.im-ldi.com/derived/cmosaic/shackleton01/',
      season: 'summer',
      localTime: '11am',
      imagesFrom: '2023-02-22',
      imagesTo: '2023-02-23',
      pixelScaleM: 2,
    });
    expect(r.text).toContain('The images are not included in the app');
    expect(r.credit).toBe('NASA/KARI/Arizona State University');
    expect(r.licence).toContain('No licence or usage statement was found in the archive');
    expect(r.coverageMeaning).toContain('200 m grid');
    expect(r.mosaicsInIndex).toBe(26);
    plainJson(r);
    // Where the archive contradicts itself, the entry passes that on.
    const amundsen = await shadowCamReadout({ lat: -84.2, lon: 85 });
    if ('mosaics' in amundsen && amundsen.mosaics.length) expect(amundsen.mosaics[0].archiveDisagreements?.[0]).toContain('pixel scale');
  });

  it('says plainly when nothing covers the point', async () => {
    for (const p of [IM2, APOLLO_11]) {
      const r = await shadowCamReadout(p);
      expect(r, JSON.stringify(p)).toMatchObject({ available: false, mosaics: [] });
      expect('text' in r && r.text).toMatch(/^No ShadowCam controlled mosaic covers this point/);
    }
    // One of the two Shackleton mosaics reaches beyond the crater floor to this sunlit rim point.
    const rim = await shadowCamReadout(SHACKLETON_RIM);
    expect('mosaics' in rim && rim.mosaics.map((m) => m.id)).toEqual(['shackleton01']);
  });
});

describe('everything for a site', () => {
  it('states why there is no DSN readout when there is no analysis', () => {
    expect(dsnReadout({ state: 'idle' })).toEqual({ available: false, reason: 'No site is selected.' });
  });

  it('gathers all five readouts; an equatorial site has DSN geometry only', async () => {
    const polar = await siteScience(SHACKLETON_FLOOR, { state: 'idle' });
    expect(Object.keys(polar)).toEqual(['dsn', 'longTermAverages', 'iceTargets', 'surfaceTemperature', 'shadowCam', 'notIncluded']);
    expect(polar.longTermAverages.available && polar.iceTargets.available && polar.surfaceTemperature.available && polar.shadowCam.available).toBe(true);
    expect(polar.notIncluded).toBe(NOT_INCLUDED);
    expect(polar.notIncluded[0]).toContain('Diviner');
    expect(polar.notIncluded.join(' ')).toMatch(/separate summer and winter maps are not included.*ShadowCam images are not bundled/);
    plainJson(polar);

    const equator = await siteScience(APOLLO_11, { state: 'idle' });
    expect(equator.longTermAverages.available).toBe(false);
    expect(equator.iceTargets).toMatchObject({ available: true, nearest: [] });
    expect(equator.surfaceTemperature).toMatchObject({ available: false, status: 'outside' });
    expect(equator.shadowCam).toMatchObject({ available: false, mosaics: [] });
  });
});
