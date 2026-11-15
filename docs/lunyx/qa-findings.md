# QA findings: desktop walkthrough

Kept by @desktop-workflow (project lunyx-experience; tasks T-2, T-7, T-8). Desktop website
only (decision D-4): 1280x720 and 1920x1080. Each finding names the commit it was seen on,
its owner and a reproduction. Findings in other teams' code go to @coordinator, who relays
them to the owners; nobody here patches them.

Numbering: `Q-n` are findings of this walkthrough. `F-n` and `A-n` are the legacy findings in
`docs/lunyx/actions.md` and `docs/lunyx/accessibility.md`; they keep their numbers.

## Open

| # | Finding | Owner | Seen on | Status |
| --- | --- | --- | --- | --- |
| Q-1 | Filters > Centre of view, typed in the natural order (latitude, Tab, longitude, Enter): the latitude field is refilled with the centre of the still-flying camera when it loses focus, and the longitude commit sends that in-flight latitude, not the typed one. Typed 84.79° S, 29.2° E: the view ends at 57.43° S (830 km off) when typed quickly, 81.63° S (96 km) at 80 ms per key, 83.37° S (43 km) at 150 ms per key, and 84.67° S (3.6 km, F-3 twice) when the typist waits for the flight. | @globe | f928038, 2f7e813 | **fixed** upstream (original T-43, dbc6c59); exact on c366a06 (table below); regression test in `e2e/flow.test.mjs` |
| Q-2 | Typing both coordinates and pressing "Drop pin at centre" straight away pins wherever the camera is at the moment of the click, mid-flight, with the old longitude: typed 84.79° S, 29.2° E, pinned 55.92681° S, 0.06° W (879 km off) and 83.02705° S, 0.06° W (97 km off). | @globe | f928038, 2f7e813 | **fixed** upstream (T-43, dbc6c59); exact on c366a06; regression test |
| F-3 | (legacy, reported 2026-11-14) Poleward of 80.06° the fly-to clamps the camera direction, so the view stops short of the typed latitude and "Drop pin at centre" pins off the typed point, even when each field is committed with Enter and each flight is awaited: IM-2's 84.79° S, 29.2° E gives a pin at 84.67269° S (3.56 km off: the clamp once on the latitude, once more when the longitude commit re-sends the shifted latitude shown in the field); 89.45° S, 137.2° W gives 89.4315° S (0.56 km). The same at both poles; exact at 80° and below. | @globe | f928038, 2f7e813 | **fixed** upstream (T-43, a59162f: exact flights poleward of 80°); exact on c366a06; regression test |
| Q-4 | "Compare as B" in a ranked row of "Nearby sites" switches the panel to "A and B", which hides the button that had the focus: the focus falls to the page (`document.body`), so a keyboard user loses their place, and the next Escape closes the panel without giving the focus back to the launcher. Seen with the mouse (walkthrough) and with the keyboard only (`e2e/a11y.test.mjs`). | @analysis (`src/ui/compare/`) | 2f7e813, c366a06 | **fixed** upstream (original T-46, in 11f60b4); the e2e regression test passes on 8988bd0 |
| Q-5 | The default solar elevation band (0° to 90°) means "no band" in the compare panel since c331052 ("No requirement: no solar elevation band is set"), but the surface Key metrics still raise "Requirement not met … outside the required band (0° to 90°)" whenever the window includes a night (Apollo 11, 29.5-day window), and `getAnalysis` reports `requirements.sunElevationBand.metForWholeWindow: false`, which the assistant words as "The Sun leaves the required elevation band (0.0° to 90.0°) during the window". One app state, two answers. | @surface (`src/ui/surface/metricsModel.ts` `flags`), the owner of `src/core/analysisReport.ts` (`checkRequirements`); the assistant follows `getAnalysis` | 2f7e813 | **fixed** upstream (T-46, 11f60b4: `sunElevationBand.required` false at the default, no verdict); on 8988bd0 Key metrics shows no band flag (walkthrough dry run) and the JSON export says `required: false` with no verdict (dry run 2, 26/26 checks) |
| Q-6 | (adds to the original T-40, not a new defect) The polar elevation layers fail too, not only the whole-Moon grid: `lola_south_875s_40m.lxg`, `lola_south_85s_80m.lxg` and `lola_south_80s_160m.lxg` each failed with `net::ERR_CACHE_WRITE_FAILURE`: two of the three in each of four walkthrough page loads, one in the reproduction's (none in the e2e runs, whose requests go through Playwright's request interception). Then the site card names a coarser grid than the analysis beside it used (card "160 m grid", elevation 1,946 m; analysis 40 m layer, 1,948 m), or still says "Loading…" when the analysis is ready, and when the analysis's own copy fails it uses the 1.9 km grid for that distance range (skyline 0.01° different between two loads of the same pin). | owner of T-40 (@surface) | 2f7e813 | **fixed** upstream (original T-40, bbd2294: serialised downloads with retries); no `.lxg` download failed in 2 of 2 walkthrough page loads (0167112, 8988bd0), against 2 per load in 4 of 4 before |
| Q-7 | Compare > "Nearby sites": committing "Slope at most" (or any requirement) redraws the tab, which puts the last scan's Radius and Spacing back over what was typed; the scan then runs with the old grid. Typed Radius 900 m, then Slope at most 30°: the field reads 2000 again and the scan covers 2 km (its summary says so). Cause: `panel.ts` redraws the tab on every requirement change and `nearbyTab.ts` `render()` refills the fields from the panel state, which only a scan updates. | @analysis (`src/ui/compare/`); the original team's T-56 | c366a06, 649fc4e | **fixed** by Lunyx T-56 (8c58f49, from lunyx-standby; operator decision D-16 lifted the deferral of D-14). The fix is on @upstream-sync's fcc5482 (ce09c48 + 8c58f49), not yet on am/lunyx/integration, and lands together with this test. **Verified** by the e2e regression test "a typed radius and spacing survive a change of the slope limit, and the scan covers them" (`e2e/flow.test.mjs`, no longer a todo), the operator's scenario. Steps: Radius 900, Spacing 150, then "Slope at most" 30. Both fields keep 900 and 150, and the scan from the tab covers "within 900 m, every 150 m, slope at most 30°" (options 900 / 150 / 30). The test needs the fix and fails without it. Run on the GPU (GTX 1050 Ti), 2026-11-15 08:32 to 08:35Z, on this branch's tree, whose app code is ce09c48's, with the fix's two app files (`nearbyTab.ts`, `scanSettings.ts` from fcc5482) applied for the run only, i.e. the app code of fcc5482: flow 16 of 16 pass (the Q-7 test 15.8 s). The same tree without them: 15 pass, 1 fail, the Q-7 test ("the typed radius was replaced", '2000' !== '900'). @upstream-sync runs the flow file on fcc5482 merged with this test. **Verified on RC bce6816** (2026-11-15 09:28 to 09:33Z, GPU), through the real controls at 1280x720 and 1920x1080 (walkthrough step 7, 10 of 10 checks at each size). Radius 900 and Spacing 150 kept through two slope-limit changes (10° and back to 8°); the scan's options 900 / 150 / 8; the summary "(within 900 m, every 150 m, slope at most 8°)". The e2e flow file passed 16 of 16 on the RC's exact tree 2425d14 in the original team's run, Q-7 test included |
| Q-3 | After load the globe auto-rotates; stopping it at the start of the first flight leaves the orbit controls' damped momentum, which turns the camera on after the flight has arrived: a 1° first hop ended 0.013° short in longitude (0.4 km at the equator); the same hop again was exact. An earlier run, on a busier machine, missed by 0.14°; the amount depends on the frame rate. Low: only the first flight after load. | @globe | f928038, 2f7e813 | **fixed** upstream (T-43, dbc6c59: no turn after the first flight); 0° on c366a06 |
| Q-8 | Compare > "Nearby sites": the tab's status line keeps the outcome of the tab's last own action after a scan started elsewhere (the assistant's `rankNearby`) has replaced the list. After "Compare as B" on rank 1 of a scan around one pin, then a new pin and the assistant's "find a flatter nearby site with a shorter blackout", the tab shows the new scan ("Around: Pin 88.000° S, 136.700° E", rank 1 "600 m W, 600 m N") under the green line "Candidate 1 is pinned and loaded as B, against A: Pin 89.450° S, 137.200° W." That candidate 1 is not loaded as B: slot B still holds the first scan's candidate. The figures, the list's own summary, the A/B table and the reply are all right; only this sentence is stale. A scan started from the tab's own button rewrites the line. Seen in the T-8 walkthrough (`649fc4e/1280x720/38-scenario-1-nearby.jpg`). **D-13: not blocking** (no figure is wrong, no primary flow breaks; the line names the old pin), so fix if ready in time, else state it as open. Cause: `createTabKit()` (`src/ui/compare/widgets.ts`) writes the line only for actions run through the tab's `act`, and `panel.ts` empties a tab's line only for the A/B tab (`abKit.clearIfIdle()` when compareA/compareB change, since 08427e6); the nearby tab's kit is never emptied. Emptying it when a scan result arrives that the tab did not start, or when the site on screen changes, would close it. | @analysis (`src/ui/compare/`) | 649fc4e | open; sent to @coordinator with this reproduction (`e2e/qa/repro-nearby-status.mjs`, 2 of 2 runs) |
| Q-9 | Globe markers since the original T-64 (a click shows the details, a double-click opens the surface view): where two landings' markers overlap, "click, read the card, then double-click" opened the other landing. From 3,000 km Apollo 11's and Surveyor 5's markers are 8 px apart: a click showed Apollo 11's card; a double-click on the same spot opened Surveyor 5's surface view, and its card. The first click of the double-click counted as a slower second click, which takes the next overlapping landing (`globeView.ts`, `hits[(current + 1) % hits.length]`). Found by the walkthrough's Apollo 11 step on fe0ae02 (both sizes). **D-13: not blocking**: the view and the card name the landing that opened, and the card's "Enter surface view" opens the selected one. | @globe (`src/scene/globe/globeView.ts`, T-64) | fe0ae02, c39c516 | **fixed** upstream (@globe's aaeada2, in the T-64 candidate e54cc2d): a double-click opens the landing whose details are shown. Verified on e54cc2d: `e2e/qa/repro-marker-dblclick.mjs` no longer reproduces it (the double-click opens Apollo 11), where on c39c516 it did; the walkthrough's Apollo 11 step (click, then double-click on the overlapping markers) passes at both sizes |

## Walkthrough record

| Task | Tree | When (2026-11-15) | Sizes | Steps | Value checks | Failures |
| --- | --- | --- | --- | --- | --- | --- |
| T-2 | app tree of 2f7e813 (= published 27b0f30) | 03:47Z | 1280x720, 1920x1080 (surface) | 47 of 47 | 244 of 248 | F-3 (two), Q-4, Q-6 |
| T-8, release | app tree of team integration 649fc4e (published 39a4c5d + this team's last delivery) = **RC 41be074**: app code identical to 649fc4e (diff outside *.md: empty) | 06:26 to 06:31Z, script e6d5333 | 1280x720, 1920x1080, all five parts | 82 of 82 | 494 of 494 | none; Q-8 seen in a screenshot, then reproduced |
| T-16, release | **RC bce6816** (41be074 + the Q-7 fix, Lunyx T-56): a72a57f merged, app code identical to bce6816 | 09:28 to 09:33Z, script b067068 | 1280x720, 1920x1080, all five parts | 82 of 82 | 504 of 504 | none; the scan step now runs the operator's Q-7 scenario (10 of 10 checks at each size) |
| T-19, T-64 candidate | **e54cc2d** (@upstream-sync's candidate: bce6816 + GitHub main 081784a/a03eff9/d744169, the movable surface panels, Track Sun/Earth, F-10 both halves, Q-9 fix), merged into this branch: app code identical to e54cc2d | 10:39 to 10:45Z, script 844813c | 1280x720, 1920x1080, all five parts | 82 of 82 | 514 of 514 | none. Earlier the same day on fe0ae02: 80 of 82, which found Q-9 and two script faults, fixed in 5209bd6 |

The T-8 run: GPU (GTX 1050 Ti, full settings, 60 fps). No failed request, HTTP error or
console error at either size. Report `e2e/qa/out/rc-649fc4e-r2/report.json`. The first T-8
run (06:16Z, script 649fc4e) passed all 490 of its checks, but its countdown step checked
nothing, because the countdown now names both ends. The script fix is e6d5333, and its run is
the record. Screenshots and the review against the mockups: `docs/lunyx/screenshots/REVIEW.md`
and `docs/lunyx/screenshots/649fc4e/`.

The browser tests on the same tree (06:04 to 06:16Z, GPU):

- flow: 15 pass, plus the Q-7 todo, which still fails.
- a11y, first run: 12 of 15; see the observation below.
- a11y, two more runs at 06:22Z and 06:23Z: 15 of 15 each.

## Observations

Not findings: nothing that an owner could act on yet.

- **One renderer crash in three a11y runs on 649fc4e** (T-8, 06:04 to 06:16Z, load 2.4 to
  4.6). The test "with reduced motion, the drawer and the view change do not animate" hung for
  its full 600 s. It was most likely waiting on `enterSurface`, an evaluate that has no timeout
  of its own. The next test then got `page.evaluate: Target crashed`, and the one after it
  failed on the dead page. Nothing in the run's output says why. Since then it has not
  happened: the same file twice more (15 of 15 each), and the walkthrough's surface entries at
  both sizes in two full runs. The cause is unknown: the app, the headless GPU set-up or the
  machine.
- **Under D-13, if it recurs:** a page crash on entering the surface view would break a
  primary flow, so it should be reported as blocking then, with the run's log. Until then the
  e2e runner keeps `E2E_TIMEOUT_MS` at its default.

## Reproductions

### Q-1, Q-2, F-3, Q-3: `e2e/qa/repro-centre.mjs`

```bash
npm run build
flock /tmp/lunyx-gpu.lock node e2e/qa/repro-centre.mjs     # writes e2e/qa/out/repro-centre-<sha>/repro-centre.json
```

1280x720, motion on (as a person sees the app), the GPU renderer. Each case starts from the
centre 8.37° N, 0.06° W, reached by action and verified, and types IM-2's coordinates
(84.79° S, 29.2° E) into Filters > Centre of view.

Run on the app tree of team integration 2f7e813 (= published 27b0f30; the run's commit
887f893 only adds e2e files), 2026-11-15 03:31Z, renderer ANGLE (NVIDIA GeForce GTX 1050 Ti,
OpenGL ES 3.2), load 12.6 to 11.3, report `e2e/qa/out/repro-centre-887f893/repro-centre.json`.

**Q-1**, latitude, Tab, longitude, Enter:

| Typing | Latitude field just after Tab | Latitude field at Enter | View ends at | Off by |
| --- | --- | --- | --- | --- |
| at once | −1.01 | −50.93 | 57.43° S, 29.2° E | 27.36°, 830 km |
| 80 ms per key, 0.2 s pause | −1.04 | −80.94 | 81.63° S | 3.16°, 96 km |
| 150 ms per key, 0.5 s pause | −9.52 | −83.35 | 83.37° S | 1.42°, 43 km |
| 250 ms per key, 1.2 s pause | −1.04 | −84.73 | 84.67° S | 0.12°, 3.6 km |
| 250 ms per key, 4 s pause | −23.98 | −84.73 | 84.67° S | 0.12°, 3.6 km |

**Q-2**, both fields typed, then "Drop pin at centre" at once:

| Typing | Pin | Off by |
| --- | --- | --- |
| at once | 55.92681° S, 0.06° W | 879 km |
| 120 ms per key | 83.02705° S, 0.06° W | 97 km |

**F-3**, latitude + Enter, wait for the flight, longitude + Enter, wait, then the button. The
prediction is the clamp in `flyTo` applied to the typed latitude and again to the two-decimal
value the field shows:

| Typed | After the latitude | After the longitude | Pin | Off by | Predicted |
| --- | --- | --- | --- | --- | --- |
| 84.79° S, 29.2° E (IM-2) | 84.7328° S | 84.6727° S | 84.67269° S, 29.2° E | 3.56 km | 84.7328, 84.6727 |
| 89.45° S, 137.2° W | 89.4417° S | 89.4315° S | 89.43150° S, 137.2° W | 0.56 km | 89.4417, 89.4315 |
| 70° S, 10° E | 70° S | 70° S | 70° S, 10° E | 0 | exact |

By action (`setGlobeCamera`): 84.79° S gives 84.7328° S; 88° S gives 87.9708° S; 89.45° S
gives 89.4417° S; 80.5° S gives 80.4878° S; 79.9° S is exact; 84.79° N gives 84.7328° N.

**Q-3**, the first flight after load: a 1° hop east from the auto-rotating start view ended at
0.6042° E on arrival and 0.5927° E once the camera rested (target 0.6055° E); the next 1° hop
was exact.

### Q-4

`npm run e2e -- a11y`, test "after "Compare as B" the focus stays in the compare dialog" (todo).
By hand: open Compare, "Nearby sites", "Scan nearby sites", then Tab to "Compare as B" in a
ranked row and press Enter. The panel shows "A and B" and the focus is on the page; Escape
closes the panel and the focus does not return to the "Compare" button.

### Q-5

Open Apollo 11, "At landing time", "Enter surface view", set the window to 29.5 days, leave
the solar band at its default 0° to 90°: Key metrics shows "Requirement not met. Over the
mission window the Sun's elevation runs from −88.43° to 89.51°: outside the required band
(0° to 90°)" (`27b0f30/1920x1080/16-apollo11-surface-landing-sun.jpg`). Open Compare with any
A and B: "No requirement: no solar elevation band is set" (`27b0f30/1280x720/28-assistant-compare.jpg`).
Ask the assistant "what is the illumination?": "The Sun leaves the required elevation band
(0.0° to 90.0°) during the window".

### Q-7

`npm run e2e -- flow`, test "a typed radius and spacing survive a change of the slope limit, and
the scan covers them". It was a todo until the fix; it is now a regression test, and it needs
Lunyx T-56 (8c58f49) in the tree.

By hand, before the fix:

1. Drop a pin, open Compare and go to "Nearby sites".
2. Type 900 in Radius and press Tab.
3. Type 30 in "Slope at most" and press Tab. Radius reads 2000 again.
4. "Scan nearby sites" scans within 2 km.

Since T-56 the fields keep what was typed, and a redraw shows a scan's radius and spacing only
for a new scan.

### Q-8: `e2e/qa/repro-nearby-status.mjs`

```bash
npm run build
flock /tmp/lunyx-gpu.lock node e2e/qa/repro-nearby-status.mjs   # writes e2e/qa/out/repro-nearby-status-<sha>/result.json; exit 1 while stale
```

1280x720, bundled data, deterministic assistant, 20 s.

1. Pin 89.45° S, 137.2° W.
2. Compare: "Save the scenario on screen as A".
3. "Nearby sites", "Scan nearby sites", "Compare as B" on rank 1. The line reads "Candidate 1
   is pinned and loaded as B, against A: Pin 89.450° S, 137.200° W."
4. Close the panel. Drop a pin at 88° S, 136.7° E.
5. Ask the assistant "find a flatter nearby site with a shorter blackout". It runs
   `rankNearby`.
6. Reopen Compare > "Nearby sites": the same line, unchanged, sits above the new scan, whose
   rank 1 is "600 m W, 600 m N". Slot B is still "Candidate 300 m S of Pin 89.450° S,
   137.200° W".
7. Control: press "Scan nearby sites". The line now reads "Scanned 137 points around Pin
   88.000° S, 136.700° E: 70 ranked alternatives."

On e6d5333 (app tree of 649fc4e), 06:35Z and 06:36Z: stale in 2 of 2 runs.

### Q-9: `e2e/qa/repro-marker-dblclick.mjs`

```bash
npm run build
flock /tmp/lunyx-gpu.lock node e2e/qa/repro-marker-dblclick.mjs   # writes e2e/qa/out/repro-marker-dblclick-<sha>/result.json; exit 1 while reproduced
```

1280x720, bundled data, 20 s:

1. Centre of view on Apollo 11 from 3,000 km (`setGlobeCamera`), where Surveyor 5's marker is drawn 8 px from it.
2. Click the Apollo 11 marker: the card shows Apollo 11.
3. 1.2 s later, double-click the same spot.

- On 5209bd6 (app tree c39c516): the surface view and the card show Surveyor 5 (exit 1).
- On 844813c (app tree e54cc2d, with aaeada2): they show Apollo 11 (exit 0).

### Q-6

Visible in the console of any walkthrough or e2e run (`e2e/qa/out/*/report.json`,
`failedRequests`). The walkthrough's pin-card step now compares the card's "Elevation data"
line with the finest grid in the analysis's provenance.

### After the fix (original T-43)

`e2e/qa/repro-centre.mjs` again on the app tree of the published am/lunyx/integration c366a06
(globe, scene and core code identical to it; the run's commit da0c2fc adds test files),
2026-11-15 04:32Z, the same GPU, load 9.8. Before: the run of 03:31Z above.

| Case | Before | After | Off by, after |
| --- | --- | --- | --- |
| Q-1 lat, Tab, lon, Enter (0 ms/key, 0 ms pause) | -57.43, 29.2 (829.6 km) | -84.79, 29.2 | 0.000 km |
| Q-1 lat, Tab, lon, Enter (80 ms/key, 200 ms pause) | -81.6329, 29.2 (95.7 km) | -84.79, 29.2 | 0.000 km |
| Q-1 lat, Tab, lon, Enter (150 ms/key, 500 ms pause) | -83.3743, 29.2 (42.9 km) | -84.79, 29.2 | 0.000 km |
| Q-1 lat, Tab, lon, Enter (250 ms/key, 1200 ms pause) | -84.6727, 29.2 (3.6 km) | -84.79, 29.2 | 0.000 km |
| Q-1 lat, Tab, lon, Enter (250 ms/key, 4000 ms pause) | -84.6727, 29.2 (3.6 km) | -84.79, 29.2 | 0.000 km |
| Q-2 pin right after typing (0 ms/key) | -55.92681, -0.06 (878.9 km) | -84.79, 29.2 | 0 km |
| Q-2 pin right after typing (120 ms/key) | -83.02705, -0.06 (96.7 km) | -84.79, 29.2 | 0 km |
| F-3 careful path, typed -84.79, 29.2 | pin -84.67269, 29.2 (3.56 km) | pin -84.79, 29.2 | 0 km |
| F-3 careful path, typed -89.45, -137.2 | pin -89.4315, -137.2 (0.56 km) | pin -89.45, -137.2 | 0 km |
| F-3 careful path, typed -70, 10 | pin -70, 10 (0 km) | pin -70, 10 | 0 km |
| F-3 setGlobeCamera -84.79, then the longitude committed again | -84.7328 → -84.6727 → -84.6727 → -84.6727 | -84.79 → -84.79 → -84.79 → -84.79 | 0.0000° |
| F-3 setGlobeCamera -89.45, then the longitude committed again | -89.4417 → -89.4315 → -89.4315 → -89.4315 | -89.45 → -89.45 → -89.45 → -89.45 | 0.0000° |
| F-3 setGlobeCamera -88, then the longitude committed again | -87.9708 → -87.9404 → -87.9404 → -87.9404 | -88 → -88 → -88 → -88 | 0.0000° |
| F-3 setGlobeCamera -80.5, then the longitude committed again | -80.4878 → -80.4781 → -80.4781 → -80.4781 | -80.5 → -80.5 → -80.5 → -80.5 | 0.0000° |
| F-3 setGlobeCamera -79.9, then the longitude committed again | -79.9 → -79.9 → -79.9 → -79.9 | -79.9 → -79.9 → -79.9 → -79.9 | 0.0000° |
| F-3 setGlobeCamera 84.79, then the longitude committed again | 84.7328 → 84.6727 → 84.6727 → 84.6727 | 84.79 → 84.79 → 84.79 → 84.79 | 0.0000° |
| Q-3 first 1° hop after load: longitude error once at rest | -0.0128° (drift after arrival -0.0115°) | 0° (drift 0°) | 0° |

### By hand

1. Open the app at 1280x720 and wait for it to load (motion on, the default).
2. Filters > Latitude: type `-84.79`, press Tab. The globe starts to fly south, and the
   latitude field at once shows where the camera is on its way (−1.01 in the measured run),
   no longer `-84.79`.
3. Type `29.2` in Longitude and press Enter straight away: the globe stops between the start
   and the pole (57.43° S in the measured run) instead of at 84.79° S.
4. Reload. Type `-84.79`, Tab, `29.2`, and click "Drop pin at centre" without pressing Enter:
   the pin lands mid-way (55.92681° S, 0.06° W in the measured run).
5. Reload. Type `-84.79` + Enter, wait until the globe stops, then `29.2` + Enter, wait, then
   "Drop pin at centre": the pin is at 84.67269° S, 3.56 km from the typed point (F-3).

## Causes, for the owner

- Q-1: `src/ui/globe/filtersPanel.ts`. The panel's `focusout` handler re-syncs every field
  from `store.globeCenter`; a field loses its typed value as soon as the focus leaves it, while
  the camera is still flying to it. The longitude commit then builds its target from the
  latitude field (`other(lat.input, ...)`), which now holds the in-flight centre.
- Q-2: same file, "Drop pin at centre" pins `store.get().globeCenter` at the moment of the click.
  The longitude's `change` event fires on the way (it starts a new flight) but the click reads
  the camera where it is, mid-flight.
- F-3: `src/scene/globe/globeView.ts`, `flyTo`: `d.y = clamp(d.y, -0.985, 0.985)`, then
  normalise. The flight ends on the clamped direction, and the latitude field shows that
  shifted centre to two decimals; the next commit sends it again.
- Q-3: `globeView.ts`: the orbit controls have damping on; auto-rotation feeds their rotation
  momentum, and stopping auto-rotation at the start of a flight does not clear it, so the
  remaining momentum turns the camera after the flight has snapped to its target.

These point at where the behaviour comes from; the fix is the owner's choice.
