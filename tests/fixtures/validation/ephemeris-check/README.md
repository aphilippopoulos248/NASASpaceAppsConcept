# Independent end-to-end validation (T-26)

The sky model was validated in T-18 (`tests/fixtures/horizons/ephemeris-check/`). This directory
checks what is built on top of it: the terrain skyline, rise and set times, eclipse times,
long-term sunlight and Earth visibility. Every reference value is computed here, from the data
files and from outside sources, with code that shares nothing with `src/analysis` or
`src/terrain`. The app is only ever *called* (`app_dump.mjs`, `app_skyat.mjs`).

Owner: @ephemeris-check. Two builds were tested side by side:

- **before**: `am/lunyx/integration` at 375f816, the integrated build when this task started;
- **now**: `am/lunyx/integration` at 4f007f1. It contains @analysis's skyline fix (1828486),
  which was merged while this task was running (a7b4e70).

The fix was first tested from a read-only snapshot of `am/lunyx/agent/analysis` at ecc9793,
before it was merged. The current integration has the same `src/analysis` and `src/astro` and
returned identical numbers in all 38 runs, so only the two builds above are kept.

## Summary

| Check | Before (375f816) | Now (4f007f1) |
| --- | --- | --- |
| 0. Bundled elevation grids against the PDS originals | equal within rounding (30 080 samples) | same data |
| 1. Skyline, observer 2 m up, 5 sites, 720 azimuths each | **reads low**: up to 1.04 deg (Shackleton rim pin), 0.27 deg (connecting ridge); 0.04-0.07 deg at IM-2, Apollo 15, Chandrayaan-3 | within 0.05 deg everywhere (0.002-0.014 deg at four sites) |
| 1. Skyline, observer on the ground, 5 polar sites | **up to 5.0 deg low** on crests | **up to 1.2 deg low** on crests; fine elsewhere |
| 2. Sunset, sunrise, eclipse times against an independent computation | within 0.6 min, except Chandrayaan-3 sunset 6.6 min late | within 0.5 min |
| 3. 18.6-year sunlight at six south-polar points | 2 m up: within 0.8 points of my computation; **on the ground: +14.5, +15.8 and +30.8 points** on the three crest points | 2 m up: within 0.03 points; on the ground: +0.8, +1.7 and **+4.7 points** on the crest points |
| 4. Earth visibility over 60 days, 5 polar and limb sites | within 0.01 points at 3 sites; **+2.0 and +1.2 points** at the Shackleton rim and west-limb pins, rise/set times off by up to 6 and 7.7 hours | within 0.05 points; rise/set within 23 min |

**What agrees**

- The bundled LOLA grids are the products they claim to be: every sample checked against the
  PDS originals matches within the stated rounding, and a one-sample shift or a mirror image
  would not.
- The app's event logic. Fed the same skyline, its Earth-visibility percentage is within 0.02
  points of mine; its sunset at Blue Ghost is within 20 s of mine at three eye heights; its
  eclipse totality at Blue Ghost and at Apollo 15 is within 6 s.
- Published eclipse times for Blue Ghost (start, start of totality, end) are within 0.8 min of
  the independent computation and of the app.
- Chandrayaan-3's published sunset date (4 September 2023).
- The Apollo Lunar Surface Journal's table of Sun and Earth angles: 42 of 43 rows within
  0.07 deg for the Sun; the app is within 0.004 deg of an exact SPICE computation at all 43.

**What does not agree**

- **Before the fix, the skyline was too low wherever it is formed within a few grid cells of
  the observer** (check 1). On a polar rim crest that is most of the Sun's 1.5 deg range, so
  that build reported sunlight and Earth contact that its own elevation data rules out (checks
  3 and 4). @analysis's fix removes it for an observer 2 m up, and it is now integrated.
- **Still open: with the observer on the ground (0 m), the current build is up to 1.2 deg low
  on convex ground**, because the slope at the observer's own feet is the skyline there and its
  first sample is 12 m out. Over 18.6 years that is +4.7 points of sunlight at the connecting
  ridge pin. It disappears with a 2 m mast.
- Chandrayaan-3: ISRO wrote "the next sunrise expected on September 22, 2023". First sunlight
  over the skyline, by my computation and by the app, is 19 September 23:57 UTC (20 September
  05:27 IST), two days earlier. By 22 September the Sun stands 8 deg up. Not resolved; ISRO's
  date may mean usable power.
- Blue Ghost sunset: Firefly's figures put the start of night at about 18:15-18:35 UTC on
  16 March 2025. That is when the skyline starts to cut the Sun (18:23 at 2 m), not when the
  last limb goes (19:30), which is what the app calls sunset. Firefly does not define its term.
- One row of the Apollo table (Apollo 12, end of EVA 1) differs by 0.40 deg in Sun azimuth; it
  is out of line with the rows on either side of it in the published table itself.
- PGDA product 69 against anything computed on Lunyx's elevation data, point by point on a
  crest (check 3): PGDA's own neighbouring 60 m pixels differ by tens of points.

**What could not be checked**

- IM-2: no published rise, set or shadow time was found.
- The site windows (`public/terrain/*.bin`) against their PDS sources. Only the `.lxg` grids
  were compared with the originals. The 3 m and 60 m layers were compared with each other
  (check 0b): they join with steps of several metres.
- Anything north of the bundled polar layers at better than 1.9 km, other than at landing sites.
- PGDA's averaging dates (not stated by PGDA), so the 18.6-year window here is a different one.
- Earth's atmosphere in eclipse timing (all discs are geometric).

## How the reference is built

| Piece | File | What it is |
| --- | --- | --- |
| Elevation reader | `lib/lunyx_dem.py` | Decodes the `.lxg` container (gzip, plane-delta int16), the polar stereographic and equirectangular grids and the site windows, from the format descriptions only. Verified against published positions: highest point 10 686 m at 5.41 N 158.66 W (LOLA: 5.4125 N 158.6335 W), lowest in Antoniadi at 70.34 S 172.47 W, Shackleton's floor at its IAU position (-2789 m at 89.67 S 129.78 E; the mirror image has +672 m). |
| Skyline | `lib/skyline.py` | Every ray sampled every 0.1 m near the site and every 0.05 % of distance beyond, to 500 km. Each sample is placed in 3-D from its own latitude, longitude and height; its elevation is the angle between the observer-to-sample vector and the observer's horizontal plane. Halving both steps changes the result by at most 0.005 deg. |
| Sun and Earth | `horizons/*.json`, SPICE | JPL Horizons hourly rows (airless, topocentric; raw replies in `horizons/raw/`), read between rows through unit vectors (error below 0.001 deg). The 18.6-year runs use SPICE, which reproduces Horizons to 0.000002 deg (T-18). |
| Visibility and events | `lib/skygeom.py` | Disc cut into 61 vertical strips, each compared with the skyline at its own azimuth; crossings bracketed on a one-minute grid and bisected to one second. |

Reference skylines are stored in `reference/` every 0.1 deg of azimuth (the app keeps 0.5 deg).

## Check 0: the elevation bundle (`terrain/`)

`check0_bundle_vs_pds.py` reads pieces of the original files at the PDS Geosciences Node by
HTTP range request and compares them with the bundle sample for sample.

| Bundled grid | Samples | Worst difference | Rounding allows | If shifted one sample | If mirrored |
| --- | --- | --- | --- | --- | --- |
| South pole 40 m (2x2 means of LDEM_875S_20M) | 320 at 5 places | 0.25 m | 0.25 m | 31 m | 3711 m |
| South pole 80 m (LDEM_85S_40M) | 448 at 7 places | 0.50 m | 0.50 m | 58 m | 3754 m |
| South pole 160 m (LDEM_80S_80M) | 512 at 8 places | 0.50 m | 0.50 m | 112 m | 3747 m |
| Whole Moon 16 px/deg (LDEM_16), 5 full rows | 28 800 | 0.50 m | 0.50 m | 1.3-10 km without the 180 deg shift | |

The places include the pixels under the Shackleton rim, connecting ridge, Shackleton floor and
IM-2 pins.

`check0b_layer_seams.py` compares the 3 m LROC NAC models with the 60 m windows around them at
the 19 sites that have both. Over the overlap they agree in the mean (0.00 m at every site;
standard deviation 1.8-3.9 m), but along the edge of the 3 m model, 768 m from the site, the
height steps by -10 to +22 m from one layer to the other. One metre there is 0.075 deg of
skyline. At Blue Ghost about 6 % of the skyline is formed exactly on that edge, including azimuths
267.9-275.4 where the Sun sets: there the 3 m model says -3641.0 m and the 60 m window
-3642.6 m, a 0.12 deg difference, about 15 minutes of sunset time. The rise itself (10 m, 0.7
to 0.85 km west of the lander) is in both layers.

## Check 1: skyline (`skyline/`)

App minus reference at the app's own 720 azimuths, observer 2 m above ground. Site heights
agree to 0.00 m at all five sites.

| Site | Before: worst | azimuths over 0.1 deg | Now: worst | azimuths over 0.02 deg |
| --- | --- | --- | --- | --- |
| IM-2 (-84.79, 29.2) | -0.036 deg | 0 | +0.002 | 0 |
| Apollo 15 | -0.068 | 0 | -0.003 | 0 |
| Chandrayaan-3 | -0.073 | 0 | -0.014 | 0 |
| Shackleton rim pin (-89.78, -155.73) | **-1.040** | **381 of 720** | -0.051 | 72 |
| Connecting ridge pin (-89.45, -137.2) | **-0.272** | 19 | -0.012 | 0 |

Every difference above 0.1 deg has the same cause. The march before the fix sampled the terrain
every 0.7 grid cell (28 m on the 40 m layer) and kept the largest sample. Where the skyline is
formed by ground one to three cells away, the true maximum lies between samples:

| Shackleton rim pin, azimuths | Worst | Reference skyline | App |
| --- | --- | --- | --- |
| 21.5-36.5 (31) | -0.48 deg | 1.52 deg from ground 98 m away | 1.04 deg, sampled at 112 m |
| 81.5-82.0 (2) | -0.11 | 1.49 deg from 81 m | 1.38 deg at 84 m |
| 114.0-174.0 (121) | -0.85 | 3.26 deg from 72 m | 2.41 deg at 84 m |
| 212.5-285.5 (147) | -1.04 | 5.72 deg from 46 m | 4.68 deg at 56 m |
| 301.0-324.0 (47) | -0.20 | 2.54 deg from 62 m | 2.34 deg at 56 m |
| 334.0-350.0 (33) | -0.17 | 1.37 deg from 100 m | 1.21 deg at 84 m |
| Connecting ridge pin, 161.0-169.0 (17) | -0.27 | -0.78 deg from 65 m | -1.05 deg at 56 m |
| Connecting ridge pin, 256.0-256.5 (2) | -0.12 | -2.40 deg from a rise 128 m away | -2.52 deg from terrain 61.7 km away (the near rise was stepped over) |

The result before the fix is never higher than the reference by more than 0.002 deg. The
current build searches finely around its candidate maxima and removes the effect; what is left
at the Shackleton rim pin is 0.05 deg (again low, 72 azimuths over 0.02 deg, worst at azimuth
261.5).

Why 0.1 deg is the right threshold: it is a fifth of the Sun's diameter, about 12 minutes of
sunrise time at low latitude, and 3 % of the Sun's whole elevation range at the pole. Below
0.02 deg the two computations are within each other's numerical noise.

Note on the data, not the code: on a crest the skyline 2 m above ground is set by ground 40 to
100 m away, i.e. by one or two samples of a 40 m grid. One metre of height error there is one
degree.

**Observer on the ground (0 m).** PGDA's maps describe the ground itself, so check 3 needs this
case, and the app accepts it.

| Site | Before: worst | azimuths over 0.1 deg | Now: worst | azimuths over 0.1 deg |
| --- | --- | --- | --- | --- |
| IM-2 | -0.038 deg | 0 | -0.002 | 0 |
| Shackleton rim pin | -0.868 | 433 | -0.027 | 0 |
| Connecting ridge pin | -2.536 | 429 | **-1.093** | 278 |
| Ridge top (-89.4749, -137.4431) | -1.616 | 475 | -0.259 | 265 |
| Rim top (-89.7843, -155.9041) | **-5.015** | 468 | **-1.225** | 261 |

With no mast, the skyline towards rising ground is the slope of the ground at the observer's
feet: the reference finds its maximum "0 m away" over hundreds of azimuths. The current build's
first sample is 12 m out and the earlier build's was 28 m, so on ground that curves away (a
crest, a shoulder) both miss it. Example, rim top: at azimuth 243.5 the reference is 3.23 deg
at the observer's feet and the current build 2.00 deg from 12 m; at 250.5 the reference is
3.29 deg from 10 m and the earlier build gave -1.72 deg from 28 m. Where the ground is not
convex at the pin (IM-2, the rim pin) the current build is right.

## Check 2: real events (`events/`)

Sources, quoted as fetched, with the precision their wording supports: `events/sources.json`.
Full output: `events/results.txt`.

**Blue Ghost Mission 1, sunset of 16 March 2025** (UTC)

| Eye height | Independent: skyline cuts the Sun | half hidden | last limb | App, last limb (before / now) |
| --- | --- | --- | --- | --- |
| 0.5 m | 18:09 | 18:42 | 19:16:07 | 19:16:26 / 19:16:19 |
| 2 m | 18:23 | 18:56 | 19:30:03 | 19:30:19 / 19:30:11 |
| 5 m | 18:51 | 19:24 | 19:57:57 | 19:58:11 / 19:58:04 |
| no terrain | 19:37 | 20:10 | 20:44 | |

Published: "346 hours of daylight ... operating just over 5 hours into the lunar night with the
final data received around 6:15 pm CDT on March 16" (Firefly). That is night from about
18:15-18:35 UTC, to a few tens of minutes. The terrain brings sunset forward by 74 minutes
against a smooth Moon, which is the right direction and size; the published start of night
matches the first cut, not the last limb. Three metres of eye height move the event by 28
minutes, and the layer seam of check 0b by about 15.

**The 14 March 2025 eclipse at the Blue Ghost site** (Earth in front of the Sun; UTC)

| | First contact | Sun wholly covered | Sun reappears | Last contact |
| --- | --- | --- | --- | --- |
| Published (KUT citing Firefly, read as CDT) | 05:00 | 06:18 | image "around" 08:30 "as the sun prepared to emerge" | "around" 09:52 |
| Independent (Horizons, geometric discs) | 05:00:43 | 06:17:24 | 08:34:25 | 09:51:10 |
| App, both builds | 05:01 (1 min samples) | 06:17:19 | 08:34:19 | 09:51 |

The article writes "CST" once; its own time stamp and Firefly's caption say CDT, which was in
force. Read as CST everything would be one hour late.

**Chandrayaan-3, September 2023** (UTC)

| | Sunset (last limb) | Next sunrise (first limb) |
| --- | --- | --- |
| Published | "on September 4" (secondary source) | "expected on September 22, 2023" (ISRO) |
| Independent, 2 m | 4 Sept 08:02:23 | 19 Sept 23:57:08 |
| App before | 08:09:01 (+6.6 min) | 23:56:31 |
| App now | 08:02:08 | 23:56:40 |

The Sun there gains 0.18 deg per hour, so the earlier build's 6.6 minutes are 0.02 deg of
skyline. At 22 September 00:00 IST the Sun is 8.2 deg above the horizontal, 6.8 above the
skyline.

**Apollo 15**: no published sunset time found. Independent 13 August 1971 11:36:55; app
11:37:01 / 11:36:42. Eclipse of 6 August 1971 at the site, Sun wholly covered 18:26:23 to
21:03:21; app 18:26:23 to 21:03:25.

**Apollo 11-17, 43 instants** (landing, EVA starts and ends, lift-off; table by J. Scotti in
the Apollo Lunar Surface Journal, values to 0.01 deg), worst difference in altitude / azimuth
arc:

| | Sun | Earth |
| --- | --- | --- |
| App minus published | 0.065 / 0.400 deg | 0.261 / 0.046 |
| App minus SPICE at the site | 0.0021 / 0.0033 | 0.0019 / 0.0034 |
| SPICE from the Moon's centre minus published | 0.067 / 0.403 | 0.075 / 0.044 |

The table is computed from sub-Earth and sub-solar points, so its Earth altitudes lack the site
parallax: that is the 0.26 deg. The 0.40 deg is the single row named above; without it the
Sun's azimuth agrees to 0.018 deg.

**The two bundled windows as the browser runs them.** Under Node the app silently falls back to
its model unless told where its bundled Horizons tables are, so everything above exercised the
model. With `app_dump.mjs --bundle` the app reads the tables (`source: "horizons"`):

| | Blue Ghost last limb | Blue Ghost Sun covered | IM-2 Sun covered (14 March) | IM-2 Earthset | IM-2 sunset |
| --- | --- | --- | --- | --- | --- |
| Independent | 19:30:03 | 06:17:24-08:34:25 | 05:33:04-08:18:52 | 19 Mar 04:07:45 | 19 Mar 23:17:13 |
| Before | +8 s | +2 s, +1 s | 0 s, 0 s | +3.8 min | +0.2 min |
| Now | +1 s | +2 s, +1 s | 0 s, 0 s | +1.9 min | -0.1 min |

At IM-2 Earth sinks by 0.05 deg per hour, so 3.8 minutes is 0.003 deg.

Tolerance for times: one minute is 0.008 deg of Sun at low latitude, and the sky model's floor
is 0.0036 deg, so agreement within about two minutes is all that can be asked when the
skylines agree.

## Check 3: 18.6 years of sunlight and Earth visibility (`illumination/`)

Window: 2010-01-01 + 163 044 h, one instant per hour (163 045). "Any Sun" is the share of
instants with any part of the disc above the skyline, which is PGDA's definition.

- **PGDA**: product 69, `AVGVISIB_85S_060M_201608` (60 m pixels, on the LOLA model
  LDEM_85S_060M). Its label states neither the calendar span nor a height above the ground.
- **Own**: SPICE Sun against `reference/skyline.<site>.m<mast>.json`, on the elevation data
  Lunyx bundles (40 m near the pole).
- **App**: `analyse()` over the same instants.

| Point | PGDA pixel (its 8 neighbours) | Own, 0 m | Own, 2 m | Before 0 m / 2 m | Now 0 m / 2 m |
| --- | --- | --- | --- | --- | --- |
| IM-2 | 46.55 % (42.6-46.7) | 46.35 | 46.71 | 46.32 / 46.69 | 46.31 / 46.68 |
| Shackleton floor (IAU centre) | 0 (0-0) | 0 | 0 | 0 / 0 | 0 / 0 |
| Shackleton rim pin | 6.26 (0-85.2) | 1.36 | 13.06 | 1.66 / 13.85 | 1.37 / 13.07 |
| Connecting ridge pin | 86.42 (0-73.9) | 44.21 | 87.63 | **58.70** / 88.00 | **48.93** / 87.62 |
| Ridge top: PGDA's brightest pixel | 88.44 (39.8-86.3) | 48.98 | 89.01 | **64.75** / 89.08 | 50.63 / 89.00 |
| Rim top: brightest on Shackleton's rim | 85.46 (43.2-80.2) | 39.52 | 86.83 | **70.27** / 87.01 | 40.28 / 86.81 |

**App against own, same elevation data.** Two metres up, the current build is within 0.03
points at every point (disc-averaged sunlight within 0.05); the earlier build was within 0.79
(rim pin). On the ground the earlier build was 14.5, 15.8 and 30.8 points too bright on the
three crest points and the current one is 4.7, 1.7 and 0.8: this is the 0 m skyline of check 1.
A tolerance of 0.5 points is fair here: 0.01 deg of skyline moves the any-Sun share at the pole
by a few tenths of a point, and 163 045 samples leave no sampling noise.

**Against PGDA.**

- IM-2 (a plateau, PGDA smooth around it): PGDA 46.55, own 46.35-46.71, app 46.31-46.69. Three
  independent routes within 0.4 points.
- Shackleton's floor: permanent shadow in all three.
- Crests: two metres up, own and app are within 1.4 points of PGDA at its brightest pixels
  (89.0 against 88.4, 86.8 against 85.5) and at the connecting ridge pin (87.6 against 86.4).
  On the ground they read 40-49 %. The reason is geometric, not a fault on either side: a point
  between the nodes of a 40 m grid always has rising ground in some direction, while PGDA's
  bright value belongs to a 60 m pixel that is a summit of its own grid.
- One 60 m step changes PGDA by tens of points on a crest (0 to 85 % around the rim pin), so a
  single-pixel comparison there proves nothing. The patterns do match: around the rim pin, PGDA
  and my ground-level computation have the same dark pixel (0 % and 0.0 %), the same near-dark
  one (6.3 and 9.0 %) and the same two brightest (`illumination/results.txt`). That also ties
  the bundled 40 m grid to PGDA's 60 m grid in position.

**Earth.** PGDA's Earth map counts any part of Earth's disc; the app counts Earth's centre.

| Point, 2 m | PGDA, any part | Own, any part | Own, centre | App, centre (before / now) |
| --- | --- | --- | --- | --- |
| IM-2 | 92.26 % | 93.34 | 81.12 | 81.13 / 81.12 |
| Connecting ridge pin | 57.94 | 58.25 | 53.60 | 53.58 / 53.58 |
| Ridge top | 58.08 | 58.17 | 53.50 | 53.50 / 53.49 |
| Rim top | 56.68 | 56.80 | 52.15 | 52.15 / 52.15 |
| Shackleton rim pin | 29.31 (neighbours 15.7-55.0) | 35.99 | 30.77 | **32.83** / 30.80 |

So the app's Earth figure is right for its own definition (the earlier build was +2.1 points
at the rim pin, as in check 4), and the definition accounts for the whole gap to PGDA:
counting any part of the disc reproduces PGDA within 1.1 points at the four smooth points. The
app's "Earth visible" is 4 to 5 points lower than PGDA's at the pole, and 11 lower at IM-2, by
definition.

Not independently recomputed: the longest darkness. The two builds differ there (rim pin, 2 m:
4221 h before, 4896 h now).

## Check 4: Earth visibility (`earth/`)

Sixty days from 2025-03-01, observer 2 m up. Earth counts as visible when its centre is above
the skyline (the app's definition). Reference: Horizons Earth against the 0.1 deg skyline.

| Site | Reference | Before | worst rise/set difference | Now | worst |
| --- | --- | --- | --- | --- | --- |
| IM-2 | 79.58 % | 79.57 | 2.6 min | 79.57 | 4.5 min |
| Shackleton rim pin | 31.86 % | **33.90** | **359 min** | 31.91 | 13.8 min |
| Connecting ridge pin | 56.00 % | 56.01 | 8.8 min | 56.00 | 4.3 min |
| East limb pin (0, 90) | 49.24 % | 49.25 | 3.4 min | 49.24 | 2.0 min |
| West limb pin (-35, -88) | 38.84 % | **40.06** | **461 min** | 38.90 | 22.7 min |

The number of risings and settings is the same in every case. Feeding Horizons' Earth through
the app's own skyline reproduces the app's percentage to 0.02 points at every site: the whole
difference is the skyline. At the rim pin the earlier build saw Earth rise six hours early and
set six hours late, five times in sixty days. The west-limb pin has only the 1.9 km
whole-Moon grid; the same stepping over maxima costs 1.2 points there.

Tolerance: Earth's elevation changes by at most 0.08 deg per hour at these sites, so 0.01 deg of
skyline or ephemeris is 8 to 12 minutes. Fifteen minutes and 0.1 points is agreement; the
current build's early Earthrises at the rim and west-limb pins (12 to 23 min) are its remaining
0.02-0.05 deg.

Reading the skyline every 0.5 deg instead of every 0.1 deg changes none of these percentages by
more than 0.01 points.

## Files and how to re-run

```
app_dump.mjs  app_skyat.mjs      call the app, write what it returns
fetch_horizons_series.mjs        Horizons rows listed in horizons/queries.json (network)
make_reference_skyline.py        reference/skyline.<site>.m<mast>.json
check0_bundle_vs_pds.py          terrain/results.*     (network: PDS range requests)
check0b_layer_seams.py           terrain/seams.*
check1_skyline.py                skyline/results.*
check2_events.py                 events/results.*      (SPICE optional; sources in events/sources.json)
check3_illumination.py           illumination/results.* (needs the PGDA rasters and SPICE)
check4_earth.py                  earth/results.*
sites.json                       the pins
```

Python scripts run as `python3 -I <script> [--write]` from anywhere; they need numpy. To test a
build: dump it, then run the checks.

```
V=tests/fixtures/validation/ephemeris-check
for c in skyline earth events; do node $V/app_dump.mjs --scenarios $V/$c/scenarios.json --out $V/$c/app-now.json; done
node $V/app_dump.mjs --bundle --scenarios $V/events/scenarios-bundled.json --out $V/events/app-now-bundled.json
node $V/app_dump.mjs --slim --scenarios $V/illumination/scenarios.json --out $V/illumination/app-now.json   # 12 runs of 18.6 years, 30 to 90 s each
node $V/app_skyat.mjs --in $V/events/alsj_rows.json --out $V/events/alsj-app-now.json
python3 -I $V/check1_skyline.py --write && python3 -I $V/check2_events.py --write && python3 -I $V/check4_earth.py --write
python3 -I $V/check3_illumination.py --neighbours --write
```

The checks read `app-before*.json` (375f816, kept as the record of the defect) and
`app-now*.json`; overwrite the latter to test a newer build. `--root DIR` on the two Node
scripts tests another checkout without merging it, and `--commit LABEL` names the build in the
output.

Not committed (git-ignored, under `scripts/.cache/ephemeris-check/`): numpy and spiceypy
(`python3 -m pip install --target scripts/.cache/ephemeris-check/pylib numpy spiceypy`), the five
SPICE kernels listed in the T-18 fixture, and the two PGDA rasters:

```
cd scripts/.cache/ephemeris-check && mkdir -p pgda && cd pgda
curl -O http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608.IMG        # 51 MB
curl -O http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608_EARTH.IMG  # 51 MB
```
