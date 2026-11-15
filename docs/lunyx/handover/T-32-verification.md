# T-32 verification (Lunyx Science T-1): the edge easing checked, and checked against LOLA

Owner: @terrain. Subject: am/lunyx/agent/ice-targets @ e4b06ef (5a1ba2a, "3 m site models eased
onto their 60 m windows", plus the merge of integration cc736f8), as described in
`docs/lunyx/handover/T-32-edge-easing.md`. Verified 2026-11-15 on a machine at load 10 to 30.

Short version: the code does exactly what the hand-over says, to a fraction of a millimetre, and
every figure in the hand-over reproduces. But the choice of reference it makes, the 60 m window,
is the weaker one. Laser altimetry (LOLA) shows that where the two grids step against each other
at the model's edge, the error is the 60 m window's, and that easing moves the ground in the
model's outer 129 m away from LOLA at most sites. At Blue Ghost it lowers the skyline the Sun
sets behind by about 0.07 deg more than LOLA allows, which makes the sunset some 9 to 13 minutes
late. Whether to change the reference is a decision for @coordinator (section 4).

The Blue Ghost figures in this report are for the catalogue pin as it stood before original T-38
(18.562 N, 61.81 E). Section 5 also gives the two products' spread at the current pin
(18.5622 N, 61.8102 E; lunyx-science decision D-12).

## 1. The code against an independent implementation

`scripts/terrain-seams-check.py` reads `public/terrain/*.bin` with its own numpy code (no code
shared with `src/`) and applies the rule from the hand-over itself.

- **Seam as stored**, 19 sites, 60 m window minus 3 m model along the model's edge: equal to
  `node scripts/terrain-seams.mjs` at every site to the table's 0.1 m, and within 1.19 m of the
  independent check's table (T-26, `tests/fixtures/validation/ephemeris-check/terrain/seams.txt`;
  largest difference SLIM's highest value, +17.6 against +18.8 m: that check reads each grid
  1.5 m on its own side of the edge, so the slope of the ground adds to its figures).
- **Seam in the stack**: at most 1.0 mm along the edge at all 19 sites (0.24 mm at the edge
  nodes themselves). Of the 80 840 nodes in the band 80 714 to 80 840 move (the others by less
  than the 0.2 mm resolution of the stored floats); nothing outside the band moves.
- **Heights the app uses** (`node scripts/terrain-seams.mjs --heights`), 31 464 points per site
  (rows and columns of nodes across the band, the edge ring, 10 000 random points inside the
  model, 3 000 outside it): the stored stack equals the independent reader to 3 micrometres;
  the eased stack equals the independent easing to 0.4 mm. Outside the band the app's eased
  stack equals its stored one exactly; inside, it moves by up to 25.3 m (SLIM).
- **Skyline**, independent dense ray march (0.1 m steps near the observer, 0.05 % of the
  distance beyond) at the three sites that change most: the change from stored to eased is
  -0.166 deg at azimuth 274.50 (Blue Ghost), -0.143 deg at 352.75 (Apollo 12), -0.141 deg at
  86.25 (Luna 23), exactly as the app computes it; the absolute skylines agree with the app
  within 0.025 deg on e4b06ef and within 0.004 deg with @analysis's 1289083 merged (section 6).

## 2. What moves in the results (observer 2 m up, 1 440 azimuths)

`node scripts/terrain-seams-skyline.mjs` (the app's own `computeHorizon` and `analyseWith`), the
eased stack minus the stored one. "On the edge" is the independent check's definition: the
ground that forms the skyline lies within 6 m of the model's edge. Events: every sunrise and
sunset (last limb) in the 30 days after the landing, model ephemeris.

| Site | Largest skyline change | at azimuth | skyline there, as stored -> eased | RMS | moved > 0.01 deg | on the edge before / after | Events |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- |
| blue-ghost-1 | -0.166 deg | 274.50 | 0.575 deg at 770 m (3 m model, its edge) -> 0.408 at 722 m (eased band) | 0.026 | 11.3 % | 5.8 % / 0.1 % | sunset 16 Mar 2025 19:30 -> 19:43 UTC (+13.0 min) |
| apollo-12 | -0.143 | 352.75 | 0.628 at 726 m (band) -> 0.485 at 674 m (band) | 0.015 | 4.9 % | 1.9 % / 0.0 % | unchanged |
| luna-23 | -0.141 | 86.25 | 0.822 at 694 m (band) -> 0.681 at 27.9 km (480 m window) | 0.013 | 3.2 % | 0.1 % / 0.1 % | sunrise 16 Nov 1974 19:00 UTC, 0.9 min earlier |
| change-3 | +0.114 | 44.75 | -0.337 at 1 082 m (60 m window) -> -0.223 at 1 026 m (3 m model, corner) | 0.007 | 0.9 % | 0.6 % / 0.1 % | unchanged |
| apollo-11 | -0.094 | 344.25 | -0.223 at 704 m (band) -> -0.317 at 474 m | 0.008 | 1.7 % | 0 / 0 | unchanged |
| change-5 | -0.075 | 24.25 | -0.103 at 840 m (model corner) -> -0.178 at 1 023 m (60 m window) | 0.003 | 0.2 % | 0.4 % / 0.2 % | unchanged |
| change-6 | +0.055 | 306.25 | -0.085 at 3 423 m (60 m window) -> -0.030 at 919 m (model corner) | 0.003 | 0.6 % | 0.7 % / 0.0 % | unchanged |
| change-4 | -0.041 | 280.00 | 0.009 at 780 m (model corner) -> -0.032 at 731 m | 0.003 | 1.0 % | 0.5 % / 0.0 % | unchanged |
| luna-24 | -0.034 | 214.25 | 0.195 at 878 m (model corner) -> 0.161 at 1 816 m | 0.001 | 0.3 % | 0 / 0 | unchanged |
| surveyor-7 | -0.016 | 305.50 | 3.229 at 818 m -> 3.213 at 818 m (model corner) | 0.001 | 0.1 % | 0 / 0 | unchanged |
| the other 9 | 0 | | | 0 | 0 | 0 to 0.1 % | unchanged |

Where the largest change is a fall, the skyline as stored was formed by the 3 m model in its
outer 129 m or at its edge, and easing lowers it: the eased band replaces measured 3 m ground
exactly where those skylines are formed. Sites without a 3 m model do not change at all.

**Blue Ghost, 16 March 2025** (one-minute samples of the visible part of the disc; the Sun sets
at azimuth 269.7 to 269.95 deg):

| Observer | Stack | Skyline starts to cut the Sun | Last limb gone |
| --- | --- | --- | --- |
| 2 m up | as stored | 18:24 UTC | 19:30:11 |
| 2 m up | eased | 18:37 | 19:43:03 |
| 3.5 m up | as stored | 18:38 | 19:44:11 |
| 3.5 m up | eased | 18:50 | 19:55:48 |

## 3. Which grid is right at the edge: LOLA

LRO LOLA's laser shots (RDR, from the ODE Granular Data System, `query=lolardr`) are the
absolute reference both products were tied to: about 1 m radially, a 5 m spot. All valid shots
(flag 0) within 1.2 km of each site: 17 of the 19 sites have enough of them (Chang'e 5 has none,
Chang'e 3 too few inside the model). Each grid is compared after removing the model's own
offset against LOLA at the site (median over the model's core, -2.1 to +1.3 m), so that zero
means "right for an observer standing on the model". `python3 -I scripts/terrain-seams-check.py lola`.

| Site | Shots in model / band / outside | Band: eased (T-32) | Band: model kept | Band: 60 m | Outside: 60 m (T-32, stored) | Outside: 60 m eased onto the model |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| surveyor-3 | 311 / 96 / 417 | 0.59 | 0.45 | 0.76 | 1.25 | 1.22 |
| surveyor-7 | 745 / 239 / 127 | 1.44 | 1.50 | 1.60 | 1.46 | 1.53 |
| apollo-11 | 183 / 35 / 35 | 0.94 | 0.31 | 1.48 | 1.42 | 1.09 |
| apollo-12 | 409 / 155 / 111 | 1.06 | 0.81 | 1.22 | 1.29 | 1.05 |
| luna-16 | 457 / 99 / 74 | 0.95 | 0.78 | 2.03 | 1.33 | 0.92 |
| apollo-14 | 190 / 74 / 125 | 1.62 | 0.77 | 1.76 | 1.35 | 0.88 |
| apollo-15 | 577 / 207 / 101 | 1.03 | 0.59 | 1.39 | 1.28 | 1.17 |
| luna-20 | 757 / 165 / 192 | 2.83 | 1.12 | 3.07 | 2.89 | 2.88 |
| apollo-16 | 233 / 80 / 419 | 3.61 | 1.51 | 3.73 | 2.57 | 2.96 |
| apollo-17 | 318 / 99 / 51 | 1.84 | 0.88 | 2.36 | 2.84 | 2.51 |
| luna-21 | 99 / 18 / 105 | 1.00 | 0.57 | 1.54 | 1.37 | 1.30 |
| luna-23 | 175 / 118 / 30 | 2.59 | 2.35 | 4.89 | 5.88 | 4.28 |
| luna-24 | 131 / 21 / 22 | 3.73 | 0.52 | 5.10 | 2.95 | 1.90 |
| change-4 | 135 / 128 / 22 | 0.97 | 0.69 | 2.12 | 1.22 | 1.07 |
| slim | 415 / 136 / 68 | 1.90 | 1.87 | 3.20 | 1.91 | 1.58 |
| change-6 | 140 / 36 / 23 | 1.16 | 0.95 | 1.35 | 1.43 | 1.10 |
| blue-ghost-1 | 133 / 23 / 76 | 1.36 | 0.37 | 1.95 | 2.36 | 1.68 |

RMS, metres, against LOLA. "Band" is the model's outer 129 m, "outside" up to 129 m beyond its
edge; "60 m eased onto the model" is the other choice of reference (model kept to its edge, the
60 m window moved by the step at the nearest edge point, fading out over 129 m).

- **In the band the stored model is closer to LOLA than the eased ground at 16 of 17 sites.**
  With the median absolute error instead of the RMS (robust to the few shots that land on
  crater walls): better at 13, equal within 0.02 m at 3 (Surveyor 7, Chang'e 6, Blue Ghost),
  worse at 1 (Apollo 16).
- **The step is the 60 m window's error, not the model's.** Over all sites, the window's error
  in the 129 m beyond the edge follows the step at the nearest edge point (slope 0.39,
  correlation 0.40, 1 998 shots); the model's error in its band does not follow it at all
  (slope -0.04, correlation -0.06, 1 729 shots). With the model kept and the window eased onto
  it outside the edge, the error there falls at 14 of 17 sites (15 by median).
- **Blue Ghost.** A LOLA track (25 April 2011) runs north-south 64 to 82 m west of the model's
  edge, across the azimuths where the Sun sets. Seen from 2 m above the site:

  | Azimuth | LOLA shot at | LOLA ground | 60 m window there | Skyline as stored | Skyline eased |
  | ---: | ---: | ---: | ---: | ---: | ---: |
  | 264.9 | 844 m | 0.364 deg | 0.340 | 0.344 (844 m, 60 m window) | 0.344 (844 m, 60 m window) |
  | 268.9 | 842 m | 0.497 | 0.445 | 0.547 (768 m, model edge) | 0.453 (839 m, 60 m window) |
  | 271.0 | 832 m | 0.545 | 0.446 | 0.598 (768 m, model edge) | 0.447 (839 m, 60 m window) |
  | 272.8 | 844 m | 0.429 | 0.333 | 0.583 (769 m, model edge) | 0.425 (1 981 m) |

  The eased skyline in the Sun's direction is formed on the 60 m window 70 m beyond the edge,
  and LOLA puts that ground 0.05 to 0.10 deg (0.8 to 1.5 m) higher than the window does. The
  skyline therefore stands at least that much above the eased one: about 0.07 deg at azimuth
  270, which is 9 minutes of sunset at this latitude. The model's ground at its edge (the stored
  skyline, 0.55 to 0.60 deg) is level with LOLA's 64 m further out (about 8 m above the
  observer's eye), so the stored skyline is consistent with LOLA. There is no LOLA shot inside
  the model's western band itself.

So, on the evidence: easing the 3 m model onto the 60 m window replaces the better-measured
ground, and at Blue Ghost it does so exactly where the sunset skyline is formed. The stored
times (first cut 18:24, last limb 19:30 UTC at 2 m) are the better-founded ones; they also agree
with the validator's 18:23 (same grids, other code) and with Firefly's reported start of night
(about 18:15 to 18:34 UTC from two statements in its release; Firefly does not define the
term, so this is weak support, not a test).

The independent validator reached the same direction from the published time alone, before
this check (@ephemeris-check, a9bc640, `tests/fixtures/validation/ephemeris-check/T-34-handover.md`,
"5 and 6"): it calls the easing "a modelling choice" that "the one published time does not
support", and asks for an eased mode in its reader so that both are reported. LOLA is the
stronger test: it measures the ground itself, where the published time only brackets an event.

## 4. The decision this raised (for @coordinator)

**Decided: option A**, recorded as D-7 and restated as D-10 (Lunyx Science, 2026-11-15), which
states the uncertainty as the two products' spread (section 5). The stack keeps the stored
grids; easing is opt-in (`easeEdges: true`) for comparison. Option B is quantified first (T-8,
`docs/lunyx/handover/T-32-option-b.md`). The options as put to the decision:

1. **A. Ease nothing by default** (`easeEdges` off unless asked for): the stack is the stored
   grids again, with T-32's measurement of every hand-over (`stack.seams`, the notes) kept.
   A one-line change plus tests and docs. The analysis' numbers return to those of integration
   cc736f8; only the notes' wording and the seam figures (both grids now read at the same
   points) differ from it. The step stays: the skyline is formed on
   it at 0 to 5.8 % of azimuths, and a slope measured across it reads up to 24 to 66 deg in a
   10 m strip along the edge.
2. **B. Make the model the reference**: keep it to its edge and ease the 60 m window onto it
   outside, over about 129 m. No step, the model's ground kept, and LOLA's error lower outside
   the edge at 14 or 15 of 17 sites. New code in `src/terrain` (the band outside lies within two
   60 m cells, so it needs a source of its own, not an edited 60 m grid), about half a day with
   tests. The surface view eases the other way when it draws, so the picture would differ from
   the analysis at the edge until @surface uses the same rule.
3. **C. Take e4b06ef as it is**: no step and the picture matches the analysis (after the one
   line for @surface below), at the cost measured in section 3.

My recommendation was A now, B as a follow-up if the step should go. A is also the smallest
change to what consumers already have.

## 5. Consumers

- **Surface view and analysis on the same ground.** The hand-over's "under 2 mm" is a test that
  applies the view's `blendEdge` to the *stored* grids and compares with the eased stack. It
  holds (0.24 mm here). But the view does not draw from the stored grids: `sampleLevel`
  (`src/scene/surface/groundSource.ts:127`) copies the stack's exact 3 m window, which is now
  eased, and `composeFine` (`src/scene/surface.ts:485`, `blendEdge(fine, this.coarse[0])`) eases
  it again, so the weight is 2w - w*w instead of w. Drawn minus analysed in the band: up to 1.5
  to 6.7 m at single nodes (SLIM the largest), 0.23 to 0.58 m RMS over the band; the T-32
  hand-over's figures (0.2 to 0.6 m RMS, 6.7 m at SLIM) are confirmed. The fix is one line in
  @surface's `groundSource.ts:127`: copy from `storedGrid(stack.sources[exact])` (exported by
  `src/terrain/api.ts`). Not made here (D-4). Without it the drawn ground is still closer to the
  analysed one than before T-32 (at most a quarter of the mismatch instead of all of it). Needed
  under option C only: under A the stack holds the stored grids, so the copy is the stored grid
  already.
- **Caches.** Nothing holds stored heights under a key that easing leaves unchanged: the eased
  grid is a new `HeightSource` (the analysis' fast samplers are keyed by the object, in a
  `WeakMap`); the terrain cache of eased stacks is keyed by site and `easeEdges` and checks the
  identity of the stored sources; the analysis caches in `src/analysis/api.ts` are per scenario
  and per page, always on the default stack; nothing is stored in `localStorage` or IndexedDB;
  the Web Worker loads and eases its own terrain.
- **Slope in the band.** With the analysis' stencil (3 x 3 points over 10 m): eased minus stored
  0.5 to 1.0 deg median, 3.2 to 5.4 deg at the 95th percentile, up to 9.7 to 25 deg at single
  points (where the two grids differ by tens of metres within 129 m). The site's own slope is
  unchanged (the site is in the core). The nearby scan with its defaults (2 km, 300 m) judges
  every candidate on the 60 m window, which easing does not change, and no default candidate
  lies in the band. With a radius under about 1.2 km it judges them all on the 3 m model, and
  with a spacing that puts candidates 639 to 768 m out (100 m, for example) those get the eased
  slope.
- **Event times** (section 2): Blue Ghost's sunset of 16 March 2025, +13.0 min (first cut
  +13 min); Luna 23's sunrise of 16 November 1974, -0.9 min. Nothing else in the 30 days after
  any landing moves by more than 0.05 min.

**Event times: the sensitivity, and the two products' spread.** One metre of height at the
model's edge (0.77 km) is 0.075 deg of skyline, which at a sunrise or sunset is 8.8 min/m at the
equator, 9.3 at Blue Ghost and 12.6 at Chang'e 4 (the Sun climbs 0.0085 deg/min times the cosine
of the latitude, at most). That sensitivity is what the notes state, per site (decision D-10).
Over the azimuths where the Sun can rise or set (90 and 270 deg, plus or minus 2 deg over the
cosine of the latitude), the stored and the eased stacks differ by up to 0.162 deg at Blue Ghost
(sunsets up to 20 min apart) and 0.097 deg at Luna 23 (sunrises up to 12 min), and nowhere at the
other 17 sites. That is the effect of the rejected easing, not an uncertainty: the eased stack
lies outside both measured products. Their own spread, each product used throughout, has been
computed independently for Blue Ghost on 16 March 2025, observer 2 m up, at the catalogue pin
before original T-38, 18.562 N, 61.81 E (@validation,
`tests/fixtures/validation/science-validation/blue-ghost-products/results.txt` on
am/lunyx-science/agent/validation @ af49a12; first cut / half hidden / last limb, UTC):

| Ground | First cut | Half hidden | Last limb |
| --- | --- | --- | --- |
| 3 m model throughout (= the stored stack) | 18:23:40 | 18:56:53 | 19:30:03 |
| 60 m window alone (observer on its own ground, 1.11 m below the model's) | 18:27:22 | 19:00:29 | 19:33:31 |
| T-32's eased stack | 18:36:44 | 19:09:53 | 19:42:53 |

So the products are 3.5 to 3.7 minutes apart at 2 m at that pin (9.3 at 0.5 m, 1.0 to 1.2 at
5 m), and the eased time falls outside that range at every height. At the current pin
(18.5622 N, 61.8102 E, 8.4 m away) the 3 m model gives 18:24:16 / 19:30:50 and the 60 m window
alone 18:30:27 / 19:38:22 UTC, 6.2 to 7.5 minutes apart (@validation, `blue-ghost-products/new-pin.txt`
@ 97d0b66; decision D-12): the two products put this sunset 3.5 to 7.5 minutes apart, depending on
where within 8 m the lander stood. The validator's reading is that the eased
stack is a 60 m skyline seen from the 3 m model's ground; it agrees with the LOLA finding.

## 6. With @analysis's ground-observer fix (1289083)

(Since then 1289083 and 5ad5d1f arrived through integration, and this branch merged
am/lunyx-science/integration 64b7e5d cleanly as d7ee94f. Under D-10 the default stack is the
stored grids, equal to cc736f8's to the bit (section 8), so on the real combination the analysis
numbers are integration's own; the figures below compare the opt-in eased stack.)

Trial merge only, in a throwaway repository under /tmp (never on this branch): `git merge-tree`
and a real `git merge --no-commit` both clean, no file in common (analysis: `src/analysis/**`,
`src/ui/compare/**`, `docs/lunyx/validation.md`, T-11 screens; this branch: `src/terrain/**`,
`scripts/terrain-*`, `docs/lunyx/handover/T-32-*`, `T-4-terrain.md`). On the combination, every
figure of section 2 holds: the largest change per site and its azimuth are the same (Chang'e 3
+0.113 deg at 45.00 instead of +0.114 at 44.75), the Blue Ghost sunset moves +12.8 min instead
of +13.0. 1289083 raises skylines by up to 0.033 deg (its finer near-field search), equally on
both stacks.

## 7. What moves for consumers, by option

Against am/lunyx/integration (T-32 changes nothing else; the analysis' numbers on the stored grids
are those of cc736f8 plus @analysis's 1289083 / 5ad5d1f).

**Under C (e4b06ef as it is)**, for original @analysis, @surface, @globe and our @validation:

- Skyline, 2 m up: changes at 10 sites (section 2): Blue Ghost -0.166 deg at azimuth 274.5
  (11.3 % of azimuths by more than 0.01 deg), Apollo 12 -0.143 at 352.75, Luna 23 -0.141 at
  86.25, Chang'e 3 +0.114 at 44.75, Apollo 11 -0.094, Chang'e 5 -0.075, Chang'e 6 +0.055,
  Chang'e 4 -0.041, Luna 24 -0.034, Surveyor 7 -0.016. Nothing changes at the other 9 sites with
  a model or at the 9 without one.
- Events: Blue Ghost, 16 March 2025, 2 m up: first cut 18:24 -> 18:37, last limb 19:30:11 ->
  19:43:03 UTC; 3.5 m up: 18:38 -> 18:50 and 19:44:11 -> 19:55:48. Luna 23, sunrise 16 November
  1974, 0.9 min earlier. Every other sunrise and sunset in the 30 days after each landing:
  within 0.05 min. On other dates the two can differ by up to 20 min at Blue Ghost (sunsets)
  and 12 min at Luna 23 (sunrises), nowhere else.
- Slope within 639 to 768 m of a model site's centre: 0.5 to 1.0 deg median, up to 25 deg at
  single points. The sites' own slopes and the default nearby scan do not change.
- Words: the terrain notes (site card, surface HUD, and the analysis warnings and provenance,
  which copy them) replace the seam sentence with "Where a separately measured model ends, its
  heights are eased onto the grid that continues outside it ..." and "Hand-overs left as
  stored: ...". The eased model's `provenance.processing` gains "When loaded: within 129 m of its
  edge ...". `stack.seams[].eased` is new (optional).
- @surface: the one line at `groundSource.ts:127` (section 5).
- @validation: the stored-file reference skylines differ from the app at the 10 sites by the
  amounts above; the rule to reimplement is `ease()` in `scripts/terrain-seams-check.py`.

**Under A (easing off by default)**: no number changes against integration; the stack is the
stored grids, the same objects as now. The seam sentence's wording changes, and its figures
move by up to 0.1 m because both grids are now read at the same points (Apollo 17, 60 m to 480 m
window: -14.2 / +29.5 m becomes -14.1 / +29.4 m). Nothing for @surface or @validation.

**Under B**: to be measured once built; by construction nothing changes inside the models, and
skylines formed beyond an edge rise where the 60 m window lies below the model there.

## 8. What was delivered under D-10 (D-7 at first)

On top of the verified slice (e4b06ef, this report 0d27f2c / 6f0a20d, merge of
am/lunyx-science/integration d7ee94f):

- `loadTerrainFor(site)` uses every grid as stored; `{ easeEdges: true }` gives T-32's eased
  stack, unchanged, for comparison (`src/terrain/api.ts`, `LoadTerrainOptions.easeEdges`).
- The seam note for the default stack: "Where one grid hands over to the next, the heights do
  not match exactly; the grids are used as stored, so the ground steps there: 0.77 km from the
  site the 3 m model ends and the 60 m window takes over, lying between 7.4 m below and 21.1 m
  above it, 3.6 m RMS (1 m of height is 0.075° of skyline there); ... A skyline point formed
  right at such an edge is uncertain by about that much. The 3 m model is kept as measured up
  to its edge: where the bundled models were checked against laser altimetry (LOLA), they are
  closer to the ground there than the 60 m windows." (Apollo 17; the figures are per site.)
- At every site with a 3 m model, the sensitivity, per site (D-10): "Near the horizon the Sun
  climbs at most 0.0080° per minute at this latitude, so 1 m of height at the 3 m model's edge
  (0.77 km from the site) moves a sunrise or sunset formed there by about 9 minutes." (Blue Ghost;
  9 to 10 minutes at the low-latitude sites, 12 to 13 at Surveyor 7 and the Chang'e sites, 18 for a
  pin 0.37 km from Apollo 11's edge.) The first commit under D-7 (30389f2) quoted the
  stored-against-eased figures (20 and 12 min) as an uncertainty; D-10 withdrew that, and they
  are gone from the code. The products' spread at Blue Ghost is quoted in section 5.
- Tests for both modes in `src/terrain/api.test.ts` ("where one grid hands over to the next"):
  the default is the stored grids (the same objects, equal to the files at all 19 sites), the
  eased mode is T-32's (no step, the surface view's own rule, 19 sites), and the notes of both.
- `scripts/terrain-seams.mjs` and `scripts/terrain-seams-skyline.mjs` report stored (in use)
  against eased (on request); `--heights` returns `inUse`, `stored` and `eased`.
- `docs/lunyx/handover/T-32-edge-easing.md` and `T-4-terrain.md` now say that easing is
  opt-in, and point here.

Checked: `npx vitest run src/terrain` 3 files, 60 tests passed; `npx tsc --noEmit` clean (both
under the shared lock, load 6 to 9). The default stack against integration cc736f8's own
`loadTerrainFor`, run from a throwaway checkout of cc736f8: equal heights at all 597 816 points
(31 464 at each of the 19 sites, inside the model, in its band and outside it), largest
difference 0 m. So on am/lunyx/integration nothing that is computed from the terrain changes;
only the words of the notes do.

**Limitation older than T-32, unchanged by this delivery.** The surface view eases the drawn
3 m model onto the 60 m window itself (`blendEdge(fine, this.coarse[0])`,
`src/scene/surface.ts:485`), so in the model's outer 129 m it draws T-32's eased ground while
the analysis uses the stored ground. The drawn skyline therefore sits up to 0.17 deg below the
analysed one at Blue Ghost (azimuth 274.5 deg, where the Sun sets), 0.14 deg at Apollo 12
(352.75) and Luna 23 (86.25), and by the section 2 amounts at the other sites with a model.
@surface needs no change for this delivery (the `storedGrid` line was needed only with easing
on). Option B (T-8) is the way to make the two meet without moving the analysis.

## Reproduce

```
node scripts/terrain-seams.mjs                                    # seam table, stored and in use
python3 -I -B scripts/terrain-seams-check.py seams                # the same from the files, independently
python3 -I -B scripts/terrain-seams-check.py points --site apollo-17 --out /tmp/in.json
node scripts/terrain-seams.mjs --heights /tmp/in.json --out /tmp/app.json
python3 -I -B scripts/terrain-seams-check.py compare --in /tmp/in.json --app /tmp/app.json
node scripts/terrain-seams-skyline.mjs --json /tmp/skyline.json  # section 2 (about 2 minutes)
node scripts/terrain-seams-skyline.mjs --sunset blue-ghost-1 --from 2025-03-16T16:00:00Z --hours 6 --masts 2,3.5
python3 -I -B scripts/terrain-seams-check.py skyline --sites blue-ghost-1,apollo-12,luna-23
python3 -I -B scripts/terrain-seams-check.py lola --fetch        # section 3; shots cached in scripts/.cache/terrain-lola
```
