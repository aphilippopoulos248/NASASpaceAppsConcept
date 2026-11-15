// What each globe overlay means, and its colours. The overlay renderer (src/scene/globe/)
// uses the same ramp so the legend and the globe always agree.
import type { OverlayMode } from '../../core/types';

export { OVERLAY_RAMP, SUN_BAND_COLOUR } from '../../scene/globe/overlayStyle';

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
      `Shaded where the Sun's elevation at the simulated time is between ${min}° and ${max}° above the local horizontal (degrees). Whole Moon, from the app's Sun position for that UTC instant. Computed for a smooth Moon: terrain shadows are not included, so check the surface view or the site analysis for a site.`,
  },
  {
    mode: 'avg-illumination',
    label: 'Average sunlight (multi-year)',
    kind: 'ramp',
    meaning: () => 'Share of time with any part of the Sun above the terrain horizon, averaged over 18.6 years. A long-term average of a model, not the Sun on the date shown. NASA PGDA product 69; polar regions only.',
  },
  {
    mode: 'avg-earth-visibility',
    label: 'Average Earth visibility (multi-year)',
    kind: 'ramp',
    meaning: () => 'Share of time with any part of Earth above the terrain horizon, averaged over 18.6 years. Geometric line of sight, not a radio link, and not Earth on the date shown. NASA PGDA product 69; polar regions only.',
  },
];
