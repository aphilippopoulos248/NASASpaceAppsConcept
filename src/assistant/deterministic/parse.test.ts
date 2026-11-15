import { describe, expect, it } from 'vitest';
import { compassAzimuth, findCoordinates, findDateTime, findDuration, findNumbers, normalise, splitSteps, splitWeak } from './parse';

describe('normalise and split', () => {
  it('folds typography and trailing punctuation', () => {
    expect(normalise('  Go to  89.5°S, 135°E!! ')).toBe('go to 89.5 deg s, 135 deg e');
    expect(normalise('Delay by −24 h.')).toBe('delay by -24 h');
  });

  it('splits on "then", semicolons and sentence ends, but not inside numbers or on plain "and"', () => {
    expect(splitSteps('Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates, then show me the ridge at Earthset.')).toEqual([
      'Find a flatter nearby site with a shorter blackout, compare it against this pin for the same dates',
      'show me the ridge at Earthset.',
    ]);
    expect(splitSteps('go to 89.5 S 135.25 E; enter the surface. Then look north')).toEqual(['go to 89.5 S 135.25 E', 'enter the surface', 'look north']);
    expect(splitSteps('compare A and B')).toEqual(['compare A and B']);
    expect(splitSteps('go to Apollo 11 and then enter the surface')).toEqual(['go to Apollo 11', 'enter the surface']);
  });

  it('splits weakly on commas and "and"', () => {
    expect(splitWeak('find a flatter nearby site, compare it against this pin')).toEqual(['find a flatter nearby site', 'compare it against this pin']);
    expect(splitWeak('go to Apollo 11 and enter the surface')).toEqual(['go to Apollo 11', 'enter the surface']);
  });
});

describe('durations and numbers', () => {
  it('reads durations in hours', () => {
    expect(findDuration('delay by 24 h')?.hours).toBe(24);
    expect(findDuration('2 days later')?.hours).toBe(48);
    expect(findDuration('90 min')?.hours).toBe(1.5);
    expect(findDuration('a day late')?.hours).toBe(24);
    expect(findDuration('half a day')?.hours).toBe(12);
    expect(findDuration('1.5 hours')?.hours).toBe(1.5);
    expect(findDuration('two weeks')?.hours).toBe(336);
    expect(findDuration('+6h')?.hours).toBe(6);
    expect(findDuration('no duration here')).toBeNull();
    expect(findDuration('mast 10 m')).toBeNull();
  });

  it('lists plain numbers', () => {
    expect(findNumbers('sun elevation between 5 and 60.5 degrees')).toEqual([5, 60.5]);
    expect(findNumbers('compare mast 2 m and 10 m')).toEqual([2, 10]);
    expect(findNumbers('apollo 11')).toEqual([11]);
  });
});

describe('dates', () => {
  it('reads ISO and written dates as UTC', () => {
    expect(findDateTime('set time to 2026-03-01 12:00')?.utc).toBe('2026-03-01T12:00Z');
    expect(findDateTime('2026-03-01t06:30z')?.utc).toBe('2026-03-01T06:30Z');
    expect(findDateTime('go to 2025-03-14')?.utc).toBe('2025-03-14T00:00Z');
    expect(findDateTime('14 march 2025 06:00')?.utc).toBe('2025-03-14T06:00Z');
    expect(findDateTime('march 14, 2025 at 18:45')?.utc).toBe('2025-03-14T18:45Z');
    expect(findDateTime('3rd of jan 2027')?.utc).toBe('2027-01-03T00:00Z');
  });

  it('rejects impossible dates and text without a date', () => {
    expect(findDateTime('2026-02-30')).toBeNull();
    expect(findDateTime('2026-13-01 10:00')).toBeNull();
    expect(findDateTime('tomorrow morning')).toBeNull();
  });
});

describe('coordinates', () => {
  it('reads hemisphere, labelled and bare pairs (east-positive)', () => {
    expect(findCoordinates('drop a pin at 89.45 s, 137.2 w')).toMatchObject({ lat: -89.45, lon: -137.2 });
    expect(findCoordinates(normalise('go to 89.5°S 135°E'))).toMatchObject({ lat: -89.5, lon: 135 });
    expect(findCoordinates('84.8 deg south, 29.2 deg east')).toMatchObject({ lat: -84.8, lon: 29.2 });
    expect(findCoordinates('lat -85.3 lon 31.2')).toMatchObject({ lat: -85.3, lon: 31.2 });
    expect(findCoordinates('latitude -89.45, longitude 222.8')).toMatchObject({ lat: -89.45, lon: 222.8 });
    expect(findCoordinates('pin -89.45, 222.8')).toMatchObject({ lat: -89.45, lon: 222.8 });
    expect(findCoordinates('(10.5, -45)')).toMatchObject({ lat: 10.5, lon: -45 });
  });

  it('refuses out-of-range values and text without a pair', () => {
    expect(findCoordinates('lat 95 lon 10')).toBeNull();
    expect(findCoordinates('go to apollo 11')).toBeNull();
    expect(findCoordinates('mast 10 m')).toBeNull();
  });
});

describe('compass', () => {
  it('maps compass words to azimuths', () => {
    expect(compassAzimuth('north')).toBe(0);
    expect(compassAzimuth('south east')).toBe(135);
    expect(compassAzimuth('sw')).toBe(225);
    expect(compassAzimuth('up')).toBeNull();
  });
});
