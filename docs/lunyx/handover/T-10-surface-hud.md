# T-10 Surface HUD: handover (@surface)

Branch am/lunyx/agent/surface, merged with integration 6c7b94c. Screenshots are in
`screens/t10-*.jpg` (headless Chromium, software WebGL; 1280x720 and 390x844), taken
just before that merge; the numbers below were read again after it and are unchanged.

## What was built

1. **Key metrics, upper left** (`src/ui/surface/metrics.ts`, numbers from
   `metricsModel.ts`). From top to bottom:
   - the site and a compact provenance line: observer height, ephemeris source, the
     finest elevation product behind the skyline with its resolution and how many
     coarser grids lie farther out;
   - requirements that are not met, in words, in a bordered block that starts with
     "Requirement not met." (Sun outside the required elevation band now, Sun outside it
     for part of the mission window, Earth gap longer than allowed);
   - "Now · UTC": Sun and Earth azimuth, elevation, clearance of the centre above the
     skyline, and the state in words ("above the skyline", "41 % of the disc above the
     skyline", "behind terrain", "below the horizon", "behind Earth (eclipse)", "in line
     of sight"). The state is a button: it explains what forms the skyline there. The
     body's name is a button too: it turns the view to it;
   - next sunset, sunrise, Earthset and Earthrise over the terrain skyline, as countdowns.
     Each is a button that moves the clock there (`jumpToEvent`, the core action);
   - the mission window: sunlight % (and "any Sun" %), longest darkness, Earth's centre in
     sight %, longest Earth gap, slope, the Sun's elevation range;
   - the analysis' own warnings, and "Where these numbers come from" (ephemeris and its
     stated accuracy, every elevation layer with its resolution and reach, observer
     height, slope baseline).
2. **Skyline chart, lower left** (`skylineChart.ts`, data from `chartModel.ts`), small by
   default, expandable to 760 px:
   - **Skyline mode**: the terrain skyline around the compass against elevation above the
     horizontal; the Sun's samples over the mission window as circles and Earth's as
     diamonds (its libration loop). A filled mark is above the skyline, a hollow one
     hidden (Sun: the whole disc; Earth: its centre), so lit and blocked spells are told
     apart by shape and fill, not by colour alone. A ring marks each body at the
     simulated time, wherever the clock is. A line with a band shows where the surface
     view looks and how wide the picture is. "Zoom to the tracks" shows only the
     azimuths the two bodies cross.
   - **Time mode**: two stacked panels on one time axis, elevation above the horizontal
     and clearance above the skyline (below 0 degrees is shaded: hidden).
   - **Table**: the same series as a table (time, azimuth, elevation, clearance and the
     state in words for each body) at a readable step.
   - **Pointer**: pointing at a mark shows its time and numbers. Clicking it moves the
     clock there and turns the view to it; a hollow mark also opens the explanation.
     Clicking empty chart turns the view that way. Dragging moves the clock
     continuously. In time mode a click sets the clock, and where the line under the
     pointer is below zero clearance it also opens the explanation.
   - **Keyboard**: the plot is a tab stop. Left / Right move the clock one sample (with
     Shift one hour), Home / End go to the ends of the window, Enter faces the Sun, E
     faces Earth, X explains what hides the Sun, Escape closes the explanation. After a
     mouse click the plot gives the keyboard back, so the arrow keys keep turning the
     view.
3. **Blockage explanation**: the sentence from `blockageAt()`, the distance of the terrain
   that forms the skyline, its height against the site's own ground, its coordinates,
   and for Earth the line "not a radio link". Buttons: turn the view to it, close. It is
   for one instant: once the clock has moved it says so and offers "Set the clock to
   that time" and "Explain the current time". It is dropped when the site or the window
   changes.
4. **One clock, one site, one view direction**: nothing in the HUD holds a time or a
   result. It reads `store` and the analysis store and changes them only through actions.
5. **Layout** (`hudLayout.ts`): the three parts are measured and kept off each other and
   off the shell's scrubber and assistant button. The metrics end above the chart and
   scroll past that ("More below"); the large chart stands above the scrubber and the
   status strip steps aside for it; on a phone the chart and the explanation take the
   strip's place. The strip keeps out of the left column.

## Registered actions (`src/ui/surface/hudActions.ts`)

| Action | Parameters | Returns |
| --- | --- | --- |
| `explainBlockage` | `body` "sun" or "earth", `utc?` (default: the simulated time) | `timeUtc`, `blocked`, `bodyAzDeg`, `bodyElDeg`, `skylineElDeg`, `clearanceDeg`, `discVisiblePct`, `sunCoveredByEarthPct` (Sun), `ridgeDistanceM`, `ridgeHeightM`, `ridgeLatDeg`, `ridgeLonDegEast`, `demName`, `demResolutionM`, `explanation`, `site`, `shownInHud`. Waits for the analysis; not-a-number never appears (null instead). |
| `dismissBlockageExplanation` | none | `explanationShown: false` |
| `setChart` | any of `show`, `expanded`, `mode` "skyline" or "time", `table`, `azimuthRange` "full" or "tracks" | `chart` "hidden", "compact" or "expanded", `mode`, `table`, `azimuthRange` |
| `showKeyMetrics` | `open` | `keyMetricsOpen` |

Each resolves after the frame that draws its result. The HUD's controls call these and the
existing `jumpToEvent`, `setTime`, `lookAt` (core) and `lookAtBody` (surface scene); none of
those is registered again.

## The numbers on screen against the analysis

Read from the page text and from `getAnalysis` in the same run (2 m observer).

| | IM-2 Athena, 2025-03-06 17:28 UTC, 480 h window | Apollo 11, 1969-07-20 20:17 UTC, 336 h window |
| --- | --- | --- |
| Sun az / el / clearance | 65.7 / +2.46 / +1.63 (analysis 65.68, 2.46, 1.63) | 88.8 / +10.70 / +11.20 (88.8, 10.7, 11.2) |
| Earth az / el / clearance | 335.8 / +11.19 / +12.31 (335.84, 11.19, 12.31) | 272.2 / +59.23 / +58.17 (272.2, 59.23, 58.17) |
| Next sunset (last limb) | in 13 d 05 h, 2025-03-19 23:17 UTC (317.82 h, 23:17) | in 13 d 19 h, 1969-08-03 15:40 UTC (331.39 h, 15:40) |
| Next Earthset / Earthrise | in 12 d 10 h, 03-19 04:09 / in 18 d 14 h, 03-25 08:17 (298.69 h, 446.83 h) | none in the window (none) |
| Sunlight (any Sun) | 64.7 % (65.6 %) (64.73, 65.64) | 98.5 % (98.6 %) (98.47, 98.63) |
| Longest darkness | 6 d 18 h or more inside the window (162.18 h, runs into the window edge) | 4 h 37 min or more inside the window (4.61 h, runs into the edge) |
| Earth's centre in sight | 69.1 % (69.14) | 100.0 % (100) |
| Longest Earth gap | 6 d 04 h (148.14 h) | none (0) |
| Slope | 2.1 degrees over 120 m (2.06, 120 m) | 2.5 degrees over 10 m (2.48, 10 m) |
| Sun elevation range | -5.44 to 5.36 (same) | -1.47 to 89.51 (same) |
| Ephemeris | JPL Horizons table (bundled) | in-app sky model |

Chart, IM-2: the hollow Sun mark at 2025-03-19 23:18 UTC reads 264.6 / -0.56, clearance
-0.27 (the Sun's radius: the last limb is on the skyline); the analysis' sunset is 23:17 at
azimuth 264.6. Clicking it set the clock to 23:18:00, turned the view to 264.6 / -0.3 (the
skyline) and showed "…the skyline at azimuth 264.6 deg is -0.29 deg, formed by terrain
2.4 km away at 5313 m (LOLA LDEM_80S_20M, 60 m site window, 60 m grid): it is hidden by
0.27 deg", with "8 m below the site's ground" and 84.797 S, 28.349 E. The Sun mark at the
eclipse of 2025-03-14 is hollow as well (Earth covers the Sun).

## States

| State | Key metrics | Chart |
| --- | --- | --- |
| No site | "No site is selected. Select a landing site or drop a pin to see its sky." | "No site is selected." |
| Analysis running, or the result on show belongs to the previous site or window | "Working out the skyline and the mission window…"; Sun and Earth azimuth and elevation from the sky model, state "skyline not available yet", no clearance | the same message, nothing drawn |
| Analysis failed | "The site analysis is not available: (reason)", in the error colour; azimuth and elevation as above | the same message |
| No elevation data at the site | clearance "n/a", state "skyline not available", slope "not available: no elevation data covers the site" | "No elevation data covers this site, so there is no skyline to draw…"; the table still lists the Sun and Earth |
| Clock outside the analysed window | the two rows come from the sky model against the same skyline, and a line says so; countdowns say "none: clock past the window" | the "now" rings still follow the clock; the time chart has no "now" line |
| No event ahead | "none before the window ends" (the hint gives the window's end) | |

No number is shown that the analysis did not produce.

## Decision D-8 (which instant an event time means)

The science core's events are the Sun's last limb going behind the skyline, its first limb
appearing, and Earth's centre crossing the skyline. Every countdown carries that on its
second line ("Sun fully set · 2025-03-19 23:17 UTC", "Sun starts rising", "Earth's centre
sets", "Earth's centre rises", the same words as the scrubber's buttons) and in its hint; the window figure is labelled "Earth's
centre in sight"; the chart's legend says "Sun: the whole disc; Earth: its centre". The
other end of each transition (first cut of the disc, whole disc clear) is not in the
science core yet (T-31). When it is, the countdown rows have room for it on the same
second line.

## Also changed

- `src/scene/surface/controller.ts`: Escape now calls `preventDefault()` before
  `exitSurface` (my half of the Escape bug in m254: the site card still has to ignore
  events with `defaultPrevented`). A button that was just clicked keeps the focus, and
  only Space and Enter belong to it: arrow keys and W A S D go on working after a click
  on any HUD button.
- `src/ui/surface/hud.ts`, `hud.css`: the strip has a "Skyline chart" button (it is the
  way back after the chart is hidden), keeps out of the left column and stands a gap
  above the scrubber. "About this view" now says that the thin orange ring drawn around
  Earth while it hides the Sun is schematic (asked for T-22, m316).

## Verified

- `npm run build` passes. `npm test` before the merge of integration 6c7b94c: vitest
  58 files, 570 passed, 5 skipped (the opt-in live suite); node science tests 10 of 10.
  After the merge (9b4c59f): vitest 63 files, 646 passed, 5 skipped; science 10 of 10.
  `src/ui/surface/*.test.ts` has 36 tests on the models, the actions and the layout
  limits; they use a real `analyseStack()` run on a small synthetic Moon (a ridge that
  hides the setting Sun early), so the HUD is checked against the science core's output.
- In the app at 1280x720 through real pointer and key events: hover tooltip, click on a
  hollow mark (clock, view, explanation), arrow key turning the view afterwards, plot
  keys (Right +10 min, Shift+Left -1 h, End, Home, Escape, E, X), "why?" in the metrics,
  a countdown button (clock to 2025-03-19 23:17:08), time-mode hover and click, table,
  zoom to tracks, expand and shrink, hide and the strip's button.
- At 390x844 through touch: the strip's "Skyline chart" button, a tap on a hollow mark,
  the metrics' "Open".

## Screenshots

| File | Shows |
| --- | --- |
| `t10-im2-1280.jpg` | IM-2 at touchdown: metrics, small chart, strip |
| `t10-im2-explain-1280.jpg` | after a click on the hollow Sun mark at 2025-03-19 23:18 |
| `t10-im2-chart-expanded-1280.jpg` | large skyline chart with the hover tooltip |
| `t10-im2-chart-time-1280.jpg` | large time chart with the crosshair |
| `t10-apollo11-1280.jpg` | Apollo 11 at touchdown |
| `t10-apollo11-chart-tracks-1280.jpg` | Apollo 11, zoomed to the tracks |
| `t10-apollo11-table-1280.jpg` | the table view |
| `t10-im2-390.jpg`, `-chart-390.jpg`, `-explain-390.jpg`, `-metrics-390.jpg` | phone: default, chart open, explanation, metrics open |
| `t10-im2-1920.jpg` | IM-2 at 1920x1080 on a GPU (full settings): metrics, small chart, strip with the GCAT ownership line |

## Not done, and limits

- Hovering shows a mark's numbers but does not move the clock: clicking or dragging does.
  A hover that set the shared clock would re-light the scene whenever the pointer
  crossed the chart on its way elsewhere, and would fight playback and the scrubber.
- At 720 px of height the metrics do not fit above the small chart: they scroll, with
  "More below" at the cut. How tall the full panel is depends on the site: at IM-2 with
  a 480 h window it is about 900 px, most of it the analysis' own warnings.
- The marks drawn are thinned to one per 10 px; every sample is reachable by the keyboard
  and the time chart. The table steps at up to 150 rows (every 3 h for 14 days).
- The time chart shows clearance against terrain. An eclipse of the Sun by Earth shows in
  the skyline chart (hollow mark) and in the metrics, not as a dip in that line.
- The chart's Sun and Earth colours (#c98500, #3987e5) are darker than the sky-path marks
  in the 3D view (#ffd479, #6fb4ff): the lighter pair failed the palette check for marks
  on the panel. Same hues, and shape carries identity in both.
- On a phone the shell's assistant button sits over the top edge of the scrubber (both
  are the shell's); the HUD keeps clear of both.
- Under software rendering the HUD redraws with the frame (0.5 to 2 s here). On a GPU it
  is immediate.
- Follow-up when T-32 is integrated (m311): `src/scene/surface/groundSource.ts` copies a
  site's exact 3 m window from the stack and then eases its edge itself; with T-32 the
  stack's copy is already eased, so it would be eased twice (up to 6.7 m at single
  nodes). The fix is to copy from `storedGrid(...)`, which only exists on T-32's branch
  so far. It is one line and a test; it belongs to the surface scene (T-9).
