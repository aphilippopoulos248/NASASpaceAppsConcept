import { describe, expect, it } from 'vitest';
import type { Landing } from '../../data/landings';
import { COVERAGE_STYLE, OVERLAY_RAMP, SUN_BAND_COLOUR } from './overlayStyle';
import { createSurfaceUniforms, MAX_TERRITORY_SITES } from './surfaceShader';
import { setTerritories, territoryAt, territoryCountry, territoryFill } from './territories';

const site = (id: string, country: string, lat: number, lon: number) => ({ id, name: id, country, lat, lon }) as Landing;
const SITES = [site('us-1', 'USA', 0, 0), site('us-2', 'USA', 10, 10), site('su-1', 'USSR', 0, 90), site('cn-1', 'China', -45, 180)];

describe('territories', () => {
  it('gives every point of the Moon to the nearest landing shown', () => {
    expect(territoryAt(5, 5, SITES)?.country).toBe('USA');
    expect(territoryAt(0, 80, SITES)?.id).toBe('su-1');
    // The border runs halfway between sites of different countries.
    expect(territoryAt(0, 40, SITES)?.country).toBe('USA');
    expect(territoryAt(0, 55, SITES)?.id).toBe('su-1');
    // Far from every site still belongs to someone: the poles and the far side.
    expect(territoryAt(-90, 0, SITES)?.id).toBe('cn-1');
    expect(territoryAt(90, 0, SITES)).not.toBeNull();
    // Hiding a country hands its ground to the neighbours that remain.
    expect(territoryAt(0, 80, SITES.filter((l) => l.country !== 'USSR'))?.country).toBe('USA');
    expect(territoryAt(0, 0, [])).toBeNull();
  });

  it('writes the sites into the shader uniforms, one number per country', () => {
    const u = createSurfaceUniforms(OVERLAY_RAMP, SUN_BAND_COLOUR, COVERAGE_STYLE.map((c) => c.colour));
    expect(u.uTerrSite.value).toHaveLength(MAX_TERRITORY_SITES);
    expect(u.uTerrCount.value).toBe(0);
    setTerritories(u, SITES);
    expect(u.uTerrCount.value).toBe(4);
    // Sites of one country share a number, so no border is drawn between them.
    expect(u.uTerrSite.value.slice(0, 4).map((v) => v.w)).toEqual([0, 0, 1, 2]);
    // +X is 0N 0E; east is -Z.
    expect(u.uTerrSite.value[0].x).toBeCloseTo(1, 9);
    expect(u.uTerrSite.value[2].z).toBeCloseTo(-1, 9);
    expect(u.uTerrColor.value[0].equals(u.uTerrColor.value[1])).toBe(true);
    expect(u.uTerrColor.value[0].equals(u.uTerrColor.value[2])).toBe(false);
    setTerritories(u, []);
    expect(u.uTerrCount.value).toBe(0);
  });

  it('counts USSR sites as Russia', () => {
    expect(territoryCountry(site('a', 'USSR', 0, 0))).toBe('Russia');
    expect(territoryCountry(site('b', 'USA', 0, 0))).toBe('USA');
  });

  it('tints clearly from orbit and faintly near the ground', () => {
    expect(territoryFill(4170)).toBeCloseTo(0.24, 9);
    expect(territoryFill(40)).toBeCloseTo(0.1, 9);
    for (let km = 50; km < 2000; km += 50) expect(territoryFill(km + 50)).toBeGreaterThanOrEqual(territoryFill(km));
  });
});
