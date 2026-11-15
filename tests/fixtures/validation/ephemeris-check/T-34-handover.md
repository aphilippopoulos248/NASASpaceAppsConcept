# T-34 hand-off: independent validation, round 2

From @ephemeris-check (project `lunyx`) to @validation (project `lunyx-science`, task T-3), at the
operator's request (lunyx m321). Same rules as T-26: reference values computed here, the app
only called, sources quoted, no forced agreement. Everything below was run against
integration **cc736f8**; the results files name the build they tested.

Re-run any check with `python3 -I <script> [--write]` from the repository root. The Python
scripts need numpy, spiceypy, the five SPICE kernels and, for check 3, the two PGDA rasters, all
under the git-ignored `scripts/.cache/ephemeris-check/` (commands in `README.md`). The app
dumps come from `app_dump.mjs` / `app_skyat.mjs` (`--root DIR` tests another checkout,
`--commit LABEL` names it).

## Status of the six items

| Item | Status | Results | Pending |
| --- | --- | --- | --- |
| 1. Seasonal outlook | done | `outlook/results.txt` | row 9 at the rim pin after the skyline fix (below) |
| 2. Longest darkness / Earth gap, in full | done | `spans/results.txt` | none |
| 3. DSN geometry | done | `dsn/results.txt` | the app's "within 0.3 s" sentence (below) |
| 4. Slope | done | `slope/results.txt` | none |
| 5. T-31 re-checks | **not started here**; you took it (m333) | | everything |
| 6. T-32 seam re-check | **not started here**; you took it (m333) | | everything |
| T-17 wording review for @assistant | not started | | everything |

## 1. Seasonal outlook (`check5_outlook.py`)

IM-2 and the Shackleton rim pin (-89.78, -155.73), 2 m mast, 12 lunar days from 2027-01-01,
the app's 20 min step. Reference: SPICE directions (equal to Horizons to 0.000002 deg) against
my 0.1 deg skyline, spells in full from the continuous functions, searched 60 days beyond.

- Rows, app minus own, worst: IM-2 sunlight 0.10, any Sun 0.11, Earth 0.06 points; darkness in
  full 0.14 h, Earth gap 0.34 h. Rim pin: 0.11 / **0.57 (row 9, 2027-08-25)** / 0.10 points;
  0.22 h / 0.49 h. Every other rim-pin row is within 0.11 points.
- Arrivals (4 253 start times 2 h apart, 14-day mission): score within 0.15 (IM-2) and 0.20
  (rim) points. Best and worst arrival at the same instant as mine, except the IM-2 worst:
  app 2027-12-20 06:00 (31.79) against mine 2027-12-19 14:00 (31.80), a flat minimum (mine at
  the app's instant: 31.80).
- Longest darkness of the year: IM-2 411.7 h both (ends +0.5 / +1.8 min); rim pin 4213.3 h
  against 4213.5 h, 2027-02-01 to 2027-07-26 (+3.5 / -8.1 min). Longest Earth gap: 137.8 h both;
  469.2 against 469.6 h (+11.8 / -13.6 min).
- **What the in-app model costs over a year** (26 524 instants): Sun within 0.0038 deg and
  Earth within 0.0030 deg of SPICE. On the same skyline that moves a lunar day's sunlight by at
  most 0.033 points, any Sun 0.094, Earth 0.047, and an arrival score by 0.063. 5 of 26 524
  samples change their any-Sun state at the rim pin (0 at IM-2).
- **Row 9, explained, not yet re-run:** with the app's own skyline (cc736f8) and my SPICE Sun,
  row 9 gives 21.40 % (app 21.41 %); with my skyline, read every 0.1 or every 0.5 deg, 20.84 /
  20.79 %. So the 0.57 is the app's skyline at this pin, which at cc736f8 is still up to 0.05 deg
  low (72 azimuths over 0.02, T-26). @analysis reports it fixed at 1289083 (-0.004 deg).
  **Pending:** dump `outlook/scenarios.json` from 1289083 and re-run; row 9 should fall to
  about 20.8 %.
- Tolerance: 0.5 points per lunar day, as in T-26 check 3 (0.01 deg of skyline moves a polar
  any-Sun share by a few tenths of a point). Times of spells: 15 minutes at the pole, where the
  Sun moves 0.01 deg in 10 to 20 minutes.

## 2. Longest darkness and Earth gap in full (`check6_full_spans.py`)

14-day windows, 2 m. Reference spells searched 60 days beyond each edge, edges to 1 s.

| Window | Inside the window, app / own | In full, app / own | Edges, app minus own |
| --- | --- | --- | --- |
| IM-2 from landing (2025-03-06 17:28), darkness | 18.19 / 18.18 h | 379.78 / 379.79 h, 2025-03-19 23:17 to 04-04 19:04 | -0.4 / -1.0 min |
| IM-2, Earth gap | 37.37 / 37.34 h | 148.22 / 148.14 h, 2025-03-19 04:08 to 03-25 08:16 | -2.0 / +3.1 min |
| Chandrayaan-3 from landing, darkness | 52.51 / 52.51 h | 375.91 / 375.91 h, 2023-09-04 08:02 to 09-19 23:57 | -0.2 / -0.5 min |
| Chandrayaan-3 from 2023-09-10 (starts in the night) | 239.94 / 239.95 h | 375.91 / 375.91 h | -0.3 / -0.5 min |
| Apollo 11 from landing (equatorial), darkness | 4.61 / 4.61 h | 353.27 / 353.27 h, 1969-08-03 15:40 to 08-18 08:56 | +0.1 / +0.2 min |

Earth never sets at Chandrayaan-3 or Apollo 11; the app reports no Earth gap there either. All
ends were found by both (no search limit reached).

## 3. DSN geometry (`check7_dsn.py`, `fetch_horizons_pairs.mjs`)

Dates the author did not use: 2023-08-23 + 72 h (Chandrayaan-3 site), 2025-03-17 + 72 h around
an Earthset at IM-2, 2031-04-10 + 72 h (Apollo 11 site). Reference: Horizons both ways (the
site seen from Horizons' own DSN sites -14@399, -43@399, -63@399; the station seen from the
site), against my skyline. Raw replies in `dsn/raw/`.

- Station coordinates: equal to Horizons' DSN sites within 0.01 m (DSS-14, -43, -63).
- Site in the station's sky: elevation within 0.0010 deg, azimuth arc 0.0010 deg. Station in
  the site's sky: 0.0029 / 0.0020 deg. Range: up to 51 km, the app's stated "geometric; within
  about 50 km of the light-time range".
- Opportunity edges set by the station limits (6.0 deg receive; 10.4 / 10.2 deg transmit): 84
  edges within 5.3 s; share of the window within 0.04 points; same number of spans everywhere.
- Edges set by lunar terrain (IM-2, the station going behind the skyline): 4, within 1.5 min
  (the station's elevation there changes by about 0.001 deg per minute).
- **Pending, small:** `analysis.dsn.assumptions` says rise and set "within 0.3 s on the day
  compared". On these dates the edges scatter by up to ±5 s, both signs, and the scatter does
  not shrink with the series step (36 edges: 3.8 s at a 1 min step, 5.3 s at 10 min). The
  elevations agree to 0.001 deg, which is 0.3 s at the horizon, so the scatter is in how the
  edges are placed, not in the geometry. Ask @analysis (lunyx) whether the edge search stops
  at about 10 s. Five seconds does not matter for planning; the sentence overstates.

## 4. Slope (`check8_slope.py`)

The app's stated measure (least-squares plane through 3 x 3 points half a baseline apart, on
the finest layer with all nine), recomputed from the files: **identical to 0.0000 deg** in slope
and aspect at all 28 sites (19 at 10 m on a 3 m model, 9 at 120 m on a 60 m window) and at the
ten best-ranked candidates of the IM-2 scan (120 m on the 60 m window; positions within
0.03 m, heights within 0.01 m). 6 of 137 candidates rejected for slope at the 10 deg limit, all
consistent with their slope values.

Against published landing tilts (both quotes fetched 2026-11-14):

| Site | Published | App, 10 m on the 3 m model | Same measure, 120 m on the 60 m window |
| --- | --- | --- | --- |
| Surveyor 3 | "came to rest on a 14 degree slope inside a subdued 200 meter crater" (NSSDC 1967-035A) | 12.5 deg | 3.7 deg |
| Apollo 14 LM | "The LM settled on a seven-degree slope" (NASA, "50 Years Ago: Apollo 14 Lands at Fra Mauro") | 7.2 deg | 1.3 deg |

So the baseline decides the answer, and only the 10 m measure on a 3 m model is close to what a
lander stands on. The 9 sites without a 3 m model (and every scan candidate) get the 120 m
measure, which cannot see lander-scale slope: the app's basis sentence says so, and the
documentation should too.

## 5 and 6: what you need to know before re-running

- My reference skylines (`reference/`, `skyline/reference-*.json`) read the **stored** files.
  Once T-32 is integrated the app eases each 3 m model onto its 60 m window over the outer
  129 m (smooth step t*t*(3-2t); rule in `docs/lunyx/handover/T-32-edge-easing.md` on
  am/lunyx/agent/ice-targets e4b06ef). Then app and reference differ at the 10 sites in that
  note's table (up to 0.17 deg, Blue Ghost the largest) for that reason alone: add an eased
  mode to `lib/lunyx_dem.py` and report both, because the easing is a modelling choice and the
  one published time does not support it (Firefly's start of night, 18:15-18:35 UTC: stored
  stack 18:23 at 2 m by my computation, eased 18:38 by @ice-targets').
- `check0b_layer_seams.py` reads the stored files, so on its own it reprints the old table. It
  was not re-run against e4b06ef here.
- T-31 item 1 (0 m skyline) is on am/lunyx/agent/analysis 1289083, not integrated. @analysis
  reports, against my `skyline/reference-*.json`: within 0.002-0.003 deg at 0 m and 0.004 deg at
  2 m (m325). Not verified by me. They also asked for the 18.6-year any-Sun shares at 0 m
  (connecting ridge pin: 48.93 % in the app against 44.21 % mine at cc736f8): re-dump
  `illumination/scenarios.json` with `--slim` from 1289083 and run `check3_illumination.py`.
- T-31 items 2-3 (both ends of each transition, Earth by any part of the disc) have not landed.
  The check is `events/results.txt` section A (Blue Ghost, stored stack, 2 m: first cut 18:23,
  half 18:56, last limb 19:30:03 UTC) and check 3's "any Earth" column.

## Size

This hand-off adds 2.0 MB (largest file 0.33 MB): `dsn/` 1.3 MB with raw Horizons replies,
`outlook/` 0.33 MB, `slope/` 0.15 MB, `spans/` 0.13 MB. The app's model series for the outlook
cost estimate (4 MB) is regenerated into the cache, not committed.
