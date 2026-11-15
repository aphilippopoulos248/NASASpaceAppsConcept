import { afterEach, expect, it, vi } from 'vitest';
import * as terrain from '../terrain/api';
import { createSource } from '../terrain/sources';
import { regionTerrainMetrics } from '../terrain/region';
import type { SiteRef } from '../core/types';
import { destination } from './horizon';
import { nearbyRegions } from './engine';

afterEach(() => vi.restoreAllMocks());

it('loads the search terrain once for the whole shortlist and preserves regional measurements', async () => {
  const centre: SiteRef = { id: 'centre', name: 'Centre', kind: 'custom', lat: 10, lon: 20 };
  const stack = { sources: [createSource({ kind: 'local', name: 'Shared window', lat0: 10, lon0: 20, resolutionM: 60, n: 129, spacingM: 60, data: new Float32Array(129 * 129) })], notes: ['A remote finer grid could not be read.'] };
  const load = vi.spyOn(terrain, 'loadTerrainFor').mockResolvedValue(stack);
  const sites = [centre, ...[0, 90, 180, 270].map((az, i) => ({ ...centre, id: String(i), ...destination(centre, az, 2000) }))];
  const results = await nearbyRegions(centre, sites, 100, 10);
  expect(load).toHaveBeenCalledExactlyOnceWith(centre);
  results.forEach((r, i) => {
    const expected = regionTerrainMetrics(stack, sites[i], 100, 10);
    expect(r.region).toMatchObject({ ...expected, notes: expect.arrayContaining(expected.notes) });
    expect(r.region?.notes).toContain(stack.notes[0]);
    expect(r.region?.notes.join(' ')).toContain('shared elevation stack');
  });
});

it('a region outside the available data stays unknown, without an extra window request', async () => {
  const centre: SiteRef = { id: 'centre', name: 'Centre', kind: 'custom', lat: 10, lon: 20 };
  const load = vi.spyOn(terrain, 'loadTerrainFor').mockResolvedValue({ sources: [], notes: [] });
  const [result] = await nearbyRegions(centre, [centre], 100, 10);
  expect(load).toHaveBeenCalledTimes(1);
  expect(result.region).toBeNull();
  expect(result.error).toBeTruthy();
});
