# T-47 Both ends of each sunrise and sunset in the globe UI and the core actions: handover (@globe)

Branch am/lunyx/agent/globe, 765eb9a. Built on the science core's passages (T-31 / T-45;
contract `docs/lunyx/handover/T-31-event-spans.md`, sections 2 to 5). Decision D-8: no rise or
set time without the instant it is; Earth's centre and any part of Earth's disc never mixed up.

## Words

| End | Sun | Earth |
| --- | --- | --- |
| start of a set (first cut) | Sun starts setting | Earth starts setting |
| end of a set (last limb; the `sunset` event) | Sun fully set | Earth fully set |
| start of a rise (first limb; the `sunrise` event) | Sun starts rising | Earth starts rising |
| end of a rise (whole disc clear) | Sun fully risen | Earth fully risen |
| Earth's centre crossing (the `earthset` / `earthrise` event) | | Earth's centre sets / rises |
| graze (never fully set) | Sun partly hidden ... Sun's whole disc clear again | the same for Earth |
| peek (never fully risen) | Sun partly visible ... Sun gone again | the same for Earth |

Labels for set and rise ends come from the science core (`TRANSITION_WORDS`); the summary
sentence is its `transitionSummary` ("starts setting 2025-03-16 18:23, fully set 19:30 UTC").

## Result shapes (for lunyx-experience's @assistant)

All additive; existing fields keep their meaning.

**`jumpToEvent { type, which?, instant? }`**: new `instant`: `"event"` (default, the event itself
as before), `"start"` or `"end"` of its passage. Result:

```jsonc
{ "event": "sunset", "instantChoice": "start",
  "label": "Sun starts setting", "instant": "the terrain skyline starts to cut into the Sun's disc",
  "timeUtc": "2025-03-16T18:23Z", "azDeg": 264.6,
  "outsideAnalysedWindow": true,            // only when the instant lies outside the window
  "span": SpanReport | null, "playing": false }
```

**SpanReport** (one passage of a disc through the skyline):

```jsonc
{ "body": "sun" | "earth",
  "kind": "set" | "rise" | "graze" | "peek" | "unresolved",
  "start": { "edge": "first-cut" | "first-limb", "label": "Sun starts setting", "timeUtc", "azDeg", "inWindow" },
  "end":   { "edge": "last-limb" | "whole-clear", "label": "Sun fully set", "timeUtc", "azDeg", "inWindow" },
           // an end not found: { "edge": "unresolved", "label": null, "timeUtc": null, "inWindow": false }
  "hours": 1.11,
  "centre": [ { "label": "Earth's centre sets", "timeUtc", "inWindow" } ],   // when the centre crossed
  "summary": "starts setting 2025-03-16 18:23, fully set 19:30 UTC" }
```

**`getAnalysis`**: 
- `nextEvents.<type>` gains `summary` ("Sunset: starts setting ..., fully set ... UTC") and `span` (SpanReport).
- New `nextPassages: { sun: SpanReport | null, earth: SpanReport | null }`: the passage under way at
  the simulated time, else the next one, including passages that end beyond the window and grazes
  (which have no event).
- `events[*]` gain `summary`.
- `metrics` gain `earthAnyPct` (any part of Earth's disc, PGDA product 69's definition),
  `longestEarthAnyGapH` (Earth's disc wholly hidden), `earthAnyGapRunsIntoWindowEdge`, next to
  `earthVisiblePct` / `longestEarthGapH` (Earth's centre, as before).
- `intervals.earthDiscHidden`: spells with Earth's disc wholly hidden.
- `requirements.maxEarthGap.basis`: "Earth's centre".

**`compare`**: `diff.earthAnyPct` (B minus A, points) when the science core gives it.

## On screen

- Scrubber: each passage in the window is a span under the event glyphs (Sun gold, Earth blue;
  grazes and peeks fainter), its tooltip the science core's sentence. The four jump buttons go to
  each end in turn: from midday on 16 March at Blue Ghost the sunset button reads "Sun starts
  setting", jumps to 18:23, then reads "Sun fully set" and jumps to 19:30. Each button's tooltip
  gives the time, the instant in words and the whole passage.
- Site card, "Sky at ...": new rows "Sun next" and "Earth next" with both ends ("under way:" while
  the passage is in progress).
- Site card, "Mission window": "Earth's centre in view", "Any part of Earth in view", "Longest
  gap, Earth's centre", "Longest gap, whole disc", and a note on the two definitions.

## Tests

- `src/core/skyEvents.test.ts`: labels of both ends, grazes and unresolved ends, the SpanReport,
  start/end/event lookups next and previous, the buttons' turn order.
- `src/core/coreActions.test.ts`, real science core and bundled data: Blue Ghost (catalogue
  position, 2 m mast, 15 days from touchdown): `jumpToEvent { sunset, start }` within 3 min of the
  validator's first cut 18:23:40, then the event within 3 min of the last limb 19:30:03, the same
  passage summary in `getAnalysis`, `nextPassages`, and Earth 100 % by both definitions.
- `src/core/analysisReport.test.ts`: requirement basis.

## Runs

- `npm run build` passes; vitest src/core, src/ui and displayState: 30 files, 244 tests pass @ 765eb9a, no lock.
- GPU browser check @ 765eb9a (dist of that tree; flock /tmp/lunyx-gpu.lock, 1280x720, load 3.9),
  log /tmp/lunyx-t47/run.log:
  - Blue Ghost 1, 15 days from touchdown, clock 2025-03-16 12:00 UTC: the sunset button read
    "Sun starts setting" (tooltip "Jump to 2025-03-16 18:24 UTC: Sun starts setting (...). Sunset:
    starts setting 2025-03-16 18:24, fully set 19:30 UTC"); clicked: `jumpToEvent (ui) { sunset,
    start }` to 18:24:23, the button then read "Sun fully set"; clicked: `{ sunset, event }` to
    19:30:47. Card: "Sun next: starts setting 2025-03-16 18:24, fully set 19:30 UTC"; Earth's centre
    and any part both 100.0 %. (`screens/t47-blue-ghost.jpg`, `t47-scrubber-bg.png`)
  - IM-2, 14 days from touchdown, clock 2025-03-17 00:00: Earth's passage drawn from 18 to 20 March,
    "starts setting 2025-03-18 06:33, centre sets 2025-03-19 04:08, fully set 2025-03-20 07:40 UTC";
    the Earth button read "Earth starts setting"; window rows: Earth's centre 88.9 %, any part 97.1 %,
    longest gaps 1 d 13 h (centre) and 9 h 48 min (whole disc), both running into the window's end
    (`screens/t47-scrubber-im2.png`, `t47-card-im2.png`). The science core's own figures at the old
    IM-2 pin were 88.90 % / 97.04 % (T-31 handover, section 6).
