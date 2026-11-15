# T-26 handover: independent end-to-end validation

For whoever reviews or integrates this. Findings, methods and tables are in `README.md`; the
numbers behind them are in `*/results.txt` and `*/results.json`.

## What to integrate

Branch `am/lunyx/agent/ephemeris-check` (contains integration 4f007f1). It adds
`tests/fixtures/validation/ephemeris-check/` (4.3 MB, largest file 0.25 MB) and two small result
files under `tests/fixtures/horizons/ephemeris-check/results/`. Nothing in `src/`, `scripts/`,
`public/` or `package.json` is touched, and nothing here is run by `npm test` or the build.

On the merged tree `npm run build` passes and `npm test` passes (391 passed, 3 skipped, and
the 10 science tests).

## What was tested

Two builds: integration at 375f816 (when the task started) and at 4f007f1 (now). The skyline
fix by @analysis was merged between the two (a7b4e70), so the comparison shows the defect and
its repair. Before the merge the fix was tested from a read-only snapshot of @analysis's branch
(ecc9793); the current integration returned identical numbers in all 38 runs.

## Still open: needs a decision

1. **Observer on the ground (mast 0 m).** The slope at the observer's feet is the skyline on
   convex ground. The current build starts sampling 12 m out and reads up to 1.2 deg low there
   (connecting ridge pin, rim top), which is +4.7 points of 18.6-year sunlight at the connecting
   ridge pin. With a 2 m mast it does not arise. Either the skyline should include that slope,
   or the app should not offer 0 m. Reproduction: `skyline/results.txt`, the `@0m` blocks.
2. **"Sunset" at Blue Ghost.** The app's sunset is the last limb (19:30 UTC at 2 m). Firefly's
   published figures put the start of night at about 18:15-18:35 UTC, which is when the skyline
   first cuts the Sun (18:23). Both are defensible. If the product quotes one time, it should
   say which.
3. **Chandrayaan-3 sunrise.** ISRO's "next sunrise expected on September 22, 2023" is two days
   after first light over the skyline by both computations (19 September 23:57 UTC). Do not
   present the app's time as confirmed by ISRO.
4. **Layer seam.** The 3 m site models and the 60 m windows step by several metres where they
   join, 768 m from each landing site. At Blue Ghost that edge forms the skyline exactly where
   the Sun sets; the two layers differ by 0.12 deg there, about 15 minutes of sunset time.
5. **"Earth visible" means Earth's centre.** PGDA's Earth map counts any part of the disc and
   is 4 to 5 points higher at the pole and 11 higher at IM-2, by definition. Worth one line
   wherever the two are shown together.

## Closed by the merge of @analysis's fix

Before it (375f816) the skyline read low near the observer: up to 1.04 deg at a Shackleton rim
pin with a 2 m mast (381 of 720 azimuths over 0.1 deg) and 0.27 deg at the connecting ridge pin.
Measured consequences: Earth visibility +2.0 points at the rim pin with Earthrise and Earthset
six hours off; +1.2 points and up to 7.7 hours at a west-limb pin that has only the 1.9 km grid;
Chandrayaan-3 sunset 6.6 min late. Now (4f007f1): skyline within 0.05 deg and every metric
within 0.05 points at 2 m; rise and set times within 23 minutes.

## What agrees

- The bundled LOLA grids equal the PDS originals within rounding at 30 080 samples.
- The app's event and metric logic: fed the same skyline it reproduces my Earth visibility to
  0.02 points; sunsets within 20 s; eclipse totality within 6 s.
- Three-way agreement at IM-2 over 18.6 years: PGDA 46.55 %, own 46.35-46.71 %, app
  46.31-46.69 %. Shackleton's floor is permanently dark in all three.
- Two metres up on PGDA's brightest crest pixels, own and app are within 1.4 points of PGDA.
- Blue Ghost eclipse times published by Firefly: within 0.8 min.
- The Apollo Lunar Surface Journal table: 42 of 43 rows.
- T-18's sky fixture, re-run on the current integration as promised: `skyAt()` within
  0.0036 deg on all 1008 rows (`tests/fixtures/horizons/ephemeris-check/results/skyAt-integration-4f007f1.txt`).

## Not done, and limits

- No published time was found for IM-2, or for sunset at Apollo 15.
- The site windows were not compared with their PDS sources (only the `.lxg` grids were).
- The longest darkness over 18.6 years was not recomputed independently.
- @analysis's newer, unmerged work (T-29: seasonal outlook, tabulated model ephemeris) was not
  tested. `app_dump.mjs --root` on a snapshot does it in a few minutes when wanted.
- PGDA on crests cannot settle anything point by point: its own neighbouring pixels differ by
  tens of points.
- Checks 0 and 3 need network or cached downloads to re-run from scratch (PDS, PGDA rasters,
  SPICE kernels); the stored inputs let checks 1, 2 and 4 re-run offline.
- The reference is only as good as the bundled elevation data. Agreement with it says the app
  computes correctly from that data, not that a 40 m grid describes a rim crest to the metre.
