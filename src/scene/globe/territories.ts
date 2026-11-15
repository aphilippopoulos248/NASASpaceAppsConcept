// Territories: the whole Moon divided among the countries of the landing sites shown. Every
// point belongs to the country of the nearest site, so neighbouring sites of one country share
// one continuous territory and the borders run halfway between sites of different countries.
// The colouring itself is done per pixel in the surface shader (surfaceShader.ts) from the
// list of sites written here; `territoryAt` is the same rule on the CPU.
//
// A display of who landed nearest, not of ownership: no country owns lunar ground (docs/DATA_SOURCES.md).
import { Vector3 } from 'three';
import { landingColor, latLonToVec3, type Landing } from '../../data/landings';
import { displayCountry } from '../../data/ownership';
import { MAX_TERRITORY_SITES, type SurfaceUniforms } from './surfaceShader';

/** The country a landing's territory is drawn for ("USSR" sites count as Russia, as everywhere in the app). */
export function territoryCountry(l: Landing): string {
  return displayCountry(l.country);
}

/** Writes the sites the Moon is divided among (the landings shown) into the shared surface uniforms. */
export function setTerritories(uniforms: Pick<SurfaceUniforms, 'uTerrSite' | 'uTerrColor' | 'uTerrCount'>, landings: readonly Landing[]): void {
  if (landings.length > MAX_TERRITORY_SITES) console.warn(`Territories: only the first ${MAX_TERRITORY_SITES} of ${landings.length} landing sites are used`);
  const sites = landings.slice(0, MAX_TERRITORY_SITES);
  const countries: string[] = [];
  const dir = new Vector3();
  sites.forEach((l, i) => {
    const country = territoryCountry(l);
    let group = countries.indexOf(country);
    if (group < 0) group = countries.push(country) - 1;
    latLonToVec3(l.lat, l.lon, 1, dir);
    uniforms.uTerrSite.value[i].set(dir.x, dir.y, dir.z, group);
    uniforms.uTerrColor.value[i].set(landingColor(l));
  });
  uniforms.uTerrCount.value = sites.length;
}

/** The landing nearest to a point (its country holds the point), or null when no landings are shown. */
export function territoryAt(lat: number, lon: number, landings: readonly Landing[]): Landing | null {
  const d = latLonToVec3(lat, lon);
  const s = new Vector3();
  let best: Landing | null = null, bestDot = -2;
  for (const l of landings) {
    const c = d.dot(latLonToVec3(l.lat, l.lon, 1, s));
    if (c > bestDot) {
      bestDot = c;
      best = l;
    }
  }
  return best;
}

const ORBIT_FILL = 0.24;
const GROUND_FILL = 0.1;
/** Camera altitudes between which the fill eases from its ground strength to its orbit strength (km). */
const GROUND_BELOW_KM = 100;
const ORBIT_ABOVE_KM = 1500;

/** How strongly the country colour tints the ground: clear from orbit, faint close to the ground so the terrain and imagery stay readable. */
export function territoryFill(altitudeKm: number): number {
  const t = Math.min(1, Math.max(0, (altitudeKm - GROUND_BELOW_KM) / (ORBIT_ABOVE_KM - GROUND_BELOW_KM)));
  return GROUND_FILL + (ORBIT_FILL - GROUND_FILL) * t * t * (3 - 2 * t);
}
