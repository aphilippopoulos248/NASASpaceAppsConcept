// Keyboard on the focused globe: the arrows turn it by about a tenth of the visible width, + and -
// zoom, Enter drops a pin at the centre. Without the scene, so it can be tested (globeKeys.test.ts).
//
// Each press steps from the pose the globe is already on its way to, not from the centre it last
// drew: the centre is published once per drawn frame, so before, several presses within one
// frame (a slow renderer, key auto-repeat) all started from the same centre and all but the last
// were lost (lunyx-experience F-7). N presses now always make N steps.
import { MAX_ALTITUDE_KM, MIN_ALTITUDE_KM } from '../../core/coreActions';
import { MOON_RADIUS_KM, wrapLon } from '../../core/types';

export interface Pose {
  lat: number;
  lon: number;
  altitudeKm: number;
}

const DEG = Math.PI / 180;
/** The arrows go no further than this towards a pole, degrees of latitude. */
const MAX_KEY_LAT = 89;

/** The pose one key press leads to from `from`, or null for a key the globe does not use. */
export function keyStep(key: string, from: Pose): Pose | null {
  // About a tenth of the visible width.
  const stepDeg = Math.min(20, Math.max(0.02, (from.altitudeKm / MOON_RADIUS_KM) * 12));
  let { lat, lon, altitudeKm } = from;
  const lonStep = () => stepDeg / Math.max(0.2, Math.cos(lat * DEG));
  switch (key) {
    // A pose already beyond the arrows' limit (a typed 89.95) is not pulled back by them.
    case 'ArrowUp': lat = lat >= MAX_KEY_LAT ? lat : Math.min(MAX_KEY_LAT, lat + stepDeg); break;
    case 'ArrowDown': lat = lat <= -MAX_KEY_LAT ? lat : Math.max(-MAX_KEY_LAT, lat - stepDeg); break;
    case 'ArrowLeft': lon = wrapLon(lon - lonStep()); break;
    case 'ArrowRight': lon = wrapLon(lon + lonStep()); break;
    case '+': case '=': altitudeKm = Math.max(MIN_ALTITUDE_KM, altitudeKm / 1.5); break;
    case '-': case '_': altitudeKm = Math.min(MAX_ALTITUDE_KM, altitudeKm * 1.5); break;
    default: return null;
  }
  return { lat, lon, altitudeKm };
}

export interface GlobeKeyDeps {
  /** The pose the globe is flying to, or where it is when it is not flying. */
  pose(): Pose;
  /** Turn or zoom the globe there (setGlobeCamera). Must start the flight before it returns, so the next press steps from it. */
  go(to: Pose): void;
  /** Drop a pin at the point the view is centred on, or on its way to. */
  pin(): void;
}

/** What a key press does on the focused globe: true when the globe used the key. */
export function handleGlobeKey(key: string, deps: GlobeKeyDeps): boolean {
  if (key === 'Enter') {
    deps.pin();
    return true;
  }
  const next = keyStep(key, deps.pose());
  if (!next) return false;
  deps.go(next);
  return true;
}
