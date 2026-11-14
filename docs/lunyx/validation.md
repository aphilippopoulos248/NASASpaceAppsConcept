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
| Hadley Delta (S) | ~3.5 km (SP-289; LROC); 3.6 km (LTO-41B4 via Wikipedia); "about 5 kilometers northwest of Hadley Delta" (NASA SP-4214). Feature centre ~12.7 km at ~170 deg. | Highest skyline in 150-210 deg: **13.47 deg at azimuth 180 deg**, set by terrain **10.6 km** away, **2.56 km** above the site. |

Mons Hadley agrees with the published height and position. For Hadley Delta the skyline is
formed by its north face, 2.6 km above the site, about 1 km lower than the published summit
height: the summit lies beyond the face as seen from the LM, and from 10 km out the data is
the 480 m grid, which flattens peaks. No published elevation angle from the LM was found.

**The skyline does not depend on the marching step.** Plain marching takes the highest of
its samples (0.7 of a grid cell apart near the site, 0.4 % of the distance far out) and so
reads low wherever the terrain peaks between two samples: by up to 0.27 deg at a pin on
Shackleton's rim and 0.47 deg on the Malapert massif (steep ground a few hundred metres away,
80 m data), 0.03-0.09 deg at the catalogued sites. The march therefore searches finely (to
1/48 of the two steps around it) around every sampled local maximum that a hidden peak could
lift above the best sample. Measured against a march twenty times finer
(`src/analysis/horizon.test.ts`, 180 azimuths per site):

| Site | Without the fine search: max / rms | With it (default settings): max / rms | Scan settings (1 % far steps) |
| --- | --- | --- | --- |
| IM-2 | 0.035 / 0.0061 deg | 0.001 / 0.0003 deg | 0.001 / 0.0002 deg |
| Apollo 15 | 0.052 / 0.0153 | 0.003 / 0.0005 | 0.004 / 0.0007 |
| Pin on Shackleton's rim (89.45 S, 137.2 W) | 0.272 / 0.0390 | 0.004 / 0.0010 | 0.004 / 0.0010 |
| Pin on the Malapert massif (86.0 S, 2.9 E) | 0.472 / 0.1277 | 0.016 / 0.0037 | 0.016 / 0.0037 |

So what remains is the data, not the sampling: the skyline is that of the bilinearly
interpolated grids, and relief finer than a grid is not in it (within a few hundred metres of
a pin that only has 80 m data, that is the larger uncertainty by far).

**Speed, without changing the result.** The march skips elevation layers that cannot reach
the current distance (their reach is predicted from each grid's description and checked
against the grid itself) and reads the projected grids straight from the point's unit vector
instead of going through latitude and longitude. Both are verified against the plain
`HeightSource.sample()` path in `src/analysis/fastSample.test.ts`: 39 000 height lookups on
13 real grids agree to 1e-6 m; no covered point lies outside its predicted reach (24 443
checked); and the skyline at 10 sites (IM-2, Apollo 15, Chandrayaan-3, Chang'e 4, a Shackleton
rim pin, both exact poles, pins at the edges of the 85S and 80S squares, the antimeridian) is
identical with pruning alone and equal to rounding (< 0.000005 deg) with the direct lookups.

| Full profile (720 azimuths), min of 12 runs, one thread | First version | Now, fine search included |
| --- | --- | --- |
| IM-2 (60 m window, 80 m and 160 m polar layers, 1.9 km grid; to 189 km) | 202 ms | 89 ms |
| Apollo 15 (3 m, 60 m, 480 m windows, 1.9 km grid; to 204 km) | 175 ms | 72 ms |
| Blue Ghost 1 (same layers; to 229 km) | 194 ms | 75 ms |
| Chandrayaan-3 (60 m, 480 m windows, 1.9 km grid; to 174 km) | 93 ms | 38 ms |

## 4. Mission-window analysis (`src/analysis/window.ts`)

See `src/analysis/window.test.ts` and `src/analysis/api.test.ts`. Recorded results on the real
terrain stacks (2 m mast, 10 min step):

| Scenario | Ephemeris | Illumination | Any Sun | Longest darkness | Earth line of sight | Longest Earth gap | Events |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blue Ghost 1, 14 d from 2025-03-02 08:34 | Horizons (bundled) | 98.94 % | 99.32 % | 2.28 h (Earth in front of the Sun, 2025-03-14) | 100 % | 0 h | none |
| Blue Ghost 1, 15 d from 2025-03-02 08:34 | Horizons (bundled) | 95.23 % | 95.74 % | 13.07 h (runs into the window edge) | 100 % | 0 h | sunset 2025-03-16 19:30:00 at azimuth 269.9 |
| IM-2, 14 d from 2025-03-06 17:28 | Horizons (bundled) | 92.47 % | 93.77 % | 18.2 h (edge) | 88.90 % | 37.3 h (edge) | Earthset 2025-03-19 04:09:38, sunset 2025-03-19 23:17:08 |
| Apollo 15, 14 d from 1971-07-30 22:16 | model | 95.62 % | 96.05 % | 10.65 h (edge) | 100 % | 0 h | sunset 1971-08-13 11:36:42 |
| Chandrayaan-3, 14 d from 2023-08-23 12:33 | model | 83.88 % | 84.35 % | 52.6 h (edge) | 100 % | 0 h | sunset 2023-09-04 07:58:51 at azimuth 276.9 |

Skyline ranges: IM-2 -1.47..4.07 deg, Blue Ghost -0.17..2.35 deg, Apollo 15 0.23..13.47 deg,
Chandrayaan-3 0.49..2.45 deg.
Runtime with the terrain already loaded (min of 5, one thread, DSN geometry of section 6
included): 14 days 130-145 ms with a Horizons table, 165-205 ms with the model; 60 days
(model) about 0.6 s. First call per site adds the terrain download and decoding (about 1.2 s
for IM-2's polar layers under Node).
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

| Site | Earth's disc overlaps the Sun | Sun entirely behind Earth |
| --- | --- | --- |
| Blue Ghost 1 (18.56 N, 61.81 E), 2025-03-14 | 05:00:38 - 09:51:06 UTC | 06:17:21 - 08:34:23 UTC |
| IM-2 (84.79 S, 29.2 E), 2025-03-14 | 04:23:32 - 09:28:23 UTC | 05:33:04 - 08:18:51 UTC |
| Apollo 15 (26.13 N, 3.63 E), 1971-08-06 | 17:30:36 - 21:59:12 UTC | 18:26:23 - 21:03:25 UTC (model ephemeris; no Horizons table for 1971 is bundled) |

Three outside checks:

1. *Independent Horizons fixture* (`tests/fixtures/horizons/ephemeris-check`, 10 min samples of
   the Sun-Earth separation and radii at the Blue Ghost site): the discs overlap in its samples
   from 05:10 to 09:50 and the Sun is wholly behind Earth from 06:20 to 08:30. Consistent to
   the sampling.

2. *What was reported for the lander.* KUT / Texas Public Radio (Austin's NPR station, 14 and
   16 March 2025, reporting on Firefly's images; local time, CDT = UTC-5 on that date, as the
   photo caption "on March 14 at 12:30 am CDT" states):

   | At the Blue Ghost site | Lunyx | Reported |
   | --- | --- | --- |
   | Earth begins to cover the Sun | 05:00:38 UTC | "The solar eclipse lasted nearly five hours, starting at 12 a.m. CST and ending around 4:52 a.m. at the Blue Ghost's landing site" -> 05:00 UTC |
   | Sun entirely hidden from | 06:17:21 UTC | "Totality lasted just over 2 hours, beginning at 1:18 a.m." -> 06:18 UTC |
   | Sun entirely hidden until | 08:34:23 UTC (2 h 17 min) | no time given; "Another image, taken around 3:30 a.m., shows the lunar lander capturing a "diamond ring effect,"" -> 08:30 UTC, as the Sun was about to emerge |
   | Earth leaves the Sun | 09:51:06 UTC (4 h 50 min in all) | "ending around 4:52 a.m." -> 09:52 UTC |

   The three stated clock times agree with the computed ones to about a minute. (The sentence
   says "CST" where the caption says "CDT"; read as CST the times would fall an hour after the
   lunar eclipse itself, so CDT is meant.) Sources:
   https://www.kut.org/text/science/2025-03-14/firefly-aerospace-blue-ghost-lunar-lander-total-solar-eclipse ,
   https://www.tpr.org/science-technology/2025-03-16/firefly-aerospaces-blue-ghost-lunar-lander-captures-diamond-ring-effect-of-eclipse

3. *Published contacts of the lunar eclipses* (F. Espenak, EclipseWise, UT1; umbra modelled
   with the Herald/Sinnott rule, which enlarges it for Earth's atmosphere, so agreement is a
   matter of brackets, not equality). A point on the Moon has the Sun entirely hidden from some
   moment between U1 and U2 until some moment between U3 and U4, and sees no part of the event
   before P1 or after P4:

   | Eclipse | P1 | U1 | U2 | U3 | U4 | P4 | Site: Sun hidden from / until | Inside the brackets |
   | --- | --- | --- | --- | --- | --- | --- | --- | --- |
   | 2025 Mar 14 | 03:57:09 | 05:09:23 | 06:25:58 | 07:32:02 | 08:48:19 | 10:00:32 | Blue Ghost 06:17:21 / 08:34:23 | yes (first and last contact 05:00:38 / 09:51:06 lie between P1 and P4) |
   | 2025 Mar 14 | | | | | | | IM-2 05:33:04 / 08:18:51 | yes |
   | 1971 Aug 06 | 16:59:26 | 17:55:25 | 18:53:28 | 20:32:53 | 21:30:57 | 22:26:50 | Apollo 15 18:26:23 / 21:03:25 | yes |

   Mare Crisium is on the side of the disc that enters Earth's shadow last, hence Blue Ghost's
   times close to U2 and U4; Apollo 15, near the middle of the disc, sits mid-way. Sources:
   https://eclipsewise.com/lunar/LEprime/2001-2100/LE2025Mar14Tprime.html ,
   https://www.eclipsewise.com/lunar/LEprime/1901-2000/LE1971Aug06Tprime.html

**Blue Ghost's sunset, 16 March 2025: not a clean check.** Computed over the real skyline (2 m
above the ground): the skyline starts to cut the Sun's disc at 18:25 UTC, half of it is gone at
18:57, the last limb at 19:30:00. The skyline there (+0.59 deg at azimuth 270) is a real rise
of about 10 m, 0.75-0.85 km west of the lander, present in both the 3 m LROC model and the
60 m SLDEM2015 window (which agree to 3.3 m rms over the model's extent). Being so near, it
makes the time depend on the eye height: 19:16 for 0.5 m, 19:58 for 5 m. Firefly's release of
17 March 2025 gives no sunset time; it says the lander completed "more than 14 days of surface
operations (346 hours of daylight)" and kept "operating just over 5 hours into the lunar night
with the final data received around 6:15 pm CDT on March 16". Counted from the touchdown time
in this repository's catalogue (08:34 UTC on 2 March), 346 hours end at 18:34 UTC; "just over
5 hours" before 23:15 UTC is a little before 18:15 UTC. Both fall where the computed Sun is
just starting to set (18:25), about an hour before its last limb goes. The release does not say
which moment it calls sunset, so this neither confirms nor contradicts the computed times.
Source: https://fireflyspace.com/news/firefly-aerospace-successfully-completes-14-days-of-surface-operations-on-the-moon

**In the browser.** `analyse()` and `rankNearby()` post only the scenario (about 400 bytes) to
one Web Worker, which loads terrain and ephemeris tables itself. Checked in headless Chromium
against the dev server and against the production build through the app's own analysis store:
the same numbers as under Node (IM-2 92.47 % / 88.90 %), one worker, no errors; an `analyse()`
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

| Site, 14-day window, defaults | Within the slope limit | Best alternative | Runtime (Node, one thread, min of 3) |
| --- | --- | --- | --- |
| IM-2 | 131 of 137 | 300 m W, 600 m S: 98.1 % sunlight, Earth 87.7 %, longest darkness 2.8 h, slope 2.3 deg (site itself: 92.5 %, 18.2 h, rank 17) | 3.9 s |
| Apollo 15 | 129 of 137 | 1800 m W: 96.7 % against 95.6 % at the site (all candidates lie within about 1 point of each other) | 3.3 s |
| Blue Ghost 1 | 136 of 137 | none better than the site itself (rank 1) | 4.1 s |
| Chandrayaan-3 | 137 of 137 | 1200 m E, 1500 m S: 84.4 % against 83.9 % | 3.1 s |

The first version took 6.9 s (IM-2) and 8.5 s (Apollo 15) on a test-only stack without the
polar layers and the whole-Moon grid, and 8-12 s on the merged stack; the gain is the faster
skyline of section 3, and a candidate's skyline now has the same accuracy as the main
analysis' (table in section 3). In the browser's worker under headless software rendering the
IM-2 scan takes 6-9 s. Not done: a coarse pre-rank with a full pass on the best few (it would
mix two accuracy classes in one ranking), several workers (each would decode its own 100 MB of
grids at polar sites), and sharing the far skyline between candidates (candidate skylines would
then differ from independently computed ones by roughly 0.1 deg).

Runtime is checked deliberately, not in the default test run (a wall-clock limit fails on a
busy machine for reasons unrelated to the code): `node scripts/bench-analysis.mjs` measures a
skyline profile, a 14-day `analyse()` and the default scan on IM-2, Apollo 15 and Blue Ghost
(best of a few repetitions, one thread) against budgets of 500 ms, 1.5 s and 10 s, and exits 1
when one is exceeded. Last run: 71-88 ms, 133-206 ms, 3.3-4.0 s.

Synthetic checks: a ridge crest outranks the valley floor; a 20 deg wall is rejected at a
10 deg limit and accepted at 30 deg; candidates without data are rejected as `no-data`.
Resolution caveat, stated in every candidate's `basis`: slope and skyline rest on 60 m
grids; metre-scale boulders, craters and slopes are invisible to this scan.

## 6. Extension: geometric opportunities with the DSN stations (`src/analysis/dsn.ts`, task T-21)

For the mission window, `analysis.dsn` gives, per station and for any of the three, the spans in
which the straight line between the station and the site is open at both ends: the site above
the station's elevation limit, and the station (its own direction, not Earth's centre) above
the site's terrain skyline. `dsnAt(analysis, t)` gives the same for one instant, with what is
in the way. **Geometry only**: no link budget, frequency, antenna pattern, scheduling or
availability; the stations' own terrain masks are not applied.

**Station facts** (DSN Telecommunications Link Design Handbook, JPL 810-005, Module 301
"Coverage and Geometry", Rev. N, 15 April 2022,
https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301N.pdf):

| Station | Geodetic latitude, longitude, height (Table 5, WGS 84) | Cartesian x, y, z (Table 2, ITRF93, epoch 2003.0), m |
| --- | --- | --- |
| DSS 14, 70-m, Goldstone | 35 25 33.24312, 243 6 37.66244, 1001.390 m | -2353621.420, -4641341.472, +3677052.318 |
| DSS 43, 70-m, Canberra | -35 24 8.72724, 148 58 52.56231, 688.867 m | -4460894.917, +2682361.507, -3674748.152 |
| DSS 63, 70-m, Madrid | 40 25 52.35510, 355 45 7.16924, 864.816 m | +4849092.518, -360180.3480, +4115109.251 |

JPL Horizons holds the same coordinates for its sites -14, -43 and -63 (checked to its printed
digits in `src/analysis/dsn.test.ts`), and the two tables describe the same points to 1 cm.

**Elevation limits assumed**, from the same module: section 2.2.3, "generic elevation limits
for the receive and transmit elevations. These are 6.0 degrees for receive, 10.0 degrees for
low-power transmit, and 13.5 degrees for high-power transmit"; section 2.2.2, "the mechanical
elevation limit, which is approximately six degrees"; section 2.2.3.2, the 70 m transmit
chart uses "a 10.4-degree transmit elevation limit at DSS 14 and a 10.2-degree transmit
elevation limit at DSS 43 and DSS 63". Used here: receive 6.0 deg; transmit 10.4 / 10.2 / 10.2
deg. Not used: the azimuth-dependent horizon masks of the module's Figures 11, 18 and 23 (for
example "a 20.2-degree elevation limit to protect the high ground to the northwest" of DSS 63
when transmitting), high-power transmit limits, keyholes and cable wrap.

**Check against JPL Horizons** (`src/analysis/__fixtures__/horizons-dsn-check.json`, built by
`node scripts/fetch-horizons-dsn-check.mjs`: target `g: lonE, lat, alt @ 301`, a point on the
Moon's surface in MEAN_ME; observers -14@399, -43@399, -63@399; apparent, airless):

| What | Rows | Worst difference |
| --- | --- | --- |
| Elevation of the lunar site at the station (Blue Ghost, IM-2 and a west-limb point; 2025-03-06/07 hourly, 2025-03-13 around the limits, 1971-07-31, 2034-09-10) | 1154 | 0.00115 deg |
| Azimuth (as arc) | 1154 | 0.00128 deg |
| Rise and set times through 6.0 and 10.2 / 10.4 deg (2025-03-13, Horizons at 1 min) | 24 crossings | 0.27 s |

The geometry takes UT1 = UTC (they differ by at most 0.9 s, so about a second in rise and set
times in general) and ignores polar motion and the 1.3 s of light-time; no refraction. The
straight-line distance returned is geometric: Horizons' light-time range differs from it by up
to about 50 km (37 km from Earth's motion during the light-time, 12 km from the lunar theory).

**Results** (2 m mast, 14 days, real terrain):

| Site | DSS-14 receive / transmit | DSS-43 | DSS-63 | Any station, receive | Any station, transmit | Earth's centre in view |
| --- | --- | --- | --- | --- | --- | --- |
| Blue Ghost 1 from 2025-03-02 08:34 | 51.6 % / 48.4 % | 36.0 % / 32.6 % | 54.5 % / 51.1 % | 100 % | 99.42 % (longest gap 0.30 h) | 100 % |
| IM-2 from 2025-03-06 17:28 | 41.7 % / 39.0 % | 37.9 % / 34.9 % | 42.0 % / 39.2 % | 88.77 % (longest gap 26.4 h, runs into the window edge) | 87.95 % | 88.90 % |
| Apollo 15 from 1971-07-30 22:16 | 42.0 % / 38.5 % | 49.6 % / 46.5 % | 37.9 % / 34.3 % | 99.91 % (longest gap 0.2 h) | 96.77 % (1.30 h) | 100 % |
| Chandrayaan-3 from 2023-08-23 12:33 | 40.6 % / 37.0 % | 47.4 % / 44.3 % | 41.0 % / 37.1 % | 99.74 % (0.4 h) | 96.24 % (1.55 h) | 100 % |

At IM-2 Earth hangs near the skyline, so it matters where on Earth's disc a station sits: seen
from this south-polar site, Canberra stands about 1 deg higher above the lunar skyline than
Goldstone or Madrid (its clearance ranges over -0.99..13.29 deg against -2.00..12.28 and
-1.81..12.16). On a smooth Moon: a far-side site has no opportunity at all; a site at 0 N 0 E
over 28 days has 43.8-45.1 % per station and 99.83 % for any station (receive).

Cost: about 50 ms of a 14-day analysis (130-145 ms in all with a Horizons table).
Neither Blue Ghost Mission 1 nor IM-2 is claimed here to have used these stations: which
ground stations the missions used was not looked up.
