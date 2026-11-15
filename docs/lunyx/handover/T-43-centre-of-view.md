# T-43 Typing a coordinate: handover (@globe)

Branch am/lunyx/agent/globe. Findings from lunyx-experience's desktop walkthrough
(docs/lunyx/qa-findings.md and e2e/qa/repro-centre.mjs on am/lunyx-experience/agent/desktop-workflow).

| Item | What was wrong | Fixed in | How |
| --- | --- | --- | --- |
| Q-1 | Latitude, Tab, longitude, Enter: the latitude field was refilled with the still-flying camera's latitude when it lost the focus, and the longitude commit sent that one. | dbc6c59 | The Centre-of-view fields show the point the view was asked to centre on, exactly as asked (`GlobeLive.viewTarget`), not the camera on its way. A commit takes the other coordinate from the other field, and a value the app wrote there keeps its exact figure (`centreFields.ts`). |
| Q-2 | "Drop pin at centre" right after typing pinned the camera wherever it was at the click. | dbc6c59 | The button pins the same asked-for point. |
| F-3 | Poleward of 80.06 deg the flight stopped short (clamp on the vector's height). | b1204d3 | Only the latitude is limited, to 89.9 deg on the same meridian (`flyTarget.ts`); everywhere else the flight ends exactly on the point. `setGlobeCamera` returns `centredLatDeg` and a note when a pole was asked for; the line under the fields says the view stops 0.1 deg from the pole and that the pin still goes on the point entered. |
| Q-3 | The auto-rotation's damped momentum turned the camera on after the first flight had arrived. | dbc6c59 | Every flight (and a link's jump) first stops the auto-rotation and pays out the controls' leftover turn in one undamped update. |
| F-4 | "Arrival delay" lost its explanatory tooltip after the first edit. | 096ef4f | `fieldStatus.ts`: errors show in the tooltip, the explanation comes back once a value is accepted (also the scrubber's date field). |
| F-6 | A scan candidate was titled "Pinned location" on the card. | dbc6c59 | The card shows the candidate's own name ("Candidate 300 m W, 600 m S of ..."). |

The asked-for point is cleared when the globe is turned by hand (the orbit controls' `start`),
so the fields follow the camera again after a drag or a wheel turn. `getState.globeDisplay.viewTarget`
gives `{ latDeg, lonDegEast, flying }` (null after a hand turn).

## Tests

- `src/ui/globe/centreFields.test.ts`: Q-1 (typed order with the camera moving between the
  keystrokes), Q-2, exact site coordinates kept when only the other field is edited, a
  hand turn hands the fields back to the camera, parsing.
- `src/scene/globe/flyTarget.test.ts`: exact landing to 1e-9 deg from 0 to 89.89 deg, the
  0.1 deg stop on the same meridian, the pole itself.
- `src/core/coreActions.test.ts`: `setGlobeCamera` reports `centredLatDeg` and the note only when
  a pole was asked for.
- `src/ui/fieldStatus.test.ts` (F-4).

## Runs

- Build passes; vitest of the touched files (src/ui, src/core/coreActions, src/scene/globe
  flyTarget and displayState) pass @ dbc6c59, no lock.
- GPU check @ 8077387 (1280x720, flock /tmp/lunyx-gpu.lock), keyboard only in Filters > Centre of
  view: "-89.95", Tab, "120", Enter. 300 ms later, mid-flight, the fields read "-89.95" / "120",
  `viewTarget` { -89.95, 120, flying: true }, and the line under them says the view stops 0.1 deg
  from the pole. "Drop pin at centre" pinned 89.950 S, 120.000 E exactly; the view came to rest at
  -89.9 / 120. Log: /tmp/lunyx-t42/run.log.
- Earlier GPU check @ 3131082: setGlobeCamera -89.45 / 136.7 ended at -89.4500 / 136.7000, and
  85 N / 20 W exactly; -90 stopped at -89.9 on the camera's meridian.
- repro-centre (e2e/qa/repro-centre.mjs): the "after" run is lunyx-experience's, on the published
  6d4da06 (coordinator, m575); I cancelled my own queued copy so the GPU queue does not run it twice (D-10).
