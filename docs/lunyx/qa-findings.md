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
| Q-1 | Filters > Centre of view, typed in the natural order (latitude, Tab, longitude, Enter): the latitude field is refilled with the centre of the still-flying camera when it loses focus, and the longitude commit sends that in-flight latitude, not the typed one. The view ends far from the typed point. | @globe | f928038, c4aaba5 | PENDING-NUMBERS |
| Q-2 | Typing both coordinates and pressing "Drop pin at centre" straight away pins wherever the camera is at the moment of the click (mid-flight), not the typed point. | @globe | f928038, c4aaba5 | PENDING-NUMBERS |
| F-3 | (legacy, already reported) Poleward of 80.06° the fly-to clamps the camera direction, so the view stops short of the typed latitude and "Drop pin at centre" pins off the typed point, even when each field is committed with Enter and each flight is awaited. Each further commit of either field re-sends the shifted latitude shown in the field and moves the view again. | @globe | f928038, c4aaba5 | PENDING-NUMBERS |
| Q-3 | After load the globe auto-rotates; when the first flight stops the rotation, the rotation's damped momentum keeps turning the camera after arrival, so a short first hop ends off in longitude. | @globe | f928038 | PENDING-CONFIRMATION |

## Reproductions

### Q-1, Q-2, F-3, Q-3: `e2e/qa/repro-centre.mjs`

```bash
npm run build
flock /tmp/lunyx-gpu.lock node e2e/qa/repro-centre.mjs     # writes e2e/qa/out/repro-centre-<sha>/repro-centre.json
```

1280x720, motion on (as a person sees the app), the GPU renderer. Each case starts from the
centre 8.37° N, 0.06° W, reached by action and verified, and types IM-2's coordinates
(84.79° S, 29.2° E) into Filters > Centre of view.

PENDING-TABLES

### By hand

1. Open the app at 1280x720 and wait for it to load.
2. Filters > Latitude: type `-84.79`, press Tab. The field at once shows the latitude of the
   moving camera (for example `8.37`), not `-84.79`.
3. Type `29.2` in Longitude and press Enter straight away: the globe turns to about 8° N,
   29.2° E instead of the south pole.
4. Repeat 2, then type `29.2` and click "Drop pin at centre" without pressing Enter: the pin
   lands between the start and the pole, at longitude 0.06° W.

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
