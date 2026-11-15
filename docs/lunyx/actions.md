# What a user can do in Lunyx, and the action behind it

Audit for decision D-1 of the original project ("the LLM can operate the full navigator"),
original T-1 / T-16, team tasks T-1 and T-6. Owner: @assistant (lunyx-experience).

**State of this document.** 2026-11-15, from branch `am/lunyx-experience/agent/assistant`,
which merges `am/lunyx-experience/integration` (350f928) and with it `am/lunyx/integration`
(8988bd0: both ends of each rise and set in the globe UI and the core actions, T-47, and in the
surface HUD, T-48; one rule for the default solar band, T-46; globe keys that add up, T-55;
before that 50aaace: compare panel slices 1 to 4, the surface HUD of original T-10, T-20 /
T-33, mission presets T-22, the assistant-visible state of T-44, GitHub main 282249d with
country flags and ownership). **64 actions.** Read from every event handler and
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

## 1. The registry: 64 actions

| Action | Module (owner) | Parameters | Control that runs it | Checks |
| --- | --- | --- | --- | --- |
| `setTime` | core (@globe) | `utc?` (UTC or `real-now`), `offsetHours?` | scrubber slider and date field; compare panel "Clock to A's/B's arrival"; skyline chart (click, arrow keys, Home / End) | C D E |
| `play`, `pause` | core | `rate?` | scrubber play button | C D E |
| `setRate` | core | `secondsPerSecond` | scrubber speed | C D E |
| `setLightMode` | core | `mode: real \| even` | Filters: Real / Even | C D E |
| `jumpToEvent` | core | `type`, `which?`, `instant?: event \| start \| end` (T-47) | scrubber jump buttons (each goes to the next end of its event's passage in turn: `instant: start`, then `event`); key-metrics countdowns (the instant each countdown names, T-48) | C D E U |
| `selectSite` | core | `site`, `atLanding?`, `surface?`, `fly?` | markers, Filters "Go to a landing site", card "At landing time", "Earlier / Later", arrow keys on the card, deep links | C D E |
| `dropPin` | core | `lat`, `lon`, `fly?` | globe click, Enter on the globe, "Drop pin at centre", little person | C D E |
| `clearSite` | core | | card close, Escape on the globe | C D E |
| `enterSurface`, `exitSurface` | core | | card, little person; surface close, "Back to orbit", Escape | C D E |
| `setGlobeCamera` | core | `lat`, `lon`, `altitudeKm?` | drag, scroll, keys on the globe; Latitude / Longitude; locator map; "Whole Moon". The result gives `centredLatDeg` (where the view centres, with a note when \|lat\| > 89.9) | C D E |
| `lookAt` | core | `azDeg`, `elDeg?`, `fovDeg?` (4 to 100) | surface drag and arrow keys (pose); skyline chart and explanation "Turn to" | C D E |
| `setMastHeight` | core | `metres` | Filters: Mast height | C D E |
| `setMissionWindow` | core | `startUtc?` (UTC, `now` = simulated, `real-now` = the computer's clock, `landing`), `durationH?`, `moveClock?` | arrival field, window selectors, "Now", "Start window here" | C D E |
| `setDelay` | core | `hours` | Filters: Arrival delay | C D E |
| `setSlopeLimit` | core | `degrees` | compare panel: "Slope at most" | C D |
| `setMaxEarthGap` | core | `hours?` | compare panel: "Earth gap at most" | C D |
| `setSunBand` | core | `minDeg`, `maxDeg` | Filters: solar elevation; compare panel: "Sun elevation from / to" | C D E |
| `setOverlay` | core | `mode` | Filters: "Show optimal landing area" and its selector | C D E |
| `showMissions` | core | `show` | Filters: "Show previous missions" | C D E |
| `showFlags` | core | `show` | Filters: "Show country flags" (remembered in the browser) | C D E |
| `listPresets` (query), `loadPreset` | presets (@globe, T-22) | ; `id`, `play?` | Filters: the mission presets list (each a button) | C D E |
| `setFilters` | core | `programs?`, `countries?`, `type?`, `fromYear?`, `toYear?`, `reset?` | "Mission filters" | C D E |
| `saveScenario` | core | `slot`, `label?` | compare panel "Save as A / B" | C D |
| `compare` | core | | no control of its own: the launcher opens the same A/B view (`openCompare`), and the panel analyses a pair as soon as both slots are saved. `compare` is the assistant's one step that opens it and waits for both analyses | C D |
| `stopCompare` | core | | compare panel close, Escape | C D |
| `getAnalysis`, `getState`, `listSites` (queries) | core | `slot?`; ; `shownOnly?` | what the card, scrubber and panels show | C D U |
| `resetNorth` | globe view (@globe) | | compass | C D E |
| `setReliefExaggeration` | globe display (@globe) | `factor` (0 = off, 1 = true scale; never exaggerated) | none (assistant and actions only) | C D E |
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
`setDelay`, `jumpToEvent`, `play` / `pause` / `setRate`. `getState.wallClockUtc` is the
computer's clock and `"real-now"` starts the window there, as the scrubber's "Now" does (G-10).

Rise and set times (D-8). A rise or a set is a passage of the disc through the terrain skyline,
not one moment. Since T-47 `jumpToEvent` and `getAnalysis.nextEvents` give the event's own
instant (`label`, `instant`: a sunset is "Sun fully set", the last limb) and the whole passage
(`span`: both ends with their labels and times, Earth's centre crossings, the science core's
`summary`); `getAnalysis.nextPassages` gives the passage under way or next for the Sun and for
Earth, grazes included (partly hidden, never fully set: no event). `jumpToEvent { instant:
"start" | "end" }` goes to either end, as the scrubber's buttons do. Deterministic replies, at
Blue Ghost Mission 1 from noon on 16 March 2025 (GPU run of `e2e/assistant.test.mjs`, word
for word): "jump to the start of the next sunset" gives "Moved the clock to the start of the
next sunset: Sun starts setting 2025-03-16 18:24 UTC (the terrain skyline starts to cut into
the Sun's disc), at azimuth 269.7°. The Sun starts setting 2025-03-16 18:24 and is fully set
19:30 UTC. Rise and set times are measured against the terrain skyline."; "when is the next
sunset?" gives "The next sunset: Sun fully set 2025-03-16 19:30 UTC (the last part of the
Sun's disc goes behind the terrain skyline), azimuth 269.9° (against the terrain skyline).
The Sun starts setting 2025-03-16 18:24 and is fully set 19:30 UTC." A graze: "the Sun is partly hidden from ...
until its whole disc is clear again ... UTC; it never fully sets". An end outside the analysed
window is given in the science core's words. A result without `span` (a build before T-47) is
answered with "Only this one instant of the sunset is available here, not the start and end
of its passage through the skyline." Phrases: "jump to next sunset", "jump to the start of the
next sunset", "go to when Earth is fully set", "when is the next Earthset?". The system prompt
asks a model for both ends when the result gives them.

### 2.2 Sites, catalogue, pins

`selectSite`, `dropPin`, `clearSite`; `listSites` (T-33) lists the 28 landings, every listed
name is accepted by `selectSite` (checked in C). The Filters list "Go to a landing site" is
the keyboard way to a landing (`selectSite`). Mission presets replay a landing or the eclipse
of 14 March 2025 in one step (`listPresets`, `loadPreset`).

### 2.3 Cameras and the two views

| The user can | Control | Action | Checks |
| --- | --- | --- | --- |
| turn and zoom the globe | drag, scroll, keys (each press counts, also faster than the globe draws: T-55) | `setGlobeCamera` (pose) | C D E |
| look around on the surface | drag, arrow keys | `lookAt` (pose) | C D E |
| zoom on the surface | scroll, pinch, + / - | `setFieldOfView` (pose) | C D |
| walk, rise and descend | W A S D, E / Q, Shift | `walkTo { eastM, northM, liftM }` (pose; closes G-1) | C D |
| face the Sun or Earth | HUD buttons, key metrics, chart keys | `lookAtBody` | C D |
| go back to the site | HUD "Return to site" | `walkTo { 0, 0 }` | C D |

Where the globe view is: `getState.globeDisplay.viewTarget { latDeg, lonDegEast, flying }` is
the point the view was last asked to centre on, exactly as asked, also while the camera is still
flying there; null once the globe is turned by hand. `globeCenter` is the centre drawn now (on
its way, and 0.1° short right over a pole). The Centre-of-view fields and "Drop pin at centre"
use the target; so do deterministic "zoom in / out" and "show the whole Moon" (they turned about
the drawn centre before, so a zoom after "show the south pole" re-centred 0.1° off the pole).

### 2.4 Layers and how the globe is drawn

`setOverlay`, `showMissions`, `setFilters` (as before); `setReliefExaggeration`, `showCoverage`,
`showIceTargets` (T-13, T-20). `getState.globeDisplay` reports the factor drawn now, the
coverage and ice outlines and the average-map legend.

### 2.5 Mission parameters and requirements

`setMastHeight`, `setMissionWindow`, `setDelay`, `setSunBand`, and now with on-screen fields in
the compare panel: `setSlopeLimit`, `setMaxEarthGap`. The solar band's default, 0° to 90°, is
no requirement (T-46, `src/core/requirements.ts`): `getAnalysis.requirements.sunElevationBand`
then has `required: false`, null "met" fields and a `note`, the panels say the same, and
deterministic replies give that note and the Sun's range (finding Q-5, section 4).

### 2.6 Readouts

| On screen | The assistant reads it from |
| --- | --- |
| site card: facts, elevation, data, sky now, mission-window figures | `getAnalysis` (`metrics`, `slope`, `now`, `provenance`, `siteElevationM`) |
| site card: "Sun next", "Earth next" (both ends); "Earth's centre in view" and "Any part of Earth in view", the two longest gaps | `getAnalysis.nextPassages`, `nextEvents[*].span`; `metrics.earthVisiblePct` / `longestEarthGapH` (centre) and `metrics.earthAnyPct` / `longestEarthAnyGapH` (any part of the disc, PGDA product 69's definition) |
| site card: "Belongs to", "Owner", "Explored" | `site.ownership`, `site.exploredArea` (G-12); deterministic "who owns this site", "how big is the explored area" |
| the time slider's "Now" (the real time) | `getState.wallClockUtc` (G-10); deterministic "what is the real time" |
| Centre-of-view fields | `getState.globeDisplay.viewTarget`, else `globeCenter` |
| site card: summary, QuickMap / Moon Trek links | `getState.site.summary`, `site.links` (T-33) |
| site card: site science (DSN, long-term averages, ice targets, Diviner annual temperatures, ShadowCam mosaics) | `getSiteScience`; `nearestIceTargets` for more rows or another point |
| scrubber: marks and passage spans, jump buttons (label of the next end), Moon phase line | `getAnalysis.events` (with `summary`) / `nextEvents` / `nextPassages`; `getState.moonPhase` |
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
| G-10 | The scrubber's "Now" starts the window at the **real** time; the assistant had no wall clock | @globe | **closed** by T-44: `getState.wallClockUtc`, `"real-now"` in `setTime` and `setMissionWindow`; deterministic mode: "start the mission window now in real time" |
| G-11 | Mission-window table and CSV / JSON export, seasonal outlook | @analysis | **closed**: `exportResults`, `showOutlook` (a958d6b); phrases "export the results as csv", "show the seasonal outlook for 2 months", "show the window table" |
| G-12 | The card's "Belongs to", "Owner" and "Explored" rows and the ownership mismatch (GitHub main 282249d) were in no action result | @globe | **closed** by T-44: `site.ownership`, `site.exploredArea` in `getState` and the site results; deterministic mode reads them out (903b390) |

## 4. Findings, rechecked on this build

| # | Finding | Owner | Status |
| --- | --- | --- | --- |
| F-1 | One Escape in the surface view also deselected the site | @globe, @surface | **fixed** by T-33 (`src/ui/globe/cardKeys.ts`); the expected-failure mark in `e2e/equivalence.test.mjs` is removed |
| F-2 | Card "Sky at ..." one step behind the clock | @globe | **fixed** by T-33 (`src/core/throttle.ts`, trailing run) |
| F-3 | Poleward of 80.06° the globe camera stopped short of the latitude asked for (88.000 gave 87.97) | @globe | **fixed** in b1204d3 (`flyDirection`, exact except within 0.1° of a pole); `setGlobeCamera` also returns `centredLatDeg`, with a note when \|lat\| > 89.9. The expected-failure test in `e2e/flow.test.mjs` is @desktop-workflow's to unmark |
| F-4 | The "Arrival delay" field lost its explanatory tooltip after the first good edit | @globe | **fixed** in 096ef4f (fields keep their explanation; `src/ui/fieldStatus.ts`) |
| F-5 | After `rankNearby` the compare panel was on its "Nearby sites" tab, and the core `compare` action left it there, hiding the side-by-side it reports. Found from the code of slice 2 | @analysis | **fixed** in a958d6b: the panel follows a successful `compare` (`src/ui/compare/panel.ts`); `e2e/scenario/control.test.mjs` "after a scan, compare shows the A/B tab" passes |
| F-6 | On the card a pin or candidate is titled "Pinned location"; its name (for a candidate "Candidate 300 m W, 600 m S of ...", as `selectCandidate` and the nearby list give it) appears nowhere on the card | @globe | **fixed** in dbc6c59 (T-43: candidates are named on the card) |
| F-7 | Arrow keys and + / - on the globe turned from the centre the globe had published, which it updates once per drawn frame: presses within one frame started from the same centre and all but the last were lost (seen in the equivalence test on the GPU; on a slow software renderer a keyboard user would lose presses) | @globe | **fixed** by the original team's T-55 in 351e9fc (`src/scene/globe/globeKeys.ts`: a press steps from the pose the globe is flying to). `e2e/equivalence.test.mjs` "arrow keys pressed faster than the globe draws" checks three presses with no wait |
| F-8 | `listSites` (28 rows, each with ownership and explored area, about 35 kB) was longer than the assistant's 24,000-character limit for one tool result, so a model would have read half the catalogue and a "cut" marker | @assistant (`src/assistant/protocol.ts`); for @globe, optional: the source and caveat texts repeated in each row could be given once | **fixed** in f5fad5b: the limit is 64,000 characters; `control.test.mjs` checks that the scripted model gets the whole result |
| F-9 | In GPU runs of `e2e/equivalence.test.mjs` the page loaded itself again once, at "/", in the middle of a test (04:24Z run at f5fad5b; earlier runs lost an evaluate to "execution context was destroyed" three times). Nothing in the app navigates (every link opens a new tab, forms prevent submission); not seen in the SwiftShader runs. The test records each load with its kind, referrer and the running test | open, owner unknown | under watch: a separate expected-failure check, so the functional cases are not affected |
| Q-5 | At the default solar band (0° to 90°) `getAnalysis.requirements.sunElevationBand.metForWholeWindow` was false whenever the Sun went below the horizontal, and deterministic mode answered "The Sun leaves the required elevation band". The compare panel treated the default as no requirement (since c331052). From the coordinator's walkthrough | core (`src/core/analysisReport.ts`), the original team; @assistant | **fixed** in the core by the original team's T-46 (`required: false`, null "met" fields, a `note`), and on the assistant's side in f4cc662: at the default band deterministic replies give the core's note and the Sun's range; a build without `required` falls back to the band's values (`spans.test.ts`, `e2e/assistant.test.mjs`) |

## 5. How each path has been verified

Browser runs on the GPU under the GPU lock (D-7; ANGLE, NVIDIA GTX 1050 Ti), 1280x720, on the
build of 903b390, 2026-11-15 05:24 to 05:40 UTC. The four files ran once together
(`/tmp/lunyx-assistant-t1b4b`: 186 of 192 pass). Five checks failed there, all in the tests
themselves: a new case left Blue Ghost selected for two later cases; result times are to the
minute; the card now names candidates (F-6) and has "Earth's centre in view" and "Any part of
Earth in view" rows (T-47). After those fixes, assistant, equivalence and control ran again
(`/tmp/lunyx-assistant-t1b4c`: 180 pass, 0 fail, 1 todo).

| Path | What ran | Result |
| --- | --- | --- |
| **Real language model** | nothing: there is no API key on the build machine. The command is `e2e/scenario/real-model.mjs` (see `e2e/scenario/README.md`) | **not verified** |
| Scripted test model (not a language model) | every one of the 64 actions through the real `/api/assistant` route, its result and the control that shows it checked, and the tool list a model receives (`control.test.mjs`); the T-6 scenario as three follow-ups (`scenario.test.mjs`, `LUNYX_LLM_SCRIPT=scenario`); `e2e/assistant.test.mjs`; in-process loop tests (`server/llm/loop.test.ts`, `scenarioScript.test.ts`) | control 69/69 (the 64 actions, "after a scan, compare shows the A/B tab", no page errors; and what a model is given: the renderer, the tool list through the route, every action with a case, a phrase and a row here), scenario 4/4, assistant 5/5 |
| Deterministic mode | every action by its phrase, in the browser (`control.test.mjs`) and against the stand-in app (unit); the T-6 scenario as three follow-ups and as one sentence (`scenario.test.mjs`); both ends of a sunset, Earth by its centre and by any part of its disc, the default solar band, the card's owner and explored area and the real clock on the real build (`assistant.test.mjs`) | control 65/65 (the 64 phrases, no page errors), scenario 7/7, assistant 12/12; vitest `src/assistant`, `server/llm`, `src/core`: 365/365 (29 files) |
| UI and actions (no assistant) | `e2e/equivalence.test.mjs`: the real control used, its action logged with origin "ui", the same end state from the action alone; new: the scrubber's jump buttons (`jumpToEvent { instant }`, T-47) and arrow keys pressed faster than the globe draws (F-7) | 30/30: 29 cases, and the F-9 check (still marked todo) passed |

How well a real model chooses and chains these actions is unknown until the real-model run
has been done; only the plumbing it would use is tested.

## 6. Not automated, and why

- Pinch zoom and touch drags (desktop-only acceptance, D-4): they end in the same
  `setFieldOfView` / `setGlobeCamera` / `lookAt` poses as the automated cases.
- Dictation (Web Speech API): not available headless; it only fills the message box.
- Hover tooltips (G-9).

## 7. To add when the remaining work lands

- Equivalence cases for the download buttons of the window table and for the outlook tab.
