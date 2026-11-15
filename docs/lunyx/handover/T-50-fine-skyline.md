# T-50 A finer skyline where a disc rises or sets: handover (@globe)

Branch am/lunyx/agent/globe. Code in @analysis's paths, by the coordinator's assignment:
`src/analysis/fineSkyline.ts` (new), `horizon.ts` (`skylineAt`, an `azimuthsDeg` option),
`window.ts` (`analyseWith`), `types.ts` (`HorizonProfile.fine`).

## What changed

The main profile still reads the skyline every 0.5 deg of azimuth, as before and at the same
cost. Then, from that profile and the window's own ephemeris, `nearSkylineRanges` finds every
sample where the Sun's or Earth's disc comes within 0.25 deg of the skyline under it (its own
azimuth span widened by 0.3 deg; each such sample's neighbours too, for the motion between
samples). Over those azimuths the skyline is read again, every 0.05 deg, by the same ray march
with the same options (`fineSkyline`), and the segments are put on the profile
(`HorizonProfile.fine`). `skylineAt()` reads a fine segment wherever one covers the azimuth.

Everything downstream reads the skyline through `skylineAt()`, so all of it uses the fine skyline
where a disc meets the skyline: visible fractions, events, both ends of each passage, the metrics,
DSN station geometry and `blockageAt`. Nothing else changed. The 0.25 deg margin is more than ten
times the largest skyline error the validation put on the azimuth step (0.019 deg).

- The analysis' assumptions say it: "Where the Sun's or Earth's disc comes near the skyline in
  the window, it is read every 0.05 deg (N more directions) ...".
- `analyseWith(..., { fineSkyline: false })` gives the main profile only (tests, comparisons).
- Unchanged and on the main profile only: the seasonal outlook (`outlook.ts`) and the nearby scan
  (`nearby.ts`). `outlook.test.ts` now compares the outlook with `analyseWith` on the main profile.
  On the fine skyline, IM-2's darkness in one lunar day moved by 7.5 min, beyond that test's
  0.1 h limit.

## Runtime

The analysis with passages (`analyseWith` + `withTransitions`), median of 5, Node, load 5.2 to 6.5:

| Window | Main profile only | With the fine skyline | Fine rays |
| --- | --- | --- | --- |
| IM-2 (catalogue position), 14 days from 2025-03-06 17:28 UTC, 2 m, Horizons table | 284 ms | 343 ms (+60 ms, +21 %) | 286 |
| Shackleton-rim pin (-89.78, -155.73), same 14 days, model | 280 ms | 307 ms (+26 ms, +9 %) | 78 |
| Blue Ghost 1, 15 days | | | 32 |
| IM-2 pin, 60 days (validator's window) | 866 ms | 1052 ms (+21 %) | 1063 |
| Connecting-ridge pin, 60 days | 666 ms | 1616 ms (+143 %) | 3614 |

The main profile alone (720 rays) takes 150 ms at IM-2 on that run. The cost grows with how much
of the window the discs spend skimming the skyline. The worst case is a polar pin over 60 days,
whose Sun stays near the skyline for days at a time.

## The validator's worst cases, before and after

Validator: lunyx-science T-3 (bca1ff0),
`tests/fixtures/validation/ephemeris-check/transitions/results-9bc4878.txt`. Same pins, 2 m,
60 days from 2025-03-01, model ephemeris. App minus reference:

| Instant | Reference (UTC) | Main profile | Fine skyline |
| --- | --- | --- | --- |
| IM-2 pin (-84.79, 29.2): the Sun's centre rising, 6 March (the worst, 0.0185 deg) | 00:32:49 | +464 s | -5 s |
| the same passage, whole disc clear | 03:38:08 | -146 s | -6 s |
| Connecting-ridge pin (-89.45, -137.2): Earth's first limb rising, 23 April (0.0140 deg) | 12:42:43 | +835 s | +47 s |
| the same passage, whole disc clear / centre | 20:53:02 / 05:00:26 | -262 / +175 s | +19 / +16 s |
| the Sun setting 12 April: first cut / centre / last limb | 04:32:00 / 06:16:59 / 08:41:45 | -152 / +111 / +341 s | -13 / -12 / -45 s |
| East-limb pin (0, 90): the Sun rising 29 March, first limb / centre / whole clear | 06:21:15 / 06:52:47 / 07:24:20 | +60 / +62 / +63 s | +4 / +6 / -3 s |
| IM-2 pin: the Sun's centre setting 17 April | 20:46:13 | +410 s | -31 s |

What is left are differences of a few minutes on Earth's slow passages and on the 50-hour sunrise at
the connecting ridge. For example, Earth's last limb at IM-2 on 20 March went from -803 s to -260 s.
Converted with the rates implied by the validator's own scoring, they come to about 0.003 deg of
skyline or less. The validator's own run with its skyline read every 0.5 deg left 0.004 deg, so the
rest is the difference between the two ray marches, not the azimuth step. Full lists:
`docs/lunyx/handover/T-50-worst-cases.txt` (all instants, main profile and fine skyline, at the three pins).

Blue Ghost (15 days, catalogue position) moves by seconds: first cut 18:24:23 -> 18:24:14, last limb
19:30:47 unchanged. At the old pin the first cut stays at 18:23:36 (validator 18:23:40). The
eclipse instants do not depend on the skyline and are unchanged.

## Tests

`src/analysis/fineSkyline.test.ts`:
- reading a segment: inside, outside, across north; merging ranges;
- on real terrain: fine rays on the main profile's azimuths are identical to its samples; at IM-2
  over 14 days, every instant of both passages lies in a fine range, a few hundred rays, the
  assumption sentence;
- the validator's worst cases above: before more than 400 s / 800 s off, after within 60 s (IM-2
  Sun centre, connecting-ridge Earth first limb and the 12 April sunset end), and within 15 s at the
  east limb.

All of src/analysis, src/core, src/science and src/ui/science pass (31 files, 335 tests).
