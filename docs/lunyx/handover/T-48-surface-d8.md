# T-48 D-8 in the surface HUD: handover (@surface)

Branch am/lunyx/agent/surface. Builds on lunyx-science's passages (T-45: `SkyEvent.span`,
`SiteAnalysis.transitions`, `nextTransitions`, `transitionSummary`, `transitionText`,
`TRANSITION_WORDS`, `metrics.earthAny*`; contract `docs/lunyx/handover/T-31-event-spans.md`).

## What changed

- **Countdowns** (`src/ui/surface/metricsModel.ts`, `metrics.ts`). Each row names the next
  instant of its passage that is still ahead and counts down to it: "Sun starts setting in
  12 d 23 h"; during the passage "Sun fully set in 3 h 15 min, setting now". The second line
  is the science core's own summary with both ends, e.g. "starts setting 2025-03-19 16:36,
  fully set 23:06 UTC"; for Earth also its centre crossing ("starts setting ..., centre sets
  ..., fully set ... UTC"). The hint is `transitionText()`, and says where the button goes:
  `jumpToEvent` moves the clock to the event's own instant ("Sun fully set" for a sunset), as
  before. A set or rise that begins before the window ends but finishes after it comes from
  `nextTransitions()`, with "(after the analysed window)" on the end that lies outside. An end
  that was not found is never given a time (the core's wording says so).
- **Earth figures**: "Earth in sight: centre 69.1 % · any part of the disc 79.8 %" and
  "Longest Earth gap: centre 6 d 04 h · whole disc 4 d 00 h" (`earthAnyPct`,
  `longestEarthAnyGapH`). The requirement flag for the longest gap still uses the centre.
- **Skyline chart, time mode** (`chartModel.ts`, `skylineChart.ts`): each passage of either
  body overlapping the window is a faint band (the body's colour) in the clearance panel,
  at least 2 px wide; the legend names it; the tooltip adds "setting" or "rising" inside one.

## Checked

- Tests: `src/ui/surface` 42 (new: the countdown against `nextEvents()`'s span in the
  synthetic fixture, the "setting now" case, Earth by both definitions, `rowPassage` and
  `passageInstants`, the chart's passages and `passageAt`).
- GPU, 1280x720, IM-2 from 2025-03-06 17:28 UTC, 480 h window: every countdown's second line
  equals `transitionSummary()` of `nextEvents(...)[type].span`, computed on the same analysis
  in the page (sunset "starts setting 2025-03-19 16:36, fully set 23:06 UTC"; Earthset
  "starts setting 2025-03-18 06:33, centre sets 2025-03-19 04:08, fully set 2025-03-20 07:09
  UTC"; Earthrise "starts rising 2025-03-24 08:00, centre rises 2025-03-25 08:20, fully risen
  2025-03-26 02:54 UTC"; no sunrise in the window on either side). Earth figures equal
  `metrics` (69.13 / 79.82 %, 148.2 h / 96.9 h). With the clock at the middle of the sunset
  (2025-03-19 19:51:16 UTC): "Sun fully set in 3 h 15 min, setting now", and the Sun row says
  52 % of the disc above the skyline. Three passage bands in the time chart.
- Screenshots: `screens/t48-im2-time-passages-1280.jpg`, `screens/t48-im2-setting-metrics.jpg`.

## Limits

- At 1280x720 the countdowns are below the fold of the key-metrics panel (it scrolls, with
  "More below"), as before.
- The skyline mode marks are unchanged: a sample during a passage is filled (some of the
  disc shows), as before.
