// Test-only: a real site analysis of a small synthetic Moon, so the HUD models are checked
// against the science core's own output rather than hand-made numbers.
import { analyseStack, skyAt } from '../../analysis/api';
import { radialSource, stackOf } from '../../analysis/testing';
import type { SiteAnalysis } from '../../analysis/types';
import type { Scenario, SiteRef } from '../../core/types';

export const TEST_SITE: SiteRef = { id: 'pin:0.00000,23.00000', name: 'Test pin', kind: 'custom', lat: 0, lon: 23 };

/** The first sunset (Sun's centre crossing the horizontal, going down) at the test site after a date. */
export function firstSunsetAfter(fromMs: number): number {
  const H = 3_600_000;
  let t = fromMs, prev = skyAt(TEST_SITE, 2, t).sun.elDeg;
  for (let k = 0; k < 24 * 40; k++) {
    const el = skyAt(TEST_SITE, 2, t + H).sun.elDeg;
    if (prev > 0 && el <= 0) return t;
    prev = el;
    t += H;
  }
  throw new Error('no sunset found');
}

/**
 * A flat Moon with a 600 m ridge 10 km west of the site (azimuths 240 to 300 degrees), which
 * hides the setting Sun early. The mission window is 96 h, starting 48 h before the sunset.
 */
export async function testAnalysis(): Promise<{ analysis: SiteAnalysis; scenario: Scenario; sunsetMs: number }> {
  const sunsetMs = firstSunsetAfter(Date.UTC(2026, 0, 1));
  const scenario: Scenario = { id: 'test-scenario', label: 'Test pin, 96 h', site: TEST_SITE, mastHeightM: 2, startMs: sunsetMs - 48 * 3_600_000, durationH: 96, stepMin: 10 };
  const ridge = radialSource('Synthetic ridge 60 m', 60, TEST_SITE.lat, TEST_SITE.lon, (d, az) => {
    const a = ((az % 360) + 360) % 360;
    return a > 240 && a < 300 && d > 9000 && d < 11000 ? 600 : 0;
  });
  const analysis = await analyseStack(scenario, stackOf(ridge));
  return { analysis, scenario, sunsetMs };
}
