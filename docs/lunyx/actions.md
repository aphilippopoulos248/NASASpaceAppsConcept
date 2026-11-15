DRAFT (checkpoint 2026-11-15): inventory of the 33-action build 4f007f1, not of the current registry; see docs/lunyx/handover/T-16-T-17-checkpoint.md

# What a user can do in Lunyx, and the action behind it

Audit for decision D-1 ("the LLM can operate the full navigator") and task T-16.
Owner: @assistant.

**State of this document.** Derived on 2026-11-14 from the integrated build
(`am/lunyx/integration` at 4f007f1) by reading every event handler and every `runAction`
call in `src/ui/` and `src/scene/`, and from the registry at run time (`/actions` in the
assistant drawer lists it). It covers the globe view, the shell, the assistant drawer and
the surface view as it stands. **Not covered yet**, because they are not built: the
surface HUD and skyline chart (T-10), the compare panel, nearby alternatives and exports
(T-11), the rebuilt surface scene (T-9), the overlay drawing (T-13) and the site-science
readouts (T-20). Section 7 lists what to add when they land.

How the pieces relate: a control calls `runAction(name, params)`; the assistant's tool list
is `toolDefinitions()` over the same registry and its calls are
`runAction(name, input, 'assistant')`. There is no second list (checked by a unit test and
by `e2e/assistant.test.mjs`: the tools a model would receive are exactly the registered
actions).

Check column: **E** = automated in `e2e/equivalence.test.mjs` (the control is used for real,
the log must show the action with origin "ui", then the action alone must leave the same
state); **U** = unit test; **H** = checked by hand in the browser; **-** = not checked.

## 1. The registry (33 actions in this build)

| Action | Parameters | A control uses it? |
| --- | --- | --- |
| `setTime` | `utc?`, `offsetHours?` | scrubber slider and date field |
| `play`, `pause` | `rate?` | scrubber play button |
| `setRate` | `secondsPerSecond` | scrubber speed selector |
| `setLightMode` | `mode: real \| even` | Filters: Real / Even |
| `jumpToEvent` | `type`, `which?: next \| previous` | scrubber jump buttons (next only) |
| `selectSite` | `site`, `atLanding?`, `surface?`, `fly?` | markers, site card, deep links |
| `dropPin` | `lat`, `lon`, `fly?` | globe click, Enter, "Drop pin at centre", little person |
| `clearSite` | | site card close, Escape |
| `enterSurface`, `exitSurface` | | site card, little person; close button, "Back to orbit", Escape |
| `setGlobeCamera` | `lat`, `lon`, `altitudeKm?` | globe drag / scroll / keys, lat / lon fields, locator map, "Whole Moon" |
| `lookAt` | `azDeg`, `elDeg?`, `fovDeg?` | surface drag and scroll |
| `setMastHeight` | `metres` | Filters: Mast height |
| `setMissionWindow` | `startUtc?` (UTC, `now`, `landing`), `durationH?`, `moveClock?` | arrival date, window selectors, "Now", "Start window here" |
| `setDelay` | `hours` | Filters: Arrival delay |
| `setSunBand` | `minDeg`, `maxDeg` | Filters: solar elevation requirement |
| `setOverlay` | `mode: off \| sun-band \| avg-illumination \| avg-earth-visibility` | Filters: "Show optimal landing area" |
| `showMissions` | `show` | Filters: "Show previous missions" |
| `setFilters` | `programs?`, `countries?`, `type?`, `fromYear?`, `toYear?`, `reset?` | mission filters |
| `showPanel` | `panel: filters \| site-details`, `open` | site card fold button, phone "Filters" button |
| `resetNorth` | | compass |
| `setLocatorZoom` | `zoom` | locator map + / -, scroll |
| `setGeneratedDetail` | `on` | surface: "Generated detail" |
| `setAssistantOpen` | `open` | assistant button, drawer close, Escape in the drawer |
| `clearConversation` | | drawer "New chat" |
| `getState` (query) | | (what every panel shows) |
| `getAnalysis` (query) | `slot?: current \| A \| B` | site card "Mission window" results |
| `saveScenario` | `slot: A \| B`, `label?` | no control yet (compare panel, T-11) |
| `compare`, `stopCompare` | | no control yet (T-11) |
| `setSlopeLimit` | `degrees` | no control yet (nearby panel, T-11) |
| `setMaxEarthGap` | `hours?` | no control yet (T-10 / T-11) |

The five without a control are available to the assistant today; a user cannot reach them
from the screen until T-10 / T-11 ship. That is the reverse of a D-1 gap, but it does mean
their UI equivalence cannot be tested yet.

## 2. Capabilities, control by control

### 2.1 Time

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| start and stop the clock | scrubber play / pause button | `play`, `pause` | E |
| scrub through the mission window | scrubber slider (pointer or arrow keys) | `setTime { utc }` | E |
| type the simulated instant | scrubber date field | `setTime { utc }` | E |
| change playback speed | scrubber speed selector | `setRate` | E |
| jump to the next sunrise / sunset / Earthrise / Earthset | four scrubber buttons | `jumpToEvent { type }` | U, H |
| jump to the previous one | (no control) | `jumpToEvent { which: "previous" }` | U |
| set the arrival (start of the mission window) and bring the clock there | Filters: "Arrival date and time (UTC)" | `setMissionWindow { startUtc, moveClock: true }` | E |
| start the window at the real time | scrubber "Now" | `setMissionWindow { startUtc: <now>, moveClock: true }` | E |
| start the window at the simulated time | scrubber "Start window here" | `setMissionWindow { startUtc: "now" }` | E |
| set the window length | selectors in Filters and in the scrubber | `setMissionWindow { durationH }` | E |
| explore a late arrival | Filters: "Arrival delay" | `setDelay { hours }` | E |
| light the Moon truly or evenly | Filters: Real / Even | `setLightMode` | E |

### 2.2 Choosing a site

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| open a catalogued landing | click its marker (again: cycle overlapping markers) | `selectSite { site, surface: true }` | E |
| pin any coordinate | click empty ground | `dropPin { lat, lon }` | E |
| pin the centre of view | "Drop pin at centre"; Enter on the focused globe | `dropPin { lat, lon }` | E |
| step through the visible landings | site card "Earlier" / "Later"; Left / Right arrow keys | `selectSite { site, surface: true }` | E (buttons), H (keys) |
| go to a landing at its touchdown time | site card "At landing time" | `selectSite { site, atLanding: true, fly: false }` | E |
| deselect | site card close; Escape | `clearSite` | E |
| open a site from a link | `?site=`, `&t=`, `&light=landing`, `&view=surface` | `setTime`, `setMissionWindow`, `selectSite`, `setLightMode`, `enterSurface` (origin "url") | E |

### 2.3 The two views

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| step down to the surface | site card "Enter surface view"; click the little person | `enterSurface` | E |
| step down where they drop the little person | drag the little person onto the globe | `dropPin` then `enterSurface` | H |
| return to the globe | surface close button; "Back to orbit" | `exitSurface` | E |
| return to the globe from the keyboard | Escape | `exitSurface`, **but see finding F-1** | E (expected failure) |

### 2.4 Cameras

Continuous gestures have no action of their own: they end in a pose, and the pose is what
the action sets (the registry's rule for gestures). The check replays the pose a gesture
reached through the action and compares.

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| turn and zoom the globe | drag, scroll, pinch; arrow keys, + / - on the focused globe | `setGlobeCamera { lat, lon, altitudeKm }` | E (drag, scroll, keys), - (pinch) |
| go to typed coordinates | Filters: Latitude, Longitude | `setGlobeCamera { lat, lon }` | E |
| see the whole Moon | site card "Whole Moon" | `setGlobeCamera { ..., altitudeKm }` | E |
| turn the globe from the small map | locator map: click, drag, arrow keys | `setGlobeCamera { lat, lon }` | E (click), H (drag, keys) |
| zoom the small map | locator + / -, scroll, + / - keys | `setLocatorZoom` | E (buttons), H (scroll, keys) |
| put north up | click the compass | `resetNorth` | E |
| look around on the surface | drag; scroll to zoom | `lookAt { azDeg, elDeg, fovDeg }` | E (drag), H (scroll) |
| **walk on the surface** | W A S D, E / Q, Shift | **none: gap G-1** | - |

### 2.5 Layers, filters, requirements

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| show or hide previous missions | Filters checkbox | `showMissions` | E |
| filter them by program, country, crewed / robotic, years; reset | "Mission filters" | `setFilters` | E |
| show the landing-area overlay and choose which | Filters checkbox and selector | `setOverlay` | E |
| set the required solar elevation band | Filters: minimum, maximum | `setSunBand` | E |
| set the mast height | Filters: Mast height | `setMastHeight` | E |
| show generated (not measured) surface detail | surface: "Generated detail" | `setGeneratedDetail` | H |

### 2.6 Panels and the assistant

| The user can | Control | Action | Check |
| --- | --- | --- | --- |
| fold the site details | site card fold button | `showPanel { panel: "site-details" }` | E |
| open the Filters sheet on a phone | "Filters" button (700 px and narrower) | `showPanel { panel: "filters" }` | H |
| open and close the assistant | button lower right; drawer close; Escape in the drawer | `setAssistantOpen` | E |
| start a new conversation | drawer "New chat" | `clearConversation` | E (`assistant.test.mjs`) |
| send a message, stop a reply, dictate | drawer text box, Send, Stop, microphone | not actions: they are how one talks to the assistant | - |
| expand "Mission filters", "Elevation data: every source" | native disclosure widgets | not actions: nothing in the app changes | - |

### 2.7 What a user can read, and where the assistant gets the same

| On screen | The assistant reads it from |
| --- | --- |
| simulated time, clock running, speed | `getState`: `timeUtc`, `playing`, `rateSimSecondsPerSecond` |
| selected site: name, coordinates, program, country, landing date, crewed, region | `getState.site` |
| centre of view and camera altitude | `getState.globeCenter` |
| mission window, delay, mast, slope limit, Earth-gap limit, solar band | `getState` |
| overlay, markers shown, filter and how many landings pass it | `getState`: `overlay`, `showMissions`, `missionsShown` |
| site card "Mission window": sunlight, longest darkness, Earth in view, longest Earth gap, slope | `getAnalysis`: `metrics`, `slope` |
| site card "Sun" and "Earth" now, against the skyline | `getAnalysis.now` |
| scrubber marks and next rise / set | `getAnalysis`: `nextEvents`, `events` |
| elevation at the site, elevation data used, notes | `getAnalysis`: `siteElevationM`, `provenance`, `warnings` |
| comparison labels and whether it is open | `getState.compare`; results from `compare` |
| look direction on the surface | `getState.look` |
| a failed control's message (toast) | the same sentence is the action's error |

## 3. Gaps

A gap is something a user can do or read that no action covers, or data in the build that
neither a user nor the assistant can reach.

| # | Gap | Owner | Status |
| --- | --- | --- | --- |
| G-1 | Walking on the surface (W A S D, E / Q) has no action with an absolute position; the assistant cannot move the viewer, only turn the view. | @surface | open, reported (hub m254); the surface scene is being rebuilt (T-9) |
| G-2 | DSN station opportunities (`analysis.dsn`: Goldstone, Canberra, Madrid, any station) are computed with every analysis but have no control and are not in any action result. | @globe (T-20) | open |
| G-3 | Long-term polar averages at a site (`src/science/polarAverages.ts`) can be drawn as an overlay but the value at the selected site has no readout and no action. | @globe (T-20) | open |
| G-4 | Distance to mapped ice-bearing shadowed regions (`src/science/iceTargets.ts`) has no control and no action. | @globe (T-20) | open |
| G-5 | The landing catalogue cannot be listed through an action: names appear only in the error of a failed `selectSite`, and `setFilters` returns ids. A user sees every marker and its tooltip. | @globe | open, reported (hub m254) |
| G-6 | Site card content with no action result: the site's summary text, and the QuickMap / Moon Trek links. | @globe | open, reported |
| G-7 | Scrubber readout "phase, % lit from Earth" is not in any action result. | @globe | open, reported |
| G-8 | Locator map zoom is not in `getState` (the action returns it when set). | @globe | open, minor |
| G-9 | Hover readouts (marker tooltip, locator pointer coordinates) depend on a pointer position. No action; the information itself is covered by G-5 and `getState`. | - | accepted |

## 4. Differences found by the equivalence tests

| # | Finding | Owner | Status |
| --- | --- | --- | --- |
| F-1 | One Escape press in the surface view runs `exitSurface` and then `clearSite`: the surface view's key handler and the site card's key handler both act on it. The close button and "Back to orbit" keep the site; so does the action. Repro: `selectSite im-2`, `enterSurface`, Escape; the action log shows both. | @surface, @globe | reported 2026-11-14 (hub m254); the test is marked as an expected failure until fixed |
| F-2 | The site card's "Sky at ..." heading and Sun / Earth rows can stay one step behind the clock: updates within 250 ms of the previous one are skipped and no final update follows. Found by reading `siteCard.ts`; not yet shown in a test. | @globe | reported 2026-11-14 (hub m254) |

| F-3 | Poleward of 80.06 degrees the globe camera stops short of the latitude asked for: 85.000 gives 84.9435 (1.71 km), 88.000 gives 87.9708 (0.89 km), 89.45 gives 89.4417; exact below 80 degrees; the same at every altitude and longitude, north and south. Cause: `flyTo` in `src/scene/globe/globeView.ts` clamps the target direction's y to +-0.985 and re-normalises. Effects: `setGlobeCamera` and the Latitude field do not centre on what was asked; "Drop pin at centre" after typing coordinates pins a point up to 1.7 km away, while the assistant's `dropPin { lat, lon }` is exact; editing the Longitude field afterwards re-sends the rounded latitude on screen and drifts further. | @globe | found 2026-11-14; reported; `e2e/flow.test.mjs` holds the expected-failure test |
| F-4 | The "Arrival delay" field loses its explanatory tooltip after the first successful edit: the shared number field writes the error text into `title` and clears it on success (`filtersPanel.ts`, `numberField`). | @globe | found 2026-11-14; reported; minor |

Everything else that was compared matched: see the E rows above.

## 5. Equivalence checks that are not automated, and why

- **Pinch zoom, drag on the locator map, dragging the little person**: touch and drag
  paths that end in the same `setGlobeCamera` / `dropPin` calls as the automated mouse and
  keyboard cases; checked by reading the handlers, not driven.
- **Jump buttons**: need a finished analysis with an event ahead; covered by unit tests of
  `jumpToEvent` and by hand. To automate with the flow test (T-17).
- **"Generated detail"**: its state is inside the surface scene, not in the shared state;
  checked by hand through the button's pressed state.
- **Phone "Filters" button**: needs a 390 px viewport; checked by hand.

## 6. How the assistant paths have been verified

| Path | What ran | Result |
| --- | --- | --- |
| **Real language model** | nothing: there is no API key on the build machine | not verified |
| Scripted test model (not a language model) | unit: the tool loop through the real handler, including the T-1 sentence as a 5-step chain against a stand-in app. Browser: chained tool calls, unknown / malformed / failing calls, follow-ups, through the real `/api/assistant` route (`e2e/assistant.test.mjs`) | passes |
| Deterministic mode | unit: 60 cases including the T-1 sentence against a stand-in app and the real core actions. Browser: commands, a reply whose numbers are compared with `getAnalysis`, refusal to guess, `/actions` (`e2e/assistant.test.mjs`) | passes |

A real-model run is one command (`ANTHROPIC_API_KEY=... npm run dev`). Until someone runs
it, how well a real model chooses and chains these actions is unknown; only the plumbing
it would use is tested.

## 7. To add when the remaining work lands

- T-10: key metrics, skyline chart (expand, mode), blocked-interval explanation
  (`explainBlockage`), controls for the Earth-gap limit.
- T-11: compare panel (`saveScenario`, `compare`, `stopCompare`, `compareMastHeights`),
  nearby alternatives (`rankNearby`, `selectCandidate`, slope limit), result tables and
  exports (`exportResults`), saved comparisons.
- T-9: the rebuilt surface scene's own controls, and whether walking gets an action (G-1).
- T-13: overlay drawing, relief exaggeration, coverage outlines, polar close-up.
- T-20: site-science readouts (G-2, G-3, G-4).
- The T-1 browser scenario ("Find a flatter nearby site with a shorter blackout, compare it
  against this pin for the same dates, then show me the ridge at Earthset") against the
  real build, with the values the assistant reports asserted against the app's results.
