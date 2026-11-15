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
  (9.3 min at 0.5 m, where the 60 m window's own near relief forms the skyline; 1.0-1.2 min at 5 m).
  That spread is the uncertainty the elevation data leave (decision D-10).
- The eased stack is identical, to the second at all three heights, to "60 m terrain seen from the
  3 m model's ground": easing moves the skyline-forming ground onto the 60 m window but leaves the
  observer on the 3 m model, which stands 1.11 m above the window at the lander (1.6 m at the edge).
  Its 13 min shift therefore lies outside both products; it is a mixture of two datums, not a third
  measurement. (@terrain's LOLA comparison, read after this was written, finds the same direction:
  T-32-verification.md @ 0d27f2c.)
- Firefly's start of night, about 18:15-18:35 UTC (`../ephemeris-check/events/sources.json`), holds
  either product's first cut at 2 m; the eased one falls just after it. Firefly does not define the
  term, so this is weak support.
- Round 1's figures reproduce (18:23, 18:56, 19:30:03); a march twice as fine moves them by 1-2 s.

Seam check in both modes (`../ephemeris-check/check0b_layer_seams.py --eased`, results in
`../ephemeris-check/terrain/seams-eased.txt`): at the 19 sites with a 3 m model the as-stored
mismatch at the edge, read at the same points of both grids (T-32's own measure), agrees with T-32's
table to its 0.1 m rounding at every site; with the rule applied it is 0.000 m everywhere. The
stored-mode table (`terrain/seams.txt`) is unchanged, because the files are unchanged.

## Pending

- The app side of 2b (its own heights and skylines, default and opt-in easing) on T-1's review SHA
  (`../ephemeris-check/check0c_app_heights.py`, `skyline-eased/`).
- T-34 item 5, second half (T-31 items 2-3: both ends of each passage, Earth by disc) on T-2's review
  SHA: `../ephemeris-check/check10_transitions.py`; smoke test on 7767d3d at IM-2 within 0.006 deg and
  0.05 points.
- 18.6-year shares from a build with 1289083 (`check3 --apps ... --tag`): @analysis's 0 m any-Sun
  question at the connecting-ridge pin, and the any-part Earth figure against PGDA product 69.
- Outlook row 9 at the rim pin (`check5 --app ... --tag`).
- Wording review of the submission documents (lunyx-experience @submission).

## Re-running

```
V=tests/fixtures/validation/ephemeris-check; S=tests/fixtures/validation/science-validation
git archive <sha> | tar -x -C /tmp/export && ln -s $PWD/node_modules /tmp/export/node_modules
node $V/app_dump.mjs --root /tmp/export --commit <sha> --scenarios $S/skyline-masts/scenarios.json --out $S/skyline-masts/app-<sha>.json
python3 -I $S/check1b_skyline_masts.py --root /tmp/export --app app-<sha>.json --write      # 17 references are stored; 1-2 min
python3 -I $S/check9_bg_products.py --write                                                 # about 15 min
python3 -I $V/check0b_layer_seams.py --eased --write                                         # seconds
```

Heavy runs go under the shared CPU lock (`flock /tmp/lunyx-heavy.lock ...`, decision D-9).
