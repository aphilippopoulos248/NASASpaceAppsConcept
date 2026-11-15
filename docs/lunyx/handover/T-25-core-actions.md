# T-25 Core actions for full LLM control, and globe polish: handover (@globe)

Branch am/lunyx/agent/globe. Screenshots: `screens/t25-*.png` (1.8 MB added).

## For @assistant: action names and result shapes

All times are UTC (`...Utc`, to the minute), longitudes east-positive, units in the key
names. Numbers are rounded to 2 decimals; a value that does not exist is `null`.

### `getAnalysis { slot?: "current" | "A" | "B" }` (query, waits)

Skips the debounce, waits for the analysis of what is on screen at that moment (or of the
comparison slot) and never returns `"loading"`.

```jsonc
{
  "slot": "current",
  "state": "ready",                       // or "error" / "idle", then only { slot, state, scenario?, error }
  "scenario": { "label", "description", "site": { "id", "name", "kind", "latDeg", "lonDegEast" },
                "startUtc", "endUtc", "durationH", "mastHeightM", "stepMin" },
  "metrics": { "illuminationPct", "sunAnyPct", "longestDarknessH", "darknessRunsIntoWindowEdge",
               "earthVisiblePct", "longestEarthGapH", "earthGapRunsIntoWindowEdge", "minSunElDeg", "maxSunElDeg" },
  "slope": { "slopeDeg", "downhillAzDeg", "baselineM", "demName" },
  "siteElevationM": 5321,
  "now": { "timeUtc", "insideAnalysedWindow",
           "sun":   { "azDeg", "elDeg", "skylineElDeg", "clearanceDeg", "centreAboveSkyline",
                      "skylineTerrain": { "distanceKm", "heightM", "latDeg", "lonDegEast", "demName", "demResolutionM" },
                      "explanation" },
           "earth": { /* same keys */ } },
  "nextEvents": { "sunrise": { "timeUtc", "azDeg", "inHours" } | null, "sunset": ..., "earthrise": ..., "earthset": ... },
  "events": [ { "type", "timeUtc", "azDeg" } ],                 // all in the window, at most 24 (then "truncated")
  "intervals": { "darkness": [ { "startUtc", "endUtc", "hours", "touchesWindowStart"?, "touchesWindowEnd"? } ],
                 "earthGaps": [...], "sunBehindEarth": [...] },
  "skyline": { "highestElDeg", "highestAzDeg", "lowestElDeg", "lowestAzDeg", "smoothMoonHorizonDeg", "searchedToKm", "azimuthStepDeg" },
  "requirements": { "sunElevationBand": { "required", "minDeg", "maxDeg", "sunElNowDeg", "metNow", "windowMinSunElDeg", "windowMaxSunElDeg", "metForWholeWindow", "note"? },
                    // "required" is false while the band is at its default, 0 to 90 deg (T-46): "metNow" and "metForWholeWindow" are then null and "note" says so
                    "maxEarthGap": null | { "limitH", "longestEarthGapH", "met", "gapRunsIntoWindowEdge" } },
  "provenance": { "ephemeris", "ephemerisNote", "elevationData": [ { "name", "resolutionM", "fromKm", "toKm" } ], "assumptions": [] },
  "warnings": []
}
```

- `now.*` comes from `blockageAt()` at the simulated time. Inside the window it is interpolated
  from the analysed series; outside it the sky model is used against the same skyline.
- `nextEvents` holds only events inside the analysed window, after the simulated time.
- `idle` carries the reason in `error` ("No site is selected…", "Comparison slot B is empty…").

### `compare {}` (command, waits for both analyses)

```jsonc
{
  "comparing": true,
  "A": "IM-2 Athena (earlier arrival)", "B": "IM-2 Athena (arrival 24 h later)",     // labels
  "scenarioA": { /* as getAnalysis.scenario */ }, "scenarioB": { ... },
  "analysisA": { "state": "ready", "scenario": "<label>", "illuminationPct", "longestDarknessH",
                 "earthVisiblePct", "longestEarthGapH", "slopeDeg", "warnings": [] },
  "analysisB": { ... },                                                              // "ready" or "error", never "loading"
  "diff": { "meaning": "B minus A", "illuminationPct", "longestDarknessH", "earthVisiblePct",
            "longestEarthGapH", "slopeDeg", "highlights": [ "…sentences from compareAnalyses()…" ] }
          // null when a side failed; then "error": "B (<label>): <reason>"
}
```

### One step to a landing and its date

- `selectSite { site, atLanding: true, surface?, fly? }`: selects the landing, sets the clock
  and the mission window start to touchdown, clears the arrival delay, real sunlight, paused.
  The result adds `timeUtc`, `playing`, `lightMode` and `missionWindow`. `fly: false` keeps the
  camera. A pin with `atLanding` is refused and nothing changes.
- `setMissionWindow { startUtc?: "<UTC>" | "now" | "landing", durationH?, moveClock? }`:
  `"landing"` is the selected landing's touchdown; `moveClock: true` also puts the clock at the
  window start (planned start plus delay). Result: `windowStartUtc`, `windowDurationH`,
  `delayH`, `effectiveStartUtc`, `windowEndUtc`, `timeUtc`, `clockInsideWindow`.
- `missionWindow` in `selectSite` / `getState` results: `{ startUtc, durationH, delayH,
  effectiveStartUtc, endUtc, clockInsideWindow }`. `setDelay` returns `{ delayH,
  plannedStartUtc, effectiveStartUtc, clockInsideWindow }`.

### Other changes to actions

- `jumpToEvent { type, which? }` moved from the scrubber into core and now waits for the
  analysis. Result `{ event, timeUtc, azDeg, playing: false }`. With no such event the error
  names the analysed window.
- `saveScenario { slot, label? }` returns immediately, with `labels: { A, B }` added. Without a
  label the slots are named after their sites; when both would read the same, each gets what
  differs: "(earlier arrival)" / "(arrival 24 h later)", "(2 m mast)" / "(10 m mast)",
  "(24 h window)" / "(3-day window)". A typed label is kept.
- `showPanel { panel: "site-details" | "filters", open }`: folds the site card's body or the
  phone Filters sheet. Result `{ panel, open }`.
- `getState` does not wait (its `analysis` may be `"loading"`); `getAnalysis` is the one that waits.
- Registered by my modules now (31): resetNorth, setGeneratedDetail, setTime, play, pause,
  setRate, setLightMode, jumpToEvent, selectSite, dropPin, clearSite, enterSurface, exitSurface,
  setGlobeCamera, lookAt, setMastHeight, setMissionWindow, setDelay, setSlopeLimit,
  setMaxEarthGap, setSunBand, setOverlay, showMissions, setFilters, saveScenario, compare,
  stopCompare, getAnalysis, getState, showPanel, setLocatorZoom.

## For @surface: what the analysis store offers now (`src/core/analysisStore.ts`)

- `analysis.settled(slot)` and `analysis.settledComparison()` wait; `analysis.comparison()` is
  the published pair: `idle {missing}` / `loading` / `error` / `ready { a, b, diff }`. The diff
  is computed once per pair, so the compare panel and the `compare` action show the same sentences.
- `analysis.wanted(slot)` is the scenario the app state asks for. For up to 200 ms after a
  change, `get(slot)` still holds the previous scenario's result: compare ids before drawing.
- `requestNearby(options)` now publishes `progress: { done, total }` while it runs.
- `labelPair(a, b)` in `src/core/scenario.ts` names two scenarios apart; `saveScenario` and
  `compare` apply it. A slot written directly with `store.set` is renamed at the next `compare`.
- `checkRequirements()` and `reportAnalysis()` in `src/core/analysisReport.ts` are what
  `getAnalysis` reports; reuse them if the HUD should flag the same way.
- `jumpToEvent` is registered in core: do not register it again (a second registration throws).
- `src/scene/surface/controller.ts` still says custom pins need an elevation service that "is
  not merged yet". That file is yours; the sentence is out of date.

## Polish

- **Site card**: header (name, coordinates, fold, close) and footer (the actions) always show;
  the body scrolls. "Elevation data" is one line (resolution, finest product) with every source
  and the terrain notes behind a disclosure. Sun and Earth are given against the terrain
  skyline once the analysis is ready (before that: smooth Moon, and it says so). Mission-window
  results: sunlight %, longest darkness, Earth in view %, longest Earth gap, slope.
- **"At landing time"** replaces "Lighting at landing": one action,
  `selectSite { site, atLanding: true, fly: false }`.
- **Phone**: the card body is folded by default at 700 px and below (114 px tall folded).
- **Filters panel**: the date at the top is now the arrival. It starts the mission window and
  brings the clock there (`setMissionWindow { startUtc, moveClock: true }`). New "Arrival delay"
  field (`setDelay`). The scrubber's own date field still sets only the clock; its "Now" starts
  the window at the real time.
- **Deep links**: `&t=` / `&time=` and `&light=landing` also start the mission window there.
- **Scrubber**: jump buttons are disabled when no such event lies ahead in the window, and say
  when the next one is; with no event at all the window length is named.
- **Wording**: `NOT_AVAILABLE_TEXT` is "This analysis is not part of this build of Lunyx."
  Other failures show their reason ("Not available: <reason>").

## Verified

- `npm run build` passes; `npm test`: 203 vitest tests (1 skipped) and 10 science tests pass.
- New tests: `scenario.test.ts` (7), `analysisReport.test.ts` (5), 5 more in
  `analysisStore.test.ts`, 8 more in `coreActions.test.ts`, 1 more in `deepLink.test.ts`.
  Six of the action tests run the real science core on the bundled terrain:
  - Apollo 11 at touchdown: Sun 10.7° up at azimuth 88.8° (history: about 10.8°, in the east);
    `jumpToEvent sunset` lands on 1969-08-03 15:40 UTC.
  - IM-2, 7-day window, on time against 24 h late: 100 % against 97.69 % sunlight, longest
    darkness 0 against 2.76 h. The later week reaches the eclipse of 14 March 2025.
- Headless Chromium against `vite preview` (1280x720 and 390x844):
  - `selectSite { IM-2, atLanding }` then `getAnalysis`: ready in 6.4 s on a cold page.
  - `compare` after `saveScenario` A, `setDelay 24`, `saveScenario` B: resolved in 1.6 s with both sides ready and the diff.
  - A pin at 89.45S 136.7E analysed from the bundled 40 m layer; a pin at 12.5N 167.5E from a
    60 m window built by `/api/terrain` (7.9 s).
  - The card's "At landing time" button, the arrival field, the fold button and `showPanel` behave as described.

## Not done / limits

- `getAnalysis` waits as long as the analysis takes: there is no timeout. A first analysis of a
  pin away from the poles waits for `/api/terrain` (5 to 10 s).
- A failed analysis is not retried until the scenario changes.
- The surface view still refuses custom pins (the surface scene is @surface's T-9).
- Rounding: A, B and the diff are each rounded to 2 decimals, so the diff can differ from
  B minus A by 0.01.
