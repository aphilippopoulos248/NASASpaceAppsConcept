# T-32 option B, quantified: the 60 m window eased onto the 3 m model outside its edge (T-8)

Owner: @terrain. A prototype and its measurements only: the app does not do this. Decision D-10
(which replaced D-7) keeps every grid as stored (option A); this note is the basis for deciding
whether option B is worth building. Prototype: `scripts/terrain-seams-option-b.mjs` (the
app's own terrain, skyline and event code); LOLA comparison: `scripts/terrain-seams-check.py lola` (its own reader and its
own implementation of the rule). Measured 2026-11-15 on branch am/lunyx-science/agent/terrain,
on the stored stack of 30389f2 / 0b01acb (the same heights, equal to integration's), heavy runs
under the shared lock.

**Recommendation: no-go for now.** B does what it promises on average: just outside the edge
it brings the ground closer to LOLA's at 15 of 17 sites, but by 0.15 m RMS on average. It also
moves the computed skyline by up to 0.36 deg at sites where no LOLA shot can say whether the
move is right. It moves sunrise or sunset times by up to 10 to 20 minutes on some dates at three
sites: Luna 21 9.6 min, Chang'e 5 14.5 min, Luna 23 19.9 min. Of the dated events, Chang'e 5's
sunrise of 26 December 2020 moves 13.1 minutes earlier. It needs code in the terrain module
and a change in two of @surface's files. Without that change the picture would disagree with
the analysis by more than it does now (0.36 deg instead of 0.17 deg). Sections 1 to 4 give the
numbers.

## The rule (proposal)

Within W metres outside the model's square, the 60 m window's height moves by the step at the
nearest point of the model's edge, fading out along a smooth step:

    h = h60 + s(q) * S(1 - d / W),   S(t) = t*t*(3 - 2t)

- `d` is the distance from the point to the square.
- `q` is the nearest point of the square.
- `s(q)` is the model minus the 60 m window there, both read bilinearly.

At the edge the ground is the model's; W metres out it is the window's. The model itself is
untouched. A band of 129 m is two cells of the 60 m grid, so B cannot be an edited 60 m grid. It
is a ring grid of its own, at the model's 3 m spacing: 599 x 599 nodes (1.4 MB), empty inside
the model, between the model and the 60 m window in the stack.

**W = 129 m**, the width of the band the surface view already uses inside the model. Against
LOLA, narrower bands help at slightly more sites and wider ones at fewer (section 1). The JS
prototype's ring and the Python implementation of the rule agree to 0.12 mm (float32
rounding) at all 97 680 ring nodes outside the model (Blue Ghost).

## 1. LOLA: the error just outside the edge, stored against B

Heights minus LOLA, after removing the 3 m model's own offset against LOLA at the site (as in
`T-32-verification.md`, section 3). Shots 0 to 258 m beyond the edge, RMS (median absolute).

| Site | Shots | As stored | B, W = 64.5 m | B, W = 129 m | B, W = 258 m | B, W = 516 m |
| --- | ---: | --- | --- | --- | --- | --- |
| surveyor-3 | 537 | 1.24 (0.87) | 1.24 (0.87) | 1.22 (0.85) | 1.35 (0.93) | 1.55 (1.01) |
| surveyor-7 | 366 | 1.60 (1.00) | 1.61 (0.98) | 1.62 (1.00) | 1.65 (0.97) | 1.90 (1.21) |
| apollo-11 | 67 | 1.35 (1.24) | 1.23 (1.17) | 1.18 (1.07) | 0.99 (0.61) | 0.82 (0.34) |
| apollo-12 | 578 | 1.17 (0.86) | 1.13 (0.86) | 1.13 (0.85) | 1.13 (0.80) | 1.37 (0.95) |
| luna-16 | 314 | 1.71 (1.29) | 1.67 (1.26) | 1.64 (1.22) | 1.68 (0.93) | 2.19 (1.03) |
| apollo-14 | 206 | 1.25 (0.97) | 0.99 (0.71) | 0.97 (0.66) | 0.94 (0.63) | 1.00 (0.59) |
| apollo-15 | 197 | 1.36 (0.90) | 1.33 (0.87) | 1.31 (0.84) | 1.26 (0.84) | 1.25 (0.82) |
| luna-20 | 332 | 2.74 (1.51) | 2.69 (1.47) | 2.73 (1.57) | 2.74 (1.56) | 2.81 (1.58) |
| apollo-16 | 839 | 2.57 (1.88) | 2.57 (1.65) | 2.78 (1.65) | 2.93 (1.59) | 3.17 (1.56) |
| apollo-17 | 126 | 4.05 (2.07) | 3.95 (1.86) | 3.96 (1.80) | 4.34 (2.04) | 5.19 (2.09) |
| luna-21 | 248 | 1.85 (1.07) | 1.84 (1.01) | 1.83 (1.01) | 1.96 (1.03) | 2.19 (1.51) |
| luna-23 | 60 | 4.82 (3.76) | 4.46 (3.11) | 3.89 (2.98) | 3.27 (2.07) | 3.31 (2.58) |
| luna-24 | 79 | 2.35 (1.25) | 1.95 (1.14) | 2.02 (1.35) | 2.64 (1.56) | 3.65 (2.06) |
| change-4 | 94 | 2.55 (1.52) | 2.54 (1.45) | 2.54 (1.43) | 2.53 (1.58) | 3.05 (1.38) |
| slim | 172 | 1.84 (1.08) | 1.78 (1.04) | 1.72 (1.03) | 1.67 (1.06) | 1.85 (1.23) |
| change-6 | 43 | 1.18 (0.60) | 1.02 (0.48) | 0.97 (0.38) | 0.83 (0.33) | 1.02 (0.52) |
| blue-ghost-1 | 105 | 2.28 (1.35) | 2.15 (1.28) | 1.79 (1.24) | 1.77 (1.13) | 1.97 (1.43) |
| **B better than stored, RMS (median)** | | | **16 (17) of 17** | **15 (14)** | **10 (13)** | **6 (8)** |

Chang'e 3 has too few shots inside the model to fix its offset; Chang'e 5 has none at all.

- **With W = 129 m**, the RMS falls by 0.15 m on average. The largest falls are Luna 23
  (0.93 m), Blue Ghost (0.49 m), Luna 24 (0.33 m) and Apollo 14 (0.28 m). B is worse at
  Apollo 16 (by 0.21 m) and Surveyor 7 (by 0.02 m).
- **With W = 64.5 m**, the average fall is 0.10 m and B is never worse by more than 0.01 m.
- **Where B moves the skyline most** (section 2), LOLA shots inside the 129 m ring lie within
  15 deg of that azimuth at two sites only: Luna 16 (6 shots) and Blue Ghost (11). There B is
  closer to LOLA at 14 of 17 shots; the median error falls from 0.131 deg to 0.071 deg of
  elevation as seen from the site. At the other sites with large moves (Apollo 11, Apollo 12,
  Luna 21, Luna 23, Luna 24, Chang'e 3, Chang'e 5), no LOLA shot can test them.

## 2. Skylines and events, observer 2 m up, stored against B (W = 129 m)

The app's `computeHorizon`, 1 440 azimuths. Events are every sunrise and sunset (last limb) in
the 30 days after each landing, from the app's `analyseWith`. "Any date" is the largest
skyline change over the azimuths where the Sun can rise or set, in minutes of its fastest climb.
It is the same measure that gives the rejected easing's 20 min at Blue Ghost and 12 min at
Luna 23. For B too it is the effect of a modelling choice, not an uncertainty.

| Site | Largest change | Azimuth | Skyline there: stored -> B | RMS | Moved > 0.01 deg | Events moving > 1 min | Any date: sunrise / sunset | Ring built in |
| --- | ---: | ---: | --- | ---: | ---: | --- | --- | ---: |
| luna-23 | -0.356 deg | 274.50 | -0.001 at 782 m (60 m window) -> -0.357 at 11.6 km (480 m window) | 0.043 | 5.8 % | none | 0 / 19.9 min | 14 ms |
| change-3 | -0.297 | 42.00 | -0.113 at 1 049 m (60 m window) -> -0.410 at 1 148 m (B ring) | 0.032 | 3.1 % | none | 0.1 / 0.1 | 16 |
| blue-ghost-1 | -0.281 | 339.25 | 0.511 at 834 m (60 m window) -> 0.230 at 834 m (B ring) | 0.047 | 15.4 % | none (sunset 16 Mar 2025 -0.8 min) | 0.8 / 0.9 | 17 |
| luna-16 | -0.256 | 135.00 | 0.921 at 1 103 m (60 m window) -> 0.666 at 1 188 m (B ring) | 0.036 | 7.4 % | none | 0 / 0 | 22 |
| luna-24 | -0.227 | 77.50 | 0.712 at 799 m (60 m window) -> 0.485 at 3 320 m (60 m window) | 0.033 | 4.4 % | none | 0 / 0 | 19 |
| apollo-11 | -0.139 | 335.25 | -0.019 at 858 m (60 m window) -> -0.158 at 756 m (3 m model) | 0.013 | 2.9 % | none | 0 / 0.1 | 35 |
| change-5 | -0.090 | 91.00 | -0.219 at 841 m (60 m window) -> -0.309 at 867 m (B ring) | 0.010 | 4.7 % | **sunrise 26 Dec 2020 14:32 UTC, 13.1 min earlier** | 14.5 / 0 | 15 |
| apollo-12 | +0.077 | 94.00 | 0.116 at 1 262 m (60 m window) -> 0.193 at 782 m (B ring) | 0.009 | 5.0 % | none | 0 / 0 | 44 |
| luna-21 | -0.077 | 261.75 | 0.895 at 849 m (60 m window) -> 0.817 at 888 m (B ring) | 0.009 | 3.1 % | **sunset 24 Jan 1973 02:15 UTC, 3.3 min later** | 0.1 / 9.6 | 20 |
| change-6 | -0.049 | 313.25 | -0.024 at 1 139 m (60 m window) -> -0.074 at 1 149 m (B ring) | 0.004 | 1.2 % | none | 0.1 / 0 | 24 |
| the other 9 | 0.002 to 0.006 | | formed kilometres out | 0.000 to 0.001 | 0 | none (all within 0.2 min) | up to 0.2 | 15 to 94 |

Where B lowers the skyline, the stored skyline was formed on the 60 m window just beyond the
edge, and the model was lower than the window at the nearest edge point. B pulls that ground
down towards the model's edge, and the skyline is then formed farther out or inside the model.
At Luna 23 (azimuth 274.5) it drops past the horizontal to a ridge 11.6 km away.

**Blue Ghost, 16 March 2025** (Sun at azimuth 269.7 to 269.95 deg):

| Observer | Stack | Skyline starts to cut the Sun | Last limb gone |
| --- | --- | --- | --- |
| 2 m up | as stored (in use) | 18:24 UTC | 19:30:18 |
| 2 m up | option B | 18:24 | 19:29:33 |
| 2 m up | eased (T-32, for comparison) | 18:37 | 19:43:03 |
| 3.5 m up | as stored | 18:38 | 19:44:11 |
| 3.5 m up | option B | 18:38 | 19:43:11 |
| 3.5 m up | eased | 18:50 | 19:55:48 |

(The stored last limb is 7 s later than in T-32-verification.md, section 2: this branch now
carries @analysis's 1289083 / 5ad5d1f near-field search from integration.)

B barely moves this sunset. The skyline the Sun sets behind is formed on the model's own edge,
which B keeps, and the ground beyond that B raises still stands lower than the edge as seen
from the site. The LOLA track 64 to 82 m out (`T-32-verification.md`, section 3) is in line with
that.

With W = 64.5 m, only the LOLA comparison was run (section 1): better than the stored grids
at 16 of 17 sites by RMS and at 17 of 17 by median, an average fall of 0.10 m. Its skylines and
events were not computed. The shared CPU lock was taken by this team's hand-over checks, and
D-9 (rule 5) keeps exploratory runs out of the queue meanwhile. The same step fades out over
half the distance, so its moves should be smaller than those above; that is an expectation, not
a measurement. `node scripts/terrain-seams-option-b.mjs --band 64.5` gives them in about three
minutes.

## 3. The surface view

The view eases the drawn 3 m model onto the 60 m window over the model's outer 129 m
(`blendEdge(fine, this.coarse[0])`, `src/scene/surface.ts:485`).

- **Under A (now)**, the drawn ground in that band is T-32's eased ground, while the analysis
  uses the stored model. Drawn minus analysed: up to 4.8 to 25.5 m at single points (the step
  at the edge, SLIM the largest), 1.0 to 2.6 m RMS over the band. The drawn skyline is up to
  0.17 deg below the analysed one: Blue Ghost -0.166 deg at 274.5 (the sunset direction),
  Apollo 12 -0.143 at 352.75, Luna 23 -0.141 at 86.25, Chang'e 3 +0.113 at 45.0, Apollo 11
  -0.094, Chang'e 5 -0.075, Chang'e 6 +0.055.
- **Under B with the view unchanged**, the band differs as under A. In addition the view draws
  the plain 60 m window in the ring, where the analysis has B: up to 4.8 to 21 m, 0.8 to 2.6 m
  RMS over the ring. The drawn skyline then misses the analysed one by up to 0.36 deg: Luna 23
  +0.356 at 274.5, Chang'e 3 +0.297, Blue Ghost +0.281 at 339.25, Luna 16 +0.256, Luna 24 +0.227.
  That is worse than now.
- **Under B with the same rule in the view**, the drawn ground is the analysed ground (up to
  the view's own interpolation) and the mismatch is gone, inside the band and in the ring.

**What original @surface would have to change for B** (lines on am/lunyx/integration 6c7b94c):

1. `src/scene/surface/groundSource.ts:22`: the fine level `{ n: 513, spacing: 3 }` must reach
   over the ring (`n: 599`, 897 m each way), so that the 3 m mesh carries the ring.
2. `src/scene/surface/groundSource.ts:125-131`: the exact-window copy no longer matches (599
   against 513). The resampled path takes the model and the ring from the stack, provided that
   `isSurvey` (line 255) counts the ring as part of the survey (its resolution is the model's).
   The coverage note and bands that follow (lines 256-276) would then count the ring as survey.
3. `src/scene/surface.ts:485`: `blendEdge(fine, this.coarse[0])` stays. On the larger grid it
   acts 897 m out, where B already equals the 60 m window, so it does almost nothing; it can
   also go.
4. `src/scene/surface.ts:502-507` (`uvAt` in `buildLevel`): an image drape is mapped over the
   whole fine grid. The orthophoto covers the model's square only (768 m each way), so the
   mapping must be limited to that square and the ring given the context imagery. This is the
   delicate part.
5. The photo-derived detail (`detailAt` in `src/scene/surface/ground.ts`) already fades out at
   its own square, so it needs nothing.

## 4. Cost

- **Terrain module** (`src/terrain/api.ts`, `src/terrain/types.ts`):
  - the ring builder, about 40 lines (`ringDescriptor` in the prototype);
  - inserting the ring after each model in the stack, and keeping the last rings, as is done
    for the eased copies;
  - the seam record and notes (the model's edge no longer steps; `TerrainSeam` would describe
    an edge eased outwards);
  - SEAM_EVENT_MINUTES measured again (section 2: Luna 23 sunsets, Chang'e 5 sunrises and
    Luna 21 sunsets become the sites above a minute; Blue Ghost and Luna 23 sunrises fall
    under one).
  
  About 100 lines of code and 100 of tests.
- **Load time**: building a ring took 14 to 94 ms per site (median 22 ms) on this machine,
  once per site and thread. Memory is 1.4 MB per ring.
- **Consumers**: the analysis needs nothing (it is one more grid in the stack); the surface
  view needs section 3; the independent validator's reader would need the rule (as for T-32's
  easing).
- **Numbers that would move**: the skylines and events of section 2.

## Why no-go, in one paragraph

The step at the 3 m edge is the 60 m window's error (`T-32-verification.md`), so B corrects
the right grid. But it can only guess how far the window's error reaches beyond the edge. LOLA
says the guess is right on average: 40 % of the step persists in the 129 m beyond the edge, and
B's error there falls at 15 of 17 sites. It does not say whether the guess is right in the
directions that matter. B's largest skyline moves (0.2 to 0.36 deg) and its new event moves (10
to 20 minutes) fall where LOLA has no shots. A keeps the measured grids and states the seam,
its sensitivity (about 9 minutes per metre at the edge) and, at Blue Ghost, the two products'
spread (3.5 to 3.7 minutes). B would replace the known step with an extrapolation whose error
beyond the edge is unmeasured at the azimuths that matter. It also needs @surface's work to
keep the picture with the analysis. If the
seam is to be removed later, the evidence points to B with a narrow band (64.5 m: better than
the stored grids at every site with LOLA data), together with the view change, and with the
event-time note kept, because the window's error beyond the edge remains unmeasured there.
