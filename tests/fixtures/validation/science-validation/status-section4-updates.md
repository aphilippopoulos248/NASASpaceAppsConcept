# Proposed updates to docs/lunyx/STATUS.md section 4 (from lunyx-science T-3)

For the coordinators: STATUS.md belongs to the original coordinator, so these are proposals, not
edits. Each row replaces the row of the same claim in section 4 as it stands on
`am/lunyx/integration` 26dbaa7; rows not listed stay as they are. "Science build" =
`am/lunyx-science/integration`. Rows marked **(once delivered)** describe science-team work that
reaches `am/lunyx/integration` only with that project's deliveries (T-5, T-6, T-7 of lunyx-science);
until then the current row stays. Evidence: `tests/fixtures/validation/science-validation/README.md`
and the results files it names, on `am/lunyx-science/agent/validation`.

## Rows that can change now (the commits they rest on are on am/lunyx/integration)

The skyline row was checked on `1289083` itself. The sunlight and outlook rows were checked on the
science build `9bc4878`, which is `3899cb9`'s code plus T-2. T-2 adds fields and, by its contract,
leaves the existing ones unchanged. These rows were not re-run on `am/lunyx/integration` itself.

| Claim | Checked against | Result |
| --- | --- | --- |
| Skyline with the observer on the ground (0 m) | Same reference, re-checked independently at 0, 0.5 and 2 m at 9 pins, two of them chosen by a fixed rule before any app output (T-3, on `1289083`, the code `3899cb9` integrates) | Builds before `3899cb9` read up to 1.2 deg low on convex ground (+4.7 points of 18.6-year sunlight at a connecting-ridge pin). Since `3899cb9`: worst 0.017 deg over 27 runs, no azimuth over 0.02 deg; where the skyline is the ground at the observer's feet, app and reference agree on how many azimuths that is at all six such sites |
| Long-term sunlight | 18.6-year runs at six polar points against the validator's own computation and PGDA product 69 | Within 0.03 points of the validator at a 2 m mast; on the ground (0 m) within 0.05 points since `3899cb9` (connecting-ridge pin: 44.21 % against 44.21 %; it read 48.93 % before). IM-2 three ways at 2 m: PGDA 46.55 %, validator 46.71 %, app 46.68 % |
| Seasonal outlook | The validator's own skyline and SPICE, a year at IM-2 and a Shackleton-rim pin (T-34; re-run in T-3 on a build with `3899cb9`) | Within 0.11 points per lunar day at both sites; the rim-pin row that read 0.57 points high before `3899cb9` now reads 20.76 % against 20.84 %. The in-app model over a year: Sun within 0.0038 deg, Earth within 0.0030 deg of SPICE |
| Sunset, sunrise and eclipse times | The validator's own skyline and Horizons/SPICE directions | Within 0.5 min at Blue Ghost, Chandrayaan-3 and Apollo 15, where the Sun crosses the skyline quickly. Near the poles the same skyline agreement means minutes, because the Sun and Earth cross it slowly |

## Rows that change with the science team's deliveries

| Claim | Checked against | Result |
| --- | --- | --- |
| Bundled elevation grids **(once T-5 is delivered)** | The PDS originals, 30 080 samples; LRO LOLA laser shots at 17 of the 19 sites with a 3 m model (T-32 verification); the app's own heights at those 19 sites (T-3) | Equal within rounding. Where a 3 m site model meets its 60 m window, 768 m from the site, heights step by several metres; the 3 m model is closer to LOLA at 16 of 17 sites and stays as stored (lunyx-science D-10, now D-12; the app's heights equal the stored files to < 0.1 mm). At Blue Ghost the two products, each used throughout, put the 16 March 2025 sunset 3.5 to 7.5 min apart at a 2 m mast, depending on where within 8 m the lander stood: at the current catalogue pin (18.5622 N, 61.8102 E) first cut 18:24:16 / 18:30:27, last limb 19:30:50 / 19:38:22 UTC, 6.2-7.5 min apart; at the pin before original T-38 (18.562 N, 61.81 E) 18:23:40 / 18:27:22 and 19:30:03 / 19:33:31, 3.5-3.7 min apart (D-12). Easing the step away (T-32, kept as an opt-in) would move it 13 min (computed at the earlier pin), outside both products. The site windows themselves were not compared with their PDS sources |
| Both ends of every rise and set **(once T-6 is delivered; new row)** | The validator's own skyline and Horizons, 141 instants in 48 passages of the Sun and Earth at nine sites (T-3, on `9bc4878`) | Blue Ghost within 4 s (2 m, at the catalogue pin before original T-38: starts setting 18:23:41, fully set 19:30:04 UTC; validator 18:23:40, 19:30:03; at the current pin the validator's figures are 18:24:16 / 19:30:50, D-12). Worst 0.019 deg expressed as skyline; near the poles an instant can be several minutes off (up to 14 min for an Earthrise's first limb) where a skyline notch narrower than the app's 0.5 deg azimuth step lies under the disc. With the validator's skyline read every 0.5 deg the worst is 0.004 deg |
| Earth visibility at limb and polar sites **(once T-6 is delivered)** | The validator's skyline with Horizons Earth directions; PGDA product 69 | Earth's centre within 0.05 points. Any part of Earth's disc (new figure) within 0.04 points over 60 days at five sites and within 0.03 points over 18.6 years; against PGDA, which counts any part of the disc, within 0.1 to 1.1 points at the four smooth polar points at 2 m, where the centre figure reads 4.4 to 11.1 points lower |
| DSN station geometry (both rows) **(once T-7 delivers lunyx-science T-9)** | JPL Horizons with each station as observer; second party on dates the author did not use | Elevation within 0.001 deg. Edges set by a station's elevation limit: placed by bisection to 0.25 s, and within 0.9 s of the independent reference (84 edges; before T-9: 5.3 s, not the 0.3 s once quoted). Edges set by the lunar skyline within 1.5 min |

## Unchanged

Sun/Earth directions, skyline geometry on analytic cases, the 2 m skyline (since `3899cb9` within
0.005 deg at seven pins and 0.017 deg at two fresh pins, if a finer figure is wanted), published
mission facts, the 14 March 2025 eclipse, longest darkness and Earth gap past the window edge, slope,
the surface view picture and the never-run assistant rows: no new evidence changes them.
