// Colours shared by the globe's overlays and their legends, so the two always agree.

/** 0..100 % ramp of the multi-year average maps, low to high (dark to light, colour-blind safe order). */
export const OVERLAY_RAMP = ['#2b1a5a', '#3f4c9a', '#2f86a6', '#36b38c', '#9bd35c', '#f4e45a'] as const;
/** "Sun inside the required band" in the sun-band overlay. */
export const SUN_BAND_COLOUR = '#ffd479';

/** Outlines of the elevation data coverage, finest polar grid first, then the site windows. */
export const COVERAGE_STYLE = [
  { key: 'polar-40', colour: '#ff6fcf', label: 'LOLA south pole, 40 m grid' },
  { key: 'polar-80', colour: '#b98cff', label: 'LOLA south pole, 80 m grid' },
  { key: 'polar-160', colour: '#6fa8ff', label: 'LOLA south pole, 160 m grid' },
  { key: 'site-480', colour: '#4fd6c4', label: 'Landing-site windows, 480 m grid' },
  { key: 'site-60', colour: '#b6e36a', label: 'Landing-site windows, 60 m grid' },
  { key: 'site-3', colour: '#ffffff', label: 'Landing-site surveys, 3 m grid' },
] as const;
