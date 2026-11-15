# T-4 handover: elevation data and terrain sources

Owner: @ice-targets. Code in `src/terrain/`, `server/api/terrain.ts`, `scripts/build-dem.mjs`;
data in `public/data/dem/` (new) and `public/terrain/` (existing site windows).

All heights are metres above the 1737.4 km sphere (the LOLA datum), Mean Earth / Polar Axis
frame, east-positive longitude.

## What to call

```ts
import { loadTerrainFor, loadGlobalGrid, coverageRegions, sourceFromDescriptor, demLayers } from './terrain/api';

const stack = await loadTerrainFor(site);          // { sources: HeightSource[], notes: string[], seams?: TerrainSeam[] }
for (const s of stack.sources) if (s.covers(lat, lon)) { h = s.sample(lat, lon); break; }   // finest first

const relief = await loadGlobalGrid(4);            // 1440 x 720, 1.5 MB download: quick first drawing
const full = await loadGlobalGrid(16);             // 5760 x 2880, 15.6 MB
// relief.descriptor: { kind: 'equirect', width, height, data: Int16Array, scale, offset, latN: 90, latS: -90, lonW: -180, lonE: 180 }
```

- Works in the browser, inside a Web Worker (also one started from a `blob:` URL) and under
  vitest with no setup (under Node the files are read from `public/`). Decoded grids are cached
  per realm: call `loadTerrainFor` inside the worker rather than posting 30 MB arrays.
- `stack.sources` is sorted finest first and always ends with the whole-Moon grid.
  `stack.notes` are plain sentences meant to be shown next to results: what the data is, how far
  each layer reaches from the site, and what is missing.
- Every source has `name`, `resolutionM`, `descriptor` (structured-clonable) and `provenance`
  (`product`, `url`, `processing`, `citation`).
- `setTerrainReader(fn)` replaces how files are read; `setTerrainWindowFetcher(fn | null)`
  replaces or switches off the call to `/api/terrain`; `clearTerrainCache()` for tests.
- `src/terrain/geo.ts`: `offsetPoint(lat, lon, eastM, northM)` and its inverse `localOffset`
  (the site windows' own convention, exact at the poles), `surfaceDistanceM`, `polarXY`.

## What a site gets

| Site | Sources, finest first |
| --- | --- |
| Catalogued landing (28) | 3 m LROC NAC model to 0.77 km (19 sites only), 60 m window to 3.84 km, 480 m window to 30.72 km, any polar layer in reach, whole Moon |
| Custom pin, server reachable | 60 m + 480 m window built on request by `/api/terrain` (5 to 10 s the first time, cached after), any polar layer in reach, whole Moon |
| Custom pin, no server / offline | bundled polar layers if in reach, a neighbouring landing's windows if they cover the pin, whole Moon; `notes` gives the reason |
| Custom pin within 45 km of the south pole | no server call at all: the bundled 40 m layer covers the whole window and is finer than its 60 m grid |

A polar layer is included when the site is inside its square or within 1500 samples of its edge
(60 / 120 / 240 km for the 40 / 80 / 160 m layers).

## Bundled products (39.03 MB added to the repository, largest file 15.63 MB)

| File | Source | Resolution | Extent | Size | Not covered |
| --- | --- | --- | --- | --- | --- |
| `lola_south_875s_40m.lxg` | LRO LOLA LDEM_875S_20M (PDS product version V2.0, created 2017-06-15) | 40 m; heights in 0.5 m steps | Square of 151.6 km centred on the south pole (polar stereographic). Complete south of 87.51S; towards its corners (longitudes 45, 135, -135 and -45) it reaches 86.5S. | 7.20 MB | Nothing north of the square. Detail finer than 40 m; the source's own 20 m grid is not bundled. |
| `lola_south_85s_80m.lxg` | LRO LOLA LDEM_85S_40M (PDS product version V2.0, created 2017-06-15) | 80 m; heights in 1 m steps | Square of 303.3 km. Complete south of 85.01S; corners reach 82.9S. | 6.62 MB | Nothing north of the square. Detail finer than 80 m. |
| `lola_south_80s_160m.lxg` | LRO LOLA LDEM_80S_80M (PDS product version V2.0, created 2017-06-15) | 160 m; heights in 1 m steps | Square of 607.8 km. Complete south of 80.01S; corners reach 75.9S. | 8.11 MB | Nothing north of the square. Detail finer than 160 m. |
| `lola_global_16ppd.lxg` | LRO LOLA LDEM_16 (PDS product version V3.1, created 2019-03-15) | 16 px/deg = 1895.21 m; heights in 1 m steps | whole Moon | 15.63 MB | Relief narrower than about 1.9 km: sharp ridges and small craters are smoothed. |
| `lola_global_4ppd.lxg` | LRO LOLA LDEM_4 (PDS product version V3.0, created 2017-09-15) | 4 px/deg = 7580.84 m; heights in 0.5 m steps | whole Moon | 1.47 MB | Anything smaller than about 7.6 km. For drawing, not analysis. |

Source URLs (NASA PDS Geosciences Node, data set LRO-L-LOLA-4-GDR-V1.0):

- https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_875s_20m.img
- https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_85s_40m.img
- https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_80s_80m.img
- https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img
- https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_4.img

Processing: the whole-Moon grids are the source samples, only rearranged to start at 180W (and
the 16 px/deg heights rounded from 0.5 m to 1 m steps, which saves about 2.5 MB: 15.6 MB
instead of about 18 MB; the resolution itself was not lowered). The polar layers are 2x2 block means of the source grids in the source
projection; the source grids themselves (20 / 40 / 80 m) are 115 MB each and would not fit.
`public/data/dem/index.json` repeats all of this per file, with sha256 checksums.

**Not bundled:** no north-polar layer (the north pole has the 1.9 km grid only; the on-request
windows do work there). North of the 80S square nothing finer than 1.9 km is bundled except the
28 landing-site windows.

## `/api/terrain`

`GET /api/terrain?lat=<deg>&lon=<deg>` answers with an LXG file holding a 60 m and a 480 m grid
(129 x 129 each) around the point, built from SLDEM2015 512 ppd (60S to 60N), LOLA LDEM_60x_60M
and LDEM_80x_20M (polar caps, both poles), with LDEM_45x_100M filling the thin seam at 60
degrees where the others meet. Same recipe as the bundled windows.

- 400 bad coordinates, 405 not GET, 429 more than 2 builds running and 6 waiting (retry-after),
  502 archive unreadable, 504 no complete answer within 40 s. Errors are `{ error }` in words.
- Cache: `scripts/.cache/terrain-api/window_<lat>_<lon>.lxg` (5 decimals; 135 kB each).
- PDS refuses clients that ask too fast (HTTP 403 for a few seconds after several hundred rapid
  requests; measured). A window needs 270 to 500 small range reads, so they are paced at 50 per
  second, 6 at a time, and a refusal is retried after 1, 2 and 4 s.

## Verified

- `npm test`: 74 vitest cases in `src/terrain/` and `server/api/` (73 run, 1 opt-in live test).
- Whole-Moon grid: its maximum is 10 686 m at 5.406N 158.656W; LOLA's published highest point is
  10 786 m at 5.4125N 158.6335W (same cell; a 1.9 km cell averages the summit down).
- South-polar layers: the deepest ground within 20 km of the pole is Shackleton's floor
  (-2871.5 m at 89.625S 118.68E, inside the IAU outline 89.67S 129.78E, 20.9 km across). The
  three layers agree with each other to under 5 m RMS and with the whole-Moon grid to under
  80 m RMS (averaged over 1.9 km cells).
- Site windows against the whole-Moon grid, 28 sites: correlation 0.93 to 1.00, RMS 2 to 82 m
  (worst: Apollo 15 at the Apennine front); with east and west swapped the RMS is over ten times
  larger, so the windows are the right way round. Site heights agree within 111 m (Luna 20).
- Window builder against a synthetic archive laid out like the PDS files: 0.3 mm (SLDEM2015,
  float) and 0.25 m (polar grids, the int16 rounding of the source), across tile and band
  edges, the 0/360 seam, both poles and the product joins; no holes.
- Live (`LUNYX_LIVE=1 npx vitest run server/api/terrain.test.ts`): Apollo 11, Surveyor 6,
  Chandrayaan-3 and IM-2 windows rebuilt from PDS are identical to the bundled files, sample
  for sample (0 m difference), 5 to 8 s each.
- North pole, live: windows at 85.2N 30E (LDEM_80N_20M) and 70N 120W (LDEM_60N_60M) correlate
  0.997 with the whole-Moon grid, against -0.11 and 0.46 when east and west are swapped. (The
  bundled windows are all south of 45N, so this is the only real-data check of the north-polar
  products; it is part of the same opt-in live test.)
- Headless Chromium: `loadTerrainFor` on the main thread and in a module worker returns the same
  values as under Node; the 16 px/deg grid loads and decodes in about 0.7 s, the three polar
  layers in about 1.5 s (localhost). End to end through `server/plugin.ts` from @globe's branch:
  a custom pin at 89.45S 137.2W got its window in 9.4 s, 1 ms on the second call.

## Hand-overs between grids (T-26, T-32, D-10)

Where a site's finer grid ends and the next takes over, the stored heights do not match
exactly. `loadTerrainFor` uses every grid as stored (decision D-10, which replaced D-7), measures the mismatch for
each site along every edge the stack really crosses, says it in `notes`, and returns the
figures as `stack.seams` (`inner`, `outer`, `distanceM`, `minM`, `maxM`, `rmsM`, `degPerMetre`,
and `eased` where an edge was eased on request).

- **3 m model to 60 m window (19 sites): left as stored.** Two different measurements meet
  there (a stereo model tied to the window by one vertical shift), several metres apart:
  Apollo 17 -7.4 to +21.1 m, 3.6 m RMS, 0.77 km from the site. Checked against LRO LOLA laser
  altimetry at 17 of the 19 sites, the model is the closer of the two to the ground at its
  edge, and the step is the 60 m window's error, so the model is kept up to its edge
  (`docs/lunyx/handover/T-32-verification.md`). The notes state what the seam means for event
  times there: near the horizon, 1 m of height at that edge moves a sunrise or sunset formed
  there by about 9 minutes (12 to 13 at 41 to 45 degrees of latitude). Where a dated event is
  formed at that edge, the measure is the spread between the two products, each used
  throughout: Blue Ghost's sunset of 16 March 2025 at 2 m, first cut / last limb, is 18:23:40 / 19:30:03 UTC on the 3 m model (the stored stack) and 18:27:22 / 19:33:31 on the 60 m window alone, so the two products are 3.5 to 3.7 minutes apart (@validation,
  `tests/fixtures/validation/science-validation/blue-ghost-products/results.txt` on
  am/lunyx-science/agent/validation @ af49a12). T-32's eased stack lies outside both (19:42:53). `loadTerrainFor(site, { easeEdges: true })` gives T-32's eased stack for
  comparison: over its outer 129 m the model is eased onto the window with the surface view's
  own rule, `seams[0].eased` keeps the figures from before, and `storedGrid(source)` returns
  the stored grid behind an eased one (`docs/lunyx/handover/T-32-edge-easing.md`).
- **60 m to 480 m window, 60 m window to a polar layer, 480 m window to the whole-Moon grid:
  left as stored as well.** One frame at two samplings; the mismatch is relief the coarser grid
  misses (Apollo 17: -14.1 to +29.4 m at 3.84 km; -374 to +250 m, 86 m RMS at 30.7 km; IM-2:
  60 m window to the 80 m polar layer, -2.6 to +4.2 m). Easing the finer grid would lower real
  ridges, so it is never eased.

One metre of height is 0.075 degrees of skyline at 0.77 km, 0.015 at 3.84 km and 0.002 at
30.7 km. A skyline point formed at such an edge, and the time of a sunset behind it, carry that
uncertainty: near the horizon the Sun climbs at most 0.0085 degrees per minute times the cosine
of the latitude, so 1 m at 0.77 km is about 9 minutes of sunrise or sunset at low latitudes.
`node scripts/terrain-seams.mjs [--all]` prints the figures for every site, stored and eased.

## Honest limits worth showing

- The 480 m windows (bundled and on request) read every 8th source sample (every 23rd of the
  20 m polar grid) and interpolate; they are not averages. Against the 60 m windows they differ
  by 2 to 10 m RMS, 82 m at the worst point (IM-2).
- A NAC model labelled "(5.0 m)" reports `resolutionM: 5` although its grid spacing is 3 m.
- Beyond the site window (30.7 km) non-polar sites have only the 1.9 km grid: narrow distant
  ridges read low. `notes` says where that begins for each site.
- At the poles the equirectangular sampler returns one value (the mean of the last row).
