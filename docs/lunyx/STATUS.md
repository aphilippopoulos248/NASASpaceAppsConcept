# Lunyx status

Kept by the coordinator of the original hub project `lunyx`. Last updated 2026-11-15
03:10 UTC, for the published commit `bbaa93d` (surface key-metrics panel and skyline chart,
nearby alternatives in the compare panel) plus the independent re-check of the
ground-level skyline. Acceptance is the desktop website (decision D-9).
"Shipped" means merged through the build gate and published on
`origin/feature/lunyx-navigator`. Task numbers refer to the project hub board.

The build is **not fully validated**. Two rounds of independent end-to-end validation have
reported (T-26 complete; T-34 items 1 to 5); their findings are in section 4. Open with the
`lunyx-science` project: the two-ended sunrise/sunset events (T-31 items 2 and 3) and the
rest of the second round. Read section 4 before quoting any number from the app.

## 1. Shipped

| Area | What works | Task |
| --- | --- | --- |
| App shell | One state store, one action registry (53 actions) used by every control and by the assistant, mount regions per the mockups, design tokens, deep links (`?site=&view=&light=&t=&time=`), `/api/*` served in dev and preview | T-2, T-3, T-25 |
| Globe view | LUNYX wordmark, Filters panel (UTC date/time, centre-of-view latitude/longitude, solar elevation band, mast height, mission window, arrival delay, previous missions), pin at any coordinate, little-person surface entry, compass, locator map with view footprint, mission-window scrubber with sunrise/sunset/Earthrise/Earthset marks and jumps, site card with elevation, data provenance and Sun/Earth against the real skyline | T-12, T-25 |
| Globe relief and overlays | Real 3D relief from the LOLA whole-Moon grid with the exaggeration factor shown on screen and adjustable (off to x30, true scale below 100 km); south-polar close-ups drawn as shaded relief from the polar elevation layers with the shadows of the simulated time, labelled as not a photograph; overlays with legends: Sun-elevation band (smooth Moon), long-term average sunlight and Earth visibility (PGDA 69), elevation-data coverage; ice-target outlines | T-13, T-20 |
| Surface key metrics and chart | Sun and Earth azimuth, elevation and clearance now, countdowns to the next transitions that say which instant they mean (D-8), the window's figures, unmet requirements in words, a compact provenance line; an expandable skyline chart with the Sun's and Earth's tracks (filled when above the skyline, hollow when hidden), a time mode and a table; the blocking-ridge explanation for any hidden mark | T-10 |
| Surface view | Ground view for any site (catalogued landing or pin) drawn to 246 km from the elevation data, with the product behind each distance band stated; black sky; Sun and Earth at computed size and position (topocentric), Earth with its phase; terrain shadows with penumbra over all drawn terrain; dotted Sun and Earth tracks, hollow where behind terrain; drag, touch, keys, walking; the surface look reworked upstream on GitHub main (rocks, close-up crater maps, generated craters, earthshine, automatic resolution scaling) carried into the rebuilt scene | T-9, T-27 |
| Site science | A section of the site card and the query actions getSiteScience and nearestIceTargets: DSN station opportunities, long-term averages, nearest ice targets, Diviner annual maximum and mean temperature, ShadowCam mosaics as credited links | T-20, T-30 |
| Catalogue and state for the assistant | listSites; site objects with summary and QuickMap / Moon Trek links; Moon phase, locator zoom and panel state in getState; event labels that say which instant they mean ("Sun fully set") | T-33 |
| Elevation data | Whole-Moon LOLA grid at 16 px/deg (1.9 km) and 4 px/deg; south-polar layers at 40 m (inside 87.5S), 80 m (85S), 160 m (80S); 60 m and 480 m windows for the 28 sites, 3 m LROC NAC models for 19 of them; on-request 60 m / 480 m windows for custom pins through `/api/terrain` (needs network) | T-4 |
| Sun and Earth | Topocentric, airless azimuth/elevation, disc sizes, Earth phase, sub-Earth and sub-solar points from the in-app model; bundled JPL Horizons tables for Blue Ghost Mission 1 (2025-03-01 to 04-01) and IM-2 (2025-03-05 to 04-05), used automatically inside those windows; `/api/horizons` proxy | T-5 |
| Skyline and slope | Curvature-corrected terrain skyline from site coordinates, terrain height and mast height, with the terrain that forms it and the data used per distance range; slope with stated baseline | T-6, T-21 |
| Window analysis | Clearance above the skyline, sunlight percentage (disc fraction and any-Sun), longest darkness, Earth line-of-sight percentage and longest gap, rise/set events, blocking-ridge explanation, Earth passing in front of the Sun; spells followed past the window edge on request | T-7, T-29 |
| Comparison | Compare panel: scenarios A and B side by side with B minus A in numbers and sentences, requirements flagged in words, one control for "B = A arriving N hours later" and one for "B = A with another mast", shared clock, named comparisons that reload exactly | T-7, T-25, T-11 (slice 1) |
| Nearby alternatives | "Nearby sites" tab: radius, spacing and slope-limit fields, progress, the ranked list (distance, bearing, slope, sunlight, longest darkness, Earth's centre in view, longest gap, score); any row can be pinned or loaded as B | T-8, T-11 (slice 2) |
| Seasonal outlook | Metrics per lunar day across a year, best and worst arrival in the span, cost of a slip of 1 to 28 days (science core) | T-29 |
| DSN geometry | Geometric opportunities with Goldstone, Canberra and Madrid from the site (science core) | T-21 |
| Long-term averages | PGDA product 69 average sunlight and Earth visibility, both poles (data and lookup) | T-14 |
| Science layers | Ice-bearing shadowed regions (Lemelin et al. 2021) with surface distance; Diviner annual maximum and annual mean temperature poleward of 80 degrees; ShadowCam mosaic index as credited links (data and lookups) | T-19, T-23 |
| Assistant | Drawer, typed tool calling generated from the action registry, server-side model relay with secrets on the server, optional Jev (TypeSafe) router, clearly labelled deterministic mode, voice dictation into the message box | T-15 |

## 2. Built but not shipped yet

| What | State | Task |
| --- | --- | --- |
| Mission-window table with CSV/JSON export, seasonal-outlook chart (compare panel slices 3 and 4) | Built on its branch; in review | T-11 |
| Teammate's work on GitHub `main`: country flags, hardware ownership from the GCAT catalogue, explored areas, markers coloured by country | Being merged by @upstream-sync. `main` itself does not build at 282249d (a missing method); fixed forward in the merge | T-36 |
| Two-ended sunrise/sunset events, Earth visibility by any part of the disc | Being built in `lunyx-science` | T-31 |

## 3. Not built

| What | Note | Task |
| --- | --- | --- |
| Surface key-metrics panel, countdowns, skyline chart | The numbers exist (site card, assistant); the surface HUD does not show them yet | T-10 |
| Labelled start and end of each sunset/sunrise (decision D-8) | The app's "sunset" is the last limb; the first cut of the disc, about an hour earlier at Blue Ghost and much longer at the poles, is not shown yet | T-31, T-33 |
| Eclipse replay preset (14 March 2025, Blue Ghost) | The eclipse is in the computed series; no preset or dedicated view | T-22 |
| Full assistant audit: capability inventory, UI/assistant equivalence tests, the multi-step browser scenario | With project `lunyx-experience`; waits for T-10/T-11 | T-16 |
| End-to-end browser tests, screenshot review against the mockups, accessibility pass, README, sources and licences, AI-use disclosure | With project `lunyx-experience` | T-17 |
| Historical mission trajectories; landing error ellipse | Not started. The error ellipse is struck out in the design and is lowest priority | T-24 |
| Separate summer and winter Diviner temperature maps | Out of scope: the source is 192.7 GB of binned tables. Annual maximum and mean are shipped instead and labelled as annual | T-23 |
| North-polar high-resolution elevation layer | Not bundled; the north pole rests on the 1.9 km grid plus on-request windows | T-4 |

## 4. Validation: what has been checked, and what has not

| Claim | Checked against | Result |
| --- | --- | --- |
| Sun/Earth azimuth and elevation | 1008 JPL Horizons rows (airless, topocentric), 15 sets, 1969 to 2035, fetched independently of the model's author | Worst difference 0.0036 deg. After 2035 the error grows (0.006 deg in 2060, 0.021 deg in 2099) because predictions of Earth's rotation differ |
| Skyline geometry | Analytic cases (smooth sphere, ridge, bowl), Apollo 15 against published heights of Mons Hadley and Hadley Delta | Within the tolerances in `docs/lunyx/validation.md` section 3 |
| Skyline on real terrain, observer 2 m up | An independent ray march straight from the bundled elevation files, five sites (T-26; `tests/fixtures/validation/ephemeris-check/`) | Builds up to and including `375f816` (the commit on GitHub `main`) read the skyline too low at crest sites, up to 1.04 deg at a Shackleton-rim pin, with Earth visibility 2.0 points high and rise/set times up to 6 h off there. From `319fba0`: within 0.05 deg at all five sites |
| Skyline with the observer on or near the ground | An independent re-check (lunyx-science, T-34 item 5): 0, 0.5 and 2 m at 9 pins, two of them chosen by a fixed rule before any app output was seen | Builds before `3899cb9` read up to 1.2 deg low on convex ground (+4.7 points of 18.6-year sunlight at a connecting-ridge pin). Since `3899cb9`: worst difference 0.017 deg over 27 runs, within 0.004 deg at the 7 earlier pins |
| Bundled elevation grids | The PDS originals, 30 080 samples; LRO LOLA laser shots at 17 of the 19 surveyed sites (lunyx-science, T-32) | Equal within rounding. The 3 m site models and the 60 m windows step by several metres where they join, 768 m from a landing site. The 3 m model is the closer one to LOLA at 16 of 17 sites, so it stays the default and the step stays (decision in lunyx-science). At Blue Ghost the two products put the 16 March 2025 sunset 3.5 to 3.7 min apart (first cut 18:23:40 / 18:27:22, last limb 19:30:03 / 19:33:31 UTC at 2 m) |
| Sunset, sunrise and eclipse times | The validator's own skyline and Horizons/SPICE directions | Within 0.5 min |
| Long-term sunlight | 18.6-year runs at six polar points against the validator's own computation and PGDA product 69 | Within 0.03 points of the validator. IM-2 three ways: PGDA 46.55 %, validator 46.71 %, app 46.68 % |
| Earth visibility at limb and polar sites | The validator's skyline with Horizons Earth elevation | Within 0.05 points. PGDA's Earth map counts any part of the disc and reads 4 to 11 points higher by definition |
| Published mission facts | Firefly (Blue Ghost), ISRO (Chandrayaan-3), the Apollo Lunar Surface Journal table | Blue Ghost eclipse times within 0.8 min; Chandrayaan-3 sunset date agrees; 42 of 43 Apollo rows agree. Firefly's start of night (about 18:15 to 18:35 UTC, 16 March 2025) matches the first cut of the Sun (18:23), not the last limb (19:30) the app calls sunset: see D-8. ISRO's "next sunrise 22 September 2023" is two days after first light by both computations, so the app's time is not confirmed by ISRO. No published time was found for IM-2 |
| 14 March 2025 eclipse at the Blue Ghost site | Reported times (05:00, 06:18, 09:52 UTC) | Computed 05:00:38, 06:17:21, 09:51:06 |
| DSN station geometry | JPL Horizons with each station as observer, 1154 rows | Elevation within 0.0012 deg; limit crossings within 0.3 s |
| Seasonal outlook | The validator's own skyline and SPICE, a year at IM-2 and a Shackleton-rim pin (T-34) | Within 0.11 points per lunar day, except one row at the rim pin (0.57 points), traced to the skyline before `3899cb9`; re-run pending. The in-app model over a year: Sun within 0.0038 deg, Earth within 0.0030 deg of SPICE |
| Longest darkness and Earth gap followed past the window edge | Same, at IM-2, Chandrayaan-3 and Apollo 11 | Ends within 3.1 min |
| DSN station geometry, second party | Horizons on dates the author did not use | Elevations within 0.001 deg. Limit crossings within 5.3 s, not the 0.3 s quoted by the author; terrain-set edges within 1.5 min |
| Slope | Recomputed at the 28 sites and 10 scan candidates | Identical to 0.0000 deg. But the 120 m measure on a 60 m grid cannot see lander-scale slope: Surveyor 3 is published at 14 deg (app: 12.5 deg at 10 m on the 3 m model, 3.7 deg at 120 m); Apollo 14 at 7 deg (7.2 deg against 1.3 deg) |
| Surface view picture | | Checked by eye in software-rendered headless Chromium only. Full visual settings at a polar site have not been seen on a real GPU |
| Assistant with a real language model; Jev router with the real service | | **Never run**: no API keys on the build machine. Verified only with a scripted stand-in model and in deterministic mode |

## 5. Limits that affect how results should be read

- Earth visibility is geometric line of sight to Earth's centre (and, for DSN, to a station
  above its elevation limit). It is not a link budget.
- Sunlight percentage is the time-average of the visible fraction of the Sun's disc. It is
  not electrical power.
- Beyond a site's 30.7 km window, non-polar sites have only the 1.9 km grid, which smooths
  narrow distant ridges. Slopes rest on 60 m grids except within 0.77 km of 19 catalogued
  sites; metre-scale hazards are invisible to the nearby scan, and a slope measured over
  120 m can be several times smaller than the tilt a lander meets (section 4).
- The seasonal outlook and anything outside the two bundled Horizons windows use the in-app
  model, not Horizons tables.
- Custom pins away from the south pole need the elevation server (network access to NASA's
  PDS); offline they fall back to the bundled grids and the result says so.
- The long-term average maps are 18.6-year averages of "any part of the Sun visible"; they
  are a different quantity from the dated window numbers and are never mixed with them.
- Generated surface detail (rocks, sub-metre texture, small craters where no survey exists)
  is not measured and is labelled as generated in the surface view.
