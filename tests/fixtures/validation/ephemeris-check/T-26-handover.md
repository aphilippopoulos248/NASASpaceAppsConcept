# T-26 handover: independent end-to-end validation

For whoever reviews or integrates this. Findings, methods and tables are in `README.md`; the
numbers behind them are in `*/results.txt` and `*/results.json`.

## What to integrate

Branch `am/lunyx/agent/ephemeris-check` (contains integration 375f816). Only
`tests/fixtures/validation/ephemeris-check/` is added: 4.5 MB, largest file 0.25 MB. Nothing in
`src/`, `scripts/`, `public/` or `package.json` is touched, and nothing here is run by
`npm test` or the build.

## What was tested

Two builds, side by side: the integrated one (375f816) and a read-only snapshot of
`am/lunyx/agent/analysis` at ecc9793 (not merged). The second was tested because it holds the
skyline fix; its results are the `app-analysis*.json` files.

## Findings that need a decision

1. **The integrated skyline reads low near the observer.** Up to 1.04 deg at a Shackleton rim
   pin with a 2 m mast (381 of 720 azimuths over 0.1 deg), 0.27 deg at the connecting ridge
   pin. Consequences measured on the integrated build: Earth visibility +2.0 points at the rim
   pin with Earthrise and Earthset six hours off; +1.2 points and up to 7.7 hours at a
   west-limb pin that has only the 1.9 km grid; Chandrayaan-3 sunset 6.6 min late. The fix on
   @analysis's branch brings the skyline within 0.05 deg and every metric within 0.05 points at
   2 m. **Merging it is what makes the polar numbers trustworthy.**
2. **On the ground (mast 0 m) the fix is not enough.** The slope at the observer's feet is the
   skyline on convex ground; the fixed build starts 12 m out and reads up to 1.2 deg low
   (connecting ridge pin, rim top), which is +4.7 points of 18.6-year sunlight at the
   connecting ridge pin. The integrated build is up to 5.0 deg low and +30.8 points there. With
   a 2 m mast this does not arise. Either the skyline should include that slope, or the app
   should not offer 0 m.
3. **"Sunset" at Blue Ghost.** The app's sunset is the last limb (19:30 UTC at 2 m); Firefly's
   published figures put the start of night at about 18:15-18:35 UTC, which is when the skyline
   first cuts the Sun (18:23). Both are defensible. If the product quotes one time, it should
   say which.
4. **Chandrayaan-3 sunrise.** ISRO's "next sunrise expected on September 22, 2023" is two days
   after first light over the skyline by both computations (19 September 23:57 UTC). Do not
   present the app's time as confirmed by ISRO.
5. **Layer seam.** The 3 m site models and the 60 m windows step by several metres where they
   join, 768 m from each landing site. At Blue Ghost that edge forms the skyline exactly where
   the Sun sets; the two layers differ by 0.12 deg there, about 15 minutes of sunset time.

## What agrees

- The bundled LOLA grids equal the PDS originals within rounding at 30 080 samples.
- The app's event and metric logic: fed the same skyline it reproduces my Earth visibility to
  0.02 points; sunsets within 20 s; eclipse totality within 6 s.
- Three-way agreement at IM-2 over 18.6 years: PGDA 46.55 %, own 46.35-46.71 %, app
  46.31-46.69 %. Shackleton's floor is permanently dark in all three.
- Two metres up on PGDA's brightest crest pixels, own and app are within 1.4 points of PGDA.
- Blue Ghost eclipse times published by Firefly: within 0.8 min.
- The Apollo Lunar Surface Journal table: 42 of 43 rows.

## Not done, and limits

- No published time was found for IM-2, or for sunset at Apollo 15.
- The site windows were not compared with their PDS sources (only the `.lxg` grids were).
- The longest darkness over 18.6 years was not recomputed independently.
- PGDA on crests cannot settle anything point by point: its own neighbouring pixels differ by
  tens of points.
- Checks 0 and 2-4 need network or cached downloads to re-run from scratch (PDS, Horizons,
  PGDA rasters, SPICE kernels); the stored inputs let checks 1, 2 and 4 re-run offline.
- The reference is only as good as the bundled elevation data. Agreement with it says the app
  computes correctly from that data, not that a 40 m grid describes a rim crest to the metre.
