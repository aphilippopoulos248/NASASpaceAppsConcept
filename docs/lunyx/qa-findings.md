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
| Q-1 | Filters > Centre of view, typed in the natural order (latitude, Tab, longitude, Enter): the latitude field is refilled with the centre of the still-flying camera when it loses focus, and the longitude commit sends that in-flight latitude, not the typed one. Typed 84.79° S, 29.2° E: the view ends at 57.43° S (830 km off) when typed quickly, 81.63° S (96 km) at 80 ms per key, 83.37° S (43 km) at 150 ms per key, and 84.67° S (3.6 km, F-3 twice) when the typist waits for the flight. | @globe | f928038, 2f7e813 | open, new; e2e todo test in `e2e/flow.test.mjs` |
| Q-2 | Typing both coordinates and pressing "Drop pin at centre" straight away pins wherever the camera is at the moment of the click, mid-flight, with the old longitude: typed 84.79° S, 29.2° E, pinned 55.92681° S, 0.06° W (879 km off) and 83.02705° S, 0.06° W (97 km off). | @globe | f928038, 2f7e813 | open, new; e2e todo test |
| F-3 | (legacy, reported 2026-11-14) Poleward of 80.06° the fly-to clamps the camera direction, so the view stops short of the typed latitude and "Drop pin at centre" pins off the typed point, even when each field is committed with Enter and each flight is awaited: IM-2's 84.79° S, 29.2° E gives a pin at 84.67269° S (3.56 km off: the clamp once on the latitude, once more when the longitude commit re-sends the shifted latitude shown in the field); 89.45° S, 137.2° W gives 89.4315° S (0.56 km). The same at both poles; exact at 80° and below. | @globe | f928038, 2f7e813 | open; e2e todo test |
| Q-4 | "Compare as B" in a ranked row of "Nearby sites" switches the panel to "A and B", which hides the button that had the focus: the focus falls to the page (`document.body`), so a keyboard user loses their place, and the next Escape closes the panel without giving the focus back to the launcher. Seen with the mouse (walkthrough) and with the keyboard only (`e2e/a11y.test.mjs`). | @analysis (`src/ui/compare/`) | 2f7e813 | open, new; e2e todo test |
| Q-5 | The default solar elevation band (0° to 90°) means "no band" in the compare panel since c331052 ("No requirement: no solar elevation band is set"), but the surface Key metrics still raise "Requirement not met … outside the required band (0° to 90°)" whenever the window includes a night (Apollo 11, 29.5-day window), and `getAnalysis` reports `requirements.sunElevationBand.metForWholeWindow: false`, which the assistant words as "The Sun leaves the required elevation band (0.0° to 90.0°) during the window". One app state, two answers. | @surface (`src/ui/surface/metricsModel.ts` `flags`), the owner of `src/core/analysisReport.ts` (`checkRequirements`); the assistant follows `getAnalysis` | 2f7e813 | open, new |
| Q-6 | (adds to the original T-40, not a new defect) The polar elevation layers fail too, not only the whole-Moon grid: `lola_south_875s_40m.lxg`, `lola_south_85s_80m.lxg` and `lola_south_80s_160m.lxg` each failed with `net::ERR_CACHE_WRITE_FAILURE`: two of the three in each of four walkthrough page loads, one in the reproduction's (none in the e2e runs, whose requests go through Playwright's request interception). Then the site card names a coarser grid than the analysis beside it used (card "160 m grid", elevation 1,946 m; analysis 40 m layer, 1,948 m), or still says "Loading…" when the analysis is ready, and when the analysis's own copy fails it uses the 1.9 km grid for that distance range (skyline 0.01° different between two loads of the same pin). | owner of T-40 (@surface) | 2f7e813 | for T-40 |
| Q-3 | After load the globe auto-rotates; stopping it at the start of the first flight leaves the orbit controls' damped momentum, which turns the camera on after the flight has arrived: a 1° first hop ended 0.013° short in longitude (0.4 km at the equator); the same hop again was exact. An earlier run, on a busier machine, missed by 0.14°; the amount depends on the frame rate. Low: only the first flight after load. | @globe | f928038, 2f7e813 | open, new, low |

## Walkthrough record

`e2e/qa/walkthrough.mjs` on the app tree of 2f7e813 (= published 27b0f30), GPU, 2026-11-15
03:47Z: 47 of 47 steps ran, 244 of 248 value checks passed; the four failures are F-3 (two),
Q-4 and Q-6. Screenshots and the review against the mockups: `docs/lunyx/screenshots/REVIEW.md`.

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

### Q-6

Visible in the console of any walkthrough or e2e run (`e2e/qa/out/*/report.json`,
`failedRequests`). The walkthrough's pin-card step now compares the card's "Elevation data"
line with the finest grid in the analysis's provenance.

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
