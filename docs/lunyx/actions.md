# What a user can do in Lunyx, and the action behind it

Audit for decision D-1 of the original project ("the LLM can operate the full navigator"),
original T-1 / T-16, team tasks T-1 and T-6. Owner: @assistant (lunyx-experience).

**State of this document.** 2026-11-15, from branch `am/lunyx-experience/agent/assistant`,
which merges `am/lunyx/integration` (a958d6b: compare panel slices 1 to 4 with the window
table, export and seasonal outlook, the surface HUD of original T-10, T-20 / T-33) and
`am/lunyx-experience/integration` (c4aaba5). **61 actions.** Read from every event handler and
every `runAction` call in `src/ui/` and `src/scene/`, and from the registry at run time.

How the pieces relate: a control calls `runAction(name, params)`; the assistant's tools are
`toolDefinitions()` over the same registry and its calls are `runAction(name, input, 'assistant')`.
There is no second list. `e2e/scenario/control.test.mjs` fails when a registered action has
no case there or no deterministic phrase in `src/assistant/deterministic/examples.json`, so
this table cannot silently fall behind the registry.

Check columns:

| Mark | Meaning | Where |
| --- | --- | --- |
| **C** | The action called the way a model calls it (scripted test model, real `/api/assistant` route), its result checked, and the control that shows it read from the screen | `e2e/scenario/control.test.mjs` |
| **D** | Reached by a deterministic-mode phrase, run through the drawer in the real app and against the stand-in app | `control.test.mjs`, `src/assistant/deterministic/laterIntents.test.ts` |
| **E** | The real control used (pointer or keyboard), its action logged with origin "ui", then the action alone leaves the same state | `e2e/equivalence.test.mjs` |
| **U** | Unit tests of the owner | the module's `*.test.ts` |
| **H** | Checked by hand | |

## 1. The registry: 61 actions

| Action | Module (owner) | Parameters | Control that runs it | Checks |
| --- | --- | --- | --- | --- |
| `setTime` | core (@globe) | `utc?`, `offsetHours?` | scrubber slider and date field; compare panel "Clock to A's/B's arrival"; skyline chart (click, arrow keys, Home / End) | C D E |
| `play`, `pause` | core | `rate?` | scrubber play button | C D E |
| `setRate` | core | `secondsPerSecond` | scrubber speed | C D E |
| `setLightMode` | core | `mode: real \| even` | Filters: Real / Even | C D E |
| `jumpToEvent` | core | `type`, `which?` | scrubber jump buttons; key-metrics countdowns | C D U |
| `selectSite` | core | `site`, `atLanding?`, `surface?`, `fly?` | markers, card "At landing time", "Earlier / Later", arrow keys on the card, deep links | C D E |
| `dropPin` | core | `lat`, `lon`, `fly?` | globe click, Enter on the globe, "Drop pin at centre", little person | C D E |
| `clearSite` | core | | card close, Escape on the globe | C D E |
| `enterSurface`, `exitSurface` | core | | card, little person; surface close, "Back to orbit", Escape | C D E |
| `setGlobeCamera` | core | `lat`, `lon`, `altitudeKm?` | drag, scroll, keys on the globe; Latitude / Longitude; locator map; "Whole Moon" | C D E |
| `lookAt` | core | `azDeg`, `elDeg?`, `fovDeg?` (4 to 100) | surface drag and arrow keys (pose); skyline chart and explanation "Turn to" | C D E |
| `setMastHeight` | core | `metres` | Filters: Mast height | C D E |
| `setMissionWindow` | core | `startUtc?` (UTC, `now`, `landing`), `durationH?`, `moveClock?` | arrival field, window selectors, "Now", "Start window here" | C D E |
| `setDelay` | core | `hours` | Filters: Arrival delay | C D E |
| `setSlopeLimit` | core | `degrees` | compare panel: "Slope at most" | C D |
| `setMaxEarthGap` | core | `hours?` | compare panel: "Earth gap at most" | C D |
| `setSunBand` | core | `minDeg`, `maxDeg` | Filters: solar elevation; compare panel: "Sun elevation from / to" | C D E |
| `setOverlay` | core | `mode` | Filters: "Show optimal landing area" and its selector | C D E |
| `showMissions` | core | `show` | Filters: "Show previous missions" | C D E |
| `setFilters` | core | `programs?`, `countries?`, `type?`, `fromYear?`, `toYear?`, `reset?` | "Mission filters" | C D E |
| `saveScenario` | core | `slot`, `label?` | compare panel "Save as A / B" | C D |
| `compare` | core | | no control of its own: the launcher opens the same A/B view (`openCompare`), and the panel analyses a pair as soon as both slots are saved. `compare` is the assistant's one step that opens it and waits for both analyses | C D |
| `stopCompare` | core | | compare panel close, Escape | C D |
| `getAnalysis`, `getState`, `listSites` (queries) | core | `slot?`; ; `shownOnly?` | what the card, scrubber and panels show | C D U |
| `resetNorth` | globe view (@globe) | | compass | C D E |
| `setReliefExaggeration` | globe display (@globe) | `factor` (0 to 30) | Filters: Terrain relief, Exaggeration | C D E |
| `showCoverage`, `showIceTargets` | globe display (@globe) | `show` | Filters: coverage and ice-target checkboxes | C D E |
| `showPanel` | panels (@globe) | `panel: filters \| site-details \| site-science`, `open` | card fold buttons (details, site science); phone "Filters" | C D E |
| `setLocatorZoom` | locator map (@globe) | `zoom` | locator + / -, scroll, keys | C D E |
| `getSiteScience`, `nearestIceTargets` (queries) | site science (T-30, mounted by @globe) | ; `lat?`, `lon?`, `count?`, `limit?`, `maxKm?` | the card's "Site science" section | C D U |
| `setGeneratedDetail` | surface (@surface) | `on` | HUD "Generated detail" | C D E |
| `setFieldOfView` | surface | `fovDeg` (4 to 100) | scroll, pinch, + / - in the surface view (pose) | C D |
| `lookAtBody` | surface | `body`, `fovDeg?` | HUD "Face Sun" / "Face Earth"; key metrics Sun / Earth; chart Enter / E | C D E |
| `walkTo` | surface | `eastM`, `northM`, `liftM?` | W A S D, E / Q (pose); HUD "Return to site" | C D E |
| `setSkyAnnotations` | surface | `tracks?`, `labels?` | HUD "Sky paths" | C D E |
| `getSurfaceView` (query) | surface | | HUD status line, ground line, "About this view" | C D |
| `explainBlockage` | surface HUD (@surface) | `body`, `utc?` | key metrics "why", chart click on a hidden mark, X, explanation "Now" | C D U |
| `dismissBlockageExplanation` | surface HUD | | explanation "Close", Escape on the chart | C D |
| `setChart` | surface HUD | `show?`, `expanded?`, `mode?`, `table?`, `azimuthRange?` | HUD "Skyline chart"; chart Skyline / Time / Table / fit / size / × | C D E |
| `showKeyMetrics` | surface HUD | `open` | key metrics fold | C D E |
| `openCompare` | compare panel (@analysis) | `tab?: compare \| nearby \| windows \| outlook` | launcher "Compare", tab buttons, arrow keys on the tabs | C D E |
| `compareDelayedArrival` | compare panel | `delayH?`, `basis?` | "Compare arrivals" (with "B arrives later than A by") | C D E U |
| `compareMastHeights` | compare panel | `heightBM`, `heightAM?`, `basis?` | "Compare masts" (with "B has a mast of") | C D E U |
| `swapComparison`, `clearComparison` | compare panel | ; `slot?` | "Swap A and B", "Empty A and B" | C D E U |
| `saveComparison`, `loadComparison`, `deleteComparison` | compare panel | `name?`; `name`; `name` | "Save this comparison", saved list "Load" / "Delete" | C D U |
| `listComparisons` (query) | compare panel | | the saved list | C D U |
| `exportResults` | compare panel | `format: csv \| json`, `slot?: current \| A \| B \| AB` | "Window table" tab: download buttons | C D U |
| `showOutlook` | compare panel | `months?`, `slot?` | "Outlook" tab | C D U |
| `rankNearby` | compare panel | `radiusM?`, `spacingM?`, `slopeLimitDeg?` | "Nearby sites" tab, its scan | C D U |
| `selectCandidate` | compare panel | `rank?` or `id?`, `asB?` | a row of the nearby list | C D U |
| `setAssistantOpen`, `clearConversation` | drawer (@assistant) | `open`; | assistant button, drawer close, Escape; "New chat" | C D E |

## 2. Capabilities, area by area

Only what changed since the 33-action draft is spelled out; the rows of the earlier draft for
time, sites, views, cameras, layers and the drawer still hold (section 1 has their checks).

### 2.1 Time and the mission window

Scrubber, Filters and the compare panel all go through `setTime`, `setMissionWindow`,
`setDelay`, `jumpToEvent`, `play` / `pause` / `setRate`. Rise and set times are reported with
their instant (D-8): `jumpToEvent` and `getAnalysis` give `label` and `instant`; deterministic
replies and the system prompt quote a time only with its label ("Sun fully set 2025-03-16
19:30 UTC (the last part of the Sun's disc goes behind the terrain skyline)"). The other end of
each crossing arrives with the science team's spans (T-31), through `getAnalysis` (@globe).

### 2.2 Sites, catalogue, pins

`selectSite`, `dropPin`, `clearSite`; `listSites` (T-33) lists the 28 landings, every listed
name is accepted by `selectSite` (checked in C).

### 2.3 Cameras and the two views

| The user can | Control | Action | Checks |
| --- | --- | --- | --- |
| turn and zoom the globe | drag, scroll, keys | `setGlobeCamera` (pose) | C D E |
| look around on the surface | drag, arrow keys | `lookAt` (pose) | C D E |
| zoom on the surface | scroll, pinch, + / - | `setFieldOfView` (pose) | C D |
| walk, rise and descend | W A S D, E / Q, Shift | `walkTo { eastM, northM, liftM }` (pose; closes G-1) | C D |
| face the Sun or Earth | HUD buttons, key metrics, chart keys | `lookAtBody` | C D |
| go back to the site | HUD "Return to site" | `walkTo { 0, 0 }` | C D |

### 2.4 Layers and how the globe is drawn

`setOverlay`, `showMissions`, `setFilters` (as before); `setReliefExaggeration`, `showCoverage`,
`showIceTargets` (T-13, T-20). `getState.globeDisplay` reports the factor drawn now, the
coverage and ice outlines and the average-map legend.

### 2.5 Mission parameters and requirements

`setMastHeight`, `setMissionWindow`, `setDelay`, `setSunBand`, and now with on-screen fields in
the compare panel: `setSlopeLimit`, `setMaxEarthGap`.

### 2.6 Readouts

| On screen | The assistant reads it from |
| --- | --- |
| site card: facts, elevation, data, sky now, mission-window figures | `getAnalysis` (`metrics`, `slope`, `now`, `provenance`, `siteElevationM`) |
| site card: summary, QuickMap / Moon Trek links | `getState.site.summary`, `site.links` (T-33) |
| site card: site science (DSN, long-term averages, ice targets, Diviner annual temperatures, ShadowCam mosaics) | `getSiteScience`; `nearestIceTargets` for more rows or another point |
| scrubber: marks, next events, Moon phase line | `getAnalysis.events` / `nextEvents`; `getState.moonPhase` |
| locator map zoom, open panels | `getState.locatorZoom`, `getState.panels` |
| relief chip, overlay legend | `getState.globeDisplay` |
| surface HUD: facing, distance, eye height, field of view, ground and generated detail, Sun and Earth drawn | `getSurfaceView` |
| key metrics, countdowns, skyline chart, explanation | `getAnalysis` (the same figures), `explainBlockage` (the explanation) |
| compare panel: A, B, B minus A, requirements flagged | `compare` / `compareDelayedArrival` / `compareMastHeights` results (`diff`, `analysisA/B`); `getAnalysis { slot }` |
| nearby list | `rankNearby` result (`reference`, `candidates`, `rejected`, `basis`) |
| window table, outlook chart | `exportResults` (the file and its spells), `showOutlook` (lunar days, planned, best and worst arrival, slips) |
| saved comparisons | `listComparisons` |
| a failed control's message | the action's error, word for word |

### 2.7 The assistant drawer

`setAssistantOpen`, `clearConversation`. Each reply is labelled (T-10): "AI-generated ·
<model>" for a language model, "Deterministic mode: no language model", "Scripted test model
(not a language model)". A standing note under the message box says where the answers come
from and that NASA is not responsible for their accuracy and has not reviewed them.

## 3. Gaps

A gap is something a user can do or read that no action covers, or data neither can reach.

| # | Gap | Owner | Status (this build) |
| --- | --- | --- | --- |
| G-1 | Walking had no action | @surface | **closed**: `walkTo` |
| G-2 | DSN opportunities unreachable | @globe | **closed**: `getSiteScience.dsn` |
| G-3 | Long-term averages at a site | @globe | **closed**: `getSiteScience.longTermAverages` |
| G-4 | Distance to ice targets | @globe | **closed**: `getSiteScience.iceTargets`, `nearestIceTargets` |
| G-5 | Landing catalogue not listable | @globe | **closed**: `listSites` (T-33) |
| G-6 | Card summary and links | @globe | **closed**: `site.summary`, `site.links` (T-33) |
| G-7 | Moon-phase line | @globe | **closed**: `getState.moonPhase` (T-33) |
| G-8 | Locator zoom not in `getState` | @globe | **closed**: `getState.locatorZoom` (T-33) |
| G-9 | Hover readouts (marker tooltip, locator pointer) | - | accepted: the information is in `listSites` and `getState` |
| G-10 | The scrubber's "Now" starts the window at the **real** time; the assistant has no wall clock: `getState` has none, and `setMissionWindow { startUtc: "now" }` means the simulated time. A model asked "start the mission now" can only guess the date. Deterministic mode uses the browser clock, so it is not affected. Proposal: `getState.wallClockUtc` (the browser's time), or `startUtc: "real-now"` | @globe (`src/core/coreActions.ts`) | open, reported in the T-1 gap list |
| G-11 | Mission-window table and CSV / JSON export, seasonal outlook | @analysis | **closed**: `exportResults`, `showOutlook` (a958d6b); phrases "export the results as csv", "show the seasonal outlook for 2 months", "show the window table" |

## 4. Findings, rechecked on this build

| # | Finding | Owner | Status |
| --- | --- | --- | --- |
| F-1 | One Escape in the surface view also deselected the site | @globe, @surface | **fixed** by T-33 (`src/ui/globe/cardKeys.ts`); the expected-failure mark in `e2e/equivalence.test.mjs` is removed |
| F-2 | Card "Sky at ..." one step behind the clock | @globe | **fixed** by T-33 (`src/core/throttle.ts`, trailing run) |
| F-3 | Poleward of 80.06° the globe camera stops short of the latitude asked for (88.000 gives 87.97): `flyTo` clamps the view direction's y to ±0.985 (`src/scene/globe/globeView.ts`). The Latitude field and `setGlobeCamera` land in the same place, so UI and assistant agree, but neither centres where asked; "Drop pin at centre" after typing polar coordinates pins up to 1.7 km off | @globe | **open** (code unchanged); `e2e/flow.test.mjs` holds it as an expected failure |
| F-4 | The "Arrival delay" field loses its explanatory tooltip after the first good edit (`numberField` writes the error into `title`, then clears it) | @globe | **open** (code unchanged, `src/ui/globe/filtersPanel.ts`), minor |
| F-5 | After `rankNearby` the compare panel is on its "Nearby sites" tab, and the core `compare` action does not switch it back: the side-by-side comparison it says it opens stays hidden behind the nearby list. Deterministic mode and the scenario script now ask `openCompare { tab: "compare" }` after comparing; a model following `compare`'s description would not | @analysis (`src/ui/compare/`) or @globe (`compare`) | open, reported in the T-1 gap list |
| F-6 | On the card a pin or candidate is titled "Pinned location"; its name (for a candidate "Candidate 300 m W, 600 m S of ...", as `selectCandidate` and the nearby list give it) appears nowhere on the card | @globe | open, minor: the coordinates line identifies it |

## 5. How each path has been verified

| Path | What ran | Result |
| --- | --- | --- |
| **Real language model** | nothing: there is no API key on the build machine. The command is `e2e/scenario/real-model.mjs` (see `e2e/scenario/README.md`) | **not verified** |
| Scripted test model (not a language model) | every action through the real `/api/assistant` route with its result and the screen checked (`control.test.mjs`); the T-6 scenario as three follow-ups (`scenario.test.mjs`, `LUNYX_LLM_SCRIPT=scenario`); `e2e/assistant.test.mjs`; in-process loop tests (`server/llm/loop.test.ts`, `scenarioScript.test.ts`) | see the task results of T-1 and T-6 for counts and commits |
| Deterministic mode | every action by its phrase, in the browser (`control.test.mjs`) and against the stand-in app (unit); the T-6 scenario as three follow-ups and as one sentence (`scenario.test.mjs`) | as above |

How well a real model chooses and chains these actions is unknown until the real-model run
has been done; only the plumbing it would use is tested.

## 6. Not automated, and why

- Pinch zoom and touch drags (desktop-only acceptance, D-4): they end in the same
  `setFieldOfView` / `setGlobeCamera` / `lookAt` poses as the automated cases.
- Dictation (Web Speech API): not available headless; it only fills the message box.
- Hover tooltips (G-9).

## 7. To add when the remaining work lands

- Equivalence cases for the download buttons of the window table and for the outlook tab.
- The span of each rise and set (T-31) in `getAnalysis` and `jumpToEvent`: deterministic
  replies then say "starts setting ..., fully set ... UTC".
- G-10, F-5 and F-6 when their owners answer.
