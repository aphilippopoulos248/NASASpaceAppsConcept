# Independent validation, lunyx-science T-3 (continues Lunyx T-34 items 5 and 6)

Owner: @validation (project lunyx-science). Picks up T-34 from @ephemeris-check's hand-off
(a9bc640, `../ephemeris-check/T-34-handover.md`; items 1-4 done there and not repeated). Same rules as
T-26 and T-34: every reference value is computed here, from the bundled data files and from outside
sources, with code that shares nothing with `src/`; the app is only *called*, from a throwaway
`git archive` export of the build under test (outside every worktree, `node_modules` linked from
this worktree); tolerances are stated with their reason; nothing is tuned to agree.

The reference code is round 1's (`../ephemeris-check/lib/`: `lunyx_dem.py` reader, `skyline.py` ray
march, `skygeom.py` discs and crossings), extended here where a check needed it:

- `near_field.py`: the first 500 m of every ray without a sampling step that can miss a crease
  (every grid-line crossing is evaluated; see 2a).
- `../ephemeris-check/lib/lunyx_dem.py` `eased_fine`: the 3 m models eased onto their 60 m windows by
  T-32's rule, re-implemented from its handover text (docs/lunyx/handover/T-32-edge-easing.md on
  e4b06ef), not from src/terrain.

## 2a. Skyline at 0, 0.5 and 2 m (T-34 item 5, first half; T-31 item 1)

`check1b_skyline_masts.py`, results in `skyline-masts/results.txt`. Build: am/lunyx/agent/analysis
**1289083** (its analysis and terrain code is identical to am/lunyx/integration 6c7b94c, which
integrates it, except for one test file).

Sites: the seven round-1 pins (IM-2, Apollo 15, Chandrayaan-3, the Shackleton rim and connecting
ridge pins, PGDA's brightest ridge and rim pixels) and two **fresh pins** that no one had tuned
against. 1289083's author compared it with round 1's stored 0 m and 2 m references, and no 0.5 m
reference existed, so `pick_fresh_pins.py` chose two grid summits on the 40 m polar layer by a
fixed rule before any app output was made (`skyline-masts/fresh-pins.json`; the rule's first
version picked single-cell spikes on crater floors and was replaced, also before any app output).

| Site | 0 m | 0.5 m | 2 m |
| --- | --- | --- | --- |
| IM-2 | +0.0026 | +0.0020 | +0.0027 |
| Apollo 15 | -0.0039 | -0.0041 | -0.0038 |
| Chandrayaan-3 | +0.0041 | -0.0029 | +0.0024 |
| Shackleton rim pin | -0.0032 | -0.0035 | -0.0042 |
| Connecting ridge pin | -0.0018 | -0.0019 | -0.0018 |
| Ridge top (PGDA's brightest) | +0.0013 | +0.0015 | -0.0015 |
| Rim top (PGDA's brightest on the rim) | -0.0017 | -0.0037 | -0.0017 |
| Fresh pin A (-88.46586, 94.25475) | -0.0027 | -0.0065 | **-0.0171** |
| Fresh pin B (-89.50713, -177.52577) | +0.0046 | -0.0058 | +0.0056 |

App minus reference, worst of 720 azimuths, degrees. No azimuth differs by more than 0.02 deg in
any of the 27 runs, and none by more than 0.1 deg (round 1's limit: a fifth of the Sun's diameter).
**Verdict: agrees.** With the observer on the ground, the skyline is the ground at the observer's
feet in 117 to 313 of the 720 azimuths at six of the nine sites; the app and the reference count
the same number of such azimuths at every one of them.

What the fresh pins showed about the reference, not the app: round 1's march samples every 0.1 m
near the observer. Where the skyline is formed by a crease of the bilinear grid a few metres away
(fresh pin A at 2 m: a crease 8.6 m from the observer), that step missed the crest by up to
0.10 deg, and the app (+0.088 deg against the march alone) was right. `near_field.py` evaluates
every grid-line crossing over the first 500 m; with it the reference is step-independent (0.01 m
and 0.002 m steps give the same values), and the app is then slightly *low* at such creases, by
0.017 deg at most. The march's own convergence figure (a second march twice as fine) had flagged
those cases (0.02-0.08 deg).

Tolerance: below 0.02 deg the two computations are within each other's numerical noise (T-26).
Round 1's stored references were reused where the elevation files are byte-identical (they are:
no change under public/ since 32ef35a); recomputing one gives 0.00000 deg.

## 2b. Blue Ghost sunset, 16 March 2025, by elevation product (T-1 point 3; T-34 item 6)

`check9_bg_products.py`, results in `blue-ghost-products/results.txt`. Independent of the app:
JPL Horizons Sun, the ray march over the bundled files, disc events bisected to 1 s. The script was
written before T-32's rule was read; the eased row was added afterwards and is labelled.

All figures in this section are for the catalogue pin as it stood before original T-38
(18.562 N, 61.81 E), and stay valid for it. T-38 moved the pin 8.4 m to LROC's measured position
(18.5622 N, 61.8102 E); there, at 2 m, the 3 m model gives first cut / last limb 18:24:16 / 19:30:50
UTC and the 60 m window alone 18:30:27 / 19:38:22, 6.2-7.5 min apart (`blue-ghost-products/new-pin.txt`,
decision D-12).

| Eye | Terrain | Skyline cuts the Sun | Half hidden | Last limb gone |
| --- | --- | --- | --- | --- |
| 2 m | 3 m model alone (= the stored stack) | 18:23:40 | 18:56:53 | 19:30:03 |
| 2 m | 60 m window alone, observer on its own ground | 18:27:22 | 19:00:29 | 19:33:31 |
| 2 m | 60 m terrain, observer on the 3 m model's ground | 18:36:44 | 19:09:53 | 19:42:53 |
| 2 m | T-32 eased stack | 18:36:44 | 19:09:53 | 19:42:53 |
| 0.5 m | 3 m / 60 m / eased | 18:09:45 / 18:00:29 / 18:24:02 | | 19:16:07 / 19:06:46 / 19:30:07 |
| 5 m | 3 m / 60 m / eased | 18:51:31 / 18:52:45 / 19:02:07 | | 19:57:57 / 19:58:55 / 20:08:16 |

- Under the setting Sun the skyline is the 3 m model's edge, 768 m west: the 3 m model alone gives
  the stored stack's times to the second, so nothing beyond the edge matters there.
- **The two measured products, each used throughout, put the sunset 3.5-3.7 min apart at 2 m**
  at this pin (9.3 min at 0.5 m, where the 60 m window's own near relief forms the skyline; 1.0-1.2
  min at 5 m), and 6.2-7.5 min at 2 m at the current pin. That spread is the uncertainty the
  elevation data leave (decision D-12, which replaced D-10: "3.5 to 7.5 min apart, depending on
  where within 8 m the lander stood").
- The eased stack is identical, to the second at all three heights, to "60 m terrain seen from the
  3 m model's ground": easing moves the skyline-forming ground onto the 60 m window but leaves the
  observer on the 3 m model, which stands 1.11 m above the window at the lander (1.6 m at the edge).
  Its 13 min shift therefore lies outside both products; it is a mixture of two datums, not a third
  measurement. (@terrain's LOLA comparison, read after this was written, finds the same direction:
  T-32-verification.md @ 0d27f2c.)
- Firefly's start of night, about 18:15-18:35 UTC (`../ephemeris-check/events/sources.json`), holds
  either product's first cut at 2 m at this pin (at the current pin the first cuts are 18:24:16 and
  18:30:27); the eased one, computed at this pin only, falls just after it. Firefly does not define
  the term, so this is weak support.
- Round 1's figures, at the same pin, reproduce (18:23, 18:56, 19:30:03); a march twice as fine
  moves them by 1-2 s.

Seam check in both modes (`../ephemeris-check/check0b_layer_seams.py --eased`, results in
`../ephemeris-check/terrain/seams-eased.txt`): at the 19 sites with a 3 m model the as-stored
mismatch at the edge, read at the same points of both grids (T-32's own measure), agrees with T-32's
table to its 0.1 m rounding at every site; with the rule applied it is 0.000 m everywhere. The
stored-mode table (`terrain/seams.txt`) is unchanged, because the files are unchanged.

## 2b, app side: the ground the delivered build stands on (T-34 item 6)

Build: `am/lunyx-science/integration` **af1b499** (T-1 integrated, decision D-10: stored grids by
default, `{ easeEdges: true }` as an opt-in). Asked through T-32's own report script
(`scripts/terrain-seams.mjs --heights`, run in the export), 1808 points per site at the 19 sites
with a 3 m model: nodes on nine rings across the 129 m band and the edge, half-cell points, and
points 1.5 m and 30 m outside the edge (`../ephemeris-check/check0c_app_heights.py`, results in
`../ephemeris-check/terrain/app-heights-af1b499.txt`):

- the heights in use equal this fixture's own reader of the stored files to under 0.1 mm everywhere;
- the opt-in eased stack equals the independent re-implementation of T-32's rule to 0.2 mm;
- the source named for every point inside the model is the 3 m model.

Skylines on that build, 2 m, against references with the exact near field (`skyline-eased/results.txt`):
Blue Ghost 0.0022 deg, Apollo 12 0.0021, Luna 23 0.0038 at worst. These are the three sites that
easing would have moved most (T-32's table); on the stored default nothing moves.

## T-34 item 5, second half: both ends of every set and rise; Earth by disc (T-31 items 2-3)

Build: `am/lunyx-science/integration` **9bc4878** (T-2 integrated; contains 1289083).
`../ephemeris-check/check10_transitions.py`, results in `../ephemeris-check/transitions/results-9bc4878.txt`.
141 instants in 48 passages of the Sun and Earth (first cut, centre, last limb; first limb, centre,
whole disc clear) at Blue Ghost (0.5, 2, 5 m), IM-2 (14 days), Chandrayaan-3 (33 days) and five polar
and limb sites over 60 days, against Horizons and own skylines (61-strip disc, bisected to 1 s).
A time difference is scored as the skyline error that explains it (dt x the rate at which the
clearance changes); tolerance 0.01 deg.

- Blue Ghost, all three eye heights: every instant within 4 s (2 m: 18:23:41 / 18:56:49 / 19:30:04
  against 18:23:40 / 18:56:51 / 19:30:03). Both are at the catalogue pin before original T-38
  (18.562 N, 61.81 E); at the current pin the validator's 2 m first cut / last limb are 18:24:16 /
  19:30:50 UTC (decision D-12).
- Worst over all: 0.0185 deg (the Sun's centre rising at IM-2 on 6 March, 7.7 min late), then
  0.0140 (an Earthrise's first limb at the connecting-ridge pin, 13.9 min) and 0.009 (a sunrise at
  the east-limb pin, 1 min). With this fixture's skyline read only every 0.5 deg, as the app keeps
  it, the worst is 0.0040 deg and those three fall to 0.0001-0.0009 (`results-9bc4878-sky0.5.txt`).
  So the passage logic agrees; what remains is the app's 0.5 deg azimuth step meeting narrow
  skyline features. Near the poles that can move an instant by several minutes.
- Every event carries its span as the contract says (sunset = span end, sunrise = span start,
  Earth events among the span's centre crossings).
- Any part of Earth's disc: within 0.04 points everywhere (60-day windows at five sites, IM-2 14
  days); longest spell wholly hidden within 0.3 h.

18.6 years on the same build (`../ephemeris-check/illumination/results-9bc4878.txt`):

- @analysis's question (T-31 item 1): the connecting-ridge pin at 0 m now reads 44.21 % any Sun
  against this fixture's 44.21 % (48.93 % before 1289083). All twelve point and eye-height cases are
  within 0.05 points.
- Any part of Earth's disc: within 0.03 points of the own figure in all twelve cases. Against PGDA
  product 69 at 2 m: +0.07 to +1.05 points at the four smooth points (centre figure: 4.4 to 11.1
  below); single pixels on crests prove nothing (neighbouring PGDA pixels differ by tens of points).

## T-34 items 1 and 3, the two points round 2 left pending

- Outlook row 9 at the Shackleton-rim pin, on 9bc4878 (`../ephemeris-check/outlook/results-9bc4878.txt`):
  20.76 % any Sun against 20.84 % (was 21.41 %, +0.57 points, before 1289083's skyline). Every row at
  both sites within 0.11 points; the longest Earth gap's ends at the rim pin within 3 min (were 12-14).
  Any part of Earth's disc per lunar day within 0.20 points.
- DSN edges after T-9, on af1b499 (`../ephemeris-check/dsn/results-af1b499.txt`): the 84 edges set by
  a station's elevation limit within 0.9 s (round 2: 5.3 s), which is the reference's own 1 s
  precision; edges set by the lunar skyline within 1.5 min (unchanged); shares within 0.03 points.

## Wording review of the submission documents

`review-submission-docs.md`: README.md, SOURCES.md section 2 and AI-USE.md section 2.3 on
`am/lunyx-experience/agent/submission` 3871d58, line by line, with suggested wording.

## What was not checked

- Anything on the GPU or in the browser (no Chromium runs here, decision D-9).
- The site windows (`public/terrain/*.bin`) against their PDS sources (round 1 limit, unchanged).
- The app's eased skylines (only its eased heights): easing is an opt-in for comparison (D-10).
- Published event times beyond those of round 1: none new was found for IM-2.
- The 18.6-year longest darkness (round 1 limit, unchanged).

## Re-running

```
V=tests/fixtures/validation/ephemeris-check; S=tests/fixtures/validation/science-validation
git archive <sha> | tar -x -C /tmp/export && ln -s $PWD/node_modules /tmp/export/node_modules
node $V/app_dump.mjs --root /tmp/export --commit <sha> --scenarios $S/skyline-masts/scenarios.json --out $S/skyline-masts/app-<sha>.json
python3 -I $S/check1b_skyline_masts.py --root /tmp/export --app app-<sha>.json --write      # 17 references are stored; 1-2 min
python3 -I $S/check9_bg_products.py --write                                                 # about 15 min
python3 -I $V/check0b_layer_seams.py --eased --write                                         # seconds
```

Heavy runs go under the shared CPU lock (`flock /tmp/lunyx-heavy.lock ...`, decision D-9). The
later checks re-run the same way with `--app app-<sha>.json --tag <sha>` (checks 3, 5, 7),
`--build <sha>` (check 10) and `--app-dir DIR --commit <sha>` (check 0c); each script's header
gives its full command.
