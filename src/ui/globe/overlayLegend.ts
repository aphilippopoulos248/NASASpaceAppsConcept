// What each globe overlay means, and its colours. The overlay renderer (src/scene/globe/)
// uses the same ramp so the legend and the globe always agree.
import type { OverlayMode } from '../../core/types';

/** Colour ramp for 0..100 % averages (perceptually ordered, dark to light). */
export const OVERLAY_RAMP = ['#2b1a5a', '#3f4c9a', '#2f86a6', '#36b38c', '#9bd35c', '#f4e45a'] as const;
/** Colour of "Sun inside the required band" in the sun-band overlay. */
export const SUN_BAND_COLOUR = '#ffd479';

export interface OverlayInfo {
  mode: Exclude<OverlayMode, 'off'>;
  label: string;
  meaning: (minDeg: number, maxDeg: number) => string;
  kind: 'band' | 'ramp';
}

export const OVERLAYS: OverlayInfo[] = [
  {
    mode: 'sun-band',
    label: 'Sun in required band (now)',
    kind: 'band',
    meaning: (min, max) =>
      `Shaded where the Sun's elevation at the simulated time is between ${min}° and ${max}°. Smooth Moon: terrain shadows are not included; check the surface view for a site.`,
  },
  {
    mode: 'avg-illumination',
    label: 'Average sunlight (multi-year)',
    kind: 'ramp',
    meaning: () => 'Average fraction of time the Sun is visible, over many years, including terrain shadows. NASA PGDA product 69; polar regions only.',
  },
  {
    mode: 'avg-earth-visibility',
    label: 'Average Earth visibility (multi-year)',
    kind: 'ramp',
    meaning: () => 'Average fraction of time the Earth is above the terrain horizon, over many years. NASA PGDA product 69; polar regions only.',
  },
];
