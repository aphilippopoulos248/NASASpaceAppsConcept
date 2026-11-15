# Lunyx status

Kept by the coordinator of the original hub project `lunyx`. Last updated 2026-11-15
04:15 UTC, for the published commit `6d4da06`: lunyx-science's transition spans and DSN edges,
the mission presets, the landing catalogue sources and the 50-star flag, on top of the complete
compare panel, the teammate's GitHub `main` work, the sources and AI-use documents and the
licence notices; with corrections proposed by the `lunyx-experience` project. Acceptance is the
desktop website (decision D-9).
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
| Mission-window table and seasonal outlook | Compare panel: the sunlit, dark, Earth-visible and Earth-gap intervals with UTC start, end and duration (spells cut by the window edge followed to their real end, and said so), CSV and JSON export; a chart of sunlight and Earth's centre in view per lunar day across a year, with the best and worst arrival and the cost of a slip | T-11 (slices 3 and 4), T-29 |
| Country flags, hardware ownership, explored areas (teammate's GitHub `main` work) | Flags on the landing markers, markers coloured by country, "Belongs to" and "Owner" on the site card from the GCAT catalogue (with its source), each site's explored area on the globe (drawn enlarged so it reads at globe scale, and said so) | T-36 |
| Mission presets | "Missions to replay" at the top of Filters, `loadPreset` / `listPresets` and `?preset=` links: Blue Ghost Mission 1 and IM-2 from touchdown for 14 days, and the 14 March 2025 eclipse at the Blue Ghost site in the surface view; all three on the JPL Horizons tables bundled with the app and playable with the network off | T-22 |
| Landing catalogue sources | Every row of `public/data/landings.json` has a source for its position and its touchdown time: 26 positions from the LROC catalogue of anthropogenic objects (Wagner et al. 2017), Luna 9 and 13 from NSSDCA and marked approximate; three touchdown minutes kept but flagged `unsourced` | T-38 |
| Licence notices | `/licences/THIRD-PARTY-NOTICES.txt` ships with the site, generated from the installed packages (three.js, astronomy-engine, the two OFL fonts, Vite and Rolldown); a test fails when it is stale | T-37 |
| Nearby alternatives | "Nearby sites" tab: radius, spacing and slope-limit fields, progress, the ranked list (distance, bearing, slope, sunlight, longest darkness, Earth's centre in view, longest gap, score); any row can be pinned or loaded as B | T-8, T-11 (slice 2) |
| Seasonal outlook | The validator's own skyline and SPICE, a year at IM-2 and a Shackleton-rim pin (T-34; re-run in T-3 on a build with `3899cb9`) | Within 0.11 points per lunar day at both sites; the rim-pin row that read 0.57 points high before `3899cb9` now reads 20.76 % against 20.84 %. The in-app model over a year: Sun within 0.0038 deg, Earth within 0.0030 deg of SPICE Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Transition spans in the science core | For every sunrise, sunset, Earthrise and Earthset over the real skyline, the instant the disc first touches the skyline and the instant it clears it (D-8); Earth's visibility both by its centre and by any part of its disc | T-31 (lunyx-science) |
| DSN geometry | Geometric opportunities with Goldstone, Canberra and Madrid from the site (science core) | T-21 |
| Long-term averages | PGDA product 69 average sunlight and Earth visibility, both poles (data and lookup) | T-14 |
| Science layers | Ice-bearing shadowed regions (Lemelin et al. 2021) with surface distance; Diviner annual maximum and annual mean temperature poleward of 80 degrees; ShadowCam mosaic index as credited links (data and lookups) | T-19, T-23 |
| Assistant | Drawer, typed tool calling generated from the action registry, server-side model relay with secrets on the server, optional Jev (TypeSafe) router, clearly labelled deterministic mode, voice dictation into the message box | T-15 |

## 2. Built but not shipped yet

| What | State | Task |
| --- | --- | --- |

## 3. Not built

| What | Note | Task |
| --- | --- | --- |
| Both ends of each sunrise and sunset on screen (decision D-8) | The science core gives both ends since `7cf48f5` (lunyx-science, T-31): `SiteAnalysis.transitions`, `SkyEvent.span`, Earth by any part of its disc. The screens still show one instant per event, labelled with which one it is ("Sun fully set") | T-47, T-48, T-49 |
| Full assistant audit: capability inventory, UI/assistant equivalence tests, the multi-step browser scenario | With project `lunyx-experience`; every action it needs is on integration since `a958d6b` | T-16 |
| End-to-end browser tests, screenshot review against the mockups, accessibility pass, final README | With project `lunyx-experience`. `docs/lunyx/SOURCES.md` and `docs/lunyx/AI-USE.md` are published (`0cc5553`); AI-USE.md section 8 waits for operator decisions and its section 2.1 is a draft | T-17 |
| Historical mission trajectories; landing error ellipse | Not started. The error ellipse is struck out in the design and is lowest priority | T-24 |
| Separate summer and winter Diviner temperature maps | Out of scope: the source is 192.7 GB of binned tables. Annual maximum and mean are shipped instead and labelled as annual | T-23 |
| North-polar high-resolution elevation layer | Not bundled; the north pole rests on the 1.9 km grid plus on-request windows | T-4 |

## 4. Validation: what has been checked, and what has not

| Claim | Checked against | Result |
| --- | --- | --- |
| Sun/Earth azimuth and elevation | 1008 JPL Horizons rows (airless, topocentric), 15 sets, 1969 to 2035, fetched independently of the model's author | Worst difference 0.0036 deg. After 2035 the error grows (0.006 deg in 2060, 0.021 deg in 2099) because predictions of Earth's rotation differ |
| Skyline geometry | Analytic cases (smooth sphere, ridge, bowl), Apollo 15 against published heights of Mons Hadley and Hadley Delta | Within the tolerances in `docs/lunyx/validation.md` section 3 |
| Skyline on real terrain, observer 2 m up | An independent ray march straight from the bundled elevation files, five sites (T-26; `tests/fixtures/validation/ephemeris-check/`) | Builds up to and including `375f816` (GitHub `main`'s tip until `595fe28`; `main` has contained the fix since then) read the skyline too low at crest sites, up to 1.04 deg at a Shackleton-rim pin, with Earth visibility 2.0 points high and rise/set times up to 6 h off there. From `319fba0`: within 0.05 deg at all five sites |
| Skyline with the observer on the ground (0 m) | Same reference, re-checked independently at 0, 0.5 and 2 m at 9 pins, two of them chosen by a fixed rule before any app output (T-3, on `1289083`, the code `3899cb9` integrates) | Builds before `3899cb9` read up to 1.2 deg low on convex ground (+4.7 points of 18.6-year sunlight at a connecting-ridge pin). Since `3899cb9`: worst 0.017 deg over 27 runs, no azimuth over 0.02 deg; where the skyline is the ground at the observer's feet, app and reference agree on how many azimuths that is at all six such sites Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Bundled elevation grids | The PDS originals, 30 080 samples; LRO LOLA laser shots at 17 of the 19 sites with a 3 m model (T-32 verification); the app's own heights at those 19 sites (T-3) | Equal within rounding. Where a 3 m site model meets its 60 m window, 768 m from the site, heights step by several metres; the 3 m model is closer to LOLA at 16 of 17 sites and stays as stored (lunyx-science D-10; the app's heights equal the stored files to < 0.1 mm). At Blue Ghost the two products, each used throughout, put the 16 March 2025 sunset 3.5 to 7.5 min apart at a 2 m mast, depending on where within 8 m the lander stood: at the catalogue's current (LROC) position the 3 m model gives first cut 18:24:16 / last limb 19:30:50 UTC and the 60 m window 18:30:27 / 19:38:22 (6.2-7.5 min apart); at the position used before T-38, 18:23:40 / 19:30:03 against 18:27:22 / 19:33:31 (3.5-3.7 min). Easing the step away (T-32, kept as an opt-in) would move it 13 min, outside both products. The site windows themselves were not compared with their PDS sources Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Sunset, sunrise and eclipse times | The validator's own skyline and Horizons/SPICE directions | Within 0.5 min at Blue Ghost, Chandrayaan-3 and Apollo 15, where the Sun crosses the skyline quickly. Near the poles the same skyline agreement means minutes, because the Sun and Earth cross it slowly Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Both ends of every rise and set | The validator's own skyline and Horizons, 141 instants in 48 passages of the Sun and Earth at nine sites (T-3, on `9bc4878`) | Blue Ghost within 4 s (2 m, at the position used before T-38: starts setting 18:23:41, fully set 19:30:04 UTC; validator 18:23:40, 19:30:03). The code and terrain are unchanged since, so the agreement holds; at the catalogue's current position, 8.4 m away, the app reads 18:24:16 / 19:30:50 UTC, both inside Firefly's reported start of night (about 18:15 to 18:35 UTC). Worst 0.019 deg expressed as skyline; near the poles an instant can be several minutes off (up to 14 min for an Earthrise's first limb) where a skyline notch narrower than the app's 0.5 deg azimuth step lies under the disc. With the validator's skyline read every 0.5 deg the worst is 0.004 deg Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Long-term sunlight | 18.6-year runs at six polar points against the validator's own computation and PGDA product 69 | Within 0.03 points of the validator at a 2 m mast; on the ground (0 m) within 0.05 points since `3899cb9` (connecting-ridge pin: 44.21 % against 44.21 %; it read 48.93 % before). IM-2 three ways at 2 m: PGDA 46.55 %, validator 46.71 %, app 46.68 % Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Earth visibility at limb and polar sites | The validator's skyline with Horizons Earth directions; PGDA product 69 | Earth's centre within 0.05 points. Any part of Earth's disc (new figure) within 0.04 points over 60 days at five sites and within 0.03 points over 18.6 years; against PGDA, which counts any part of the disc, within 0.1 to 1.1 points at the four smooth polar points at 2 m, where the centre figure reads 4.4 to 11.1 points lower Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Published mission facts | Firefly (Blue Ghost), ISRO (Chandrayaan-3), the Apollo Lunar Surface Journal table | Blue Ghost eclipse times within 0.8 min; Chandrayaan-3 sunset date agrees; 42 of 43 Apollo rows agree. Firefly's start of night (about 18:15 to 18:35 UTC, 16 March 2025) matches the first cut of the Sun (18:23), not the last limb (19:30) the app calls sunset: see D-8. ISRO's "next sunrise 22 September 2023" is two days after first light by both computations, so the app's time is not confirmed by ISRO. No published time was found for IM-2 |
| 14 March 2025 eclipse at the Blue Ghost site | Reported times (05:00, 06:18, 09:52 UTC) | Computed 05:00:38, 06:17:21, 09:51:06 |
| DSN station geometry | JPL Horizons with each station as observer; second party on dates the author did not use | Elevation within 0.001 deg. Edges set by a station's elevation limit: placed by bisection to 0.25 s, and within 0.9 s of the independent reference (84 edges; before T-9: 5.3 s, not the 0.3 s once quoted). Edges set by the lunar skyline within 1.5 min Evidence: lunyx-science's validation round, `tests/fixtures/validation/science-validation/README.md` and the results files it names. |
| Seasonal outlook | The validator's own skyline and SPICE, a year at IM-2 and a Shackleton-rim pin (T-34) | Within 0.11 points per lunar day, except one row at the rim pin (0.57 points), traced to the skyline before `3899cb9`; re-run pending. The in-app model over a year: Sun within 0.0038 deg, Earth within 0.0030 deg of SPICE |
| Longest darkness and Earth gap followed past the window edge | Same, at IM-2, Chandrayaan-3 and Apollo 11 | Ends within 3.1 min |
| Landing positions and touchdown times (`public/data/landings.json`) | Positions against the LROC catalogue bundled in `public/data/sources/lroc-anthropogenic-objects.csv` (checked by `lunyx-experience` @submission); times against NSSDCA, Siddiqi (NASA SP-2018-4041) and agency releases (T-38) | The 26 LROC positions equal the catalogue to 0.00005 deg. Luna 9 and 13: not found in LRO images, NSSDCA positions, approximate. Three touchdown minutes are not confirmed by an official source (Luna 23, Chandrayaan-3, IM-2). The validation figures in this section were computed at the positions before T-38 (IM-2 moved 22 m, Blue Ghost 8 m, Chang'e 4 417 m) |
| Slope | Recomputed at the 28 sites and 10 scan candidates | Identical to 0.0000 deg. But the 120 m measure on a 60 m grid cannot see lander-scale slope: Surveyor 3 is published at 14 deg (app: 12.5 deg at 10 m on the 3 m model, 3.7 deg at 120 m); Apollo 14 at 7 deg (7.2 deg against 1.3 deg) |
| Surface view picture | `lunyx-experience`'s desktop walkthrough on the GPU (GTX 1050 Ti, renderer read from WebGL), next to the software-rendered pictures (`docs/lunyx/screenshots/REVIEW.md` at `6a24334` on `am/lunyx-experience/agent/desktop-workflow`) | Full settings seen at IM-2 (2025-03-06 17:28 UTC, 61 fps) and Apollo 11 (1969-07-20 20:17 UTC, 60 fps) at 1920x1080; the Sun and Earth sit at the same place as in the software-rendered pictures |
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
- Near the poles an event instant (when the Sun or Earth starts to set, or is fully set) can be several
  minutes off, up to 14 min for one Earthrise's first limb, where a notch in the skyline narrower than
  the analysis's 0.5 deg azimuth step lies under the disc. Away from the poles the Sun crosses the
  skyline quickly and instants agree within seconds (being refined in T-50).
- The surface view eases each 3 m site model into its 60 m window at their seam, 768 m from the site,
  while the analysis uses the grids as stored. Where that seam forms the skyline, the drawn skyline can
  sit up to 0.17 deg below the analysed one (Blue Ghost, azimuth 274.5 deg). Removing it was studied and
  not built (lunyx-science's option-B study); the numbers come from the analysis, not the picture.
- The stars behind the globe are random points, not a star catalogue (the surface view draws
  none). They are decoration and should not be read as the real sky (T-42).
- Generated surface detail (rocks, sub-metre texture, small craters where no survey exists)
  is not measured and is labelled as generated in the surface view.
