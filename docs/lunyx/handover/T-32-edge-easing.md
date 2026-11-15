# T-32 handover: the 3 m site models meet the 60 m windows without a step

Owner: @ice-targets. Code in `src/terrain/api.ts` (`easeStack`, `measureSeams`, `handOvers`, `storedGrid`),
`src/terrain/types.ts` (`TerrainSeam`), tests in `src/terrain/api.test.ts` ("where one grid
hands over to the next"), report script `scripts/terrain-seams.mjs`. No data file changed.

## What changed

`loadTerrainFor(site)` now returns a stack in which each 3 m LROC NAC model is eased onto the
60 m window around it. Within 129 m of the model's edge (43 samples: a twelfth of the grid)
its heights move along the smooth step `t*t*(3 - 2t)` from the model's own to the window's; at
the edge they are the window's. This is the surface view's `blendEdge`, with the same band
and the same weights. A test applies the view's own function to the stored grids of all 19
sites and compares: the largest difference is under 2 mm.

- The files in `public/terrain/` are untouched. Easing happens when a stack is loaded; the
  stored grid is kept and an eased grid is a copy (1 MB; kept for the last 8 stacks asked for).
- `loadTerrainFor(site, { easeEdges: false })` returns the grids as stored.
- `storedGrid(source)` gives the stored grid behind an eased one (any other source is returned
  as it is).
- `stack.seams` lists every hand-over the stack really crosses, nearest first: `inner`,
  `outer`, `distanceM`, `minM`, `maxM`, `rmsM` (the mismatch as the stack has it now, outer
  minus inner, both read at the same points of the edge), `degPerMetre`, and for an eased edge
  `eased: { overM, minM, maxM, rmsM }` with the mismatch before easing.
- `stack.notes` says the same in words, and the eased model's `provenance.processing` ends
  with "When loaded: within 129 m of its edge the heights are eased onto the 60 m window, ...".
- A pin that borrows a neighbouring site's 3 m model (within 768 m of a catalogued site) gets
  the same eased model; its seam is listed at its true distance from the pin.

## Which layer is the reference, and why

The 60 m window. Three reasons, in this order:

1. All the ground beyond the model's edge comes from the 60 m window and from the grids
   around it (480 m window, polar layers, whole-Moon grid), which are all in the LOLA frame.
   A step can only be removed without moving everything outside by moving the model.
2. The model is a separate measurement. It is an LROC NAC stereo model, and the bundle ties
   it to the 60 m window by one constant only: `scripts/fetch-apollo-terrain.mjs` subtracts
   the mean difference over the overlap (which is why the independent check found a mean
   within 0.02 m of zero at every site) and fills the model's gaps from the 60 m window.
   Tilts and local offsets of several metres between the two remain (the same check: 1.8 to
   3.9 m standard deviation over the overlap).
3. With a step, the skyline at the edge is the higher of the two disagreeing grids, whichever
   that happens to be. Eased, it is the window's on both sides of the edge.

What easing does not do: decide which measurement is right. The two still disagree by the
"as stored" figures below. Inside the eased band the heights are a blend of both, the model's
finest relief fades out, and a skyline point formed there is uncertain by about 0.075 degrees
per metre of height. The notes say so.

## The seam at all 19 sites, before and after

3 m model against the 60 m window along the model's edge (768 m from the site in the
cardinal directions), metres, 60 m window minus 3 m model, 2 048 points per site.
From `node scripts/terrain-seams.mjs`.

| Site | As stored: lowest | highest | RMS | In the stack now: lowest | highest | RMS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| surveyor-3 | -4.8 | +3.9 | 1.4 | 0.0 | 0.0 | 0.0 |
| surveyor-7 | -4.8 | +6.8 | 1.6 | 0.0 | 0.0 | 0.0 |
| apollo-11 | -7.4 | +17.6 | 3.6 | 0.0 | 0.0 | 0.0 |
| apollo-12 | -4.9 | +9.7 | 1.8 | 0.0 | 0.0 | 0.0 |
| luna-16 | -5.0 | +13.9 | 3.3 | 0.0 | 0.0 | 0.0 |
| apollo-14 | -6.3 | +6.5 | 2.3 | 0.0 | 0.0 | 0.0 |
| apollo-15 | -8.5 | +7.4 | 1.8 | 0.0 | 0.0 | 0.0 |
| luna-20 | -5.6 | +10.5 | 2.6 | 0.0 | 0.0 | 0.0 |
| apollo-16 | -5.5 | +15.0 | 2.7 | 0.0 | 0.0 | 0.0 |
| apollo-17 | -7.4 | +21.1 | 3.6 | 0.0 | 0.0 | 0.0 |
| luna-21 | -9.1 | +8.5 | 3.2 | 0.0 | 0.0 | 0.0 |
| luna-23 | -5.9 | +16.2 | 4.2 | 0.0 | 0.0 | 0.0 |
| luna-24 | -6.3 | +12.5 | 3.4 | 0.0 | 0.0 | 0.0 |
| change-3 | -9.6 | +8.3 | 3.1 | 0.0 | 0.0 | 0.0 |
| change-4 | -5.2 | +18.7 | 4.3 | 0.0 | 0.0 | 0.0 |
| change-5 | -9.9 | +8.9 | 2.9 | 0.0 | 0.0 | 0.0 |
| slim | -6.5 | +17.6 | 3.2 | 0.0 | 0.0 | 0.0 |
| change-6 | -9.3 | +7.5 | 3.1 | 0.0 | 0.0 | 0.0 |
| blue-ghost-1 | -6.1 | +7.7 | 2.9 | 0.0 | 0.0 | 0.0 |

"0.0" is exact to the rounding of the table: at the edge the eased model holds the window's
heights (largest difference at any edge node of the 19 sites: 0.25 mm). The "as stored"
columns agree with the independent check's table (T-26,
`tests/fixtures/validation/ephemeris-check/terrain/seams.txt`) within 1.5 m at every site;
that check reads 1.5 m either side of the edge every 6 m, this one reads both grids at the
edge every 3 m. A test holds the two tables against each other.

## What moves in the results

Skyline for an observer 2 m up (1 440 azimuths), stored stack against the eased one, and
sunrise and sunset (last limb) in the 30 days after each landing:

| Site | Largest skyline change | RMS | Azimuths moved by > 0.01 deg | Skyline formed on the model's edge: before | after | Sunrise / sunset |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| blue-ghost-1 | -0.166 deg | 0.026 | 11.3 % | 5.9 % | 0.1 % | sunset 16 Mar 2025 19:30 -> 19:43 UTC (+13.0 min) |
| apollo-12 | -0.143 | 0.015 | 4.9 % | 2.1 % | 0.0 % | unchanged |
| luna-23 | -0.141 | 0.013 | 3.2 % | 0.2 % | 0.1 % | sunrise 16 Nov 1974 19:00 UTC, 0.9 min earlier |
| change-3 | +0.114 | 0.007 | 0.9 % | 0.6 % | 0.1 % | unchanged |
| apollo-11 | -0.094 | 0.008 | 1.7 % | 0.0 % | 0.0 % | unchanged |
| change-5 | -0.075 | 0.003 | 0.2 % | 0.4 % | 0.2 % | unchanged |
| change-6 | +0.055 | 0.003 | 0.6 % | 0.7 % | 0.3 % | unchanged |
| change-4 | -0.041 | 0.003 | 1.0 % | 0.6 % | 0.0 % | unchanged |
| luna-24 | -0.034 | 0.001 | 0.3 % | 0.0 % | 0.0 % | unchanged |
| surveyor-7 | -0.016 | 0.001 | 0.1 % | 0.0 % | 0.0 % | unchanged |
| the other 9 | 0 | 0 | 0 % | 0 to 0.1 % | same | unchanged |

Sites without a 3 m model do not change at all: their stacks are the stored grids, the same
objects as before.

**Blue Ghost, 16 March 2025** is the one event that moves by more than a minute. Due west of
the lander the model's edge stood 1.6 m above the 60 m window and formed the skyline (0.594 deg
at 768 m, azimuth 270). Eased, the skyline there is the 60 m window's ground just beyond the
edge (0.492 deg at 839 m).

| Observer | Stack | Skyline starts to cut the Sun | Last limb gone |
| --- | --- | --- | --- |
| 2 m up | as stored | 18:25 UTC | 19:30 |
| 2 m up | eased | 18:38 | 19:43 |
| 3.5 m up | as stored | 18:39 | 19:44 |
| 3.5 m up | eased | 18:50 | 19:56 |

(one-minute samples of the visible part of the disc, Horizons table.) Firefly's published start
of night, about 18:15 to 18:35 UTC, is the first of these two instants (T-26 and decision D-8,
which quote 18:23 for the build before this change). The stored grids put it inside that range
at 2 m, the eased ones 3 minutes after its end. This does not decide which grid is right:
Firefly does not define its term, and 1.5 m of observer height moves the time as much as the
easing does. It does mean that the one published time there is does not support the easing.
Either way the sunset at this site is known to about a quarter of an hour from the elevation
data, and `stack.notes` states the 0.075 deg per metre that causes it.

## What is not eased, and why

Only a separately measured model is eased. The other hand-overs are the same frame at a
coarser sampling: a 60 m window meeting a 480 m window (every 8th sample of the same
product) or a polar layer, and a 480 m window meeting the whole-Moon grid (1.9 km cells).
There the mismatch is relief the coarser grid misses, the finer grid is right up to its edge,
and easing it would replace real ridges by the coarser grid's straight lines between samples.

This was measured, not assumed. With the 60 m windows eased onto the 480 m windows as well
(the first version of this work), the computed skyline dropped at 19 of the 28 sites: by
0.40 deg at Apollo 15, 0.37 deg at Luna 9, 0.26 deg at Apollo 14, and by up to 0.17 deg at
the others (observer 2 m up, 720 azimuths). The largest change was downward at every one of
them. A test repeats the Apollo 15 measurement with the surface view's own `blendEdge`.

These hand-overs stay in `stack.seams` and in the notes ("Hand-overs left as stored: ..."),
with their figures. The mismatch along such an edge is also a direct sample of how much relief
the coarser grid misses from there on.
`node scripts/terrain-seams.mjs --all` lists all 74 hand-overs of the 28 sites: 19 eased, and
55 not (60 m to 480 m window at 26 sites, 3 to 13 m RMS, up to 74 m at single points at
Apollo 15; 60 m window to a polar layer at IM-1 and IM-2, 1.9 and 0.7 m RMS; 480 m window to
the whole-Moon grid at 27 sites, 4 to 92 m RMS).

## For the surface view (@surface)

- At the 3 m edge the picture and the analysis now rest on the same ground. That was the
  picture's ground already; the analysis has moved onto it.
- `groundFromStack` copies the stack's exact windows and `surface.ts` then calls `blendEdge`
  on the copies. The 3 m window in the stack is now eased already, so the copy is eased twice:
  the weight becomes `2w - w*w` instead of `w`. Measured at the 19 sites, the second pass
  moves the drawn model away from the analysed one by 0.2 to 0.6 m RMS over the band and by
  up to 6.7 m at single nodes (SLIM). One line avoids it: copy from
  `storedGrid(stack.sources[exact])` in `sampleLevel`'s exact-window branch. The view's own
  blending then gives exactly the heights the analysis uses (the test above).
- The view also eases its 60 m level onto its 480 m level and that onto its 1 920 m level.
  The analysis stack does not, for the reason in the section above, so between 3.18 and
  3.84 km (and 25.4 to 30.7 km) the drawn ground is pulled towards the coarser grid while the
  analysed ground keeps the finer heights. On the skyline the first of these is the "up to
  0.40 deg" quoted above, at the azimuths where a ridge stands in that band; the second was
  not measured.

## For the independent check (@ephemeris-check)

`check0b_layer_seams.py` reads `public/terrain/*.bin` with its own reader. Those files are
unchanged, so run as it is it will print the same table as before. To check the ground the
analysis uses:

- `node scripts/terrain-seams.mjs --heights IN.json --out OUT.json` returns, for a list of
  `[lat, lon]` points at a site, the height the app uses, the height of the stored grids and
  the source that answered. `--json` gives the seam table as data.
- The rule to reimplement, if the check should stay independent of the app: for the 3 m grid
  (513 x 513 at 3 m), every node within 43 samples of the edge moves to
  `h + (h60 - h) * t*t*(3 - 2t)`, `t = 1 - fromEdge / 43`, `fromEdge` the node's distance in
  samples from the nearest edge of the square, `h60` the 60 m window read bilinearly at the
  node. Nothing else changes.
- Reference skylines built from the stored files will now differ from the app's at the 10
  sites in the table above, by the amounts in it.

## Limits

- The disagreement between the two products is still there; it has been spread over 129 m.
- A polar layer that ends inside a site's 480 m window (IM-1: the 160 m layer ends 4 km north
  of the site) is a hand-over too. It is not measured or listed: `seams` covers the edges of
  the square site grids only.
- An eased model is a second copy of the grid in memory (1 MB) for each of the last 8 stacks
  asked for, in each thread that loads terrain.
- A stack asked for with `easeEdges: false` says so in its notes ("Edge easing was switched
  off for this request ..."), so those notes are not the ones to show beside a picture or a
  result that does ease.
- The band is the surface view's (a twelfth of the grid). If `blendEdge` changes, the test
  that compares the two fails, which is the point of it.

## Verified

- `npm run build` and `npm test` (see the task result for the counts of the last run).
- `src/terrain/api.test.ts`, "where one grid hands over to the next": 6 cases. Stored
  figures against the independent table at 19 sites; no step left at 19 sites; equality with
  the surface view's `blendEdge` at 19 sites; heights unchanged outside the band, the
  window's at the edge, half of each in the middle; the stored grid still equal to the file;
  an eased grid survives a structured clone; IM-2, IM-1, a pole pin and a pin beside
  Apollo 11; the Apollo 15 measurement behind "what is not eased".
