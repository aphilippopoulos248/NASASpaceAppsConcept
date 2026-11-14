# Lunyx validation record

Owner: @analysis. Every number below is reproduced by a command in this repository.
Conventions: UTC; latitude north-positive; longitude east-positive (ME frame); heights in
metres above the 1737.4 km sphere; azimuth clockwise from north; elevation above the local
horizontal, airless (no refraction).

## 1. Sun and Earth in a site's sky (`skyAt`, `src/astro/topocentric.ts`)

**Model.** astronomy-engine heliocentric Earth and Moon states (VSOP87 / its lunar theory),
the IAU (WGCCRE) lunar rotation model for the Moon-fixed frame, observer on the 1737.4 km
sphere + height. Apparent directions: light-time (Earth's retarded position) and stellar
aberration from the observer's barycentric velocity; no refraction. Earth's parallax across
the Moon (up to ~0.26 deg) is included because the observer is placed on the surface.

**Reference.** JPL Horizons (DE441), observer table, `CENTER='coord@301'`,
`COORD_TYPE='GEODETIC'`, `SITE_COORD='lon,lat,alt_km'`, `QUANTITIES='4,20'`,
`APPARENT='AIRLESS'`, `EXTRA_PREC='YES'`. Horizons reports the site frame as
`MEAN_ME (high precision)` with radii 1737.4 km (a sphere).

**Reference set** (`src/analysis/__fixtures__/horizons-topo-check.json`, built by
`node scripts/fetch-horizons-topo-check.mjs`): 11 sites x 16 dates = 176 instants, both bodies.
Sites: equator 0/0, Apollo 15 (26.1N), mid-latitude 45S 60W, east limb 5N 89E, west limb
10S 88.5W, far side (Chang'e 4), antimeridian 12N 180, the exact south and north poles,
89.9S, IM-2 (84.8S). Dates 1950-06-01 ... 2099-12-01 (13 of them 1969-2035).

| Span | Worst Sun error | Worst Earth error | Worst elevation-only error |
| --- | --- | --- | --- |
| 1950-2035 (154 instants per body) | 12.2" = 0.0034 deg | 12.2" = 0.0034 deg | 11.3" (Sun), 12.0" (Earth) |
| 2060-02-29 | 20.6" = 0.0057 deg | (same) | |
| 2099-12-01 | 74.2" = 0.021 deg | (same) | |

Errors are great-circle separations between the model's and Horizons' (az, el) directions.
Earth distance agrees within 12 km (of ~380 000 km); Sun distance within 2 000 km (1.4e-5,
VSOP87 truncation) — irrelevant for the disc sizes (< 0.0001 deg).

*Why the error grows after 2035:* both systems predict Delta-T (TT - UT) for future dates,
differently. Shifting the model's time by the best-fit offset (-40 s in 2060, -155 s in 2099)
brings the agreement back to 7.5" and 9.9". Up to 2035 the best-fit offset is 0-20 s and
removes < 1.3". The residual ~12" is mostly the IAU rotation model vs DE441's MEAN_ME frame.

*Poles:* at exactly +-90 deg latitude, "north" is defined as the limit along the site's own
meridian; this matches Horizons' azimuths at lon 0 to < 0.003 deg (26 instants).

**Bundled Horizons tables vs model** (every row): Blue Ghost Mission 1 window
(4 465 rows) worst 11.3"; IM-2 window (4 465 rows) worst 11.3".

Tests: `src/analysis/sky.test.ts` (fails above 0.01 deg to 2035 and 0.03 deg after).
Development table with live (cached) queries: `node scripts/compare-topocentric.mjs`.

### 1a. Independent check (fixture built by @ephemeris-check, task T-18)

`tests/fixtures/horizons/ephemeris-check/` holds 1008 Horizons instants at 12 sites,
1969-07-20 to 2035-04-23, fetched and verified by a different agent that never touched
`src/` (its README gives the queries; every row was also reproduced offline with NAIF SPICE
to 0.000002 deg). `skyAt()` against all 1008 rows, compared the fixture's way (elevation
directly, azimuth as the arc `|d az| * cos(el)`), with the fixture's own tolerances:

| Quantity | Worst over 1008 rows | Fixture tolerance |
| --- | --- | --- |
| Sun elevation / azimuth arc | 0.0029 / 0.0033 deg | 0.01 deg |
| Earth elevation / azimuth arc | 0.0036 / 0.0034 deg | 0.01 deg |
| Angular radius, Sun / Earth (relative) | 1.2e-5 / 3.5e-5 | 2e-3 |
| Distance, Sun / Earth (relative) | 1.2e-5 / 3.5e-5 | 1e-4 |
| Earth lit fraction | 0.0066 percentage points | 0.5 |
| Sub-Earth / sub-solar point | 0.0076 / 0.0033 deg | 0.02 deg |

Run: `npx vitest run src/analysis/skyFixtures.test.ts`, or the fixture owner's own checker,
`node tests/fixtures/horizons/ephemeris-check/check.mjs` (same numbers, PASS). The fixture's
SPICE sensitivity study puts the floor for any model on the IAU lunar rotation series at
0.0035 deg, so the residual is the rotation model, not the geometry. The sub-Earth point here
is the apparent direction of Earth from the Moon's centre (stellar aberration included);
Horizons' sub-observer point is corrected for light-time only, which accounts for 0.006 deg of
the 0.0076.

The same fixture also checks the **bundled Horizons tables**: its Blue Ghost surface set
(352 hourly rows), Blue Ghost eclipse set (49 rows) and IM-2 set (247 rows) are separate
downloads of the same Horizons quantities for the same sites and heights. The bundled tables
reproduce them to 0.00005 deg in azimuth/elevation (the tables' rounding) and 1.5e-6 deg in
angular radius.

## 2. Bundled Horizons windows (`public/data/horizons/`)

Built by `node scripts/build-horizons-bundle.mjs` (raw replies cached in `scripts/.cache/`).
10 min step, Sun and Earth az/el (1e-4 deg), hourly light-time distance.

| Window | Site (lat, lon, height) | Span (UTC) | Rows | Size |
| --- | --- | --- | --- | --- |
| `blue-ghost-1-2025-03` | 18.562, 61.81, -3652 m | 2025-03-01 00:00 - 2025-04-01 00:00 | 4 465 | 159 KB |
| `im-2-2025-03` | -84.79, 29.2, +5321 m | 2025-03-05 00:00 - 2025-04-05 00:00 | 4 465 | 154 KB |

Total 0.32 MB. A table is used when the scenario's site is within 100 m of the table's site
(100 m tilts the local vertical by 0.0033 deg) and the whole window lies inside it; the
series then reports `source: 'horizons'`. Between rows directions are interpolated
linearly through unit vectors (the 10 min chord error is < 0.0001 deg). The table's height
is the terrain height; a mast of a few metres changes Earth's parallax by < 1e-5 deg.

## 3. Skyline (`computeHorizon`, `src/analysis/horizon.ts`)

Exact spherical geometry: elevation of terrain at ground distance d and height h from an
observer at h0 = site height + mast is `atan2((R+h)cos(d/R) - (R+h0), (R+h)sin(d/R))`.

Analytic checks (`src/analysis/horizon.test.ts`):

| Case | Expected | Measured error |
| --- | --- | --- |
| Smooth sphere, mast 2 / 10 / 100 m | -acos(R/(R+h)) = -0.0275 / -0.0615 / -0.1945 deg | < 0.002 deg at all 720 azimuths |
| Smooth sphere, mast 0 | 0 deg | < 0.01 deg |
| Ring ridge 1500 m high, 20 km away | exact formula | < 0.02 deg; distance within 200 m, height within 5 m |
| Bowl crater, rim 800 m above floor at 5 km | exact formula | < 0.05 deg |
| Poles (+-90) and antimeridian | smooth-sphere value | < 0.002 deg |

**Real data: Apollo 15** (terrain through `loadTerrainFor`: LROC NAC DTM 3 m window to 1.1 km,
SLDEM2015 60 m window to 5.4 km, SLDEM2015 480 m window to 43 km, LOLA 16 px/deg (1.9 km)
beyond, searched to 204 km; observer 2 m above the LM site at -1927 m).

| Feature | Published | Lunyx skyline from the DEM |
| --- | --- | --- |
| Mons Hadley (NE) | "Two major Apennine massifs tower over the Hadley plain to heights of 4.5 and 3.5 km. These are Mt. Hadley to the northeast and Hadley Delta just south of the landing site" (NASA SP-289, Apollo 15 Preliminary Science Report, p. 5-4); ~4 km (LROC, lroc.im-ldi.com/images/783); 4.1 km (NASA SVS 4918). Gazetteer feature centre ~21 km at bearing ~38 deg. | Highest skyline in 20-60 deg: **11.13 deg at azimuth 43 deg**, set by terrain **19.7 km** away, **4.0 km** above the site. |
| Hadley Delta (S) | ~3.5 km (SP-289; LROC); 3.6 km (LTO-41B4 via Wikipedia); "about 5 kilometers northwest of Hadley Delta" (NASA SP-4214). Feature centre ~12.7 km at ~170 deg. | Highest skyline in 150-210 deg: **13.46 deg at azimuth 180 deg**, set by terrain **10.6 km** away, **2.57 km** above the site. |

Mons Hadley agrees with the published height and position. For Hadley Delta the skyline is
formed by its north face, 2.6 km above the site, about 1 km lower than the published summit
height: the summit lies beyond the face as seen from the LM, and from 10 km out the data is
the 480 m grid, which flattens peaks. No published elevation angle from the LM was found.

**Speed, without changing the result.** The march skips elevation layers that cannot reach
the current distance (their reach is predicted from each grid's description and checked
against the grid itself) and reads the projected grids straight from the point's unit vector
instead of going through latitude and longitude. Both are verified against the plain
`HeightSource.sample()` path in `src/analysis/fastSample.test.ts`: 39 000 height lookups on
13 real grids agree to 1e-6 m; no covered point lies outside its predicted reach (24 443
checked); and the skyline at 10 sites (IM-2, Apollo 15, Chandrayaan-3, Chang'e 4, a Shackleton
rim pin, both exact poles, pins at the edges of the 85S and 80S squares, the antimeridian) is
identical with pruning alone and equal to rounding (< 0.000005 deg) with the direct lookups.

| Full profile (720 azimuths), min of 12 runs, one thread | Before | Now |
| --- | --- | --- |
| IM-2 (60 m window, 80 m and 160 m polar layers, 1.9 km grid; to 189 km) | 202 ms | 68 ms |
| Apollo 15 (3 m, 60 m, 480 m windows, 1.9 km grid; to 204 km) | 175 ms | 61 ms |
| Blue Ghost 1 (same layers; to 229 km) | 194 ms | 63 ms |
| Chandrayaan-3 (60 m, 480 m windows, 1.9 km grid; to 174 km) | 93 ms | 30 ms |

## 4. Mission-window analysis (`src/analysis/window.ts`)

See `src/analysis/window.test.ts` and `src/analysis/api.test.ts`. Recorded results on the real
terrain stacks (2 m mast, 10 min step):

| Scenario | Ephemeris | Illumination | Any Sun | Longest darkness | Earth line of sight | Longest Earth gap | Events |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blue Ghost 1, 14 d from 2025-03-02 08:34 | Horizons (bundled) | 98.94 % | 99.32 % | 2.28 h (Earth in front of the Sun, 2025-03-14) | 100 % | 0 h | none |
| Blue Ghost 1, 15 d from 2025-03-02 08:34 | Horizons (bundled) | 95.23 % | 95.74 % | 13.06 h (runs into the window edge) | 100 % | 0 h | sunset 2025-03-16 19:30:10 at azimuth 269.9 |
| IM-2, 14 d from 2025-03-06 17:28 | Horizons (bundled) | 92.47 % | 93.77 % | 18.2 h (edge) | 88.91 % | 37.3 h (edge) | Earthset 2025-03-19 04:11:30, sunset 2025-03-19 23:17:27 |
| Apollo 15, 14 d from 1971-07-30 22:16 | model | 95.62 % | 96.05 % | 10.65 h (edge) | 100 % | 0 h | sunset 1971-08-13 11:37:00 |

Skyline ranges: IM-2 -1.47..4.07 deg, Blue Ghost -0.18..2.34 deg, Apollo 15 0.19..13.46 deg.
Runtime with the terrain already loaded (min of 4, one thread): 14 days 73-78 ms with a
Horizons table, 139 ms with the model; 60 days (model) about 0.4 s. First call per site adds
the terrain download and decoding (about 1.2 s for IM-2's polar layers under Node).
Convergence: halving the step (10 -> 5 min) changes Apollo 15 illumination by 0.001 points
and event times by < 1 min. With the model instead of the Horizons table the Blue Ghost
illumination differs by < 0.05 points and the sunset by < 1 min.

**Sunset is the last limb.** `sunset` is the moment the last part of the disc goes behind the
skyline; the disc takes about an hour to cross it at these latitudes. At the Blue Ghost site
the skyline towards the setting Sun is +0.59 deg (terrain 0.8 km away in the 3 m LROC model),
so the last limb goes at 19:30 UTC, while on a smooth sphere the Sun's centre would reach the
horizontal at about 20:11 UTC (independent fixture README). 0.1 deg of skyline is worth about
12 minutes here.

**Eclipses seen from the surface** (Earth in front of the Sun; geometric discs, Earth's
atmosphere ignored). They are part of the illumination series (`sunEclipsed`,
`eclipseIntervals`), and `blockageAt` says so in words.

| Site | Earth's disc overlaps the Sun | Sun entirely behind Earth | Independent reference |
| --- | --- | --- | --- |
| Blue Ghost 1 (18.56 N, 61.81 E), 2025-03-14 | 05:00:38 - 09:51:06 UTC | 06:17:21 - 08:34:23 UTC | The independent Horizons fixture (10 min samples of Sun-Earth separation and radii at the site) has the discs overlapping in its samples from 05:10 to 09:50 and the Sun wholly behind Earth from 06:20 to 08:30: consistent to the sampling. |
| IM-2 (84.79 S, 29.2 E), 2025-03-14 | 04:23:32 - 09:28:23 UTC | 05:33:04 - 08:18:51 UTC | same eclipse, earlier at a site nearer the leading side of the disc |
| Apollo 15 (26.13 N, 3.63 E), 1971-08-06 | 17:30:36 - 21:59:12 UTC | 18:26:23 - 21:03:25 UTC | model only (no Horizons table for 1971 is bundled) |

Comparison with published contact times of the lunar eclipses and with what Firefly published
about the view from Blue Ghost: not yet entered here (the sources still have to be read and
quoted exactly; @ephemeris-check's task T-26 covers the same events independently).

**In the browser.** `analyse()` and `rankNearby()` post only the scenario (about 400 bytes) to
one Web Worker, which loads terrain and ephemeris tables itself. Checked in headless Chromium
against the dev server and against the production build through the app's own analysis store:
the same numbers as under Node (IM-2 92.47 % / 88.91 %), one worker, no errors; an `analyse()`
call issued while a nearby scan is running is answered in 0.6-0.8 s because the scan yields
between slices; the page's main thread is not blocked by either.

## 5. Nearby alternatives (`rankNearby`, `src/analysis/nearby.ts`)

Default scan: radius 2 km, spacing 300 m (137 candidates including the site itself), slope
limit 10 deg, skyline every 1 deg (main analysis: 0.5 deg) with coarser far-field marching
(steps of 1 % of distance; main: 0.4 %), window sampled every 30 min (main: 10 min). The
Sun/Earth directions are computed once for the site and re-projected into each candidate's
local horizon (checked against a direct computation 2 km away: < 0.001 deg). Every candidate
uses the site's own terrain stack (no per-candidate downloads).

**One slope measure for all candidates:** the finest elevation layer that has data at most of
the candidates, over a baseline of twice its grid (60 m window, 120 m baseline at every
catalogued site with the default radius). A 3 m survey that only reaches a few hundred metres
is not used to judge some candidates while a 60 m grid judges the rest.

| Site, 14-day window, defaults | Within the slope limit | Best alternative | Runtime (Node, one thread, min of 2) |
| --- | --- | --- | --- |
| IM-2 | 131 of 137 | 300 m W, 600 m S: 98.2 % sunlight, Earth 87.6 %, longest darkness 2.8 h, slope 2.3 deg (site itself: 92.5 %, 18.2 h, rank 16) | 3.1 s (was 6.9 s on the test-only stack; about 8 s on the merged stack) |
| Apollo 15 | 129 of 137 | all within about 1 point of each other | 2.8 s (was 8.5 s) |
| Blue Ghost 1 | 136 of 137 | | 3.3 s |

The whole gain comes from the faster skyline (section 3); results are unchanged. In the
browser's worker under headless software rendering the IM-2 scan takes 7-8 s. Not done: a
coarse pre-rank with a full pass on the best few (it would mix two accuracy classes in one
ranking), and sharing the far skyline between candidates (candidate skylines would then differ
from independently computed ones by roughly 0.1 deg).

Synthetic checks: a ridge crest outranks the valley floor; a 20 deg wall is rejected at a
10 deg limit and accepted at 30 deg; candidates without data are rejected as `no-data`.
Resolution caveat, stated in every candidate's `basis`: slope and skyline rest on 60 m
grids; metre-scale boulders, craters and slopes are invisible to this scan.
