# Lunyx status

Kept by the coordinator. Last updated 2026-11-15 00:30 UTC, for the integration that
contains the seasonal outlook and the Diviner / ShadowCam layers (hub integration I-12, commit `e4889b0`).
"Shipped" means merged through the build gate and published on
`origin/feature/lunyx-navigator`. Task numbers refer to the project hub board.

The build is **not fully validated**: the independent end-to-end validation (T-26) is
still running. See section 4 before quoting any number from the app.

## 1. Shipped

| Area | What works | Task |
| --- | --- | --- |
| App shell | One state store, one action registry (33 actions) used by every control and by the assistant, mount regions per the mockups, design tokens, deep links (`?site=&view=&light=&t=&time=`), `/api/*` served in dev and preview | T-2, T-3, T-25 |
| Globe view | LUNYX wordmark, Filters panel (UTC date/time, centre-of-view latitude/longitude, solar elevation band, mast height, mission window, arrival delay, previous missions), pin at any coordinate, little-person surface entry, compass, locator map with view footprint, mission-window scrubber with sunrise/sunset/Earthrise/Earthset marks and jumps, site card with elevation, data provenance and Sun/Earth against the real skyline | T-12, T-25 |
| Surface view | The original ground view at the 28 catalogued landings (measured terrain, drag to look, walking) with the surface look reworked upstream on GitHub main (rocks, close-up crater maps, automatic resolution scaling) | T-27 |
| Elevation data | Whole-Moon LOLA grid at 16 px/deg (1.9 km) and 4 px/deg; south-polar layers at 40 m (inside 87.5S), 80 m (85S), 160 m (80S); 60 m and 480 m windows for the 28 sites, 3 m LROC NAC models for 19 of them; on-request 60 m / 480 m windows for custom pins through `/api/terrain` (needs network) | T-4 |
| Sun and Earth | Topocentric, airless azimuth/elevation, disc sizes, Earth phase, sub-Earth and sub-solar points from the in-app model; bundled JPL Horizons tables for Blue Ghost Mission 1 (2025-03-01 to 04-01) and IM-2 (2025-03-05 to 04-05), used automatically inside those windows; `/api/horizons` proxy | T-5 |
| Skyline and slope | Curvature-corrected terrain skyline from site coordinates, terrain height and mast height, with the terrain that forms it and the data used per distance range; slope with stated baseline | T-6, T-21 |
| Window analysis | Clearance above the skyline, sunlight percentage (disc fraction and any-Sun), longest darkness, Earth line-of-sight percentage and longest gap, rise/set events, blocking-ridge explanation, Earth passing in front of the Sun; spells followed past the window edge on request | T-7, T-29 |
| Comparison | Scenario slots A/B, +24 h (or any) arrival delay, differences B minus A in numbers and sentences; mast-height comparison in the science core | T-7, T-25 |
| Nearby alternatives | Scan around a site with adjustable radius, spacing and slope limit, ranked by sunlight and Earth contact (science core) | T-8 |
| Seasonal outlook | Metrics per lunar day across a year, best and worst arrival in the span, cost of a slip of 1 to 28 days (science core) | T-29 |
| DSN geometry | Geometric opportunities with Goldstone, Canberra and Madrid from the site (science core) | T-21 |
| Long-term averages | PGDA product 69 average sunlight and Earth visibility, both poles (data and lookup) | T-14 |
| Science layers | Ice-bearing shadowed regions (Lemelin et al. 2021) with surface distance; Diviner annual maximum and annual mean temperature poleward of 80 degrees; ShadowCam mosaic index as credited links (data and lookups) | T-19, T-23 |
| Assistant | Drawer, typed tool calling generated from the action registry, server-side model relay with secrets on the server, optional Jev (TypeSafe) router, clearly labelled deterministic mode, voice dictation into the message box | T-15 |

## 2. Built but not shipped yet

| What | State | Task |
| --- | --- | --- |
| Rebuilt surface scene: any site, Sun and Earth at true size with Earth's phase, Sun-directed shadows over all drawn terrain, dotted sky paths, absolute look and walk actions | On its branch; being reconciled with the upstream surface look before review | T-9 |
| Real 3D relief on the globe, south-polar close-ups shaded from the polar elevation layers, overlays (Sun band, long-term averages, data coverage) | On its branch; not yet reviewed | T-13 |
| Independent validation of skyline, events, long-term sunlight and Earth visibility | Skyline check done; three checks running | T-26 |

## 3. Not built

| What | Note | Task |
| --- | --- | --- |
| Surface key-metrics panel, countdowns, skyline chart | The numbers exist (site card, assistant); the surface HUD does not show them yet | T-10 |
| Compare panel, nearby-alternatives panel, mission-window table, CSV/JSON export, saved comparisons | The comparison and the scan run (assistant, actions); no on-screen panel, no export | T-11 |
| Controls and actions for nearby ranking, candidate selection, blocking-ridge explanation, mast-height comparison, export | Arrive with T-10/T-11; until then the assistant says the build has no such action | T-10, T-11 |
| Site-card readouts for DSN opportunities, long-term averages, ice targets, Diviner, ShadowCam | Data and lookups shipped; no control and no action, so neither a user nor the assistant can reach them | T-20 |
| Seasonal-outlook chart | Science shipped; no UI | follow-up to T-29 |
| Eclipse replay preset (14 March 2025, Blue Ghost) | The eclipse is in the computed series; no preset or dedicated view | T-22 |
| Full assistant audit: capability inventory, UI/assistant equivalence tests, the multi-step browser scenario | Waits for T-10/T-11 | T-16 |
| End-to-end browser tests, screenshot review against the mockups, accessibility pass, README, sources and licences | In progress in parts | T-17 |
| Historical mission trajectories; landing error ellipse | Not started. The error ellipse is struck out in the design and is lowest priority | T-24 |
| Separate summer and winter Diviner temperature maps | Out of scope: the source is 192.7 GB of binned tables. Annual maximum and mean are shipped instead and labelled as annual | T-23 |
| North-polar high-resolution elevation layer | Not bundled; the north pole rests on the 1.9 km grid plus on-request windows | T-4 |

## 4. Validation: what has been checked, and what has not

| Claim | Checked against | Result |
| --- | --- | --- |
| Sun/Earth azimuth and elevation | 1008 JPL Horizons rows (airless, topocentric), 15 sets, 1969 to 2035, fetched independently of the model's author | Worst difference 0.0036 deg. After 2035 the error grows (0.006 deg in 2060, 0.021 deg in 2099) because predictions of Earth's rotation differ |
| Skyline geometry | Analytic cases (smooth sphere, ridge, bowl), Apollo 15 against published heights of Mons Hadley and Hadley Delta | Within the tolerances in `docs/lunyx/validation.md` section 3 |
| Skyline on real terrain | An independent ray march straight from the bundled elevation files, five sites (T-26, check 1) | Builds up to and including `375f816` read the skyline too low at crest sites (up to 1.04 deg at a Shackleton-rim pin), so polar sunlight read too high there. From `319fba0` the validator reports agreement within 0.05 deg at all five sites. Its written results are not yet committed |
| 14 March 2025 eclipse at the Blue Ghost site | Reported times (05:00, 06:18, 09:52 UTC) | Computed 05:00:38, 06:17:21, 09:51:06 |
| DSN station geometry | JPL Horizons with each station as observer, 1154 rows | Elevation within 0.0012 deg; limit crossings within 0.3 s |
| Rise/set times against mission records, long-term sunlight against PGDA 69, Earth visibility at limb and polar sites | T-26, checks 2 to 4 | **Not finished** |
| Assistant with a real language model; Jev router with the real service | | **Never run**: no API keys on the build machine. Verified only with a scripted stand-in model and in deterministic mode |

## 5. Limits that affect how results should be read

- Earth visibility is geometric line of sight to Earth's centre (and, for DSN, to a station
  above its elevation limit). It is not a link budget.
- Sunlight percentage is the time-average of the visible fraction of the Sun's disc. It is
  not electrical power.
- Beyond a site's 30.7 km window, non-polar sites have only the 1.9 km grid, which smooths
  narrow distant ridges. Slopes rest on 60 m grids except within 0.77 km of 19 catalogued
  sites; metre-scale hazards are invisible to the nearby scan.
- The seasonal outlook and anything outside the two bundled Horizons windows use the in-app
  model, not Horizons tables.
- Custom pins away from the south pole need the elevation server (network access to NASA's
  PDS); offline they fall back to the bundled grids and the result says so.
- The long-term average maps are 18.6-year averages of "any part of the Sun visible"; they
  are a different quantity from the dated window numbers and are never mixed with them.
- Generated surface detail (rocks, sub-metre texture, small craters where no survey exists)
  is not measured and is labelled as generated in the surface view.
