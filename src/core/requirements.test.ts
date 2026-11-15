import { describe, expect, it } from 'vitest';
import { DEFAULT_SUN_BAND, NO_SUN_BAND_TEXT, sunBandRequired } from './requirements';
import { initialState } from './store';

describe('the solar elevation band as a requirement', () => {
  it('is no requirement at the Filters default, which is the band the app starts with', () => {
    const s = initialState(0);
    expect({ minDeg: s.sunElMinDeg, maxDeg: s.sunElMaxDeg }).toEqual(DEFAULT_SUN_BAND);
    expect(sunBandRequired(s)).toBe(false);
    expect(NO_SUN_BAND_TEXT).toMatch(/^No solar elevation band is required/);
  });

  it('is one as soon as either end is moved', () => {
    expect(sunBandRequired({ sunElMinDeg: 2, sunElMaxDeg: 90 })).toBe(true);
    expect(sunBandRequired({ sunElMinDeg: 0, sunElMaxDeg: 60 })).toBe(true);
    expect(sunBandRequired({ sunElMinDeg: -90, sunElMaxDeg: 90 })).toBe(true);
  });
});
