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
reads low wherever the terrain peaks between two samples: by up to 0.25 deg at a pin on
Shackleton's rim and 0.48 deg on the Malapert massif (steep ground a few hundred metres away,
80 m data), 0.04-0.05 deg at the catalogued sites. Two things remove that:

- Close to the observer the step is also at most 5 % of the distance (from 0.1 m out, or a
  third of the mast height), because what a rise of 30 cm does to the skyline grows as the
  distance shrinks.
- Every step that a hidden peak could lift above the best sample is searched inside, at 1/6
  and then 1/24 of its length. "Could" is judged from how much the elevation changes from
  sample to sample around the step (and, where the steps are longer than the data's own
  sampling, from a 35 deg slope over half a step). Until T-31 only steps next to a sampled
  local maximum were searched; a peak that rises and falls between two samples of a falling
  slope was missed (up to 0.05 deg at a 2 m mast, see 3a).

Measured against a march twenty times finer that is searched the same way
(`src/analysis/horizon.test.ts`, 180 azimuths per site, 2 m mast):

| Site | Plain march: max / rms | Default settings: max / rms | Scan settings (1 % far steps, 10 % near, 3-point search) |
| --- | --- | --- | --- |
| IM-2 | 0.036 / 0.0064 deg | 0.001 / 0.0001 deg | 0.003 / 0.0006 deg |
| Apollo 15 | 0.054 / 0.0159 | 0.004 / 0.0006 | 0.014 / 0.0022 |
| Pin on Shackleton's rim (89.45 S, 137.2 W) | 0.251 / 0.0380 | 0.002 / 0.0003 | 0.011 / 0.0021 |
| Pin on the Malapert massif (86.0 S, 2.9 E) | 0.478 / 0.1312 | 0.004 / 0.0008 | 0.022 / 0.0051 |

So what remains is the data, not the sampling: the skyline is that of the bilinearly
interpolated grids, and relief finer than a grid is not in it (within a few hundred metres of
a pin that only has 80 m data, that is the larger uncertainty by far).

### 3a. Independent check, and an observer on the ground (T-26 by @ephemeris-check, T-31)

@ephemeris-check computed skylines with a ray march of their own over the bundled grids
(nothing from `src/`; `tests/fixtures/validation/ephemeris-check/skyline/`, 720 azimuths per
case) and compared three builds with them. App minus reference, worst azimuth:

| Case | Before the fine search (375f816) | With it (32ef35a, cc736f8) | Now (T-31) |
| --- | --- | --- | --- |
| IM-2, 2 m | -0.036 deg | 0.002 | 0.003 |
| Apollo 15, 2 m | -0.068 | -0.003 | -0.004 |
| Chandrayaan-3, 2 m | -0.073 | -0.014 | 0.002 |
| Connecting ridge pin (89.45 S, 137.2 W), 2 m | -0.272 | -0.012 | 0.002 |
| Shackleton rim pin (89.78 S, 155.73 W), 2 m | -1.040 | -0.051 (72 azimuths over 0.02) | -0.004 |
| Connecting ridge pin, **0 m** | -2.536 | **-1.093** (278 azimuths over 0.1) | 0.002 |
| Rim top (89.7843 S, 155.9041 W), **0 m** | -5.015 | **-1.225** (261 over 0.1) | 0.002 |
| Ridge top (89.4749 S, 137.4431 W), **0 m** | -1.616 | **-0.259** (265 over 0.1) | 0.001 |
| Shackleton rim pin, 0 m | -0.868 | -0.027 | -0.003 |
| IM-2, 0 m | -0.038 | -0.002 | 0.003 |

The first two columns are @ephemeris-check's own figures (`skyline/results.txt`); the last is
this repository's test against their stored reference skylines
(`horizon.test.ts`, "the two polar pins of the independent validation"), which they are asked
to repeat with their own run. Apollo 15 was measured once and is not in the standing test:
task T-32 eases the 3 m site models onto their 60 m windows at load, after which the app's
terrain at the sites with a 3 m model no longer equals the stored files the reference used.

**Re-checked independently** by Lunyx Science's @validation (T-34, branch
am/lunyx-science/agent/validation at af49a12, `tests/fixtures/validation/science-validation/skyline-masts/results.txt`):
the skyline of `analyse()` at 1289083 for observers at 0, 0.5 and 2 m at nine pins (the seven
of round 1 and two grid summits picked by a fixed rule before any app output was seen), 27 runs:
within 0.0042 deg at the seven round-1 pins, worst 0.0171 deg at one new summit pin with a 2 m
mast (app low, at a crease 8.5 m away), no azimuth over 0.02 deg. Verdict: agrees. Still to
come from them: the 18.6-year any-Sun share at 0 m at the connecting ridge pin.

**The defect they found: an observer on the ground.** Seen from height H above the ground,
terrain at a small distance d stands at about (h(d) - h(0) - H) / d. With H = 0 the limit at
d = 0 is the slope of the ground at the observer's feet, and on convex ground (a crest, a rim
top) that slope *is* the skyline: their reference found its maximum "0 m away" over hundreds
of azimuths. The app's first sample was 0.7 of a grid cell out (28 m on the 40 m polar grid;
the fine search reached in to about 12 m), so it read up to 1.09 and 1.23 deg low at the two
polar pins. Their measured consequence over 18.6 years of hourly samples at 0 m: 48.93
against 44.21 % any-Sun share at the connecting ridge pin (+4.7 points), +1.7 and +0.8 at the
other two; with a 2 m mast nothing (within 0.03 points at all six polar points).

**Builds affected:** every build up to integration cc736f8, for observers lower than about a
metre on convex ground. How the old error fell off with height, against a brute-force march
of the first 3 km (every 2 cm near the observer, `HeightSource.sample()` only; 120 azimuths):

| Mast | Connecting ridge pin: before / now | Rim top: before / now | Shackleton rim pin | Blue Ghost 1 (3 m data) |
| --- | --- | --- | --- | --- |
| 0 m | -1.093 / 0.002 deg | -1.225 / 0.001 | -0.023 / -0.003 | -0.077 / 0.001 |
| 0.25 m | -0.511 / 0.002 | -1.007 / -0.002 | -0.025 / -0.003 | -0.010 / 0.002 |
| 0.5 m | -0.040 / 0.001 | -0.794 / -0.003 | -0.029 / -0.003 | -0.011 / 0.002 |
| 1 m | -0.020 / 0.001 | -0.076 / -0.001 | -0.038 / -0.003 | 0.002 / 0.002 |
| 2 m | -0.007 / 0.001 | -0.005 / 0.001 | -0.049 / -0.004 | 0.002 / 0.002 |

**What changed (T-31).** The march starts 0.1 m from the observer (or a third of the mast
height) with the proportional steps described above, and for H = 0 it includes the limit at
distance zero: the slope of the interpolated terrain along the ray, extrapolated from the two
closest samples (within one grid cell the interpolated height is a polynomial of the distance,
so the extrapolation is exact there). Such a skyline point is reported with distance 0, and
`blockageAt()` says "formed by the ground at the observer's own feet". The ground height under
the observer is now looked up the same way as the terrain along the rays (the fast lookups
reproduce `sample()` to a part in a million, which is millimetres: 10 cm from the observer
that would tilt the ground by degrees).

Analytic checks (`horizon.test.ts`): on a dome h = 500 - 0.004 r^2 with the observer 30 m from
its top, the skyline is atan(0.24 sin az) for H = 0 and atan(0.24 sin az - 2 sqrt(H k)) for
H = 0.05, 0.5 and 2 m, formed sqrt(H / k) from the observer, and the horizon of the plain
below wherever that is higher: within 0.01 deg at all 720 azimuths. In a bowl (concave ground)
the rim is the skyline at 0, 0.5 and 2 m (within 0.02 deg; the rim is a crease, found to half
a metre along the ray), never the ground at the feet. A smooth sphere gives 0 deg at H = 0 and
the horizon dip otherwise, as before.

**What a 0 m result means.** It is correct for the elevation grid, and the grid is all it
knows: with the observer on the ground the skyline over a quarter to nearly half of the horizon
at the three convex pins (180 to 313 of 720 azimuths) is the slope of a 40 m grid cell.
Rocks, regolith mounds and metre-scale relief are not in the data. The profile therefore
carries a warning whenever part of the skyline is formed closer than one grid step: "With
the observer on the ground, the skyline in N of 720 directions is the ground within 28 m of
the observer: the slope of the 40 m elevation grid there. ...". No minimum mast height needs
to be enforced; 0 m is answered and labelled.

**Cost.** CPU time on one thread, measured on a busy machine with the old code run back to
back (`scripts/bench-analysis.mjs`): a full profile 170-267 ms (was 129-213), a 14-day
analysis 285-398 ms (was 245-335), the default nearby scan 3.6-8.6 s (was 3.0-7.1; the scan
uses 10 % near steps and a 3-point search), the 12-month outlook 528-645 ms (was 465-580).
All inside the budgets (500 ms, 1.5 s, 10 s, 3 s).

**Speed, without changing the result.** The march skips elevation layers that cannot reach
the current distance (their reach is predicted from each grid's description and checked
against the grid itself) and reads the projected grids straight from the point's unit vector
instead of going through latitude and longitude. Both are verified against the plain
`HeightSource.sample()` path in `src/analysis/fastSample.test.ts`: 39 000 height lookups on
13 real grids agree to 1e-6 m; no covered point lies outside its predicted reach (24 443
checked); and the skyline at 10 sites (IM-2, Apollo 15, Chandrayaan-3, Chang'e 4, a Shackleton
rim pin, both exact poles, pins at the edges of the 85S and 80S squares, the antimeridian) is
identical with pruning alone and equal to rounding (< 0.000005 deg) with the direct lookups.

| Full profile (720 azimuths), min of 12 runs, one thread, idle machine | First version | With the fine search, before T-31 |
| --- | --- | --- |
| IM-2 (60 m window, 80 m and 160 m polar layers, 1.9 km grid; to 189 km) | 202 ms | 89 ms |
| Apollo 15 (3 m, 60 m, 480 m windows, 1.9 km grid; to 204 km) | 175 ms | 72 ms |
| Blue Ghost 1 (same layers; to 229 km) | 194 ms | 75 ms |
| Chandrayaan-3 (60 m, 480 m windows, 1.9 km grid; to 174 km) | 93 ms | 38 ms |

The near-field steps and the wider search of T-31 (3a) add about a quarter to these profile
times; they were not re-measured on an idle machine.

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
| The same on three other dates (2023-08-23, 2025-03-17, 2031-04-10; Horizons both ways; independent, @ephemeris-check T-34, `tests/fixtures/validation/ephemeris-check/dsn/`) | 84 crossings | 5.3 s |

**Precision of the crossing times: about 5 s, not 0.3 s.** The crossings are refined by
bisection to 10 s (`EVENT_PRECISION_MS`), so each is within 5 s of where the geometry puts it;
the 0.27 s of the first check was that day's luck. The independent check confirms it: the
elevations agree to 0.001 deg (0.3 s at the horizon) while the edges scatter by up to ±5 s with
both signs, whatever the series step (3.8 s at 1 min, 5.3 s at 10 min). An earlier version of
`analysis.dsn.assumptions` said "within 0.3 s"; it now says about 5 s. Edges set by the lunar
terrain (the station going behind the site's skyline) agree within 1.5 min, because the
station's elevation there changes by only about 0.001 deg per minute. Station coordinates equal
Horizons' DSN sites within 0.01 m.

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

## 7. The long view: `outlook()` and darkness measured in full (`src/analysis/outlook.ts`, `extend.ts`, task T-29)

`outlook(scenario, { months = 12, windowDays? })` evaluates one long stretch for the scenario's
site and mast height (one skyline; the in-app Sun/Earth model throughout, sampled every 20 min;
rise and set times refined to 10 s) and cuts three things from it: a row per lunar day
(29.530589 days, or per `windowDays`), a mission of the scenario's length for every arrival
time across the span (every 2 h) with the best and worst arrivals by the nearby ranking's score,
and the darkness and Earth gaps measured in full. Geometry only: nothing about power or
temperature.

**Model over long spans.** The model's directions are computed every 3 h and interpolated
with a cubic (`tabulatedEphemeris`): against the model itself over 380 days at four sites the
worst difference is 0.000018 deg in direction and 5e-8 deg in angular radius
(`src/analysis/sky.test.ts`). `analyse()` now uses the same tabulation when no Horizons table
covers the window.

**Rows agree with `analyse()` for the same windows** (`src/analysis/outlook.test.ts`, IM-2, lunar
days 1, 6 and 12 analysed separately at 10 min): sunlight, any-Sun and Earth percentages within
0.05 points (observed: identical to three decimals), longest darkness and Earth gap within
0.1 h, highest Sun within 0.01 deg. The planned arrival agrees with `analyse(scenario)` (bundled
Horizons table, 10 min) within 0.1 points and 0.1 h.

**IM-2 (84.79 S, 29.2 E), 2 m mast, twelve lunar days from the landing, 2025-03-06 17:28 UTC**

| Lunar day | From (UTC) | Sunlight | Any Sun | Longest darkness | Earth in view | Longest Earth gap | Highest Sun |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2025-03-06 17:28 | 45.1 % | 46.0 % | 379.8 h | 79.1 % | 148.2 h | 5.36 deg |
| 2 | 2025-04-05 06:12 | 42.4 % | 44.3 % | 395.0 h | 79.4 % | 146.0 h | 4.54 deg |
| 3 | 2025-05-04 18:56 | 36.6 % | 39.4 % | 409.0 h | 80.6 % | 137.3 h | 3.91 deg |
| 4 | 2025-06-03 07:40 | 35.4 % | 37.7 % | 410.6 h | 82.0 % | 127.4 h | 3.63 deg |
| 5 | 2025-07-02 20:24 | 37.7 % | 40.6 % | 402.1 h | 82.3 % | 125.1 h | 3.76 deg |
| 6 | 2025-08-01 09:08 | 44.1 % | 45.6 % | 385.8 h | 75.7 % | 143.7 h | 4.26 deg |
| 7 | 2025-08-30 21:52 | 46.7 % | 47.6 % | 369.7 h | 72.2 % | 147.4 h | 5.01 deg |
| 8 | 2025-09-29 10:36 | 49.8 % | 50.8 % | 348.6 h | 72.2 % | 147.4 h | 5.82 deg |
| 9 | 2025-10-28 23:20 | 51.9 % | 53.2 % | 331.4 h | 81.8 % | 129.3 h | 6.45 deg |
| 10 | 2025-11-27 12:04 | 51.8 % | 53.4 % | 330.2 h | 82.5 % | 124.1 h | 6.73 deg |
| 11 | 2025-12-27 00:48 | 50.2 % | 51.2 % | 346.1 h | 81.5 % | 130.9 h | 6.55 deg |
| 12 | 2026-01-25 13:32 | 47.6 % | 48.8 % | 362.6 h | 80.4 % | 138.7 h | 5.96 deg |

The Sun's highest point moves by 3.1 deg through the year (the Moon's equator is tilted 1.54
deg to the ecliptic), and the sunlight per lunar day with it, from 35 % to 52 %. For a 14-day
mission the score (mean of sunlight % and Earth line-of-sight %) ranges from 29.4 (arriving
2026-02-08 05:28 UTC: no sunlight) to 100.0 (arriving 2025-11-26 07:28 UTC: unbroken sunlight and
Earth in view); the actual landing time scores 90.7 (92.5 % sunlight, Earth 88.9 %, longest
darkness 18.2 h). A slip of 1, 3, 7, 14 or 28 days from it gives 83.5, 69.2, 49.2, 33.5 and
87.2: a week's delay halves the sunlight (42.5 %) and puts 186 h of darkness into the mission.

**A pin on Shackleton's rim (89.45 S, 137.2 W), same dates:** sunlight per lunar day from
43.8 % (June 2025, longest darkness 144.6 h) to 100.0 % for five lunar days in a row (from
2025-09-29), with the Sun's centre never more than 2.1 deg above the horizontal; Earth's centre
in view 46-55 % of each lunar day (gaps of about 320 h). On a smooth Moon the same code gives:
0 N 0 E, 49.5-50.2 % in every lunar day and nights of 352-354 h; 0 N 180 E, Earth 0 % in every
lunar day; 89 S, lunar days from 0 % to 100 %, six lunar days apart, and a polar night of
2011 h.

**Darkness in full.** `analyse()` keeps `longestDarknessH` and `darknessOpenEnded` as they
were (the part inside the window, flagged as a lower bound) and adds
`metrics.longestDarknessFull` and `longestEarthGapFull`: the longest spell that overlaps the
window, followed beyond the window's edges to its real start and end with the model, up to 60
days each way (`startFound` / `endFound` say whether the limit was hit). IM-2, 14 days from the
landing: the window holds 18.2 h of the night that begins 2025-03-19 23:17; in full it lasts
379.8 h, to 2025-04-04 19:03 UTC. The Earth gap that begins 2025-03-19 04:09 lasts 148.2 h in
full, to 2025-03-25 08:19. A permanently shadowed floor returns "no start or end within 60
days ... at least 3000 h" for a 5-day window.

**Runtime** (`node scripts/bench-analysis.mjs`, CPU time on one thread, terrain already
loaded; measured while the machine was busy, load average 7): 12 months at IM-2 0.36 s, at the
Shackleton rim pin 0.37 s, at Apollo 15 0.36 s (wall-clock 0.31-0.40 s). The skyline is
computed once (0.09-0.12 s of it).

## 8. Independent end-to-end validation (T-26 by @ephemeris-check)

@ephemeris-check rebuilt the chain without code from `src/`: their own ray march over the
bundled elevation grids, JPL Horizons and SPICE for the Sun and Earth, and published mission
facts. Everything is in `tests/fixtures/validation/ephemeris-check/` (`README.md`,
`T-26-handover.md`, `*/results.txt`; checks 1, 2 and 4 re-run offline from the stored inputs,
checks 0 and 3 need the PDS, PGDA and SPICE downloads). They compared two builds: integration
375f816 (before the skyline fine search of section 3) and 32ef35a (with it). The figures below
are theirs; the observer-on-the-ground repair is in 3a.

**What agrees** (32ef35a, observer 2 m up unless stated)

- *Elevation data.* The bundled LOLA grids equal the PDS originals within rounding at 30 080
  samples; a one-sample shift or a mirror image would not.
- *Skyline.* Within 0.05 deg at five sites, 0.002-0.014 deg at four of them (table in 3a).
- *Event logic.* Fed the same skyline, the app's Earth-visibility share is within 0.02 points
  of theirs, its Blue Ghost sunset (last limb) within 20 s at three eye heights, eclipse
  totality at Blue Ghost and Apollo 15 within 6 s.
- *Events against Horizons and their skyline.* Blue Ghost last limb 2025-03-16 19:30:03 UTC
  (app 19:30:11; 19:16 at 0.5 m, 19:58 at 5 m); eclipse of 2025-03-14 totality
  06:17:24-08:34:25 (app 06:17:19-08:34:19); Chandrayaan-3 sunset 2023-09-04 08:02:23 and
  sunrise 2023-09-19 23:57:08 (app 08:02:08 and 23:56:40); Apollo 15 sunset 1971-08-13
  11:36:55 (app 11:36:42). Through the bundled Horizons tables: eclipses within 2 s, IM-2
  Earthset +1.9 min, IM-2 sunset -0.1 min.
- *Published facts.* Firefly's Blue Ghost eclipse times (first contact, totality, last
  contact) within 0.8 min of both computations; Chandrayaan-3's published sunset date
  (4 September 2023).
- *Apollo Lunar Surface Journal* (J. Scotti's table, 43 instants of Apollo 11-17): the app is
  within 0.004 deg of an exact SPICE computation at all 43; the table itself agrees at 42 (one
  Apollo 12 row is 0.40 deg off in Sun azimuth, out of line with its neighbours in the table).
- *Earth visibility, 60 days from 2025-03-01, five polar and limb pins:* within 0.05 points;
  rise and set within 23 min, the same number of risings and settings everywhere.
- *18.6 years, hourly, six south-polar points:* the app within 0.03 points of their any-Sun
  share at 2 m. Three independent routes agree at IM-2: PGDA product 69 46.55 %, theirs
  46.35-46.71 %, the app 46.31-46.68 % (0 m to 2 m); Shackleton's floor is permanently dark in
  all three. On crests, 2 m up, both computations are within 1.4 points of PGDA's brightest
  pixels (PGDA's own neighbouring 60 m pixels differ there by tens of points, so a single
  pixel proves nothing).
- *Sky positions:* `skyAt()` within 0.0036 deg on all 1008 rows of the T-18 fixture on
  32ef35a (section 1a).

**The defects found, and the builds they affected**

- *Skyline read low near the observer* (fixed by the fine search of section 3, integrated
  between 375f816 and 32ef35a). In 375f816 and earlier: up to 1.04 deg at a Shackleton rim pin
  with a 2 m mast; Earth visibility +2.0 points there with Earthrise and Earthset six hours
  off, +1.2 points and up to 7.7 hours at a west-limb pin (1.9 km data only); Chandrayaan-3
  sunset 6.6 min late; 2 m sunlight up to 0.79 points high; on the ground 14.5 to 30.8 points
  too bright on three crest points.
- *Observer on the ground* (fixed in T-31, section 3a). In every build up to integration
  cc736f8: up to 1.23 deg low on convex ground at 0 m, +4.7, +1.7 and +0.8 points of 18.6-year
  any-Sun share at three crest points. Nothing measurable with a 2 m mast.
- *Not a defect, a definition* (decision D-8): the app's "sunset" is the last limb. Firefly's
  "operating just over 5 hours into the lunar night with the final data received around
  6:15 pm CDT on March 16" puts the start of night at about 18:15-18:35 UTC, which is where the
  skyline first cuts the Sun (18:23 UTC at 2 m), an hour before the last limb (19:30). The
  other end of each transition is being added (T-31 item 2, now with Lunyx Science, @events).
  Until it lands, the events the app computes are the last limb (setting) and the first limb
  (rising) of the Sun and the crossing of Earth's centre, and D-8 asks every panel, countdown
  and sentence to say which instant it quotes.
- *Not a defect, a definition:* the app's Earth visibility counts Earth's centre; PGDA's map
  counts any part of the disc. Counting any part, @ephemeris-check reproduces PGDA within
  1.1 points at four smooth polar points; the centre figure is 4-5 points lower at the pole
  and 11 lower at IM-2 (IM-2, 2 m: PGDA 92.26 %, any part 93.34 %, centre 81.12 %, app 81.12 %).
  An any-part figure alongside the centre one is being added (T-31 item 3, now with Lunyx
  Science, @events).
- *Under Node,* `analyse()` uses the model instead of the two bundled Horizons windows unless
  `setBundleReader` is called (the browser fetches them itself). A script that forgets it does
  not notice: the model is within 0.004 deg of Horizons, so only seconds move.

**Chandrayaan-3 sunrise: not confirmed by ISRO.** ISRO wrote that the "next sunrise [is]
expected on September 22, 2023". First sunlight over the skyline is 2023-09-19 23:57 UTC
(20 September 05:27 IST) by both computations, two days earlier; by 22 September 00:00 IST the
Sun stands 8.2 deg above the horizontal and 6.8 deg above the skyline. ISRO's date may mean
usable power; it must not be quoted as confirming the app's sunrise time.

**Not checked**

- No published rise, set or shadow time was found for IM-2, or a sunset time for Apollo 15.
- The site windows (`public/terrain/*.bin`) against their PDS sources: only the `.lxg` grids
  were compared with the originals. Where the 3 m site models meet the 60 m windows they
  stepped by several metres (about 15 min of Blue Ghost sunset; task T-32 eases them at load).
- The longest darkness over 18.6 years (the two builds differ there: 4221 h and 4896 h at the
  rim pin, 2 m) and the seasonal outlook of section 7.
- Anything north of the bundled polar layers at better than 1.9 km, other than at landing
  sites; PGDA's averaging dates (not stated by PGDA); Earth's atmosphere in eclipse timing.
- The reference is only as good as the bundled elevation data: agreement says the app computes
  correctly from that data, not that a 40 m grid describes a rim crest to the metre.

### 8a. Round 2 (T-34 by @ephemeris-check, integration cc736f8)

`tests/fixtures/validation/ephemeris-check/T-34-handover.md` (commit a9bc640). Round 2 is being
finished by Lunyx Science (@validation), which also re-runs the observer-on-the-ground skylines
against T-31's change.

- *Seasonal outlook* (section 7; IM-2 and the Shackleton rim pin, 12 lunar days from
  2027-01-01, 2 m): rows within 0.11 points of SPICE against their own skyline, except row 9 at
  the rim pin (2027-08-25, +0.57 any-Sun points). With the app's own skyline and SPICE the row
  gives 21.40 % against the app's 21.41 %, so the excess is the cc736f8 skyline, up to 0.05 deg
  low at that pin. The skyline of section 3a is within 0.004 deg of their reference there; the
  row has not been re-run on it. Arrival scores within 0.15 and 0.20 points (4253 arrivals 2 h
  apart); best and worst arrival at the same instants, except a flat minimum at IM-2 (app
  2027-12-20 06:00, 31.79; theirs 8 h earlier, 31.80). Longest darkness of the year: IM-2
  411.7 h both; rim pin 4213.3 against 4213.5 h. The in-app model over the year: Sun within
  0.0038 deg and Earth within 0.0030 deg of SPICE.
- *Darkness and Earth gap in full* (section 7, `metrics.longestDarknessFull`): five windows,
  every end found by both, ends within 3.1 min (IM-2 night 379.78 h against 379.79 h).
- *DSN geometry* (section 6): as above, crossing times within 5.3 s, now stated as about 5 s.
- *Slope*: recomputed from the files with the app's stated measure, identical to 0.0000 deg at
  all 28 sites and at the ten best-ranked scan candidates at IM-2. Against published landing
  tilts the baseline decides: Surveyor 3 "came to rest on a 14 degree slope" (NSSDC 1967-035A),
  app 12.5 deg over 10 m on the 3 m model, 3.7 deg over 120 m on the 60 m window; Apollo 14 "settled
  on a seven-degree slope", 7.2 deg and 1.3 deg. Only the 10 m measure on a 3 m model is close
  to what a lander stands on; sites without a 3 m model, and every nearby candidate, get the
  120 m measure, which cannot see lander-scale slope (the slope basis sentence of every result
  names the baseline and the grid).
