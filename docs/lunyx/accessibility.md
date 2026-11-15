DRAFT (checkpoint 2026-11-15): first round only, on build 4f007f1; see docs/lunyx/handover/T-16-T-17-checkpoint.md

# Accessibility pass

Owner: @assistant (task T-17). First round, 2026-11-14, on the integrated build
(`am/lunyx/integration` at 4f007f1): globe view, site card, time scrubber, locator map,
assistant drawer, and the surface view as it stands. The surface HUD and chart (T-10), the
compare panel (T-11) and the rebuilt surface scene (T-9) are not built yet and will get
their own round.

**How it was done.** Automated checks in `e2e/a11y.test.mjs` (run by `npm run e2e`), a
keyboard-only walk of the main journey, and reading the key and pointer handlers.
**Not done:** listening with a screen reader. There is none on the build machine, so
wording and announcements are judged from the accessibility tree only.

## Automated checks

| Check | How | Result |
| --- | --- | --- |
| Every control has an accessible name | Chromium's accessibility tree: every button, link, field, slider, checkbox and selector must have a name. Globe view with a site selected (drawer closed and open), surface view, 390 px width (Filters sheet closed and open) | pass |
| Tab reaches every control once | one round of Tab from the top, 1280 x 720, IM-2 selected | pass: 35 controls |
| Focus never enters a hidden region | closed drawer is `inert`; folded panels are skipped | pass |
| Focus is visible | each stop draws the 2 px focus ring | pass |
| Text contrast, WCAG AA (4.5:1, large text 3:1) | every text node in the panels, composited over black space and over sunlit ground (the two extremes behind a translucent panel) | pass: Filters, site card, scrubber, locator, wordmark, surface strip, assistant drawer |
| Reduced motion | with `prefers-reduced-motion: reduce` the duration tokens are zero, the drawer does not slide, and the view change is immediate | pass |
| Phone width | names, the "Filters" button states `aria-expanded`, no panel wider than the screen, the drawer covers the width, its controls are at least 24 px | pass |

Tab order found (globe view, a site selected): globe canvas; Filters: arrival date,
latitude, longitude, "Drop pin at centre", solar elevation minimum and maximum, mast height,
mission window, arrival delay, Real, Even, "Show previous missions", "Mission filters",
"Show optimal landing area"; site card: fold, close, "Elevation data" details, QuickMap and
Moon Trek links, Earlier, "At landing time", "Enter surface view", "Whole Moon"; compass;
scrubber: play, slider, date, Now, speed, window length; locator map and its zoom; the
little person; the assistant button. It follows the screen from the left panel to the right
card and then along the bottom. Each date-and-time field takes six presses (the browser's own
day / month / year / hour / minute parts and its picker button).

## Keyboard-only walk of the main journey

| Step | Keyboard path | Works? |
| --- | --- | --- |
| Turn and zoom the globe | focus the globe: arrow keys, + and - | yes |
| Pin a place | type latitude and longitude in Filters, "Drop pin at centre"; or Enter on the focused globe | yes (but see F-3 below near the poles) |
| Open a catalogued landing | **no direct path when nothing is selected** (markers answer to the pointer only); possible through the assistant ("go to IM-2"), a link (`?site=`), or Earlier / Later once some site is open | finding A-1 |
| Go down to the surface | "Enter surface view" on the card, or the little person (Enter / Space) | yes |
| Look around on the surface | **pointer drag only**; W A S D walk | finding A-2 |
| Leave the surface | Escape, the close button, "Back to orbit" | yes, but Escape also deselects the site: F-1 |
| Scrub time | slider with arrow keys; play / pause; date field | yes |
| Delay, mast, window, requirements | Filters fields | yes |
| Ask the assistant | button, then type; Enter sends, Shift+Enter adds a line, Escape closes and returns focus to the button | yes |

## Findings

| # | Finding | Owner | Severity |
| --- | --- | --- | --- |
| A-1 | A keyboard or screen-reader user cannot open a catalogued landing from the globe when no site is selected: markers are pointer targets inside the canvas, and Enter drops a pin instead. The assistant and deep links are the only ways in. A list or selector of the landings shown (it could live under "Mission filters"), or Enter opening the marker under the centre of view, would close it. | @globe | high for keyboard users |
| A-2 | In the surface view the look direction can only be changed by dragging. The assistant can turn the view (`lookAt`), a keyboard user cannot. Arrow keys for looking (they are free: walking uses W A S D) would close it. | @surface | high for keyboard users |
| F-1 | Escape in the surface view leaves it and also deselects the site (two handlers act on one key press). A keyboard user loses the site they were studying. | @surface, @globe | medium |
| F-3 | Near the poles the view stops short of a typed latitude, so the keyboard way to pin coordinates is inexact there (up to 1.7 km at 85 degrees). | @globe | medium |
| A-3 | The jump buttons' names include their glyphs ("☀↑ Sunrise"); a screen reader may read the symbols before the word. Hiding the glyph from assistive technology (`aria-hidden` on a span) keeps the name clean. | @globe | low |
| A-4 | The "Arrival delay" field's tooltip, its only explanation, disappears after the first edit (F-4 in `actions.md`). | @globe | low |

F-1, F-3 and F-4 are described with their causes in `docs/lunyx/actions.md`.

## What is good and should stay

- One focus ring style everywhere, visible on dark and light ground.
- Live regions where things change without focus moving: the toast area, the card's
  analysis status, the assistant conversation (each reply is marked busy until it is complete).
- The closed drawer is `inert`, so it is neither focusable nor read.
- Requirements and states are said in words, not only shown in colour ("clock paused",
  "runs into the window edge", deterministic mode named on every reply).
- The app honours reduced motion in its own animations and in the camera flights.

## Still to do

- The same checks on the surface HUD, the skyline chart (it needs a text or table
  alternative), the compare panel and the nearby list when T-9 / T-10 / T-11 land.
- A screen-reader listening pass by a person.
